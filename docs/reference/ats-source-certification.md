# OpenJobSlots ATS Source Certification

OpenJobSlots should add ATS breadth only after parser correctness is proven. Third-party scraper repositories can be used for research, but source code should not be vendored unless license, maintenance, and correctness are reviewed.

## Current Coverage

- Configured ATS keys: 60.
- Fixture-backed ATS keys: 23.
- Strict saved raw parser-fixture-backed ATS keys: 22 (`adp_workforcenow`, `applicantpro`, `applitrack`, `applytojob`, `ashby`, `bamboohr`, `breezy`, `careerplug`, `fountain`, `greenhouse`, `icims`, `lever`, `manatal`, `oracle`, `paylocity`, `pinpointhq`, `recruitcrm`, `recruitee`, `smartrecruiters`, `taleo`, `workday`, `zoho`).
- Configured enabled ATS still pending strict raw parser fixtures: 37.
- Disabled unsupported ATS: `dayforcehcm`.

The difference matters: a normalized fixture proves that a sample posting can fit the DB shape. A raw parser fixture proves that the ATS response parser still works when the upstream HTML or JSON response changes. Certification requires the raw parser fixture.

Certification must also prove search impact. A parser is not production-ready if it creates rows that cannot be found by title, country, region, remote mode, or canonical URL in the production Postgres plus Meilisearch path. Use the [Search Quality Runbook](./search-quality-runbook.md) for corpus and parity expectations.

Missing location, posting date, or remote fields must be certified by saved source fixtures. A nullable field is acceptable only when the raw fixture proves the source omitted it, or the parser notes explain why extracting it would be unsafe or require extra source load that certification rejected. The v1.6 hardening batch adds pure raw-response parser coverage for Greenhouse, Lever, Ashby, SmartRecruiters, Workday, and Taleo; Taleo remains low-confidence despite certification because tenant-specific REST/AJAX column order still drifts.

## May 8 Data-Quality Priority

Live production before v1.5.13 had 722,591 active postings; 625,905 were missing `country`/`region`; 96,686 had `country`/`region`. The v1.5.13 backfill updated 254,694 existing rows, then reindexed 722,591 visible rows into Meilisearch. After that run, 337,606 active rows have `country`/`region` and 384,985 still miss one or both fields. The largest remaining gaps include `icims`, `applitrack`, `workday`, `bamboohr`, `taleo`, `applytojob`, `breezy`, and `recruitee`.

