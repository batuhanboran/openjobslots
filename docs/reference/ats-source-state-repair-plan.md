# ATS Source State Repair Plan

Generated: 2026-06-05T00:36:08.744Z
Plan hash: fe452eadb3a03192

This report is read-only. SQL blocks are previews for an approval-gated production run after backup, preflight, worker isolation, bounded canary, recovery guard, and Meili/Postgres parity proof.

## Summary

- Target count: 7
- Approval-gated actions: 7
- Source rows to seed: 2
- Source protections to reset: 4
- Alias canonicalizations: 1

## Gates

- explicit user approval for production writes
- production deploy or expected commit alignment verified
- fresh non-empty Postgres backup under backups/
- worker isolated or paused
- fresh passing ats:recovery:preflight report
- planned tenant batch report for any source canary/apply
- bounded canary before apply
- recovery guard pass
- Meili/Postgres parity delta 0

## Targets

| ats | production state | actions |
| --- | --- | --- |
| `workday` | false/auto_disabled | reset_source_protection_to_canary, prove_inventory_and_batch_quality |
| `manatal` | false/auto_disabled | reset_source_protection_to_canary, prove_inventory_and_batch_quality |
| `dayforcehcm` | false/canary_only | keep_canary_excluded_from_default_sync, prove_inventory_and_batch_quality |
| `gem` | false/auto_disabled | reset_source_protection_to_canary, prove_inventory_and_batch_quality |
| `adp_workforcenow` | false/auto_disabled | canonicalize_legacy_alias, reset_source_protection_to_canary, prove_inventory_and_batch_quality |
| `personio` | missing/missing | seed_source_row, keep_canary_excluded_from_default_sync, prove_inventory_and_batch_quality |
| `workable` | missing/missing | seed_source_row, keep_canary_excluded_from_default_sync, prove_inventory_and_batch_quality |
