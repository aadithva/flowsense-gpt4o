# Backend (Processor)

## Overview

`backend` is the worker that processes queued runs:
1. claims queued run atomically
2. downloads video from Blob storage
3. validates format/size via ffprobe
4. extracts frames + keyframes
5. runs Azure OpenAI frame analysis
6. writes frame analyses + summary metric V2

## Security controls

- webhook auth: secret + HMAC signature + timestamp + nonce
- replay protection with nonce TTL cache
- cancellation checkpoints during processing
- startup env validation (hard-fail)

## Endpoints

- `GET /health`
- `POST /process`

## Local run

```bash
cd backend
npm run dev
```

## Required env

See `backend/.env.example`.

## Testing

```bash
cd backend
npm run test
npm run typecheck
```
