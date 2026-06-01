# OpenJobSlots Ingestion Runbook

This runbook covers the v1.6 ingestion worker path. It is operational documentation only; it does not require a live deploy.

## Runtime Model

- Production compose runs the API and worker as separate containers.
- `OPENJOBSLOTS_DISABLE_API_SCHEDULER=1` disables the legacy in-process API scheduler in production compose.
- Postgres is the production source of truth when `OPENJOBSLOTS_DB_BACKEND=postgres`.
- Meilisearch is the public search index when `OPENJOBSLOTS_SEARCH_BACKEND=meili`.
- SQLite remains the local/test fallback and still uses WAL plus `busy_timeout`.
- Sync control is stored in Postgres `sync_control`; pg-boss code exists but is not the active queue path.
- Heavy source jobs use the global `openjobslots_heavy_job` advisory lock plus `ats_source_runs` audit tables.

## Sync Flow

1. `/sync/start` marks `sync_control.status=requested`.
2. The worker polls control state and selects due companies from `companies`, `ats_sources`, and `company_sync_state`.
3. The worker fetches and parses targets concurrently, then writes cache/read-model updates through bounded transactions.
4. Each target updates `company_sync_state` independently, so one failed company does not block the run.
5. Successful targets schedule the next sync using the ATS TTL plus deterministic jitter.
6. Failed targets schedule retry with exponential backoff, then a longer cooldown after repeated failures.
7. The worker records `ingestion_runs` counters and bounded `ingestion_run_errors`.
8. Retention and Meilisearch outbox maintenance are worker jobs, not public API reads.

## Guarded ATS Source Runs

Use the source runner for source-specific parser repair, not ad hoc fetch loops:

```powershell
npm.cmd run ats:source:dry-run -- --source=<ats> --limit=25 --json
npm.cmd run ats:recovery:preflight -- --json --system-report=<system_report> --expected-commit=<sha> --backup-path=<backup> --output=<preflight_report>
npm.cmd run ats:source:canary -- --source=<ats> --limit=25 --confirm-production --backup-confirmed --worker-isolated --planned-batch=<report> --preflight-report=<preflight_report> --preflight-max-age-minutes=60 --predicted-guard-result=pass --json
npm.cmd run ats:source:apply -- --source=<ats> --apply --confirm-production --backup-confirmed --worker-isolated --max-updates=100 --planned-batch=<report> --preflight-report=<preflight_report> --preflight-max-age-minutes=60 --predicted-guard-result=pass --json
```

The runner acquires the global heavy-job lock, uses bounded Postgres statement timeouts, serializes fetches per host, records canary/apply metrics in `ats_source_runs`, and refuses canary/apply operations without explicit production flags, backup confirmation, worker isolation proof, recovery readiness, a validated tenant batch plan, a fresh passing preflight report, and a passing predicted guard. Apply writes additionally require `--max-updates=N`. The preflight report must include parseable `generated_at` within the freshness window, prove a non-empty backup file exists under `backups/`, expected/actual production commit is documented, Meili/Postgres delta is `0`, no heavy job or long-running Postgres query is active, autodeploy is safe, and the worker is stopped/paused or isolated. `--worker-paused` is accepted as an alias for `--worker-isolated`. Dry-run mode does not write public postings.

## Cache Freshness Rules

- `posting_cache.canonical_url` is the durable cache key.
- Cache change detection uses normalized payload hash, parser version, validation status, and validation error.
- Unchanged cache payloads are freshness touches: `last_seen_epoch` updates, while `first_seen_epoch` remains stable.
- Changed payloads update normalized cache fields and parser metadata.
- Valid postings update the read model; invalid rows are rejected and counted as parser attention.
- Duplicate canonical URLs in a single target are counted and skipped before read-model writes.

## Scheduling And Backoff

- `ats_sources.default_ttl_seconds` controls normal refresh cadence.
- `computeNextSyncEpoch` adds deterministic jitter to avoid bursts.
- Consecutive failures use exponential backoff.
- `no_jobs` failures start with `INGESTION_NO_JOBS_COOLDOWN_SECONDS` and progressively back off on repeated empty-board results before the long failure cooldown.
- After `INGESTION_MAX_CONSECUTIVE_FAILURES` failures, the target enters a longer cooldown controlled by `INGESTION_FAILURE_COOLDOWN_SECONDS`.
- Disabled ATS sources are excluded from due-target selection.
- Worker startup marks stale `running`/`stopping` runs as `interrupted` and clears stale sync control.

## Throughput Budget Gate

Use `npm run audit:source-freshness -- --json` and `npm run audit:worker-backlog -- --diagnostics --json` before changing worker budget or targets per run. Increase throughput only when target success is at least `80%`, Meili/Postgres delta is `0`, no heavy job is active, `parser_attention_unresolved_count` is clean, due-by-ATS does not show a single failing source consuming the queue, and the last 24 hours added `0` new `no_geo_no_remote` public rows.

When the gate is not clean, keep the current budget and fix the dominant failure reason first: `parser_bug`, `source_quality`, `rate_limit`, `network`, `empty_no_jobs`, or `auth`. Do not use a higher budget to compensate for low success rate.

## Status And Diagnostics

Public coarse endpoints:

- `GET /sync/status`
- `GET /ingestion/status`

Admin diagnostics:

- `GET /admin/ingestion/runs?limit=25`
- `GET /admin/ingestion/errors?limit=50`
- `GET /admin/ingestion/sources?limit=100`
- `GET /admin/parsers`
- `GET /admin/parsers/:ats_key`

Useful fields:

- `cache_write_count`: changed cache rows.
- `cache_hit_count`: unchanged cache freshness touches.
- `posting_upsert_count`: valid postings sent to the read model.
- `rejected_count`: invalid/parser-rejected postings.
- `duplicate_count`: duplicate canonical URLs skipped inside a target.
- `db_busy_count`: transient SQLite busy retries observed by the worker.
- `http_status_counts`: bounded HTTP status buckets from fetch failures.
- `current_ats`, `current_company_url`, `current_company_name`: latest safe worker target state.
- `heavy_job`: advisory lock visibility for heavy backfill/refetch/reindex/source-run jobs.
- `source_jobs`: active and recent guarded ATS source canary/apply runs.

## Diagnosing A Failed ATS Or Company

1. Check `/ingestion/status` for current worker state and parser attention count.
2. Check `/admin/ingestion/errors` for recent bounded error samples.
3. Check `/admin/parsers/:ats_key` for fixture status, confidence, field quality, and recent parser errors.
4. Check `/admin/ingestion/sources` for due count, last success, last failure, and failure pressure.
5. If a parser issue is confirmed, add a saved raw fixture and a failing parser test before changing normalization.

## Safe Worker Restart

1. Use `/sync/stop` first if a manual run is active.
2. Restart only the worker container when possible.
3. On startup, the worker marks stale running rows interrupted and clears stale `sync_control` running/stopping state.
4. Confirm `/ingestion/status` returns `idle`, `queued`, or `running` with a fresh latest run.
5. Do not run production write backfills or full Meili replace reindex from this restart path.

## Test Commands

```powershell
npm.cmd run test:parsers
npm.cmd run test:backend
npm.cmd run test:api
npm.cmd run quality:gate
```

The quality gate uses an isolated DB and verifies production DB files are unchanged.
