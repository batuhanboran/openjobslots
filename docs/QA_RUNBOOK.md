# OpenJobSlots QA Runbook

Use this runbook for local verification. It is designed to avoid production DB mutation.

## Baseline Quality Gate

Run the complete safe baseline:

```powershell
npm.cmd run quality:gate
```

The quality gate:

- discovers test scripts from `package.json`;
- runs backend, API, parser, and E2E scripts when available;
- forces `OPENJOBSLOTS_DB_BACKEND=sqlite`;
- forces `OPENJOBSLOTS_SEARCH_BACKEND=sqlite`;
- disables API scheduler and auto sync;
- uses `C:\tmp\openjobslots-quality-gate\jobs.db` when writable;
- falls back to `.tmp\openjobslots-quality-gate\jobs.db` inside the repo when sandbox rules block `C:\tmp`;
- checks local production DB candidates after the run.

Useful variants:

```powershell
npm.cmd run quality:gate -- --skip-e2e
npm.cmd run quality:gate -- --only=backend,api
npm.cmd run quality:gate -- --only=test:backend
```

## Local API Tests

Run API tests directly:

```powershell
$env:OPENJOBSLOTS_TEST_ROOT="C:\tmp\openjobslots-api-test"
$env:OPENJOBSLOTS_DB_BACKEND="sqlite"
$env:OPENJOBSLOTS_SEARCH_BACKEND="sqlite"
$env:OPENJOBSLOTS_DISABLE_API_SCHEDULER="1"
$env:OPENJOBSLOTS_AUTO_SYNC="0"
npm.cmd run test:api
```

The Playwright web server starts `scripts/test/e2e-stack.js`, which prepares an isolated SQLite DB with `scripts/test/setup-e2e-db.js`.

If the sandbox blocks Playwright process spawning with `spawn EPERM`, rerun the same command with approved shell escalation. Do not switch to a live server to bypass the issue.

## Local E2E Tests

Run public UI E2E:

```powershell
$env:OPENJOBSLOTS_TEST_ROOT="C:\tmp\openjobslots-e2e-test"
$env:OPENJOBSLOTS_DB_BACKEND="sqlite"
$env:OPENJOBSLOTS_SEARCH_BACKEND="sqlite"
$env:OPENJOBSLOTS_DISABLE_API_SCHEDULER="1"
$env:OPENJOBSLOTS_AUTO_SYNC="0"
npm.cmd run test:e2e
```

Desktop-only:

```powershell
npm.cmd run test:e2e -- --project=chromium-desktop
```

Mobile-only:

```powershell
npm.cmd run test:e2e -- --project=chromium-mobile
```

## Artifact Inspection

Playwright artifacts are configured in `playwright.config.js`:

- traces retained on failure;
- screenshots captured on failure;
- videos retained on failure;
- HTML report written to `playwright-report`;
- raw artifacts written under `test-results/e2e`.

Inspect the report:

```powershell
npx playwright show-report playwright-report
```

Inspect a trace directly:

```powershell
npx playwright show-trace path\to\trace.zip
```

## Avoid Production DB Mutation

Do not run local tests with production environment variables.

Before API/E2E tests, confirm these are set or intentionally controlled:

```powershell
$env:OPENJOBSLOTS_DB_BACKEND="sqlite"
$env:OPENJOBSLOTS_SEARCH_BACKEND="sqlite"
$env:OPENJOBSLOTS_DISABLE_API_SCHEDULER="1"
$env:OPENJOBSLOTS_AUTO_SYNC="0"
```

Do not point local tests at:

- production Postgres `DATABASE_URL`;
- production Meili `MEILI_HOST` and key;
- `/root/OpenJobSlots/data/jobs.db`;
- the local repo `data/jobs.db` unless it is a disposable copy.

Preferred local DB roots:

- `C:\tmp\openjobslots-quality-gate`
- `C:\tmp\openjobslots-api-test`
- `C:\tmp\openjobslots-e2e-test`

## Production-Like Search Checks

Use these only when the target environment is intentional:

```powershell
npm.cmd run search:parity
npm.cmd run reindex:meili -- --check
```

For live production checks, run them inside the deployed app container and record the commit hash first. Do not run write-mode backfills or full Meili replace reindexes from this baseline prompt.
