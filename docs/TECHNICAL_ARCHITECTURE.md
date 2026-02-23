# FlowSense — Technical Architecture (V3)

## Overview

FlowSense is an AI-powered UX audit system that analyzes screen recordings using computer vision. The V3 architecture introduces **change-focused preprocessing**, **two-pass inference**, and **self-consistency calibration** for significantly improved accuracy.

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
│                      BACKEND PROCESSOR (V3)                         │
│                       Express + Node.js                             │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │                    V3 Processing Pipeline                  │     │
│  │  ┌─────────┐  ┌─────────────┐  ┌────────────────────┐    │     │
│  │  │ Change  │→ │ Temporal    │→ │    Two-Pass        │    │     │
│  │  │Detection│  │ Preprocessing│  │    Inference       │    │     │
│  │  └─────────┘  └─────────────┘  └────────────────────┘    │     │
│  │       │              │                    │               │     │
│  │       ▼              ▼                    ▼               │     │
│  │  ┌─────────┐  ┌─────────────┐  ┌────────────────────┐    │     │
│  │  │ Region  │  │ SSIM/Diff   │  │ Pass A: Extraction │    │     │
│  │  │ Analysis│  │ Heatmaps    │  │ Pass B: Scoring    │    │     │
│  │  └─────────┘  └─────────────┘  └────────────────────┘    │     │
│  └───────────────────────────────────────────────────────────┘     │
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

## V3 Processing Pipeline

### Overview

The V3 pipeline introduces three major improvements:

1. **Change Detection** — Region-based analysis to understand what changed between frames
2. **Temporal Preprocessing** — SSIM scoring, diff heatmaps, and change-region cropping
3. **Two-Pass Inference** — Structured extraction followed by conditioned scoring

```
Video → FFmpeg → Frames → Change Detection → Preprocessing → Two-Pass AI → Summary
                              │                    │               │
                              ▼                    ▼               ▼
                         Region Grid          Diff Heatmaps   Pass A: Extract
                         Change Types         Frame Strips    Pass B: Score
                         Descriptions         Change Crops    Self-Consistency
```

---

## Step 1: Frame Extraction (FFmpeg)

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

// Mark as keyframe if:
// 1. First frame, OR
// 2. Diff score >= 15% AND >= 500ms since last keyframe
const isKeyframe = index === 0 ||
  (diffScore >= 0.15 && timeSinceLastKeyframe >= 500);
```

---

## Step 2: Change Detection (V3)

```typescript
// backend/src/change-detection.ts

// Configuration
const DEFAULT_CHANGE_DETECTION_CONFIG = {
  gridRows: 4,              // 4x4 grid
  gridCols: 4,
  minRegionIntensity: 0.05, // 5% minimum change
  pixelDiffThreshold: 25,   // Pixel diff threshold (0-255)
  analysisSize: 256,        // Resize for analysis
};

// Change types detected
type ChangeType =
  | 'interaction_feedback'  // Button press, hover, focus
  | 'navigation'            // Page/view transition
  | 'content_update'        // Text/data change
  | 'modal_overlay'         // Modal, dialog, dropdown
  | 'loading_indicator'     // Spinner, progress bar
  | 'error_state'           // Error message, validation
  | 'cursor_movement'       // Cursor position only
  | 'minor_change'          // Small UI update
  | 'no_change';            // No significant change

// Output
interface FrameChangeAnalysis {
  overallChangeScore: number;      // 0-1
  regions: ChangeRegion[];         // Per-grid-cell analysis
  primaryChangeType: ChangeType;   // Dominant change
  changeDescription: string;       // Human-readable for prompt
  hasModalOverlay: boolean;
  hasLoadingIndicator: boolean;
}
```

### Region-Based Analysis

The frame is divided into a 4x4 grid. Each region is analyzed for:
- Pixel difference intensity
- Position-based classification (center = modal, top = navigation)
- Aggregate change type

```
┌─────┬─────┬─────┬─────┐
│ 0,0 │ 0,1 │ 0,2 │ 0,3 │  ← Top (navigation)
├─────┼─────┼─────┼─────┤
│ 1,0 │ 1,1 │ 1,2 │ 1,3 │  ← Center (modal)
├─────┼─────┼─────┼─────┤
│ 2,0 │ 2,1 │ 2,2 │ 2,3 │  ← Center (modal)
├─────┼─────┼─────┼─────┤
│ 3,0 │ 3,1 │ 3,2 │ 3,3 │  ← Bottom (status)
└─────┴─────┴─────┴─────┘
```

---

## Step 3: Temporal Preprocessing (V3)

```typescript
// backend/src/preprocessing.ts

