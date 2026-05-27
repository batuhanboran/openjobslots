# Vendor-Specific ATS Certification Worksheet

This lane covers the vendor-specific ATS tier from `server/ingestion/adapter-metadata.js`. Legacy collector/discovery/fetch orchestration may still live in `server/index.js`, but pure parser implementations now belong under `server/ingestion/sources/<ats>/parse.js`, then normalize through `server/ingestion/posting.js`. Do not certify any row below until a saved raw source fixture and normalized expectation prove the field decisions.

Current raw fixture status for every ATS in this file: pending. There are no saved `server/ingestion/fixtures/{ats}-direct.json` or `{ats}-postings.json` fixtures for this tier yet. `manatal` has inline parser smoke coverage in `server/ingestion/direct-parser-fixtures.test.js`, but that is not a saved raw fixture.

## Cross-Tier Decisions

- Geo: keep source location text as `location_text`; let the normalizer derive `country` and `region` only from explicit source country fields or recognizable location text. If the source only provides a site name or broad label, fixture evidence must explain null `country`/`region`.
- Date: do not invent posting dates. HTML-only boards that omit dates should leave `posting_date` and `posted_at` null; API boards should map the strongest published/posted field.
- Remote: map explicit workplace/location signals through normalizer values (`remote`, `hybrid`, `onsite`, otherwise `unknown`). Remote-looking title/location text is allowed as a weak fallback only when the raw fixture proves it came from the source.
- Source id: preserve explicit IDs (`id`, `hash`, `reference`, `data-job-id`) before falling back to URL-derived IDs. If a current parser drops an ID, certification should add a parser test before enabling.
- Freshness: normalized fixtures must assert `last_seen_epoch` through adapter normalization, even when source dates are null.

## ATS Records

### `applicantai`

- Source endpoint: public HTML board at `https://applicantai.com/{slug}` from `parseApplicantAiCompany` and `fetchApplicantAiCareersPage`.
- Parser path: `server/index.js` `collectPostingsForApplicantAiCompany` -> `parseApplicantAiPostingsFromHtml`; normalization path is `server/ingestion/adapters.js` -> `normalizePosting`.
- Raw fixture status: pending saved HTML fixture.
- Field decisions: geo comes from `<small class="text-muted">`; date is null; remote is inferred only from location/title text; source id should be extracted from the final numeric path segment, but the current parser does not set `source_job_id`.
- Tests needed: export or isolate the parser; add `applicantai-direct.json` with valid and invalid hrefs; assert title/company/canonical URL validation, numeric source id, nullable date, geo normalization, remote/unknown cases, and malformed-link rejection.

### `gem`

- Source endpoint: GraphQL batch POST to `https://jobs.gem.com/api/public/graphql/batch` with `JobBoardTheme` and `JobBoardList` operations from `fetchGemJobBoard`.
- Parser path: `server/index.js` `collectPostingsForGemCompany` -> `parseGemPostingsFromBatchResponse`; normalization path is `server/ingestion/adapters.js` -> `normalizePosting`.
- Raw fixture status: pending saved GraphQL response fixture.
- Field decisions: geo comes from `locations[].name` or `city` plus `isoCountry`; date is null because the current query does not request a posted field; remote comes from `job.locationType` or remote-looking location text; source id should use decoded numeric GraphQL `id`, `extId`, or URL fallback, but the current parser only embeds it in the URL.
- Tests needed: add batch fixture with encoded ID, `extId`, remote-only, multi-location, and empty postings cases; assert source id preservation, department mapping, country/region, nullable date, pagination/no-pagination behavior, and GraphQL shape drift.

### `join`

