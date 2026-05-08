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
- uses `C:\tmp\openpostings-quality-gate\jobs.db` when writable;
- falls back to `.tmp\openpostings-quality-gate\jobs.db` inside the repo when sandbox rules block `C:\tmp`;
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
$env:OPENPOSTINGS_TEST_ROOT="C:\tmp\openpostings-api-test"
$env:OPENJOBSLOTS_DB_BACKEND="sqlite"
$env:OPENJOBSLOTS_SEARCH_BACKEND="sqlite"
$env:OPENPOSTINGS_DISABLE_API_SCHEDULER="1"
$env:OPENJOBSLOTS_AUTO_SYNC="0"
npm.cmd run test:api
```

The Playwright web server starts `scripts/test/e2e-stack.js`, which prepares an isolated SQLite DB with `scripts/test/setup-e2e-db.js`.

If the sandbox blocks Playwright process spawning with `spawn EPERM`, rerun the same command with approved shell escalation. Do not switch to a live server to bypass the issue.

## Local E2E Tests

Run public UI E2E:

```powershell
$env:OPENPOSTINGS_TEST_ROOT="C:\tmp\openpostings-e2e-test"
$env:OPENJOBSLOTS_DB_BACKEND="sqlite"
$env:OPENJOBSLOTS_SEARCH_BACKEND="sqlite"
$env:OPENPOSTINGS_DISABLE_API_SCHEDULER="1"
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

Current public UI coverage includes:

- desktop and mobile first-load smoke checks;
- search typing, Enter submit, Escape clear, `/` focus, and Ctrl/Cmd+K focus;
- suggestion panel placement;
- Clear reset behavior;
- filter open/close, option search, selection, and clearing;
- combined search and filter states;
- controlled no-results state;
- transient database-busy stale-results behavior;
- status panel success and failure sanitization;
- release notes open/close behavior on desktop;
- public-route security checks and raw backend error text checks;
- mobile horizontal-overflow and tap-target checks.

## Artifact Inspection

Playwright artifacts are configured in `playwright.config.js`:

- traces retained on failure;
- screenshots captured on failure;
- videos retained on failure;
- HTML report written to `playwright-report`;
- raw artifacts written under `test-results/e2e`.

The E2E public-page helpers also record console errors and failed browser requests in their failure arrays. Treat those as UI regressions unless the test deliberately stubs a backend failure.

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
$env:OPENPOSTINGS_DISABLE_API_SCHEDULER="1"
$env:OPENJOBSLOTS_AUTO_SYNC="0"
```

Do not point local tests at:

- ltx100 Postgres `DATABASE_URL`;
- production Meili `MEILI_HOST` and key;
- `/root/OpenPostings/data/jobs.db`;
- the local repo `data/jobs.db` unless it is a disposable copy.

Preferred local DB roots:

- `C:\tmp\openpostings-quality-gate`
- `C:\tmp\openpostings-api-test`
- `C:\tmp\openpostings-e2e-test`

## Production-Like Search Checks

Use these only when the target environment is intentional:

```powershell
npm.cmd run search:parity
npm.cmd run reindex:meili -- --check
```

For live ltx100 checks, run them inside the deployed app container and record the commit hash first. Do not run write-mode backfills or full Meili replace reindexes from this baseline prompt.
