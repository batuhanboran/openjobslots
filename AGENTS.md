# OpenJobSlots Agent Instructions

These are the canonical operating notes for Codex and human operators working in this repository.

## Read First

For routine Codex runs, start from only the current operating context needed for the task:

1. `handoff.md` - latest handoff and source recovery status.
2. `AGENTS.md` - operator rules, safety constraints, branch/test/deploy expectations.
3. `docs/PROJECT_STATE.md` - current version, deployment status, endpoints, known risks, next tasks.
4. The relevant source module for the requested work.
5. The relevant tests for the requested work.
6. The relevant latest production report when the task depends on live state.

For non-trivial OpenJobSlots work, also use the project-specific Obsidian vault at `C:\Users\BaronPC\Documents\OpenJobSlots Codex Memory`. Start with `README.md` and `Thread Start.md` after the three repo-local files above. Do not read or update the Povly vault for OpenJobSlots work; Povly is a separate project.

Load `README.md` or `docs/reference/` only when the task needs architecture, deployment, runbook, ATS matrix, certification, quality, or search details. Do not use archived or obsolete docs as current production state.

## Product Context

- Public product name: `openjobslots`.
- Public domain target: `openjobslots.com`.
- Main repository: `https://github.com/batuhanboran/openjobslots`.
- Production host: production / `public-services`, checkout `/app`.
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

## Codex Context Hygiene

Keep Codex context focused on current source and state. Do not read dependency trees, generated artifacts, runtime data, stale reports, or obsolete docs unless the user explicitly asks for that path or the task is to clean those artifacts.

Noisy paths are listed in `.codexignore` and include `node_modules/`, `.tmp/`, `reports/`, `backups/`, `test-results/`, `playwright-report/`, `coverage/`, `build/`, `dist/`, `.expo/`, `.cache/`, runtime database files, and dumps.

Current production state lives in `handoff.md`, `docs/PROJECT_STATE.md`, and the latest relevant production report. If local `reports/` content is stale or noisy, regenerate the requested report or read the explicitly named latest live report instead of scanning the whole tree. Historical docs may explain old decisions, but they must not override current handoff or project state.

## Branch, Commit, And Deploy Rules

- Do not deploy live unless the user explicitly asks for deployment.
- For requested code/doc work, commit finished changes unless the user explicitly asks for local-only work.
- Use the existing branch unless the user asks for a hardening branch or the task instructions name one.
- Do not depend on GitHub CLI. Normal `git` commands are enough unless a GitHub-specific task requires the connector.
- After a successful push intended for production, verify production alignment with the deployment runbook:
  - `git -C /app rev-parse HEAD`
  - `docker compose --project-directory /app ps`
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

## Technical Gotchas & Workarounds

- **Docker multiplexing headers:** stdout from `proxmox-docker/docker_exec` may contain 8-byte binary headers (`\x01\x00\x00\x00...`) or null bytes. Clean files by slicing from the first `{` and stripping null/control bytes before parsing as JSON.
- **SPA Crawling (Workday etc.):** Static fetch on Workday URLs (`myworkdayjobs.com`) returns empty templates. Flag these as restricted by default, or query their internal endpoints.
- **PostgreSQL Regex boundaries:** Postgres POSIX regular expressions use `\y` instead of `\b` for word boundaries.

## Job Auditing Best Practices

- **Headless Browser Scraping:** Always use Playwright on the host with `page.evaluate(() => document.body.textContent)` to extract job descriptions. This ensures JSON-LD structured job postings (common on BambooHR, Workday) are fully captured even if elements are hidden or slow to render.
- **Double Epoch Verification:** To guarantee a job is fresh (posted within the target window), ensure both `first_seen_epoch >= now - X` and `posted_at_epoch >= now - X` are satisfied. This filters out refreshed or bumped old postings.
- **Strict Geo-Residency Validation:** Inspect scraped content for any US-only, Canada-only, or timezone-restricted keywords (e.g. EST/PST only) before classifying a job as "Worldwide/EMEA remote".
- **Specialized Subagent Division:** For large-scale audits, split tasks into Extraction, Crawling, Company Research, and QC subagents to ensure deep quality verification over raw speed.
- **Zoho & Freshteam Fallback Parsing:** When scraping Zoho Recruit, search for `<script>JSON.parse('...')</script>` blocks and decode them. For Freshteam, extract the `<div class="job-details-content content">` container when standard description selectors fail.
- **LLM Verification Priority:** Treat LLM-based subagent evaluations as the primary source of truth. Do not override `ineligible` classifications with simple regex matches, as boilerplate text triggers false positives.
- **Spam Company Blacklisting:** Filter out high-volume spam duplicate postings (e.g. from `fyst`/`FYST`) during post-processing by checking the company name and canonical URL.
- **Remote Deployment via Docker Containers:** When running `docker compose` inside a helper container via `/var/run/docker.sock`, always pass `-p openjobslots` to prevent container name conflicts with the host stack. Bind-mount `/root/.ssh` (read-only) for secure git access within the container.



