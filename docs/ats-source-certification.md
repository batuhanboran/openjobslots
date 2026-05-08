# OpenJobSlots ATS Source Certification

OpenJobSlots should add ATS breadth only after parser correctness is proven. Third-party scraper repositories can be used for research, but source code should not be vendored unless license, maintenance, and correctness are reviewed.

## Current Coverage

- Configured ATS keys: 60.
- Normalized fixture-backed ATS keys: 18.
- Strict raw parser-backed ATS keys: 11 (`adp_workforcenow`, `applitrack`, `applytojob`, `bamboohr`, `breezy`, `fountain`, `icims`, `oracle`, `paylocity`, `pinpointhq`, `recruitcrm`).
- Implemented collectors pending raw parser fixtures: 53.
- Disabled unsupported ATS: `dayforcehcm`.

The difference matters: a normalized fixture proves that a sample posting can fit the DB shape. A raw parser fixture proves that the ATS response parser still works when the upstream HTML or JSON response changes. Certification requires the raw parser fixture.

Certification must also prove search impact. A parser is not production-ready if it creates rows that cannot be found by title, country, region, remote mode, or canonical URL in the production Postgres plus Meilisearch path. Use the [Search Quality Runbook](./search-quality-runbook.md) for corpus and parity expectations.

Missing location, posting date, or remote fields must be certified by saved source fixtures. A nullable field is acceptable only when the raw fixture proves the source omitted it, or the parser notes explain why extracting it would be unsafe or require extra source load that certification rejected.

## May 8 Data-Quality Priority

Live production before v1.5.13 had 722,591 active postings; 625,905 were missing `country`/`region`; 96,686 had `country`/`region`. The v1.5.13 backfill updated 254,694 existing rows, then reindexed 722,591 visible rows into Meilisearch. After that run, 337,606 active rows have `country`/`region` and 384,985 still miss one or both fields. The largest remaining gaps include `icims`, `applitrack`, `workday`, `bamboohr`, `taleo`, `applytojob`, `breezy`, and `recruitee`.

Treat ATS parser normalization as the first fix: improve `location_text`, `country`, `region`, `remote_type`, `posting_date`, `source_job_id`, and `last_seen_epoch` per ATS before Meilisearch cleanup. v1.5.14 continues the parser batch with Workday URL/CXS extraction, BambooHR/Recruitee country localization, Taleo column scanning, broader ApplyToJob/Breezy card parsing, iCIMS title/URL geo fallback, and budgeted iCIMS/Applitrack detail enrichment. Reindex after normalization improves, then require production parity tests against the live-like Postgres plus Meilisearch path. Image work and build-cache cleanup are lower priority.

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