- Source endpoint: public company HTML at `https://join.com/companies/{companySlug}` from `fetchJoinCompanyPage`, reading embedded Next.js data.
- Parser path: `server/index.js` `collectPostingsForJoinCompany` -> `extractJoinNextDataJsonFromHtml` -> `parseJoinPostingsFromNextData`; normalization path is `server/ingestion/adapters.js` -> `normalizePosting`.
- Raw fixture status: pending saved HTML/Next.js fixture.
- Field decisions: geo should come from JOIN location fields in `initialState.jobs.items`; date should use any source-published field if present, otherwise null; remote should use explicit workplace/remote fields before text; source id should use JOIN job id from state/URL, but this is not fixture-proven.
- Tests needed: add fixture for current `__NEXT_DATA__` state plus alternate state keys; cover remote, hybrid, onsite, multi-location, missing location, missing date, source id, and invalid state rejection.

### `careerspage`

- Source endpoint: public HTML board at `https://careerspage.io/{companySlug}` from `fetchCareerspageBoardPage`.
- Parser path: `server/index.js` `collectPostingsForCareerspageCompany` -> `parseCareerspagePostingsFromHtml`; normalization path is `server/ingestion/adapters.js` -> `normalizePosting`.
- Raw fixture status: pending saved HTML fixture.
- Field decisions: geo comes from the location icon block; date is null; remote comes from location/employment text only; source id should be `/job/{id}` or last stable URL part via normalization/backfill, but current parser does not set it directly.
- Tests needed: add fixture for absolute and relative links, employment/location blocks, remote text, no-date output, source-id extraction, and invalid template/partial card rejection.

### `manatal`

- Source endpoint: landing page at `{tenant}.careers-page.com/` or `www.careers-page.com/{domainSlug}/`, then API GET `https://www.careers-page.com/api/v1.0/c/{domainSlug}/jobs/?page={n}&page_size=50&ordering=-is_pinned_in_career_page,-last_published_at`; HTML fallback parses the landing page.
- Parser path: `server/index.js` `collectPostingsForManatalCompany` -> `extractManatalPageRuntimeConfig` -> `fetchManatalJobsApiPage` -> `parseManatalPostingsFromApi`, with fallback `parseManatalPostingsFromHtml`; normalization path is `server/ingestion/adapters.js` -> `normalizePosting`.
- Raw fixture status: pending saved API and fallback HTML fixtures; inline smoke coverage exists for one API payload only.
- Field decisions: geo comes from `location_display` or `city/state/country`; date uses `last_published_at`, `published_at`, `posting_date`, `posted_date`, `updated_at`, or `created_at`; remote comes from location/title unless future API fields expose workplace type; source id uses `/job/{hash}`, then `id`/`hash`.
- Tests needed: add paged API fixture with `next`/`count`, no-results fallback HTML, hash/id variants, country normalization, nullable date, source id, template-card rejection, and API 404 pagination stop behavior.

### `hibob`

- Source endpoint: tenant board on `https://{tenant}.careers.hibob.com/...`, then API GET `https://{tenant}.careers.hibob.com/api/job-ad` from `fetchHibobJobBoard`.
- Parser path: `server/index.js` `collectPostingsForHibobCompany` -> `parseHibobPostingsFromApi`; normalization path is `server/ingestion/adapters.js` -> `normalizePosting`.
- Raw fixture status: pending saved board/API fixture pair.
- Field decisions: geo currently uses `site` first and `country` second, so country-only fixtures are needed; date uses `publishedAt`; remote is only text-derived unless API exposes a workplace flag; source id should be `item.id`, but current parser does not set `source_job_id` or `id`.
- Tests needed: add fixture with `jobAdDetails[]`, `id`, `jobUrl` fallback, `site`, `country`, `publishedAt`, closed/empty response, and explicit assertion that `item.id` survives normalization.

### `sagehr`

