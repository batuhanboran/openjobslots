# OpenJobSlots ATS Source Certification

OpenJobSlots should add ATS breadth only after parser correctness is proven. Third-party scraper repositories can be used for research, but source code should not be vendored unless license, maintenance, and correctness are reviewed.

## Current Coverage

- Configured ATS keys: 60.
- Fixture-backed ATS keys: 32.
- Strict saved raw parser-fixture-backed ATS keys: 32 (`adp_workforcenow`, `applicantai`, `applicantpro`, `applitrack`, `applytojob`, `ashby`, `bamboohr`, `breezy`, `calcareers`, `calopps`, `careerplug`, `fountain`, `greenhouse`, `hibob`, `hirebridge`, `hrmdirect`, `icims`, `jobvite`, `k12jobspot`, `lever`, `manatal`, `oracle`, `paylocity`, `pinpointhq`, `recruitcrm`, `recruitee`, `smartrecruiters`, `statejobsny`, `talentreef`, `taleo`, `workday`, `zoho`).
- Configured enabled ATS still pending strict raw parser fixtures: 27.
- Disabled unsupported ATS: `dayforcehcm`.

The difference matters: a normalized fixture proves that a sample posting can fit the DB shape. A raw parser fixture proves that the ATS response parser still works when the upstream HTML or JSON response changes. Certification requires the raw parser fixture.

Certification must also prove search impact. A parser is not production-ready if it creates rows that cannot be found by title, country, region, remote mode, or canonical URL in the production Postgres plus Meilisearch path. Use the [Search Quality Runbook](./search-quality-runbook.md) for corpus and parity expectations.

