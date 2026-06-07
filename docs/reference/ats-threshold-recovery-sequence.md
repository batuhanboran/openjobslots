# ATS Threshold Recovery Sequence

Generated: 2026-06-05T01:50:40Z

This is the current execution order for the Workday, Manatal, Dayforce, Gem, ADP Workforce Now, Personio, and Workable recovery goal. It is not an approval to write production data.

## Current blockers

- Production is still on `/app` SHA `72eac3f`; local source architecture and repair scripts are not live.
- Search threshold is not clean: Postgres indexable rows `347123`, Meili documents `347117`, count delta `6`, missing Meili documents `6`, and remote facet drift remains (`onsite +57`, `remote +8`, `hybrid +1`, `unknown -60`).
- The read-only repair plan at `docs/reference/meili-document-upsert-repair-plan-prod-readonly.json` is stale after the production Meili incident below; regenerate it after production is deployed to the current local script.
- Source-state repair plan hash is `fe452eadb3a03192`; it is still approval-gated.
- ADP legacy alias `adpworkforcenow` has a supported `company_sync_state` conflict and requires the reviewed conflict merge gate.
- Production Meili incident: `npm run reindex:meili -- --repair-document-upserts --document-repair-limit=100 --json` was run on old production SHA `72eac3f`, where those local repair flags are not supported. The old script began active Meili upserts and failed with `ECONNRESET`. Follow-up checks show app/worker/Postgres/Meili running, `/health` OK, public searches responding, and no Postgres/source-state writes from that command. Do not run this repair command on production again until deploy/preflight/backup/worker-isolation/approval gates are satisfied.

## Required order

1. Get explicit deploy approval before changing production code.
2. Deploy or otherwise align production to the current local code so the bounded Meili repair flags are present on production.
3. Regenerate the bounded Meili document-upsert dry-run plan on the deployed code; do not use the stale pre-incident plan.
4. Run a fresh production safety preflight for document-upsert repair: non-empty backup proof, worker isolation, autodeploy safety, no active unrelated heavy-job lock, no unsafe long-running queries, and expected production commit proof. For this repair only, the current Meili/Postgres delta may be the sole unsafe finding.
5. Apply bounded Meili document-upsert repair with `--repair-document-upserts --document-repair-limit=100 --apply --confirm-production --preflight-report=<fresh_preflight_report>`.
6. Re-run `search:reindex:check` and require `ok=true`, `count_delta=0`, empty remote facet delta, no missing/extra Meili documents, and valid settings.
7. Apply source-state repair plan `fe452eadb3a03192` only after the clean Meili/Postgres parity check, a fresh source-state preflight, backup proof, worker isolation, and ADP alias conflict gates.
8. Run source-specific inventory, net-new estimate, planned batch, dry-run, then bounded canary/apply for Workday, Manatal, Dayforce, Gem, ADP Workforce Now, Personio, and Workable. Dayforce, Personio, and Workable require explicit `--include-disabled` canary commands until promoted.
9. Run recovery guard, source freshness, search parity, and release proof. Do not call the ATS recovery complete while Meili/Postgres delta is nonzero or source canary/apply proof is missing.

## Target source states observed in production

| ats | production state | blocker |
| --- | --- | --- |
| `workday` | disabled / auto_disabled | `http_blocked: http_failure_pct 100% >= 50%` |
| `manatal` | disabled / auto_disabled | `http_blocked: http_failure_pct 100% >= 50%` |
| `dayforcehcm` | disabled / canary_only | direct-fetch proof pending |
| `gem` | disabled / auto_disabled | `parser_drift: parser_drift_pct 16.95% >= 10%` |
| `adp_workforcenow` | disabled / auto_disabled | `parser_drift: parser_drift_pct 20.83% >= 10%` plus legacy alias |
| `personio` | missing | source row must be seeded |
| `workable` | missing | source row must be seeded |
