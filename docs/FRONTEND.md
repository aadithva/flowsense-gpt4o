# Frontend (Next.js)

## Overview

`frontend` hosts the app UI and secured API routes.

## Key responsibilities

- Entra login + signed session cookie
- middleware route protection for app and `/api/runs*`
- run lifecycle APIs (create, enqueue, retry, cancel, delete)
- managed identity Blob SAS generation (user delegation)
- report UI with metric V2 and regression comparison

## Auth flow

1. `/login` -> `/api/auth/login`
2. Redirect to Entra authorize endpoint
3. `/auth/callback` exchanges code, verifies ID token, sets session cookie
4. Middleware enforces authenticated access

## Local run

```bash
cd frontend
npm run dev
```

## Required env

See `frontend/.env.example`.