Missing location, posting date, or remote fields must be certified by saved source fixtures. A nullable field is acceptable only when the raw fixture proves the source omitted it, or the parser notes explain why extracting it would be unsafe or require extra source load that certification rejected. The v1.6 hardening batch adds pure raw-response parser coverage for Greenhouse, Lever, Ashby, SmartRecruiters, Workday, and Taleo; Taleo remains low-confidence despite certification because tenant-specific REST/AJAX column order still drifts. The direct JSON/API repair wave adds dedicated `server/ingestion/sources/<ats>/` modules for `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `recruitee`, `bamboohr`, `manatal`, `recruitcrm`, `pinpointhq`, `fountain`, and `zoho`, including source-local valid and invalid-shape fixtures.

## May 8 Data-Quality Priority

Live production before v1.5.13 had 722,591 active postings; 625,905 were missing `country`/`region`; 96,686 had `country`/`region`. The v1.5.13 backfill updated 254,694 existing rows, then reindexed 722,591 visible rows into Meilisearch. After that run, 337,606 active rows have `country`/`region` and 384,985 still miss one or both fields. The largest remaining gaps include `icims`, `applitrack`, `workday`, `bamboohr`, `taleo`, `applytojob`, `breezy`, and `recruitee`.

Treat ATS parser normalization as the first fix: improve `location_text`, `country`, `region`, `remote_type`, `posting_date`, `source_job_id`, and `last_seen_epoch` per ATS before Meilisearch cleanup. v1.5.14 continues the parser batch with Workday URL/CXS extraction, BambooHR/Recruitee country localization, Taleo column scanning, broader ApplyToJob/Breezy card parsing, iCIMS title/URL geo fallback, and budgeted iCIMS/Applitrack detail enrichment. v1.5.15 applies the production normalization backfill, rebuilds Meilisearch from Postgres, and closes the already-covered search outbox backlog after a full replace reindex. v1.5.16 adds source-id recovery for more high-volume URL shapes and expands global location aliases found in live data. v1.5.17 adds a 60-source certification workbench and guard tests so parser certification requires explicit field decisions for geo, date, remote, and source id. v1.5.18 stabilizes production backfill so existing source posting-date text can populate `posted_at_epoch`, concrete physical locations can classify as `onsite`, and sync upserts preserve stronger existing source IDs and remote types. v1.5.19 adds saved iCIMS/Applitrack raw detail fixtures, iCIMS `CC-state-city` geo parsing, iCIMS `Remote: Yes/No` handling, Applitrack `JobPostings/view.asp` detail URLs, and a dry-run-first detail-page tool. v1.5.20 fixes an iCIMS backfill failure mode where existing bad country values could override stronger `CC-state-city` evidence such as `IN-KL-Kozhikode` or `IL-Tel Aviv`. v1.5.21 expands the persisted normalized contract and adds ApplicantPro core jobs JSON raw fixture certification. v1.5.22 adds iCIMS JSON-LD detail parsing, Applitrack inline label/address detail recovery, and Manatal public jobs API certification. v1.5.24 promotes BambooHR, Recruitee, ApplyToJob, Breezy, and Zoho to strict saved raw parser-fixture-backed certification with bad-title, missing-company, and missing-url/source-id rejection coverage. v1.5.25 adds source-evidence-only field-quality repair for the highest-impact live gap batch: city is backfilled only from concrete location text, generic multi-location values stay blank, department is backfilled from stored source category/industry or Applitrack `applyFor` category, and job type/employment type is carried only when ATS source rows expose it. v1.6.1 replaces the legacy detail-page backfill write path with guarded `refetch:details` safety flags and audit tables. Wave A repairs add fixture-backed improvements for `icims`, `applitrack`, `manatal`, `taleo`, and `workday`. Wave B promotes `hrmdirect` to strict raw parser-fixture-backed status and tightens future-row parsing for `smartrecruiters`, `zoho`, `bamboohr`, `ashby`, and `greenhouse`; no source should be marked fully repaired until bounded production backfill/refetch plus Meili reindex verifies parity.

## Certification Gate

An ATS is certified only when all of these exist:

- Official documentation or a stable public endpoint description.
- Endpoint or URL pattern, pagination rule, rate-limit rule, and sample company URLs.
- Saved raw fixture from the source response.
- Expected normalized fixture using the common posting shape.
- Parser test that rejects missing title, company, or canonical URL.
- Adapter notes for date parsing, location parsing, remote/hybrid handling, known failure modes, and confidence.
- Fixture-backed proof for `location_text`, `country`, `region`, `remote_type`, `posting_date`/`posted_at`, `source_job_id`, and `last_seen_epoch`.
- Fixture-backed proof for missing or nullable location, date, and remote fields.
- Production parity tests showing normalized rows survive Postgres persistence, Meilisearch indexing, hydration, and public filter/search behavior.

Use the `ats-parser-certification` skill for the source-evidence workflow and the `openjobslots-postgres-audit` skill for production crossmatching. If a result looks fixed in parser output but still fails public search, do not certify it until `/postings`, direct Postgres rows, and raw Meilisearch hits agree or the delta is explicitly explained.

## Detail Evidence Boundary

Detail-page markdown, reader extracts, Jina output, Firecrawl output, and Browserless rendered output are evidence only, not truth. They can show what the source exposed and guide parser work, but the deterministic parser plus saved raw/detail fixtures and expected normalized fixtures must decide `country`, `region`, `city`, `remote_type`, `posting_date`, and `source_job_id`. If a field cannot be reproduced from fixture-backed parser logic, keep it `null`/`unknown` and document the blocker.

Keep detail certification in source-family lanes such as direct JSON/API, enterprise/detail, embedded/HTML, vendor/public-sector, and aggregator-boundary sources. A lane can move from research evidence to canary or public promotion only after the fixture-backed parser contract, source-quality guard, and Postgres-to-Meilisearch parity gate pass; markdown or reader evidence alone never satisfies the promotion gate.

## Expansion Priority

### Wave 1

| ATS | Source | Endpoint pattern | Notes |
| --- | --- | --- | --- |
| Personio | https://developer.personio.de/v1.0/reference/get_xml | `https://{company}.jobs.personio.de/xml?language=en` | Official XML feed; strong EU coverage. |
| Trakstar Hire / Recruiterbox | https://apiv1.recruiterbox.com/frontend_api.html | `https://jsapi.recruiterbox.com/v1/openings?client_name={client}` | Official frontend openings API. |
| JobScore | https://support.jobscore.com/hc/en-us/articles/202001320-Developers-Guide-to-Job-Feed-APIs | `https://careers.jobscore.com/jobs/{company}/feed.json` | Official JSON/XML feed. |

