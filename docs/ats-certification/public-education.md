# Public Sector and Education ATS Certification Lane

This lane covers `governmentjobs`, `usajobs`, `k12jobspot`, `schoolspring`, `calcareers`, `calopps`, `statejobsny`, `policeapp`, `jobaps`, and `applitrack`.

Scope for this pass is documentation only. Do not change `server/index.js` while executing this lane; use this file to drive later parser extraction, raw fixture capture, and read-only production audits.

## Current Implementation Map

| ATS | Source endpoint | Parser path | Raw fixture status | Geo decision | Date decision | Remote decision | Source-id decision | Tests needed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `governmentjobs` | `GET https://www.governmentjobs.com/jobs` with AJAX query params; first request uses `keyword`, `location`, `daysposted=1`, `isFiltered=true`, `_`; pages use `page`, `daysPosted=1`, transfer/promotional flags, `_`. | `server/index.js`: `fetchGovernmentJobsViewHtml`, `extractGovernmentJobsViewHtmlFromResponse`, `extractGovernmentJobsLastPage`, `parseGovernmentJobsPostingsFromViewHtml`, `collectPostingsForGovernmentJobsDynamic`. Normalization flows through `server/ingestion/adapters.js` and `server/ingestion/posting.js`. | Pending. No `server/ingestion/fixtures/governmentjobs-direct.json` or normalized fixture exists. | Keep `job-location` text exactly as `location_text`; normalize country/region from that text only. Null is acceptable when `job-location` is absent in the saved HTML. | Current parser invents `Posted Today`. Certification should stop inventing dates and parse an explicit source date only if the raw view contains one; otherwise store null and rely on `last_seen_epoch`. | No explicit remote field in current parser. Let normalizer infer `remote_type` from title/location text; require fixture cases for remote text and ordinary city/state. | Preserve `/jobs/{id}` from canonical URL as `source_job_id`. Current parser does not set it directly, but `extractSourceIdFromPostingUrl` supports GovernmentJobs URL ids for backfill/normalization paths. | Add direct saved AJAX JSON/HTML fixture with `view1`, pagination fixture for `page=2`, parser fixture for title/company/location/url, no invented date assertion, URL-id assertion, duplicate URL rejection, and missing `view1`/non-job item rejection. |
| `usajobs` | Landing token: `GET https://www.usajobs.gov/Search/Results?hiringPath=public&s=startdate&sd=desc&p=1`; search: `POST https://www.usajobs.gov/Search/ExecuteSearch` with `RequestVerificationToken`, `HiringPath=["public"]`, sort by `startdate`, bounded page/per-page. | `server/index.js`: `extractUsajobsOpenDate`, `parseUsajobsPostingsFromPayload`, `collectPostingsForUsajobsDynamic`. Normalization flows through `server/ingestion/adapters.js` and `server/ingestion/posting.js`. | Pending. No `server/ingestion/fixtures/usajobs-direct.json` or normalized fixture exists. | Use `LocationName`/`Location` as `location_text`; normalize country/region from text. Add fixture coverage for `Remote job`/country-wide/federal multi-location strings before certifying sparse geo. | Parse open date from `DateDisplay` text shaped like `Open MM/DD/YYYY to ...`; null if no explicit open date. | USAJobs has remote/work-schedule signals in payloads, but current parser does not carry them. Certification should map exposed remote fields when present and otherwise infer from location/title only. | Map `DocumentID` to `source_job_id` and use it to build `https://www.usajobs.gov/job/{DocumentID}` when `PositionURI` is absent. Current parser uses `DocumentID` for URL fallback but does not emit `source_job_id`. | Add token-missing test, direct `ExecuteSearch` JSON fixture, `DocumentID` source-id assertion, `PositionURI` fallback assertion, `DateDisplay` parse/null tests, remote payload field test, pagination stop at `Pager.NumberOfPages`, and validation rejection for rows missing title/agency/url. |
| `k12jobspot` | `POST https://api.k12jobspot.com/api/Jobs/Search` with body `{ searchPhrase: "", filters: [...], pageStartIndex, pageEndIndex }`; collector advances windows while postings remain within 24h. | `server/index.js`: `parseK12jobspotPostingsFromPayload`, `fetchK12jobspotSearchPayload`, `collectPostingsForK12jobspotDynamic`. Normalization flows through `server/ingestion/adapters.js` and `server/ingestion/posting.js`. | Pending. No `server/ingestion/fixtures/k12jobspot-direct.json` or normalized fixture exists. | Build `location_text` from `location.city`, `location.regionCode`, and `location.postalCode`. Certification should add country normalization for US state/postal rows and prove null when the object is absent. | Use `postedDate`; collector filters by `shouldStorePostingByDate`. Null only if source omits `postedDate`, with fixture evidence. | No explicit remote mapping currently. Infer from title/location until a source remote field is proven in the raw API. | Emit `job.id` as `source_job_id`; current parser uses it for URL construction but does not set it directly. | Add direct API fixture with at least two jobs, source-id assertion, US city/state/postal geo assertion, null-location fixture, date filter boundary test, duplicate id/url rejection, and empty `jobs` stop test. |
| `schoolspring` | `GET https://api.schoolspring.com/api/Jobs/GetPagedJobsWithSearch?...&page={page}&size={size}&sortDateAscending=false`; collector advances page while rows remain within 24h. | `server/index.js`: `parseSchoolspringPostingsFromPayload`, `fetchSchoolspringSearchPayload`, `collectPostingsForSchoolspringDynamic`. Normalization flows through `server/ingestion/adapters.js` and `server/ingestion/posting.js`. | Pending. No `server/ingestion/fixtures/schoolspring-direct.json` or normalized fixture exists. | Use `job.location` as source `location_text`; normalize country/region from text. Add fixtures for city/state, remote, and missing location. | Use `displayDate`; date format is not proven. Certification must lock expected normalized date behavior for absolute, relative, and blank display dates. | No explicit remote mapping currently. Infer from `location`/title unless raw API proves a remote field. | Emit `job.jobId` as `source_job_id`; current parser uses it for URL construction but does not set it directly. | Add direct `value.jobsList` fixture, `jobId` source-id assertion, `displayDate` format tests, pagination/empty-list stop test, duplicate URL rejection, and validation rejection for missing title/employer/url. |
| `calcareers` | Landing: `GET https://calcareers.ca.gov/CalHRPublic/Search/JobSearchResults.aspx`; search and pager postbacks: `POST` same endpoint with ASP.NET hidden fields and event targets such as search button, row-count dropdown, and pager controls. | `server/index.js`: `extractCalcareersHiddenInputs`, `extractCalcareersPagerTargets`, `parseCalcareersPostingsFromHtml`, `buildCalcareersPostPayload`, `collectPostingsForCalcareersDynamic`. Normalization flows through `server/ingestion/adapters.js` and `server/ingestion/posting.js`. | Pending. No `server/ingestion/fixtures/calcareers-direct.json` or normalized fixture exists. | Use the source `Location:` field as `location_text`; normalize as California/United States only when text proves it. Preserve department separately as company/industry context. | Use `Publish Date` from the card `<time>` field. Null only if saved card lacks a publish date. | No explicit remote mapping currently. Infer from location/title; add fixture for telework/remote text if source exposes it. | Extract `JobControlId` from the canonical URL or emit card `Job Control` directly as `source_job_id`. Current parser matches the control number but does not emit it. | Add landing hidden-field fixture, postback results fixture, pager target fixture, `JobControlId` source-id assertion, publish-date assertion, location/country assertion, markup-order drift test, and no-results page test. |
| `calopps` | `GET https://www.calopps.org/job-search-list`; follows `<li class="next">` links up to `maxPages`. | `server/index.js`: `inferCaloppsCompanyFromPath`, `parseCaloppsPostingsFromHtml`, `extractCaloppsNextPageUrl`, `collectPostingsForCaloppsDynamic`. Normalization flows through `server/ingestion/adapters.js` and `server/ingestion/posting.js`. | Pending. No `server/ingestion/fixtures/calopps-direct.json` or normalized fixture exists. | Current parser uses the region cell as `location`. Keep that as `location_text`; normalize country/region only when the region/city text proves a country. | Current parser uses `new Date().toISOString()`, which invents a posting date. Certification should stop this and leave posting date null unless source exposes an actual posted/open date; close date must stay separate. | Use job type/category only if they explicitly say remote/hybrid; otherwise infer from title/location. Do not treat `close_date` as remote evidence. | Preserve `/job-{id}` as `source_job_id`; current parser sets `id` from the URL, which the normalizer can use. | Add raw list-page fixture, next-page fixture, no invented date assertion, close-date separate-field assertion, `/job-{id}` source-id assertion, agency-from-path assertion, and malformed row rejection. |
| `statejobsny` | `GET https://www.statejobsny.com/public/vacancyTable.cfm?searchResults=yes&minDate={yesterday}&maxDate={tomorrow}`; dynamic date window built at runtime. | `server/index.js`: `formatStatejobsnyDate`, `buildStatejobsnyWindowUrl`, `parseStatejobsnyPostingsFromHtml`, `collectPostingsForStatejobsnyDynamic`. Normalization flows through `server/ingestion/adapters.js` and `server/ingestion/posting.js`. | Pending. No `server/ingestion/fixtures/statejobsny-direct.json` or normalized fixture exists. | Use column 6 location text as `location_text`; normalize country/region from NY/United States evidence. Add fixture coverage for multi-county and statewide rows. | Use column 3 as posting date. Certification should prove column position and normalized epoch behavior. | No explicit remote mapping currently. Infer from location/title only. | Extract `id` from `VacancyDetailsView.cfm?id={id}` or set a `vacancyId`; current parser does not emit it directly. | Add dated URL builder test with fixed clock, raw table fixture, column-index assertion, vacancy id source-id assertion, multi-location geo test, malformed row rejection, and empty table test. |
| `policeapp` | `GET https://www.policeapp.com/jobs/urlrewrite_jobpostings/jobResultsAjax.ashx?j=0&r=50&s=0&p=0`; current implementation fetches only the first result page. | `server/index.js`: `normalizePoliceappJobUrl`, `parsePoliceappPostingsFromHtml`, `collectPostingsForPoliceappDynamic`. Normalization flows through `server/ingestion/adapters.js` and `server/ingestion/posting.js`. | Pending. No `server/ingestion/fixtures/policeapp-direct.json` or normalized fixture exists. | Current parser sets location null. Certification should either parse department/location from result cards if present or prove null with saved AJAX HTML. | Current parser invents `Posted Today`. Certification should stop inventing dates and parse deadline/posting date only if the source exposes a true posting date; application deadlines must not become posting dates. | No explicit remote mapping currently; police postings are generally onsite, but parser should only infer from source text. Unknown is acceptable when no field exists. | Extract trailing numeric URL path as `source_job_id`; current parser does not set it directly. | Add raw AJAX HTML fixture, normalized URL rewrite fixture, pagination strategy test or explicit first-page-only risk note, no invented date assertion, deadline-not-posting-date assertion, source-id assertion, and invalid href rejection. |
| `jobaps` | `GET {agency}.jobapscloud.com/...` career page; final URL must remain on `.jobapscloud.com`. | `server/index.js`: `parseJobApsCompany`, `fetchJobApsCareersPage`, `parseJobApsPostingsFromHtml`, `collectPostingsForJobApsCompany`. Normalization flows through `server/ingestion/adapters.js` and `server/ingestion/posting.js`. | Pending. No `server/ingestion/fixtures/jobaps-direct.json` or normalized fixture exists. | Use `td.Locs` as `location_text`; normalize country/region from city/state text. Keep department and salary as supplemental fields. | Current parser sets posting date null. Keep null unless source fixture proves an explicit posting/open date in the row or detail page. | No explicit remote mapping currently. Infer from title/location only. | Current parser emits `external_id` from the `JobNum` link text; normalizer maps `external_id` to `source_job_id`. Certification should also cover URL `JobNum` query extraction. | Add raw careers-page fixture, `JobTitle`/`JobNum` row parser test, `external_id` to `source_job_id` assertion, ignored-title assertions for applicant profile/application-on-file rows, redirect-host rejection test, location geo test, and null date proof. |
| `applitrack` | `GET {siteRoot}/jobpostings/Output.asp?all=1`; optional bounded detail fetch from `{siteRoot}/default.aspx?JobID={id}` when list row lacks location/date. | `server/index.js`: `normalizeApplitrackUrl`, `parseApplitrackPostings`, `extractApplitrackDetailFields`, `fetchApplitrackDetailFields`, `collectPostingsForApplitrackCompany`. Normalization flows through `server/ingestion/adapters.js` and `server/ingestion/posting.js`. | Partial. `server/ingestion/fixtures/applitrack-postings.json` is normalized-only and an inline parser regression exists in `server/ingestion/direct-parser-fixtures.test.js`; no saved `applitrack-direct.json` raw `Output.asp`/detail fixture exists. `adapter-metadata.js` still reports parser fixture status as normalized-only. | Prefer same-row location from `Output.asp`; if missing, bounded detail fetch can fill labeled `Location`, `School`, `Site`, `Campus`, `Work Location`, or `Job Location`. Null is acceptable only when list and detail fixtures omit it or the detail fetch budget rejects extra load. | Parse same-row `MM/DD/YYYY` or month-name dates; detail parser can use labeled date fields. Do not infer from current visibility. | Infer remote from row/detail location text such as remote/virtual/telework/work from home. Unknown is acceptable with fixture proof. | `applyFor('{job_id}', ...)` is the strongest id and current parser emits it as `source_job_id`; canonical URL is `default.aspx?JobID={id}`. | Add saved `applitrack-direct.json` for `Output.asp`, paired detail fixture for missing list fields, detail fetch budget test, same-row date/location tests, remote detail test, duplicate `applyFor` rejection, and status alignment test for parser fixture metadata. |

