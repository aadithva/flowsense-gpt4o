# Architecture Documentation

Detailed technical architecture of the FlowSense.

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        User Browser                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         Next.js App (Vercel)                        │   │
│  │  • Auth UI                                          │   │
│  │  • Video Upload                                     │   │
│  │  • Dashboard & Reports                              │   │
│  │  • API Routes                                       │   │
│  └────────┬─────────────────┬──────────────────────────┘   │
└───────────┼─────────────────┼──────────────────────────────┘
            │                 │
            │                 │
    ┌───────▼─────────┐   ┌──▼───────────────────────────┐
    │   Supabase      │   │  Processor Worker            │
    │                 │   │  (Railway/Fly.io/Cloud Run)  │
    │  • Auth         │   │                              │
    │  • Postgres DB  │◄──┤  • ffmpeg extraction         │
    │  • Storage      │   │  • OpenAI Vision analysis    │
    │                 │   │  • Summary generation        │
    └─────────────────┘   └──────────────┬───────────────┘
                                         │
                                         │
                                  ┌──────▼──────┐
                                  │  OpenAI API │
                                  │  (Vision)   │
                                  └─────────────┘
```

## Data Flow

### 1. Upload Flow

```
User uploads video
     │
     ├─► POST /api/runs (create record)
     │
     ├─► Get signed upload URL
     │
     ├─► Upload to Supabase Storage
     │
     ├─► POST /api/runs/:id/enqueue
     │
     └─► Webhook to Processor OR Processor polls DB
```

### 2. Processing Flow

```
Processor receives job
     │
     ├─► Update status to "processing"
     │
     ├─► Download video from Storage
     │
     ├─► ffmpeg: Extract frames at 2fps
     │
     ├─► Calculate frame differences
     │
     ├─► Select keyframes (8-30)
     │
     ├─► Upload frames to Storage
     │
     ├─► For each keyframe:
     │   ├─► Send to OpenAI Vision
     │   ├─► Parse JSON response
     │   ├─► Validate with Zod
     │   └─► Save to frame_analyses
     │
     ├─► Generate summary:
     │   ├─► Average scores
     │   ├─► Count issue tags
     │   ├─► Generate recommendations
     │   └─► Save to run_summaries
     │
     └─► Update status to "completed"
```

### 3. View Flow

```
User views report
     │
     ├─► GET /api/runs/:id
     │   ├─► Fetch run record
     │   ├─► Fetch summary
     │   ├─► Fetch keyframes + analyses
     │   └─► Generate signed URLs
     │
     └─► Render interactive report
         ├─► Overall scores
         ├─► Timeline strip
         ├─► Frame detail with scores
         ├─► Top issues
         └─► Recommendations
```

## Database Schema

### Entity Relationship Diagram

```
┌─────────────┐
│  profiles   │
│─────────────│
│ id (PK)     │─┐
│ full_name   │ │
│ created_at  │ │
└─────────────┘ │
                │
         ┌──────▼────────────┐
         │  analysis_runs    │
         │───────────────────│
         │ id (PK)           │─┐
         │ user_id (FK)      │ │
         │ title             │ │
         │ video_storage_path│ │
         │ status            │ │
         │ error_message     │ │
         │ created_at        │ │
         │ updated_at        │ │
         └───────────────────┘ │
                               │
                  ┌────────────┼────────────────┐
                  │            │                │
         ┌────────▼─────┐  ┌──▼───────────┐    │
         │   frames     │  │run_summaries │    │
         │──────────────│  │──────────────│    │
         │ id (PK)      │─┐│ run_id (PK)  │    │
         │ run_id (FK)  │ ││ overall_scores│   │
         │ storage_path │ ││ top_issues   │    │
         │ timestamp_ms │ ││recommendations│   │
         │ is_keyframe  │ ││ created_at   │    │
         │ diff_score   │ │└──────────────┘    │
         │ created_at   │ │                    │
         └──────────────┘ │                    │
                          │                    │
              ┌───────────▼─────────┐         │
              │  frame_analyses     │         │
              │─────────────────────│         │
              │ id (PK)             │         │
              │ frame_id (FK)       │         │
              │ rubric_scores       │         │
              │ justifications      │         │
              │ issue_tags          │         │
              │ suggestions         │         │
              │ created_at          │         │
              └─────────────────────┘         │
```

### Table Details

#### profiles
- Links to Supabase auth.users
- Auto-created on signup via trigger
- Stores user metadata

#### analysis_runs
- Main entity for each video analysis
- `status`: uploaded → queued → processing → completed/failed
- `video_storage_path`: path in Supabase Storage
- RLS: users see only their runs

#### frames
- All extracted frames (keyframes + regular)
- `is_keyframe`: marks important frames for analysis
- `diff_score`: pixel difference from previous frame
- `timestamp_ms`: position in video

#### frame_analyses
- AI analysis results per frame
- JSONB fields for flexible schema
- Only created for keyframes
- Validated with Zod schemas

#### run_summaries
- Aggregated results per run
- Overall rubric scores (averaged)
- Top 5 issues with counts
- Prioritized recommendations

## Storage Structure

```
videos/ (Supabase Storage Bucket)
├── runs/
│   ├── {run-id-1}/
│   │   ├── video.mp4
│   │   └── frames/
│   │       ├── {frame-id-1}.jpg
│   │       ├── {frame-id-2}.jpg
│   │       └── ...
│   ├── {run-id-2}/
│   │   ├── video.mp4
│   │   └── frames/
│   │       └── ...
│   └── ...
```

## Security Model

### Row Level Security (RLS)

All tables have RLS enabled:

```sql
-- Example: analysis_runs
CREATE POLICY "Users can view their own runs"
  ON analysis_runs FOR SELECT
  USING (auth.uid() = user_id);
