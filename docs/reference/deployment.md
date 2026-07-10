# OpenJobSlots Deployment

Production source of truth is the private GitHub repository:

`https://github.com/batuhanboran/openjobslots`

The production host runs the app from `<app-dir>` and deploys from the release branch. An auto-deploy watcher pulls the release branch and rebuilds the Docker Compose stack only when it changes, preserving runtime data in `.env`, `data/`, and `.deploy-backups/`.

## Production Services

- `openjobslots-app`
- `openjobslots-worker`
- `openjobslots-postgres`
- `openjobslots-meilisearch`
- the auto-deploy watcher

These four services are the intended v1 runtime. Do not add Redis, a second reverse proxy, or another database engine until measured query, queue, or cache pressure proves the need.

## Deploy Access

The production host pulls the release branch using a read-only GitHub deploy key scoped to this repository. Use read-only access; write access is not needed.

## Useful Commands

```bash
docker compose --project-directory <app-dir> ps
curl -fsS http://127.0.0.1:8081/health
curl -fsS "http://127.0.0.1:8081/postings?search=Director%20United%20States&limit=5"
curl -fsS "http://127.0.0.1:8081/postings?search=t%C3%BCrkiye&limit=5"
```

Search correctness checks are part of deployment verification. Service health alone does not prove that Postgres, Meilisearch, and hydration agree. See [Search Quality Runbook](./search-quality-runbook.md).

## Worker Sync Budget

The worker keeps manual sync controls available, but automatic Postgres syncs are budgeted so idle due-target pressure does not turn into continuous fetch/write load.

- `OPENJOBSLOTS_AUTO_SYNC`: set to `0` to disable automatic sync scheduling. Manual sync requests still work.
- `INGESTION_WORKER_INTERVAL_MS`: minimum delay between automatic budget checks. Compose defaults to `1800000` ms.
- `INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET`: maximum company targets automatic sync may start per UTC day. Compose defaults to `3000`; set to `0` for a reversible pause of automatic sync work.
- `INGESTION_AUTO_SYNC_TARGETS_PER_RUN`: maximum automatic targets per run. Compose defaults to `50`.
- `INGESTION_SOURCE_DAILY_TARGET_BUDGET`: maximum successful automatic targets per ATS per UTC day. Compose defaults to `250`.
- `INGESTION_MAX_TARGETS_PER_RUN`: hard per-run ceiling for worker runs. Compose defaults to `125`; manual requested syncs may continue across runs until due targets drain.
- `INGESTION_WORKER_CONCURRENCY`: concurrent worker target processors. Compose defaults to `2`; per-host concurrency remains serialized by default.
- `INGESTION_ADAPTIVE_SELECTION_LOOKBACK_HOURS`: recent success/failure and error-signal window for adaptive ATS source caps. Compose defaults to `24`.
- `OPENJOBSLOTS_HRMDIRECT_DETAIL_FETCH_LIMIT_PER_COMPANY`: HRMDirect detail-page cap per company. Compose defaults to `35` so large sparse HRMDirect boards cannot stall an automatic worker run; raise only during targeted HRMDirect recovery windows.
- `INGESTION_DUE_TARGET_CANDIDATE_MULTIPLIER`: over-select factor for due target candidates before source budget and protection filtering. Worker code defaults to `8`.
- `INGESTION_DUE_TARGET_CANDIDATE_MAX`: hard ceiling for due-target candidate selection. Compose defaults to `2500`.

The daily budget is conservative and restart-safe because the worker counts targets already recorded in `ingestion_runs` since UTC midnight before starting another automatic run. Manual requested syncs are not blocked by the budget, but their recorded targets count against later automatic work for the same day.
To temporarily return to the May 27 high-throughput stage, override `INGESTION_WORKER_CONCURRENCY=3`, `INGESTION_WORKER_INTERVAL_MS=600000`, `INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET=18000`, `INGESTION_AUTO_SYNC_TARGETS_PER_RUN=300`, and `INGESTION_SOURCE_DAILY_TARGET_BUDGET=1000` in the production environment only after worker health, Meili/Postgres parity, and host memory pressure are clean.

## Runtime Memory Guardrails

Compose sets memory and swap ceilings for the four production services. Defaults are:

- `OPENJOBSLOTS_POSTGRES_MEM_LIMIT=1536m` and `OPENJOBSLOTS_POSTGRES_MEMSWAP_LIMIT=1536m`.
- `OPENJOBSLOTS_MEILI_MEM_LIMIT=4096m` and `OPENJOBSLOTS_MEILI_MEMSWAP_LIMIT=4096m`.
- `OPENJOBSLOTS_APP_MEM_LIMIT=768m` and `OPENJOBSLOTS_APP_MEMSWAP_LIMIT=768m`.
- `OPENJOBSLOTS_WORKER_MEM_LIMIT=768m` and `OPENJOBSLOTS_WORKER_MEMSWAP_LIMIT=768m`.

App and worker Node heaps are separately bounded with `OPENJOBSLOTS_APP_NODE_OLD_SPACE_MB=384` and `OPENJOBSLOTS_WORKER_NODE_OLD_SPACE_MB=512`. Keep `memswap_limit` equal to `mem_limit` unless you intentionally want a service to use host swap.

Public `/postings` requests are also clamped before query execution with `OPENJOBSLOTS_PUBLIC_POSTINGS_MAX_LIMIT=500` and `OPENJOBSLOTS_PUBLIC_POSTINGS_MAX_OFFSET=2000`. Responses include `page_capped=true` when a caller asks beyond those bounds.

Public read responses use a short in-process TTL cache with same-key in-flight request coalescing. Compose defaults are `OPENJOBSLOTS_PUBLIC_READ_CACHE_TTL_MS=120000` and `OPENJOBSLOTS_PUBLIC_READ_CACHE_MAX_ENTRIES=750`. This is intentionally long enough to keep expensive `/postings/filter-options` cache misses from fanning out into parallel Postgres aggregation bursts while still keeping public filter and status data fresh within a small operational window.

## Container DNS

The app and worker containers use explicit external DNS resolvers through Compose (`OPENJOBSLOTS_DNS_PRIMARY`, `OPENJOBSLOTS_DNS_SECONDARY`; defaults `8.8.4.4` and `149.112.112.112`) so high-volume ATS fetches are not dependent only on the host/router resolver. If production shows recurrent `getaddrinfo EAI_AGAIN` errors, verify the container `/etc/resolv.conf` and run lookup probes from `openjobslots-worker` before increasing throughput further.
DNS lookup retry behavior is also bounded in-process: `OPENJOBSLOTS_DNS_LOOKUP_TIMEOUT_MS` defaults to `8000`, `OPENJOBSLOTS_DNS_LOOKUP_RETRIES` defaults to `1`, and `OPENJOBSLOTS_DNS_LOOKUP_RETRY_DELAY_MS` defaults to `250`. Keep these values high enough for Docker's embedded resolver to answer under load; too-low timeouts can convert recoverable DNS lookups into worker-wide timeout failures.

## Postgres Observability

`pg_stat_statements` is preloaded for Postgres through Compose with `shared_preload_libraries=pg_stat_statements`, and the worker creates the extension on startup when `OPENJOBSLOTS_ENABLE_PG_STAT_STATEMENTS=1`.

To disable the runtime change, set `OPENJOBSLOTS_ENABLE_PG_STAT_STATEMENTS=0` for the worker and set `OPENJOBSLOTS_POSTGRES_SHARED_PRELOAD_LIBRARIES=` before recreating Postgres. The extension object can remain installed; removing the preload stops statement tracking after the container restart.

## Rollback

Each successful deploy creates a git bundle in `<app-dir>/.deploy-backups/` before resetting to the new commit. Runtime databases and Docker volumes are not deleted by the deploy watcher.

## v1.6.0 Deployment Note - May 8, 2026

Deployed version: `v1.6.0`.

Pre-final SQLite backup:

`<app-dir>/data/jobs.db.backup-v1.6.0-20260508-193325`

Validation run before deployment:

- `npm.cmd run test:backend`
- `npm.cmd run test:api`
- `npm.cmd run test:parsers`
- `npm.cmd run test:e2e`
- `npm.cmd run build:web`
- `npm.cmd run quality:gate`

Live endpoints checked after deployment:

- `/health`
- `/postings/filter-options`
- `/search/popular`
- `/sync/status`
- `/ingestion/status`
- `/postings?search=turkish%20jobs`
- `/postings?search=t%C3%BCrkiye`
- `/postings?search=turkiye`
- `/postings?search=turkyie`
- `/postings?search=remote%20jobs`
- `/postings?search=software`

Release verification also checked the public UI at `https://openjobslots.com/`, the `Public v1.6.0` version rail, the `Version 1.6.0` release note, and absence of visible raw SQLite/backend errors.

Known remaining risks:

- Production Meilisearch currently has six stale/bad visible documents beyond the Postgres indexable count; reindex check reports settings valid and the delta is explainable, but a replace-mode reindex should be scheduled after the next normalization backfill.
- Cloudflare Insights injects a beacon script that is blocked by the app CSP. This does not block the app, but the CSP/Cloudflare analytics configuration should be aligned before public launch analytics are required.
- Expo reports package compatibility warnings during tests/build. The release is validated, but dependency version alignment should be handled in a separate dependency-maintenance pass.

## v1.6.1 Deployment Note - May 9, 2026

Deployed version: `v1.6.1`.

Pre-deploy Postgres backup:

`<app-dir>/backups/postgres-openjobslots-v1.6.1-predeploy-20260509-004527.dump`

SQLite fallback/import backup:

`<app-dir>/backups/jobs.db-v1.6.1-predeploy-20260509-004527.sqlite`

Validation run before deployment:

- `npm.cmd run test:backend`
- `npm.cmd run test:api`
- `npm.cmd run test:parsers`
- `npm.cmd run test:e2e`
- `npm.cmd run build:web`
- `npm.cmd run quality:gate`

Production dry-run report paths for this release:

- `<app-dir>/reports/data-quality-audit-v1.6.1.json`
- `<app-dir>/reports/geo-remote-dry-run-v1.6.1.json`
- `<app-dir>/reports/icims-detail-dry-run-v1.6.1.json`
- `<app-dir>/reports/applitrack-detail-dry-run-v1.6.1.json`
- `<app-dir>/reports/meili-reindex-check-v1.6.1.json`

Release scope:

- Accurate data-quality summaries and parser stats derived from stored rows.
- Read-only production audit command.
- Dry-run geo/remote backfill planning.
- Guarded production apply and rollback support for normalized geo/remote/quality backfill.
- Guarded iCIMS and Applitrack detail refetch tooling.
- Safe Meili replace-mode reindex checks.

This deployment does not apply production data backfill, does not apply production detail-refetch writes, and does not run a production Meili replace reindex.

## v1.6.2 Deployment Note - May 11, 2026

Deployed version: `v1.6.2`.

Production backups used during the guarded repair cycle:

- `<app-dir>/backups/postgres-openjobslots-pre-safe-backfill-20260511T134757Z.dump`
- `<app-dir>/backups/postgres-openjobslots-pre-icims-refetch-20260511T143123Z.dump`
- `<app-dir>/backups/postgres-openjobslots-pre-applitrack-refetch-20260511T152424Z.dump`
- `<app-dir>/backups/postgres-openjobslots-pre-ats-gap-repair-20260511T153524Z.dump`

Production repair run ids:

- Existing-evidence safe backfill: `geo-remote-1778316380890-8c4fe406`
- iCIMS detail refetch: `detail-refetch-1778510197418-e8ac10d8`
- Applitrack detail refetch: `detail-refetch-1778513106495-94ce31bb`, `detail-refetch-1778513243719-53235def`
- Manatal/source gap repair: `geo-remote-1778513767362-f270034e`

Final report paths:

- `<app-dir>/reports/data-quality-before-final-meili-reindex-20260511T183424Z.json`
- `<app-dir>/reports/meili-check-before-final-reindex-20260511T183424Z.json`
- `<app-dir>/reports/meili-replace-final-reindex-20260511T183424Z.json`
- `<app-dir>/reports/meili-check-after-final-reindex-20260511T183424Z.json`
- `<app-dir>/reports/data-quality-final-after-meili-reindex-20260511T183424Z.json`

Validation run before release metadata deployment:

- `npm.cmd run test:backend`

Live endpoints checked after final reindex:

- `/health`
- `/postings/filter-options`
- `/search/popular`
- `/sync/status`
- `/ingestion/status`
- `/ingestion/quality/summary`
- `/ingestion/parser-stats`
- `/postings?search=turkish%20jobs`
- `/postings?search=t%C3%BCrkiye`
- `/postings?search=turkiye`
- `/postings?search=remote%20jobs`

Final data/search state:

- Visible postings: `737,433`.
- Postgres indexable postings: `737,427`.
- Meilisearch documents: `737,427`.
- Meili/Postgres count delta: `0`.
- Meili remote facets match the Postgres-derived indexed payload distribution.
- Missing country improved from `310,154` to `306,410`.
- Missing city improved from `705,133` to `554,991`.
- Missing any normalized geo improved from `709,884` to `560,188`.
- Missing all normalized geo improved from `305,403` to `301,213`.
- Weak/unknown remote improved from `285,715` to `283,989`.
- Missing all geo plus weak/unknown remote improved from `266,010` to `262,542`.

