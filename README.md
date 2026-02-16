# FlowSense

An open-source web application that analyzes task-flow screen recordings with AI-powered UX evaluation. Upload a video and get detailed insights on interaction quality, usability issues, and improvement recommendations - **100% local, no cloud API costs**.

## 🎯 Features

- **📹 Video Upload**: Drag & drop screen recordings (MP4, MOV, MKV up to 500MB)
- **🎬 Frame Extraction**: Automatic keyframe detection at 2 FPS using ffmpeg
- **🤖 AI Analysis**: Llama 3.2 Vision (11B) evaluates each frame against 7 UX rubric categories
- **📊 Real-time Progress**: Live progress bar shows processing status
- **📈 Interactive Reports**: Timeline view with scores, justifications, and recommendations
- **🎨 Dark Theme**: Clean, minimal black UI
- **🔒 Privacy-First**: Everything runs locally - videos never leave your machine
- **💰 Zero Cost**: No API fees, completely open-source

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                    │
│              http://localhost:3000 (Dark Theme)              │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                   Processor (Node.js + Express)              │
│                     http://localhost:3001                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   ffmpeg     │  │    Ollama    │  │   Supabase   │      │
│  │ Frame Extract│  │ Llama Vision │  │   Storage    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│               Supabase (Local via OrbStack)                  │
│                  http://127.0.0.1:54321                      │
│         PostgreSQL + Storage + Real-time subscriptions       │
└─────────────────────────────────────────────────────────────┘
```

**Key Technologies:**
- **Frontend**: Next.js 14, React, TailwindCSS (dark theme)
- **Backend**: Node.js, Express, ffmpeg
- **AI**: Ollama + Llama 3.2 Vision 11B (open-source, runs locally)
- **Database**: Supabase (PostgreSQL + Storage)
- **Container**: OrbStack (Docker alternative for Mac)

## 📋 UX Rubric Categories (0/1/2 scoring)

1. **Action → Response Integrity**: Do user actions get immediate, clear responses?
2. **Feedback & System Status Visibility**: Is the user always informed about what's happening?
3. **Interaction Predictability & Affordance**: Are interactive elements clear and behave as expected?
4. **Flow Continuity & Friction**: Can users complete tasks smoothly without backtracking?
5. **Error Handling & Recovery**: Are errors clearly communicated with recovery paths?
6. **Micro-interaction Quality (Polish)**: Are transitions smooth and focus management clear?
7. **Efficiency & Interaction Cost**: Can users complete tasks with minimal clicks and effort?

## 🚀 Quick Start (5 minutes)

### Prerequisites

- **macOS** (tested on macOS Sonoma+)
- **Homebrew** installed
- **Node.js 18+** (`node --version`)
- **OrbStack or Docker** (for Supabase)

### Installation

```bash
# 1. Clone the repository
cd "/Users/yourusername/Projects"
git clone https://github.com/yourusername/flowsense
cd flowsense

# 2. Install dependencies
npm install

# 3. Install system dependencies
brew install ffmpeg supabase/tap/supabase ollama

# 4. Start Ollama service and pull vision model (7.8 GB download)
brew services start ollama
ollama pull llama3.2-vision:11b

# 5. Start Supabase (via OrbStack/Docker)
supabase start

# 6. Create storage bucket
curl -X POST 'http://127.0.0.1:54321/storage/v1/bucket' \
  -H "Authorization: Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjA4NDQzMzMyMH0.DCUugYwr9IKz9H8M8oYH4QnB_mWgkmsHNZbo7fQe87RAIpm53U3NGlBh9dXhPsdiW79WDobh61mbyHxm0MbyiA" \
  -H "Content-Type: application/json" \
  -d '{"id":"videos","name":"videos","public":true}'

# 7. Configure environment variables (already set up in .env files)
# backend/.env - Already configured for local Ollama
# frontend/.env.local - Already configured for local Supabase

# 8. Start development servers (in separate terminals)
# Terminal 1 - Web App
cd frontend && npm run dev

# Terminal 2 - Processor
cd backend && npm run dev