```

### Authentication Flow

```
1. User enters email
2. Supabase sends magic link
3. User clicks link → exchangeCodeForSession
4. Session stored in HTTP-only cookie
5. Middleware validates session on every request
```

### API Security

- **Client**: Anon key (safe to expose)
- **Server**: Service role key (server-side only)
- **Processor**: Service role key (server-side only)
- **Webhook**: Shared secret validates requests

### Storage Security

- Bucket is **private** (no public access)
- Signed URLs expire after 1 hour
- Generated server-side only
- RLS policies control access

## API Routes

### Public Routes
- `GET /` - Redirect to login or dashboard
- `GET /login` - Login page
- `GET /auth/callback` - OAuth callback

### Protected Routes (require auth)
- `GET /dashboard` - User dashboard
- `GET /runs/:id` - Analysis report view

### API Endpoints
- `POST /api/runs` - Create new analysis
- `GET /api/runs` - List user's runs
- `GET /api/runs/:id` - Get run with details
- `POST /api/runs/:id/enqueue` - Start processing
- `GET /api/runs/:id/status` - Poll status

### Processor Endpoints
- `GET /health` - Health check
- `POST /process` - Webhook to trigger processing

## Component Architecture

### Web App (Next.js)

```
src/
├── app/                    # App Router
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Home (redirects)
│   ├── login/
│   │   └── page.tsx       # Login page
│   ├── dashboard/
│   │   └── page.tsx       # Dashboard page
│   ├── runs/
│   │   └── [id]/
│   │       └── page.tsx   # Report page
│   └── api/               # API routes
│       └── runs/
│           ├── route.ts
│           └── [id]/
│               ├── route.ts
│               ├── enqueue/route.ts
│               └── status/route.ts
├── components/            # React components
│   ├── Header.tsx
│   ├── NewRunForm.tsx
│   ├── RunsList.tsx
│   └── ReportView.tsx
└── lib/                   # Utilities
    └── supabase/
        ├── client.ts      # Browser client
        ├── server.ts      # Server client
        └── middleware.ts  # Session refresh
```

### Processor Worker

```
src/
├── index.ts        # Express server
├── supabase.ts     # Supabase client
├── poller.ts       # Job polling
├── processor.ts    # Main orchestration
├── ffmpeg.ts       # Frame extraction
├── vision.ts       # OpenAI API calls
└── summary.ts      # Summary generation
```

### Shared Package

```
src/
├── index.ts        # Exports
├── types.ts        # TypeScript types
├── schemas.ts      # Zod validation schemas
└── constants.ts    # Shared constants + prompts
```

## Key Technologies

### Frontend
- **Next.js 14**: App Router, Server Components
- **React 18**: UI components
- **Tailwind CSS**: Styling
- **TypeScript**: Type safety

### Backend
- **Next.js API Routes**: REST endpoints
- **Express**: Processor server
- **Node.js**: Runtime

### Database
- **Supabase Postgres**: Relational data
- **Supabase Storage**: Blob storage
- **Supabase Auth**: Authentication

### AI/ML
- **OpenAI Vision**: Frame analysis
- **GPT-4 Vision**: Model

### DevOps
- **Vercel**: Web app hosting
- **Railway/Fly.io**: Processor hosting
- **Docker**: Containerization
- **Turbo**: Monorepo build system

## Performance Considerations

### Video Processing
- **Sequential**: Frames processed one at a time
- **Optimization**: Keyframe detection reduces API calls
- **Timeout**: ~5 min max for 30s video

### Database Queries
- **Indexes**: On user_id, run_id, is_keyframe
- **Eager Loading**: Fetch analyses with frames
- **Pagination**: Not implemented (add for scale)

### Storage
- **Signed URLs**: 1 hour expiry
- **CDN**: Supabase CDN for global access
- **Cleanup**: Manual (implement lifecycle policies)

### Caching
- **No caching**: Real-time data
- **Add later**: Cache signed URLs, analysis results

## Scaling Strategy

### Current Limits
- **1 processor**: Sequential processing
- **~10 concurrent analyses**: API rate limits
- **500MB video max**: Supabase Storage

### Scale Up (1-100 users)
- Add more processor workers
- Implement job queue (Redis)
- Add CDN caching

### Scale Out (100+ users)
- Load balancer for processors
- Database read replicas
- Batch OpenAI requests
- Add rate limiting per user

## Monitoring & Observability

### Logs
- **Web App**: Vercel logs
- **Processor**: Railway/Fly.io logs
- **Database**: Supabase logs

### Metrics (to add)
- Processing time per video
- API costs per analysis
- Error rates
- User engagement

### Alerts (to add)
- Failed processing jobs
- API errors
- Storage approaching limit
- High costs

## Error Handling

### Web App
- Try/catch in API routes
- Error state in UI components
- Toast notifications for user errors

### Processor
- Try/catch around main logic
- Update run status to "failed"
- Store error_message for debugging
- Continue on frame failures (don't fail entire job)

### Database
- Foreign key constraints
- NOT NULL constraints
- Enum types for status
- Triggers for auto-updates

## Testing Strategy

### Manual Testing
1. Upload various video formats
2. Test with different video lengths
3. Verify all UI flows
4. Check error scenarios

### Automated Testing (to add)
- Unit tests for processors
- Integration tests for API
- E2E tests with Playwright
- Load tests for scaling

## Future Enhancements

### Short Term
- Batch frame analysis (reduce API calls)
- Progress bar during processing
- Email notifications on completion
- Delete/archive old analyses

### Medium Term
- Cursor tracking overlay
- Click heatmaps
- Comparison between runs
- Export to PDF report

### Long Term
- Real-time processing
- Team collaboration features
- Custom rubric definitions
- Integration with design tools (Figma, etc.)
