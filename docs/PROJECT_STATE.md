# OpenJobSlots Project State

This is the short current-state document for future Codex runs. Detailed runbooks live in `docs/reference/`.

## Current Version

- Package/public release line: `v1.6.2`.
- Last recorded deployed commit: current `v1.6.2` release commit on `main`.
- Last recorded production deployment date: May 11, 2026.
- Public product name: `openjobslots`.
- Target public domain: `openjobslots.com`.

## Deployment Status

- Production host: production / `public-services`.
- Production checkout: `/root/OpenJobSlots`.
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

The last production audit was recorded on May 11, 2026 after the guarded backfill/detail-refetch cycle and final replace-mode Meili reindex.
Reports were written on production under `/root/OpenJobSlots/reports/`.

- Initial baseline JSON: `/root/OpenJobSlots/reports/production-data-quality-baseline.json`.
- Final audit JSON: `/root/OpenJobSlots/reports/data-quality-final-after-meili-reindex-20260511T183424Z.json`.
- Final Meili check JSON: `/root/OpenJobSlots/reports/meili-check-after-final-reindex-20260511T183424Z.json`.
- Final Meili replace report: `/root/OpenJobSlots/reports/meili-replace-final-reindex-20260511T183424Z.json`.
- Visible postings: `737,433`.
- Indexable postings: `737,427`.
- Missing country: `306,410` / `41.55%`.
- Missing location text: `199,951` / `27.11%`.
- Missing region/state: `306,410` / `41.55%`.
- Missing city: `554,991` / `75.26%`.
- Missing any normalized geo: `560,188` / `75.96%`.
- Missing all normalized geo: `301,213` / `40.85%`.
- Missing location and all normalized geo: `199,951` / `27.11%`.
- Suspicious/unknown geo: `19,957` / `2.71%`.
- Missing remote type: `0` / `0.00%`.
- Weak or unknown remote classification: `283,989` / `38.51%`.
- Missing all normalized geo and weak/unknown remote: `262,542` / `35.60%`.
- Worst remaining sources by combined geo/remote gaps: `icims`, `applitrack`, `manatal`, `taleo`, `workday`, `hrmdirect`, `breezy`, `ashby`, `smartrecruiters`, and `zoho`.
- Meilisearch document count: `737,427`; Postgres indexable count: `737,427`; count delta: `0`.
- Meilisearch remote facets now match the Postgres-derived indexed payload distribution.
- Heavy job advisory lock `openjobslots_heavy_job` was available; no guarded backfill runs were active.

Treat these as the last recorded numbers, not proof of current live state. Re-run the read-only production baseline audit before making new data-quality claims.

## Known Risks

- Many imported/live rows still need parser-backed normalization or detail-page refetch before country, region, city, remote mode, date, department, and employment fields are reliable.
- iCIMS, Applitrack, and other high-volume ATS sources can expose fields only in detail pages or tenant-specific shapes.
- Parser certification is fixture-backed only for a subset of the configured ATS catalog. Do not claim all 60 ATS are certified.
- Meilisearch is derived data. Reindex only after check/dry-run mode and with a rollback plan.
- Production write backfills must be dry-run first, batched, explicit, and approved.
- v1.6.2 has applied guarded production repair batches and final replace-mode Meili reindexing; future repair work must still use the same backup, lock, canary, audit, and rollback process.
- Cloudflare/analytics CSP alignment and dependency version cleanup are separate maintenance tasks.

## Next Tasks

1. Run a fresh read-only production data-quality audit by ATS/parser/version with `npm run audit:data-quality -- --by-source --by-parser`.
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
npm.cmd run audit:data-quality -- --json --output=reports/data-quality-audit.json
npm.cmd run backfill:geo-remote:dry-run -- --limit=50000 --json --sample --output=reports/geo-remote-dry-run.json
npm.cmd run refetch:details:dry-run -- --source=icims --limit=5000 --json --sample --output=reports/icims-detail-dry-run.json
npm.cmd run refetch:details:dry-run -- --source=applitrack --limit=5000 --json --sample --output=reports/applitrack-detail-dry-run.json
npm.cmd run search:reindex:check -- --json --output=reports/meili-reindex-check.json
npm.cmd run audit:data-quality -- --by-source --by-parser
npm.cmd run audit:ats-quality
```

Docs-only work normally needs only:

```powershell
git diff --check
```
