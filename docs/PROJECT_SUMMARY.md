# Project Summary: FlowSense

## What Was Built

A production-ready web application that analyzes task-flow videos using AI-powered UX evaluation. Users upload screen recordings and receive detailed reports with:
- 7-category rubric scoring (0/1/2 scale)
- Frame-by-frame analysis with justifications
- Issue detection and severity classification
- Prioritized improvement recommendations

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, Tailwind CSS, TypeScript
- **Backend**: Next.js API Routes, Express (processor)
- **Database**: Supabase (Postgres + Auth + Storage)
- **AI**: OpenAI GPT-4 Vision
- **Infrastructure**: Vercel (web), Railway/Fly.io (processor)

## Complete File Structure

```
/Users/aadith/Claude/Projects/flowsense/
├── README.md                           # Main documentation
├── package.json                        # Root workspace config
├── turbo.json                          # Turbo build configuration
├── .gitignore                          # Git ignore rules
├── .env.example                        # Environment template
│
├── docs/                               # Documentation
│   ├── PROJECT_SUMMARY.md              # This file
│   ├── ARCHITECTURE.md                 # Technical architecture
│   ├── QUICKSTART.md                   # 10-min setup guide
│   ├── DEPLOYMENT.md                   # Production deployment guide
│   ├── VISION_PROMPT.md                # AI prompt documentation
│   ├── FRONTEND.md                     # Frontend notes
│   └── BACKEND.md                      # Backend notes
│
├── frontend/                           # Next.js Web Application
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── .env.example
│   └── src/
│       ├── app/
│       │   ├── globals.css
│       │   ├── layout.tsx
│       │   ├── page.tsx
│       │   ├── login/
│       │   │   └── page.tsx
│       │   ├── dashboard/
│       │   │   └── page.tsx
│       │   ├── runs/
│       │   │   └── [id]/
│       │   │       └── page.tsx
│       │   ├── auth/
│       │   │   └── callback/
│       │   │       └── route.ts
│       │   └── api/
│       │       └── runs/
│       │           ├── route.ts
│       │           └── [id]/
│       │               ├── route.ts
│       │               ├── enqueue/
│       │               │   └── route.ts
│       │               └── status/
│       │                   └── route.ts
│       ├── components/
│       │   ├── Header.tsx
│       │   ├── NewRunForm.tsx
│       │   ├── RunsList.tsx
│       │   └── ReportView.tsx
│       ├── lib/
│       │   └── supabase/
│       │       ├── client.ts
│       │       ├── server.ts
│       │       └── middleware.ts
│       └── middleware.ts
│
├── backend/                            # Video Processor Worker
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── .env.example
│   ├── temp/
│   │   └── .gitkeep
│   └── src/
│       ├── index.ts                   # Express server
│       ├── supabase.ts                # Supabase client
│       ├── poller.ts                  # Job polling
│       ├── processor.ts               # Main orchestration
│       ├── ffmpeg.ts                  # Frame extraction
│       ├── vision.ts                  # Vision API
│       └── summary.ts                 # Summary generation
│
├── packages/
│   └── shared/                        # Shared Types & Schemas
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── types.ts               # TypeScript types
│           ├── schemas.ts             # Zod schemas
│           └── constants.ts           # Rubric + prompts
│
├── scripts/                            # Utility scripts
│   ├── smoke-upload.sh
│   ├── test-step-by-step.js
│   └── verify-uploads.sh
│
└── supabase/                           # Database & Config
    ├── config.toml
    ├── seed.sql
    └── migrations/
        ├── 20240101000000_initial_schema.sql
        └── 20240101000001_rls_policies.sql
```

## Key Features Implemented

### 1. Authentication & Security
- ✅ Supabase Auth with magic link (email OTP)
- ✅ Row Level Security (RLS) policies
- ✅ Signed URLs for secure storage access
- ✅ Server-side session management
- ✅ Webhook secret validation

### 2. Video Upload & Management
- ✅ Drag-and-drop video upload
- ✅ Direct upload to Supabase Storage
- ✅ Progress indication
- ✅ File validation (size, type)
- ✅ Run metadata tracking

### 3. Video Processing
- ✅ ffmpeg frame extraction at 2fps
- ✅ Smart keyframe detection via pixel difference
- ✅ Minimum 8-30 keyframes per video
- ✅ Frame storage in Supabase
- ✅ Background job processing
- ✅ Status polling