Treat ATS parser normalization as the first fix: improve `location_text`, `country`, `region`, `remote_type`, `posting_date`, `source_job_id`, and `last_seen_epoch` per ATS before Meilisearch cleanup. v1.5.14 continues the parser batch with Workday URL/CXS extraction, BambooHR/Recruitee country localization, Taleo column scanning, broader ApplyToJob/Breezy card parsing, iCIMS title/URL geo fallback, and budgeted iCIMS/Applitrack detail enrichment. v1.5.15 applies the production normalization backfill, rebuilds Meilisearch from Postgres, and closes the already-covered search outbox backlog after a full replace reindex. v1.5.16 adds source-id recovery for more high-volume URL shapes and expands global location aliases found in live data. v1.5.17 adds a 60-source certification workbench and guard tests so parser certification requires explicit field decisions for geo, date, remote, and source id. v1.5.18 stabilizes production backfill so existing source posting-date text can populate `posted_at_epoch`, concrete physical locations can classify as `onsite`, and sync upserts preserve stronger existing source IDs and remote types. v1.5.19 adds saved iCIMS/Applitrack raw detail fixtures, iCIMS `CC-state-city` geo parsing, iCIMS `Remote: Yes/No` handling, Applitrack `JobPostings/view.asp` detail URLs, and a dry-run-first `backfill:detail-pages` tool. v1.5.20 fixes an iCIMS backfill failure mode where existing bad country values could override stronger `CC-state-city` evidence such as `IN-KL-Kozhikode` or `IL-Tel Aviv`. v1.5.21 expands the persisted normalized contract and adds ApplicantPro core jobs JSON raw fixture certification. v1.5.22 adds iCIMS JSON-LD detail parsing, Applitrack inline label/address detail recovery, and Manatal public jobs API certification. v1.5.24 promotes BambooHR, Recruitee, ApplyToJob, Breezy, and Zoho to strict saved raw parser-fixture-backed certification with bad-title, missing-company, and missing-url/source-id rejection coverage. v1.5.25 adds source-evidence-only field-quality repair for the highest-impact live gap batch: city is backfilled only from concrete location text, generic multi-location values stay blank, department is backfilled from stored source category/industry or Applitrack `applyFor` category, and job type/employment type is carried only when ATS source rows expose it. Next parser implementation work should use the detail-page tool to certify and repair blank-list rows in bounded batches before reindexing.

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
| `greenhouse` | Greenhouse Job Board API JSON. | Remote is inferred only from explicit text because the source has no universal remote flag. | v1.6 adds raw `jobs[]` fixture with location, office country, department, content, source id, and tracking-query canonicalization; add retrieve-job fixture only if detail-only fields become indexed. |
| `lever` | Lever postings API JSON. | Broad regional remote can still miss country when no `country` code or concrete location exists. | v1.6 adds raw postings fixture with categories/allLocations, createdAt, hosted/apply URLs, country code, source id, and tracking-query canonicalization; add skip/limit pagination fixture next. |
| `ashby` | Ashby public GraphQL JSON plus official public job posting API shape. | Current hosted GraphQL query can omit posting date; official API shape exposes `publishedAt`. | v1.6 adds raw fixture for official public jobs shape with primary/secondary locations, address fields, workplace type, publishedAt, jobUrl/applyUrl, and descriptions; add hosted GraphQL sparse-location fixtures next. |
| `smartrecruiters` | Public SmartRecruiters search JSON and authenticated Posting API where credentials exist. | Public search rows can omit company or URL; authenticated API requires reviewed credentials and is not used by tests. | v1.6 adds raw `content[]` fixture with company, location, releasedDate, department, employment type, remote flag, and source id; add authenticated Posting API fixture only after token handling review. |
| `recruitee` | PublicApp embedded JSON in HTML/API payload. | Localized country names, department/source id, workplace type, and source dates are certified when present; missing translated title is rejected. | v1.5.24 adds saved raw PublicApp fixture and failure fixture. Next: add more language and sparse-date tenant variants. |
| `bamboohr` | BambooHR careers JSON. | Some source rows expose only city plus full state/province, or string locations. | v1.5.24 adds saved raw API fixture plus failure fixture; rows without id and URL are skipped. Next: add tenant variants for sparse string-only locations. |
| `teamtailor` | Teamtailor board HTML. | Null date; HTML classes are brittle. | v1.5.16 carries source id from `/jobs/{id}` URL; prefer stable JSON endpoint if available, otherwise certify saved HTML fixture. |
| `freshteam` | Freshteam board HTML. | Null date; remote attribute is not normalized into `remote_type`. | Emit remote field from `data-portal-remote-location`; add raw HTML fixture. |
| `pinpointhq` | Pinpoint `postings.json`. | Sparse location/path variants need coverage. | v1.5.16 carries source id from API id/uuid or postings URL; extend direct fixtures for path fallback, sparse location, remote/hybrid/onsite. |
| `recruitcrm` | RecruitCRM jobs API. | Country often blank for non-remote rows. | v1.5.16 carries source id from API id/job id/slug or URL; add pagination fixture, URL override, and city/country cases. |
| `fountain` | Fountain board `.json`. | Source id/department absent; URL parsing depends on `/c/{company}`. | Add path variant fixtures and carry opening id. |
| `getro` | Getro Next.js `__NEXT_DATA__`. | Per-job company may be ignored; canonical/apply URL distinction weak. | Add saved Next.js fixture for `initialState.jobs.found`. |
| `workday` | Workday CXS job postings API. | Relative posting-date labels depend on fetch time; descriptions often require detail pages. | v1.6 adds pure CXS raw fixture certification for externalPath URL building, JR source id, source date text, URL/location extraction, and Work From Home remote evidence; add pagination and detail-description fixtures next. |
| `oracle` | Oracle CandidateExperience requisition API. | Source id not set; skips no-date rows; site/language discovery brittle. | Carry `Id`; add alternate site/language, no-primary-location, `hasMore` fixtures. |
| `adp_myjobs` | ADP MyJobs token then `apply-custom-filters`. | Token discovery can silently empty; `reqId` not source id. | Export parser, add direct fixture, token-missing test, pagination and location variants. |
| `adp_workforcenow` | ADP Workforce Now content links and requisitions. | `itemID` not source id; department absent. | Carry item id and add multi-location/no-content-links fixtures. |
| `paylocity` | Paylocity embedded `window.pageData.Jobs`. | `JobId` not source id; missing `PublishedDate` drops rows. | Carry job id; add remote, country-only, malformed Jobs fixtures. |
| `dayforcehcm` | Configured only; no collector implementation. | Unsupported by design. | Keep disabled until a parser, raw fixture, and validation tests exist. |
| `eightfold` | Careers HTML plus Eightfold search API. | No pagination beyond start zero; group-id extraction brittle; source id absent. | Export parser, add API fixture, source id, pagination, missing group-id test. |
| `saphrcloud` | SAP SuccessFactors HTML parser; API parser unused. | Locale/date/location brittle; source id absent. | Certify direct `/services/recruiting/v1/jobs` path or HTML fallback with fixtures. |
| `ultipro` | UKG/UltiPro search results API. | Inline parser; `Id` not source id; remote weak. | Extract parser, add `opportunities` fixture, source id, pagination. |
| `pageup` | PageUp board HTML plus AJAX search/detail pages. | Detail fetch failures skip jobs; external id not source id. | Add two-part search/detail fixtures and listing-date fallback. |
| `jobvite` | Jobvite careers HTML tables. | Date absent; department only from grouping. | v1.5.16 carries source id from URL; add raw HTML fixture with grouped departments and date/detail-page evidence if available. |
| `icims` | iCIMS wrapper page, iframe, paged cards, and public job detail pages. | Public posted dates are frequently absent from visible labels but can appear in JobPosting JSON-LD; blank location cards still require sampled detail fetch. | v1.5.22 adds JSON-LD `datePosted` and postal-address location parsing for detail pages, in addition to existing `CC-state-city`, `US-Remote`, and `Remote: Yes/No` handling. Continue bounded detail probes for blank-location tenants and next-page variants. |
| `zoho` | Zoho hidden `jobs` JSON in careers page. | Hidden job id, city/state/country, date opened, and industry are certified when present; missing id rows are skipped and missing-title rows are rejected. | v1.5.24 adds saved raw hidden-input fixture and failure fixture. Next: add malformed JSON and unpublished-job variants. |
| `breezy` | Breezy portal HTML cards. | Relative dates may not parse when source does not provide absolute dates. | v1.5.24 adds saved raw card fixture and failure fixture for missing title/URL; `/p/{id}` source ids, location, date, department, and hybrid evidence are certified when present. Add detail-page fixtures for fields omitted from list cards. |
| `applicantpro` | Board HTML discovers domain id, then core jobs JSON. | Domain discovery is still brittle, but the JSON jobs parser now preserves `id`, `city`/`iso3`, `startDateRef`, department, and employment type when source exposes them. | v1.5.21 adds a pure `parseApplicantProPostingsFromApi` parser plus raw API fixture. Next: add board HTML domain-id fixture, `success=false` failure fixture, and live sampled location variants. |
| `applytojob` | ApplyToJob/Resumator HTML. | Legacy pages may still omit dates, department, or employment type. | v1.5.25 carries labeled employment type/job type when present; v1.5.24 adds saved raw list fixture and failure fixture for missing title/URL/company; `/apply/{id}` source ids, location, date, and department are certified when present. Add detail-page fixtures for list rows that omit fields. |
| `theapplicantmanager` | Applicant Manager HTML careers page. | Date/location absent; department only. | Add raw fixture and consider detail fetch for date/location. |
| `careerplug` | CareerPlug jobs HTML. | Source can omit `.job-title` while keeping the real title in `aria-label`; date absent from saved list fixture. | Raw fixture now covers valid `aria-label` title recovery, placeholder title rejection, missing title rejection, missing URL skipping, and `/jobs/{id}` source id preservation. |
| `talentreef` | TalentReef alias and search API. | No source id; country blank for state-only rows. | Add alias/search fixtures, set source id from `jobId`, add location tests. |
| `hirebridge` | Hirebridge list plus detail pages. | Location currently mapped from department; date requires detail page. | Fix department/location split; add list/detail fixtures and `jid` source id. |
| `hrmdirect` | HRMDirect table rows. | Non-US city/province pairs still need broader country evidence. | v1.5.25 carries explicit city, department, and job-type/employment-type cells when present and allows source-derived `industry` to backfill blank department. v1.5.16 derives source id from `req` and expands global aliases; add raw table fixtures for US and non-US rows. |
| `isolvisolvedhire` | Board HTML domain id then core jobs JSON. | Relative job URLs can fail validation; source id absent. | Absolutize job URLs; add board/API fixtures and location fallbacks. |
| `applicantai` | ApplicantAI public HTML. | Date/source id absent; DOM classes brittle. | Export parser and add raw HTML fixture with invalid href rejection. |
| `gem` | Gem GraphQL batch API. | Date absent; source id dropped; pagination unproven. | Add GraphQL fixture for id variants, remote-only, multi-location. |
| `join` | JOIN Next.js embedded data. | State shape brittle; source id dropped. | Add `initialState.jobs.items` fixture with remote/hybrid cases. |
| `careerspage` | CareersPage HTML. | Date absent; absolute URL regex brittle. | Add fixture for absolute/relative links and employment/location blocks. |
| `manatal` | Careers-page runtime config plus jobs API/fallback HTML. | Public API fixture omits posting date; city/source-id gaps in existing rows need backfill/reindex after parser repair. | v1.5.25 carries department/team and employment/job type fields when the API exposes them. v1.5.22 certifies Manatal API parsing with saved raw fixture, carries city/state/country, source id, description text, and remote evidence, rejects blank titles, and skips rows without job-specific URLs. |
| `hibob` | HiBob board plus `api/job-ad`. | Location can be only site/country; source id dropped. | Add raw API fixture with country/site variants and source id. |
| `sagehr` | SageHR vacancies HTML. | Date absent; anti-bot/403 and classes brittle. | Add saved HTML fixtures for open and restricted responses. |
| `loxo` | Loxo HTML board. | Direct fetch bypasses central rate limiter; source id dropped. | Move through rate-limit wrapper and add date/location fixture. |
| `peopleforce` | PeopleForce careers HTML. | Date absent; classes brittle; direct fetch bypasses limiter. | Add open/closed site fixtures and rate-limit wrapper. |
| `simplicant` | Simplicant HTML board. | Date absent; strict detail URL rule; source id dropped. | Add jobs/leads path fixtures and malformed-card rejection. |
| `rippling` | Rippling ATS public JSON. | Strong fields but `item.id` dropped; pagination unproven. | Add API fixture with pagination, workplace type, and source id. |
| `careerpuck` | CareerPuck public job-board JSON. | Source id/apply URL dropped; pagination unproven. | Add API fixture for public filtering, applyUrl fallback, departments. |
| `talentlyft` | TalentLyft landing config plus paged fragments. | Date absent; `data-job-id` not stored. | Add landing plus fragment fixtures and source id. |
| `talexio` | Talexio jobs JSON. | ID/reference not source id; remote weak. | Add API fixture for pagination, country normalization, remote/hybrid. |
| `taleo` | Taleo bootstrap, REST search JSON, AJAX fallback. | Portal/token/column assumptions remain brittle; REST fixture covers only one modern column shape. | v1.6 adds saved REST raw fixture and failure fixture proving source-backed date/location scanning, boolean-date rejection, missing-title rejection, and jobId/contestNo source id preservation; keep low confidence until AJAX and tenant-specific variants pass. |
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
| `applitrack` | Applitrack `Output.asp?all=1` plus `JobPostings/view.asp` detail pages. | Existing rows are often blank because `Output.asp` omits geo/date; full repair requires polite detail-page backfill, not only normalization. | v1.5.25 treats the `applyFor(jobId, category, specialty)` category as source-backed department evidence but still does not invent geo/date from blank list rows. v1.5.22 expands detail parsing for inline `Date Posted`/`Location` label blocks and source footer address fallback for generic `DISTRICT WIDE` locations. Run bounded `backfill:detail-pages` before reindexing Applitrack-heavy repair batches. |

## Slot Card Field Quality Rules

- Do not invent posting dates. If a source only proves that the job is currently visible, leave `posted_at`/`posting_date` null and rely on `last_seen_epoch`.
- Always preserve the strongest available source id (`id`, `jobId`, requisition id, vacancy id, URL id) as `source_job_id`.
- When list endpoints omit location/date but detail pages show them, certification should decide whether a polite detail fetch is worth the extra load. The parser must document that decision.
- Missing `location_text`, `country`, `region`, `posted_at`, or `remote_type` fields require raw fixture evidence. Do not certify a parser from normalized fixtures alone when those fields are blank.
- If a source exposes city/state/country separately, keep both the raw `location_text` and normalized `country`/`region` fields so filters remain worldwide-friendly.
