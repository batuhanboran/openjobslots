# OpenJobSlots Project State

This is the short current-state document for future Codex runs. Detailed runbooks live in `docs/reference/`.

## Search Typing Request Control Update - May 31, 2026

- Public search typing now limits remote autocomplete to debounced query changes instead of sending a request per normal keystroke. Cached suggestion responses are reused for five minutes and no longer refetched just because result or filter-option state changed.
- Manual Enter submit cancels pending auto-search work, and automatic search records its query/filter signature so Enter does not duplicate an already-submitted search.
- New Playwright coverage verifies the request budget: slow typing `software` sends one `/search/suggest`, one `/postings`, and one `/postings/filter-options`; fast typing plus Enter sends one `/postings` with no stale auto-search follow-up.

## Search Latency And Index Parity Update - May 31, 2026

- Production direct search latency was reduced by fixing Meili hydration so Postgres no longer reapplies free-text search filters after Meili has already selected candidate canonical URLs. Postgres hydration still keeps public visibility, geo/location, country, remote, source, date, and safety guards.
- The live failure mode was `hydration_underfill` followed by expensive Postgres fallback. Cold origin probes before the fix included `software=12.697s`, `remote engineer=8.387s`, `engineer Turkey remote=7.668s`, `Director United States=4.260s`, and `turkiye=3.368s`.
- After deploy, cache-busted origin probes were `software=0.057536s`, `remote jobs=0.051057s`, `Director United States=0.043805s`, `remote engineer=0.051005s`, `turkiye=0.065760s`, and `engineer Turkey remote=0.082838s`, exceeding the one-tenth target for the measured direct searches.
- Meili/Postgres parity was repaired without a full replace swap after broad temp-index reindex attempts hit Meili memory/connectivity pressure. The repair inserted `45` missing documents, deleted `1` stale extra document, scanned `321,684` documents, and repaired `199` stale field documents.
- Final production parity check: `search:reindex:check -- --json --sample-limit=100` returned `ok=true`, `postgres_indexable_count=321773`, `meili_document_count=321773`, `count_delta=0`, no remote facet delta, no extra Meili documents, and no missing Meili documents. Worker and deploy timer were restored after repair.

## Mobile Store Readiness Update - May 31, 2026

- Expo configuration now includes iOS and Android store identifiers, a shared `openjobslots` scheme, and EAS build profiles for development, preview, and production.
- Native iOS/Android builds use `EXPO_PUBLIC_API_BASE_URL=https://openjobslots.com` in EAS profiles and are constrained to the public mobile API surface documented in `docs/reference/mobile-store-readiness.md`.
- FlyonUI remains outside the native app. It is reserved for a separate web/landing/admin surface because the current Expo app uses React Native `StyleSheet`, not Tailwind DOM components.
- `App.js` has started the staged public-app extraction by moving the postings filter state model into `src/postingsFilters.js`; future mobile refactors should continue by extracting search screen, filters, posting card, stats chips, API hooks, and shared UI in small behavior-preserving steps.
- Store publication is not complete until external Apple Developer, Google Play Console, signing, provisioning, listing, screenshots, privacy, and rating tasks are done outside the repo.

## Runtime Safety Update - May 28, 2026

- Backend runtime defaults now prioritize swap stability over throughput expansion. The Compose defaults are `INGESTION_WORKER_CONCURRENCY=2`, `INGESTION_WORKER_INTERVAL_MS=900000`, `INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET=6000`, `INGESTION_AUTO_SYNC_TARGETS_PER_RUN=100`, `INGESTION_SOURCE_DAILY_TARGET_BUDGET=500`, and `INGESTION_MAX_TARGETS_PER_RUN=250`.
- Compose now sets memory and swap ceilings for `openjobslots-app`, `openjobslots-worker`, `openjobslots-postgres`, and `openjobslots-meilisearch`. App/worker Node heap limits are explicit so Node heap growth stays below the container boundary.
- Public `/postings` reads cap large requests before query execution. Defaults are `OPENJOBSLOTS_PUBLIC_POSTINGS_MAX_LIMIT=500` and `OPENJOBSLOTS_PUBLIC_POSTINGS_MAX_OFFSET=2000`; responses expose `page_capped` when a request is clamped.
- Docker image cleanup is repo-side: multi-stage runtime image, pruned dev dependencies, and `.dockerignore` excludes README screenshots and Windows project files from backend images.
- Meili/Postgres parity is still a release risk to verify separately. Runtime caps do not replace the documented Meili repair/check order.