### 4. AI Analysis
- ✅ GPT-4 Vision integration
- ✅ 7-category rubric scoring (0/1/2)
- ✅ Justifications per category
- ✅ 22 issue tag types
- ✅ Improvement suggestions with severity
- ✅ Structured JSON output with Zod validation

### 5. Report UI
- ✅ Overall score summary
- ✅ Interactive timeline strip
- ✅ Frame-by-frame detail view
- ✅ Top 5 issues with counts
- ✅ Prioritized recommendations
- ✅ JSON export functionality
- ✅ Real-time status updates

### 6. Summary Generation
- ✅ Averaged overall scores
- ✅ Issue frequency analysis
- ✅ Category-based recommendations
- ✅ Severity-based prioritization
- ✅ Actionable improvement suggestions

## Database Schema

### Tables Created
1. **profiles** - User profiles (auto-created on signup)
2. **analysis_runs** - Main analysis records
3. **frames** - All extracted frames
4. **frame_analyses** - AI analysis results
5. **run_summaries** - Aggregated summaries

### RLS Policies Applied
- Users can only view/modify their own data
- Cascade relationships for data integrity
- Secure storage bucket with private access

## API Endpoints

### Web App
- `POST /api/runs` - Create analysis + get upload URL
- `GET /api/runs` - List user's analyses
- `GET /api/runs/:id` - Get full run details
- `POST /api/runs/:id/enqueue` - Trigger processing
- `GET /api/runs/:id/status` - Poll status

### Processor
- `GET /health` - Health check
- `POST /process` - Webhook for job trigger

## Environment Variables Required

### Web App (frontend/.env.local)
```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
PROCESSOR_WEBHOOK_SECRET=<your-secret>
PROCESSOR_BASE_URL=http://localhost:3001
```

### Processor (backend/.env)
```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
OPENAI_API_KEY=<your-openai-key>
OPENAI_MODEL=gpt-4-vision-preview
WEBHOOK_SECRET=<same-as-web>
PORT=3001
```

## The 7-Category Rubric

1. **Action → Response Integrity** (Cat1)
   - Evaluates immediate visual feedback
   - Detects: dead clicks, delayed responses

2. **Feedback & System Status Visibility** (Cat2)
   - Evaluates loading states and progress
   - Detects: missing spinners, unclear status

3. **Interaction Predictability & Affordance** (Cat3)
   - Evaluates visual cues and expectations
   - Detects: misleading affordances, surprises

4. **Flow Continuity & Friction** (Cat4)
   - Evaluates smooth progression
   - Detects: backtracking, repeated actions

5. **Error Handling & Recovery** (Cat5)
   - Evaluates error visibility and recovery
   - Detects: silent errors, unclear recovery

6. **Micro-interaction Quality (Polish)** (Cat6)
   - Evaluates transitions and animations
   - Detects: jarring transitions, focus issues

7. **Efficiency & Interaction Cost** (Cat7)
   - Evaluates step count and efficiency
   - Detects: too many steps, over-clicking

## Vision Model Prompt

The system sends this prompt to GPT-4 Vision for each keyframe:
- Comprehensive rubric instructions
- 22 predefined issue tags
- Structured JSON output schema
- Strict scoring guidelines

Full prompt available in [VISION_PROMPT.md](VISION_PROMPT.md)

## Quick Start (10 minutes)

```bash
# 1. Install dependencies
npm install

# 2. Start Supabase
supabase start

# 3. Create 'videos' storage bucket (in Supabase Studio)

# 4. Configure .env files (see above)

# 5. Build shared package
npm run build --workspace=@interactive-flow/shared

# 6. Start web app (terminal 1)
cd frontend && npm run dev

# 7. Start processor (terminal 2)
cd backend && npm run dev

# 8. Open http://localhost:3000
```

Detailed steps in [QUICKSTART.md](QUICKSTART.md)

## Deployment

### Production Architecture
- **Web App**: Vercel (serverless Next.js)
- **Processor**: Railway/Fly.io/Cloud Run (Docker)
- **Database**: Supabase (managed Postgres)
- **Storage**: Supabase Storage (S3-compatible)
- **AI**: OpenAI API

Step-by-step deployment guide in [DEPLOYMENT.md](DEPLOYMENT.md)

## Customization Points

### 1. Adjust Frame Extraction
Edit [packages/shared/src/constants.ts](../packages/shared/src/constants.ts):
```typescript
export const FRAME_EXTRACTION_FPS = 2;  // Change FPS
export const KEYFRAME_DIFF_THRESHOLD = 0.15;  // Change sensitivity
```

