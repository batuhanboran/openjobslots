# OpenJobSlots Data Quality Runbook

This runbook explains how posting quality diagnostics are scored and how to debug missing, rejected, duplicated, stale, or weakly normalized job slots.

## Quality Metadata

Accepted postings and rejected cache rows can expose bounded, non-sensitive diagnostics:

- `quality_score`: 0-100 score derived from validation flags.
- `quality_flags`: stable warning codes such as `missing_country`, `weak_remote_classification`, `missing_posted_at`, `missing_source_job_id`, `duplicate`, `stale_cache`, or `rejected`.
- `rejection_reason`: concise parser or validation reason for rejected rows.
- `parser_key` / `parser_version`: parser identity used for the normalized row.
- `confidence_score`: parser confidence from adapter output.
- `source_ats`, `source_company`, `source_url`, `source_job_id`: source identity without raw payloads or secrets.
- `normalized_location`: current normalized `location_text`, `city`, `country`, and `region`.
- `freshness`: first seen, last seen, and cache freshness state.

Raw payloads and secrets are not returned by public diagnostics endpoints.

## Scoring Rules

The score starts at 100 and applies penalties for data that weakens search/filter correctness:

- Missing required title, company, or URL: severe penalty and rejection.
- Missing source job id or parser version: medium penalty.
- Missing or suspicious location normalization: medium penalty.
- Unknown remote classification: small to medium penalty.
- Missing posted date: small penalty because many ATS sources do not expose a trustworthy date.
- Invalid future/old dates: medium penalty.
- Duplicate/stale/hidden/rejected state: penalty reflecting operational risk.
- Low parser confidence: medium penalty.

The score is intentionally conservative. A low score means the row is searchable but may not satisfy precise filters.

## Debugging A Visible Job

Use the posting diagnostics endpoint with the canonical URL:

```bash
curl "http://127.0.0.1:8787/postings/diagnostics?url=https%3A%2F%2Fexample.com%2Fjob"
```

Check:

- `source_ats`: which adapter produced it.
- `parser_version`: whether old rows need backfill.
- `quality_flags`: why a filter may not match.
- `normalized_location`: country/region/city values used by filters.
- `freshness.last_seen_epoch`: whether the row is still current.

## Debugging A Missing Job

1. Search by canonical URL in `/postings/diagnostics`.
2. If it is not accepted, check `/ingestion/rejections` for recent parser validation failures.
3. Check `/ingestion/parser-stats` for parser attention grouped by ATS.
4. Check `/ingestion/quality/summary` for field gaps by ATS.
5. If source data is absent in fixtures or cached payloads, do not invent fields. Document the missing source evidence in the adapter matrix.

## Endpoints

- `GET /postings/diagnostics?url=<canonical_url>`
- `GET /postings/:id/diagnostics` for SQLite rows with numeric ids.
- `GET /ingestion/quality/summary?limit=100`
- `GET /ingestion/rejections?limit=50`
- `GET /ingestion/parser-stats?limit=100`

All endpoints are read-only and return bounded data. Admin-only parser endpoints can still provide deeper operational context when an admin token is configured.

## Read-Only Audit Command

Use the derived stored-field audit when diagnosing production field gaps:

```powershell
npm.cmd run audit:data-quality -- --by-source --by-parser
```

JSON output:

```powershell
npm.cmd run audit:data-quality -- --json --by-source --by-parser
```

The command is read-only. With `OPENJOBSLOTS_DB_BACKEND=postgres`, it connects through `DATABASE_URL` or `POSTGRES_URL` and runs `SELECT` queries only. With SQLite/local fallback, it opens `DB_PATH` in read-only mode.

The audit derives counts from actual stored row fields instead of trusting `quality_flags`, including:

- `total_visible_postings`
- `missing_country_count`
- `missing_location_text_count`
- `missing_region_state_count`
- `missing_city_count`
- `missing_any_normalized_geo_count`
- `missing_all_normalized_geo_count`
- `missing_location_and_all_geo_count`
- `suspicious_unknown_geo_count`
- `missing_remote_type_count`
- `weak_unknown_remote_type_count`
- `missing_all_geo_and_weak_remote_count`

Each count also has a matching percentage field ending in `_pct`. Grouped output is available under `by_source` and `by_parser`.