## v2.0 Prep Update - May 27, 2026

- Adaptive worker scale prep is implemented and tested. Postgres target selection now reads due backlog, recent source success/failure counts, and recent parser/network/rate-limit/source-quality errors before assigning per-ATS run caps. This lets healthy backlog sources scale while parser-attention or stability-risk sources are throttled instead of globally blocking throughput.
- Postgres worker target selection also clamps SQL candidates per ATS before the global candidate limit. This closes the live underfill case where a few large normal backlogs could occupy the candidate window and leave `targets/run=200` with only a partial selected run.
- Automatic worker target selection excludes `quarantine_only` sources. Public status/count payloads now split ATS source state into full, canary, quarantine-only, disabled, and worker-auto-eligible counts so enabled source rows are not confused with the worker target set.
- Worker throughput defaults from May 27 were staged at `INGESTION_WORKER_CONCURRENCY=3`, `INGESTION_WORKER_INTERVAL_MS=600000`, `INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET=18000`, `INGESTION_AUTO_SYNC_TARGETS_PER_RUN=300`, `INGESTION_SOURCE_DAILY_TARGET_BUDGET=1000`, and `INGESTION_ADAPTIVE_SELECTION_LOOKBACK_HOURS=24`; the May 28 runtime safety update above supersedes these as repo defaults.
- Collector dispatch is registry-driven again: `sourceCollectors.js` now resolves registry aliases through `sourceRegistry.js` instead of carrying a long ATS-specific dispatch chain. The former collector-local legacy paths for `talexio` and `saphrcloud` now own fetch/parse behavior in their source modules, so no ATS-specific legacy collector branch remains in `sourceCollectors.js`.
- Repo source-module coverage is `60/60` configured ATS directories with `index.js` and `parse.js`. `dayforcehcm` is represented by an explicit unsupported source stub and remains disabled until raw fixtures and parser certification exist.
- Public release line is prepared as `v2.0.0`: public release notes are public-safe, the result count says exact `job slots`, and the search header also exposes public ATS and company coverage chips. `/sync/status` now carries the same public count fields as `/health` for both Postgres and SQLite paths.
- Previous v2 canary stage increased from the live `4000/50/300` posture to `6000` automatic targets/day, `100` targets/run, and `500` successful targets/source/day while keeping worker concurrency `2` and interval `900000` ms; the adaptive scale prep above supersedes those defaults after deploy.
- Production canary enablement opened the disabled-normal ATS batch as `canary_only` after a fresh Postgres backup at `/root/OpenJobSlots/backups/v2-ats-canary-enable-20260527T134552Z.dump`. Dayforce remains disabled because it is explicitly unsupported. Auto-disabled `manatal`, `pinpointhq`, `taleo`, and `workday` remain blocked by their recorded failure reasons.
- Post-enable live state before the v2 code deploy: `57` configured-enabled ATS, `39` canary-only sources, `14` normal enabled sources, `4` quarantine-only sources, `4` auto-disabled sources, `37,534` sync-enabled companies, `62` configured ATS, and about `159.3k` visible job slots. Worker runs moved to `100` targets/run; run `622` completed with `62` successes, `38` failures, and `1,082` posting upserts, and run `623` was active during verification.
- Release blocker to keep watching: Meili/Postgres validation drift was already nonzero before this work. Do not call the source-quality recovery complete until parity is repaired through the documented Meili repair order, even though the public v2 UI/release metadata is prepared.

## Architecture Update - May 24, 2026

This update records the ATS parser modularization decision. It is architecture-only: no source apply, backfill, cleanup, public-row delete/hide, worker budget change, threshold change, or Meili replace reindex is part of this update.

