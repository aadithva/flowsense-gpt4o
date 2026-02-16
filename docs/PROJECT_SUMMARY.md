# Project Summary: FlowSense (Azure Hardening + Metric V2)

## Overview

FlowSense evaluates UX interaction recordings and produces rubric-based reports.
The current architecture is Azure-native and launch-focused for public beta:

- Microsoft Entra ID authentication
- Azure SQL (Entra token auth)
- Azure Blob Storage (managed identity + user delegation SAS)
- Azure OpenAI for frame analysis
- Next.js frontend/API + Node processor worker

## What changed in this hardening cycle

### 1. Authentication and authorization

- Removed anonymous access paths from `/api/runs*`
- Enforced authenticated sessions in middleware for protected app routes and run APIs
- Replaced placeholder login with Microsoft Entra sign-in flow
- Added run ownership checks by authenticated Entra object ID (`oid`)

### 2. Secrets and environment safety

- Added strict env validation in frontend and backend startup
- Added explicit hard-fail if deprecated blob shared-key env vars are present
- Standardized required secrets and runtime guardrails

### 3. Storage and data-plane security

- Migrated blob operations to managed identity / `DefaultAzureCredential`
- Replaced runtime shared-key storage auth usage
- Enforced upload constraints in API path (size/type checks)

### 4. Processing reliability

- Added atomic SQL queue-claim flow to prevent duplicate work across workers
- Added cancel-request semantics and cancellation checkpoints
- Added retry path hardening and run-state guardrails
- Hardened processor webhook with secret + HMAC signature + timestamp + nonce replay checks

### 5. UX Metric V2

Run summaries now include:

- `weighted_score_100`
- `critical_issue_count`
- `quality_gate_status` (`pass` | `warn` | `block`)
- `confidence_by_category`
- `metric_version`

Also includes regression deltas against previous runs by title for the same user.

### 6. DevSecOps workflow

- Added CI workflow with merge gates for:
  - typecheck
  - lint
  - test
  - build
  - `npm audit --omit=dev --audit-level=high`
  - secret scanning (gitleaks)
- Added non-interactive lint configuration and CI-safe lint command

### 7. Observability baseline

- Added Application Insights integration hooks for events/metrics/exceptions
- Added telemetry emission around processor claim and processing lifecycle events

## Current quality-gate status

Latest local validation:

- `npm run typecheck`: pass
- `npm run lint:ci`: pass
- `npm run test`: pass
- `npm run build`: pass
- `npm audit --omit=dev --audit-level=high`: pass

Note: one low-severity advisory may remain in transitive dependency tree (`qs`), but no high/critical production advisory is present.

## Repository map

- `frontend/` — Next.js app and API routes
- `backend/` — processor worker
- `packages/shared/` — shared schemas/types/constants/security helpers
- `azure/migrations/` — SQL schema and migrations
- `.github/workflows/ci.yml` — CI quality gates

## Remaining recommended work

- Add/expand authz and upload-abuse automated tests in frontend package
- Add deterministic concurrency integration tests for queue claim behavior
- Expand telemetry dashboards and production alert rules for queue/backlog anomalies
- Continue dependency hygiene and clear remaining low advisories when safe
