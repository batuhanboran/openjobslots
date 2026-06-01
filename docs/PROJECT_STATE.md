# OpenJobSlots Project State

This is the short current-state document for future Codex runs. Detailed runbooks live in `docs/reference/`.

## ATS Architecture & Recovery v2 Baseline - June 1, 2026

- Read-only production baseline was refreshed from `proxmox-lxc100` / `public-services`; production `/root/OpenJobSlots` is at `6660eab`, while local `main` is ahead with source-local parser ownership and v2 architecture guard commits.
- Public health: `331,778` visible job slots, `40,860` companies, `29,767` sync-enabled companies, `37` visible ATS, and `69,489` rows seen in 24h. Source state split is `13` full-enabled, `31` canary, `8` quarantine-only, `10` disabled, and `44` worker-auto-eligible ATS.
- Latest sync status was idle. Worker run `1016` completed with errors: `44/45` target success, `911` postings stored, `1` rejected, queue depth about `24.2k`, and public status parser attention `282`.
- Production data quality: `331,778` visible rows; missing country `21,122` (`6.37%`), missing any normalized geo `44,060` (`13.28%`), weak/unknown remote `9,299` (`2.8%`), and missing-all-geo plus weak/unknown remote `95` (`0.03%`).
- Source freshness posture is `hold`, not scale-up: `30,911` due targets, `3,766` processed in 24h, `90.58%` target success, `11,457` new rows, `0` new public no-geo/no-remote rows, but `259` unresolved parser-attention events plus `259` parser-bug failures, `864` source-quality failures, `74` empty-no-jobs failures, `5` auth failures, `3` rate-limit failures, and `7` unknown failures.
- Immediate source recovery order from the live evidence is `zoho`, `hrmdirect`, `breezy`, `teamtailor`, `bamboohr`, `adp_workforcenow`, `applytojob`, `ultipro`, `loxo`, and `rippling`. Keep fixes source-local with raw fixtures, parser evidence, public gate evidence, and before/after quality proof.
- Search parity is not clean. `check-search-parity --api-base-url=https://openjobslots.com --limit=10` failed all 12 default cases in the baseline. Fresh `search:reindex:check -- --json --sample-limit=25` showed document counts aligned (`331,772` Postgres-indexable and `331,772` Meili documents, no missing/extra docs), but returned `ok=false` because remote facets drift by `40` onsite, `2` remote, and `-42` unknown documents, with sampled stale CareerPlug city fields. Replace reindex or targeted repair still needs explicit approval.
- Architecture boundary is improved and currently warning-free. ATS filter options, legacy host aliases, and sync-enabled ATS normalization live in `server/ingestion/atsFilters.js`, with `server/ingestion/adapters.js`, `server/ingestion/worker.js`, and `server/index.js` consuming that module. Legacy SQLite dynamic sync bootstrap targets and their estimated company counts now live in `server/ingestion/legacySyncTargets.js`. `audit:architecture-boundary -- --json` passes with `server/index.js` at `2554/3000` lines, and now line-caps the next orchestration surfaces: `sourceCollectors.js`, `sourceDiscovery.js`, `sources/common.js`, and `sourceRegistry.js`.
- This checkpoint ran no production source apply, canary/apply, data backfill, public-row delete/hide, Meili replace reindex, deploy, or worker-budget increase.

## Source Module Inventory - June 1, 2026

- Local architecture checkpoint after commit `836d6c2`: production is still `/root/OpenJobSlots` `6660eab`, public rows were freshly observed at `332,539`, and source freshness stayed on `hold` with `160` unresolved parser-attention events. Existing parser fixes remain local until an explicit deploy/source refresh.
- `server/ingestion/sources/index.js` now builds startup source-module inventory from every source-local directory with an `index.js`. This removes the transitional `LOCAL_ONLY_SOURCE_ATS_KEYS` exception and makes all `60` contract modules visible through `DIRECT_SOURCE_ATS_KEYS` and `sourceModules`, not just the `35` legacy `SOURCE_SPECS`/exception modules.
- `server/ingestion/sources/directSourceModules.test.js` now asserts that every source-local module directory is registered and exposes the required source contract. `ats:registry-index -- --json --no-write` reports `configured_ats_count: 60`, `read_only_recovery_ready_count: 60`, and no recovery readiness blockers.
- Follow-up boundary cleanup moved Breezy's `__json` optional-enrichment payload-shape policy out of `server/ingestion/sources/common.js` and into `server/ingestion/sources/breezy/index.js`; `audit:architecture-boundary` now fails if that source-local policy drifts back into `common.js`.
- No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run for this architecture slice.

## CareerPlug Single-Job Detail Route - June 1, 2026

- Fresh parser-drift samples showed some CareerPlug boards returning empty arrays; live read-only probes found `fastsigns-11603` was not empty but served one application detail page from the `/jobs` route.
- CareerPlug now parses that single-detail shape from `link[rel='alternate']` or app detail links, canonicalizes the job URL back to the tenant `/jobs/:id`, strips `Future Opening:` title prefixes, and accepts geo only from deterministic mailto share-body `state - city - label zip` evidence. Employment type is accepted only from explicit labels such as `Full Time`.
- Live read-only proof on `fastsigns-11603`: current local parser moved the page to `1/1` parsed and public-gate accepted, emitting source job id `3255261`, `Austin, TX, United States`, `onsite`, and `Full Time` with `careerplug_detail_html` evidence.
- Verification covered CareerPlug syntax checks and the generic HTML/public source-module test suite with the new fixture. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Paylocity Country-Scope Broad Location - June 1, 2026

- Fresh read-only cache evidence had Paylocity broad labels such as `Various Locations`, `Various Metro Locations`, and `Various Locations Across the U.S.` quarantined even when `Jobs[].JobLocation.Country` supplied `USA`.
- Paylocity now collapses those labels to country-scope `United States` only when city/state are blank and source country evidence is present. The raw broad label stays in `source_evidence.location_raw`; no city, state, tenant, or title inference was added.
- Live read-only proof moved two current `NORTHSTAR-BEHAVIORAL-HEALTH-NETWORK-LLC` rows and one `Empire-Marketing-Strategies` row to public-gate accepted country-scope rows while preserving concrete Paylocity city rows unchanged.
- Verification covered Paylocity syntax checks, enterprise source-module tests with the new fixture, and live read-only parser probes. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## BambooHR Country-Scope Broad City - June 1, 2026

- Fresh read-only cache evidence had `resurgo.bamboohr.com/careers` row `Development Coach` quarantined as `ambiguous_location` because BambooHR supplied `result[].location.city="Various"` with `state="Greater London"` and `country="United Kingdom"`.
- BambooHR now collapses exact source broad city values `Various` / `Various Location(s)` to country-scope location text only when deterministic source country/admin-region evidence is present. The raw source label remains in `source_evidence.location_raw`; no city, tenant, title, or body inference was added.
- Live read-only proof on Resurgo parsed `6` rows and moved `Development Coach` to public-gate accepted with `location_text="United Kingdom"`, blank city, `country="United Kingdom"`, `remote_type="onsite"`, and `bamboohr_country_scope_location` evidence.
- Verification covered BambooHR direct source-module tests, `npm.cmd run test:backend`, `npm.cmd run audit:architecture-boundary`, `npm.cmd run ats:registry-index -- --json`, `npm.cmd run ats:workbench -- --source=bamboohr --json`, `git diff --check`, and changed-file sensitive-string scanning. `release:ats-recovery:check -- --source=bamboohr --json` correctly remained blocked because no production before/after reports, guard report, preflight report, or Meili parity report were supplied. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Teamtailor Georgia City-Country Evidence - June 1, 2026

- Fresh read-only production/cache evidence showed accepted Teamtailor rows from `everymatrix.teamtailor.com` where `Batumi, Georgia` normalized to `United States / North America` because shared normalization treated `Georgia` as a US state.
- Teamtailor now applies a source-local city-country hint only for deterministic country-Georgia city labels such as `Batumi, Georgia` and `Tbilisi, Georgia`. This stays out of shared country normalization so US locations such as `Atlanta, Georgia` are not affected.
- Live read-only proof on EveryMatrix parsed `60` rows and corrected `6` current `Batumi, Georgia` rows to `country="Georgia"`, `region="EMEA"`, `city="Batumi"`, `remote_type="onsite"`, and `teamtailor_city_country_hint` evidence while keeping them public-gate accepted.
- Verification covered Teamtailor HTML/public source-module tests, `npm.cmd run test:backend`, `npm.cmd run audit:architecture-boundary`, `npm.cmd run ats:registry-index -- --json --no-write`, `npm.cmd run ats:workbench -- --source=teamtailor --json --no-write`, `git diff --check`, and changed-file sensitive-string scanning. `release:ats-recovery:check -- --source=teamtailor --json` correctly remained blocked because no production before/after reports, guard report, preflight report, or Meili parity report were supplied. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Jobvite Broad Detail City Country-Scope - June 1, 2026

- Fresh read-only cache evidence showed PANYNJ Jobvite rows with `source_list_location="Various NY/NJ PA Locations, New York"` quarantined as `ambiguous_location` even though detail JSON-LD supplied explicit `addressCountry="United States"`.
- Jobvite now treats broad detail/list city labels such as `Various ... Locations` as non-city scope labels and collapses the published location to country-scope only when deterministic detail JSON-LD country evidence is present. Raw source labels stay in source evidence; no title, tenant, body, or state-only inference was added.
- Live read-only proof on `jobs.jobvite.com/panynj` parsed `20` rows and moved the three current broad PANYNJ rows to public-gate accepted with `location_text="United States"`, blank city, `country="United States"`, and `jobvite_json_ld_country` evidence. A control probe on `redalpha` kept `Various, Alaska` quarantined as `no_geo_no_remote` because no explicit country/detail evidence exists.
- Verification covered Jobvite HTML/public source-module tests, `npm.cmd run test:backend`, `npm.cmd run audit:architecture-boundary`, `npm.cmd run ats:registry-index -- --json --no-write`, `npm.cmd run ats:workbench -- --source=jobvite --json --no-write`, and live read-only parser probes. `release:ats-recovery:check -- --source=jobvite --json` correctly remained blocked because no production before/after reports, guard report, preflight report, or Meili parity report were supplied. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## ApplyToJob State-Scope Broad Locations - June 1, 2026

- Fresh read-only cache evidence showed ApplyToJob state-scope broad labels such as `Multiple Locations, CT`, `Multiple Cities, AZ`, and `Multiple Cities/States, MN` still carrying ambiguous location text even when the suffix was a deterministic US state code.
- ApplyToJob now collapses those broad labels to country-scope `United States` only when a broad multi-location prefix is followed by a source US state code. The raw label remains in `source_evidence.location_raw`; no city, tenant, title, body, or bare state-only inference was added.
- Live read-only proof on `ctstatecommunitycollege.applytojob.com` parsed `56` rows and moved `13` current `Multiple Locations, CT` rows to public-gate accepted with blank city, `country="United States"`, and `applytojob_country_scope_location` evidence. The `prepnetworkllc` control kept `(Multiple States)` rows quarantined because no state/country suffix evidence exists.
- Verification covered ApplyToJob HTML/public source-module tests, `npm.cmd run test:backend`, `npm.cmd run audit:architecture-boundary`, `npm.cmd run ats:registry-index -- --json --no-write`, `npm.cmd run ats:workbench -- --source=applytojob --json --no-write`, and live read-only parser probes. `release:ats-recovery:check -- --source=applytojob --json` correctly remained blocked because no production before/after reports, guard report, preflight report, or Meili parity report were supplied. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Teamtailor Demo Placeholder Skip - June 1, 2026

