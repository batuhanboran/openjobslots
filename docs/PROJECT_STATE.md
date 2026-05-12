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

Important interpretation:

- `v1.8.0` improved many quality percentages mostly by shrinking the public dataset during the certified-source rebuild.
- Future work must not treat lower coverage as quality progress.
- Treat the last recorded `47,396` visible postings as the coverage floor until a fresh read-only production baseline replaces it.

## Post-v1.8.0 Recovery Strategy

The next phase is ATS-by-ATS recovery, not another broad cleanup or rebuild.

Hard rules:

- Do not run a clean public dataset rebuild.
- Do not truncate `postings`, `posting_cache`, the active Meili index, source configuration, company configuration, or source quality state.
- Do not lower visible count.
- Do not disable or quarantine-only a source if doing so removes existing public rows.
- Do not restore dirty backup rows from `v1.6.2`, `v1.8.0`, or their reports into public search. Use those reports only as reference evidence.
- Keep Postgres as source of truth. Meili is derived data and should be reindexed only after source recovery writes improve Postgres/source data.

Recovery model:

- Work one ATS at a time.
- Prefer tenant/source-level recovery over source-wide disabling.
- Ambiguous rows should be skipped and logged, not used as a reason to fail the whole task.
- If a source cannot be recovered, keep it quarantine-only and record tenant-level failure reasons plus the exact next parser evidence needed.

Success criteria for every ATS recovery task:

- Accepted public rows for that ATS increase.
- Visible count does not decrease.
- Missing geo/remote decreases for existing rows, or newly accepted rows do not add bad `no_geo_no_remote` rows.
- If no improvement is possible, report exact tenant/source/error reasons.

Non-success criteria:

- Parser fixtures alone are not success.
- Tests alone are not success.
- A source wave is successful only if production accepted public rows increase or source-level missing geo/remote improves without decreasing visible count.

## Next Prompt Contract

Each future prompt/run must:

1. Read `handoff.md` and `docs/PROJECT_STATE.md` first.
2. Run a fresh current live baseline before making data-quality claims.
3. Compare before/after visible count and source-level quality.
4. Preserve coverage; visible count must not decrease for ATS recovery work.
5. Update `handoff.md` with the latest source recovery status.

## Known Risks

- Some rebuilt rows still need parser-backed normalization or detail-page refetch before country, region, city, remote mode, date, department, and employment fields are fully reliable.
- iCIMS, Applitrack, and other high-volume ATS sources can expose fields only in detail pages or tenant-specific shapes.
- Parser certification is fixture-backed only for a subset of the configured ATS catalog. Do not claim all 60 ATS are certified.
- Meilisearch is derived data. Reindex only after check/dry-run mode and with a rollback plan.
- Production write backfills must be dry-run first, batched, explicit, and approved.
- `v1.8.0` has applied the certified-source public dataset rebuild, threshold indexing cleanup, quarantine-only source enforcement, and final replace-mode Meili reindexing. Do not repeat that rebuild strategy.
- Source disable/quarantine changes can reduce coverage. Block them when they would remove existing public rows.
- Future repair work must use the same backup, lock, canary, audit, and rollback process, but the success target is source recovery without visible-count loss.
- Cloudflare/analytics CSP alignment and dependency version cleanup are separate maintenance tasks.

## Next Tasks

1. Read `handoff.md` and this file before planning any source or data-quality work.
2. Run a fresh read-only production baseline: visible count, accepted public rows by source, source-level geo/remote gaps, quarantine reasons, and Meili/Postgres delta.
3. Prioritize ATS-by-ATS source recovery by live field gaps and recoverable tenant/source evidence.
4. For each ATS recovery task, prove accepted public rows increased or source-level missing geo/remote improved without decreasing visible count.
5. Skip and log ambiguous rows instead of failing the whole task.
6. For unrecovered sources, keep quarantine-only and record tenant-level failure reasons plus exact parser/detail evidence needed next.
7. Run Meilisearch check-mode parity only after source recovery writes improve Postgres/source data; replace reindex remains a controlled follow-up, not the recovery mechanism.
8. Keep public search parity tests active for Turkey/Turkiye/Türkiye, remote, common title/country combinations, and pagination uniqueness.
9. Keep documentation changes consolidated in this file plus `handoff.md` and `docs/reference/`.

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
```

Use production apply commands only inside a scoped ATS recovery task after the fresh baseline, dry-run/canary evidence, heavy-job lock check, and before/after acceptance criteria are ready.

Docs-only work normally needs only:

```powershell
git diff --check
```