### Wave 2

| ATS | Source | Gate before enabling |
| --- | --- | --- |
| Workable | https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page | Review public widget config or API token handling. |
| Bullhorn | https://bullhorn.github.io/Public-API/ | Document `cls` and `corpToken` discovery/config. |
| Comeet / Spark Hire Recruit | https://developers.comeet.com/reference | Review public token handling and company UID discovery. |

## Aggregator Boundary

Remote/job-board aggregators such as Remotive, Himalayas, and Arbeitnow must stay separate from direct ATS adapters. They require stronger canonical URL dedupe and may have attribution or link-back requirements.

## 60-Source Certification Backlog

### v1.6.2 ATS Workbench

The current per-source scoreboard is generated in [ats-workbench/scoreboard.md](./ats-workbench/scoreboard.md). Use it as the first stop before parser work because it combines configured adapter status with live/test quality counters.

Regeneration command:

```bash
npm run audit:ats-quality -- --json --output=docs/reference/ats-workbench/scoreboard.json --markdown-output=docs/reference/ats-workbench/scoreboard.md
```

The command is read-only and includes every configured ATS key, including sources with no visible rows. The generated fields now include wave priority, certification blockers, exact next parser action, public-enabled recommendation, source-id reliability, canonical URL reliability, and detail-refetch requirement.

Current workbench counts: 60 configured ATS, 33 strict parser-fixture-backed, 0 partial, 26 fallback/pending, and 1 unsupported/disabled (`dayforcehcm`).

Current source-disable/quarantine recommendations are evidence-based, not permanent removals:

- Disable/hold public exposure until live canary bad-row rates improve: `brassring`, `teamtailor`, `applitrack`, `hirebridge`, `peopleforce`, `pageup`.
- Disable/hold no-row unproven configured sources until raw fixtures prove source id, canonical URL, and parser behavior: `isolvisolvedhire`, `policeapp`, `sagehr`. `calcareers`, `calopps`, `hibob`, `statejobsny`, `theapplicantmanager`, and `usajobs` now have raw fixtures but remain disabled until live canary evidence proves source quality and field coverage.
- Keep disabled: `dayforcehcm`.

Subagent/work-packet findings in this certification pass:

- Direct JSON/API: `teamtailor`, `freshteam`, and `getro` are the main certification gaps. `fountain`, `pinpointhq`, and `recruitcrm` should add source-id/path/pagination variants even though they are already raw parser-backed.
- Enterprise/brittle: `workday`, `icims`, `taleo`, `oracle`, `paylocity`, `adp_workforcenow`, `adp_myjobs`, `ultipro`, `pageup`, `saphrcloud`, and `brassring` now have source-module fixtures and invalid-shape tests. `eightfold` still needs raw parser fixtures before public enablement can be called safe. `taleo` and `brassring` remain low-confidence; `pageup`, `saphrcloud`, and `ultipro` need live canaries before promotion.
- Embedded/HTML: `icims` and `applitrack` are certified but need detail-refetch-backed field repair for live data gaps. `theapplicantmanager` now has source-local raw fixtures but remains disabled until live canary evidence proves quality. `jobvite`, `talentreef`, `hirebridge`, and `isolvisolvedhire` remain raw-fixture blockers.
- Vendor/public-sector: `applicantai`, `manatal`, and `hibob` are certified; most other vendor-specific and public-sector sources need source-id assertions and raw fixtures. `governmentjobs` and `policeapp` must stop fabricated recency before public confidence can be raised; CalOpps now keeps close dates separate and leaves posting dates null.