- Fresh read-only cache/live evidence showed Teamtailor template boards producing placeholder rows such as `DEMO - ...`, `DEMO: ...`, `DEMO ...` with dash variants, plus parser fallback `Untitled Position` rows when the source exposed a job link without usable title text.
- Teamtailor now skips exact demo-prefixed and `Untitled Position` parser-fallback titles at RSS and HTML parse time. This removes template rows before public gate evaluation and does not infer geo/remote fields or change normal titled rows.
- Live read-only proof: `entrepriselea.teamtailor.com` dropped `14` demo rows while keeping `14` real titled rows; `brella`, `jrni`, and `workslife` dropped to `0` parsed rows because the current boards only exposed demo/untitled placeholders.
- Verification covered Teamtailor HTML/public source-module tests, `npm.cmd run test:backend`, `npm.cmd run audit:architecture-boundary`, `npm.cmd run ats:registry-index -- --json --no-write`, `npm.cmd run ats:workbench -- --source=teamtailor --json --no-write`, and live read-only parser probes. `release:ats-recovery:check -- --source=teamtailor --json` correctly remained blocked because no production before/after reports, guard report, preflight report, or Meili parity report were supplied. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## ApplyToJob Bracketed Test Placeholder Skip - June 1, 2026

- Fresh live read-only evidence on `cmsprep.applytojob.com` showed `494` current rows whose titles started with bracketed `[TEST]`, including `452` rows that public gate would otherwise accept because they carried country or remote evidence.
- ApplyToJob now skips titles starting with bracketed `[TEST]` at parse time, while keeping ordinary source titles such as `Test Engineer` accepted when they have valid public evidence. The rule is source-local and does not broaden the global public gate.
- Live read-only proof after the local change: `cmsprep.applytojob.com/apply` returned `portal_search_empty` because the current board only exposed skipped bracketed test placeholders, leaving `0` parseable public rows.
- Verification covered ApplyToJob HTML/public source-module tests, `npm.cmd run test:backend`, `npm.cmd run audit:architecture-boundary`, `npm.cmd run ats:registry-index -- --json --no-write`, `npm.cmd run ats:workbench -- --source=applytojob --json --no-write`, `git diff --check`, changed-file sensitive-string scanning, and live read-only parser proof. `release:ats-recovery:check -- --source=applytojob --json` correctly remained blocked because no production before/after reports, guard report, preflight report, or Meili parity report were supplied. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## HRMDirect Remote Full-Time Sentence Evidence - June 1, 2026

- Fresh read-only production evidence kept HRMDirect as the top current parser-validation source: `220` recent HRMDirect parser-validation rows in the 24h sample, mostly `no_geo_no_remote`. Local probes showed earlier HRMDirect fixes already move some production errors such as `adhoc` to accepted, while residual boards need strict source evidence.
- HRMDirect detail prose now accepts explicit sentences shaped like `This is a remote full-time position/role` as remote evidence under the existing source-local explicit-remote-sentence rule. This does not infer location, country, city, or work mode from titles, company names, generic eligibility text, or company office prose.
- Live read-only proof on `trustvip.hrmdirect.com`: current local parser parsed `15` rows and accepted `14`, leaving only the detail page with no explicit geo/remote evidence quarantined. Rows such as `Senior Sales Executive` and `OpenText ADM Consultant- Part-time` now carry `hrmdirect_detail_body_explicit_remote_sentence` evidence.
- Verification covered HRMDirect HTML/public source-module tests including a red/green fixture update, `npm.cmd run test:backend`, `npm.cmd run audit:architecture-boundary`, `npm.cmd run ats:registry-index -- --json --no-write`, `npm.cmd run ats:workbench -- --source=hrmdirect --json --no-write`, and live read-only parser proof. `release:ats-recovery:check -- --source=hrmdirect --json` correctly remained blocked because no production before/after reports, guard report, preflight report, or Meili parity report were supplied. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## HRMDirect Payload Shape Enrichment Policy - June 1, 2026

- Fresh production drift evidence showed repeated HRMDirect payload-shape events where the observed payload differed only by source-run enrichment fields such as `__detailHtmlByUrl`, `__detailStatusByUrl`, `__detailFailureByUrl`, and RSS sidecars.
- HRMDirect now declares those detail sidecar maps in its source-local `payloadShapePolicy.optional_enrichment_prefixes`, next to the existing RSS optional fields. This keeps transient detail/RSS enrichment out of parser-drift classification without suppressing real HTML/list shape changes.
- Verification covered a red/green `sourceRegistry` contract assertion and `postgresStore-sync-control` drift-policy tests. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Breezy Payload Shape Enrichment Policy - June 1, 2026

- Fresh production drift samples showed Breezy payload-shape events where the observed payload was dominated by optional `__json` enrichment plus detail sidecar maps such as `__detailHtmlByUrl`, `__detailStatusByUrl`, and `__detailFailureByUrl`.
- Breezy now declares the detail sidecar maps in its source-local `payloadShapePolicy.optional_enrichment_prefixes` alongside `__json`. This keeps optional enrichment payloads out of parser-drift classification while preserving real HTML/API list-shape drift detection.
- Verification covered a red/green `sourceRegistry` contract assertion, `postgresStore-sync-control` drift-policy tests, `npm.cmd run test:backend`, `npm.cmd run audit:architecture-boundary`, `npm.cmd run ats:registry-index -- --json --no-write`, and `npm.cmd run ats:workbench -- --source=breezy --json --no-write`. `release:ats-recovery:check -- --source=breezy --json` correctly remained blocked because no production before/after reports, guard report, preflight report, or Meili parity report were supplied. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## ATS Recovery v2 Edge-Shape Hardening - June 1, 2026

- Local `main` now includes the ATS recovery proof-gate and edge-shape commits `401720b`, `5392e04`, `5613703`, `f98d75d`, `ed501f4`, and `9a6da08`. These are local-only until deploy/source refresh; production `/root/OpenJobSlots` was last verified separately at `6660eab` during the refreshed baseline.
- Release proof gates now reject hand-wavy recovery claims: `scripts/release-ats-recovery-check.js` requires explicit before/after net-new evidence, search parity, field-quality deltas, source-local fixture coverage, rollback notes, and no missing production proof before a recovery release can be called ready.
- Breezy, ADP Workforce Now, UltiPro, BambooHR, HiBob, and TalentReef now have stricter edge-shape coverage for empty boards, malformed raw rows, missing list geo, and source-backed title handling. The parsers skip raw rows without source titles instead of inventing `Untitled Position`, and no-geo/no-explicit-remote rows stay quarantined instead of being promoted.
- Verification across these local checkpoints covered focused parser/source tests, live read-only parser probes where useful, `npm.cmd run test:backend`, `npm.cmd run test:api`, `npm.cmd run audit:architecture-boundary`, `npm.cmd run ats:registry-index -- --no-write`, `git diff --check`, and changed-file secret scans. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Breezy State-Scope City Evidence - June 1, 2026

- Fresh read-only production evidence kept production at `/root/OpenJobSlots` `6660eab` with `332,387` visible job slots and source freshness still on `hold`. Breezy was the top current parser-attention source with `88` recent parser-bug events and `4,045` quarantined cache rows, mostly `no_geo_no_remote` or ambiguous multi-location labels.
- Breezy public JSON can place state/province scopes or comma-separated multi-locality labels in `location.city` while country evidence is still present, such as `location.city="Maryland"` with `country.name="United States"`.
- The Breezy parser now treats US state names/codes, Canadian province names/codes, values equal to state/country, source country aliases, and comma-separated multi-locality labels as non-city evidence unless the text has explicit city/town/county/parish cues. It preserves source-backed country evidence and leaves `city` blank; no tenant/title/body inference was added.
- Live read-only proof on `prep-academy-tutors`: current local parser accepted `200/200` rows with `0` state-scope city rows and `0` multi-city city rows. The sampled `Maryland, US` row now normalizes to `United States` with blank city.
- Verification covered focused Breezy tests, live read-only parser probes, `npm.cmd run test:backend`, `npm.cmd run test:api`, `npm.cmd run audit:architecture-boundary -- --json`, `npm.cmd run ats:registry-index -- --json --no-write`, `npm.cmd run ats:workbench -- --source=breezy --json --no-write`, `git diff --check`, and changed-file secret scans. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Loxo Bounded Detail Location Evidence - June 1, 2026

- Fresh read-only production evidence had Loxo at `83` recent `no_geo_no_remote` parser-validation rows. Top failing targets included `Vertical-Recruitment` and `Top-Tier-Talent-Group`; Loxo remains high missing-normalized-geo risk.
- The Loxo parser now performs a bounded detail pass for rows whose list `job-location` is blank, capped at `10` detail pages per target by default. It accepts only strict detail `strong:Location` evidence for country or explicit remote; unlabeled body prose, titles, company names, and tenant names remain unused.
- Live read-only proof on `Vertical-Recruitment`: accepted rows improved from `507/538` to `510/538`, fixing labeled `South Manchester`, `Any UK office`, and `Remote | Type: Full-time` rows. `Top-Tier-Talent-Group` stayed `66/68` accepted because its remaining gaps lacked strict detail location labels.
- Verification covered Loxo syntax checks, focused tests, html/public source tests, live parser probes, `npm.cmd run test:backend`, `npm.cmd run test:api`, `npm.cmd run audit:architecture-boundary -- --json`, `npm.cmd run ats:registry-index -- --json --no-write`, and `npm.cmd run ats:workbench -- --source=loxo --json --no-write`. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Lever Duplicate Team/Location City Evidence - June 1, 2026

- Fresh read-only production evidence had Lever at `14` recent `no_geo_no_remote` parser-validation rows. The main live target was `pp-la`, where `categories.location` and `categories.team` both carried the same clinic/city label.
- Lever now preserves source `categories.location` when it matches a source-local observed city/neighborhood country hint, even if `categories.team` duplicates it. Employment categories such as `Full-time` are still filtered, and no body/title/tenant inference was added.
- Live read-only proof on `pp-la`: accepted rows improved from `13/24` to `24/24`, covering `Van Nuys`, `Burbank`, `Compton`, `East Los Angeles`, `Long Beach Central`, `Koreatown`, `Santa Monica`, `Huntington Park`, and `Lakewood` with United States country evidence from `[].categories.location`.
- Verification covered focused Lever tests, live parser proof, `npm.cmd run test:backend`, `npm.cmd run test:api`, `npm.cmd run audit:architecture-boundary -- --json`, `npm.cmd run ats:registry-index -- --json --no-write`, and `npm.cmd run ats:workbench -- --source=lever --json --no-write`. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## HRMDirect Explicit Remote Detail Sentence - June 1, 2026

- Fresh read-only production evidence kept HRMDirect as a high-volume source-quality lane, but live re-parsing showed only a narrow parser gap on deterministic remote evidence.
- HRMDirect now accepts spaced structured detail tags such as `#LI - Remote` and exact body sentences such as `This is a remote position/role/job/opportunity` as explicit remote evidence. It still does not infer from title-only remote text, tenant names, blank structured location rows, or broad body prose.
- Live read-only proof on `timelycare`: accepted rows improved from `20/30` to `29/30`. The `wsps` sample stayed `0/6` accepted because its structured fields remain blank and only title/body-region prose is available.
- Verification covered HRMDirect syntax checks, focused html/public source tests, and live parser probes. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Jobvite Multiple-Country Label - June 1, 2026

