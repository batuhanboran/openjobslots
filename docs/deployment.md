# OpenJobSlots Deployment

Production source of truth is the private GitHub repository:

`https://github.com/batuhanboran/openjobslots`

The production host runs `/root/OpenJobSlots` and deploys from `main` using a systemd timer. The timer checks GitHub every minute, rebuilds the Docker Compose stack only when `main` changes, and preserves runtime data in `.env`, `data/`, and `.deploy-backups/`.

## production Services

- `openjobslots-app`
- `openjobslots-worker`
- `openjobslots-postgres`
- `openjobslots-meilisearch`
- `openjobslots-deploy.timer`

These four services are the intended v1 runtime. Do not add Redis, a second reverse proxy, or another database engine until measured query, queue, or cache pressure proves the need.

## Deploy Key

The server uses `REDACTED` as a read-only GitHub deploy key. Add the public key to GitHub at:

`Settings -> Deploy keys -> Add deploy key`

Use read-only access. Write access is not needed.

## Useful Commands

```bash
systemctl status openjobslots-deploy.timer
systemctl start openjobslots-deploy.service
journalctl -u openjobslots-deploy.service -n 100 --no-pager
tail -n 100 /var/log/openjobslots-deploy.log
docker compose --project-directory /root/OpenJobSlots ps
curl -fsS http://127.0.0.1:8081/health
curl -fsS "http://127.0.0.1:8081/postings?search=Director%20United%20States&limit=5"
curl -fsS "http://127.0.0.1:8081/postings?search=t%C3%BCrkiye&limit=5"
```

Search correctness checks are part of deployment verification. Service health alone does not prove that Postgres, Meilisearch, and hydration agree. See [Search Quality Runbook](./search-quality-runbook.md).

## Worker Sync Budget

The worker keeps manual sync controls available, but automatic Postgres syncs are budgeted so idle due-target pressure does not turn into continuous fetch/write load.

- `OPENJOBSLOTS_AUTO_SYNC`: set to `0` to disable automatic sync scheduling. Manual sync requests still work.
- `INGESTION_WORKER_INTERVAL_MS`: minimum delay between automatic budget checks. Compose defaults to `1800000` ms.
- `INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET`: maximum company targets automatic sync may start per UTC day. Compose defaults to `250`; set to `0` for a reversible pause of automatic sync work.
- `INGESTION_AUTO_SYNC_TARGETS_PER_RUN`: maximum automatic targets per run. Compose defaults to `50`.
- `INGESTION_MAX_TARGETS_PER_RUN`: hard per-run ceiling for worker runs. Compose keeps this at `500`; manual requested syncs may continue across runs until due targets drain.

The daily budget is conservative and restart-safe because the worker counts targets already recorded in `ingestion_runs` since UTC midnight before starting another automatic run. Manual requested syncs are not blocked by the budget, but their recorded targets count against later automatic work for the same day.

## Postgres Observability

`pg_stat_statements` is preloaded for Postgres through Compose with `shared_preload_libraries=pg_stat_statements`, and the worker creates the extension on startup when `OPENJOBSLOTS_ENABLE_PG_STAT_STATEMENTS=1`.

To disable the runtime change, set `OPENJOBSLOTS_ENABLE_PG_STAT_STATEMENTS=0` for the worker and set `OPENJOBSLOTS_POSTGRES_SHARED_PRELOAD_LIBRARIES=` before recreating Postgres. The extension object can remain installed; removing the preload stops statement tracking after the container restart.

## Rollback

Each successful deploy creates a git bundle in `/root/OpenJobSlots/.deploy-backups/` before resetting to the new commit. Runtime databases and Docker volumes are not deleted by the deploy watcher.

## v1.6.0 Deployment Note - May 8, 2026

Deployed version: `v1.6.0`.

Pre-final SQLite backup:

`/root/OpenJobSlots/data/jobs.db.backup-v1.6.0-20260508-193325`

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
