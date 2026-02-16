# Backend (Processor)

## Overview
The backend is an Express service that processes queued runs: downloads the video, extracts frames with ffmpeg, analyzes keyframes, and writes summaries back to Supabase.

## Location
- Source: `backend/src`
- Entry: `backend/src/index.ts`
- Pipeline: `backend/src/processor.ts`

## Endpoints
- `GET /health` - service health check
- `POST /process` - webhook trigger (expects `run_id` JSON and `X-Webhook-Secret` header)

## Environment
Create `backend/.env` (see `backend/.env.example`):
```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>

OLLAMA_URL=http://localhost:11434
VISION_MODEL=llama3.2-vision:11b

WEBHOOK_SECRET=<same-as-web>
PORT=3001
```

## Run Locally
```
cd backend
npm run dev
```

## Notes
- Requires `ffmpeg` on PATH (or set `FFMPEG_PATH`).
- Vision defaults to Ollama. If you swap providers, update `backend/src/vision.ts`.
