# OpenJobSlots Data Retention

OpenJobSlots uses Postgres as the source of truth and Meilisearch as the public search index. Freshness is based on `last_seen_epoch`, not `first_seen_epoch`, so still-visible jobs are not hidden just because they were first discovered earlier.

## Defaults

| Data | Default |
| --- | --- |
| Public searchable postings | 90 days after `last_seen_epoch` |
| Hidden normalized posting rows | 180 days after `last_seen_epoch` |
| Posting cache metadata | 365 days |
| Ingestion run summaries | 365 days |
| Detailed ingestion/parser errors | 90 days |
| Processed search outbox rows | 7 days |

## Environment Controls

- `OPENJOBSLOTS_POSTING_HOT_DAYS`
- `OPENJOBSLOTS_HIDDEN_POSTING_RETENTION_DAYS`
- `OPENJOBSLOTS_CACHE_METADATA_RETENTION_DAYS`
- `OPENJOBSLOTS_INGESTION_RUN_RETENTION_DAYS`
- `OPENJOBSLOTS_INGESTION_ERROR_RETENTION_DAYS`
- `OPENJOBSLOTS_SEARCH_OUTBOX_PROCESSED_DAYS`

## Worker Maintenance

The ingestion worker hides stale visible postings in Postgres, writes Meilisearch delete operations to `search_index_outbox`, and then processes that outbox. Public API reads should stay read-only.

Retention and search index maintenance must be observable separately from the public visible count. `Indexed slots` is a visible-row count, not a net-new-growth metric; compare visible rows, hidden rows, `first_seen` in 24h, `last_seen` in 24h, and Meilisearch document count when debugging freshness.

Search parity and retention checks are covered in [Search Quality Runbook](./search-quality-runbook.md).
