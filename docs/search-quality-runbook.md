# OpenJobSlots Search Quality Runbook

This runbook exists because public search correctness is the product. Frontend reload tests and service health checks can pass while the production search path still returns false zeroes, stale rows, or mismatched filters.

## Production Search Contract

The public `/postings` path must be validated as a contract across:

- Postgres source of truth.
- Meilisearch public index.
- Postgres hydration after Meili returns canonical URLs.
- Postgres fallback when Meili is empty, stale, unhealthy, or underfilled after hydration.

A search result is correct only when returned rows match the user's intent. Count-only assertions are not sufficient.

## Root-Cause Decision Tree

Use this order when search results are wrong:

1. Check Postgres rows directly. If Postgres lacks matching visible rows, the issue is ingestion, parser output, hidden state, or retention.
2. Check Meilisearch document count and top hits. If Postgres has rows but Meili does not, the issue is indexing, outbox/delete handling, reindex procedure, or Meili settings.
3. Check hydration. If Meili returns URLs but `/postings` returns fewer rows, the issue is hidden/applied/ignored filtering, `hide_no_date`, stale Meili docs, or pagination underfill.
4. Check fallback. If Meili returns irrelevant nonzero hits while Postgres has good matches, fallback must trigger on hydrated underfill, not only fully empty Meili responses.
5. Check query semantics. If Postgres and Meili disagree on title plus country/region/remote terms, update aliases, normalized fields, synonyms, or tests before deployment.

## Required Search Corpus

Maintain a pinned 200-query corpus. Generate it from public occupational taxonomies or reviewed static fixtures, not from `jobs.db` or production dumps.

Coverage target:

- 80 title-only searches across engineering, sales, support, finance, operations, healthcare, education, legal, marketing, and data.
- 40 title plus country searches, including `US`, `United States`, `UK`, `Turkey`, `Turkiye`, and `Türkiye`.
- 30 title plus region searches for `AMER`, `EMEA`, and `APAC`.
- 30 title plus remote-mode searches for remote, hybrid, and on-site intent.
- 20 edge cases for diacritics, abbreviations, quoted terms, misspellings, and ambiguous titles.

Each case needs at least one positive seeded row and hard negatives: same title in the wrong country, same country with the wrong title, and same title with the wrong remote mode.

## Assertions

Every corpus test should assert:

- First page contains at least one expected canonical URL when a positive exists.
- No returned row violates a structured filter.
- Country aliases map to the same expected country set.
- Region aliases map to the same expected region set.
- Remote queries do not return only on-site rows.
- Quoted and unquoted title queries do not diverge unexpectedly.
- Meilisearch and direct Postgres overlap on expected canonical URLs.
- Pagination returns unique URLs and stable `next_offset`/`has_more`.

## Live Service Checks

Run these only against OpenJobSlots services:

```bash
docker compose --project-directory /root/OpenPostings ps
docker stats --no-stream openjobslots-app openjobslots-worker openjobslots-postgres openjobslots-meilisearch
curl -fsS http://127.0.0.1:8081/health
curl -fsS http://127.0.0.1:8081/sync/status
curl -fsS http://127.0.0.1:8081/ingestion/status
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
- Hydration can underfill pages after hidden/applied/ignored/no-date filters remove Meili hits.
- Postgres fallback search with `lower(unaccent(...)) LIKE` may not use existing trigram indexes.
- Reindex scripts that only upsert visible rows do not remove stale Meili documents unless the index is cleared or deletes are diffed.
- Worker maintenance currently depends on sync runs; retention and search outbox processing should also run on an independent maintenance cadence.