- Posting parser implementations now live under `server/ingestion/sources/<ats>/parse.js`; this branch has `59` source parser modules.
- Shared parser helpers live under `server/ingestion/parsers/shared/`, currently covering HTML decoding, location/remote classification, and source-id extraction.
- `server/index.js` is no longer the owner of parser implementations. It remains the API/bootstrap surface and must not regain ATS parser bodies. At the May 25 architecture-boundary check it is `2,920/3,000` lines with no ATS boundary hits.
- `server/ingestion/sources/common.js`, `server/ingestion/direct-parser-fixtures.test.js`, and detail-refetch planning now import parser modules directly where possible.
- The only intentional remaining source-layer dependency on `server/index.js` is the legacy `collectPostingsForCompany` fallback. The next architecture phase is to move collector/discovery/fetch orchestration into ATS source modules, then shrink `server/index.js` again.
- Future parser/source fixes must target the relevant source module plus raw/expected fixtures. Do not fix ATS parser behavior by adding new parser code to `server/index.js`.
- Production deployment posture after this architecture update is `main` on production `/root/OpenJobSlots`; app and worker should be rebuilt/recreated when parser modules change.
- Active ATS quality target: HRMDirect. The May 24 live baseline is `24,384` visible HRMDirect rows with good geo/remote opportunity but `0%` posting-date evidence; keep improving route discovery, source ids, geo/location, remote type, source-failure thresholds, fixtures, and index evidence inside the HRMDirect source/parser lane.
- HRMDirect source parsing should use `search=true` list routes for `job-openings.php` and `openings.php`, source-backed `td.custSort1` work-mode/location values, exact `Apply Today`/`HERE` placeholder-title skipping, grouped div list rows with detail `Location:` escalation, `td.cities` remote-scope labels such as `Remote - Colorado` or `Remote, Continental U.S.` as explicit remote evidence without storing `Remote` as city, exact US state abbreviations from list `td.state` or detail `Location:` as United States country evidence without publishing the state code as city, detail `Location:` remote-scope labels such as `Remote - Arizona, AZ` or `Remote Texas` as explicit remote evidence plus scoped location text after stripping the remote prefix, `req`-only labeled detail pages when list-filter params suppress detail `Location:` values, duplicate-`req` `req_loc` detail pages when the location-specific URL exposes labeled `Location:` evidence, duplicate-`req` source ids as `req:req_loc` for stable index identity, exact labeled detail `Location: Remote/Hybrid` values as remote evidence without storing them as geo/location evidence, labeled detail `Workplace Type: Remote/Hybrid` values, exact detail `#LI-Remote/#LI-Hybrid` tags, detail body `Location:` labels that directly say remote/hybrid role, exact detail body `Work Arrangement` / `Work Environment` / `Full-time/Remote` tags and exact body work-mode tags such as `100% remote - work from home` as explicit remote evidence, detail body `Location:` labels with US street address plus city/state/ZIP as `City, ST` geo evidence, exact full-state/Canadian province/country `Office:` values, exact list/detail `Office: Remote/Hybrid`, and list/detail HRMDirect office prefixes/scopes such as `Corporate Poland`, `Field UK Onshore`, `Corporate US Remote`, `WA - Remote`, or `Remote - Texas` as labeled geo/remote evidence, optional `rss.php?search=true` item `pubDate` values as posting-date evidence for `job-openings.php` and `openings.php` when the RSS item `link` or `guid` exposes a matching base `req`, labeled detail `Date Posted/Posted Date/Posting Date/Open Date` values as posting-date evidence only when list/RSS dates are absent, stale/removed detail pages as `detail_404_or_410` quarantine evidence, ambiguous multi-location labels such as `Multiple Cities, SC` as `ambiguous_location` without fake city values, and bounded adaptive detail budget for sparse boards. Title-only `Remote` or `Virtual` text, department labels, and generic body prose are not enough evidence for public geo/remote classification; source-backed `onsite` is preserved but does not make a no-geo row indexable.
- May 25 read-only HRMDirect probe: ABSC parsed `41` rows and accepted `41`, including `3` rows recovered from `Office: Maryland/Virginia`; Vivo Infusion parsed `33` and accepted `30`, leaving `3` rows quarantined because no deterministic labeled geo/remote evidence exists. A top-20 tenant RSS probe parsed `10,256` rows and found `10,256` RSS `pubDate` matches. A top-40 risk-host probe after sparse-budget and `req_loc` fallback changes parsed `3,425`, accepted `3,328`, quarantined `97`, and found RSS dates for `3,425/3,425`. Duplicate-`req` rows now use `req:req_loc` source ids, while RSS date matching remains base-`req` keyed. A later targeted 20-tenant probe parsed `1,488`, accepted `1,477`, quarantined `11`, found RSS dates for `1,488/1,488`, moved Fisher Phillips to `51/51` accepted, kept HSB `Multiple Cities, SC` quarantined as `ambiguous_location`, and found `0` suspicious fake city/country/remote-prefix rows. RMI office-prefix probing moved from `12/33` accepted to `32/33` accepted with `33/33` RSS posting dates; only `Unassigned Office` plus blank detail evidence remains quarantined. A 21-name follow-up probe had 3 current 404 routes and, across successful routes, parsed `1,283`, accepted `1,271`, quarantined `12`, found posting dates for `1,283/1,283`, and found `0` suspicious fake city/country/office evidence rows. Catalyst `openings.php` probing moved posting-date coverage from `0/2` to `2/2` through `rss.php?search=true` while keeping both rows accepted. LaserAway probing moved from `332/334` accepted to `333/334` accepted through exact body `100% remote - work from home` evidence; the remaining row is title-only remote and stays quarantined. Capital Vacations moved to `271/271` parsed/accepted through exact labeled `Office: Remote` plus exact `Apply Today!` placeholder skipping; more specific `Apply Today--...` rows with source location evidence remain parsed. Brightway moved to `328/328` accepted through labeled `td.offices` remote-region scopes such as `Remote - Texas` and `Remote - North Carolina`. A top-24 HRMDirect probe then parsed `11,925`, accepted `11,913`, quarantined `12`, and found posting dates for `11,925/11,925`; a residual evidence pass over those `12` rows found blank detail `Location:` fields with only department/title/body hints, so they remain threshold-guarded quarantines. A top-55 follow-up outside that first group parsed `5,693`, accepted `5,657`, quarantined `36`, and found dates for `5,692/5,693`; an Oberweis targeted recheck then skipped the exact `HERE` placeholder and moved that tenant from `105` parsed/`4` quarantined to `104` parsed/`3` quarantined. Production remains at `0` HRMDirect posting-date rows until the new parser commits are pushed/deployed and source rows are refreshed.
- All `62` ATS source families remain separate parser/source targets. Each family should be analyzed and hardened independently through its own parser module, source module, fixtures, and index-quality evidence rather than by adding ATS-specific parser logic back into `server/index.js`.
- Collector extraction is now registry-owned for the configured ATS module set: HRMDirect, BambooHR, ApplyToJob, Breezy, CareerPlug, CareerPuck, GovernmentJobs, SchoolSpring, Simplicant, K12JobSpot, StateJobsNY, CalOpps, HiBob, USAJobs, TheApplicantManager, ApplicantAI, ApplicantPro, Ashby, Lever, SmartRecruiters, Zoho, RecruitCRM, Recruitee, Fountain, Applitrack, Taleo, PinpointHQ, Join, Rippling, Manatal, Teamtailor, Freshteam, Getro, UltiPro, Workday, ADP MyJobs, ADP WorkForceNow, Greenhouse, iCIMS, isolvisolvedhire, Jobvite, Gem, Paylocity, BrassRing, HireBridge, PageUp, Eightfold, TalentReef, TalentLyft, Talexio, SAP HR Cloud, Oracle, Loxo, CareersPage, CalCareers, and JobAps route through `server/ingestion/sourceRegistry.js` and their own `server/ingestion/sources/<ats>/` modules.
- Current collector target chain: collector-local ATS branches are closed. Future ATS work should focus on source-module certification, parser fixtures, canary evidence, and worker runtime error pressure rather than adding new branches to `server/ingestion/sourceCollectors.js`. No source apply, backfill, cleanup, worker budget change, deploy, or Meili reindex is implied by this architecture note.

