# OpenJobSlots Project State

This is the short current-state document for future Codex runs. Detailed runbooks live in `docs/reference/`.

## Current Version

- Package/public release line: `v1.8.0`.
- Last recorded production checkout: `5a59375` on `codex/production-baseline-audit` after the Taleo canary deployment.
- Latest recovery branch: `codex/production-baseline-audit`; tested Taleo code commits were `3b01427` and `5a59375`.
- Last recorded production deployment date: May 13, 2026.
- Public product name: `openjobslots`.
- Target public domain: `openjobslots.com`.

## Deployment Status

- Production host: production / `public-services`.
- Production checkout: `/root/OpenJobSlots`.
- Deployment source: private GitHub repository `batuhanboran/openjobslots`, branch `main`.
- Auto-deploy: `openjobslots-deploy.timer`, stopped/inactive after the Taleo canary to prevent another recovery-branch rollback.
- Deploy log: `/var/log/openjobslots-deploy.log`.
- Deployment details and rollback notes: `docs/reference/deployment.md`.

Expected OpenJobSlots services:

- `openjobslots-app`
- `openjobslots-worker`
- `openjobslots-postgres`
- `openjobslots-meilisearch`

## Active Architecture

- API/static web app: Node/Express container.
- Worker: separate Node ingestion worker container.
- Active DB backend: Postgres in production.
- Active search backend: Meilisearch in production.
- Queue/control model: Postgres-backed sync/control state; pg-boss code exists but is not the primary production queue path unless deployment config says otherwise.
- Source-job control model: source-specific dry-run/canary/apply work must use the global heavy-job advisory lock and the `ats_source_runs` audit tables.
- SQLite role: local fallback, import source, isolated tests, and legacy compatibility.
- Meilisearch role: derived public search index. Postgres remains source of truth.

## Public Endpoints

- `GET /health`
- `GET /postings`
- `GET /postings/filter-options`
- `GET /search/suggest`
- `GET /sync/status`
- `GET /ingestion/status`

Internal/admin diagnostics may include:

- `/admin/parsers`
- `/ingestion/errors`
- `/ingestion/runs`
- `/ingestion/sources`
- `/ingestion/quality/summary`
- `/ingestion/parser-stats`
- `/ingestion/rejections`
- `/ingestion/source-quality`
- `/ingestion/parser-drift`
- `/ingestion/quarantine-summary`
- `/ingestion/status` includes the global heavy-job lock and recent ATS source-job run state.

Keep public UI calls on public routes only unless an admin flow is explicitly opened.

## Last Recorded Data Quality State

The last production audit was recorded on May 12, 2026 after the certified-source public dataset rebuild, threshold indexing cleanup, and final replace-mode Meili reindex.
Reports were written on production under `/root/OpenJobSlots/reports/`.

- Certified rebuild backup: `/root/OpenJobSlots/backups/postgres-openjobslots-pre-certified-rebuild-20260512-155252.dump`.
- Final data-quality audit JSON: `/root/OpenJobSlots/reports/v180-final-20260512-175855-data-quality.json`.
- Final ATS quality audit JSON: `/root/OpenJobSlots/reports/v180-final-20260512-175855-ats-quality.json`.
- Final source quality JSON: `/root/OpenJobSlots/reports/v180-postdeploy-20260512-181223-endpoint-ingestion_source-quality.json`.
- Final quarantine summary JSON: `/root/OpenJobSlots/reports/v180-postdeploy-20260512-181223-endpoint-ingestion_quarantine-summary.json`.
- Final Meili replace report: `/root/OpenJobSlots/reports/certified-rebuild-20260512-155252-final2-meili-replace-reindex.json`.
- Final Meili post-check JSON: `/root/OpenJobSlots/reports/v180-postdeploy-20260512-181223-meili-check.json`.
- Visible postings: `47,396`.
- Indexable postings: `47,395`.
- Missing country: `3,113` / `6.57%`.
- Missing location text: `51` / `0.11%`.
- Missing region/state: `3,113` / `6.57%`.
- Missing city: `5,039` / `10.63%`.
- Missing any normalized geo: `6,824` / `14.40%`.
- Missing all normalized geo: `1,328` / `2.80%`.
- Missing location and all normalized geo: `44` / `0.09%`.
- Suspicious/unknown geo: `1,431` / `3.03%`.
- Missing remote type: `0` / `0.00%`.
- Weak or unknown remote classification: `1,855` / `3.91%`.
- Missing all normalized geo and weak/unknown remote: `22` / `0.05%`.
- Source states: `20` public-enabled, `6` quarantine-only, `36` disabled.
- Quarantine-only sources: `recruitee`, `applitrack`, `icims`, `recruitcrm`, `taleo`, and `zoho`.
- Meilisearch document count: `47,395`; Postgres indexable count: `47,395`; count delta: `0`.
- Meilisearch remote facets now match the Postgres-derived indexed payload distribution.
- Heavy job advisory lock `openjobslots_heavy_job` was available after the final reindex.
- `recruitee`, `applitrack`, `icims`, `recruitcrm`, `taleo`, and `zoho` are quarantine-only by source-quality protection.