- Fresh read-only production evidence had a small Jobvite residual on `saama`: `Multiple, United States` list labels were being carried into public location text despite detail JSON-LD country evidence.
- Jobvite now treats generic multi-location labels with a country suffix as ambiguous list labels, keeps them out of city/location fields, and preserves source-backed country-only geo from detail JSON-LD.
- Live read-only proof on `saama`: accepted rows improved from `8/10` to `10/10`; the two fixed rows now publish `United States` with blank city from JSON-LD country evidence.
- Verification covered Jobvite syntax checks, focused html/public source tests, and live parser proof. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## ApplyToJob Country-Scope And Placeholder Hardening - June 1, 2026

- Fresh read-only production evidence kept ApplyToJob as a large remaining surface: `51,370` visible rows, `9,122` missing-any-normalized-geo rows, `1,438` weak/unknown remote rows, `7,173` parser errors, and `3,571` rejections. Recent ApplyToJob parser-validation pressure was dominated by `no_geo_no_remote`, `ambiguous_location`, and combined `ambiguous_location, no_geo_no_remote` rows.
- The ApplyToJob parser now collapses source labels like `Various locations, Japan, Japan` and `Multiple locations, Taiwan, Taiwan` into country-scope locations only when the same source field carries a deterministic country token. Raw source text remains in `source_evidence.location_raw`, and unresolved labels such as `Multiple Countries` / `(Multiple states)` still stay quarantined.
- Exact ApplyToJob placeholder titles such as `test`, `Test Job 1`, `sample job`, and `demo job` are skipped at parse time across list, legacy, generic-card, and JSON-LD routes. This is source-local and does not broaden the global public gate placeholder pattern.
- Live read-only proof after the local change: `reachtoteachrecruiting` improved from `2` country-backed ambiguous quarantines to `4/4` accepted rows; `pacificacontinental` stopped emitting three exact test placeholder rows and reduced flagged rows from `9` to `6` while keeping accepted rows at `435`; intentionally broad multi-country/multi-state rows on `opencapitaladvisors`, `prepnetworkllc`, and `h2oai` remained quarantined.
- Verification covered focused ApplyToJob source-module tests, live read-only parser probes, `npm.cmd run test:backend`, `npm.cmd run test:api`, `npm.cmd run audit:architecture-boundary`, `npm.cmd run ats:registry-index -- --no-write`, `git diff --check`, and changed-file secret scans. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Ashby Global Remote-Scope Evidence - June 1, 2026

- Fresh read-only production evidence had Ashby at `28,055` visible rows, `5,882` missing-any-normalized-geo rows, `292` missing-all-geo rows, `200` weak/unknown remote rows, and `8` rows missing all geo plus weak remote. Recent parser-validation pressure included `ambiguous_location, no_geo_no_remote` on `lido.fi`, `peek`, and `attio`, plus `ambiguous_location` on `aiand`.
- Ashby `jobs[].location` values of exactly `Worldwide` or `Global` are now treated as explicit remote-scope evidence with `ashby_global_remote_scope`. This is source-local and uses only the list API location field; `All Locations` and other generic/open-application labels remain quarantined.
- Live read-only proof after the local change: `lido.fi` improved from `0/3` accepted to `3/3` accepted with three global remote-scope rows; `aiand` improved from `25/27` accepted to `27/27` accepted with two global remote-scope rows; `peek` and `attio` kept their `All Locations` general-application rows quarantined.
- Verification covered focused Ashby source-module tests and live read-only parser probes. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Zoho Remote Job Evidence - June 1, 2026

- Fresh read-only source evidence kept Zoho as the top recovery priority: `356` recent `no_geo_no_remote` source-quality failures, `14,562` visible rows, `1,860` missing country/region rows, `2,511` missing-any-geo rows, `235` weak/unknown remote rows, and `0` visible no-geo/no-remote rows.
- Zoho hidden `jobs` payloads expose a source-backed `Remote_Job` boolean. The parser now maps only `Remote_Job: true` to explicit remote evidence with `jobs[].Remote_Job` as the field path and `zoho_remote_job_flag` as the rule. It does not infer country, city, or remote state from titles, company names, or body text.
- Live read-only parser proof after the local change: `gotocme` parsed/accepted `9/9` rows with `6` `Remote_Job` remote-evidence rows and `0` `no_geo_no_remote`; `basecodetech` parsed/accepted `9/9` with `5` remote-evidence rows and `0` `no_geo_no_remote`; `teamsquared` parsed/accepted `108/108` with `99` remote-evidence rows and `0` `no_geo_no_remote`.
- This is local-only until deploy/source refresh. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## HRMDirect Location Section Remote Evidence - June 1, 2026

- Fresh read-only production evidence kept HRMDirect as the second recovery priority after the already-local Zoho fix: `314` recent parser-validation failures, including `310` `no_geo_no_remote` rows and `2` parser-drift rows. Top source-quality tenants included `timelycare`, `trustvip`, `opco`, `terraboost`, `visitglenbrook`, and `weg`.
- Some HRMDirect detail pages expose a labeled body `Location` section where the source text says exactly `This is a remote position/role/job`. The parser now treats only that label-bounded phrase as explicit remote evidence with `detail body Location` / `hrmdirect_detail_body_location_remote`. It does not use title suffixes such as `- TX`, company names, generic remote prose, or license-state text for country/city/remote inference.
- Live read-only parser proof after the local change: `timelycare` parsed `30` rows, accepted `20`, reduced `no_geo_no_remote` from `29` to `10`, and emitted `20` source-backed `detail body Location` remote rows. `trustvip`, `visitglenbrook`, and residual `weg` rows stayed quarantined where the source still lacked useful geo or explicit remote/hybrid evidence.
- This is local-only until deploy/source refresh. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Gem GraphQL Location Country And Work-Mode Evidence - June 1, 2026

- Fresh read-only production snapshot for Gem showed `31` visible rows, `22` missing country/region rows, `3` weak/unknown remote rows, `31` missing posting dates, and no missing source ids.
- Gem public GraphQL batch payloads expose `locations[].isoCountry`, `locations[].city`, `locations[].isRemote`, and `job.locationType`. The parser now carries those fields as source-local evidence instead of relying only on `locations[].name`.
- `Remote (US)`, `Remote - US`, and `Remote` rows with `isoCountry=USA` now normalize to `United States` with explicit remote evidence. Hybrid rows with a concrete non-remote country such as `Bari` / `ITA` now keep Italy and `hybrid`. Broad `Global` remote rows are accepted as explicit remote but remain countryless and no longer store `Global` as city.
- Live read-only proof across `codesignal`, `credit-key`, `cloudx`, `data-masters`, and `clarity`: current local parser parsed `33` rows with `33` accepted, reduced accepted missing country/region from the earlier sampled `22` to `11`, reduced weak/unknown remote from `3` to `0`, and preserved country evidence paths such as `jobPostings[].locations[].isoCountry`.
- Posting dates remain null because observed Gem list payloads do not expose posting-date fields. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Greenhouse Large Board Content Fallback - June 1, 2026

- Fresh read-only production checks kept `/root/OpenJobSlots` at `6660eab`; public health reported `331,698` visible job slots and Meili/Postgres count parity with the known `40` document remote-facet drift still unresolved. No Meili repair or replace reindex was run.
- Greenhouse production quality baseline remained `5,373` visible rows, `289` missing country/region rows, and `630` weak/unknown remote rows. The top Greenhouse gap board `fever-up` had `597` rows and failed local live fetches because `jobs?content=true` exceeded the source response-size guard.
- Greenhouse fetch now keeps `jobs?content=true` as the default canonical list request but retries `jobs` without content only when the first API payload fails with `response_too_large`. Source metadata records the canonical board URL, actual requested URL, `contentIncluded=false`, and the two payload fetches.
- Live read-only proof on `feverup`: fallback fetched and parsed `597` current rows with `597` public-gate accepted, `0` rejected/quarantined, `83` missing country/region rows but `0` missing-all-geo rows, `132` unknown remote-type rows, and `0` `no_geo_no_remote` or `weak_remote_evidence` gate reasons.
- The fallback intentionally trades detail content for complete list preservation on oversized boards. Description HTML is null when the fallback is used; source ids, canonical URLs, location, office metadata, and first-published dates remain available from the list API. Verification covered Greenhouse syntax checks, focused local Greenhouse tests, live read-only parser proof, `npm.cmd run test:parsers -- --runInBand`, `npm.cmd run test:backend`, `npm.cmd run test:api`, `npm.cmd run audit:architecture-boundary -- --json`, `npm.cmd run ats:registry-index -- --json --no-write`, and `git diff --check`. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## RecruitCRM Source-Local City Country Evidence - June 1, 2026

- Fresh read-only production baseline for this lane had RecruitCRM at `522` visible rows, `475` missing country/region rows, `10` weak/unknown remote rows, and `522` missing posting dates. Top missing-country boards included `somewhere`, `Talentbank_1_jobs`, `rcrm`, `TLNT_Group_jobs`, `talentsource`, `Ensitech_Careers`, and `Golabs_Tech_jobs`.
- Fresh production health during this lane kept `/root/OpenJobSlots` at `6660eab` with app/worker/Postgres/Meili running and public health at `331,640` visible job slots. `search:reindex:check -- --json --sample-limit=25` had Postgres/Meili count parity (`331,653`/`331,653`) but remained `ok=false` because remote facets drifted by `40` onsite vs unknown documents. No Meili repair or replace reindex was run.
- RecruitCRM public API payloads expose structured `city`, `locality`, `postalcode`, and `remote` fields. The parser now maps only source-local deterministic city/country hints observed in those API fields, including Malaysia, Philippines, South Africa, Colombia, Argentina, India, France, and UK labels.
- No tenant/title/body inference was added. Broad or ambiguous values such as `Remote`, `Global`, `LATAM`, `Somewhere`, `San José`, `San Pedro`, and title-only country hints remain unresolved. `remote=2` stays `unknown` until the source semantics are proven. Posting dates remain null because sampled payloads did not expose a date field.
- Follow-up architecture cleanup keeps RecruitCRM parser ownership out of `server/ingestion/sources/common.js`; `audit:architecture-boundary` now fails if RecruitCRM parser imports or parser specs drift back into common.
- Live read-only proof: `Talentbank_1_jobs` accepted missing country/region improved `45 -> 0`; `rcrm` improved `37 -> 1`; `talentsource` improved `21 -> 9`; `somewhere` improved `253 -> 206` on current live accepted rows.
- Verification covered RecruitCRM syntax checks, direct source-module fixture tests, and live read-only parser probes. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## CareersPage Source-Local City Country Evidence - June 1, 2026

- Fresh read-only production baseline for this lane had CareersPage at `229` visible rows, `217` missing country/region rows, `84` weak/unknown remote rows, and `229` missing posting dates. Top missing-country boards included `new-paradigm-staffing`, `nextgen-hospitality-solutions`, `netchex`, `new-jersey-iec`, and `nextstep`.
- CareersPage list HTML exposes labeled location spans, and `nextgen-hospitality-solutions` uses city-only list values for many United States restaurant roles. The parser now maps only source-local deterministic city/country hints from that labeled list field. No detail crawl, title/body, tenant-name, or board-name inference was added.
- Remote-only and hybrid-only labels remain countryless. Ambiguous standalone city labels such as `Aurora`, `Fayetteville`, `Lancaster`, `Orange`, `Columbus`, and `Independence` remain unresolved. Posting dates remain null because sampled list payloads did not expose dates.
- Follow-up architecture cleanup keeps CareersPage parser ownership out of `server/ingestion/sources/common.js`; `audit:architecture-boundary` now fails if CareersPage parser imports or parser specs drift back into common.
- Live read-only proof: `nextgen-hospitality-solutions` parsed/accepted `94` current rows with accepted missing country/region `86 -> 15` and `71` rows carrying `careerspage_city_country_hint` evidence. Remote-only boards such as `new-paradigm-staffing`, `netchex`, and `new-jersey-iec` stayed countryless by design.
- Verification covered CareersPage syntax checks, local CareersPage fixture tests, generic HTML/public source-module tests, and live read-only parser probes. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Jobvite Source-Local Location Evidence And Detail Priority - June 1, 2026