## Verified Current State - May 23, 2026

This update supersedes the May 18 worker-gate numbers below for current reliability work.

- Production was verified on `main` at `887a5575d140ea816ef9d0636e79eb25b0564914` before the current ApplyToJob quality-gate patch.
- Worker budget is aligned at `INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET=2000` and `INGESTION_AUTO_SYNC_TARGETS_PER_RUN=50`.
- Read-only worker/source freshness snapshot: due targets about `22.6k`, 24h target success `81.95%`, recent 20-run trend `72.8%`, and throughput scaling decision `hold`.
- Freshness is above the 1k/day target by volume (`29,912` rows seen in 24h and `19,012` new rows), but quality gates still block throughput increase.
- New 24h `no_geo_no_remote` public rows were `40`: `39` ApplyToJob and `1` Breezy.
- Current patch direction: keep throughput fixed, quarantine future ambiguous parenthesized/multi-state ApplyToJob rows, and reject Breezy narrative description text as location evidence instead of public geo.
- Worker failure taxonomy is being tightened before throughput increases: explicit empty job-list payloads are now `empty_no_jobs` instead of parser drift for sources such as BambooHR/Ashby.
- Worker backlog diagnostics recheck old parser-drift events against current policy and now report empty job-list shapes as `current_policy_empty_no_jobs_count` / `current_policy_resolved_count`, instead of leaving BambooHR/Ashby empty-board samples as unresolved parser bugs.
- Worker backlog diagnostics now expose raw and current-policy adjusted failure buckets, including `parser_drift_recheck_adjustments`, so the daily report can separate historical parser-drift noise from unresolved parser bugs.
- Targeted worker diagnostics now expose whether requested ATS keys were included in the latest worker run and rank recovery priorities by current-policy parser bugs, source-quality failures, due backlog, and failure pressure.
- `audit:source-freshness` `quality_gate_sources_24h` should be used after the next worker run to measure ApplyToJob/Breezy post-patch impact before any throughput increase.
- CareerPlug source-quality recovery has a narrow parser patch for current public jobs rows where the title anchor is separate from sibling location/type cells. This should reduce new CareerPlug `no_geo_no_remote` quarantines without lowering thresholds.
- HRMDirect source-quality recovery now includes bounded detail-page enrichment for title-only and grouped-div list rows plus optional RSS date enrichment, using only `td.cities` remote-scope labels, exact list `td.state` US state abbreviations, exact `table.viewFields Location: Remote/Hybrid` labels as remote evidence, exact detail `Location:` remote-scope labels after stripping the remote prefix, exact detail `Location:` US state abbreviations as country evidence without city fabrication, `table.viewFields` labeled geo `Location:`, exact full-state/Canadian province/country `Office:`, `Workplace Type:`, exact detail `#LI-Remote/#LI-Hybrid` tags, detail body `Location:` labels that directly say remote/hybrid role, exact detail body work-arrangement/work-environment or work-mode tags, detail body `Location:` labels with a US street address plus city/state/ZIP, `Department:`, labeled detail date fields, duplicate-`req` `req_loc` detail location evidence, RSS item `pubDate` evidence tied to a matching `req` from item `link` or `guid`, and explicit `detail_404_or_410` quarantine evidence for stale/removed detail pages. Rows without deterministic detail geo or explicit remote/hybrid evidence remain quarantined even when the source says `onsite`; no fake geo/remote/date inference is allowed.
- Remaining search-index drift is a single extra Meili document for a Lever demo placeholder title (`count_delta=-1`). Do not repair with delete/reindex without explicit approval.