- Source endpoint: public vacancies HTML at `https://talent.sage.hr/{companySlug}/vacancies` from the source-local `fetchList`.
- Parser path: source-local registry module `server/ingestion/sources/sagehr/index.js` -> `extractSagehrCompanyNameFromHtml` -> `parseSagehrPostingsFromHtml`; `sourceCollectors.js` dispatches SageHR aliases through `collectPostingsForRegistryPilotCompany(company, "sagehr")`.
- Raw fixture status: pending saved HTML fixtures for open and restricted/403 layouts; collector regression coverage proves allowed 403-with-layout behavior.
- Field decisions: geo comes from `.location`; date is null; remote comes from location/title text; source id should be URL-derived from `/jobs/{id}` but current parser does not set it directly.
- Tests needed: add fixtures for normal 200, allowed 403-with-layout, empty/blocked 403, location present/missing, source-id URL extraction, nullable date, and class drift.

### `loxo`

- Source endpoint: public HTML board at `https://app.loxo.co/{companySlug}` from `fetchLoxoJobsPage`.
- Parser path: `server/index.js` `collectPostingsForLoxoCompany` -> `parseLoxoPostingsFromHtml`; normalization path is `server/ingestion/adapters.js` -> `normalizePosting`.
- Raw fixture status: pending saved HTML fixture.
- Field decisions: geo comes from `.job-location`; date comes from `.job-date`; remote comes from location/title text; source id should be URL-derived from `/job/{id}` but current parser does not set it directly.
- Tests needed: add fixture with date, location, remote text, detail URL, duplicate URL rejection, source-id extraction, and coverage that fetch uses the central rate-limit wrapper rather than direct fetch.

### `peopleforce`

- Source endpoint: public careers HTML at `https://{tenant}.peopleforce.io/careers` from the source-local `fetchList`.
- Parser path: source-local registry module `server/ingestion/sources/peopleforce/index.js` -> `parsePeopleforcePostingsFromHtml`; `sourceCollectors.js` dispatches Peopleforce aliases through `collectPostingsForRegistryPilotCompany(company, "peopleforce")`.
- Raw fixture status: pending saved HTML fixtures for open and closed sites; collector regression coverage proves public careers HTML parsing and rate-limit wrapper dispatch.
- Field decisions: geo comes from the small neutral text near each card; date is null; remote comes from location/title text; source id should be URL-derived from `/careers/v/{id}` but current parser does not set it directly.
- Tests needed: add open-site, closed-site, malformed-card, missing-location, source-id extraction, nullable date, and remote/unknown fixtures; also cover rate-limit wrapper use because current fetch path is direct.

### `simplicant`

- Source endpoint: tenant HTML root at `https://{tenant}.simplicant.com/` for `/jobs` or `/leads` boards from `fetchSimplicantJobsPage`.
- Parser path: `server/index.js` `collectPostingsForSimplicantCompany` -> `parseSimplicantPostingsFromHtml`; normalization path is `server/ingestion/adapters.js` -> `normalizePosting`.
- Raw fixture status: pending saved HTML fixture.
- Field decisions: geo comes from `.job-subtitle`; date is null; remote comes from location/title text; source id should come from the `/jobs/.../detail` path, but current parser does not set it directly.
- Tests needed: add fixtures for `/jobs` and `/leads`, strict `/detail` URLs, malformed cards, no-results page, source-id extraction, nullable date, geo, and remote text.

### `rippling`

- Source endpoint: API GET `https://ats.rippling.com/api/v2/board/{companySlug}/jobs`, with optional `page` and `pageSize` query fallback from `fetchRipplingJobsPage`.
- Parser path: `server/index.js` `collectPostingsForRipplingCompany` -> `parseRipplingPostingsFromApi`; normalization path is `server/ingestion/adapters.js` -> `normalizePosting`.
- Raw fixture status: pending saved API fixture.
- Field decisions: geo comes from `locations[]` formatted as name or city/state/country; date uses `postedAt`, `createdAt`, `updatedAt`, or `publishedAt`; remote uses `workplaceType` plus location/title text; source id should be `item.id`, but current parser only uses it to build the URL.
- Tests needed: add fixture with `items[]`, `totalPages`, explicit `url`, URL fallback from `id`, multiple locations, workplace type, department, source id preservation, and pagination stop conditions.

### `careerpuck`

