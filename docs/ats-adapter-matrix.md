# OpenJobSlots ATS Parser Matrix

OpenJobSlots prefers direct public ATS APIs, durable cached payload metadata, and conservative validation. Third-party scraper projects may be useful references, but parser code should not be vendored until license, maintenance, and correctness are reviewed.

Every adapter must expose `detect`, `buildRequests`, `fetch`, `parse`, `normalize`, `validate`, `cacheKey`, `rateLimit`, and `fixtures`. Every normalized posting must fit the durable shape: `source_job_id`, `canonical_url`, `apply_url`, `title`, `company`, `location_text`, `country`, `region`, `remote_type`, `industry`, `posting_date`/`posted_at`, `first_seen`, `last_seen_epoch`, `ats_key`, `parser_version`, `raw_hash`, and `confidence`.

Parser changes must be checked against public search quality, not only parser unit output. When parser output changes title, location, country, region, remote type, posting date, hidden state, or canonical URL behavior, run the search corpus described in [Search Quality Runbook](./search-quality-runbook.md).

Missing location, posting date, or remote fields must be certified by source fixtures. A parser may leave those fields blank only when a saved raw response proves the source omitted them, or adapter notes document why extracting them would be unsafe or require rejected extra fetches.

## May 8 Priority Order

Parser normalization is the current blocker. Fix `location_text`, `country`, `region`, `remote_type`, `posting_date`, `source_job_id`, and `last_seen_epoch` per ATS before search-index tuning. v1.5.14 expands the high-volume parser batch to `workday`, `bamboohr`, `taleo`, `applytojob`, `breezy`, `recruitee`, `icims`, and `applitrack`, then adds safe URL/title backfill and ATS quality auditing. v1.5.15 applies that backfill to production, fully rebuilds Meilisearch from Postgres, and marks pre-reindex search outbox rows processed to avoid duplicate worker indexing. v1.5.16 broadens stable URL source-id extraction and global location aliases for the next production backfill. Image work and build-cache cleanup are later tasks.

Current live production data-quality finding before v1.5.13: 722,591 active postings; 625,905 were missing `country`/`region`; 96,686 had `country`/`region`. After the v1.5.15 production backfill and Meili reindex, 725,071 visible rows remain indexed, 342,008 are still missing `country`, and 343,773 are still missing `region`. A May 8 pre-v1.5.16 audit still found high missing-source-id counts in ATS outside the first parser batch, especially `manatal`, `hrmdirect`, `pinpointhq`, `zoho`, `jobvite`, `greenhouse`, `smartrecruiters`, `teamtailor`, and `lever`; v1.5.16 adds parser/backfill source-id recovery for those URL shapes. Remaining geo/date gaps are mostly missing source evidence, especially iCIMS detail pages and Applitrack listings.

## Parser Tiers

| Tier | ATS keys | Parse rule | Fixture status |
| --- | --- | --- | --- |
| Direct JSON stable | `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `recruitee`, `bamboohr`, `teamtailor`, `freshteam`, `pinpointhq`, `recruitcrm`, `fountain`, `getro` | Prefer public JSON job-board endpoint, parse pagination before HTML fallback, cache response hash/metadata. | Strict parser-backed now: `pinpointhq`, `recruitcrm`, `fountain`. Normalized-only fixtures: `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `recruitee`, `bamboohr`. Pending: `teamtailor`, `freshteam`, `getro`. |
| Enterprise/direct | `workday`, `oracle`, `adp_myjobs`, `adp_workforcenow`, `paylocity`, `dayforcehcm`, `eightfold`, `saphrcloud`, `ultipro`, `pageup` | Extract tenant/site identifiers, prefer candidate API responses, normalize product-specific dates and locations. | Strict parser-backed now: `oracle`, `paylocity`, `adp_workforcenow`. Pending raw fixtures for the rest; `dayforcehcm` unsupported. |
| Embedded or semi-structured | `jobvite`, `icims`, `zoho`, `breezy`, `applicantpro`, `applytojob`, `theapplicantmanager`, `careerplug`, `talentreef`, `hirebridge`, `hrmdirect`, `isolvisolvedhire` | Extract embedded JSON first, then conservative DOM card parsing only when URL/title/company are reliable. | Normalized-only fixtures: `applytojob`, `breezy`, `hrmdirect`, `icims`, `zoho`. Raw parser fixtures pending for all. |
| Vendor-specific | `applicantai`, `gem`, `join`, `careerspage`, `manatal`, `hibob`, `sagehr`, `loxo`, `peopleforce`, `simplicant`, `rippling`, `careerpuck`, `talentlyft`, `talexio` | Use vendor-specific public payloads where stable; otherwise reject ambiguous postings. | Pending fixtures. |
| Public sector / education | `governmentjobs`, `usajobs`, `k12jobspot`, `schoolspring`, `calcareers`, `calopps`, `statejobsny`, `policeapp`, `jobaps`, `applitrack` | Preserve agency/school location fields, enforce polite pagination, avoid mixing aggregate board URLs with canonical apply URLs. | `applitrack` has normalized-only fixture coverage; raw parser fixtures are pending for all. |
| Brittle / high risk | `taleo`, `brassring` | Keep low confidence until fixtures prove stability; rate-limit heavily and reject ambiguous records. | Pending fixtures; keep under review. |