## Verified Current State - May 18, 2026

This section supersedes older v1.9.0 recovery notes below when the two conflict.

- Repo release line: `v1.9.3` after the May 18 patch metadata update.
- Latest deployed production code before this docs/version refresh: `89a997036257a9a162014a9f8e3f68ffcab8833c` on `codex/production-baseline-audit`.
- Production branch before this refresh: `codex/production-baseline-audit`, aligned with `origin/codex/production-baseline-audit`.
- Public domain: `openjobslots.com`.
- Production host/path: production / `public-services`, `/root/OpenJobSlots`.
- Auto-deploy timer: `openjobslots-deploy.timer` inactive.
- Services observed running: app, worker, Postgres, and Meilisearch.
- Worker auto sync is enabled with `INGESTION_AUTO_SYNC_DAILY_TARGET_BUDGET=1000`, `INGESTION_AUTO_SYNC_TARGETS_PER_RUN=25`, and `INGESTION_WORKER_INTERVAL_MS=1800000`.
- 30-day public retention is active through `OPENJOBSLOTS_POSTING_HOT_DAYS=30`.

Fresh read-only production baseline from May 18, 2026:

- Visible postings: `50,890`.
- Hidden postings: `0`.
- Visible postings older than the 30-day `last_seen_epoch` window: `0`.
- New postings in 24h by `created_at`: `242`.
- Rows refreshed/seen in 24h by `last_seen_epoch`: `852`.
- Rows refreshed/seen in 3d by `last_seen_epoch`: `852`.
- Newest `last_seen`: `2026-05-18 14:15:26Z`.
- Oldest visible `last_seen`: `2026-05-12 16:01:27Z`.
- Search parity: Postgres indexable `50,888`, Meili documents `50,888`, delta `0`.
- Excluded-but-visible placeholders: `2` rows with placeholder titles.