Treat these as the last recorded numbers, not proof of current live state. Re-run the read-only production baseline audit before making new data-quality claims.

Important interpretation:

- `v1.8.0` improved many quality percentages mostly by shrinking the public dataset during the certified-source rebuild.
- Future work must not treat lower coverage as quality progress.
- Treat the last recorded `47,396` visible postings as the coverage floor until a fresh read-only production baseline replaces it.

## Latest ATS Recovery Snapshot

Recruitee recovery was applied on May 12, 2026 after a fresh production baseline and backup.

- Deployed recovery code commit: `aa94cae`.
- Backup: `/root/OpenJobSlots/backups/postgres-openjobslots-pre-recruitee-recovery-20260512-203839.dump`.
- Baseline reports: `/root/OpenJobSlots/reports/recruitee-recovery-before-20260512-203621-*`.
- Write/canary reports: `/root/OpenJobSlots/reports/recruitee-recovery-write-20260512-203839-*`.
- After/guard reports: `/root/OpenJobSlots/reports/recruitee-recovery-final2-20260512-204443-*`.
- Visible postings: `47,938 -> 48,042`.
- Recruitee accepted public rows: `0 -> 76`.
- Recruitee source state: `canary_only`.
- Recruitee candidate tenants: `2,734`; manual bounded apply considered `25`, fetched `6`, parsed `107`, and wrote `75` accepted public rows.
- A cancelled worker restart attempt added `1` additional Recruitee public row and `29` non-Recruitee public rows after the manual Recruitee guard. No rows were deleted.
- New Recruitee `no_geo_no_remote` public rows: `0`.
- Recruitee missing all normalized geo: `0 -> 0`.
- Recruitee weak/unknown remote: `0 -> 0`.
- Meili/Postgres delta after bounded writes: `0`.
- `ats:recovery:guard` passed with `0` failures.

Recruitee expansion was applied on May 13, 2026 after a fresh production baseline and backup.

- Backup: `/root/OpenJobSlots/backups/postgres-openjobslots-pre-recruitee-expansion-20260513-085800.dump`.
- Reports: `/root/OpenJobSlots/reports/recruitee-expansion-20260513-085800-*`.
- Visible postings for the expansion write window: `48,296 -> 48,721`.
- Recruitee accepted public rows: `85 -> 510`.
- Public row gain: `425`.
- Recruitee source state: `canary_only`.
- Dry-run considered `100` tenants, fetched `100`, parsed `1,759`, accepted `1,759`, and reported no parser failures.
- Canary plus bounded apply parsed `998` production rows and wrote `550` public rows, including `425` newly accepted rows.
- New Recruitee `no_geo_no_remote` public rows: `0`.
- Recruitee missing all normalized geo: `0 -> 0`.
- Recruitee weak/unknown remote rows: `0 -> 0`.
- Meili/Postgres delta after bounded writes: `0`.
- `ats:recovery:guard` passed with `0` failures.

Recruitee is recovered to canary-only public writes, while old quarantine cache rows remain for historical diagnostics. Remaining historical Recruitee quarantine reasons are `no_geo_no_remote` (`1,993`) and `source_disabled_by_threshold` (`365`).
Applitrack recovery was applied on May 13, 2026 after a fresh production baseline and backup.