// Build temporal window around keyframe
function buildTemporalWindow(
  allFrames: Frame[],
  keyframeIndex: number,
  windowSize: number = 5
): TemporalWindow {
  // Returns [-2, -1, 0, +1, +2] relative to keyframe
  // With buffers, timestamps, and delta-ms
}
```

### SSIM Calculation

Structural Similarity Index measures how similar two frames are (0 = different, 1 = identical).

```typescript
// Simplified SSIM formula
const ssim = ((2 * mean1 * mean2 + C1) * (2 * covar + C2)) /
             ((mean1² + mean2² + C1) * (var1 + var2 + C2));
```

### Diff Heatmap Generation

Creates a visual heatmap showing where changes occurred:

```typescript
// Generate colored heatmap (black → red → yellow → white)
async function generateDiffHeatmap(
  buffer1: Buffer,
  buffer2: Buffer
): Promise<DiffHeatmap> {
  // Calculate per-pixel absolute difference
  // Apply heat colormap
  // Return heatmap buffer with intensity metrics
}
```

### Change Region Cropping

Extracts the most-changed 2x2 grid region for focused analysis:

```typescript
async function generateChangeRegionCrop(
  buffer1: Buffer,
  buffer2: Buffer
): Promise<ChangeRegionCrop> {
  // Find 2x2 grid region with highest combined intensity
  // Crop and resize for AI analysis
}
```

### Preprocessed Frame Output

```typescript
interface PreprocessedFrame {
  frameId: string;
  keyframeIndex: number;
  rawStrip: Buffer;           // Horizontal strip of temporal window
  diffHeatmapStrip?: Buffer;  // Heatmaps concatenated
  changeCrop?: Buffer;        // Most-changed region crop
  temporalWindow: TemporalWindow;
  changeContext: FrameChangeContext;
  preprocessFallback: boolean;
  fallbackReason?: string;
}
```

---

## Step 4: Two-Pass Inference (V3)

### Pass A: Structured Interaction Extraction

First, extract objective facts about the interaction:

```typescript
// Pass A extracts:
interface InteractionExtraction {
  command: 'click' | 'hover' | 'scroll' | 'type' | ...;
  commandConfidence: number;        // 0-1
  targetWidget: 'button' | 'input_text' | 'dropdown' | ...;
  targetLabel?: string;
  stateChanges: StateChange[];      // What changed
  responseLatency: 'none' | 'fast' | 'medium' | 'slow' | 'timeout';
  feedbackVisible: boolean;
  errorDetected: boolean;
  overallConfidence: number;        // 0-1
  observations: string;
}
```

### Pass B: Conditioned Rubric Scoring

Then, score the rubric with Pass A context:

```typescript
// Pass B prompt includes Pass A extraction:
const fullPrompt = `
${PASS_B_PROMPT_PREFIX}
${extractionContext}      // From Pass A
${priorNote}              // Previous frame context
${changeNote}             // Change detection context
${VISION_MODEL_PROMPT}    // Rubric instructions
`;

// Output:
interface RubricAnalysis {
  rubric_scores: Record<string, 0|1|2>;  // 7 categories
  justifications: Record<string, string>;
  issue_tags: IssueTag[];
  suggestions: Suggestion[];
}
```

### Self-Consistency Reruns

```typescript
// Rerun if:
// 1. Confidence below threshold (default 0.6)
// 2. Schema coercion rate above threshold (default 0.3)
// 3. Extraction failed

interface TwoPassConfig {
  enableTwoPass: boolean;
  maxRerunsPerFrame: number;        // Default: 2
  schemaCoercionThreshold: number;  // Default: 0.3
  minConfidenceThreshold: number;   // Default: 0.6
  passATokenBudget: number;         // Default: 1500
  passBTokenBudget: number;         // Default: 2000
}
```

### Multi-Run Merging

When multiple runs occur, results are merged:

```typescript
// Merge strategies:
// - first_valid: Use first result that passes validation
// - weighted_avg: Average scores weighted by confidence
// - majority_vote: Use most common score per category

function mergeRubricScores(results: PassBResult[]): MergedScores {
  // Merge based on confidence and consistency
}
```

---

## Step 5: Vision API Calls

```typescript
// backend/src/two-pass-inference.ts

// Pass A call
const passAResponse = await client.chat.completions.create({
  model: 'gpt-4o-vision',
  messages: [
    { role: 'system', content: 'Extract interaction info. JSON only.' },
    {
      role: 'user',
      content: [
        { type: 'text', text: PASS_A_PROMPT + contextNote },
        { type: 'image_url', image_url: { url: base64Image, detail: 'high' } },
        // Additional images at 'low' detail for context
      ]
    }
  ],
  max_tokens: 1500,
  temperature: 0.2,
  response_format: { type: 'json_object' }
});