Current source state:

- Total ATS sources: `62`.
- Enabled sources: `20`.
- Disabled sources: `42`.
- Normal enabled sources: `14`.
- Canary-only sources: `2` (`taleo`, `zoho`).
- Quarantine-only sources: `4` (`applitrack`, `icims`, `recruitcrm`, `recruitee`).
- Auto-disabled sources: `3` (`manatal`, `pinpointhq`, `workday`).
- Disabled normal sources: `39`.

Current public quality gaps:

- Missing country: `4,158` / `8.17%`.
- Missing region/state: `4,158` / `8.17%`.
- Missing city: `5,365` / `10.54%`.
- Missing any normalized geo: `8,047` / `15.81%`.
- Missing all normalized geo: `1,476` / `2.90%`.
- Weak or unknown remote classification: `2,160` / `4.24%`.
- Missing all normalized geo plus weak/unknown remote: `23`.

Highest-impact live quality targets:

- `lever`: `1,868` missing-any-geo rows.
- `applytojob`: `1,487` missing-any-geo rows and `18` no-geo/no-remote rows.
- `greenhouse`: `1,045` missing-any-geo rows and `532` weak/unknown remote rows.
- `ashby`: `971` missing-any-geo rows.
- `hrmdirect`: about `640` missing-any-geo rows and `516` weak/unknown remote rows.
- `bamboohr`, `careerplug`, `recruitcrm`, `applitrack`, and `fountain` are the next quality targets by gap density or risk.

Scale posture:

- `100k` visible indexed rows is reachable only through parser/source cleanup plus disabled-source certification, not by lowering quality thresholds.
- `1k` fresh jobs/day is the worker budget target, but current observed run health is below that target: recent runs processed `125` targets with `64` successes, `61` failures, `852` upserts, and `113` rejected candidates.
- The all-source estimator currently takes too long for interactive runs even with low per-source limits. Convert it to a background/report workflow before relying on it for daily planning.
- `jobvite` and `eightfold` are the closest disabled-source expansion candidates after full inventory and fixture certification.
- `hirebridge`, `jobaps`, and `teamtailor` stay blocked until geo/remote risk drops.
- Public-board sources with zero configured targets need source-runner virtual target support before safe estimates are meaningful.

## Current Version