- Deployed recovery code commit: `f93147a`.
- Backup: `/root/OpenJobSlots/backups/postgres-openjobslots-pre-applitrack-recovery-20260513-070709.dump`.
- Baseline reports: `/root/OpenJobSlots/reports/applitrack-recovery-baseline-20260513-064311-*` and `/root/OpenJobSlots/reports/applitrack-recovery-before-write-20260513-070641-*`.
- Dry-run/canary/apply reports: `/root/OpenJobSlots/reports/applitrack-recovery-postdeploy-dry-run-20260513-070339.json`, `/root/OpenJobSlots/reports/applitrack-recovery-canary-apply-20260513-070858.json`, and `/root/OpenJobSlots/reports/applitrack-recovery-bounded-apply-20260513-071028.json`.
- After/guard reports: `/root/OpenJobSlots/reports/applitrack-recovery-after-apply-20260513-071241-*`, `/root/OpenJobSlots/reports/applitrack-recovery-meili-check-20260513-071259.json`, and `/root/OpenJobSlots/reports/applitrack-recovery-final3-20260513-071850-guard.json`.
- Visible postings for the Applitrack write window: `48,091 -> 48,176`.
- Applitrack accepted public rows: `0 -> 85`.
- Applitrack source state: `canary_only`.
- Applitrack configured targets: `1,323`; manual bounded apply considered `25`, fetched `5`, parsed `172`, wrote `85` accepted public rows, and wrote `15` quarantine rows.
- New Applitrack `no_geo_no_remote` public rows: `0`.
- Applitrack missing all normalized geo: `0 -> 0`.
- Applitrack weak/unknown remote rows: `0 -> 85`; accepted rows have normalized city evidence, so missing-all-geo plus weak/unknown remote stayed `0`.
- Meili/Postgres delta after bounded writes: `0`.
- `ats:recovery:guard` passed with `0` failures.

Applitrack expansion was applied on May 13, 2026 after a fresh production baseline and backup.

- Backup: `/root/OpenJobSlots/backups/postgres-openjobslots-pre-applitrack-expansion-20260513-101744.dump`.
- Report prefix: `/root/OpenJobSlots/reports/applitrack-expansion-20260513-101744-*`.
- Source recovery report: `/root/OpenJobSlots/reports/applitrack-expansion-20260513-101744-source-recovery-report.json`.
- Visible postings for the Applitrack expansion window: `48,721 -> 48,873`.
- Applitrack accepted public rows: `85 -> 237`.
- Public row gain: `152`.
- Applitrack source state: `canary_only`.
- Applitrack configured targets: `1,323`; bounded dry-run considered `40`, fetched `37`, parsed `2,384`, accepted `1,065`, and quarantined `1,319` without writing.
- Canary plus bounded apply fetched `13` tenants, parsed `627` rows, wrote `280` public rows, wrote `270` quarantine rows, and produced `152` newly accepted public rows after existing-row refreshes.
- New Applitrack `no_geo_no_remote` public rows: `0`.
- Applitrack missing all normalized geo: `0 -> 0`.
- Applitrack weak/unknown remote rows: `85 -> 235`; accepted rows have city/region evidence, so missing-all-geo plus weak/unknown remote stayed `0`.
- Meili/Postgres delta after bounded writes: `0`.
- `ats:recovery:guard` passed with `0` failures.
- Successful expansion districts include `ycsk12` (`42` accepted), `yorkcountyschools` (`35`), `Zion6` (`32`), `youngstown` (`30`), `yisd` (`26`), `zionsville` (`25`), `yssd` (`23`), and `yarmouthschools` (`15`).
- Remaining expansion failure evidence is historical `no_geo_no_remote` (`1,070`) and `source_disabled_by_threshold` (`314`), plus bounded-run `no_structured_location` (`291`) and `no_normalized_geo_or_explicit_remote` (`6`).

Zoho recovery was applied on May 13, 2026 after a fresh production baseline and backup.