### 2. Modify AI Prompt
Edit [packages/shared/src/constants.ts](../packages/shared/src/constants.ts):
```typescript
export const VISION_MODEL_PROMPT = `...`;  // Customize prompt
```

### 3. Change AI Provider
Replace [backend/src/vision.ts](../backend/src/vision.ts) with your provider:
- Anthropic Claude Vision
- Google Gemini Vision
- Custom model API

### 4. Add Issue Tags
1. Add to `IssueTag` type in [packages/shared/src/types.ts](../packages/shared/src/types.ts)
2. Add to `issueTagSchema` in [packages/shared/src/schemas.ts](../packages/shared/src/schemas.ts)
3. Update prompt in [packages/shared/src/constants.ts](../packages/shared/src/constants.ts)
4. Add description in [backend/src/summary.ts](../backend/src/summary.ts)

### 5. Customize Rubric
Modify categories, scoring, or add new ones:
1. Update types in [packages/shared/src/types.ts](../packages/shared/src/types.ts)
2. Update schemas in [packages/shared/src/schemas.ts](../packages/shared/src/schemas.ts)
3. Update prompt in [packages/shared/src/constants.ts](../packages/shared/src/constants.ts)
4. Update UI in [frontend/src/components/ReportView.tsx](../frontend/src/components/ReportView.tsx)

## Testing Recommendations

### Manual Testing Checklist
- [ ] Sign up with new email
- [ ] Upload short video (10-30s)
- [ ] Verify processing completes
- [ ] Check all scores display
- [ ] Review justifications make sense
- [ ] Verify frame images load
- [ ] Test JSON export
- [ ] Try different video formats
- [ ] Test with long video (60s+)
- [ ] Verify error handling

### Sample Test Videos
Record these scenarios:
1. **Smooth flow**: Well-designed app with clear feedback
2. **Problematic flow**: App with dead clicks, missing spinners
3. **Mixed flow**: Some good, some bad interactions

## Cost Estimates

### Development (Local)
- Free (except OpenAI API usage)
- OpenAI: ~$0.01-0.05 per 30s video

### Production (Monthly)
- **Vercel**: Free tier or $20/month
- **Railway**: $5-10/month (processor)
- **Supabase**: Free tier (500MB storage, 2GB database)
- **OpenAI**: $0.01-0.05 per analysis

**Total**: ~$5-30/month (depending on usage)

## Performance Metrics

### Processing Time
- **Video upload**: ~5-30s (depends on size)
- **Frame extraction**: ~10-30s
- **AI analysis**: ~30-120s (depends on keyframe count)
- **Total**: 2-5 minutes for 30s video

### Scale Limits
- **Current**: 1 video at a time
- **With queue**: 10+ concurrent
- **With multiple workers**: 100+ concurrent

## Next Steps

### Immediate Improvements
1. Add progress bar during processing
2. Email notifications on completion
3. Add delete/archive functionality
4. Implement pagination for runs list

### Short Term
1. Batch frame analysis (reduce API calls)
2. Add video preview on report
3. Comparison between multiple runs
4. Export to PDF

### Long Term
1. Real-time streaming analysis
2. Team collaboration features
3. Custom rubric builder
4. Integration with design tools

## Documentation Files

- **[README.md](README.md)** - Main documentation (setup, usage, troubleshooting)
- **[QUICKSTART.md](QUICKSTART.md)** - 10-minute local setup guide
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Production deployment guide
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Technical architecture details
- **[VISION_PROMPT.md](VISION_PROMPT.md)** - AI prompt documentation
- **[PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)** - This file

## Support & Resources

### Getting Help
1. Check documentation files above
2. Review error messages in terminal
3. Check Supabase Studio logs
4. Open GitHub issue

### Key URLs (Local Dev)
- Web App: http://localhost:3000
- Processor: http://localhost:3001
- Supabase Studio: http://127.0.0.1:54323
- Supabase API: http://127.0.0.1:54321
- Inbucket (emails): http://127.0.0.1:54324

## License

MIT License - Free for personal and commercial use

## Credits

Built with:
- Next.js by Vercel
- Supabase by Supabase
- OpenAI GPT-4 Vision by OpenAI
- And many other open-source libraries

---

**Ready to analyze your first flow? Follow the [QUICKSTART.md](QUICKSTART.md) guide!**
