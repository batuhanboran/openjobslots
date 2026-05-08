# OpenJobSlots Project State

This is the short current-state document for future Codex runs. Detailed runbooks live in `docs/reference/`.

## Current Version

- Package/public release line: `v1.6.0`.
- Last recorded deployed commit: `bc5f6c6e5da2eae036c161b3ba4c7fb30685e64b`.
- Last recorded production deployment date: May 8, 2026.
- Public product name: `openjobslots`.
- Target public domain: `openjobslots.com`.

## Deployment Status

- Production host: ltx100 / `public-services`.
- Production checkout: `/root/OpenPostings`.
- Deployment source: private GitHub repository `batuhanboran/openjobslots`, branch `main`.
- Auto-deploy: `openjobslots-deploy.timer`.
- Deploy log: `/var/log/openjobslots-deploy.log`.
- Deployment details and rollback notes: `docs/reference/deployment.md`.

Expected OpenJobSlots services:

- `openjobslots-app`
- `openjobslots-worker`
- `openjobslots-postgres`
- `openjobslots-meilisearch`

## Active Architecture

- API/static web app: Node/Express container.
- Worker: separate Node ingestion worker container.
- Active DB backend: Postgres in production.
- Active search backend: Meilisearch in production.
- Queue/control model: Postgres-backed sync/control state; pg-boss code exists but is not the primary production queue path unless deployment config says otherwise.
- SQLite role: local fallback, import source, isolated tests, and legacy compatibility.
- Meilisearch role: derived public search index. Postgres remains source of truth.

## Public Endpoints

- `GET /health`
- `GET /postings`
- `GET /postings/filter-options`
- `GET /search/suggest`
- `GET /sync/status`
- `GET /ingestion/status`

Internal/admin diagnostics may include:

- `/admin/parsers`
- `/ingestion/errors`
- `/ingestion/runs`
- `/ingestion/sources`
- `/ingestion/quality/summary`
- `/ingestion/parser-stats`
- `/ingestion/rejections`

Keep public UI calls on public routes only unless an admin flow is explicitly opened.

## Last Recorded Data Quality State

The last production audit recorded the search system as functional but normalized data quality as the main risk.

- Visible/searchable postings: about `725,071`.
- Missing any normalized geo: about `711,093` / `98.07%`.
- Missing all geo: about `306,177` / `42.23%`.
- Weak or unknown remote classification: about `282,748` / `39.00%`.
- Missing all geo and weak remote: about `266,770` / `36.79%`.
- Meilisearch and Postgres counts were broadly aligned, with a small known stale/bad-document delta documented in the deployment runbook.

Treat these as the last recorded numbers, not proof of current live state. Re-run `npm run audit:ats-quality` and the production read-only audit before making data-quality claims.

## Known Risks

- Many imported/live rows still need parser-backed normalization or detail-page refetch before country, region, city, remote mode, date, department, and employment fields are reliable.
- iCIMS, Applitrack, and other high-volume ATS sources can expose fields only in detail pages or tenant-specific shapes.
- Parser certification is fixture-backed only for a subset of the configured ATS catalog. Do not claim all 60 ATS are certified.
- Meilisearch is derived data. Reindex only after check/dry-run mode and with a rollback plan.
- Production write backfills must be dry-run first, batched, explicit, and approved.
- Cloudflare/analytics CSP alignment and dependency version cleanup are separate maintenance tasks.

## Next Tasks

1. Run a fresh read-only production data-quality audit by ATS/parser/version.
2. Prioritize parser/detail-page work by live field gaps, not by UI symptoms.
3. Add raw fixtures and tests before marking any ATS certified.
4. Run dry-run normalized backfill and inspect before/after samples.
5. Run Meilisearch check-mode parity before any replace reindex.
6. Keep public search parity tests active for Turkey/Turkiye/Türkiye, remote, common title/country combinations, and pagination uniqueness.
7. Keep documentation changes consolidated in this file plus `docs/reference/`.

## Baseline Validation Commands

Use the relevant subset for the task:

```powershell
npm.cmd run test:backend
npm.cmd run test:api
npm.cmd run test:parsers
npm.cmd run test:e2e
npm.cmd run quality:gate
npm.cmd run search:parity
npm.cmd run reindex:meili -- --check
npm.cmd run audit:ats-quality
```

Docs-only work normally needs only:

```powershell
git diff --check
```