# 9. Open your browser
open http://localhost:3000
```

## 🧪 Step-by-Step Testing

Test each component independently before running the full pipeline:

```bash
# Test upload → frames → Ollama on a single video
node scripts/test-step-by-step.js /path/to/your/video.mp4
```

**What it tests:**
1. ✅ Video file upload to Supabase Storage
2. ✅ Frame extraction with ffmpeg (2 FPS)
3. ✅ Ollama Vision model response time
4. ✅ UX rubric analysis with JSON parsing
5. ✅ Summary generation

**Example output:**
```
============================================================
[STEP 1] Video File Selection
✅ Video file found: recording.mp4
   Size: 12.45 MB

[STEP 2] Upload to Supabase Storage
✅ Video uploaded successfully
   Storage path: test-uploads/test-1234567890.mp4

[STEP 3] Extract Frames with ffmpeg
✅ Extracted 24 frames
   Sample frames:
   1. frame_0001.jpg (42.3 KB)
   2. frame_0002.jpg (41.8 KB)
   ...

[STEP 4] Test Ollama Vision Model
✅ Ollama analysis successful
   Duration: 3.2 seconds
   Response: "This screenshot shows a web application..."

[STEP 5] Test UX Analysis with Rubric
✅ UX analysis successful
   Duration: 12.5 seconds
   Parsed scores:
     cat1: 2/2
     cat2: 1/2
     cat3: 2/2
     ...
============================================================
```

## 🔍 Verify System Status

Check all services are running:

```bash
./scripts/verify-uploads.sh
```

**Output:**
```
===================================
FlowSense - Status
===================================

1. Services Status:
   ✓ Web app running on http://localhost:3000
   ✓ Processor running on http://localhost:3001
   ✓ Supabase running on http://127.0.0.1:54321

2. Database Status:
   Anonymous user: 1 profile(s)
   Analysis runs: 3

3. Storage Status:
   ✓ Videos bucket exists
   Files in storage: 8

===================================
Open http://localhost:3000 to test
===================================
```

## 📖 Usage

### 1. Upload a Video

1. Go to **http://localhost:3000**
2. Enter analysis title (e.g., "Login Flow - v1")
3. Select video file (MP4, MOV, MKV)
4. Click "Start Analysis"

### 2. Watch Progress

Real-time progress bar shows:
- 10%: Downloading video
- 20%: Extracting frames
- 40%: Uploading frames
- 60-90%: Analyzing keyframes with AI (updates per frame)
- 90%: Generating summary
- 100%: Complete!

### 3. View Results

- Click on completed analysis card
- See timeline with all keyframes
- Review rubric scores (0-2 for each category)
- Read AI justifications and suggestions
- Export JSON data

## 🗂️ Project Structure

```
flowsense/
├── docs/                         # Documentation
│   ├── PROJECT_SUMMARY.md
│   ├── ARCHITECTURE.md
│   ├── QUICKSTART.md
│   ├── DEPLOYMENT.md
│   ├── VISION_PROMPT.md
│   ├── FRONTEND.md
│   └── BACKEND.md
├── frontend/                     # Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── dashboard/         # Main dashboard
│   │   │   ├── runs/[id]/         # Analysis detail view
│   │   │   └── api/               # API routes
│   │   ├── components/
│   │   │   ├── RunsList.tsx       # Analysis list with progress
│   │   │   └── NewRunForm.tsx     # Upload form
│   │   └── lib/
│   └── .env.local
├── backend/                       # Node.js processor
│   ├── src/
│   │   ├── index.ts               # Express server
│   │   ├── processor.ts           # Main pipeline logic
│   │   ├── ffmpeg.ts              # Frame extraction
│   │   ├── vision.ts              # Ollama integration
│   │   ├── summary.ts             # Summary generation
│   │   └── supabase.ts            # DB client
│   └── .env
├── packages/
│   └── shared/                   # Shared types & constants
│       └── src/
│           ├── types.ts          # TypeScript interfaces
│           ├── schemas.ts        # Zod validation
│           └── constants.ts      # Rubric prompts, FPS, etc.
├── supabase/
│   ├── migrations/               # Database migrations
│   │   ├── 20240101000000_initial_schema.sql
│   │   ├── 20240101000003_public_access.sql
│   │   ├── 20240101000004_add_progress_tracking.sql
│   │   └── 20240101000005_remove_auth_constraints.sql
│   └── config.toml
├── scripts/                      # Utility scripts
│   ├── test-step-by-step.js
│   ├── verify-uploads.sh
│   └── smoke-upload.sh
└── README.md
```

## 🛠️ Configuration

### Frame Extraction Settings

Edit `packages/shared/src/constants.ts`:

```typescript
export const FRAME_EXTRACTION_FPS = 2;           // Frames per second
export const KEYFRAME_DIFF_THRESHOLD = 0.15;     // 15% pixel difference
export const MIN_KEYFRAME_DISTANCE_MS = 500;     // Min 500ms between keyframes
```

### Vision Model Settings

Edit `backend/.env`:

```env
OLLAMA_URL=http://localhost:11434
VISION_MODEL=llama3.2-vision:11b    # Or try llama3.2-vision:90b for better quality
```

### Rubric Prompt Customization

Edit `packages/shared/src/constants.ts` → `VISION_MODEL_PROMPT` to customize evaluation criteria.

## 🐛 Troubleshooting

### Video Upload Fails

```bash
# Check if storage bucket exists
curl -s http://127.0.0.1:54321/storage/v1/bucket/videos \
  -H "Authorization: Bearer <service-key>"

