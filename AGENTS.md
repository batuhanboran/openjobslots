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

## Operating And Version Policy

- May 8 lesson: keep this stabilization line in `v1.5.x`. Search, parser, and storage hardening are not a `v2` product rewrite.
- Current stabilization checkpoint is `v1.5.19`; the next stabilization update should increment the patch version unless it is a deliberate product rewrite.
- Current stabilization priority order: parser normalization first, Meilisearch reindex/cleanup second, production parity tests third, image/build cache later.
- After a full Meilisearch replace reindex, mark pre-reindex `search_index_outbox` rows processed so the worker does not replay hundreds of thousands of already-indexed writes.
- Future-use Codex skills installed: `playwright`, `security-best-practices`, `security-threat-model`, `openjobslots-postgres-audit`, `ats-parser-certification`, `openjobslots-search-parity-corpus`, and `openjobslots-detail-page-certifier`. A Codex restart may be needed before newly installed skills load.
- Parser/data incidents must use the OpenJobSlots skills together: `ats-parser-certification` for raw source evidence, `openjobslots-postgres-audit` for production DB/Meili/API parity, and `openjobslots-search-parity-corpus` for large title/filter matrices.

## Search Quality Incident Lessons

- A green UI smoke test is not enough for this product. Search incidents require backend contract tests against the production path: Postgres plus Meilisearch.
- UI smoke tests can miss critical search/filter data intersections. Future search work must run live-like title/country/remote matrices instead of single happy-path queries.
- Any change touching `/postings`, filters, country/region aliases, remote classification, Meilisearch settings, or Postgres fallback search must run a representative search corpus before deployment.
- "Returns rows" is not a passing assertion. Returned rows must match title intent, country intent, region intent, remote intent, hidden/applied/ignored filters, and pagination rules.
- Compare the public API response against direct Postgres rows and Meilisearch hits for each high-risk matrix case before treating a fix as verified.
- Keep a pinned 1000-query local corpus using reviewed static fixtures, not live production DB dumps. For production readiness, also maintain a 10,000+ title-intent parity plan sourced from reviewed public title taxonomies such as O*NET/ESCO or license-reviewed job-title datasets. Include title-only, title plus country, title plus region, title plus country plus remote mode, remote/hybrid/on-site, diacritics, abbreviations, pagination, and hard negative cases.
- Test both search engines: direct Postgres SQL fallback and Meilisearch plus Postgres hydration. Meili zero hits, partial stale hits, hydration underfill, and `hide_no_date` filtering must all be covered.
- Live deploy verification must include correctness probes, not only service health. At minimum test `/postings?search=Director%20United%20States`, `/postings?search=Director%20US`, `/postings?search=t%C3%BCrkiye`, `/postings?search=remote%20engineer`, and one paginated scroll flow that verifies stable offsets, unique rows, and no dropped/duplicated results.
- Diagnose CPU spikes with measurements before changing architecture: `docker stats`, Postgres logs, `pg_stat_activity`, table/index size, dead tuples, Meili task backlog, and query plans. Do not add Redis, another load balancer, or a new database until those measurements show the bottleneck.
- A search bug is not closed until the same query is crossmatched against public `/postings`, direct Postgres rows, and raw Meilisearch hits. Classify the failure as parser/DB, index/outbox/reindex, hydration/filtering, or valid empty intersection.
- Live high-volume search probes can exhaust Docker's default Postgres `/dev/shm` when fallback SQL uses parallel scans. Keep `openjobslots-postgres` configured with explicit `shm_size`, bounded pool sizes, and conservative parallel worker settings before treating 500s as application logic failures.
- Meilisearch visibility filters must require `hidden = false`. Do not use negative filters such as `NOT hidden = true`; legacy or partial index documents without a `hidden` field can pass negative filters, then get dropped by Postgres hydration and force expensive fallback queries.
- Public job result searches should use Meilisearch `matchingStrategy: "all"` so multi-word titles do not silently drop important terms and return misleading broad hits.
- A healthy Meilisearch zero-hit response should return an API zero directly. Do not run full Postgres fallback for every search-index zero; that turns normal empty intersections into slow CPU-heavy queries. Use fallback for Meili errors and hydration underfill, then fix/reindex Meili when index parity is wrong.
- Postgres hydration should not re-run the free-text search after Meili has ranked the hits. Hydration is for public visibility, application-state, and structured guard filters; rechecking fuzzy/tokenized Meili hits with stricter SQL text matching causes underfill and fallback loops.
- Subagents must produce bounded findings or patches, then be closed. The parent agent must not leave agents idle and must integrate the results into code, tests, docs, and deployment decisions.
- Detailed runbook: [Search Quality Runbook](./docs/search-quality-runbook.md).

## ATS And Retention Rules

- Certify existing ATS before broad expansion.
- Normalized sample fixtures are not enough for certification. Certified ATS require saved raw source fixtures that exercise the parser plus expected normalized output.
- New ATS requires source docs, endpoint pattern, rate limits, raw fixtures, expected normalized output, confidence, and adapter notes.
- Missing or nullable location, posting date, and remote fields must be certified from saved source fixtures. Do not assume absence is source truth until the raw fixture proves the source omitted the field or the parser documents why it cannot safely extract it.
- Do not invent posting dates. If the source does not expose a date, leave the date empty and rely on `last_seen_epoch` for freshness.
- Preserve the source id (`id`, `jobId`, requisition id, vacancy id, URL id) as `source_job_id` whenever the source exposes one.
- `dayforcehcm` is configured but disabled by default until parser certification exists.
- Freshness and pruning must use `last_seen_epoch`, not `first_seen_epoch`.
- Default hot/searchable posting window: 90 days after last seen.
- v1.5.17 adds the ATS certification workbench. v1.5.18 stabilizes parser normalization backfill for source date epochs and conservative onsite classification from concrete physical locations. v1.5.19 adds iCIMS/Applitrack saved raw detail fixtures, iCIMS country-code location parsing, explicit iCIMS remote header parsing, Applitrack detail URL certification, and a dry-run-first detail-page backfill tool. Do not mark an ATS as parser-certified unless saved raw fixtures and tests prove geo, date, remote, and source-id behavior, or prove the source omitted a nullable field.