## Net-New ATS Public Row Estimator

Before any ATS recovery canary/apply or 5k target selection, estimate actual net-new public row gain:

```powershell
npm.cmd run ats:estimate-net-new -- --source=lever --limit=250 --company-limit=250 --json
```

The estimator is read-only. It uses the same source-runner fetch, parse, normalize, validate, and public-posting gate path as `ats:source:dry-run`, then compares accepted candidates against Postgres by canonical URL, normalized canonical URL, apply URL, source job id, and `source_ats + source_job_id`.

Use these fields for recovery selection:

- `net_new_clean_public_candidates`
- `expected_public_row_gain`
- `duplicate_count`
- `existing_public_update_candidates`
- `stale_or_hidden_reactivation_candidates`
- `inventory.cannot_prove_remaining_inventory`
- `inventory.runner_limit_cap_unproven_inventory`

Do not use raw `rows_parsed`, raw dry-run `accepted_count`, or total clean candidates as public-row gain. Lever and HRMDirect proved why this matters: a source can parse many clean rows while most already exist in production.

If the report shows remaining unscanned targets, use `--offset=<n>` to scan the next source-runner window where supported. A capped single-window report with `runner_limit_cap_unproven_inventory=true` is not enough evidence for a 5k apply.

## Geo/Remote Backfill Planner

Use the dry-run planner to estimate normalized geo, remote, and quality flag repairs that can be made from stored evidence only:

```powershell
npm.cmd run backfill:geo-remote:dry-run -- --limit=100 --sample=10 --no-production-write
```

Scope to one ATS/source:

```powershell
npm.cmd run backfill:geo-remote:dry-run -- --source=icims --limit=200 --json --no-production-write
```

Write a JSON report:

```powershell
npm.cmd run backfill:geo-remote:dry-run -- --source=applitrack --limit=200 --sample=20 --output=C:\tmp\openjobslots-geo-remote-dry-run.json --no-production-write
```

The planner is dry-run only. It opens SQLite in read-only mode or uses Postgres `SELECT` queries and has no write path.

Output includes:

- `total_scanned`
- `classification_counts`
- `proposed_updates_by_field`
- `proposed_updates_by_source`
- `proposed_updates_by_parser_version`
- `rows_requiring_icims_detail_refetch`
- `rows_requiring_applitrack_detail_refetch`
- `unsafe_ambiguous_rows`
- bounded before/after samples with a confidence score and rule name for every proposed change

Classifications:

- `fixable_country`: deterministic country evidence exists.
- `fixable_region`: deterministic region evidence exists, usually derived from country or explicit supported state evidence.
- `fixable_city`: deterministic city evidence exists.
- `fixable_location_text`: row has source location evidence but missing `location_text`.
- `fixable_remote_type`: explicit remote/hybrid/on-site evidence exists.
- `fixable_quality_flags_only`: stored fields are unchanged, but derived quality flags can be corrected.
- `needs_detail_refetch`: list/cache evidence is insufficient, and the ATS likely needs certified detail-page fetching.
- `unsafe_ambiguous`: evidence is conflicting or multi-location and must not be automatically normalized.
- `no_evidence`: no safe stored evidence exists.

Safety rules:

- Do not invent country, region, city, or remote mode.
- Do not set city from country-only evidence.
- Do not parse standalone `IN` or `IL` as country/state without deterministic context.
- Do not classify `onsite` only because a physical location exists.
- Do not classify `remote` from broad description or marketing text.
- iCIMS and Applitrack rows without enough list evidence are reported for detail refetch instead of being guessed.

## Guarded Geo/Remote Apply Mode

Production apply mode is intentionally hard to trigger. It must never be run until a production DB backup exists and the dry-run report has been reviewed.

Required production backup:

```powershell
# Example only; use the actual deployed DB path/backend from PROJECT_STATE.
Copy-Item C:\path\to\jobs.db C:\path\to\jobs.db.backup-YYYYMMDD-HHMMSS
```

Apply mode requires all four safety flags. Without all four, the command stays in dry-run mode:

```powershell
npm.cmd run backfill:geo-remote -- --source=careerplug --limit=100 --sample=20 --json
```

Guarded apply against an isolated/test DB:

```powershell
npm.cmd run backfill:geo-remote -- --source=careerplug --limit=100 --apply --confirm-production --backup-confirmed --max-updates=25 --batch-size=10 --json
```

Safety gates:

- `--apply`: explicit write request.
- `--confirm-production`: acknowledges the operator understands this may affect the active backend.
- `--backup-confirmed`: confirms a backup/rollback point exists before production write.
- `--max-updates=N`: caps row-level updates for the run.

Operational controls:

- `--batch-size=N`: commits per batch.
- `--continue-on-error`: continues after a failed batch; default is stop on first error.
- `--resume-run-id=<run_id>`: resumes an audited run and skips changes already recorded for that run.
- `--operator=<name>`: stores operator label in the audit run.

Audit tables created on first guarded apply/rollback:

- `data_quality_backfill_runs`
- `data_quality_backfill_changes`

Each changed field stores old value, new value, rule name, confidence, source evidence summary, and reversible metadata.

Rollback:

```powershell
npm.cmd run backfill:geo-remote:rollback -- --run-id=<run_id> --batch-size=10 --json
```

Rollback restores old values from the audit trail and marks the original run as `rolled_back`.

Expected verification queries:

```sql
SELECT status, checkpoint_url, dry_run_summary
FROM data_quality_backfill_runs
WHERE run_id = '<run_id>';

SELECT field_name, COUNT(*)
FROM data_quality_backfill_changes
WHERE run_id = '<run_id>' AND applied = 1
GROUP BY field_name
ORDER BY field_name;
```

Post-apply verification:

```powershell
npm.cmd run audit:data-quality -- --by-source --by-parser --json
```

## Guarded iCIMS/Applitrack Detail Refetch

iCIMS and Applitrack list/import rows often omit location or remote evidence. Use the detail refetch tooling only for bounded, polite repair batches.

Dry-run candidate planning and detail parsing:

```powershell
npm.cmd run refetch:details:dry-run -- --source=icims --limit=50 --company-limit=5 --sample=10 --json
```

```powershell
npm.cmd run refetch:details:dry-run -- --source=applitrack --limit=50 --company-limit=5 --sample=10 --output=C:\tmp\openjobslots-detail-refetch.json
```

Local fixture-only smoke tests can pass `--fixture-dir=<path>` with files named `<ats>-<source_job_id>.html` or `<ats>-detail-<source_job_id>.html`.

The dry-run command performs no writes. It reports:

- candidate rows prioritized by missing geo plus weak/unknown remote state;
- candidates grouped by ATS/source host;
- HTTP status counts when details are fetched;
- parser success/failure counts;
- before/after samples with rule names and confidence;
- blocked or failed URLs with backoff metadata.

Guarded apply requires all safety flags and must be run only after a production backup exists:

```powershell
npm.cmd run refetch:details -- --source=icims --limit=50 --company-limit=5 --apply --confirm-production --backup-confirmed --max-updates=25 --batch-size=10 --json
```

Safety rules:

- Fetches run sequentially with delay and jitter; default concurrency is 1.
- Candidate rows are grouped by source host and capped with `--company-limit`.
- Only iCIMS and Applitrack are supported.
- Rows must be visible, valid, and missing geo or weak remote evidence.
- Existing nonblank country, region, city, source id, posting date, department, and explicit remote/hybrid/onsite values are not overwritten.
- `remote_type` is set only from explicit detail evidence.
- `city` is set only when the detail parser exposes city-level evidence through the normalizer.
- Failed/blocked URLs are audited with HTTP status and parser failure reason.

Audit tables created during guarded apply:

- `detail_refetch_runs`
- `detail_refetch_changes`

The audit rows include run id, source ATS, company, canonical URL, detail URL, HTTP status, field changed, old/new values, rule name, confidence, source evidence summary, parser status/failure reason, and applied flag.

The older `backfill:detail-pages` command is retained only for compatibility. New work should use `refetch:details:dry-run` and guarded `refetch:details`.

## Known Limitations

- Existing rows may have `legacy-adapter-v1` parser metadata until a safe backfill runs.
- `posted_at` remains null when the source does not expose a trustworthy posting date.
- Some ATS list endpoints omit detail fields. Those require detail-page certification before backfill.
- SQLite fallback infers ATS from URL for older rows that do not store `ats_key`.