- Package/public release line: `v2.0.0`.
- Previous public release tag: `v1.9.3`.
- Current release branch: `main`.
- Last verified production checkout before this patch metadata/docs refresh: May 24, 2026 architecture deployment on `main`.
- Last verified production deployment date: May 27, 2026 v2 prep deployment.
- Public product name: `openjobslots`.
- Target public domain: `openjobslots.com`.

## Deployment Status

- Production host: production / `public-services`.
- Production checkout: `/root/OpenJobSlots`.
- Deployment source: private GitHub repository `batuhanboran/openjobslots`.
- Auto-deploy: `openjobslots-deploy.timer`, active and checking `origin/main`.
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
- ATS parser/source module model: parser, discovery, fetch, and source-specific normalization behavior belong in `server/ingestion/sources/<ats>/`; shared parser helpers belong in `server/ingestion/parsers/shared/`; `server/index.js` should remain bootstrap/API orchestration and must not regain ATS-specific parser or collector bodies.
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

Public-enabled source growth ran on May 13, 2026 after a fresh production audit and backup.

- Backup: `/root/OpenJobSlots/backups/postgres-openjobslots-pre-public-enabled-growth-20260513-160152.dump`.
- Report prefix: `/root/OpenJobSlots/reports/public-enabled-growth-20260513-160152-*`.
- Source recovery report: `/root/OpenJobSlots/reports/public-enabled-growth-20260513-160152-source-recovery-report.json`.
- Scope was limited to already normal/public-enabled sources; quarantine-only and auto-disabled sources were not processed except read-only comparison.
- Selected sources: `applytojob`, `bamboohr`, `lever`, `greenhouse`, and `careerplug`.
- Selection basis: public-enabled source state, fixture-backed parser confidence, high accepted dry-run volume, existing row count or quality debt, and stable source evidence.
- Global visible postings for the canary window: `50,241 -> 50,300`.
- Selected-source accepted public rows: `26,585 -> 26,644`.
- Public row gain: `59`.
- New selected-source `no_geo_no_remote` public rows: `0`.
- Selected-source missing any normalized geo: `3,457 -> 3,458`; selected-source weak/unknown remote stayed `1,097 -> 1,097`.
- Per-source gains: `applytojob` `+1`, `bamboohr` `+2`, `lever` `+5`, `greenhouse` `+4`, `careerplug` `+47`.
- Canary runs fetched `100` tenants, parsed `1,945` rows, wrote `1,164` public upserts, and wrote `21` quarantine rows.
- `hrmdirect` was not selected for writes because a bounded dry-run parsed `7` rows and accepted `0`; `fountain`, `breezy`, and `applicantpro` were fallback dry-runs only.
- Failure evidence: `applytojob` `ambiguous_location` (`3`), `bamboohr` `no_geo_no_remote` (`1`) and fetch `404` (`6`), `careerplug` `no_geo_no_remote` (`17`) and `missing_position_name` (`2`), plus `hrmdirect` dry-run-only `no_geo_no_remote` (`7`).
- Existing source raw/expected/invalid fixtures were verified by tests; no parser or fixture code changes were needed.
- Meili/Postgres delta remained `-1`, so `ats:recovery:guard` did not pass and no larger bounded apply was run after canary.

The worker remains stopped, app/Postgres/Meili were healthy in the public-enabled growth final checks, and the production auto-deploy timer is stopped/inactive. Use `50,300` as the latest observed visible-count floor, but reconcile the `-1` Meili/Postgres derived-index delta before any larger source apply.

## v1.9.0 Recovery Cycle Closeout

The recovery cycle was closed on May 13, 2026 after final production audits, live endpoint checks, test validation, and a safe derived-index repair.

