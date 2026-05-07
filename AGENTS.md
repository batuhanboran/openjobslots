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
- After pushing, verify production is on the same commit with:
  - `git -C /root/OpenJobSlots rev-parse HEAD`
  - `docker compose --project-directory /root/OpenJobSlots ps`
  - `curl -fsS http://127.0.0.1:8081/health`
- The production auto-deploy timer is `openjobslots-deploy.timer`.
- If auto-deploy fetch fails, check `/var/log/openjobslots-deploy.log`.
- Known public deploy key to register in GitHub deploy keys if auto-fetch fails:
  `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINaPPI85y7u/XcHIlczDKuCp6amyhbQyvE+w+4BqQxdr openjobslots-production-deploy`
- If GitHub SSH deploy key is still not registered, manual alignment can be done with a git bundle over SSH, then rebuilding app and worker:
  - `docker compose --project-directory /root/OpenJobSlots up -d --build openjobslots-app openjobslots-worker`

## Data Safety

- Do not commit `jobs.db`, `jobs.db-shm`, `jobs.db-wal`, `/data`, backups, or live database dumps.
- `jobs.db` is local/runtime data. It belongs in local/server storage, not Git.
- Production source of truth is Postgres; Meilisearch is the public search index.
- Public release notes must not expose tokens, host secrets, internal credentials, stack traces, or security-sensitive deployment details.

## Development Expectations

- Keep public UI search-first and admin controls hidden from public users.
- Existing public endpoints should remain compatible: `/postings`, `/postings/filter-options`, `/search/suggest`, `/sync/status`, `/ingestion/status`, `/health`.
- Verify meaningful changes with `npm.cmd run test:backend`; use Playwright desktop/mobile when UI changes.
- When using subagents, give each a bounded lane: frontend/UI, backend/data, parser/ATS, security/services, desktop QA, mobile QA. The parent agent remains responsible for integration and final deployment.

## ATS And Retention Rules

- Certify existing ATS before broad expansion.
- New ATS requires source docs, endpoint pattern, rate limits, fixtures, expected normalized output, confidence, and adapter notes.
- `dayforcehcm` is configured but disabled by default until parser certification exists.
- Freshness and pruning must use `last_seen_epoch`, not `first_seen_epoch`.
- Default hot/searchable posting window: 90 days after last seen.
