# OpenJobSlots

OpenJobSlots is a public job-search engine that collects public ATS job postings, normalizes them into one schema, and serves fast search/filter results through a web UI.

The current production direction is:

- Node/Express API serving public endpoints and static web assets.
- Separate ingestion worker for ATS sync, parsing, cache updates, and maintenance.
- Postgres as the source-of-truth database.
- Meilisearch as the public search index.
- SQLite kept for local fallback, import/migration paths, and isolated tests.

## Documentation Map

Read these first:

- Operator instructions: [AGENTS.md](AGENTS.md)
- Current state: [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md)
- Deployment runbook: [docs/reference/deployment.md](docs/reference/deployment.md)
- QA runbook: [docs/reference/QA_RUNBOOK.md](docs/reference/QA_RUNBOOK.md)

Detailed references:

- Search quality: [docs/reference/search-quality-runbook.md](docs/reference/search-quality-runbook.md)
- Ingestion: [docs/reference/ingestion-runbook.md](docs/reference/ingestion-runbook.md)
- ATS parser matrix: [docs/reference/ats-adapter-matrix.md](docs/reference/ats-adapter-matrix.md)
- Parser certification: [docs/reference/parser-certification.md](docs/reference/parser-certification.md)
- ATS source certification: [docs/reference/ats-source-certification.md](docs/reference/ats-source-certification.md)
- Data quality: [docs/reference/data-quality-runbook.md](docs/reference/data-quality-runbook.md)
- Retention: [docs/reference/data-retention.md](docs/reference/data-retention.md)
- Historical plans: [docs/archive/](docs/archive/)
- End-user docs site: [docs-site/](docs-site/)

## Features

- Search public postings by title, company, location, country, region, ATS/source, and remote mode.
- Normalize jobs from many ATS sources into one posting schema.
- Track ingestion/cache state and parser attention for diagnostics.
- Keep public UI search-first while preserving admin/internal diagnostics behind API boundaries.
- Support Meilisearch for typo-tolerant search and Postgres fallback/parity checks.

For the current ATS list and certification state, use [docs/reference/ats-adapter-matrix.md](docs/reference/ats-adapter-matrix.md).

## Architecture Summary

Production compose is expected to run four OpenJobSlots services:

- `openjobslots-app`: Node API plus built web app.
- `openjobslots-worker`: ingestion worker.
- `openjobslots-postgres`: source-of-truth database.
- `openjobslots-meilisearch`: public search index.

Nginx Proxy Manager / Cloudflare are external ingress pieces, not app services in this repo.

## Local Setup

Requirements:

- Node.js 18+ or newer compatible with the current Expo/React Native stack.
- npm.
- Docker only when testing the production-like stack locally.

Install dependencies:

```powershell
cd OpenJobSlots
npm install
```

Start the API locally:

```powershell
npm run server
```

Start the web UI locally:

```powershell
npm run web
```

Default local endpoints:

- Web UI: `http://localhost:8081`
- API: `http://localhost:8787`

Run the ingestion worker locally only when you intentionally want local sync behavior:

```powershell
npm run ingestion:worker
```

## Useful Scripts

```powershell
npm run test:backend
npm run test:api
npm run test:parsers
npm run test:e2e
npm run quality:gate
npm run search:parity
npm run reindex:meili -- --check
npm run audit:ats-quality
npm run backfill:normalization -- --dry-run
```

Use `docs/reference/QA_RUNBOOK.md` before running E2E/API tests that need an isolated DB or test stack.

## Public API Summary

Public-compatible routes:

- `GET /health`
- `GET /postings`
- `GET /postings/filter-options`
- `GET /search/suggest`
- `GET /sync/status`
- `GET /ingestion/status`

Admin/control/diagnostic routes exist in the server, but public UI work should not require protected settings or raw diagnostics. See `AGENTS.md` and `docs/PROJECT_STATE.md` before changing API boundaries.

## Data Safety

Do not commit runtime data:

- `jobs.db`
- `jobs.db-shm`
- `jobs.db-wal`
- `data/`
- database dumps
- backups
- `.env`
- deployment logs

Production data belongs on the server and in Docker volumes. Repository fixtures should be small, non-sensitive samples used for tests.

## Legacy Client And Docs Site

This repository still contains legacy Windows/Android/MCP/apply-agent surfaces and a `docs-site/` tree. They are preserved, but the active public product direction is the hosted search engine described above.