- Fresh read-only production baseline for this lane had Jobvite at `9,200` visible rows, `1,162` missing country/region rows, `1,093` weak/unknown remote rows, and `9,200` missing posting dates. Top missing-country boards included `sumitomo-electric`, `pathways`, `longos-internal`, `longos`, `ips-careers`, `ninjaone`, `rkmi`, `salsa`, `von`, and `parts-town`.
- Jobvite list HTML does not expose posting dates, so date recovery still depends on bounded detail JSON-LD. The fetcher now prioritizes ambiguous/countryless concrete locations inside the existing detail budget, and the parser maps only Jobvite-source deterministic location hints from list/detail location fields.
- No tenant/title/body/company-name inference was added. Generic remote-only labels, multi-location counts, blank rows, and unresolved labels stay countryless unless detail JSON-LD provides structured evidence.
- Live read-only proof with detail fetch disabled showed source-local geo improvement without extra requests: `sumitomo-electric` missing geo `108 -> 30`, `longos` `30 -> 1`, `longos-internal` `32 -> 1`, `salsa` `28 -> 1`, and `ovt` `19 -> 5`. With a bounded `75` detail budget, current `sumitomo-electric` missing geo was `6`, while `salsa` and `ovt` parsed with `0` missing geo/date on current live rows.
- Verification covered Jobvite syntax checks, generic HTML/public source-module tests, fixture coverage for JSON-LD region-country hints and list-location country hints, and live read-only parser probes. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## CareerPlug Source-Local Dashed Location Evidence - June 1, 2026

- Fresh read-only production baseline for this lane had CareerPlug at `8,153` visible rows, `169` missing country/region rows, `0` missing-all-geo rows, `170` weak/unknown remote rows, and `3,328` missing posting dates. Top affected boards included `hcaoa-careers`, `goldscareers`, `thrifty-white-pharmacy`, `orangetheory-fitness-affiliates`, `culligan-careers`, `grand-canyon-resort-corp`, and `ram-jack-careers`.
- CareerPlug list HTML exposes deterministic `.job-location` labels. The parser now handles source-local dashed variants such as `City-ST`, `City-ST-ZIP Hybrid - US`, `PR-City-ZIP`, `City-ON-postal`, `AB-City-postal`, and `OK-City-ZIP Hybrid-US`, emitting city/state/country plus remote evidence from the same labeled field.
- Follow-up architecture cleanup keeps CareerPlug parser ownership out of `server/ingestion/sources/common.js`; `audit:architecture-boundary` now fails if CareerPlug parser imports or parser specs drift back into common.
- No tenant, title, body, company-name, or board-name inference was added. Labels without enough source-local country evidence, such as `Grand Canyon West (GCW)`, remain countryless/unknown remote.
- Live read-only proof with `maxCareerplugDetailFetches: 0`: the top 10 sampled boards parsed/accepted `276/276` rows. Nine boards had `0` missing country/region and `0` weak remote; the only remaining gap was `grand-canyon-resort-corp` with `20` rows carrying local site labels but no country/work-mode evidence.
- Verification covered CareerPlug syntax checks, expanded CareerPlug raw/expected fixtures, generic HTML/public source-module tests with evidence assertions, and live read-only parser probes. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## BrassRing Bounded Pagination Preservation - June 1, 2026

- Fresh read-only production baseline had BrassRing at `488` visible rows, `471` missing country/region rows, `0` missing-all-geo rows, `439` weak/unknown remote rows, and `0` missing posting dates. Public rows were concentrated on the MSCCN BrassRing board.
- The BrassRing public API returns only the first `50` jobs from `MatchedJobs`, while the same response exposes `JobsCount` and the UI retrieves additional pages through `ProcessSortAndShowMoreJobs`. The source module now performs bounded same-session pagination with source-local request metadata, defaulting to `12` pages (`600` raw rows) and capped by `OPENJOBSLOTS_BRASSRING_MAX_PAGES_PER_COMPANY` / `maxBrassringPages`.
- This checkpoint intentionally does not reverse-geocode source coordinates or infer country/remote from title, tenant, body, or board text. Existing coordinate-only rows remain missing country/region and weak remote until BrassRing exposes deterministic city/state/country or work-mode evidence.
- Live read-only proof on `partnerid=16030&siteid=6090`: source API reported `JobsCount=1,679`; the default bounded fetch used `12` pages and parsed/accepted `548` current rows in the latest probe, preserving more than the current public `488` BrassRing rows instead of the previous single-page `50` ceiling.
- Verification covered BrassRing syntax checks, enterprise source-module pagination fixtures, and live read-only parser probes. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Fountain Structured Address And Pagination - June 1, 2026

- Fresh read-only production baseline had Fountain at `424` visible rows, `153` missing country/region rows, `148` weak/unknown remote rows, and `424` missing posting dates.
- Fountain board JSON exposes source-backed `openings[].location_address` and `openings[].location_state_code`; `location_name` can be a brand/site label that should not be treated as geo by itself. The parser now derives compact city/state/country from the structured address field and leaves address-less remote/internal labels countryless.
- Fountain fetch now follows bounded JSON pagination from `pagination.next_page`, defaulting to `8` pages and capped by `OPENJOBSLOTS_FOUNTAIN_MAX_PAGES_PER_COMPANY` / `maxFountainPages`, avoiding the previous first-page-only `25` row ceiling for larger boards.
- Live read-only proof across `marsden`, `wedriveu`, `fetch-package-delivery`, `clear`, `nursedash`, and `assist-services`: bounded pagination fetched `542` current rows. Legacy local behavior would have had `272` missing country/region rows and `266` weak remote rows; the new parser reduced those to `11` and `3`, with `519` rows carrying `openings[].location_address` country evidence.
- No URL-path, title, tenant, body, or board-name inference was added. Posting dates remain null when Fountain omits them. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## HireBridge Detail JSON-LD Geo Evidence - June 1, 2026

- Fresh read-only production baseline had HireBridge at `115` visible rows, `111` missing country/region rows, `115` weak/unknown remote rows, and `0` missing posting dates.
- HireBridge detail pages expose `JobPosting` JSON-LD with `jobLocation.address`; list `.department` often contains job categories (`Production`, `Cook`, `QA`) and should not be used as geo unless it is explicitly geo/remote-shaped.
- The parser now derives city/state/country from detail JSON-LD address evidence and preserves posting dates from the same detail evidence path. It does not use URL-path, title, tenant, or body inference for geo/remote.
- Live read-only proof across `Kayem Foods` (`cid=7718`) and `J. Alexander's Restaurants` (`cid=8362`): detail fetch parsed `60` current rows. Legacy local behavior would have had `59` missing country/region rows and `60` weak remote rows; the new parser reduced both to `0`, with rows carrying `script[type="application/ld+json"].jobLocation.address` country evidence and no row-count drop.
- No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Teamtailor Detail JSON-LD Country Evidence - June 1, 2026

- Teamtailor production baseline for this lane was `8,128` visible rows, `403` missing country/region rows, `305` weak/unknown remote rows, and `372` missing posting dates.
- The Teamtailor source module now performs bounded detail fetches only for RSS rows whose location is blank, then extracts Schema.org `JobPosting` JSON-LD country/date/work-mode evidence from `jobLocation.address`, `applicantLocationRequirements.name`, `jobLocationType`, `datePosted`, and `employmentType`.
- No tenant/title/body inference was added. Rows without structured detail country remain blank; brand-only HTML labels still stay quarantined. `Latvija` is now a shared Latvia alias for observed source text.
- Live read-only proof: `b3consultingpoland` missing geo improved `18 -> 3` with `15` JSON-LD country recoveries; `letuelezioni` improved `7 -> 5`; `humansource` improved `1 -> 0`; `interfacefinancial`, `gmlhr`, and `hillgroupuk` stayed at `0` local missing geo/date under the current parser.
- Verification covered syntax checks, parser fixture tests, focused Teamtailor source-module tests, and live parser probes. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## TalentLyft Localized Country And Detail Date Evidence - June 1, 2026

- TalentLyft production baseline for this lane was `1,576` visible rows, `754` missing country/region rows, `32` weak/unknown remote rows, and `1,576` missing posting dates.
- Shared normalization now covers observed TalentLyft source country names such as `Hrvatska`, `Austrija`, `Srbija`, `Slovensko`, `Bosna i Hercegovina`, `Slovenija`, `Crna Gora`, `Sjeverna Makedonija`, `Nizozemska`, and `Njemacka`. Long comma-delimited locations no longer treat a middle `Za` token as country code `ZA`, so Croatian multi-city rows do not become South Africa.
- TalentLyft now performs bounded detail fetches (`OPENJOBSLOTS_TALENTLYFT_DETAIL_FETCH_LIMIT_PER_COMPANY`, default `25`, cap `75`) and enriches future rows from Schema.org `JobPosting` JSON-LD fields for structured address, `datePosted`, `employmentType`, and `jobLocationType`. Rows without structured source evidence stay blank; no tenant/title/body inference was added.
- Live read-only proof with the default 25-detail budget: `studenac` parsed/accepted `107` rows with missing country/region `106 -> 0` and `25` JSON-LD dates; `raditi` parsed/accepted `118` with missing `96 -> 18`; `victusgroup` parsed/accepted `36` with missing `36 -> 0`; `praca-decathlon` parsed/accepted `26` current rows with missing `27 -> 0`; `m-plus` parsed/accepted `38` current rows with missing `30 -> 0`; `pepco-croatia-doo` parsed/accepted `24` current rows with missing `27 -> 0` and all `24` dates filled. Live row counts may differ from the production snapshot as boards change.
- Verification covered syntax checks, parser fixture tests, focused TalentLyft source-module tests, and live read-only parser probes. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## ApplyToJob Detail Budget And Burkina Faso Evidence - June 1, 2026

- Fresh read-only production baseline for this lane had ApplyToJob at `51,361` visible rows, `6,694` missing country/region rows, `1,438` weak/unknown remote rows, and `36,308` missing posting dates. Top missing-country boards included `spadepartners`, `morphiuscorp`, `palmpaylimited`, `farinspections`, and several remote insurance-agency boards.
- ApplyToJob fetch now honors `maxApplyToJobDetailPages` / `detailFetchLimit` options before the env default, still capped at `50`, so read-only probes and canaries can spend bounded detail budget intentionally instead of being pinned to `OPENJOBSLOTS_APPLYTOJOB_DETAIL_FETCH_LIMIT_PER_COMPANY` / default `15`.
- The source-local ApplyToJob country-token hints now preserve explicit `Burkina Faso` and `Ouagadougou` list evidence. Shared country normalization also recognizes Burkina Faso and maps it to `EMEA`.
- Follow-up architecture cleanup keeps ApplyToJob parser ownership out of `server/ingestion/sources/common.js`; `audit:architecture-boundary` now fails if ApplyToJob parser imports or parser specs drift back into common.
- Live read-only proof with `maxApplyToJobDetailPages: 25`: `palmpaylimited` parsed `380` rows with accepted missing country/region `250 -> 0`, `379` labeled-country rows, and `25` JSON-LD dates; `morphiuscorp` parsed/accepted `598` rows with `25` detail fetches, `14` JSON-LD dates, and remaining missing country rows primarily explicit-remote rows accepted by public gate.
- Verification covered syntax checks, parser fixture tests, focused HTML public source-module tests, and live read-only parser probes. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## BambooHR Source-Local Admin Geo Evidence - June 1, 2026

