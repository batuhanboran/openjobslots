# OpenJobSlots Search Quality Runbook

This runbook exists because public search correctness is the product. Frontend reload tests and service health checks can pass while the production search path still returns false zeroes, stale rows, or mismatched filters. UI smoke tests have missed critical title/country/remote data intersections, so verification must exercise the live-like data contract, not only page rendering.

## Production Search Contract

The public `/postings` path must be validated as a contract across:

- Postgres source of truth.
- Meilisearch public index.
- Postgres hydration after Meili returns canonical URLs.
- Postgres fallback when Meili is empty, stale, unhealthy, or underfilled after hydration.

A search result is correct only when returned rows match the user's intent. Count-only assertions are not sufficient.

For high-risk changes, compare three views of the same case before declaring success:

- Public API response from `/postings`.
- Direct Postgres rows and filters against the source-of-truth postings table.
- Meilisearch hits before Postgres hydration.

The comparison must explain differences such as stale Meili documents, hydration underfill, `hide_no_date` filtering, hidden/applied/ignored rows, or fallback behavior.

Production parity tests must compare all three layers for the same query and filters:

- `/postings` public API rows, including paging metadata.
- Raw Meilisearch hits before hydration.
- Direct Postgres source-of-truth rows after equivalent visibility and structured filters.

Do not treat service health, HTTP status, or count-only checks as production parity. Passing parity means the same expected canonical URLs appear, forbidden rows stay out, and every difference between API, Meili, and Postgres has an explained cause.

## v1.6 Search Settings Baseline

Search settings are centralized in `server/search/config.js`. Do not add new country aliases, stop words, or Meili settings in a second module; update the shared config and the matching tests.

Expected Meili settings:

- Searchable attributes are ordered for relevance: `title`, normalized title, `company`, normalized company, location/city/state/country/region, work mode/source/facets, and `description_plain` last.
- Filterable attributes cover public filters and hydration guards: `ats_key`, `country`, `region`, `city`, `state`, `remote_type`, `industry`, `department`, `employment_type`, `company`, `hidden`, `last_seen_epoch`, `posted_at_epoch`, and `posting_date`.
- Sortable attributes are `last_seen_epoch` and `posted_at_epoch`.
- Ranking rules remain `sort`, `words`, `typo`, `proximity`, `attribute`, `exactness` so explicit recency sort stays predictable while attribute order still helps relevance.
- Synonyms include country aliases for Turkey/Turkiye/Turkiye-with-diacritic, common Turkey typos, US/UK aliases, remote/WFH aliases, and hybrid aliases.
- Stop words include generic intent words such as `job`, `jobs`, `opening`, `openings`, `careers`, `hiring`, `role`, `position`, and `vacancy`, so `remote jobs` searches as `remote` instead of matching generic noise.

Reindex verification:

```bash
npm run search:reindex:check
npm run search:parity -- --limit=20 --query="turkish jobs" --query="turkyie" --query="remote jobs"
```

When check mode reports missing Meili documents or stale facet documents, prefer a bounded upsert repair before replace mode:

```bash
npm run reindex:meili -- --repair-document-upserts --document-repair-limit=100 --json
npm run reindex:meili -- --repair-document-upserts --document-repair-limit=100 --apply --confirm-production --preflight-report=<fresh_preflight_report> --json
```

The first command is the default dry-run plan. Apply mode requires the production-safety preflight report path. For this document-upsert repair, a preflight whose only unsafe finding is the current Meili/Postgres delta is acceptable because the repair targets that drift; backup proof, worker isolation, autodeploy safety, no active heavy-job lock, no unsafe long-running queries, production commit proof, and saved before metrics are still required. The remote-facet inspection samples overrepresented facets through search first, then falls back to filtered Meili `/documents` scans when search hit caps hide enough stale facet rows. The repair refuses apply when the missing-document or remote-facet mismatch sample is incomplete or the candidate set exceeds the bounded repair limit.

Only run a replace reindex after parser/backfill/refetch changes have been tested and the check command reports settings mismatches, stale documents, count drift, or remote facet drift that a normal outbox catch-up cannot fix. Replace mode builds a temporary index, applies the production settings, loads Postgres-visible/indexable rows, validates count/facets/sample searches, and swaps only after validation passes. The previous live index remains preserved at the temporary UID after the swap.

