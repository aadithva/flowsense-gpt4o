# Security And Dependency Policy

## Dependency management cadence

- Weekly: patch-version updates
- Monthly: minor-version updates
- Immediate: any high/critical production vulnerability

## Merge gates

All pull requests must pass:
- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build`
- `npm audit --omit=dev --audit-level=high`
- Secret scanning (gitleaks)

## Secrets policy

- Never commit credentials in tracked files
- Store runtime secrets in Azure Key Vault or platform secret stores
- Use managed identities where possible
- Rotate webhook, API, SQL, and storage credentials on exposure

## Incident response default SLA

- Critical: mitigate within 24 hours
- High: mitigate within 72 hours
- Moderate: mitigate within 14 days
- Low: triage and schedule in regular maintenance cycle
