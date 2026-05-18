# Sentry 2.0 Readiness

Date: 2026-05-17
Project: OpenJobSlots

## Credential Gate

Live Sentry issue inspection requires these environment variables to be set locally:

- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

Do not paste tokens into chat or commit them. Set them in the local shell or local secret manager before running the Sentry scan workflow.

## Frontend Capture Points

- Search request failures should include route, query length, active filter count, and response status.
- Search suggestion failures should include query length only, not the raw query when it may contain personal text.
- Job card action failures should include action type and a hashed or otherwise safe posting identifier.
- Application tracking failures should avoid raw resume, email, phone, or full posting URL values.
- Reduced-motion and mobile layout failures should be tracked as frontend UI errors only when they produce actual runtime exceptions.

## Backend Capture Points

- Admin diagnostic failures should include route and status, not admin token values.
- ATS fetch failures should include source key, sanitized host, status, timeout flag, and response-size-limit flag.
- Parser failures should include ATS key, parser version, rejection reason, and bounded sample counts.
- Canary/apply jobs should include mode, source key, accepted/rejected/duplicate/quarantined counts, and guard outcome.
- Search/index failures should include public-safe route, Meili/Postgres parity status, and no raw connection strings.

## Data Handling Rules

- Do not send raw `OPENJOBSLOTS_ADMIN_TOKEN`, database URLs, Meili keys, Sentry tokens, Cloudflare tokens, or MCP/applicant credentials.
- Do not attach raw ATS payloads, resumes, personal information, or full application instructions to Sentry events.
- Prefer bounded counts, source keys, sanitized hosts, and normalized error classes.

## Release Gate

Before deploying 2.0.0:

1. Run the Sentry issue scan after credentials are available.
2. Record the top unresolved production issues and decide whether each blocks release.
3. Confirm frontend and backend error events contain no secrets or personal data.
4. Confirm source/parser failures are grouped by safe keys rather than by full URLs or payload text.

## Current Status

The local environment did not expose Sentry credentials during planning, so live Sentry issue inspection is pending. This is a release readiness gate, not a blocker for local demos.