- Fresh read-only production baseline for this lane had BambooHR at `19,038` visible rows, `3,060` missing country/region rows, `483` weak/unknown remote rows, and `19,038` missing posting dates. Top missing-country boards included `lanesgroup`, `ahkgroup`, `ri`, `atlashotels`, `emedgroup`, and `htmniseko`.
- Live BambooHR public API payloads expose `result[].location.city/state`, `result[].atsLocation`, and `result[].locationType`, but the sampled top boards did not expose posting date fields. The parser now treats `N/A` and `.` location parts as blank and adds source-local admin/city hints observed in BambooHR payloads, including UK counties/admin areas, Malaysia state labels, South Jakarta, Makati/Legaspi, Juba, Idleb/Hasaka, and related country aliases for Sudan, South Sudan, and Syria.
- No tenant, title, body, or board-name inference was added. Remaining city-only ambiguous rows such as Lanes-only `Sheffield`/`Rochdale`/`Warrington`, AHK `Lima`, and RI `Gaza` stayed blank.
- Live read-only proof: `lanesgroup` parsed `268` rows with accepted missing country/region `221 -> 17`; `ahkgroup` parsed `71` with missing `58 -> 1`; `ri` parsed `55` with missing `54 -> 2`; `htmniseko` parsed `37` with missing `37 -> 0`. All sampled rows still lacked posting dates because the source payload had no date fields.
- Verification covered syntax checks, parser fixture tests, focused BambooHR direct source-module tests, and live read-only parser probes. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Loxo Source-Local Region Code Evidence - June 1, 2026

- Loxo production baseline for this lane was `3,782` visible rows, `486` missing country/region rows, `315` weak/unknown remote rows, and `412` missing posting dates.
- Loxo list HTML exposes source-local location suffixes in `div.job-location`. The parser now maps observed UK `ENG`/`WLS`, Belgian `BRU`/`WLG`/`WHT`/`VAN`/`VBR`/`VLI`/`VOV`/`WBR`, Netherlands `ZE`, and observed French city hints inside the Loxo source module only. This avoids adding risky global interpretations for short tokens such as `VAN` or `ZE`.
- Blank locations and countryless remote rows stay unchanged, and no detail-page/body inference was added. The new rows carry source evidence via `loxo_list_region_country_code` or `loxo_list_city_country_hint`.
- Follow-up architecture cleanup keeps Loxo parser ownership out of `server/ingestion/sources/common.js`, adds Loxo to the shared HTML/public source-module fixture gate, and makes `audit:architecture-boundary` fail if the Loxo parser drifts back into common.
- Live read-only proof: `Vertical-Recruitment` accepted missing country/region improved `145 -> 5` with `443` source-list country rows; `Sparagus` improved `141 -> 5` with `134` source-list country rows; `THOMAS-Professional` improved `65 -> 2` with `64` source-list country rows.
- Verification covered syntax checks, focused Loxo source-module tests, and live read-only parser probes. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Greenhouse Office Geo And Work-Mode Evidence - June 1, 2026

- Fresh read-only production checks kept `/root/OpenJobSlots` at `6660eab`; public health reported `331,524` visible job slots and Meili/Postgres document counts remained aligned with the known `22` document remote-facet drift unresolved.
- Greenhouse production quality baseline from the broad source sample: `5,373` visible rows, `289` missing-any-geo rows, and `630` weak/unknown remote rows.
- Greenhouse now uses source office country evidence when location labels carry remote/hybrid city text, rewrites safe `Country - City` labels to `City, Country`, and limits office-level `Remote` evidence to country-only or generic multi-location rows so city rows do not become false remote jobs.
- Fixture coverage includes Motive-style Pakistan remote/hybrid rows, Natera-style country-only US remote-office evidence, a South Jersey office-country row with unknown remote, a `Washington D.C` false-positive guard, and a `Pakistan - Islamabad` city rewrite.
- Live read-only proof: Motive parsed `41` rows with `41` accepted and `0` missing geo; Natera parsed `198` rows with `198` accepted and `0` missing geo. Concrete city rows such as `San Francisco, CA` and `Washington D.C` no longer inherit office-level remote evidence.
- Verification covered Greenhouse syntax checks, focused direct source-module tests, live read-only parser proof, `npm.cmd run test:parsers`, `npm.cmd run test:backend`, `npm.cmd run test:api`, `npm.cmd run audit:architecture-boundary -- --json`, `npm.cmd run ats:registry-index -- --json --no-write`, and `git diff --check`. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, or worker-budget change was run.

## Jobvite Detail JSON-LD Evidence - June 1, 2026

- Jobvite production quality baseline for this local lane: `9,200` visible rows, `1,162` missing country/region rows, `1,093` weak/unknown remote rows, and `9,200` missing posting dates.
- Jobvite now fetches bounded per-job detail pages after the list HTML and extracts JSON-LD `datePosted`, `employmentType`, and structured `jobLocation.address` city/country/region evidence. The merge keeps list Remote/Hybrid prefixes when detail JSON-LD only supplies geo/date.
- Correctness guards: Australian state labels no longer normalize as United Kingdom when detail country evidence says Australia, and numeric labels such as `2 Locations` are quarantined unless detail JSON-LD supplies structured geo.
- Fixture/test coverage includes Turkey, remote country-only, Australia/New South Wales, and multi-location US detail examples, plus a numeric multi-location quarantine assertion.
- Live read-only parser proof with a 25-detail budget per company: NinjaOne `86/86` accepted with `25` dates and weak remote `1 -> 0`; Pathways `201` parsed with `170` accepted, `25` dates, missing country/region `68 -> 43`, weak remote `56 -> 31`; Sumitomo Electric `250` parsed with `241` accepted and `21` dates; IPS `153` parsed with `149` accepted, `25` dates, missing country/region `29 -> 4`, weak remote `32 -> 7`.
- This checkpoint ran no production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change.

## Ashby Structured Postal Address Checkpoint - June 1, 2026

- Fresh read-only production checks kept `/root/OpenJobSlots` at `6660eab`; public health reported `331,515` visible job slots. Meili/Postgres document counts were still aligned at `331,509` each, with the known `22` document remote-facet drift still unresolved. No Meili repair or replace reindex was run.
- Ashby production quality baseline: `27,962` visible rows, `657` missing country/region rows, `200` weak/unknown remote rows, and `0` missing posting dates or source ids.
- Ashby now treats `jobs[].address.postalAddress` as primary source geo evidence. When that structured postal address is present and the source does not expose an explicit remote/hybrid signal, the parser emits source-backed `onsite` evidence via `ashby_structured_physical_location`.
- Fixture coverage includes a production-shaped Malmo postal-address row and a direct source-module test for city/country evidence paths plus explicit remote evidence. Live read-only parser proof for `roadsurfer.com` parsed `289` rows with `289` accepted, `0` missing country/region, `0` weak/unknown remote, and `242` structured-address onsite rows. A top-25 affected Ashby board sample parsed `1,066` rows with `1,066` accepted and `164` structured-address onsite rows.
- Remaining Ashby gaps are mostly countryless remote-region scopes such as EU/LATAM/Worldwide; do not turn those into fake countries without stronger source evidence. Verification covered Ashby syntax checks, direct source-module tests, `npm.cmd run test:parsers`, and `npm.cmd run audit:architecture-boundary`. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, or worker-budget change was run.

## Paylocity Country And Remote Evidence - June 1, 2026

- Paylocity production quality baseline: `6,968` visible rows, `248` missing country/region rows, `92` weak/unknown remote rows, and `0` missing posting dates or source ids.
- Live `window.pageData` samples showed deterministic source evidence in `Jobs[].JobLocation.Country`, `Jobs[].IsRemote`, and source location labels such as `Remote Worker - N/A`, while current normalization dropped the country when city/state display labels existed.
- Paylocity now preserves source country/city/state and emits source-backed remote evidence. `IsRemote=true` maps to `remote`; `IsRemote=false` maps to `onsite` unless source location/title text explicitly says remote or hybrid.
- Fixture coverage includes remote-USA and onsite-USA rows plus an enterprise source-module test for country evidence and explicit remote evidence. Live read-only proof across six sampled production boards parsed `182` rows with `182` accepted, `0` missing country/region, `0` weak/unknown remote, `182` source-country rows, and `182` explicit remote-mode rows.
- Verification covered Paylocity syntax checks, enterprise source-module tests, `npm.cmd run test:parsers`, and `npm.cmd run audit:architecture-boundary`. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, or worker-budget change was run.

## Oracle Structured Work Location - June 1, 2026

- Oracle production quality baseline: `3,679` visible rows, `147` missing country/region rows, `368` weak/unknown remote rows, and `0` missing posting dates or source ids.
- Oracle API samples split into country-only `PrimaryLocation` rows and structured physical `requisitionList[].workLocation[]` rows. The parser now infers `onsite` only for structured physical work locations, not for country-only records without source work-mode evidence.
- Oracle now preserves work-location city/country evidence, uses `WorkplaceType` when present, and maps observed country hints such as Afghanistan, Algeria, Djibouti, and Kazakhstan through the shared country/region normalizer.
- Fixture coverage includes a structured Jordan work-location row and a Djibouti primary-location row. Live read-only proof across `EEHO`, `Airtel Africa`, `Al Bardi Paper Mill`, and `United Nations Development Programme` parsed `84` rows with `84` accepted, `33` structured-work-location onsite rows, and `45` primary-location country-hint rows.
- Remaining Oracle weak remote rows are mostly country-only records without explicit source work-mode evidence. Verification covered Oracle/posting syntax checks, enterprise source-module tests, parser fixture tests, `npm.cmd run test:parsers`, and `npm.cmd run audit:architecture-boundary`. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, or worker-budget change was run.

## iSolvedHire ISO3 And Workplace Evidence - June 1, 2026

- Fresh read-only production checks kept `/root/OpenJobSlots` at `6660eab`, all four services running, public health at `331,524` visible job slots, and `search:reindex:check -- --json --sample-limit=25` at Postgres/Meili count parity (`331,518`/`331,518`) with the known `22` document remote-facet drift. No Meili repair or replace reindex was run.
- iSolvedHire production quality baseline: `7,008` visible rows, `32` missing country/region rows, `87` weak/unknown remote rows, and `0` missing posting dates or source ids.
- Live API samples showed source-backed `iso3`, `city`, `stateName`, `abbreviation`, `streetAddress`, and `workplaceType` fields while the parser only emitted `jobLocation`. This left rows such as `00000, US`, Spanish `EE. UU.` labels, `USVI`, and tab-delimited street addresses with missing geo or weak remote.
- iSolvedHire now carries source `iso3` country evidence, structured city/state evidence, and exact source `workplaceType` labels. `Fully remote` maps to `remote`, `Work from home flexibility` maps to `hybrid`, and `Onsite` maps to `onsite`; placeholder country-only locations such as `00000, US` become source-backed `Remote, USA` or country-only geo without fake city values.
- Fixture coverage now includes fully remote `00000, US`, Spanish `EE. UU.` onsite, and `VIR` / `USVI` rows, plus direct source-module assertions for country/remote evidence paths.
- Live read-only proof after the change across ten sampled production boards parsed `598` rows with `598` public-gate accepted, `0` missing country/region rows, `8` weak/unknown remote rows where the source omitted `workplaceType`, and `0` no-geo/weak-remote rows.
- Verification covered iSolvedHire syntax checks, focused direct source-module tests, live read-only parser proof, `npm.cmd run test:parsers`, `npm.cmd run test:backend`, and `npm.cmd run test:api`. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, or worker-budget change was run.