```bash
npm run search:reindex:replace -- --dry-run --temp-index-suffix=v161-preflight
npm run search:reindex:replace -- --apply --confirm-production --temp-index-suffix=v161-YYYYMMDD-HHMM
```

Replace-mode validation fails before swap when:

- temp index settings differ from `server/search/config.js`;
- temp document count differs from Postgres visible/indexable count;
- `remote_type` facet distribution differs from Postgres;
- sampled Postgres rows differ from their temp-index Meili documents;
- sample searches fail against the temp index.

`/sync/status`, `/ingestion/status`, and `/admin/storage` expose bounded `search_reindex` status:

- current index UID;
- last settings apply;
- last replace reindex state;
- last count delta;
- last remote facet delta;
- last task error.

Diagnosing Meili versus SQLite/Postgres differences:

1. Check `/admin/storage` for `db_backend`, `search_backend`, and `search_settings.last_error`.
2. Run `npm run search:reindex:check` to verify settings, document count, remote facets, sample searches, and indexed fields.
3. Run `npm run search:parity` with the exact query and filters.
4. If SQLite fallback differs, check whether `server/index.js`, `server/backends/postgresStore.js`, and `server/search/meili.js` all use `server/search/config.js` token and alias helpers.
5. If Meili returns stale URLs, repair through the durable outbox or replace reindex; do not manually delete documents without a follow-up parity run.

## May 8, 2026 Live Findings

The May 8 live probe did not show a search-service availability failure:

- Probe corpus: 4,000 queries from O*NET official occupation titles.
- HTTP results: 4,000/4,000 returned `200`.
- Latency: median `6.9ms`, p95 `15.5ms`.
- Result distribution: `3,250` zero-result searches and `750` nonzero searches.

Current Meilisearch storage and memory are explainable for the observed live index size:

- Indexed documents: about `750,144`.
- Meili volume size: about `1.5GB`.
- Raw exported document payload estimate: about `298MB`.
- Meili RSS after the probe: about `2.5GB`.

This is not, by itself, evidence that Meili is leaking memory or that the index should be manually purged. Treat it as normal indexed-data overhead unless repeated measurements show unbounded growth after document count, settings, and task backlog are stable.

Operational policy from these findings:

- Parser normalization must improve before aggressive search-index cleanup. Premature cleanup can delete or hide rows that are only mismatched because parser fields are inconsistent.
- After parser normalization changes, run `npm run backfill:normalization` in dry-run mode first. A real run may fill missing `country`, `region`, and `remote_type` from existing visible rows where `location_text` or title signals already contain enough evidence; it does not invent posting dates.
- After detail-page parser changes, run `npm run refetch:details:dry-run -- --source=<ats> --limit=<n> --company-limit=<n>` first. This tool is for sampled/budgeted repair of rows whose list payload omitted fields; do not run an unbounded detail crawl. Guarded apply requires `--apply --confirm-production --backup-confirmed --max-updates=N`.
- Stale or hidden Meili documents must be removed through durable delete/reindex work, not one-off manual cleanup.
- Production parity tests must compare `/postings`, Meili hits, and Postgres source-of-truth rows before declaring cleanup or search changes successful.

v1.5.13 production repair result:

- Backfilled `254,694` existing Postgres rows from stored location/title signals.
- Reindexed `722,591` visible postings into Meilisearch.
- Active rows with both `country` and `region` increased from `96,686` to `337,606`.
- Active rows missing `country` or `region` decreased from `625,905` to `384,985`.
- Remaining misses are mostly source/parser gaps where the stored row lacks enough evidence; `icims`, `applitrack`, and `workday` need direct parser/detail-fetch work, not only alias expansion.

## Live-Like Intersection Matrices

Search and filter changes must run a live-like matrix that crosses title intent, country/region intent, and remote mode. A useful matrix includes at least:

- Title only: exact, partial, abbreviation, diacritic, and hard negative terms.
- Title plus country: common country names and aliases, including `US`, `United States`, `UK`, `United Kingdom`, `Turkey`, and `Turkiye`.
- Title plus remote mode: remote, hybrid, and on-site rows with same-title hard negatives in the wrong mode.
- Title plus country plus remote mode: same title in multiple countries and remote modes, so one dimension cannot mask another failure.

Each matrix case should assert the expected canonical URLs, rejected hard negatives, and parity notes across API, Postgres, and Meili.

## Root-Cause Decision Tree

Use this order when search results are wrong:

