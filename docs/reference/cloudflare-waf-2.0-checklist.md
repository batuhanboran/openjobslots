# Cloudflare WAF 2.0 Checklist

Date: 2026-05-17
Project: OpenJobSlots

## Scope

Use this checklist before any 2.0.0 deployment. Do not apply Cloudflare changes from the demo branch without explicit deployment approval.

## WAF And Access Controls

- Admin routes under `/admin/*` require the application admin token and should have WAF visibility.
- Detailed diagnostics routes `/postings/diagnostics` and `/postings/:id/diagnostics` require the application admin token.
- Mutation routes such as sync start/stop, source apply, canary apply, and settings writes should be rate-limited and monitored.
- Public routes `/health`, `/postings`, `/postings/filter-options`, `/search/suggest`, `/sync/status`, and `/ingestion/status` should remain reachable without admin credentials.

## Rate Limits

- Add or verify a rate limit for `/search/suggest` to reduce bot amplification.
- Add or verify stricter rate limits for admin diagnostics and mutation endpoints.
- Keep ATS fetch and ingestion job controls protected by app-side guards even when Cloudflare rules are present.

## Caching Rules

- Cache static web assets from the exported app.
- Do not broadly cache API responses that may vary by filters, admin state, or operational status.
- Do not cache admin diagnostics, settings, sync, queue, or ingestion operator responses.

## Security Headers

Verify production responses include reviewed values for:

- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Content-Security-Policy`
- `Permissions-Policy`

## Observability

- Review WAF events for blocked admin, diagnostics, sync, and ingestion traffic before release.
- Confirm bot/rate-limit events are visible for search suggestions.
- Confirm Cloudflare logs do not expose admin tokens, database URLs, Sentry tokens, or applicant credentials.

## Release Gate

Before deploying 2.0.0:

1. Inspect active WAF, cache, rate-limit, and security-header rules for the production zone.
2. Confirm public routes still work without admin credentials.
3. Confirm admin and diagnostics routes still return `401` without credentials.
4. Record the reviewed Cloudflare rule names or IDs in the release notes.

## Current Status

No Cloudflare rule changes were applied during demo preparation.

Read-only inspection on 2026-05-17 confirmed:

- `openjobslots.com` zone is active, unpaused, and full setup.
- Zone-level rulesets are present for URL normalization, Cloudflare Managed Free Ruleset, L7 DDoS, custom firewall, rate limiting, and cache settings.
- Current connector permissions can list zone rulesets but cannot read the rule bodies for custom firewall, rate limiting, cache settings, managed WAF entrypoint, legacy firewall rules, WAF packages, bot management, or API Shield configuration.

Remaining release blocker:

- Re-run Cloudflare review with permissions that can read rule bodies before deployment, then record the exact custom firewall, rate-limit, cache, and WAF rule names or IDs.