## UltiPro Source Geo and Payload Drift Checkpoint - June 1, 2026

- Fresh read-only production checks kept `/root/OpenJobSlots` at `6660eab` with app/worker/Postgres/Meili running. Public health reported `331,490` visible job slots. `search:reindex:check -- --json --sample-limit=25` still had Postgres/Meili count parity (`331,484`/`331,484`) but remained `ok=false` because remote facets drift by `22` onsite vs unknown documents. No Meili repair or replace reindex was run.
- Source freshness selected UltiPro as a focused source-local lane: `43` unresolved parser-attention events, `388` new missing-any-geo rows, and `22` new weak/unknown remote rows in the 24h window. Production visible UltiPro rows were `35,050`, with `288` missing-any-geo rows, `73` weak/unknown remote rows, and `0` missing posting dates or source ids.
- UltiPro parsing now preserves unique `Locations[].Address.City` and `Locations[].Address.Country` as explicit source evidence. Remote/hybrid labels such as `Remote` are country-qualified when the same source location object carries a country, preventing `Remote` rows from losing country evidence and preventing `La Paz, Bolivia` from being misread as Louisiana/United States by generic fallback normalization.
- UltiPro now marks its top-level `locations` facet as payload-shape drift noise while keeping the real `opportunities` job list as required core. The shared payload-drift guard now treats ignored stems as prefixes, so source-local `ignored_stems: ["locations"]` covers populated and empty facet variants without hiding missing `opportunities` payloads.
- Follow-up architecture cleanup keeps UltiPro parser ownership out of `server/ingestion/sources/common.js`; `audit:architecture-boundary` now fails if UltiPro parser imports or parser specs drift back into common.
- Live read-only proof: US Fertility parsed `144` rows, with sampled remote rows normalizing to `Remote, United States`, `country=United States`, `remote_type=remote`, and public gate `accepted`. TechnoServe parsed `90` rows, with `Chief of Party, USDA Food for Progress Program` normalizing to `La Paz, Bolivia`, `city=La Paz`, `country=Bolivia`, `region=LATAM`, `remote_type=onsite`, and public gate `accepted`.
- Verification covered focused UltiPro tests, payload-drift tests, `npm.cmd run test:backend`, `npm.cmd run test:api`, `npm.cmd run audit:architecture-boundary -- --json`, `npm.cmd run ats:registry-index -- --json --no-write`, and `git diff --check`. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, or worker-budget change was run.

## ApplyToJob Australia Location Token Checkpoint - June 1, 2026

- Fresh production sampling showed ApplyToJob remains a large source-quality lane: `51,330` visible rows, `6,687` missing country/region rows, `1,438` weak/unknown remote rows, and `36,298` rows without posting dates. No production write was run while sampling.
- A live local parser probe for `protechtgroup.applytojob.com` exposed a correctness bug, not just a missing-field gap: source labels such as `Sydney, New South Wales` and `Sydney, New South Wales, Australia` were normalizing to `country=United Kingdom` because the generic fallback matched `Wales` before `Australia`.
- ApplyToJob now applies source-local location token hints before shared normalization for explicit country tokens and Australian state/province tokens such as `New South Wales`, `NSW`, `Queensland`, and `VIC`. State/province hints require a city token, so a standalone ambiguous token is not enough to invent an Australian country.
- Live read-only proof after the change: Protecht parsed `11` rows; sampled `Sydney, New South Wales` and `Sydney, New South Wales, Australia` rows normalize to `country=Australia`, `region=APAC`, public gate `accepted`. Atlanta controls stayed `United States`; source-countryless `Remote` stayed countryless instead of inventing a country.
- Verification covered ApplyToJob focused tests, `npm.cmd run test:backend`, `npm.cmd run test:api`, `npm.cmd run audit:architecture-boundary -- --json`, `npm.cmd run ats:registry-index -- --json --no-write`, and `git diff --check`. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, or worker-budget change was run.

## ApplyToJob Nigeria Token And Detail Merge - June 1, 2026

- Fresh read-only ranking kept ApplyToJob as the biggest remaining source-quality lane: `51,350` visible rows, `6,687` missing country/region rows, `1,438` weak/unknown remote rows, and `36,301` missing posting dates.
- Existing ApplyToJob detail fetch can recover `datePosted` for sampled rows, but broad date recovery requires inventory/net-new/batch planning and explicit production approval. The parser-only fix here is the deterministic source-token gap.
- ApplyToJob now recognizes `Nigeria` in shared country normalization and maps `Lagos` / `Lagos State` source tokens to Nigeria only when a city token is present. This fixes sampled `palmpaylimited.applytojob.com` rows such as `Ikeja, Lagos`, `Lagos, Lagos State`, and `Lekki, Lagos`.
- Detail merge now keeps stronger list geo when detail JSON-LD supplies date/city/state but omits `addressCountry`, so date enrichment does not increase missing country/region or weak remote.
- Live read-only proof: Palmpay parsed `379` rows with `379` accepted; detail budget `15` filled `15` dates; missing country/region stayed `19`, weak remote stayed `22`, and no no-geo/weak-remote rows were accepted. BGC/Taguig stayed `Philippines` while Lagos/Ikeja/Lekki normalized to `Nigeria`.
- No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## BambooHR Admin Region Token Evidence - June 1, 2026

- Fresh read-only production baseline: BambooHR had `19,032` visible rows, `3,060` missing country/region rows, `483` weak/unknown remote rows, and `19,032` missing posting dates. Posting cache had `19,027` valid rows and `144` quarantined rows (`129` `no_geo_no_remote`, `13` `ambiguous_location`, `2` mixed).
- The parser now maps source-local administrative region tokens to countries only when BambooHR provides a city plus state/province/admin-region evidence. Covered token families include UK counties, South African provinces, Australian states, Japanese prefectures, Nigerian `Lagos`, Indonesian provinces, and selected deterministic LATAM/APAC/EMEA administrative regions. Single-token locations such as `Cheshire` or `Rochdale` still do not infer a country.
- Raw/expected BambooHR fixtures and direct module tests now cover `West Yorkshire -> United Kingdom`, `Western Cape -> South Africa`, `Hokkaido -> Japan`, and `Lagos -> Nigeria`, all with `bamboohr_admin_region_location` evidence.
- Live read-only proof on the top 30 BambooHR missing-country/region tenants: the production top-list baseline had `987` missing-country/region rows; the local parser accepted `1,465` live rows, reduced missing country/region to `457`, recovered `511` rows through admin-region evidence, and kept weak remote at `0`. Example tenant deltas: `lanesgroup` `221 -> 37`, `htmniseko` `37 -> 0`, `atlashotels` `42 -> 3`, `emedgroup` `41 -> 5`.
- BambooHR dates remain source-omitted in sampled public list JSON, so this checkpoint intentionally does not invent posting dates. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.
- Follow-up architecture cleanup keeps BambooHR parser ownership out of `server/ingestion/sources/common.js`; `audit:architecture-boundary` now fails if BambooHR parser imports or parser specs drift back into common.

## Zoho Explicit Country Alias Evidence - June 1, 2026

- Fresh read-only production baseline: Zoho had `14,561` visible rows, `1,860` missing country/region rows, `235` weak/unknown remote rows, and `4,991` missing posting dates. Posting cache had `14,561` valid rows and `1,918` quarantined rows.
- Live Zoho hidden JSON showed explicit `Country` payload values not covered by shared country normalization, including `Ghana`, `Costa Rica`, `Sri Lanka`, `Suriname`, `Papua New Guinea`, `Uganda`, `Zimbabwe`, `Cote D'Ivoire (Ivory Coast)`, `Botswana`, `Mauritania`, `Brunei Darussalam`, `Macao`, and `Saint Kitts and Nevis`.
- Shared normalization now covers those real country aliases and region buckets; Zoho parser behavior stays source-local and continues to use explicit hidden payload fields rather than title/body inference.
- Follow-up architecture cleanup keeps Zoho parser ownership out of `server/ingestion/sources/common.js`; `audit:architecture-boundary` now fails if Zoho parser imports or parser specs drift back into common.
- Tests now cover the shared aliases and a Zoho hidden-payload fixture for `Ghana -> EMEA`, `Costa Rica -> LATAM`, and `Sri Lanka -> APAC`.
- Live read-only proof on the top 30 Zoho missing-country/region tenants: the production top-list baseline had `1,236` missing-country/region rows; the local parser parsed `1,634` current live rows, accepted `1,577`, reduced missing country/region to `283`, and preserved `978` source posting dates. Example tenant deltas: `peopleandpartnersgroup` `93 -> 0`, `ubuntuimpact` `89 -> 0`, `dunnandbraxton` `61 -> 0`, `royalinstitute` `66 -> 0`, `pacificmanpower` `50 -> 0`, `gigmile` `72 -> 1`.
- Remaining top-list gaps are mostly explicit remote/no-location rows or tenants whose source payload does not expose a country. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## HRMDirect Puerto Rico Numeric Region Evidence - June 1, 2026

- Fresh read-only production baseline selected HRMDirect after Zoho: `39,871` visible rows, `1,338` missing country/region rows, `1,260` weak/unknown remote rows, and `22,823` missing posting dates.
- Top missing-country/region tenant `veg-group.hrmdirect.com` had production `261` visible rows and `247` missing country/region rows. Its HRMDirect list exposes `td.cities` plus a numeric three-digit `td.state` value for Puerto Rico city evidence such as `Humacao, 069`, `Gurabo, 063`, `Punta Santiago, 069`, `Carolina, 031/127`, and `Juncos, 077`.
- HRMDirect parser now maps only source-local `td.cities + td.state` rows where the city is in the observed Puerto Rico city set and the state cell is a three-digit numeric region. This does not use tenant-level, title, or body inference.
- Live read-only proof on `veg-group`: local parser parsed and accepted `251` current rows, reduced missing country/region from `236` local sample rows to `0`, and recovered `236` rows as `Puerto Rico` / `North America` with rule `hrmdirect_list_puerto_rico_numeric_region`. Remote type remains `unknown` where HRMDirect has no explicit remote/work-mode field.
- Other sampled HRMDirect tenants such as `carespot`, `ccsnh`, `ne-arc`, and `thebreakers` still require source-backed location evidence; city-only, campus-name, title-parenthetical, or employment-type-like values were not converted into country evidence. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## Breezy Explicit Country Alias Evidence - June 1, 2026