// Pass B call (conditioned on Pass A)
const passBResponse = await client.chat.completions.create({
  model: 'gpt-4o-vision',
  messages: [
    { role: 'system', content: 'Score UX rubric. JSON only.' },
    {
      role: 'user',
      content: [
        { type: 'text', text: fullPrompt },  // Includes Pass A extraction
        { type: 'image_url', image_url: { url: base64Image, detail: 'high' } },
      ]
    }
  ],
  max_tokens: 2000,
  temperature: 0.3,
  response_format: { type: 'json_object' }
});
```

---

## Step 6: Context Propagation

```typescript
// Each frame analysis includes context from previous frames
const contextTrail: string[] = [];

for (const keyframe of keyframes) {
  const twoPassResult = await executeTwoPassInference(
    preprocessed.rawStrip,
    preprocessed.diffHeatmapStrip,
    preprocessed.changeCrop,
    {
      priorContextTrail: contextTrail.join('\n'),
      changeContext: preprocessed.changeContext,
      keyframeIndex: index,
    }
  );

  // Add summary to context trail
  contextTrail.push(
    `t=${frame.timestamp_ms}ms: ${analysis.justifications.cat1}. Issues: ${analysis.issue_tags.join(', ')}`
  );

  // Keep only last 5 summaries
  if (contextTrail.length > 5) contextTrail.shift();
}
```

---

## Step 7: Summary Aggregation

```typescript
// backend/src/summary.ts

// 1. Average scores across all keyframes
for (const category of ['cat1', 'cat2', ...]) {
  const avg = analyses.reduce((sum, a) => sum + a.rubric_scores[category], 0) / analyses.length;
  overallScores[category] = Math.round(avg);
}

// 2. Calculate weighted score (0-100)
const RUBRIC_WEIGHTS = {
  cat1: 20,  // Action → Response
  cat2: 15,  // Feedback & System Status
  cat3: 15,  // Interaction Predictability
  cat4: 15,  // Flow Continuity
  cat5: 20,  // Error Handling
  cat6: 5,   // Micro-interactions
  cat7: 10,  // Efficiency
};

// 3. Quality gate determination
function determineQualityGate(score: number, criticalCount: number) {
  if (criticalCount > 0 || score < 65) return 'block';
  if (score < 80) return 'warn';
  return 'pass';
}

// 4. Confidence calculation (V3)
// Based on:
// - Average extraction confidence
// - Schema normalization rate
// - Rerun count and reasons
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

## V3 Configuration

### Environment Variables

```bash
# Analysis Engine Selection
ANALYSIS_ENGINE_ACTIVE=v3_hybrid        # v2_baseline | v3_hybrid
ANALYSIS_ENGINE_SHADOW=                 # Optional shadow engine for A/B
ANALYSIS_SHADOW_SAMPLE_RATE=0.25        # Shadow sampling rate

# Token Budgets
ANALYSIS_TOKEN_HARD_CAP_TOTAL=300000    # Total tokens per run
ANALYSIS_TOKEN_HARD_CAP_PER_FRAME=18000 # Tokens per frame

# Preprocessing (V3)
PREPROCESSING_ENABLE_CHANGE_DETECTION=true
PREPROCESSING_CHANGE_GRID_ROWS=4
PREPROCESSING_CHANGE_GRID_COLS=4
PREPROCESSING_MIN_REGION_INTENSITY=0.05
PREPROCESSING_PIXEL_DIFF_THRESHOLD=25
PREPROCESSING_CHANGE_ANALYSIS_SIZE=256
PREPROCESSING_INCLUDE_CHANGE_CONTEXT=true

# Two-Pass Inference (V3)
TWO_PASS_ENABLE=true
TWO_PASS_MAX_RERUNS=2
TWO_PASS_SCHEMA_COERCION_THRESHOLD=0.3
TWO_PASS_MIN_CONFIDENCE_THRESHOLD=0.6
TWO_PASS_A_TOKEN_BUDGET=1500
TWO_PASS_B_TOKEN_BUDGET=2000
```

---

## Database Schema