| ATS | Current source/parser path | Field gaps seen | Certification action |
| --- | --- | --- | --- |
| `greenhouse` | Greenhouse Job Board API JSON. | No `source_job_id`; department/team not carried; remote inferred from text. | Add raw `jobs[]` parser fixture, carry `id`, department, nested location, and remote text cases. |
| `lever` | Lever postings API JSON. | No `source_job_id`, team, or commitment; broad regional remote can miss country. | Add raw fixture for `id`, categories, multiple locations, hosted URL fallback. |
| `ashby` | Ashby public GraphQL JSON. | Source has no posting date in current public query; broad workplace/location terms can still be country-sparse. | v1.5.13 carries `id`, team, employment, and workplace type; add raw GraphQL fixture next. |
| `smartrecruiters` | Public SmartRecruiters search JSON. | Rows can drop when `applyUrl` is absent; `id`/industry not carried. | Parse `applyUrl || ref`, add `content[]` fixture and pagination test. |
| `recruitee` | PublicApp embedded JSON in HTML. | Localized country names and department/source id were previously not carried. | v1.5.14 adds PublicApp parsing for source id, departments, localized locations, and remote hints; saved raw HTML fixtures still needed for full certification. |
| `bamboohr` | BambooHR careers JSON. | Some source rows expose only city plus full state/province, or string locations. | v1.5.14 preserves string/object locations, additional date fields, workplace/remote hints, and relies on expanded state/province country aliases; expand saved raw fixtures with more tenants. |
| `teamtailor` | Teamtailor board HTML. | Null date; HTML classes are brittle; no source id. | Prefer stable JSON endpoint if available, otherwise certify saved HTML fixture. |
| `freshteam` | Freshteam board HTML. | Null date; remote attribute is not normalized into `remote_type`. | Emit remote field from `data-portal-remote-location`; add raw HTML fixture. |
| `pinpointhq` | Pinpoint `postings.json`. | Source id absent; sparse location/path variants need coverage. | Extend direct fixtures for path fallback, sparse location, remote/hybrid/onsite. |
| `recruitcrm` | RecruitCRM jobs API. | Source id absent; country often blank for non-remote rows. | Add pagination fixture, source id, URL override, and city/country cases. |
| `fountain` | Fountain board `.json`. | Source id/department absent; URL parsing depends on `/c/{company}`. | Add path variant fixtures and carry opening id. |
| `getro` | Getro Next.js `__NEXT_DATA__`. | Per-job company may be ignored; canonical/apply URL distinction weak. | Add saved Next.js fixture for `initialState.jobs.found`. |
| `workday` | Workday CXS job postings API. | Older active jobs were skipped; location/source id/remote were not emitted. | v1.5.14 stops same-day-only filtering, emits URL/CXS location and source id, and derives remote from Workday fields/URL; add saved CXS fixtures before certification. |
| `oracle` | Oracle CandidateExperience requisition API. | Source id not set; skips no-date rows; site/language discovery brittle. | Carry `Id`; add alternate site/language, no-primary-location, `hasMore` fixtures. |
| `adp_myjobs` | ADP MyJobs token then `apply-custom-filters`. | Token discovery can silently empty; `reqId` not source id. | Export parser, add direct fixture, token-missing test, pagination and location variants. |
| `adp_workforcenow` | ADP Workforce Now content links and requisitions. | `itemID` not source id; department absent. | Carry item id and add multi-location/no-content-links fixtures. |
| `paylocity` | Paylocity embedded `window.pageData.Jobs`. | `JobId` not source id; missing `PublishedDate` drops rows. | Carry job id; add remote, country-only, malformed Jobs fixtures. |
| `dayforcehcm` | Configured only; no collector implementation. | Unsupported by design. | Keep disabled until a parser, raw fixture, and validation tests exist. |
| `eightfold` | Careers HTML plus Eightfold search API. | No pagination beyond start zero; group-id extraction brittle; source id absent. | Export parser, add API fixture, source id, pagination, missing group-id test. |
| `saphrcloud` | SAP SuccessFactors HTML parser; API parser unused. | Locale/date/location brittle; source id absent. | Certify direct `/services/recruiting/v1/jobs` path or HTML fallback with fixtures. |
| `ultipro` | UKG/UltiPro search results API. | Inline parser; `Id` not source id; remote weak. | Extract parser, add `opportunities` fixture, source id, pagination. |
| `pageup` | PageUp board HTML plus AJAX search/detail pages. | Detail fetch failures skip jobs; external id not source id. | Add two-part search/detail fixtures and listing-date fallback. |
| `jobvite` | Jobvite careers HTML tables. | Date absent; no source id; department only from grouping. | Add raw HTML fixture with grouped departments and source id from URL. |
| `icims` | iCIMS wrapper page, iframe, and paged cards. | Iframe/pagination selectors remain brittle; source detail pages may expose fields not present in cards. | v1.5.14 adds title/URL geo fallback and a small per-company detail fetch budget for missing fields; add wrapper, iframe, detail, and next-page fixtures. |
| `zoho` | Zoho hidden `jobs` JSON in careers page. | Strong fields but job id not mapped to source id. | Add raw hidden-input fixture; set source id and malformed JSON test. |
| `breezy` | Breezy portal HTML cards. | Relative dates may not parse when source does not provide absolute dates. | v1.5.14 broadens title/location/date/card label extraction and keeps `/p/{id}` source ids; add detail-page fixtures for fields omitted from list cards. |
| `applicantpro` | Board HTML discovers domain id, then core jobs JSON. | Domain discovery brittle; source id absent. | Add board HTML and API JSON fixtures; set source id from job id. |
| `applytojob` | ApplyToJob/Resumator HTML. | Legacy pages may still omit dates or department. | v1.5.14 broadens icon/label extraction for location/date/department and keeps `/apply/{id}` source ids; add detail-page fixtures for list rows that omit fields. |
| `theapplicantmanager` | Applicant Manager HTML careers page. | Date/location absent; department only. | Add raw fixture and consider detail fetch for date/location. |
| `careerplug` | CareerPlug jobs HTML. | Date/source id absent; href rule too narrow. | Add raw fixture for aria/no-aria cards; derive id from `/jobs/{id}`. |
| `talentreef` | TalentReef alias and search API. | No source id; country blank for state-only rows. | Add alias/search fixtures, set source id from `jobId`, add location tests. |
| `hirebridge` | Hirebridge list plus detail pages. | Location currently mapped from department; date requires detail page. | Fix department/location split; add list/detail fixtures and `jid` source id. |
| `hrmdirect` | HRMDirect table rows. | US state abbreviations do not infer country; source id absent. | Add raw table fixture; infer US from state; set id from req param. |
| `isolvisolvedhire` | Board HTML domain id then core jobs JSON. | Relative job URLs can fail validation; source id absent. | Absolutize job URLs; add board/API fixtures and location fallbacks. |
| `applicantai` | ApplicantAI public HTML. | Date/source id absent; DOM classes brittle. | Export parser and add raw HTML fixture with invalid href rejection. |
| `gem` | Gem GraphQL batch API. | Date absent; source id dropped; pagination unproven. | Add GraphQL fixture for id variants, remote-only, multi-location. |
| `join` | JOIN Next.js embedded data. | State shape brittle; source id dropped. | Add `initialState.jobs.items` fixture with remote/hybrid cases. |
| `careerspage` | CareersPage HTML. | Date absent; absolute URL regex brittle. | Add fixture for absolute/relative links and employment/location blocks. |
| `manatal` | Careers-page runtime config plus jobs API/fallback HTML. | Source id/apply URL dropped; config extraction brittle. | Add API pagination plus fallback HTML fixtures. |
| `hibob` | HiBob board plus `api/job-ad`. | Location can be only site/country; source id dropped. | Add raw API fixture with country/site variants and source id. |
| `sagehr` | SageHR vacancies HTML. | Date absent; anti-bot/403 and classes brittle. | Add saved HTML fixtures for open and restricted responses. |
| `loxo` | Loxo HTML board. | Direct fetch bypasses central rate limiter; source id dropped. | Move through rate-limit wrapper and add date/location fixture. |
| `peopleforce` | PeopleForce careers HTML. | Date absent; classes brittle; direct fetch bypasses limiter. | Add open/closed site fixtures and rate-limit wrapper. |
| `simplicant` | Simplicant HTML board. | Date absent; strict detail URL rule; source id dropped. | Add jobs/leads path fixtures and malformed-card rejection. |
| `rippling` | Rippling ATS public JSON. | Strong fields but `item.id` dropped; pagination unproven. | Add API fixture with pagination, workplace type, and source id. |
| `careerpuck` | CareerPuck public job-board JSON. | Source id/apply URL dropped; pagination unproven. | Add API fixture for public filtering, applyUrl fallback, departments. |
| `talentlyft` | TalentLyft landing config plus paged fragments. | Date absent; `data-job-id` not stored. | Add landing plus fragment fixtures and source id. |
| `talexio` | Talexio jobs JSON. | ID/reference not source id; remote weak. | Add API fixture for pagination, country normalization, remote/hybrid. |
| `taleo` | Taleo bootstrap, REST search JSON, AJAX fallback. | Portal/token/column assumptions brittle; fixed column indexes wrote invalid dates like `false`. | v1.5.14 scans REST columns for actual date/location, rejects boolean dates, and preserves source id; keep low confidence until REST/AJAX raw fixtures pass. |
| `brassring` | BrassRing board tokens/cookies plus matched jobs JSON. | Date is last-updated; company can be unknown; req id dropped. | Keep low confidence; add paired board/API fixtures and reqid source id. |
| `governmentjobs` | GovernmentJobs AJAX HTML. | Invents `Posted Today`; no source id; location basic. | Stop invented dates; parse real date or null; add raw fixture and URL id. |
| `usajobs` | USAJobs landing token plus search POST. | Remote flags and DocumentID not carried. | Add raw fixture and map `DocumentID` to source id. |
| `k12jobspot` | K12JobSpot JSON API. | US state/country normalization weak; source id absent. | Add fixture and map job id; improve US location normalization. |
| `schoolspring` | SchoolSpring JSON API. | Date format unproven; source id absent. | Add fixture and map `jobId`. |
| `calcareers` | CalCareers ASP.NET HTML. | Markup order brittle; source id absent. | Add postback HTML fixture and JobControl source id. |
| `calopps` | CalOpps paged HTML. | Uses current timestamp as posting date; location only region. | Stop invented dates; add fixture and preserve source id. |
| `statejobsny` | StateJobsNY dated HTML table. | Column indexes brittle; vacancy id not source id. | Add table fixture and vacancy id extraction. |
| `policeapp` | PoliceApp AJAX endpoint. | No pagination; invented date; location null. | Add pagination/date strategy or leave date null; raw fixture. |
| `jobaps` | JobAps company page. | No posting date; external id ignored by normalizer. | Add raw fixture and map JobNum to source id. |
| `applitrack` | Applitrack `Output.asp?all=1`. | Many pages still omit location/date in the listing, and detail fetch certification is pending. | v1.5.14 adds labeled detail-page parsing plus a small per-company detail fetch budget for missing fields; add saved `Output.asp` and detail fixtures before full certification. |

## Slot Card Field Quality Rules

- Do not invent posting dates. If a source only proves that the job is currently visible, leave `posted_at`/`posting_date` null and rely on `last_seen_epoch`.
- Always preserve the strongest available source id (`id`, `jobId`, requisition id, vacancy id, URL id) as `source_job_id`.
- When list endpoints omit location/date but detail pages show them, certification should decide whether a polite detail fetch is worth the extra load. The parser must document that decision.
- Missing `location_text`, `country`, `region`, `posted_at`, or `remote_type` fields require raw fixture evidence. Do not certify a parser from normalized fixtures alone when those fields are blank.
- If a source exposes city/state/country separately, keep both the raw `location_text` and normalized `country`/`region` fields so filters remain worldwide-friendly.