- Fresh read-only production baseline for Breezy had `21,037` visible rows, `978` missing country/region rows, `1,851` weak/unknown remote rows, and `11,244` missing posting dates.
- Live Breezy JSON payloads exposed explicit `location.country` values missing from shared normalization: `Bermuda`, `Virgin Islands, British`, `Togo`, `Gabon`, localized `Cameroun`, and `中国`.
- Shared normalization now covers those country aliases and region buckets. Breezy still uses source-provided JSON API fields; `Worldwide` remote rows remain countryless and no tenant/title/body inference was added.
- Follow-up architecture cleanup keeps Breezy parser ownership out of `server/ingestion/sources/common.js`; `audit:architecture-boundary` now fails if Breezy parser imports or parser specs drift back into common.
- Live read-only proof: `hamilton-recruitment` moved from production top-list `46` missing country/region rows to `0/58` local current missing; `gozem` moved from `15` to `0/13`; `wongnai-media-co-ltd` moved from `8` to `0/80`, including `Bermuda -> North America`, `Togo/Gabon/Cameroon -> EMEA`, and `China -> APAC`.
- No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, cleanup, or worker-budget change was run.

## ApplicantPro ISO3 And Workplace Evidence - June 1, 2026

- Fresh read-only production checks kept production at `6660eab`; public health reported `331,515` visible job slots, and `search:reindex:check -- --json --sample-limit=25` still had Postgres/Meili count parity (`331,509`/`331,509`) with the known `22` document remote-facet drift.
- ApplicantPro production quality baseline: `19,722` visible rows, `76` missing country/region rows, and `189` weak/unknown remote rows. Samples showed live source rows where `iso3` and `workplaceType` were available but not fully carried into normalized country/region/remote fields.
- ApplicantPro now maps observed source `iso3` values such as `NGA`, `COD`, `CIV`, `SLE`, `MLI`, and `TGO` in the source module, clears country-only labels from `city`, and uses exact source `workplaceType` labels for work-mode normalization.
- Live read-only parser proof for `corus.applicantpro.com` parsed `48` rows with `48` accepted, `0` missing country/region, and `6` remaining weak/unknown remote rows where the source did not expose workplace evidence. Nigeria, DRC, Côte d'Ivoire, Sierra Leone, Mali, and Togo sample rows now normalize with source-backed country/region.
- Verification covered ApplicantPro syntax checks, direct parser fixture tests, HTML/public source module tests, and live read-only parser proof. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, or worker-budget change was run.

## JOIN Structured Country Evidence - June 1, 2026

- Production sampling showed JOIN as a small, clean source-quality lane: `2,273` visible rows, `21` missing country/region rows, and `2` weak/unknown remote rows. The affected rows had source-backed `city.cityName` and `city.countryName` values in JOIN Next.js data.
- JOIN now maps observed source country names such as Bangladesh, Kosovo, Ghana, Costa Rica, Albania, Liechtenstein, Uganda, Venezuela, Reunion, and Bosnia and Herzegovina inside the source module, and preserves city only from the structured `cityName` field.
- Fixture coverage now includes Bangladesh and Kosovo rows in the JOIN source fixture and expected-normalized fixture. Live read-only parser proof for `theblondhrcom`, `sawoo`, `prosupportservicesghcom`, and `maximonivel` parsed `12` rows total with `12` accepted, `0` missing country/region, and `0` weak/unknown remote rows.
- Verification covered JOIN syntax checks, HTML/public source module tests, direct source module tests, and live read-only parser proof. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, or worker-budget change was run.

## Zoho Read-Only Recovery Wave - June 1, 2026

- Fresh production checks kept production at `6660eab` with all four runtime services running. Public health still reports `331,463` visible job slots. `search:reindex:check -- --json` still has Postgres/Meili count parity (`331,457`/`331,457`) but remains `ok=false` because remote facets drift by `6` onsite vs unknown.
- Zoho is the current first source target from live evidence: `463` source-quality failures in 24h, `686` new missing-any-geo rows, `64` new weak/unknown remote rows, and `0` new public no-geo/no-remote rows.
- Zoho production quality baseline: `14,561` visible rows, `2,516` missing-any-geo (`17.28%`), `235` weak/unknown remote (`1.61%`), and `1` missing-all-geo plus weak/unknown remote row.
- Read-only reports:
  - Inventory: `/root/OpenJobSlots/reports/zoho-v2-readonly-inventory-small-20260531T221402Z.json`.
  - Net-new estimate: `/root/OpenJobSlots/reports/zoho-v2-readonly-estimate-small-20260531T221544Z.json`.
  - Batch plan: `/root/OpenJobSlots/reports/zoho-v2-readonly-plan-small-20260531T221901Z.json`.
- The scanned Zoho window covered `25/1,751` targets, parsed `70` rows, found `57` clean candidates, only `4` net-new clean public candidates, and `52` already-public duplicates. Candidate pool remains unproven and low-confidence; this is not a 5k apply candidate.
- The only guard-safe selected tenant in the small plan is `zenfreed.zohorecruit.com` with `4` clean net-new rows and predicted guard `pass`. Rows from tenants such as `gotocme` and `basecodetech` without deterministic geo or explicit remote evidence remain no-geo/no-remote quarantines.
- `server/ingestion/inventoryScanner.js` now enforces remaining `--max-fetches` before choosing a scan window and forwards `--source-timeout-ms` / `OPENJOBSLOTS_ATS_INVENTORY_SOURCE_TIMEOUT_MS` into each net-new estimate window. This supports safer future inventory/resume work for Zoho and other slow sources.
- No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, backup, or worker isolation was run in this read-only wave.

## Breezy Parser-Drift Guard - June 1, 2026

- Fresh read-only production checks kept production at `6660eab`, all four runtime services running, `331,463` visible job slots, and Meili/Postgres count parity with the known `6` document remote facet drift. Throughput remains `hold`.
- Breezy has `168` unresolved 24h parser validation events from payload-shape drift. Direct Postgres samples showed sparse one-target drift events such as `payload shape similarity 0.1607 below 0.55`.
- The Breezy source module now declares `/json` as optional payload-shape enrichment, while the generic guard handles shared source-config/detail-map metadata. Missing core HTML still records parser drift.
- No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, backup, or worker isolation was run.

## ADP And UltiPro Empty-List Drift Policy - June 1, 2026

- Fresh read-only production checks kept production at `6660eab`, all four runtime services running, `331,463` visible job slots, and the known Meili remote-facet drift of `6` onsite vs unknown documents. Throughput remains `hold`.
- Drift samples showed ADP `jobRequisitions[]:empty` and UltiPro `opportunities[]:empty` source payloads being compared with populated baselines. With zero source counts, these are empty-board outcomes, not parser shape regressions.
- The payload-drift guard now reads source-local `payloadShapePolicy.empty_job_list_stems`; ADP declares `jobRequisitions`, and UltiPro declares `opportunities`. Positive source counts still force parser drift, so real shape loss is not masked.
- Verification covered changed-file syntax checks, payload-drift tests, source registry contract tests, source contract tests, and enterprise source-module tests. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, backup, or worker isolation was run.

## TalentReef HiBob Oracle Empty-List Drift Policy - June 1, 2026

- Follow-up production drift evidence showed empty source result arrays for TalentReef `hits.hits`, HiBob `jobAdDetails`, and Oracle `items[].requisitionList`; these accounted for 20, 17, and 3 recent parser-validation events in the freshness snapshot.
- The payload-drift guard now skips internal `__source*` request counters when checking for positive job counts, but still treats real source count fields such as `hits.total`, `TotalJobsCount`, `totalCount`, and `totalNumber` as blockers to `empty_no_jobs`.
- TalentReef, HiBob, and Oracle now declare source-local `payloadShapePolicy.empty_job_list_stems` for their real job arrays. Positive source counts with empty arrays still record parser drift.
- Verification covered changed-file syntax checks, payload-drift tests, registry tests, enterprise source-module tests, and HTML/public source-module tests. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, backup, or worker isolation was run.

## Freshteam Title-Tag Parser Checkpoint - June 1, 2026

- Freshteam parser attention was concentrated on `dextragroup.freshteam.com/jobs`, with 32 recent `placeholder position_name` validation errors. The public source HTML uses `<h5 class="job-title">...`, while the parser only accepted `<div class="job-title">...`.
- Freshteam title extraction is now class-based across tag names, and the Freshteam raw fixture includes the observed `<h5 class="job-title">` variant.
- Live read-only parser proof for `https://dextragroup.freshteam.com/jobs` returned 32 rows and `placeholder_count=0`; no production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, backup, or worker isolation was run.

## BambooHR Location-Shape Drift Policy - June 1, 2026

- BambooHR residual drift was caused by supported sparse structured geo variants where values moved between `result[].location` and `result[].atsLocation`, while the alternate object contained null city/state/country fields.
- The payload-drift core now ignores internal `__source*` fetch/request metadata, and BambooHR declares source-local ignored stems for supported `location` / `atsLocation` geo subfields. The public gate still rejects or quarantines rows without useful geo or explicit remote/hybrid evidence.
- Verification covered payload-drift tests, source registry tests, and direct source-module tests. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, backup, or worker isolation was run.

## Teamtailor RSS/HTML Location Fallback - June 1, 2026

- Fresh read-only production evidence still has production at `6660eab`, all services healthy, `331,463` visible job slots, and the known Meili remote-facet drift of `6` onsite vs unknown documents. Throughput remains `hold`; Teamtailor contributed `176` recent source-quality `no_geo_no_remote` events.
- Teamtailor RSS sometimes returns empty `<tt:locations>` for a job while the public jobs HTML list has a location label for the same canonical URL. The source module now fetches the HTML jobs page only when RSS has empty or absent Teamtailor location blocks.
- Teamtailor parsing now supports modern `li.w-full` job cards, removes separator-only metadata spans, and merges RSS title/date/remote/source-id with HTML list location/department. City-only HTML locations are country-qualified only when the same RSS payload provides a matching source-backed city-country hint; otherwise the parser leaves country blank.
- Live read-only parser proof for `estatementgroup.teamtailor.com` recovered a production-quarantined row as `Stockholm, Sweden`, `remote_type=onsite`, `posting_date=2025-11-18`, and public gate `accepted`; a `folketsthlm.teamtailor.com` control probe kept brand-only `Folket` metadata quarantined instead of treating it as geo.
- Verification covered focused Teamtailor parser tests, full backend/parser tests, API tests, architecture-boundary audit, and whitespace check. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, backup, or worker isolation was run.

## HRMDirect RSS Payload-Shape Policy - June 1, 2026

- Fresh read-only worker backlog diagnostics for `hrmdirect`, `rippling`, and `zoho` selected HRMDirect as the next worker-success lane: `2,238` due targets, `2,056` failure pressure, latest-run success `2/4`, recent-run success `59.7%`, `411` recent errors, `4` parser-bug drift events, and `407` source-quality events.
- Live local parser probes showed the parser core already handles sampled HRMDirect boards: `hasco` parsed `1/1` accepted, `rustonpaving` parsed `20` rows with `19` accepted and `1` source-backed quarantine, `nepgroup` parsed `58` rows with `57` accepted and `1` quarantine, while `morningside` correctly kept `2` no-geo/no-remote rows quarantined.
- The remaining parser-bug class is payload-shape drift from optional RSS date enrichment, not missing HTML parser support. HRMDirect now declares `__rssUrl`, `__rssXml`, `__rssStatus`, and `__rssFailure` as optional payload-shape enrichment; shared detail maps were already ignored by the generic guard, and missing `html` core still records parser drift.
- Follow-up architecture cleanup keeps HRMDirect parser ownership out of `server/ingestion/sources/common.js`; `audit:architecture-boundary` now fails if HRMDirect parser imports or parser specs drift back into common.
- Verification covered changed-file syntax checks, payload-drift tests, source registry contract tests, source contract tests, HRMDirect/source HTML module tests, live read-only parser probes, full backend/API tests, architecture-boundary audit, recovery-readiness index no-write check, and `git diff --check`. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, backup, or worker isolation was run.