## Cross-Lane Test Shape

Each ATS in this lane needs both a direct raw fixture and a normalized expected fixture. Prefer `server/ingestion/fixtures/{ats}-direct.json` for raw source responses that can be run through an exported pure parser. Use `server/ingestion/fixtures/{ats}-postings.json` only to prove legacy normalized posting shape when the parser is not yet exported.

Minimum assertions for every ATS:

- `validatePosting(normalized).ok === true` for each expected row.
- Missing title, company, or canonical URL is rejected.
- `source_job_id` is populated when the raw source exposes an id in payload, URL, or row text.
- `location_text`, `country`, and `region` are either populated from fixture evidence or deliberately blank with fixture evidence.
- `posting_date`/`posted_at_epoch` are populated only from explicit source dates.
- `remote_type` is `remote`, `hybrid`, `onsite`, or `unknown` based on fixture evidence, not source stereotypes.
- Duplicate URL/id rows collapse deterministically.
- Pagination stops on empty pages, stale date boundaries, configured page limits, or explicit last-page metadata.

## Read-Only SQL Audit Probes

Run these only against a read replica or during an approved read-only audit window. They do not mutate data.

### Group Health

```sql
SELECT
  ats_key,
  count(*) FILTER (WHERE hidden = false) AS active,
  count(*) FILTER (WHERE hidden = false AND coalesce(location_text, '') = '') AS blank_location_text,
  count(*) FILTER (
    WHERE hidden = false
      AND coalesce(location_text, '') <> ''
      AND (coalesce(country, '') = '' OR coalesce(region, '') = '')
  ) AS has_location_but_missing_geo,
  count(*) FILTER (WHERE hidden = false AND (coalesce(country, '') = '' OR coalesce(region, '') = '')) AS missing_geo,
  count(*) FILTER (WHERE hidden = false AND (posting_date IS NULL OR btrim(posting_date) = '')) AS missing_date,
  count(*) FILTER (WHERE hidden = false AND posted_at_epoch IS NULL) AS missing_posted_at_epoch,
  count(*) FILTER (
    WHERE hidden = false
      AND (remote_type IS NULL OR btrim(remote_type) = '' OR remote_type = 'unknown')
  ) AS unknown_remote,
  count(*) FILTER (WHERE hidden = false AND coalesce(source_job_id, '') = '') AS missing_source_id
FROM postings
WHERE ats_key = ANY(ARRAY[
  'governmentjobs',
  'usajobs',
  'k12jobspot',
  'schoolspring',
  'calcareers',
  'calopps',
  'statejobsny',
  'policeapp',
  'jobaps',
  'applitrack'
]::text[])
GROUP BY ats_key
ORDER BY missing_geo DESC, missing_source_id DESC, active DESC;
```

