# FlowSense

FlowSense analyzes UX task-flow recordings and scores interaction quality using a 7-category rubric.

This repository is now Azure-native:
- Microsoft Entra ID authentication
- Azure SQL (token auth via managed identity)
- Azure Blob Storage (managed identity + user delegation SAS)
- Azure OpenAI for frame analysis

## Security posture

- Anonymous access removed from `/api/runs*`
- Entra session required for app and API routes
- Shared-key blob auth removed from runtime
- Signed processor webhooks with timestamp + nonce replay protection
- Startup env validation (hard-fail)
- CI quality gates: typecheck, lint, test, build, dependency audit, secret scan

## Monorepo structure

- `frontend/`: Next.js app + API routes
- `backend/`: processor worker (ffmpeg + analysis pipeline)
- `packages/shared/`: shared types, schemas, constants, security helpers
- `azure/migrations/`: Azure SQL schema + migrations

## Local development

### 1. Prerequisites
- Node.js 20+
- ffmpeg + ffprobe available on `PATH`
- Azure resources configured (Entra app, SQL, Blob, OpenAI)

### 2. Install dependencies

```bash
npm install
```

### 3. Configure env files

Use templates:
- `frontend/.env.example`
- `backend/.env.example`

Required security fields include:
- `AUTH_SESSION_SECRET`
- `ENTRA_*`
- `WEBHOOK_SECRET` and `PROCESSOR_WEBHOOK_SECRET`

### 4. Run apps

```bash
# terminal 1
cd frontend && npm run dev

# terminal 2
cd backend && npm run dev
```

## Validation commands

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm audit --omit=dev --audit-level=high
```

## Metric V2 outputs

Run summaries now include:
- `weighted_score_100`
- `critical_issue_count`
- `quality_gate_status` (`pass|warn|block`)
- `confidence_by_category`
- `metric_version`

## Deployment

See `docs/DEPLOYMENT.md` for Azure-first deployment and release checklist.

See `docs/SECURITY_POLICY.md` for dependency cadence, merge gates, and incident SLAs.