| ATS | Current source/parser path | Field gaps seen | Certification action |
| --- | --- | --- | --- |
| `greenhouse` | Greenhouse Job Board API JSON. | Remote is inferred only from explicit text because the source has no universal remote flag. | v1.6 adds raw `jobs[]` fixture with location, office country, department, content, source id, and tracking-query canonicalization. Wave B prefers `first_published` over `updated_at`, preserves city/location evidence, and stops treating full office location text as a country. Add retrieve-job fixture only if detail-only fields become indexed. |
| `lever` | Lever postings API JSON. | Broad regional remote can still miss country when no `country` code or concrete location exists. | v1.6 adds raw postings fixture with categories/allLocations, createdAt, hosted/apply URLs, country code, source id, and tracking-query canonicalization; add skip/limit pagination fixture next. |
| `ashby` | Ashby public GraphQL JSON plus official public job posting API shape. | Current hosted GraphQL query can omit posting date; official API shape exposes `publishedAt`. | v1.6 adds raw fixture for official public jobs shape with primary/secondary locations, address fields, workplace type, publishedAt, jobUrl/applyUrl, and descriptions. Wave B emits primary address city/state/country when source proves them. Add hosted GraphQL sparse-location fixtures next. |
| `smartrecruiters` | Public SmartRecruiters search JSON and authenticated Posting API where credentials exist. | Public search rows can omit company or URL; authenticated API requires reviewed credentials and is not used by tests. | v1.6 adds raw `content[]` fixture with company, location, releasedDate, department, employment type, remote flag, and source id. Wave B preserves structured city/region/country even when `shortLocation` is a remote label. Add authenticated Posting API fixture only after token handling review. |
| `recruitee` | PublicApp embedded JSON in HTML/API payload. | Localized country names, department/source id, workplace type, and source dates are certified when present; missing translated title is rejected. | v1.5.24 adds saved raw PublicApp fixture and failure fixture. Next: add more language and sparse-date tenant variants. |
| `bamboohr` | BambooHR careers JSON. | Some source rows expose only city plus full state/province, or string locations. | v1.5.24 adds saved raw API fixture plus failure fixture; rows without id and URL are skipped. Wave B recovers source id from `/careers/{id}` URLs and prevents remote-only labels from becoming city values. Next: add tenant variants for sparse string-only locations. |
| `teamtailor` | Teamtailor board HTML. | Null date; HTML classes are brittle. | v1.5.16 carries source id from `/jobs/{id}` URL; prefer stable JSON endpoint if available, otherwise certify saved HTML fixture. |
| `freshteam` | Freshteam board HTML. | Null date; remote attribute is not normalized into `remote_type`. | Emit remote field from `data-portal-remote-location`; add raw HTML fixture. |
| `pinpointhq` | Pinpoint `postings.json`. | Sparse location/path variants need coverage. | v1.5.16 carries source id from API id/uuid or postings URL; extend direct fixtures for path fallback, sparse location, remote/hybrid/onsite. |
| `recruitcrm` | RecruitCRM jobs API. | Country often blank for non-remote rows. | v1.5.16 carries source id from API id/job id/slug or URL; add pagination fixture, URL override, and city/country cases. |
| `fountain` | Fountain board `.json`. | Department can still be absent; URL parsing depends on `/c/{company}`. | Parser now carries `id`/`opening_id`/`to_param` as `source_job_id`; add path, pagination, and sparse location fixtures before broad source expansion. |
| `getro` | Getro Next.js `__NEXT_DATA__`. | Per-job company may be ignored; canonical/apply URL distinction weak. | Add saved Next.js fixture for `initialState.jobs.found`. |
| `workday` | Workday CXS job postings API. | Relative posting-date labels depend on fetch time; descriptions often require detail pages. | Wave A preserves structured CXS city/country, absolute external paths, and JR source ids while preventing Work From Home URL fragments from becoming city values; add pagination and detail-description fixtures next. |
| `oracle` | Oracle CandidateExperience requisition API. | Skips no-date rows; site/language discovery brittle. | Source module now carries `Id`; add alternate site/language, no-primary-location, `hasMore` fixtures. |
| `adp_myjobs` | ADP MyJobs token then `apply-custom-filters`. | Token discovery can silently empty; tenant arrays vary. | Parser now exports through source module, emits `reqId`, and preserves structured city/state/country; add token-missing, pagination, and multi-location variants. |
| `adp_workforcenow` | ADP Workforce Now content links and requisitions. | Department absent and source company inference can vary. | Parser now carries `itemID` and structured city/state/country; add multi-location/no-content-links fixtures. |
| `paylocity` | Paylocity embedded `window.pageData.Jobs`. | Missing `PublishedDate` can drop rows; embedded shape can drift. | Parser now carries `JobId`; add remote, country-only, malformed Jobs fixtures. |
| `dayforcehcm` | Configured only; no collector implementation. | Unsupported by design. | Keep disabled until a parser, raw fixture, and validation tests exist. |
| `eightfold` | Careers HTML plus Eightfold search API. | No pagination beyond start zero; group-id extraction brittle; source id absent. | Export parser, add API fixture, source id, pagination, missing group-id test. |
| `saphrcloud` | SAP SuccessFactors API/HTML parser. | Locale/date/location brittle; HTML fallback still needs fixture. | API source module handles object-valued text arrays and carries `id`; add HTML fallback and pagination fixtures. |
| `ultipro` | UKG/UltiPro search results API. | Tenant/board id parsing varies; remote weak. | Source module carries `Id`/`opportunityId`; add pagination/count and remote/hybrid variants. |
| `pageup` | PageUp board HTML plus AJAX search/detail pages. | Detail fetch failures can skip jobs; detail fields vary. | Source module certifies list-row fixture and URL id preservation; add two-part search/detail fixtures and listing-date fallback. |
| `jobvite` | Jobvite careers HTML tables. | Date absent; department only from grouping. | v1.5.16 carries source id from URL; add raw HTML fixture with grouped departments and date/detail-page evidence if available. |
| `icims` | iCIMS wrapper page, iframe, paged cards, and public job detail pages. | Public posted dates are frequently absent from visible labels but can appear in JobPosting JSON-LD; blank location cards still require sampled detail fetch. | Wave A derives city from source-backed `CC-state-city` values, keeps JSON-LD `datePosted`/postal-address parsing, and lets guarded detail refetch normalize from detail location evidence without overwriting stronger stored `location_text`. Continue bounded detail probes for blank-location tenants and next-page variants. |
| `zoho` | Zoho hidden `jobs` JSON in careers page. | Hidden job id, city/state/country, date opened, and industry are certified when present; missing id rows are skipped and missing-title rows are rejected. | v1.5.24 adds saved raw hidden-input fixture and failure fixture. Wave B emits explicit city/state/country and guards hidden list URLs so off-host metadata cannot redirect parsing. Next: add malformed JSON and unpublished-job variants. |
| `breezy` | Breezy portal HTML cards. | Relative dates may not parse when source does not provide absolute dates. | v1.5.24 adds saved raw card fixture and failure fixture for missing title/URL; `/p/{id}` source ids, location, date, department, and hybrid evidence are certified when present. Add detail-page fixtures for fields omitted from list cards. |
| `applicantpro` | Board HTML discovers domain id, then core jobs JSON. | Domain discovery is still brittle, but the JSON jobs parser now preserves `id`, `city`/`iso3`, `startDateRef`, department, and employment type when source exposes them. | v1.5.21 adds a pure `parseApplicantProPostingsFromApi` parser plus raw API fixture. Next: add board HTML domain-id fixture, `success=false` failure fixture, and live sampled location variants. |
| `applytojob` | ApplyToJob/Resumator HTML. | Legacy pages may still omit dates, department, or employment type. | v1.5.25 carries labeled employment type/job type when present; v1.5.24 adds saved raw list fixture and failure fixture for missing title/URL/company; `/apply/{id}` source ids, location, date, and department are certified when present. Add detail-page fixtures for list rows that omit fields. |
| `theapplicantmanager` | The Applicant Manager public careers HTML. | Posting date is source-absent in the saved list fixture; only labeled list location values are accepted for geo/remote/hybrid evidence. | Source-local registry module preserves `pos` query source ids, labeled `.pos_location_list` location/remote/hybrid evidence, department labels, resume-link skipping, raw/expected/invalid fixtures, and keeps the source disabled until live canary evidence proves quality. |
| `careerplug` | CareerPlug jobs HTML. | Source can omit `.job-title` while keeping the real title in `aria-label`; date absent from saved list fixture. | Raw fixture now covers valid `aria-label` title recovery, placeholder title rejection, missing title rejection, missing URL skipping, and `/jobs/{id}` source id preservation. |
| `talentreef` | TalentReef alias and search API. | No source id; country blank for state-only rows. | Add alias/search fixtures, set source id from `jobId`, add location tests. |
| `hirebridge` | Hirebridge list plus detail pages. | Location currently mapped from department; date requires detail page. | Fix department/location split; add list/detail fixtures and `jid` source id. |
| `hrmdirect` | HRMDirect table rows. | Non-US city/province pairs still need broader country evidence. | Wave B adds raw table fixtures, expected normalized fixtures, and failure fixtures. Parser now carries `req` source id, absolute URL host guard, city/state-derived location, country when state/location proves it, department, date, job type/employment type, and remote-city guard. Add more tenant-specific sparse-cell variants before broad backfill. |
| `isolvisolvedhire` | Board HTML domain id then core jobs JSON. | Relative job URLs can fail validation; source id absent. | Absolutize job URLs; add board/API fixtures and location fallbacks. |
| `applicantai` | ApplicantAI public careers HTML. | Posting date is source-absent in the saved list fixture; DOM classes remain brittle and weak location labels must stay quarantined. | Source-local registry module preserves numeric URL-tail source ids, validates public careers fetch metadata and final-host guards, skips invalid links/blank titles, stores raw/expected/invalid fixtures, and keeps the source disabled until live canary evidence proves quality. |
| `gem` | Gem GraphQL batch API. | Date absent; source id dropped; pagination unproven. | Add GraphQL fixture for id variants, remote-only, multi-location. |
| `join` | JOIN Next.js embedded data. | State shape brittle; source id dropped. | Add `initialState.jobs.items` fixture with remote/hybrid cases. |
| `careerspage` | CareersPage HTML. | Date absent; absolute URL regex brittle. | Add fixture for absolute/relative links and employment/location blocks. |
| `manatal` | Careers-page runtime config plus jobs API/fallback HTML. | Some public API rows omit posting date; city/source-id gaps in existing rows need backfill/reindex after parser repair. | Wave A adds API date/workplace variants and HTML fallback source-id plus remote/hybrid evidence. Parser carries city/state/country, department/team, employment type, description text, source id, and posting date only when source fields expose them. |
| `hibob` | HiBob careers board plus same-origin `api/job-ad`. | Location can be only `site`/`country`; no explicit remote/hybrid field is proven in the saved fixture. | Source-local registry module preserves `jobAdDetails[].id`, canonical URLs, `site`/`country` geo, optional `publishedAt`, raw/expected/invalid fixtures, and keeps the source disabled until live canary evidence proves quality. |
| `sagehr` | SageHR vacancies HTML. | Date absent; anti-bot/403 and classes brittle. | Add saved HTML fixtures for open and restricted responses. |
| `loxo` | Loxo HTML board. | Direct fetch bypasses central rate limiter; source id dropped. | Move through rate-limit wrapper and add date/location fixture. |
| `peopleforce` | PeopleForce careers HTML. | Date absent; classes brittle; direct fetch bypasses limiter. | Add open/closed site fixtures and rate-limit wrapper. |
| `simplicant` | Simplicant HTML board. | Date absent in observed list HTML; detail fetch not enabled. | Source-local registry module now preserves `/jobs/{id}/detail` and `/leads/{id}/detail` source ids with jobs/leads fixtures and malformed-card rejection. |
| `rippling` | Rippling ATS public JSON. | Strong fields but `item.id` dropped; pagination unproven. | Add API fixture with pagination, workplace type, and source id. |
| `careerpuck` | CareerPuck public job-board JSON. | Source id/apply URL dropped; pagination unproven. | Add API fixture for public filtering, applyUrl fallback, departments. |
| `talentlyft` | TalentLyft landing config plus paged fragments. | Date absent; `data-job-id` not stored. | Add landing plus fragment fixtures and source id. |
| `talexio` | Talexio jobs JSON. | ID/reference not source id; remote weak. | Add API fixture for pagination, country normalization, remote/hybrid. |
| `taleo` | Taleo bootstrap, REST search JSON, AJAX fallback. | Portal/token/column assumptions remain brittle; REST/AJAX fixtures cover only sampled column shapes. | Wave A adds AJAX token-stream coverage, extra date formats, and title/location disambiguation so `Remote Support Analyst` is not treated as a remote location. Keep low confidence until more tenant-specific variants pass. |
| `brassring` | BrassRing board tokens/cookies plus matched jobs JSON. | Date is last-updated; company can be unknown; source shape remains brittle. | Low-confidence source module now carries `reqid`; add paired board/API variants before public promotion. |
| `governmentjobs` | GovernmentJobs AJAX HTML. | Invents `Posted Today`; no source id; location basic. | Stop invented dates; parse real date or null; add raw fixture and URL id. |
| `usajobs` | USAJobs official Search API. | Official API credentials are required for live fetches; no detail fetch is enabled. | Source-local registry module preserves `PositionID`/`DocumentID`/`MatchedObjectId` as `source_job_id`, preserves `PositionURI` or derives `/job/{id}`, maps structured city/subdivision/country and `RemoteIndicator` true/false, preserves `PublicationStartDate`, covers legacy `Jobs[]` fallback, and has raw/expected/invalid fixtures. Keep disabled until bounded live canary evidence proves API quality and field coverage. |
| `k12jobspot` | K12JobSpot JSON API. | No detail fetch enabled; public API source-backed list fields only. | Source-local registry module now preserves `jobs[].id` as `source_job_id`, maps US city/state/postal list objects, and has raw/expected/invalid fixtures. |
| `schoolspring` | SchoolSpring JSON API. | Date format unproven; source id absent. | Add fixture and map `jobId`. |
| `calcareers` | CalCareers ASP.NET Search/JobSearchResults HTML plus search, row-count, and pager postbacks. | Markup order can drift; remote semantics are source-absent in the saved fixture. | Source-local registry module preserves Job Control/JobControlId source ids, Department, Location, Publish Date, bounded pager pages, raw/expected/invalid fixtures, and keeps the source disabled until live canary evidence proves quality. |
| `calopps` | CalOpps public job-search-list HTML plus bounded next-page links. | Source exposes region/location and close dates in saved fixtures, but no true posting-date field. | Source-local registry module preserves `/job-{id}` source ids, agency-from-path company names, close_date separately from posting_date, raw/expected/invalid fixtures, and keeps the source disabled until live canary evidence proves quality. |
| `statejobsny` | StateJobsNY dated vacancy table plus vacancy detail pages. | List `County` is not city-level geo; telecommuting semantics come only from exact detail labels. | Source-local registry module preserves vacancy id from detail URL/Item #, uses the Posted column, merges detail `City`/`State` as geo, maps exact `Telecommuting allowed? Yes/No` to hybrid/onsite, keeps county-only rows quarantined, and has raw/expected/invalid fixtures. Keep disabled until live canary evidence proves detail volume and quality. |
| `policeapp` | PoliceApp AJAX endpoint. | No pagination; invented date; location null. | Add pagination/date strategy or leave date null; raw fixture. |
| `jobaps` | JobAps company page. | No posting date; external id ignored by normalizer. | Add raw fixture and map JobNum to source id. |
| `applitrack` | Applitrack `Output.asp?all=1` plus `JobPostings/view.asp` detail pages. | Existing rows are often blank because `Output.asp` omits geo/date; full repair requires polite detail-page backfill, not only normalization. | Wave A supports single/double-quoted `applyFor`, extra call arguments, `Location(s)`/building/worksite labels, explicit negative remote text, and source footer address fallback for generic `DISTRICT WIDE` locations. Run bounded `refetch:details:dry-run` and then guarded `refetch:details` before reindexing Applitrack-heavy repair batches. |

## Slot Card Field Quality Rules

- Do not invent posting dates. If a source only proves that the job is currently visible, leave `posted_at`/`posting_date` null and rely on `last_seen_epoch`.
- Always preserve the strongest available source id (`id`, `jobId`, requisition id, vacancy id, URL id) as `source_job_id`.
- When list endpoints omit location/date but detail pages show them, certification should decide whether a polite detail fetch is worth the extra load. The parser must document that decision.
- Missing `location_text`, `country`, `region`, `posted_at`, or `remote_type` fields require raw fixture evidence. Do not certify a parser from normalized fixtures alone when those fields are blank.
- If a source exposes city/state/country separately, keep both the raw `location_text` and normalized `country`/`region` fields so filters remain worldwide-friendly.