### Problem Samples

```sql
SELECT
  ats_key,
  source_job_id,
  title,
  company,
  canonical_url,
  location_text,
  country,
  region,
  remote_type,
  posting_date,
  posted_at_epoch,
  last_seen_epoch
FROM postings
WHERE hidden = false
  AND ats_key = ANY(ARRAY[
    'governmentjobs',
    'usajobs',
    'k12jobspot',
    'schoolspring',
    'calcareers',
    'calopps',
    'statejobsny',
    'policeapp',
    'jobaps',
    'applitrack'
  ]::text[])
  AND (
    coalesce(source_job_id, '') = ''
    OR coalesce(location_text, '') = ''
    OR coalesce(country, '') = ''
    OR coalesce(region, '') = ''
    OR remote_type IS NULL
    OR remote_type = 'unknown'
    OR posting_date IS NULL
    OR btrim(posting_date) = ''
    OR posted_at_epoch IS NULL
  )
ORDER BY ats_key, last_seen_epoch DESC NULLS LAST
LIMIT 200;
```

### URL Source-Id Recovery Candidates

```sql
SELECT
  ats_key,
  canonical_url,
  source_job_id,
  CASE
    WHEN ats_key = 'governmentjobs' THEN substring(canonical_url FROM '/jobs/([0-9]+)')
    WHEN ats_key = 'usajobs' THEN substring(canonical_url FROM '/job/([0-9]+)')
    WHEN ats_key = 'k12jobspot' THEN substring(canonical_url FROM '/Job/Detail/([^/?#]+)')
    WHEN ats_key = 'schoolspring' THEN substring(canonical_url FROM '[?&]jid=([0-9]+)')
    WHEN ats_key = 'calcareers' THEN substring(canonical_url FROM '[?&]JobControlId=([0-9]+)')
    WHEN ats_key = 'calopps' THEN substring(canonical_url FROM '/job-([0-9]+)')
    WHEN ats_key = 'statejobsny' THEN substring(canonical_url FROM '[?&]id=([0-9]+)')
    WHEN ats_key = 'policeapp' THEN substring(canonical_url FROM '/([0-9]+)/?$')
    WHEN ats_key = 'jobaps' THEN COALESCE(
      substring(canonical_url FROM '[?&]JobNum=([^&#]+)'),
      substring(canonical_url FROM '[?&]jobnum=([^&#]+)'),
      substring(canonical_url FROM '[?&]JobID=([^&#]+)'),
      substring(canonical_url FROM '[?&]jobid=([^&#]+)')
    )
    WHEN ats_key = 'applitrack' THEN COALESCE(
      substring(canonical_url FROM '[?&]JobID=([^&#]+)'),
      substring(canonical_url FROM '[?&]jobid=([^&#]+)')
    )
    ELSE NULL
  END AS recoverable_source_job_id
FROM postings
WHERE hidden = false
  AND coalesce(source_job_id, '') = ''
  AND ats_key = ANY(ARRAY[
    'governmentjobs',
    'usajobs',
    'k12jobspot',
    'schoolspring',
    'calcareers',
    'calopps',
    'statejobsny',
    'policeapp',
    'jobaps',
    'applitrack'
  ]::text[])
ORDER BY ats_key, canonical_url
LIMIT 200;
```

