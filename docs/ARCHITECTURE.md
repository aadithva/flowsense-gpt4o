# Architecture

## System diagram

- Browser -> Next.js frontend/API
- Next.js API -> Azure SQL + Azure Blob + Processor webhook
- Processor -> Azure SQL + Azure Blob + Azure OpenAI

## Data model highlights

- `analysis_runs.status`: `uploaded|queued|processing|cancel_requested|completed|failed|cancelled`
- `analysis_runs.cancel_requested`: explicit cancellation bit
- `run_summaries` stores metric V2 fields:
  - `weighted_score_100`
  - `critical_issue_count`
  - `quality_gate_status`
  - `confidence_by_category`
  - `metric_version`

## Reliability

- Queue dedupe: atomic claim query (`UPDATE ... OUTPUT`)
- Cancel-safe processing with periodic checkpoint checks
- Retry path resets frame + summary artifacts before requeue

## Security

- Entra session required (no anonymous run access)
- Webhook signing + nonce replay protection
- Managed identity for Blob access (no shared keys)
- CI blocks high/critical dependency vulnerabilities
