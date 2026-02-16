# Deployment Guide (Azure)

## Target architecture

- Frontend: Next.js (Node runtime) with Entra sign-in
- Processor: Azure Container Apps
- Database: Azure SQL
- Storage: Azure Blob (`videos` container)
- AI: Azure OpenAI
- Telemetry: Application Insights (optional but recommended)

## Pre-deploy checklist

- Rotate all previously exposed credentials before release
- Confirm Entra app registration redirect URI matches `${APP_BASE_URL}/auth/callback`
- Confirm processor and frontend webhook secrets are identical and strong
- Confirm managed identity has:
  - `Storage Blob Data Contributor` on storage account
  - SQL database access via Entra identity
- Confirm no shared-key blob env vars are set

## Environment variables

### Frontend

- `APP_BASE_URL`
- `AUTH_SESSION_SECRET`
- `ENTRA_TENANT_ID`
- `ENTRA_CLIENT_ID`
- `ENTRA_CLIENT_SECRET`
- `ENTRA_REDIRECT_PATH` (default `/auth/callback`)
- `AZURE_SQL_SERVER`
- `AZURE_SQL_DATABASE`
- `AZURE_STORAGE_ACCOUNT_NAME`
- `AZURE_STORAGE_CONTAINER` (default `videos`)
- `PROCESSOR_BASE_URL`
- `PROCESSOR_WEBHOOK_SECRET`
- `APPINSIGHTS_CONNECTION_STRING` (optional)

### Processor

- `PORT`
- `PROCESSOR_WORKER_ID`
- `WEBHOOK_SECRET`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_DEPLOYMENT`
- `AZURE_OPENAI_API_VERSION`
- `AZURE_SQL_SERVER`
- `AZURE_SQL_DATABASE`
- `AZURE_STORAGE_ACCOUNT_NAME`
- `AZURE_STORAGE_CONTAINER` (default `videos`)
- `APPINSIGHTS_CONNECTION_STRING` (optional)

## Database migrations

Apply in order:

1. `azure/migrations/001_initial_schema.sql`
2. `azure/migrations/002_hardening_and_metrics_v2.sql`

## Runtime hardening

- Keep processor ingress private where possible
- If public, enforce HTTPS-only and IP restrictions
- Keep webhook route protected with secret + signature + nonce/timestamp checks (already implemented)

## CI/CD gates

GitHub Actions workflow (`.github/workflows/ci.yml`) blocks merge on:
- typecheck
- lint
- tests
- build
- prod dependency audit (`npm audit --omit=dev --audit-level=high`)
- secret scanning (gitleaks)

## Release readiness checklist

- AuthN/AuthZ tests pass
- Upload abuse tests pass
- Queue claim dedupe verified with parallel workers
- Cancel/retry idempotency verified
- Metric V2 fields present in API + UI
- App Insights dashboards show:
  - queue wait time
  - processing duration
  - failure rate
  - retry/cancel rates
- Rollback plan documented and validated
