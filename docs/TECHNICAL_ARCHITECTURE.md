# FlowSense — Technical Architecture

## Overview

FlowSense is an AI-powered UX audit system that analyzes screen recordings using computer vision. It extracts keyframes, sends them to GPT-4o Vision for heuristic evaluation, aggregates scores, and generates actionable reports.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                  │
│                     Next.js 15 (App Router)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
│  │  Upload UI  │  │  Report UI  │  │  History UI │                │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                │
│         │                │                │                        │
│         ▼                ▼                ▼                        │
│  ┌──────────────────────────────────────────────┐                 │
│  │           API Routes (/api/runs/*)           │                 │
│  └──────────────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        AZURE SERVICES                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │
│  │  Blob Storage   │  │    SQL Server   │  │  OpenAI GPT-4o  │    │
│  │  (videos/frames)│  │  (metadata/runs)│  │  (vision API)   │    │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      BACKEND PROCESSOR                              │
│                     Express + Node.js                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
│  │   Poller    │  │  FFmpeg     │  │  Vision     │                │
│  │  (job queue)│  │  (frames)   │  │  (AI eval)  │                │
│  └─────────────┘  └─────────────┘  └─────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 15, React 18, TypeScript, Tailwind CSS, shadcn/ui |
| **Backend** | Node.js, Express, TypeScript, tsx (dev) |
| **Database** | Azure SQL Server (T-SQL) |
| **Storage** | Azure Blob Storage |
| **AI** | Azure OpenAI GPT-4o Vision |
| **Video Processing** | FFmpeg, Sharp (image manipulation) |
| **Auth** | Microsoft Entra ID (disabled for local dev) |
| **Monorepo** | Turborepo with npm workspaces |

---

## Database Schema

```sql
-- Users (synced from Entra ID)
CREATE TABLE profiles (
    id UNIQUEIDENTIFIER PRIMARY KEY,        -- Entra object ID
    full_name NVARCHAR(255),
    created_at DATETIME2 DEFAULT GETUTCDATE()
);

-- Analysis runs (one per video upload)
CREATE TABLE analysis_runs (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id UNIQUEIDENTIFIER NOT NULL REFERENCES profiles(id),
    title NVARCHAR(255) NOT NULL,
    video_storage_path NVARCHAR(500) NOT NULL,  -- Blob path
    status NVARCHAR(20) DEFAULT 'uploaded'
        CHECK (status IN ('uploaded','queued','processing','completed','failed','cancelled','cancel_requested')),
    cancel_requested BIT DEFAULT 0,
    error_message NVARCHAR(MAX),
    progress_percentage INT DEFAULT 0,
    progress_message NVARCHAR(255),
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE()
);

-- Extracted frames
CREATE TABLE frames (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    run_id UNIQUEIDENTIFIER NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    storage_path NVARCHAR(500) NOT NULL,   -- Blob path to JPEG
    timestamp_ms INT NOT NULL,              -- Position in video
    is_keyframe BIT DEFAULT 0,              -- Selected for AI analysis
    diff_score FLOAT DEFAULT 0,             -- Pixel difference from previous frame
    created_at DATETIME2 DEFAULT GETUTCDATE()
);

-- AI analysis results (one per keyframe)
CREATE TABLE frame_analyses (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    frame_id UNIQUEIDENTIFIER NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
    rubric_scores NVARCHAR(MAX) NOT NULL CHECK (ISJSON(rubric_scores)=1),
    justifications NVARCHAR(MAX) NOT NULL CHECK (ISJSON(justifications)=1),
    issue_tags NVARCHAR(MAX) DEFAULT '[]' CHECK (ISJSON(issue_tags)=1),
    suggestions NVARCHAR(MAX) DEFAULT '[]' CHECK (ISJSON(suggestions)=1),
    created_at DATETIME2 DEFAULT GETUTCDATE()
);

-- Aggregated summary (one per run)
CREATE TABLE run_summaries (
    run_id UNIQUEIDENTIFIER PRIMARY KEY REFERENCES analysis_runs(id) ON DELETE CASCADE,
    overall_scores NVARCHAR(MAX) NOT NULL CHECK (ISJSON(overall_scores)=1),
    top_issues NVARCHAR(MAX) DEFAULT '[]',
    recommendations NVARCHAR(MAX) DEFAULT '[]',
    weighted_score_100 FLOAT,
    critical_issue_count INT DEFAULT 0,
    quality_gate_status NVARCHAR(10) CHECK (quality_gate_status IN ('pass','warn','block')),
    confidence_by_category NVARCHAR(MAX) CHECK (ISJSON(confidence_by_category)=1),
    metric_version NVARCHAR(20),
    created_at DATETIME2 DEFAULT GETUTCDATE()
);
```

---

## Processing Pipeline

### Step 1: Video Upload
```typescript
// Frontend: POST /api/runs
const { run, uploadUrl } = await fetch('/api/runs', {
  method: 'POST',
  body: JSON.stringify({ title, fileName, contentType })
});

// Direct upload to Azure Blob Storage via SAS URL
await fetch(uploadUrl, {
  method: 'PUT',
  body: videoFile,
  headers: {
    'Content-Type': 'video/mp4',
    'x-ms-blob-type': 'BlockBlob'
  }
});

// Enqueue for processing
await fetch(`/api/runs/${run.id}/enqueue`, { method: 'POST' });
```

### Step 2: Job Polling (Backend)
```typescript
// backend/src/poller.ts - Runs every 5 seconds
export async function pollForJobs() {
  const runId = await claimNextQueuedRun(workerId);
  if (runId) {
    await processRun(runId);
  }
}

// SQL: Atomic claim with row locking
WITH run_to_claim AS (
  SELECT TOP 1 id
  FROM analysis_runs WITH (UPDLOCK, READPAST, ROWLOCK)
  WHERE status = 'queued' AND ISNULL(cancel_requested, 0) = 0
  ORDER BY created_at ASC
)
UPDATE analysis_runs
SET status = 'processing'
OUTPUT inserted.id INTO @claimed
WHERE id IN (SELECT id FROM run_to_claim);
```

### Step 3: Frame Extraction (FFmpeg)
```typescript
// backend/src/ffmpeg.ts
const FRAME_EXTRACTION_FPS = 2;           // Extract 2 frames per second
const KEYFRAME_DIFF_THRESHOLD = 0.15;     // 15% pixel difference = keyframe
const MIN_KEYFRAME_DISTANCE_MS = 500;     // Minimum 500ms between keyframes

// Extract all frames at 2 FPS
await execFile('ffmpeg', [
  '-y', '-i', videoPath,
  '-vf', `fps=${fps}`,
  `${framesDir}/frame_%04d.jpg`
]);

// Calculate pixel difference between consecutive frames
async function calculateFrameDiff(buffer1: Buffer, buffer2: Buffer): Promise<number> {
  // Resize both to 64x64 for fast comparison
  const img1 = await sharp(buffer1).resize(64, 64).raw().toBuffer();
  const img2 = await sharp(buffer2).resize(64, 64).raw().toBuffer();

  let diffPixels = 0;
  for (let i = 0; i < img1.length; i++) {
    if (Math.abs(img1[i] - img2[i]) > 30) diffPixels++;
  }
  return diffPixels / img1.length;  // Returns 0.0 - 1.0
}

// Mark as keyframe if:
// 1. First frame, OR
// 2. Diff score >= 15% AND >= 500ms since last keyframe
const isKeyframe = index === 0 ||
  (diffScore >= 0.15 && timeSinceLastKeyframe >= 500);
```

### Step 4: Frame Strip Generation
```typescript
// Combine keyframe + context frames into horizontal strip
// Gives AI temporal context for state changes
async function buildFrameStrip(buffers: Buffer[], targetHeight = 360) {
  const resized = await Promise.all(
    buffers.map(buf => sharp(buf).resize({ height: 360 }).jpeg().toBuffer())
  );

  // Composite horizontally: [prev_frame | keyframe | next_frame]
  return sharp({
    create: { width: totalWidth, height: 360, channels: 3, background: '#000' }
  })
    .composite(resized.map((data, i) => ({ input: data, left: offsetX[i], top: 0 })))
    .jpeg({ quality: 85 })
    .toBuffer();
}
```

### Step 5: GPT-4o Vision Analysis
```typescript
// backend/src/vision.ts
const response = await client.chat.completions.create({
  model: 'gpt-4o-vision',
  messages: [
    {
      role: 'system',
      content: 'You are a UX interaction-flow evaluator. Respond with ONLY valid JSON.'
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: VISION_MODEL_PROMPT + sequenceNote + priorContext },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${base64Image}`,
            detail: 'high'  // High detail for better analysis
          }
        }
      ]
    }
  ],
  max_tokens: 2000,
  temperature: 0.3,
  response_format: { type: 'json_object' }
});

// Response shape:
interface VisionResponse {
  rubric_scores: { cat1: 0|1|2, cat2: 0|1|2, ... cat7: 0|1|2 };
  justifications: { cat1: string, cat2: string, ... cat7: string };
  issue_tags: IssueTag[];
  suggestions: { severity: 'high'|'med'|'low', title: string, description: string }[];
}
```

### Step 6: Context Propagation
```typescript
// Each frame analysis includes context from previous frames
// This helps AI understand the flow, not just isolated screenshots

const contextTrail: string[] = [];

for (const keyframe of keyframes) {
  const analysis = await analyzeFrame(stripBuffer, {
    sequence: { count: 3, order: 'left-to-right oldest-to-newest', timestampsMs: [100, 500, 900] },
    priorContext: contextTrail.join('\n')  // "t=0ms: Button clicked. t=500ms: Spinner appeared..."
  });

  // Add summary to context trail for next frame
  contextTrail.push(`t=${frame.timestamp_ms}ms: ${analysis.justifications.cat1}. Issues: ${analysis.issue_tags.join(', ')}`);

  // Keep only last 5 summaries to avoid token bloat
  if (contextTrail.length > 5) contextTrail.shift();
}
```

### Step 7: Summary Aggregation
```typescript
// backend/src/summary.ts

// 1. Average scores across all keyframes
for (const category of ['cat1', 'cat2', ...]) {
  const avg = analyses.reduce((sum, a) => sum + a.rubric_scores[category], 0) / analyses.length;
  overallScores[category] = Math.round(avg);  // Round to 0, 1, or 2
}

// 2. Calculate weighted score (0-100)
const RUBRIC_WEIGHTS = { cat1: 20, cat2: 15, cat3: 15, cat4: 15, cat5: 20, cat6: 5, cat7: 10 };
let weightedScore = 0;
for (const [cat, weight] of Object.entries(RUBRIC_WEIGHTS)) {
  weightedScore += (overallScores[cat] / 2) * weight;  // Normalize 0-2 to 0-1, multiply by weight
}

// 3. Count critical issues
const criticalIssueCount = topIssues
  .filter(issue => issue.severity === 'high')
  .reduce((sum, issue) => sum + issue.count, 0);

// 4. Determine quality gate
function determineQualityGate(score: number, criticalCount: number) {
  if (criticalCount > 0 || score < 65) return 'block';
  if (score < 80) return 'warn';
  return 'pass';
}

// 5. Calculate confidence per category
function calculateConfidence(analyses: Analysis[], category: string) {
  const scores = analyses.map(a => a.rubric_scores[category]);
  const variance = calculateVariance(scores);
  const coverage = analyses.filter(a => a.justifications[category]?.trim()).length / analyses.length;
  return coverage * 0.6 + (1 - Math.sqrt(variance)) * 0.4;  // 0.0 - 1.0
}
```

---

## The Rubric (7 Categories)

| Category | Weight | What It Measures |
|----------|--------|------------------|
| **Action → Response Integrity** | 20% | Does every click produce immediate, clear feedback? |
| **Feedback & System Status** | 15% | Are loading states, progress, and system status visible? |
| **Interaction Predictability** | 15% | Do interactive elements look interactive? Are affordances clear? |
| **Flow Continuity & Friction** | 15% | Is there smooth progression? Any forced backtracking? |
| **Error Handling & Recovery** | 20% | Are errors visible with actionable recovery paths? |
| **Micro-interaction Quality** | 5% | Are transitions smooth? Is focus managed well? |
| **Efficiency & Interaction Cost** | 10% | Minimal steps? Smart defaults? No over-clicking? |

### Scoring Scale
- **2 (Good)**: Best practice met
- **1 (Fair)**: Acceptable with minor issues
- **0 (Poor)**: Significant UX problem

---

## Issue Detection

The AI flags specific issues using a controlled vocabulary:

### High Severity (Critical)
- `dead_click` — User clicks but nothing happens
- `silent_error` — Operation fails with no notification
- `blocking_error` — Error prevents progress, no solution given
- `unclear_disabled_state` — Can't tell what's clickable vs disabled

### Medium Severity
- `delayed_response` — >200ms delay without feedback
- `missing_spinner` — No loading indicator during waits
- `misleading_affordance` — Looks clickable but isn't (or vice versa)
- `backtracking` — User forced to repeat steps
- `no_progress_feedback` — Long operation with no progress indication

### Low Severity
- `jarring_transition` — Abrupt state changes
- `too_many_steps` — Excessive clicks for simple tasks
- `redundant_confirmations` — Unnecessary "Are you sure?" dialogs

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/runs` | Create run, get SAS upload URL |
| `GET` | `/api/runs` | List user's runs with summaries |
| `GET` | `/api/runs/[id]` | Get run details, keyframes, analysis |
| `GET` | `/api/runs/[id]/status` | Poll for processing status |
| `POST` | `/api/runs/[id]/enqueue` | Queue run for processing |
| `POST` | `/api/runs/[id]/cancel` | Request cancellation |
| `POST` | `/api/runs/[id]/retry` | Reset failed run to queued |
| `DELETE` | `/api/runs/[id]` | Delete run and all data |

---

## Key Files

```
flowsense/
├── frontend/
│   ├── src/app/api/runs/          # API routes
│   ├── src/components/ReportView.tsx  # Analysis report UI
│   ├── src/hooks/useUpload.ts     # Upload state management
│   └── src/lib/azure/
│       ├── db.ts                  # SQL queries
│       └── storage.ts             # Blob SAS generation
├── backend/
│   ├── src/index.ts               # Express server, webhook handler
│   ├── src/processor.ts           # Main processing pipeline
│   ├── src/ffmpeg.ts              # Video → frames extraction
│   ├── src/vision.ts              # GPT-4o Vision API calls
│   ├── src/summary.ts             # Score aggregation logic
│   ├── src/poller.ts              # Job queue polling
│   ├── src/azure-db.ts            # SQL connection pool
│   └── src/azure-storage.ts       # Blob download/upload
└── packages/shared/
    ├── src/constants.ts           # Rubric, weights, prompt
    ├── src/types.ts               # TypeScript interfaces
    ├── src/schemas.ts             # Zod validation schemas
    └── src/security.ts            # Webhook HMAC signing
```

---

## Configuration

### Frontend (.env.local)
```bash
APP_BASE_URL=http://localhost:3000
AUTH_SESSION_SECRET=<random-32-bytes>
AZURE_SQL_SERVER=your-server.database.windows.net
AZURE_SQL_DATABASE=your-database
AZURE_STORAGE_ACCOUNT_NAME=yourstorageaccount
AZURE_STORAGE_CONTAINER=videos
PROCESSOR_BASE_URL=http://localhost:3002
PROCESSOR_WEBHOOK_SECRET=<shared-secret>
```

### Backend (.env)
```bash
PORT=3002
WEBHOOK_SECRET=<shared-secret>
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=<api-key>
AZURE_OPENAI_DEPLOYMENT=gpt-4o-vision
AZURE_OPENAI_API_VERSION=2024-02-15-preview
AZURE_SQL_SERVER=your-server.database.windows.net
AZURE_SQL_DATABASE=your-database
AZURE_STORAGE_ACCOUNT_NAME=yourstorageaccount
AZURE_STORAGE_CONTAINER=videos
```

---

## Cost Breakdown (per analysis)

| Component | Usage | Cost |
|-----------|-------|------|
| GPT-4o Vision | ~8 images × 2000 tokens | ~$0.12-0.15 |
| Azure SQL | Queries | ~$0.001 |
| Blob Storage | 15MB stored + transfers | ~$0.001 |
| **Total** | | **~$0.15** |

Monthly baseline: ~$5-10 (SQL Basic + Storage)

---

## Local Development

```bash
# Prerequisites: Node.js 20+, FFmpeg, Azure CLI logged in

# Install dependencies
npm install

# Start both frontend and backend
npm run dev

# Frontend: http://localhost:3000
# Backend:  http://localhost:3002
```

---

## Quality Gate Logic

```
PASS  → Weighted score ≥ 80 AND no critical issues
WARN  → Weighted score 65-79 AND no critical issues
BLOCK → Weighted score < 65 OR any critical issues
```

---

## Data Flow Summary

```
1. User uploads video → Blob Storage (SAS URL)
2. Frontend calls /enqueue → Sets status = 'queued'
3. Backend poller claims job → Sets status = 'processing'
4. FFmpeg extracts frames → 2 FPS, identifies keyframes by diff
5. Frames uploaded → Blob Storage
6. Each keyframe → GPT-4o Vision → frame_analyses table
7. All analyses → Summary aggregation → run_summaries table
8. Status = 'completed' → Frontend polls and displays report
```