- Backup: `/root/OpenJobSlots/backups/postgres-openjobslots-pre-zoho-recovery-20260513-104733.dump`.
- Report prefix: `/root/OpenJobSlots/reports/zoho-recovery-20260513-104733-*`.
- Source recovery report: `/root/OpenJobSlots/reports/zoho-recovery-20260513-104733-source-recovery-report.json`.
- Visible postings for the Zoho write window: `48,873 -> 49,277`.
- Zoho accepted public rows: `0 -> 404`.
- Public row gain: `404`.
- Zoho source state: `canary_only`.
- Zoho candidate tenants: `1,751`; bounded dry-run considered `100`, fetched `100`, parsed `1,179`, accepted `1,064`, and quarantined `115` without writing.
- Canary plus bounded apply fetched `67` tenants, parsed `630` rows, wrote `427` public rows, wrote `108` quarantine rows, and produced `404` newly accepted public rows after existing-row refreshes.
- New Zoho `no_geo_no_remote` public rows: `0`.
- Zoho missing all normalized geo: `0 -> 6`; those accepted rows have explicit remote evidence, so `no_geo_no_remote` stayed `0`.
- Zoho weak/unknown remote rows: `0 -> 7`; all weak/unknown accepted rows have useful geo evidence.
- Meili/Postgres delta after bounded writes: `0`.
- `ats:recovery:guard` passed with `0` failures.
- Successful Zoho tenants include `ubuntuimpact` (`89` accepted), `restore-talent` (`71`), `careerbridge` (`35`), `metasource` (`28`), `amc-travaux` (`25`), `kn-it` (`18`), `umanrecrutement` (`16`), and `yinternational` (`16`).
- Remaining Zoho quarantine evidence is `no_geo_no_remote` (`65`), `ambiguous_location` (`57`), and `source_disabled_by_threshold` (`37`).

RecruitCRM recovery was applied on May 13, 2026 after a fresh production backup and source-specific public API inspection.

- Deployed recovery code commits: `c4e815b` and `46e2f3e`.
- Backup: `/root/OpenJobSlots/backups/postgres-openjobslots-pre-recruitcrm-recovery-20260513-113654.dump`.
- Report prefix: `/root/OpenJobSlots/reports/recruitcrm-recovery-20260513-112731-*`.
- Source recovery report: `/root/OpenJobSlots/reports/recruitcrm-recovery-20260513-112731-source-recovery-report.json`.
- Visible postings for the whole observed run after auto-deploy interruptions: `49,277 -> 50,130`.
- RecruitCRM write-window visible postings after the deployment auto-sync interruption: `49,310 -> 49,832`.
- RecruitCRM accepted public rows: `0 -> 522`.
- Public row gain: `522`.
- RecruitCRM source state: temporary canary write window; final `protection_status` is back to `quarantine_only` because accepted rate is `52.2% < 60%`.
- RecruitCRM candidate tenants/source hosts: `26`; dry-run fetched all `26`, parsed `1,400`, accepted `908`, quarantined `491`, and rejected `1` without writing.
- Canary plus bounded apply wrote `522` accepted public rows and `478` quarantine rows; bounded apply stopped at `max_updates_reached`.
- New RecruitCRM `no_geo_no_remote` public rows: `0`.
- RecruitCRM missing all normalized geo: `0 -> 45`; those rows have explicit remote evidence.
- RecruitCRM weak/unknown remote rows: `0 -> 10`; those rows have useful geo evidence.
- Meili/Postgres delta after bounded writes and final check: `0`.
- `ats:recovery:guard` passed with `0` failures.
- Future RecruitCRM work should keep the source quarantine-only until remaining tenant failures improve enough for source-quality policy to allow broader writes.
- Successful RecruitCRM tenants include `somewhere` (`308` accepted), `rcrm` (`53`), `Talentbank_1_jobs` (`45`), `TLNT_Group_jobs` (`29`), `talentsource` (`25`), `jobsnvisa` (`24`), and `Ensitech_Careers` (`17`).
- Remaining RecruitCRM failure evidence is `no_structured_location` (`457`), `no_geo_no_remote` (`20`), `ambiguous_location` (`1`), and `missing_title` (`1`).