1. Check Postgres rows directly. If Postgres lacks matching visible rows, the issue is ingestion, parser output, hidden state, or retention.
2. Check Meilisearch document count and top hits. If Postgres has rows but Meili does not, the issue is indexing, outbox/delete handling, reindex procedure, or Meili settings.
3. Check hydration. If Meili returns URLs but `/postings` returns fewer rows, the issue is hidden/applied/ignored filtering, `hide_no_date`, stale Meili docs, or pagination underfill.
4. Check fallback. If Meili returns irrelevant nonzero hits while Postgres has good matches, fallback must trigger on hydrated underfill, not only fully empty Meili responses.
5. Check query semantics. If Postgres and Meili disagree on title plus country/region/remote terms, update aliases, normalized fields, synonyms, or tests before deployment.

## Index Cleanup And Reindexing

Cleanup is allowed only after the parser emits normalized fields consistently enough for deletes and replacements to be trusted. Before scheduling cleanup, confirm the affected parser family preserves stable canonical URLs, hidden state, posting dates, location fields, remote mode, and source job identifiers.

Use durable outbox-driven work for search-index mutation:

- Enqueue deletes when a posting becomes hidden, stale, removed, or replaced.
- Enqueue upserts when normalized public fields change.
- Retry failed Meili tasks until the outbox item is acknowledged or explicitly quarantined.
- Reconcile by comparing Postgres visible rows with Meili document IDs, then enqueue the missing delete/upsert work.

Manual Meili deletes or full index clears are emergency procedures only. If used, follow with a documented full reindex and parity test run that compares `/postings`, raw Meili hits, and Postgres rows for representative title/country/remote cases.

## Required Search Corpus

Maintain a pinned 1000-query local corpus. Generate it from reviewed static fixtures or public occupational taxonomies, not from `jobs.db` or production dumps.

O*NET official occupation titles are an approved public taxonomy source for query probes and corpus expansion. Record the source and date when generating a corpus snapshot so later runs can distinguish corpus drift from search behavior changes.

For production-readiness probes, maintain a separate 10,000+ title-intent parity plan. The expanded corpus may use O*NET and ESCO as primary public taxonomies, plus license-reviewed broad title vocabulary such as `jneidel/job-titles` only after reuse policy is accepted. Do not commit huge raw third-party dumps by default; commit generator code and a provenance manifest with source URL, source date/version, license note, transform hash, and generated fixture hash. Keep raw title dumps and generated large case files in ignored local artifacts or CI artifacts unless legal review approves redistribution.

Coverage target:

- 80 title-only searches across engineering, sales, support, finance, operations, healthcare, education, legal, marketing, and data.
- 40 title plus country searches, including `US`, `United States`, `UK`, `Turkey`, `Turkiye`, and `Türkiye`.
- 30 title plus region searches for `AMER`, `EMEA`, and `APAC`.
- 30 title plus remote-mode searches for remote, hybrid, and on-site intent.
- 20 edge cases for diacritics, abbreviations, quoted terms, misspellings, and ambiguous titles.

Each case needs at least one positive seeded row and hard negatives: same title in the wrong country, same country with the wrong title, and same title with the wrong remote mode.

The large parity corpus should preserve these dimensions:

- Title intent: exact, partial, alternate, abbreviation, seniority, punctuation, quoted/unquoted, typo, diacritic, and locale variants.
- Geography: country aliases, city aliases, region aliases, country/region mismatch, and ambiguous aliases such as `US`, `UK`, `Turkey`, `Turkiye`, and `Türkiye`.
- Work mode: `all`, `remote`, `hybrid`, and `onsite/unknown`, including query words and structured filter modes.
- Visibility and state: hidden, applied, ignored, no posting date, stale Meili-only documents, Postgres-only rows, and hydration underfill.
- Pagination: first, middle, and last pages with unique URLs, stable `next_offset`, and correct `has_more`.

## Assertions

Every corpus test should assert:

- First page contains at least one expected canonical URL when a positive exists.
- No returned row violates a structured filter.
- Country aliases map to the same expected country set.
- Region aliases map to the same expected region set.
- Remote queries do not return only on-site rows.
- Quoted and unquoted title queries do not diverge unexpectedly.
- Meilisearch and direct Postgres overlap on expected canonical URLs.
- Scroll and paging semantics return unique URLs, stable `next_offset`/`has_more`, and no dropped or duplicated rows when the UI appends pages.
- API, Postgres, and Meili differences are recorded and either expected or fixed.

## Live Service Checks

