# OpenJobSlots Agent Instructions

These are the canonical operating notes for Codex and human operators working in this repository.

## Read First

1. `AGENTS.md` - operator rules, safety constraints, branch/test/deploy expectations.
2. `README.md` - project overview, local setup, architecture summary.
3. `docs/PROJECT_STATE.md` - current version, deployment status, endpoints, known risks, next tasks.
4. `docs/reference/` - detailed runbooks and certification records relevant to the task.
5. `docs/archive/` - historical plans and notes. Read only when tracing why a decision was made.

## Product Context

- Public product name: `openjobslots`.
- Public domain target: `openjobslots.com`.
- Main repository: `https://github.com/batuhanboran/openjobslots`.
- Production host: production / `public-services`, checkout `/root/OpenJobSlots`.
- Expected production services: `openjobslots-app`, `openjobslots-worker`, `openjobslots-postgres`, `openjobslots-meilisearch`.
- Current production architecture: Node API/static web app, separate ingestion worker, Postgres source-of-truth DB, Meilisearch public search index.
- SQLite remains useful for local fallback, migration/import paths, and isolated tests. Do not treat it as the intended production source of truth unless `docs/PROJECT_STATE.md` says the backend changed.

## Documentation Map

- Current state and risks: `docs/PROJECT_STATE.md`.
- Deployment operations: `docs/reference/deployment.md`.
- Search correctness and Meili/Postgres parity: `docs/reference/search-quality-runbook.md`.
- Ingestion and worker operations: `docs/reference/ingestion-runbook.md`.
- ATS parser matrix: `docs/reference/ats-adapter-matrix.md`.
- Parser certification rules: `docs/reference/parser-certification.md` and `docs/reference/ats-source-certification.md`.
- Data quality diagnostics: `docs/reference/data-quality-runbook.md`.
- Retention rules: `docs/reference/data-retention.md`.
- QA and Playwright/API testing: `docs/reference/QA_RUNBOOK.md`.
- End-user docs site content: `docs-site/`.

## Branch, Commit, And Deploy Rules

- Do not deploy live unless the user explicitly asks for deployment.
- For requested code/doc work, commit finished changes unless the user explicitly asks for local-only work.
- Use the existing branch unless the user asks for a hardening branch or the task instructions name one.
- Do not depend on GitHub CLI. Normal `git` commands are enough unless a GitHub-specific task requires the connector.
- After a successful push intended for production, verify production alignment with the deployment runbook:
  - `git -C /root/OpenJobSlots rev-parse HEAD`
  - `docker compose --project-directory /root/OpenJobSlots ps`
  - `curl -fsS http://127.0.0.1:8081/health`
- The production auto-deploy timer is `openjobslots-deploy.timer`; the deploy log is `/var/log/openjobslots-deploy.log`.

## Data Safety

- Do not commit runtime databases, WAL/SHM files, dumps, backups, logs, `.env`, or generated production data.
- Specifically exclude `jobs.db`, `jobs.db-shm`, `jobs.db-wal`, `/data`, `.deploy-backups/`, and database exports.
- Public release notes and UI must not expose tokens, internal host secrets, private paths, stack traces, raw parser payloads, or security-sensitive deployment details.
- Public endpoints should return only public posting/status fields. Application state, MCP/application settings, and deep diagnostics belong behind admin/session controls.
- Do not run production write backfills, replace-mode Meili reindex, schema-destructive migrations, or cleanup jobs without explicit approval and a rollback path.

## Test Rules

Use the smallest safe test set that proves the change:

- Backend/search/parser changes: `npm.cmd run test:backend`, `npm.cmd run test:api`, and `npm.cmd run test:parsers` when available.
- UI changes: `npm.cmd run test:e2e` plus relevant backend/API tests.
- Broad hardening or release work: `npm.cmd run quality:gate`.
- Search or Meili changes: also run `npm.cmd run search:parity` or the relevant check mode described in `docs/reference/search-quality-runbook.md`.
- Docs-only changes do not require the app test suite unless a docs/build tool is changed. Run `git diff --check` at minimum.

## Implementation Rules

- Keep public UI search-first. Do not expose admin controls, protected settings, raw API addresses, stack traces, or internal parser errors on the public page.
- Any ATS/parser/source-quality/data-quality recovery prompt must explicitly say: "Use the openjobslots-ats-recovery skill."
- Preserve public endpoint compatibility unless the user explicitly asks for a breaking change:
  - `/health`
  - `/postings`
  - `/postings/filter-options`
  - `/search/suggest`
  - `/sync/status`
  - `/ingestion/status`
- Search correctness requires public API, Postgres, and Meilisearch parity. A UI smoke test alone is not sufficient.
- Parser certification requires saved raw fixtures, expected normalized output, validation tests, parser version, confidence, and documented nullable fields. Do not mark an ATS certified from normalized fixtures alone.
- Do not invent posting dates, countries, regions, cities, remote state, or source IDs. Store `null`/`unknown` when source evidence is absent.
- Freshness and pruning use `last_seen_epoch`, not `first_seen_epoch`.
- The frontend currently uses React Native Web `StyleSheet`, not Tailwind. Do not introduce a new styling stack without an explicit architecture decision.

## Subagent Rules

- Use subagents only when the user explicitly requests delegation or parallel agent work.
- Keep each subagent lane bounded: frontend/UI, backend/data, parser/ATS, security/services, desktop QA, mobile QA, or research.
- Close or repurpose agents when their task is complete. Do not leave idle agents running.
- The parent agent remains responsible for integration, tests, docs, and deployment decisions.

## Security Baseline

- Run `npm.cmd audit` after dependency changes.
- Do not use `npm audit fix --force` without reviewing breaking changes.
- Docker builds must not copy runtime DBs, dumps, `.env`, logs, or backups.
- Production builds should use lockfile installs and should not depend on mutable local `node_modules`.
- Treat ATS/company URLs as untrusted input. Central SSRF protections are required before broad parser expansion: scheme allowlist, redirect revalidation, DNS/private-IP blocking, response-size limits, and host validation.
- Keep public `/health`, `/sync/status`, and `/ingestion/status` coarse. Detailed diagnostics belong in admin routes.

## Current Operating Priority

See `docs/PROJECT_STATE.md` for the current version, deployment state, and next tasks. As of the v1.6 line, the priority order is:

1. Parser/location/date/remote/source-id data quality.
2. Safe dry-run backfills and detail-page certification.
3. Meilisearch reindex/check-mode parity after normalized fields improve.
4. Production parity tests using realistic search corpora.
5. Build/image/dependency cleanup after correctness is stable.
