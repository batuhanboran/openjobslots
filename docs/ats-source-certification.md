# OpenJobSlots ATS Source Certification

OpenJobSlots should add ATS breadth only after parser correctness is proven. Third-party scraper repositories can be used for research, but source code should not be vendored unless license, maintenance, and correctness are reviewed.

## Current Coverage

- Configured ATS keys: 60.
- Normalized fixture-backed ATS keys: 18.
- Strict raw parser-backed ATS keys: 6 (`adp_workforcenow`, `fountain`, `oracle`, `paylocity`, `pinpointhq`, `recruitcrm`).
- Implemented collectors pending raw parser fixtures: 53.
- Disabled unsupported ATS: `dayforcehcm`.

The difference matters: a normalized fixture proves that a sample posting can fit the DB shape. A raw parser fixture proves that the ATS response parser still works when the upstream HTML or JSON response changes. Certification requires the raw parser fixture.

Certification must also prove search impact. A parser is not production-ready if it creates rows that cannot be found by title, country, region, remote mode, or canonical URL in the production Postgres plus Meilisearch path. Use the [Search Quality Runbook](./search-quality-runbook.md) for corpus and parity expectations.

## Certification Gate

An ATS is certified only when all of these exist:

- Official documentation or a stable public endpoint description.
- Endpoint or URL pattern, pagination rule, rate-limit rule, and sample company URLs.
- Saved raw fixture from the source response.
- Expected normalized fixture using the common posting shape.
- Parser test that rejects missing title, company, or canonical URL.
- Adapter notes for date parsing, location parsing, remote/hybrid handling, known failure modes, and confidence.

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
| `ashby` | Ashby public GraphQL JSON. | Date not emitted; `workplaceType`, team, employment not carried. | Add raw GraphQL fixture, carry `id`, team, employment, workplace type. |
| `smartrecruiters` | Public SmartRecruiters search JSON. | Rows can drop when `applyUrl` is absent; `id`/industry not carried. | Parse `applyUrl || ref`, add `content[]` fixture and pagination test. |
| `recruitee` | PublicApp embedded JSON in HTML. | No source id/department; slug fallback can dedupe poorly. | Add saved PublicApp HTML fixture and parser test for translations, locations, slug rejection. |
| `bamboohr` | BambooHR careers JSON. | No source id; city/state/country can collapse to partial location. | Export parser, add direct fixture with `id`, full location, and remote flag. |
| `teamtailor` | Teamtailor board HTML. | Null date; HTML classes are brittle; no source id. | Prefer stable JSON endpoint if available, otherwise certify saved HTML fixture. |
| `freshteam` | Freshteam board HTML. | Null date; remote attribute is not normalized into `remote_type`. | Emit remote field from `data-portal-remote-location`; add raw HTML fixture. |
| `pinpointhq` | Pinpoint `postings.json`. | Source id absent; sparse location/path variants need coverage. | Extend direct fixtures for path fallback, sparse location, remote/hybrid/onsite. |
| `recruitcrm` | RecruitCRM jobs API. | Source id absent; country often blank for non-remote rows. | Add pagination fixture, source id, URL override, and city/country cases. |
| `fountain` | Fountain board `.json`. | Source id/department absent; URL parsing depends on `/c/{company}`. | Add path variant fixtures and carry opening id. |
| `getro` | Getro Next.js `__NEXT_DATA__`. | Per-job company may be ignored; canonical/apply URL distinction weak. | Add saved Next.js fixture for `initialState.jobs.found`. |
| `workday` | Workday CXS job postings API. | Filters only `Posted Today`; location not emitted; no source id. | Extract pure CXS parser, add date-stable fixture, source id, location, pagination. |
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
| `icims` | iCIMS wrapper page, iframe, and paged cards. | Source id absent; iframe/date selectors brittle. | Add wrapper, iframe, next-page fixtures; derive id from `/jobs/{id}`. |
| `zoho` | Zoho hidden `jobs` JSON in careers page. | Strong fields but job id not mapped to source id. | Add raw hidden-input fixture; set source id and malformed JSON test. |
| `breezy` | Breezy portal HTML cards. | Relative dates may not parse; no source id. | Add raw card fixture and derive id from `/p/{id}`. |
| `applicantpro` | Board HTML discovers domain id, then core jobs JSON. | Domain discovery brittle; source id absent. | Add board HTML and API JSON fixtures; set source id from job id. |
| `applytojob` | ApplyToJob/Resumator HTML. | Date absent; no source id/department. | Add modern and legacy raw HTML fixtures and remote/location cases. |
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
| `taleo` | Taleo bootstrap, REST search JSON, AJAX fallback. | Portal/token/column assumptions brittle; source id dropped. | Keep low confidence; add REST/AJAX fixtures and column-index tests. |
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
| `applitrack` | Applitrack `Output.asp?all=1`. | Date/location absent; job id not source id; normalized-only fixture. | Add raw `Output.asp` fixture and map `applyFor` id. |

## Slot Card Field Quality Rules

- Do not invent posting dates. If a source only proves that the job is currently visible, leave `posted_at`/`posting_date` null and rely on `last_seen_epoch`.
- Always preserve the strongest available source id (`id`, `jobId`, requisition id, vacancy id, URL id) as `source_job_id`.
- When list endpoints omit location/date but detail pages show them, certification should decide whether a polite detail fetch is worth the extra load. The parser must document that decision.
- If a source exposes city/state/country separately, keep both the raw `location_text` and normalized `country`/`region` fields so filters remain worldwide-friendly.