## Rippling Structured Location Evidence - June 1, 2026

- Fresh read-only production checks kept production at `6660eab`, public visible rows at `331,463`, and the known Meili remote-facet drift at `6` onsite vs unknown documents. Throughput remains `hold`; no parity repair or replace reindex was run.
- Rippling quality pressure was source-quality rather than parser-bug: the freshness snapshot showed `802` new missing-any-geo rows and `93` new weak/unknown remote rows in 24h. Production visible Rippling rows had `2,618/8,807` missing-any-geo rows, `277` weak/unknown remote rows, and no posting-date evidence from the sampled API payloads.
- Live raw Rippling API samples showed `locations[].name` can be a brand label such as `Zooby Neighborhood Superheros` or `Zapata Quantum`, while the same location object carries source-backed `city`, `state`, `country`, `countryCode`, and `workplaceType`. The parser now prefers structured geo over brand-like names and derives remote/hybrid/onsite from `locations[].workplaceType` when top-level work-mode fields are absent.
- A production-shaped `Remote (TX, US)` fixture now preserves source-backed `TX, United States` and remote evidence, avoiding the previous missing-country outcome for rows that shared country/state only through structured fields.
- Live read-only parser proof after the change: `zooby-neighborhood-superheroes` now parses sample rows as `San Antonio, Texas, United States`; `zapata-quantum` now parses remote rows as `United States` instead of a brand-as-location; `zededa` now parses `Remote (TX, US)` as `TX, United States`; all sampled rows remained public-gate `accepted` when source evidence was sufficient.
- Verification covered Rippling parser syntax, direct source-module fixture tests, and live read-only parser probes. This is a local future-row/data-quality fix only until deployed and source rows are refreshed; no production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, backup, or worker isolation was run.

## DayforceHCM Parser Certification - June 1, 2026

- DayforceHCM moved from explicit unsupported stub to a source-local, parser-fixture-backed, registry-disabled module under `server/ingestion/sources/dayforcehcm/`.
- Browser-observed Dayforce boards POST to `https://jobs.dayforcehcm.com/api/geo/{clientNamespace}/jobposting/search` with `clientNamespace`, `jobBoardCode`, `cultureCode`, `distanceUnit`, and `paginationStart`; the response carries `jobPostings`, `offset`, `count`, and `maxCount`.
- The parser now preserves `jobPostingId` as `source_job_id`, `jobReqId` as evidence, `postingStartTimestampUTC` as source date, `postingLocations[].isoCountryCode/stateCode/cityName` as geo evidence, and `hasVirtualLocation` as explicit remote evidence. Canonical URLs are built as `{boardUrl}/jobs/{jobPostingId}`.
- Direct non-browser fetches may still return 401/403/429, so Dayforce remains disabled by default and `collectWhenDisabled=false` until bounded live canary/direct-fetch evidence is explicitly approved.
- Regenerated registry/workbench docs now show `60/60` configured ATS ready for read-only recovery and `dayforcehcm` as `registry-backed-disabled`, not unsupported. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, backup, or worker isolation was run.

## ATS Recovery Readiness Index - June 1, 2026

- Fresh read-only production checks kept production at `6660eab`, all services running, `331,463` visible job slots, and the known Meili remote-facet drift of `6` onsite vs unknown. Throughput remains `hold`; source freshness still reports `384` unresolved parser-attention events, `389` parser-bug failures, and `1,217` source-quality failures.
- Source contracts now have a separate recovery-readiness layer: recovery-capable modules must expose public gate validation, rate-limit policy, source-quality thresholds, and fixture paths in addition to the base discover/fetch/parse/normalize/validate contract.
- Unsupported source modules still preserve `unsupported` status in the registry instead of being overwritten by disabled registry metadata. `dayforcehcm` is no longer in that class after source-local parser certification, but remains registry-disabled and excluded from default sync.
- `npm.cmd run ats:registry-index` now generates registry status plus recovery readiness for every configured ATS and future candidate. It also records the operational commands for source tests, workbench review, dry-run, inventory scan, net-new estimate, batch plan, preflight, recovery guard, release check, and Meili/Postgres parity check.
- Current generated readiness after Dayforce parser certification: `60/60` configured ATS are ready for read-only recovery. This is not production recovery success; `dayforcehcm` remains disabled until bounded live canary/direct-fetch evidence and source-quality proof are approved.
- No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, backup, or worker-budget change was run.

## ATS Fixture Path Readiness Closure - June 1, 2026

- The remaining fixture-path blockers were closed without enabling any source or running production writes. `saphrcloud` and `talexio` now expose existing fixture paths through their recovery contracts.
- `peopleforce`, `policeapp`, and `sagehr` now have source-local company/list/expected-normalized/invalid-shapes fixtures from existing parser characterization evidence. Their valid fixtures pass the base normalized source contract but remain public-gate quarantined: all three lack `source_job_id`; `policeapp` and `sagehr` also lack deterministic geo/remote evidence.
- The HTML/public fixture tests now keep these quarantined fixtures separate from the accepted-public source loop, preventing readiness from being mistaken for public-row acceptance.
- Regenerated `docs/reference/ats-registry-targets/` now reports recovery readiness counts `{"research-only":30,"ready-for-read-only-recovery":60}` and `read_only_recovery_ready_count=60`. No configured ATS is blocked at the read-only recovery-contract layer.
- Verification covered source syntax checks, HTML/public, direct, and enterprise source-module tests, source contract tests, registry-index tests, `npm.cmd run ats:registry-index -- --json --no-write`, `npm.cmd run test:backend`, `npm.cmd run test:api`, `npm.cmd run audit:architecture-boundary -- --json`, and `git diff --check`. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, backup, or worker-budget change was run.

## ATS Recovery Operation Guard - June 1, 2026

- `ats:source:canary` and `ats:source:apply` now enforce source recovery readiness before opening the production DB operation path. Dry-runs stay available, but canary/apply operations are blocked for unsupported sources or sources missing the recovery contract/fixture evidence.
- Apply authorization now requires readiness plus the existing `--confirm-production` and `--max-updates=N` flags. This turns the generated registry-readiness index into a runtime guard instead of a documentation-only checklist.
- Blocked operations emit JSON when requested. The previous `dayforcehcm` unsupported-source proof is superseded by source-local parser certification; Dayforce production canary/apply was not run and still requires explicit approval plus recovery guard/parity proof.
- Verification covered `sourceRunner` syntax/tests, registry-index tests, the blocked Dayforce CLI proof, `npm.cmd run test:backend`, `npm.cmd run test:api`, `npm.cmd run audit:architecture-boundary -- --json`, and `git diff --check`. No production source apply, canary/apply, data backfill, public-row delete/hide, Meili repair/reindex, deploy, backup, or worker-budget change was run.

## v2.1.0 Release Update - May 31, 2026

- Package/public release line is `v2.1.0`.
- Public release notes now summarize the ATS pipeline and runtime-safety work: source-module dispatch, parser evidence lanes, explicit ATS pipeline safeguards, duplicate read coalescing under load, lower background worker/deploy pressure, and verified Meili/Postgres parity after the repair window.
- The v2.1.0 release copy intentionally avoids foregrounding SEO, language expansion, public search speed, and mobile/Android work.
- This release update does not imply production source apply, data backfill, Meili replace reindex, Docker prune, or public-row deletion.

## Runtime Stability Update - May 31, 2026

- Public read caching now coalesces concurrent same-key misses so repeated `/postings/filter-options` requests wait on one producer instead of starting duplicate Postgres aggregation work.
- Compose defaults now use `OPENJOBSLOTS_PUBLIC_READ_CACHE_TTL_MS=120000` and `OPENJOBSLOTS_PUBLIC_READ_CACHE_MAX_ENTRIES=750` to reduce cache-miss pressure on expensive public filter/read endpoints.
- Worker defaults are back in a lower-throughput stability posture: interval `1800000` ms, automatic daily target budget `3000`, targets/run `50`, source daily budget `250`, and hard per-run ceiling `125`.
- The systemd deploy timer default now checks every `15min` with `60s` jitter instead of every minute, reducing GitHub polling and Docker build/recreate overlap on small hosts.
- This is runtime stabilization only: no production data backfill, source apply, Meili replace reindex, Docker prune, or public-row deletion is implied.

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
- Follow-up architecture cleanup keeps SAP HR Cloud parser ownership out of `server/ingestion/sources/common.js`; `audit:architecture-boundary` now fails if SAP HR Cloud parser imports or parser specs drift back into common.
- Follow-up architecture cleanup keeps Lever parser ownership out of `server/ingestion/sources/common.js`; `audit:architecture-boundary` now fails if Lever parser imports or parser specs drift back into common.
- Follow-up architecture cleanup keeps Ashby parser ownership out of `server/ingestion/sources/common.js`; `audit:architecture-boundary` now fails if Ashby parser imports or parser specs drift back into common.
- At this checkpoint, repo source-module coverage was `60/60` configured ATS directories with `index.js` and `parse.js`, and `dayforcehcm` was still represented by an explicit unsupported source stub. The June 1 DayforceHCM parser certification above supersedes that stub state.
- Public release line is prepared as `v2.0.0`: public release notes are public-safe, the result count says exact `job slots`, and the search header also exposes public ATS and company coverage chips. `/sync/status` now carries the same public count fields as `/health` for both Postgres and SQLite paths.
- Previous v2 canary stage increased from the live `4000/50/300` posture to `6000` automatic targets/day, `100` targets/run, and `500` successful targets/source/day while keeping worker concurrency `2` and interval `900000` ms; the adaptive scale prep above supersedes those defaults after deploy.
- Production canary enablement opened the disabled-normal ATS batch as `canary_only` after a fresh Postgres backup at `/root/OpenJobSlots/backups/v2-ats-canary-enable-20260527T134552Z.dump`. At that time Dayforce stayed disabled/unsupported; the June 1 DayforceHCM parser certification above supersedes that classification while still keeping Dayforce disabled. Auto-disabled `manatal`, `pinpointhq`, `taleo`, and `workday` remain blocked by their recorded failure reasons.
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
- Follow-up architecture cleanup keeps Recruitee parser ownership out of `server/ingestion/sources/common.js`; `audit:architecture-boundary` now fails if Recruitee parser imports or parser specs drift back into common.
- Follow-up architecture cleanup keeps Manatal parser ownership out of `server/ingestion/sources/common.js`; `audit:architecture-boundary` now fails if Manatal parser imports or parser specs drift back into common.
- Follow-up architecture cleanup keeps Workday parser ownership out of `server/ingestion/sources/common.js`; `audit:architecture-boundary` now fails if Workday parser imports or parser specs drift back into common.
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
- `jobvite` and `eightfold` are the closest disabled-source expansion candidates. Jobvite now has detail JSON-LD fixture coverage, but still needs full inventory, net-new estimate, and bounded canary before public expansion.
- `hirebridge`, `jobaps`, and `teamtailor` stay blocked until geo/remote risk drops.
- Public-board sources with zero configured targets need source-runner virtual target support before safe estimates are meaningful.

## Current Version

- Package/public release line: `v2.1.0`.
- Previous public release tag: `v2.0.0`.
- Current release branch: `main`.
- Last verified production checkout before this patch metadata/docs refresh: May 24, 2026 architecture deployment on `main`.
- Last verified production deployment date: May 31, 2026 v2.1.0 release deployment.
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
