# Frontend (Next.js)

## Overview
The frontend is a Next.js App Router application that provides the upload UI, progress dashboard, and report viewer.

## Location
- Source: `frontend/src`
- App routes: `frontend/src/app`
- Components: `frontend/src/components`
- Supabase helpers: `frontend/src/lib/supabase`

## Key Routes
- `/dashboard` - upload form + recent runs
- `/runs/[id]` - report view + polling
- `/api/runs` - create run + list runs
- `/api/runs/[id]` - fetch report data
- `/api/runs/[id]/enqueue` - queue processing
- `/api/runs/[id]/status` - polling endpoint

## Environment
Create `frontend/.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
PROCESSOR_WEBHOOK_SECRET=<your-webhook-secret>
PROCESSOR_BASE_URL=http://localhost:3001
```

## Run Locally
```
cd frontend
npm run dev
```

The app is available at `http://localhost:3000`.