# Recreate bucket if needed
curl -X POST http://127.0.0.1:54321/storage/v1/bucket \
  -H "Authorization: Bearer <service-key>" \
  -d '{"id":"videos","name":"videos","public":true}'
```

### ffmpeg Not Found

```bash
# Install ffmpeg
brew install ffmpeg

# Verify installation
/opt/homebrew/bin/ffmpeg -version
```

### Ollama Not Working

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama
brew services start ollama

# Pull vision model
ollama pull llama3.2-vision:11b

# Test Ollama directly
ollama run llama3.2-vision:11b "Describe this image"
```

### Database Schema Issues

```bash
# Reset database and reapply migrations
cd supabase
supabase db reset
```

### Processor Logs

```bash
# View real-time processor logs
tail -f /private/tmp/claude/-Users-aadith-Claude-Projects-flowsense/tasks/<task-id>.output
```

## 📊 Performance

**Typical Analysis Times (30-second video):**
- Frame extraction: 5-10 seconds
- Frame upload: 10-15 seconds
- AI analysis (9 keyframes): 60-90 seconds total (~7-10 seconds per frame)
- Summary generation: 1-2 seconds

**Total: ~90-120 seconds per video**

**Resource Usage:**
- Ollama (Llama 3.2 Vision 11B): ~8 GB RAM, ~40% CPU during analysis
- Processor: ~200 MB RAM, ~10% CPU
- Web app: ~150 MB RAM

## 💡 Tips

1. **Use shorter videos** (10-30 seconds) for faster testing
2. **Record at lower resolution** (720p) to reduce processing time
3. **Focus on key interactions** - trim videos to just the task flow
4. **Restart Ollama** if responses become slow: `brew services restart ollama`
5. **Monitor progress** in real-time via the dashboard progress bar

## 🔮 Future Enhancements

- [ ] Compare multiple videos side-by-side
- [ ] Export PDF reports with screenshots
- [ ] Custom rubric categories
- [ ] A/B testing mode
- [ ] Shareable report links
- [ ] Video trimming before analysis
- [ ] Heatmap visualization of issues

## 📄 License

MIT License - see LICENSE file for details

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Test thoroughly using `scripts/test-step-by-step.js`
4. Submit a pull request

## 💬 Support

- **Issues**: Open an issue on GitHub
- **Questions**: Start a discussion
- **Documentation**: Check the `docs/` folder

---

**Built with ❤️ using open-source tools**

No cloud APIs • No subscriptions • No data collection • 100% local