- Report prefix: `/root/OpenJobSlots/reports/cycle-close-20260513-133740-*`.
- Final data quality: `/root/OpenJobSlots/reports/cycle-close-20260513-133740-data-quality.json`.
- Final ATS quality: `/root/OpenJobSlots/reports/cycle-close-20260513-133740-ats-quality.json`.
- Final source quality: `/root/OpenJobSlots/reports/cycle-close-20260513-133740-source-quality.json`.
- Final quarantine summary: `/root/OpenJobSlots/reports/cycle-close-20260513-133740-quarantine-summary.json`.
- Final Meili check: `/root/OpenJobSlots/reports/cycle-close-20260513-133740-meili-check-final.json`.
- Visible postings: `47,396 -> 50,300` since the v1.8.0 prompt-1 baseline.
- Accepted/public rows: `47,396 -> 50,300`.
- Public row gain: `2,904`.
- Indexable rows: `50,298`; Meili documents: `50,298`; Meili/Postgres delta: `0`.
- Quarantined rows: `4,531 -> 6,496`; rejected rows remain `0`.
- Missing country: `3,113 -> 4,075`.
- Missing city: `5,039 -> 5,226`.
- Missing any normalized geo: `6,824 -> 7,903`.
- Missing all normalized geo: `1,328 -> 1,398`.
- Weak/unknown remote: `1,855 -> 2,142`.
- Missing all geo plus weak/unknown remote: `22 -> 23`.
- Final source states: `17` public-enabled, `2` canary-only, `4` quarantine-only, and `39` disabled/auto-disabled.
- Canary-only sources: `zoho`, `taleo`.
- Quarantine-only sources with accepted public rows preserved: `recruitee`, `applitrack`, `icims`, `recruitcrm`.
- Top final quarantine reasons: `no_geo_no_remote` (`4,866`), `no_structured_location` (`813`), `source_disabled_by_threshold` (`711`), `ambiguous_location` (`80`), `unsupported_tenant_shape` (`19`), and `no_normalized_geo_or_explicit_remote` (`6`).
- `search:reindex:check` initially found the known `-1` Meili/Postgres delta and no pending search outbox rows. A safe replace-mode temp-index reindex was run, validated before swap, and final `search:reindex:check` passed with `count_delta=0`.
- No source recovery writes ran during closeout. No clean rebuild ran. No public rows were truncated, deleted, or hidden.

Recovered ATS/public-row gains in this cycle:

- `recruitee`: `0 -> 519` accepted public rows across initial and expansion waves. Current source state is `quarantine_only` because historical quarantine volume still fails policy.
- `icims`: `20 -> 64` in the iCIMS recovery report (`+44`); current source state remains `quarantine_only`.
- `applitrack`: `0 -> 237` across initial and expansion waves; current source state is `quarantine_only` because source-level geo/remote quality is still below policy.
- `zoho`: `0 -> 440`; current source state is `canary_only`.
- `recruitcrm`: `0 -> 522`; current source state is `quarantine_only` because accepted rate and geo quality are still below policy.
- `taleo`: `0 -> 111`; current source state is `canary_only`.
- Public-enabled growth added `59` rows across `applytojob`, `bamboohr`, `lever`, `greenhouse`, and `careerplug`.

Validation passed:

- `npm run test:backend`
- `npm run test:parsers`
- `npm run test:api` after sandbox `spawn EPERM` rerun
- `npm run quality:gate` after sandbox rerun
- Live `/health`, `/postings/filter-options`, `/sync/status`, `/ingestion/status`, `/ingestion/quality/summary`, `/ingestion/source-quality`, `/ingestion/quarantine-summary`, and representative `/postings` searches

Operational final state:

- Worker stopped; auto-deploy timer inactive.
- App/Postgres/Meili healthy.
- Active Postgres queries: `0`.
- Heavy/advisory locks: `0`.
- Pending search outbox rows: `0`.
- The app container was rebuilt and restarted after tagging so the running package metadata reports `1.9.0`; the worker was not started.
- Idle service stats after the v1.9.0 app restart: app `0.00% CPU / 133.2MiB`, worker stopped, Postgres `2.30% CPU / 562.8MiB`, Meili `0.12% CPU / 2.949GiB`.

Use `50,300` as the current visible-count floor. Future work must remain ATS-by-ATS or source-by-source recovery and must not repeat the v1.8.0 clean-rebuild/shrink-public-dataset strategy.

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