### Invented or Suspicious Dates

```sql
SELECT
  ats_key,
  posting_date,
  count(*) AS rows
FROM postings
WHERE hidden = false
  AND ats_key = ANY(ARRAY[
    'governmentjobs',
    'usajobs',
    'k12jobspot',
    'schoolspring',
    'calcareers',
    'calopps',
    'statejobsny',
    'policeapp',
    'jobaps',
    'applitrack'
  ]::text[])
  AND (
    posting_date ILIKE 'Posted Today'
    OR posting_date::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
  )
GROUP BY ats_key, posting_date
ORDER BY rows DESC, ats_key;
```

### Duplicate Canonical Rows

```sql
SELECT
  ats_key,
  canonical_url,
  count(*) AS rows,
  array_agg(DISTINCT source_job_id) AS source_job_ids
FROM postings
WHERE hidden = false
  AND ats_key = ANY(ARRAY[
    'governmentjobs',
    'usajobs',
    'k12jobspot',
    'schoolspring',
    'calcareers',
    'calopps',
    'statejobsny',
    'policeapp',
    'jobaps',
    'applitrack'
  ]::text[])
GROUP BY ats_key, canonical_url
HAVING count(*) > 1
ORDER BY rows DESC, ats_key
LIMIT 200;
```

## Certification Order

1. Add raw fixtures and pure parser exports for the three parsers currently inventing dates: `governmentjobs`, `policeapp`, and `calopps`.
2. Add source-id fixture assertions for all ten ATS keys.
3. Add geo fixtures for `k12jobspot`, `schoolspring`, `statejobsny`, `jobaps`, and `applitrack`, where local public-sector location text is likely to be present but inconsistently normalized.
4. Add remote/null evidence fixtures last, because most sources in this lane do not expose a first-class remote field.
