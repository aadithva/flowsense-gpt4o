# FlowSense Backend

Processor service for video analysis (Azure SQL + Blob + OpenAI).

## Setup

```bash
cp .env.example .env
```

Populate Azure and webhook variables from `backend/.env.example`.

## Run

```bash
npm run dev
```

Health check: `http://localhost:3002/health`.