Run these only against OpenJobSlots services:

```bash
docker compose --project-directory /app ps
docker stats --no-stream openjobslots-app openjobslots-worker openjobslots-postgres openjobslots-meilisearch
curl -fsS http://127.0.0.1:8081/health
curl -fsS http://127.0.0.1:8081/sync/status
curl -fsS http://127.0.0.1:8081/ingestion/status
curl -fsS "http://127.0.0.1:8081/postings?search=Director%20United%20States&limit=20"
curl -fsS "http://127.0.0.1:8081/postings?search=Director%20US&limit=20"
curl -fsS "http://127.0.0.1:8081/postings?search=remote%20engineer&limit=20"
curl -fsS "http://127.0.0.1:8081/postings?search=remote%20engineer&limit=20&offset=20"
```

Postgres inspection:

```bash
docker exec openjobslots-postgres psql -U openjobslots -d openjobslots -c "select state, wait_event_type, wait_event, count(*) from pg_stat_activity where datname='openjobslots' group by 1,2,3 order by 4 desc;"
docker exec openjobslots-postgres psql -U openjobslots -d openjobslots -c "select relname,n_live_tup,n_dead_tup,last_autovacuum,last_autoanalyze from pg_stat_user_tables order by n_dead_tup desc limit 20;"
docker exec openjobslots-postgres psql -U openjobslots -d openjobslots -c "select count(*) filter (where hidden=false) as visible, count(*) as total_rows, count(*) filter (where hidden=true) as hidden, count(*) filter (where first_seen_epoch >= extract(epoch from now() - interval '24 hours')) as new_24h, count(*) filter (where last_seen_epoch >= extract(epoch from now() - interval '24 hours')) as seen_24h from postings;"
```

Meilisearch inspection:

```bash
docker exec openjobslots-meilisearch wget -qO- http://127.0.0.1:7700/health
docker exec openjobslots-meilisearch wget -qO- --header="Authorization: Bearer $MEILI_MASTER_KEY" http://127.0.0.1:7700/tasks?limit=20
```

## Performance Rules

- Keep the four-service v1 layout unless measurements prove otherwise: app, worker, Postgres, Meilisearch.
- Do not add Redis for v1 public search unless multiple app replicas need shared cache, queue throughput exceeds Postgres-backed control tables, or measured cache miss pressure justifies it.
- Do not add another load balancer while Nginx Proxy Manager is already the ingress.
- Tune Postgres and queries before changing database systems.
- Move high-frequency suggestions and count-heavy public reads toward Meilisearch or short TTL caches.
- Enable `pg_stat_statements` before deeper query tuning so expensive SQL is measured, not guessed.

## Known Risk Areas

- Meili may return stale or partial hits while Postgres has correct rows.
- Meili visibility must be positive: public search should filter `hidden = false`. A negative filter like `NOT hidden = true` can include legacy documents where the field is missing, causing hydration underfill and heavy Postgres fallback.
- Meili result search should set `matchingStrategy: "all"` for public postings. The default strategy can drop trailing terms from multi-word job titles, which creates irrelevant hits that Postgres later drops during hydration.
- A healthy Meili zero should be treated as a zero. Running Postgres fallback for every zero-result intersection makes valid empty searches expensive and can create CPU spikes during corpus probes.
- Hydration should not re-run free-text matching. Meili owns text relevance; Postgres hydration should enforce visibility and structured guards so fuzzy/tokenized Meili hits are not dropped by stricter SQL `LIKE` checks.
- Hydration can underfill pages after hidden/applied/ignored/no-date filters remove Meili hits.
- Title/country/remote intersections can fail even when each dimension passes alone.
- UI infinite scroll can hide API paging bugs unless offsets, uniqueness, and appended result counts are asserted.
- High-volume live probes can hit public rate limits and can expose Postgres shared-memory pressure when Meili hydration falls back to SQL. Throttle probes, record `429` separately from correctness failures, and check app logs for `/dev/shm` errors before changing query semantics.
- Postgres fallback search with `lower(unaccent(...)) LIKE` may not use existing trigram indexes.
- Reindex scripts that only upsert visible rows do not remove stale Meili documents unless the index is cleared or deletes are diffed.
- Hidden, removed, or parser-replaced postings can remain searchable if delete events are not written to and processed from a durable outbox.
- Worker maintenance currently depends on sync runs; retention and search outbox processing should also run on an independent maintenance cadence.