Applitrack and Zoho are no longer quarantine-only. RecruitCRM now has accepted public rows but remains quarantine-only for future automatic writes until source-level quality improves. Old quarantine cache rows remain for historical diagnostics.
The worker is currently stopped to prevent further out-of-scope automatic source processing; app, Postgres, and Meili remained healthy in the final checks. During the first Applitrack app deploy/recreate, Compose briefly started the worker before it was stopped; the resulting stale ingestion run was marked `cancelled` after the worker container was stopped. During RecruitCRM recovery, Compose and the production auto-deploy timer again started the worker despite the intended source-only scope; ingestion run `13` was cancelled after `63` posting upserts, and runs `14`, `15`, and `16` completed with `146`, `289`, and `514` posting upserts across non-RecruitCRM sources. No rows were deleted or hidden, but those out-of-scope automatic source writes did occur. The final production auto-deploy timer reverted the checkout to `origin/main` at `7596fa2`; the recovery branch remains pushed as `codex/production-baseline-audit`. Use the `50,130` final visible count as the latest observed recovery floor.

Taleo recovery ran on May 13, 2026 after a fresh production backup and source-specific REST/AJAX career-section parser hardening.

- Deployed recovery code commits: `3b01427` and `5a59375`.
- Backup: `/root/OpenJobSlots/backups/postgres-openjobslots-pre-taleo-recovery-20260513-121337.dump`.
- Report prefix: `/root/OpenJobSlots/reports/taleo-recovery-20260513-121337-*`.
- Source recovery report: `/root/OpenJobSlots/reports/taleo-recovery-20260513-121337-source-recovery-report.json`.
- Global visible postings for the Taleo canary window: `50,130 -> 50,241`.
- Taleo accepted public rows: `0 -> 111`.
- Public row gain: `111`.
- Taleo source state: `canary_only` after a temporary bounded write window.
- Taleo candidate tenants/source hosts: `554`; bounded dry-run considered `5`, fetched `3`, parsed `141`, accepted `111`, and quarantined `30` without writing.
- Canary wrote `111` accepted public rows and `30` quarantine rows. No larger bounded apply was run after the guard found a global Meili/Postgres count delta.
- New Taleo `no_geo_no_remote` public rows: `0`.
- Taleo missing all normalized geo: `0 -> 0`.
- Taleo missing any normalized geo: `0 -> 1`.
- Taleo weak/unknown remote rows: `0 -> 0`.
- Meili/Postgres delta after bounded outbox check: `-1`; the bounded Taleo outbox processor selected `0` pending Taleo upserts.
- `ats:recovery:guard` did not pass; its only failure was `meili_postgres_delta_nonzero` with delta `-1`.
- Supported Taleo shapes now include REST career-section payloads and AJAX/list text payloads where stable job identity plus structured/labeled location evidence are present.
- Successful Taleo tenants were `wvu` (`110` accepted public rows across `staff` and `wvumtemps`) and `zionsbancorp` (`1` accepted public row).
- Unsupported/quarantined Taleo evidence is `zionsbancorp` `no_structured_location` (`11`), `zionsbancorp` `unsupported_tenant_shape` (`19`), `xoriant` `portal_search_empty` (`1`), and `xl` `portal_search_empty` (`1`).

The worker remains stopped, app/Postgres/Meili were healthy in the Taleo final checks, and the production auto-deploy timer is stopped/inactive. No non-Taleo source apply ran during the Taleo prompt. Use `50,241` as the latest observed visible-count floor, but reconcile the `-1` Meili/Postgres derived-index delta before the next larger apply wave.

## Post-v1.8.0 Recovery Strategy

The next phase is ATS-by-ATS recovery, not another broad cleanup or rebuild.

Hard rules:

- Do not run a clean public dataset rebuild.
- Do not truncate `postings`, `posting_cache`, the active Meili index, source configuration, company configuration, or source quality state.
- Do not lower visible count.
- Do not disable or quarantine-only a source if doing so removes existing public rows.
- Do not restore dirty backup rows from `v1.6.2`, `v1.8.0`, or their reports into public search. Use those reports only as reference evidence.
- Keep Postgres as source of truth. Meili is derived data and should be reindexed only after source recovery writes improve Postgres/source data.

Recovery model:

- Work one ATS at a time.
- Prefer tenant/source-level recovery over source-wide disabling.
- Ambiguous rows should be skipped and logged, not used as a reason to fail the whole task.
- If a source cannot be recovered, keep it quarantine-only and record tenant-level failure reasons plus the exact next parser evidence needed.

Success criteria for every ATS recovery task:

- Accepted public rows for that ATS increase.
- Visible count does not decrease.
- Missing geo/remote decreases for existing rows, or newly accepted rows do not add bad `no_geo_no_remote` rows.
- If no improvement is possible, report exact tenant/source/error reasons.

Non-success criteria:

- Parser fixtures alone are not success.
- Tests alone are not success.
- A source wave is successful only if production accepted public rows increase or source-level missing geo/remote improves without decreasing visible count.

## Next Prompt Contract

Each future prompt/run must:

1. Read `handoff.md` and `docs/PROJECT_STATE.md` first.
2. Run a fresh current live baseline before making data-quality claims.
3. Compare before/after visible count and source-level quality.
4. Preserve coverage; visible count must not decrease for ATS recovery work.
5. Update `handoff.md` with the latest source recovery status.

## Known Risks

- Some rebuilt rows still need parser-backed normalization or detail-page refetch before country, region, city, remote mode, date, department, and employment fields are fully reliable.
- iCIMS, Applitrack, and other high-volume ATS sources can expose fields only in detail pages or tenant-specific shapes.
- Parser certification is fixture-backed only for a subset of the configured ATS catalog. Do not claim all 60 ATS are certified.
- Meilisearch is derived data. Reindex only after check/dry-run mode and with a rollback plan.
- Production write backfills must be dry-run first, batched, explicit, and approved.
- `v1.8.0` has applied the certified-source public dataset rebuild, threshold indexing cleanup, quarantine-only source enforcement, and final replace-mode Meili reindexing. Do not repeat that rebuild strategy.
- Source disable/quarantine changes can reduce coverage. Block them when they would remove existing public rows.
- Future repair work must use the same backup, lock, canary, audit, and rollback process, but the success target is source recovery without visible-count loss.
- Cloudflare/analytics CSP alignment and dependency version cleanup are separate maintenance tasks.

## Next Tasks

1. Read `handoff.md` and this file before planning any source or data-quality work.
2. Run a fresh read-only production baseline: visible count, accepted public rows by source, source-level geo/remote gaps, quarantine reasons, and Meili/Postgres delta.
3. Prioritize ATS-by-ATS source recovery by live field gaps and recoverable tenant/source evidence.
4. For each ATS recovery task, prove accepted public rows increased or source-level missing geo/remote improved without decreasing visible count.
5. Skip and log ambiguous rows instead of failing the whole task.
6. For unrecovered sources, keep quarantine-only and record tenant-level failure reasons plus exact parser/detail evidence needed next.
7. Run Meilisearch check-mode parity only after source recovery writes improve Postgres/source data; replace reindex remains a controlled follow-up, not the recovery mechanism.
8. Keep public search parity tests active for Turkey/Turkiye/Türkiye, remote, common title/country combinations, and pagination uniqueness.
9. Keep documentation changes consolidated in this file plus `handoff.md` and `docs/reference/`.

## Baseline Validation Commands

Use the relevant subset for the task:

```powershell
npm.cmd run test:backend
npm.cmd run test:api
npm.cmd run test:parsers
npm.cmd run test:e2e
npm.cmd run quality:gate
npm.cmd run search:parity
npm.cmd run reindex:meili -- --check
npm.cmd run audit:data-quality -- --json --output=reports/data-quality-audit.json
npm.cmd run backfill:geo-remote:dry-run -- --limit=50000 --json --sample --output=reports/geo-remote-dry-run.json
npm.cmd run refetch:details:dry-run -- --source=icims --limit=5000 --json --sample --output=reports/icims-detail-dry-run.json
npm.cmd run refetch:details:dry-run -- --source=applitrack --limit=5000 --json --sample --output=reports/applitrack-detail-dry-run.json
npm.cmd run search:reindex:check -- --json --output=reports/meili-reindex-check.json
npm.cmd run audit:data-quality -- --by-source --by-parser
npm.cmd run audit:ats-quality
npm.cmd run ats:workbench
npm.cmd run ats:source:dry-run -- --source=greenhouse --limit=25 --json
npm.cmd run ats:source:canary -- --source=greenhouse --limit=25 --json
```

Use production apply commands only inside a scoped ATS recovery task after the fresh baseline, dry-run/canary evidence, heavy-job lock check, and before/after acceptance criteria are ready.

Docs-only work normally needs only:

```powershell
git diff --check
```