The final replace-mode Meili reindex used a temp index, validated document count and remote facets before swap, and did not delete the live index before validation passed.

## v1.8.0 Deployment Note - May 12, 2026

Deployed version: `v1.8.0`.

Release scope:

- ATS-specific source modules and source-runner controls.
- Certification workbench coverage for the configured ATS catalog.
- Direct JSON/API, enterprise/detail, and HTML/public-sector parser waves.
- Threshold-based indexing: public rows require parser/source quality evidence, while failing rows are quarantined.
- Certified-source public dataset rebuild from source-specific scripts.
- Quarantine-only enforcement for sources failing source-quality thresholds.
- Final replace-mode Meili reindex with Postgres parity verification.

Backup:

- `<app-dir>/backups/postgres-openjobslots-pre-certified-rebuild-20260512-155252.dump`

Final report paths:

- `<app-dir>/reports/certified-rebuild-20260512-155252-final2-audit-data-quality-before-reindex.json`
- `<app-dir>/reports/certified-rebuild-20260512-155252-final2-source-quality.json`
- `<app-dir>/reports/certified-rebuild-20260512-155252-final2-meili-replace-reindex.json`
- `<app-dir>/reports/v180-final-20260512-175855-data-quality.json`
- `<app-dir>/reports/v180-final-20260512-175855-ats-quality.json`
- `<app-dir>/reports/v180-postdeploy-20260512-181223-endpoint-ingestion_source-quality.json`
- `<app-dir>/reports/v180-postdeploy-20260512-181223-endpoint-ingestion_quarantine-summary.json`
- `<app-dir>/reports/v180-postdeploy-20260512-181223-meili-check.json`

Final data/search state:

- Visible postings: `47,396`.
- Postgres indexable postings: `47,395`.
- Meilisearch documents: `47,395`.
- Meili/Postgres count delta: `0`.
- Missing country: `3,113` / `6.57%`.
- Missing city: `5,039` / `10.63%`.
- Missing any normalized geo: `6,824` / `14.40%`.
- Missing all normalized geo: `1,328` / `2.80%`.
- Weak/unknown remote: `1,855` / `3.91%`.
- Missing all geo plus weak/unknown remote: `22` / `0.05%`.
- Source states: `20` public-enabled, `6` quarantine-only, `36` disabled.
- Quarantine-only sources: `recruitee`, `applitrack`, `icims`, `recruitcrm`, `taleo`, and `zoho`.

The final replace-mode Meili reindex used a temp index, validated document count and remote facets before swap, and did not delete the live index before validation passed.

## v1.7.0 Deployment Note - May 12, 2026

Deployed version: `v1.7.0`.

Release scope:

- Parser quality gate for public-row acceptance versus quarantine/rejection.
- ATS certification workbench and source quality scoreboard.
- Wave A parser repairs for iCIMS, Applitrack, Manatal, Taleo, and Workday.
- Wave B parser repairs for the next highest-impact certified/partial sources.
- Controlled clean public dataset rebuild from certified/public-enabled sources.
- Continuous source quality protection with bad-row thresholds and parser drift diagnostics.
- Final replace-mode Meili reindex and Postgres/Meili parity verification.

Final report paths:

- `<app-dir>/reports/final-data-quality-audit-20260512-105705.json`
- `<app-dir>/reports/final-ats-quality-audit-20260512-105705.json`
- `<app-dir>/reports/final-parser-stats-20260512-105705.json`
- `<app-dir>/reports/final-quarantine-summary-20260512-105705.json`
- `<app-dir>/reports/final-source-quality-20260512-105705.json`
- `<app-dir>/reports/meili-check-before-v170-20260512-105758.json`
- `<app-dir>/reports/meili-replace-v170-20260512-105758.json`
- `<app-dir>/reports/meili-check-after-v170-20260512-105758.json`

Final data/search state:

- Visible postings: `65,251`.
- Postgres indexable postings: `65,251`.
- Meilisearch documents: `65,251`.
- Meili/Postgres count delta: `0`.
- Missing country: `11,610` / `17.79%`.
- Missing city: `10,565` / `16.19%`.
- Missing any normalized geo: `19,223` / `29.46%`.
- Missing all normalized geo: `2,952` / `4.52%`.
- Weak/unknown remote: `8,452` / `12.95%`.
- Missing all geo plus weak/unknown remote: `189` / `0.29%`.
- Accepted/quarantined/rejected rows are tracked by source quality diagnostics; Applitrack is auto-disabled by the source-quality policy.

The final replace-mode Meili reindex used a temp index, validated document count and remote facets before swap, and did not delete the live index before validation passed.