## Certification Gates

- Saved raw response fixture and expected normalized fixture for each ATS.
- Validation rejects missing URL, company, or title.
- Parser documents endpoint or URL pattern, pagination, date/location parsing, remote/hybrid handling, failure modes, confidence, and rate limit.
- Expected normalized fixtures include `location_text`, `country`, `region`, `remote_type`, `posting_date`/`posted_at`, `source_job_id`, and `last_seen_epoch`.
- Missing or nullable `location_text`, `country`, `region`, `remote_type`, or posting-date fields are explained by raw source fixtures, not only normalized output.
- `source_job_id` preserves the strongest source id when the raw response exposes one.
- `last_seen_epoch` is present for freshness and pruning.
- Cache key includes ATS key and company URL; posting key is canonical URL.
- New ATS cannot be enabled by default until raw fixture tests and production parity tests pass.

## Current Coverage Snapshot

- Configured ATS keys: 60.
- Normalized fixture-backed parser output: `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `recruitee`, `bamboohr`, `applytojob`, `breezy`, `hrmdirect`, `icims`, `zoho`, `applitrack`, `pinpointhq`, `recruitcrm`, `fountain`, `paylocity`, `oracle`, `adp_workforcenow`.
- Strict raw parser-backed adapters/tests: `adp_workforcenow`, `applitrack`, `applytojob`, `bamboohr`, `breezy`, `fountain`, `icims`, `oracle`, `paylocity`, `pinpointhq`, `recruitcrm`.
- Certification blocker: normalized fixtures are useful, but they do not prove raw ATS HTML/JSON parsing. Each source still needs raw-response fixtures before it is considered fully certified.
- Legacy fetch dispatcher gaps found: canonical `ashby` did not map to the legacy Ashby collector; the adapter now fetches as `ashbyhq`.
- Known unsupported configured source: `dayforcehcm` has metadata and is visible as an ATS, but no collector implementation exists yet. It is disabled by default for sync, and the adapter fails explicitly with `parser_adapter_not_implemented` if called.
- Parser attention should count typed parser errors only: `parser_validation`, `parser_parse`, `parser_normalize`, and `parser_adapter_not_implemented`. Fetch/network failures remain run errors but should not inflate parser attention.

## Wave 2 Certification Notes

| ATS | Status | Confidence | Parser attention notes |
| --- | --- | --- | --- |
| `applytojob` | Fixture-backed for parsed list and legacy Resumator-style URL/location output. | Medium; HTML class names are still semi-structured. | Missing title or URL is a parser bug; empty result after a non-OK request is fetch/network. |
| `breezy` | Fixture-backed for `/p/` posting cards, department, location, and posted date output. | Medium; card HTML parsing is conservative. | Missing `h2` title or `/p/` URL is parser attention; portal fetch failure is network. |
| `hrmdirect` | Fixture-backed for `reqitem` rows with city/state, department, date, and absolute employment URL. | Medium-low; row class and cell classes are brittle. | Empty rows after successful fetch can be parser drift; request failure is network. |
| `icims` | Fixture-backed for iCIMS job card/fallback output with query-string canonical URL and remote location. | Medium-low; iframe and pagination discovery remain brittle. | Bad job-card extraction is parser; iframe/page fetch failure is network. |
| `zoho` | Fixture-backed for hidden jobs payload output with department and built Careers URL. | Medium; hidden JSON payload is stable when present. | JSON parse failure or missing job id is parser; missing careers page is network/source. |
| `applitrack` | Fixture-backed for `applyFor(jobId, category, specialty)` output. | Medium-low; v1.5.13 extracts same-row location/date only when the listing exposes them. | No `applyFor` matches after successful `Output.asp` fetch is parser drift; HTTP failure is network. |

## Wave 3 Certification Notes

| ATS | Status | Confidence | Parser attention notes |
| --- | --- | --- | --- |
| `pinpointhq` | Fixture-backed from `postings.json` API response through parser and normalizer. | Medium; direct JSON fields are stable but location/departments can be sparse. | Missing `url` or `path` after a successful API response is parser/source drift. |
| `recruitcrm` | Fixture-backed from public jobs API response through parser and normalizer. | Medium; remote flag and slug fallback are covered. | Missing `data.jobs`, missing slug/url, or bad date fields are parser/source drift. |
| `fountain` | Fixture-backed from board `.json` openings response. | Medium; direct JSON is clear, but board URL parsing depends on `/c/{company}/...` path shape. | Empty `openings` with HTTP 200 is source/parser attention; HTTP failure remains fetch. |
| `paylocity` | Fixture-backed from extracted page-data JSON `Jobs` array. | Medium-low; source is direct JSON embedded in a page, and collector requires `PublishedDate`. | Missing `Jobs` or `JobId` is parser/source drift; landing page fetch is network. |
| `oracle` | Fixture-backed from CandidateExperience requisition API response. | Medium-low; parser handles nested `requisitionList`, but tenant/site/language discovery remains brittle. | Missing `requisitionList`, `Id`, `Title`, or `PostedDate` is parser/source drift. |

## Wave 3 Deferred Blockers

- `teamtailor`: current collector parses HTML job cards, not the Teamtailor API. Certification should wait for saved board HTML or a direct API endpoint fixture; expected output is title, canonical job URL, department, and location from metadata spans.
- `getro`: current collector extracts jobs from `__NEXT_DATA__` embedded in HTML. It is usable but not direct JSON; certification should include a saved Next.js page fixture and expected `initialState.jobs.found` output.
- `workday`: current collector combines fetch, pagination, and a same-day `postedOn` filter inside `collectTodayPostingsForWorkdayCompany`. Before certifying, extract a pure Workday parser for CXS `jobPostings` pages so fixtures are date-stable.
- `pageup`: current collector parses AJAX result HTML and then fetches each details page to confirm posting date. Certification needs two-part fixtures: search results HTML plus detail page HTML.

## Research Anchors

- Greenhouse Job Board API: https://developer.greenhouse.io/job-board.html
- Ashby public job posting API: https://developers.ashbyhq.com/docs/public-job-posting-api
- Lever postings API: https://github.com/lever/postings-api
- Meilisearch search/indexing: https://github.com/meilisearch/meilisearch
- pg-boss queueing on Postgres: https://github.com/timgit/pg-boss

## Expansion Priority

Wave 1 candidates must be certified before enabling: Personio XML feed, Trakstar Hire / Recruiterbox frontend API, and JobScore feed API. Wave 2 candidates are Workable, Bullhorn, and Comeet after public token/config handling is reviewed. Remote/job-board aggregators such as Remotive, Himalayas, and Arbeitnow must stay separate from direct ATS adapters.

Detailed certification requirements live in [ATS Source Certification](./ats-source-certification.md). Data freshness and pruning rules live in [Data Retention](./data-retention.md).
