# Quick Start (Azure)

This guide starts FlowSense locally against Azure services in ~10 minutes.

## Prerequisites

- Node.js 20+
- `ffmpeg` and `ffprobe` on `PATH`
- Azure resources already provisioned:
  - Entra app registration
  - Azure SQL database
  - Blob storage account + `videos` container
  - Azure OpenAI deployment
- Managed identity or local `az login` access that can:
  - read/write blobs in `videos`
  - connect to Azure SQL via Entra token auth

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment files

```bash
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

Update values in both files, especially:

- `AUTH_SESSION_SECRET`
- `ENTRA_TENANT_ID`
- `ENTRA_CLIENT_ID`
- `ENTRA_CLIENT_SECRET`
- `APP_BASE_URL`
- `PROCESSOR_BASE_URL`
- `PROCESSOR_WEBHOOK_SECRET` and `WEBHOOK_SECRET` (must match)
- `AZURE_SQL_SERVER`
- `AZURE_SQL_DATABASE`
- `AZURE_STORAGE_ACCOUNT_NAME`
- `AZURE_OPENAI_*`

Do not set these deprecated shared-key variables:

- `AZURE_STORAGE_ACCOUNT_KEY`
- `AZURE_STORAGE_CONNECTION_STRING`

App startup intentionally fails if they are present.

## 3. Apply SQL migrations

Apply in order:

1. `azure/migrations/001_initial_schema.sql`
2. `azure/migrations/002_hardening_and_metrics_v2.sql`

## 4. Start apps

Open two terminals:

```bash
# terminal 1
cd frontend && npm run dev
```

```bash
# terminal 2
cd backend && npm run dev
```

## 5. Verify the app

1. Open `http://localhost:3000`
2. Sign in with Microsoft Entra
3. Create a run and upload a video
4. Queue processing
5. Open run report and confirm Metric V2 fields appear:
   - `weighted_score_100`
   - `critical_issue_count`
   - `quality_gate_status`
   - `confidence_by_category`

## 6. Run quality gates

```bash
npm run typecheck
npm run lint:ci
npm run test
npm run build
npm audit --omit=dev --audit-level=high
```

## Troubleshooting

### Login fails or callback errors

- Verify Entra redirect URI is `${APP_BASE_URL}/auth/callback`
- Confirm tenant/client IDs match the app registration
- Confirm `AUTH_SESSION_SECRET` is set and stable

### Upload fails

- Confirm blob container exists (`videos`)
- Confirm MIME type is allowed (`mp4`, `mov`, `mkv`)
- Confirm file size is <= 500MB
- Confirm managed identity permissions include blob data contributor access

### Runs remain queued

- Check processor logs for webhook auth or SQL claim errors
- Confirm `PROCESSOR_BASE_URL` is reachable from frontend
- Confirm webhook secrets match exactly

### Build/test differences between local and CI

- Run `npm run lint:ci` locally (CI uses zero-warning lint)
- Ensure Azure env variables are set for both frontend/backend commands

## Related docs

- `README.md`
- `docs/DEPLOYMENT.md`
- `docs/SECURITY_POLICY.md`
- `docs/ARCHITECTURE.md`