- Source endpoint: API GET `https://api.careerpuck.com/v1/public/job-boards/{boardSlug}` from `fetchCareerpuckJobBoard`.
- Parser path: `server/index.js` `collectPostingsForCareerpuckCompany` -> `parseCareerpuckPostingsFromApi`; normalization path is `server/ingestion/adapters.js` -> `normalizePosting`.
- Raw fixture status: pending saved API fixture.
- Field decisions: geo comes from `job.location`; date uses `postedAt`; remote is text-derived unless the API exposes a workplace flag; source id should use an explicit job id if present or URL fallback, but current parser does not set it directly. `publicUrl` wins over `applyUrl`, and `apply_url` is not preserved separately.
- Tests needed: add API fixture for public filtering, `publicUrl`/`applyUrl` fallback, department fields, source id, remote/workplace flags if present, missing geo/date evidence, and any pagination shape the API exposes.

### `talentlyft`

- Source endpoint: landing page at `https://{subdomain}.talentlyft.com/`, then fragment GET `{websiteUrl}/JobList/?layoutId={layoutId}&websiteUrl={websiteUrl}&themeId={themeId}&language={language}&subdomain={subdomain}&page={page}&pageSize=20&contains=` from `fetchTalentlyftJobListFragment`.
- Parser path: `server/index.js` `collectPostingsForTalentlyftCompany` -> `extractTalentlyftInitialConfig` -> `parseTalentlyftPostingsFromFragment`; normalization path is `server/ingestion/adapters.js` -> `normalizePosting`.
- Raw fixture status: pending saved landing and fragment fixtures.
- Field decisions: geo comes from `.jobs__box__text`; date is null; remote comes from location/title text; source id should be `data-job-id` or URL-derived id, but current parser does not set `source_job_id`.
- Tests needed: add landing runtime config fixture, paged fragment fixture, `data-job-id` preservation, total page extraction, remote/missing-location cases, nullable date, and duplicate URL rejection.

### `talexio`

- Source endpoint: API GET `https://{subdomain}.talexio.com/api/jobs?search=&sortBy=relevance&page={page}&limit=10` from `server/ingestion/sources/talexio/index.js`.
- Parser path: source-local registry module `server/ingestion/sources/talexio/index.js` -> `parseTalexioPostingsFromApi`; normalization path is source-local contract `normalize`. `sourceCollectors.js` only dispatches through registry.
- Fixtures now cover API list rows, expected normalized rows, invalid-shape validation, source ids from vacancy `id`, country normalization, and remote/onsite examples.
- Raw fixture status: pending saved API fixture.
- Field decisions: geo comes from `workLocation` plus `country`; date uses `publishDate`; remote should use any source workplace/remote flag if found, otherwise location/title text; source id should prefer `id` or `reference`, but current parser stores `reference` only and relies on URL/query fallback.
- Tests needed: add fixture with `vacancies[]`, `totalVacancies`, `id`, `reference`, `publishDate`, country normalization, remote/hybrid fields if present, missing URL fallback, pagination stop conditions, and source id preservation.

## Required Fixture/Test Work

- Add saved raw fixtures under `server/ingestion/fixtures/` for each ATS, preferring `*-direct.json` when the source is JSON/API and `*-postings.json` or a new raw HTML fixture schema when the source is HTML.
- Add or update pure parser functions in `server/ingestion/sources/<ats>/parse.js`; keep fetch/network behavior out of parser fixture tests.
- Extend `server/ingestion/direct-parser-fixtures.test.js` or add a vendor-specific parser fixture test file that asserts normalized `source_job_id`, `canonical_url`, `apply_url`, `location_text`, `country`, `region`, `remote_type`, `posted_at`, `last_seen_epoch`, `parser_version`, and `raw_hash`.
- Add negative parser tests for missing title, missing company, missing canonical URL, malformed cards, template links, duplicate URLs, and source responses that omit optional geo/date/remote fields.
- Run adapter normalization plus search parity tests after field behavior changes so Postgres and Meilisearch filters keep matching the certified fields.
