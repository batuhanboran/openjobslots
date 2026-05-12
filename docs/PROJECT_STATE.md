# OpenJobSlots Project State

This is the short current-state document for future Codex runs. Detailed runbooks live in `docs/reference/`.

## Current Version

- Package/public release line: `v1.8.0`.
- Last recorded deployed commit: current `v1.8.0` release commit on `main`.
- Last recorded production deployment date: May 12, 2026.
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
- Source-job control model: source-specific dry-run/canary/apply work must use the global heavy-job advisory lock and the `ats_source_runs` audit tables.
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
- `/ingestion/source-quality`
- `/ingestion/parser-drift`
- `/ingestion/quarantine-summary`
- `/ingestion/status` includes the global heavy-job lock and recent ATS source-job run state.

Keep public UI calls on public routes only unless an admin flow is explicitly opened.

## Last Recorded Data Quality State

The last production audit was recorded on May 12, 2026 after the certified-source public dataset rebuild, threshold indexing cleanup, and final replace-mode Meili reindex.
Reports were written on production under `/root/OpenJobSlots/reports/`.

- Certified rebuild backup: `/root/OpenJobSlots/backups/postgres-openjobslots-pre-certified-rebuild-20260512-155252.dump`.
- Final data-quality audit JSON: `/root/OpenJobSlots/reports/v180-final-20260512-175855-data-quality.json`.
- Final ATS quality audit JSON: `/root/OpenJobSlots/reports/v180-final-20260512-175855-ats-quality.json`.
- Final source quality JSON: `/root/OpenJobSlots/reports/v180-postdeploy-20260512-181223-endpoint-ingestion_source-quality.json`.
- Final quarantine summary JSON: `/root/OpenJobSlots/reports/v180-postdeploy-20260512-181223-endpoint-ingestion_quarantine-summary.json`.
- Final Meili replace report: `/root/OpenJobSlots/reports/certified-rebuild-20260512-155252-final2-meili-replace-reindex.json`.
- Final Meili post-check JSON: `/root/OpenJobSlots/reports/v180-postdeploy-20260512-181223-meili-check.json`.
- Visible postings: `47,396`.
- Indexable postings: `47,395`.
- Missing country: `3,113` / `6.57%`.
- Missing location text: `51` / `0.11%`.
- Missing region/state: `3,113` / `6.57%`.
- Missing city: `5,039` / `10.63%`.
- Missing any normalized geo: `6,824` / `14.40%`.
- Missing all normalized geo: `1,328` / `2.80%`.
- Missing location and all normalized geo: `44` / `0.09%`.
- Suspicious/unknown geo: `1,431` / `3.03%`.
- Missing remote type: `0` / `0.00%`.
- Weak or unknown remote classification: `1,855` / `3.91%`.
- Missing all normalized geo and weak/unknown remote: `22` / `0.05%`.
- Source states: `20` public-enabled, `6` quarantine-only, `36` disabled.
- Quarantine-only sources: `recruitee`, `applitrack`, `icims`, `recruitcrm`, `taleo`, and `zoho`.
- Meilisearch document count: `47,395`; Postgres indexable count: `47,395`; count delta: `0`.
- Meilisearch remote facets now match the Postgres-derived indexed payload distribution.
- Heavy job advisory lock `openjobslots_heavy_job` was available after the final reindex.
- `recruitee`, `applitrack`, `icims`, `recruitcrm`, `taleo`, and `zoho` are quarantine-only by source-quality protection.

Treat these as the last recorded numbers, not proof of current live state. Re-run the read-only production baseline audit before making new data-quality claims.

## Known Risks

- Some rebuilt rows still need parser-backed normalization or detail-page refetch before country, region, city, remote mode, date, department, and employment fields are fully reliable.
- iCIMS, Applitrack, and other high-volume ATS sources can expose fields only in detail pages or tenant-specific shapes.
- Parser certification is fixture-backed only for a subset of the configured ATS catalog. Do not claim all 60 ATS are certified.
- Meilisearch is derived data. Reindex only after check/dry-run mode and with a rollback plan.
- Production write backfills must be dry-run first, batched, explicit, and approved.
- v1.8.0 has applied the certified-source public dataset rebuild, threshold indexing cleanup, quarantine-only source enforcement, and final replace-mode Meili reindexing. Future repair work must still use the same backup, lock, canary, audit, and rollback process.
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
npm.cmd run ats:workbench
npm.cmd run ats:source:dry-run -- --source=greenhouse --limit=25 --json
npm.cmd run ats:source:canary -- --source=greenhouse --limit=25 --json
npm.cmd run ats:source:apply -- --source=greenhouse --apply --confirm-production --max-updates=100 --json
```

Docs-only work normally needs only:

```powershell
git diff --check
```
