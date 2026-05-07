# OpenJobSlots Agent Operating Notes

These notes are for Codex and subagents working in this repository.

## Product

- Public product name: `openjobslots`.
- Public site/domain: `openjobslots.com`.
- Main repository: `https://github.com/batuhanboran/openjobslots`.
- Hosted runtime: production / `public-services` at `internal-host`, checkout `/root/OpenJobSlots`.
- Expected project services on production: `openjobslots-app`, `openjobslots-worker`, `openjobslots-postgres`, `openjobslots-meilisearch`.

## Git And Deployment

- User expects code changes to be committed and pushed to `main` unless they explicitly ask for local-only work.
- The production deploy key only needs read access. Do not grant write access unless there is a separate server-side push workflow.
- After pushing, verify production is on the same commit with:
  - `git -C /root/OpenJobSlots rev-parse HEAD`
  - `docker compose --project-directory /root/OpenJobSlots ps`
  - `curl -fsS http://127.0.0.1:8081/health`
- The production auto-deploy timer is `openjobslots-deploy.timer`.
- If auto-deploy fetch fails, check `/var/log/openjobslots-deploy.log`.
- The deploy script may use a specific SSH identity. A plain interactive `git fetch` can fail while the timer succeeds; use the deploy log and service status as the source of truth.
- Known public deploy key to register in GitHub deploy keys if auto-fetch fails:
  `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINaPPI85y7u/XcHIlczDKuCp6amyhbQyvE+w+4BqQxdr openjobslots-production-deploy`
- If GitHub SSH deploy key is still not registered, manual alignment can be done with a git bundle over SSH, then rebuilding app and worker:
  - `docker compose --project-directory /root/OpenJobSlots up -d --build openjobslots-app openjobslots-worker`

## Data Safety

- Do not commit `jobs.db`, `jobs.db-shm`, `jobs.db-wal`, `/data`, backups, or live database dumps.
- `jobs.db` is local/runtime data. It belongs in local/server storage, not Git.
- Production source of truth is Postgres; Meilisearch is the public search index.
- Public release notes must not expose tokens, host secrets, internal credentials, stack traces, or security-sensitive deployment details.
- Public endpoints must not return private application state, personal settings, agent credentials, raw filesystem paths, stack traces, or upstream parser/debug payloads.

## Security Checklist

- Run `npm.cmd audit` after dependency changes and do not use `npm audit fix --force` without reviewing breaking changes.
- Keep patched transitive dependency overrides current when upstream packages lag security advisories.
- Docker images must not copy runtime databases, dumps, `.env` files, logs, or backup data. Keep `.dockerignore` strict.
- Production Docker builds should use lockfile installs (`npm ci`) and should not depend on mutable local `node_modules`.
- Public search returns only public posting fields. Application state and MCP/application settings belong behind admin/session auth.
- Deploy keys should be read-only by default.
- Treat ATS/company URLs as untrusted input. Add central SSRF controls before broad parser expansion: scheme allowlist, redirect revalidation, DNS/private-IP blocking, response-size limits, and host validation where possible.
- Keep public `/health`, `/sync/status`, and `/ingestion/status` coarse. Detailed diagnostics belong under admin routes.
- Public frontend logging must be bounded, redacted, and rotated before high-traffic launch.

## Development Expectations

- Keep public UI search-first and admin controls hidden from public users.
- This frontend currently uses React Native Web `StyleSheet`, not Tailwind. Do not introduce Tailwind or a new styling stack unless the app architecture is intentionally changed.
- Job results should be progressive: keep the first page small, append more results on scroll, and avoid rendering hundreds of cards at once.
- Existing public endpoints should remain compatible: `/postings`, `/postings/filter-options`, `/search/suggest`, `/sync/status`, `/ingestion/status`, `/health`.
- Verify meaningful changes with `npm.cmd run test:backend`; use Playwright desktop/mobile when UI changes.
- When using subagents, give each a bounded lane: frontend/UI, backend/data, parser/ATS, security/services, desktop QA, mobile QA. The parent agent remains responsible for integration and final deployment.

## ATS And Retention Rules

- Certify existing ATS before broad expansion.
- Normalized sample fixtures are not enough for certification. Certified ATS require saved raw source fixtures that exercise the parser plus expected normalized output.
- New ATS requires source docs, endpoint pattern, rate limits, raw fixtures, expected normalized output, confidence, and adapter notes.
- Do not invent posting dates. If the source does not expose a date, leave the date empty and rely on `last_seen_epoch` for freshness.
- Preserve the source id (`id`, `jobId`, requisition id, vacancy id, URL id) as `source_job_id` whenever the source exposes one.
- `dayforcehcm` is configured but disabled by default until parser certification exists.
- Freshness and pruning must use `last_seen_epoch`, not `first_seen_epoch`.
- Default hot/searchable posting window: 90 days after last seen.