```sql
-- Analysis runs (one per video upload)
CREATE TABLE analysis_runs (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id UNIQUEIDENTIFIER NOT NULL REFERENCES profiles(id),
    title NVARCHAR(255) NOT NULL,
    video_storage_path NVARCHAR(500) NOT NULL,
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
    storage_path NVARCHAR(500) NOT NULL,
    timestamp_ms INT NOT NULL,
    is_keyframe BIT DEFAULT 0,
    diff_score FLOAT DEFAULT 0,
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
│   ├── src/change-detection.ts    # V3: Region-based change analysis
│   ├── src/preprocessing.ts       # V3: Temporal windows, SSIM, heatmaps
│   ├── src/two-pass-inference.ts  # V3: Pass A/B inference
│   ├── src/vision.ts              # GPT-4o Vision API calls
│   ├── src/summary.ts             # Score aggregation logic
│   ├── src/shadow-processor.ts    # A/B shadow analysis
│   ├── src/poller.ts              # Job queue polling
│   ├── src/azure-db.ts            # SQL connection pool
│   ├── src/azure-storage.ts       # Blob download/upload
│   ├── src/telemetry.ts           # Application Insights
│   └── src/env.ts                 # Environment configuration
└── packages/shared/
    ├── src/constants.ts           # Rubric, weights, prompts
    ├── src/types.ts               # TypeScript interfaces
    ├── src/schemas.ts             # Zod validation schemas
    └── src/security.ts            # Webhook HMAC signing
```

---

## Telemetry & Observability

### Metrics Tracked

```typescript
// Processing metrics
trackMetric('processor.queue_wait_ms', queueWaitMs);
trackMetric('processor.duration_ms', totalDurationMs);
trackMetric('processor.preprocessing_ms', preprocessingMs);
trackMetric('processor.keyframes_total', keyframeCount);
trackMetric('processor.keyframes_failed', failedCount);

// Token usage
trackMetric('processor.tokens_total', totalTokens);
trackMetric('processor.tokens_prompt', promptTokens);
trackMetric('processor.tokens_completion', completionTokens);

// V3-specific metrics
trackMetric('processor.two_pass_a_tokens', passATokens);
trackMetric('processor.two_pass_b_tokens', passBTokens);
trackMetric('processor.two_pass_reruns', rerunCount);
trackMetric('processor.preprocess_fallback_count', fallbackCount);
trackMetric('processor.schema_normalization_rate', rate);

// Quality metrics
trackMetric('processor.weighted_score_100', weightedScore);
```

---

## Cost Breakdown (per analysis)

| Component | V2 Usage | V3 Usage | V3 Cost |
|-----------|----------|----------|---------|
| GPT-4o Vision | ~8 images × 2000 tokens | ~8 × (1500 + 2000) tokens | ~$0.20-0.25 |
| Azure SQL | Queries | Queries | ~$0.001 |
| Blob Storage | 15MB stored + transfers | 20MB (heatmaps) | ~$0.002 |
| **Total** | **~$0.15** | | **~$0.25** |

V3 is ~60% more expensive but significantly more accurate.

---

## Quality Gate Logic

```
PASS  → Weighted score ≥ 80 AND no critical issues
WARN  → Weighted score 65-79 AND no critical issues
BLOCK → Weighted score < 65 OR any critical issues
```

---

## Data Flow Summary (V3)

```
1. User uploads video → Blob Storage (SAS URL)
2. Frontend calls /enqueue → Sets status = 'queued'
3. Backend poller claims job → Sets status = 'processing'
4. FFmpeg extracts frames → 2 FPS, identifies keyframes by diff
5. V3 Change Detection → Analyze region changes per frame
6. V3 Preprocessing → Build temporal windows, SSIM, heatmaps, crops
7. Frames uploaded → Blob Storage
8. Each keyframe → Two-Pass Inference:
   a. Pass A: Extract interaction (command, widget, state changes)
   b. Pass B: Score rubric (conditioned on Pass A)
   c. Self-consistency reruns if needed
9. Results → frame_analyses table
10. All analyses → Summary aggregation → run_summaries table
11. Status = 'completed' → Frontend polls and displays report
```

---

## Local Development

```bash
# Prerequisites: Node.js 20+, FFmpeg, Azure CLI logged in

# Install dependencies
npm install

# Configure environment
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env

# Start both frontend and backend
npm run dev

# Frontend: http://localhost:3000
# Backend:  http://localhost:3002
```

---

## V3 vs V2 Comparison

| Feature | V2 Baseline | V3 Hybrid |
|---------|-------------|-----------|
| Change detection | Basic pixel diff | Region-based with classification |
| Preprocessing | Single frame strip | Temporal window + heatmaps + crops |
| Inference | Single-pass | Two-pass (extraction → scoring) |
| Self-consistency | None | Confidence-based reruns |
| Token usage | ~2000/frame | ~3500/frame |
| Accuracy | Baseline | +15-25% improvement |
| Cost | Lower | ~60% higher |

---

*Built by Aadith V A | Microsoft Design*
