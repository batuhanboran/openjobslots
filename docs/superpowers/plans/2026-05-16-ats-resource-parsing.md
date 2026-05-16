# ATS Resource Parsing Roadmap

Date: 2026-05-16
Project: OpenJobSlots

## Goal

Expand ATS parsing without lowering the current production quality floor. New resources must either add clean public rows or improve geo/remote/parser quality with guarded canary evidence, no blind rebuild, and no shrink of visible postings.

## Current Baseline From Project Docs

- The repo already has 60 configured ATS keys and strict raw fixture-backed certification for the main direct APIs, including Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Taleo, BambooHR, Recruitee, ApplyToJob, Breezy, Zoho, iCIMS, Applitrack, and Manatal.
- `docs/reference/ats-adapter-matrix.md` already marks the next candidate wave as Personio XML, Trakstar Hire/Recruiterbox frontend API, and JobScore feed API, with Workable, Bullhorn, and Comeet as the next review group.
- Recent handoff notes warn that single-source recovery can be exhausted. Lever already failed the 5k-clean-net-new threshold, so future work should be source-ranked before implementation.

## Implementation Status

- Completed on 2026-05-16: detailed ingestion/posting diagnostics now require the admin token, and public `/sync/status` plus `/ingestion/status` return coarse status shapes only.
- Completed on 2026-05-16: shared ATS/detail fetch protection now covers source modules, legacy ATS collectors, method experiments, and detail refetches with scheme allowlisting, DNS/private-address blocking, redirect revalidation, and response-size limits.
- Remaining Wave 0 work: build the read-only source ranking workbench before implementing any additional ATS parser.

## Resource Classes

1. Direct public ATS APIs and feeds
   - Highest priority because they preserve direct employer canonical URLs and fit the current source-module architecture.
   - Already supported or certified: Greenhouse Job Board API, Lever Postings API, Ashby public job posting API, SmartRecruiters Posting API.
   - Next expansion candidates: Personio XML feed, Workable jobs endpoints, Comeet careers positions API, Teamtailor Job Board/API path, Trakstar/Recruiterbox, JobScore.

2. Commercial normalized job-data APIs
   - Use as a separate backfill/enrichment lane, not as direct ATS adapters.
   - Candidates: Merge Recruiting API for authorized ATS integrations, Coresignal Base/Multi-source Jobs API, Fantastic.jobs ATS/Career Site API, Adzuna Search API.
   - Treat these as paid/contracted sources with provenance, dedupe, licensing, and attribution requirements before indexing.

3. Remote/job-board aggregators
   - Keep separate from direct ATS parsing.
   - Use only when their license, freshness, and canonical employer-link behavior are clear.

## Primary External References

- Greenhouse Job Board API: https://developer.greenhouse.io/job-board.html
- Lever Postings API: https://github.com/lever/postings-api
- Ashby public job posting API: https://developers.ashbyhq.com/docs/public-job-posting-api
- SmartRecruiters Posting API: https://developers.smartrecruiters.com/docs/posting-api
- Personio XML open positions feed: https://developer.personio.de/v1.0/reference/get_xml
- Workable careers API guidance: https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page
- Comeet careers positions API: https://developers.comeet.com/reference/careers-api-list-all-positions
- Teamtailor partner/job-board API docs: https://partner.teamtailor.com/
- Merge Recruiting API: https://docs.merge.dev/merge-unified/ats/overview
- Coresignal Jobs API docs: https://docs.coresignal.com/jobs-api/base-jobs-api
- Fantastic.jobs API: https://fantastic.jobs/api
- Adzuna API: https://developer.adzuna.com/

## Implementation Sequence

1. Fix security prerequisites before parser expansion.
   - Put detailed ingestion/posting diagnostics behind admin controls.
   - Add a shared ATS fetch wrapper with http/https allowlist, DNS/private-IP blocking, redirect revalidation, timeout, response-size caps, and tests for localhost, loopback, link-local, IPv6 loopback, and private-range redirects.

2. Build a read-only source ranking workbench.
   - Inputs: configured targets, current accepted public rows, missing geo/remote rates, parser rejection rates, last fetch success, and estimated clean net-new rows.
   - Output: a ranked table of source candidates with expected gain and risk.
   - Gate: do not implement a parser if the available target pool cannot plausibly add material clean rows or quality improvement.

3. Certify one source at a time.
   - Add raw list/detail fixtures and invalid-shape fixtures first.
   - Implement source module discover/fetch/parse/normalize/validate functions.
   - Require source-specific tests for title, company, canonical URL, source job ID, posting date, location text, country/region/city, remote type, department/employment type when available, and rejection behavior.

4. Run canary-only production evaluation.
   - Dry run against a small source target set.
   - Record estimated net-new clean rows, no-geo/no-remote changes, duplicate rate, rejection reasons, and Meili parity impact.
   - Apply only after explicit approval and only when quality metrics pass.

5. Promote behind feature flags.
   - Enable source module with conservative rate limits and host caps.
   - Keep parser versioned so regressions are attributable.
   - Keep rollback path: disable source, revert parser version, and preserve existing stronger normalized values.

## Suggested Waves

Wave 0: Safety and visibility
- Admin-gate diagnostics.
- SSRF-safe fetch wrapper.
- Source ranking workbench.

Wave 1: Low-friction direct feeds
- Personio XML feed.
- Comeet published positions.
- Workable public/account jobs path after token/public endpoint decision.

Wave 2: Existing risky partial sources
- Teamtailor direct API or stable board fixture path.
- Trakstar/Recruiterbox.
- JobScore.

Wave 3: Paid or authorized APIs
- Merge Recruiting API only for authorized tenant integrations.
- Coresignal/Fantastic.jobs/Adzuna as optional separate import providers with source attribution and licensing review.

## Acceptance Criteria

- No production visible-count decrease.
- No increase in public `no_geo_no_remote` rows for the affected source.
- No broad unknown/onsite regression where source evidence supports remote or physical location.
- Source module has raw valid fixtures and invalid-shape rejection fixtures.
- Canary report records accepted, rejected, duplicate, quarantined, and net-new estimates before apply.
- Meilisearch parity remains clean after any approved apply/reindex step.

## Notes From Notion Search

The Notion workspace search did not return useful internal ATS parsing resources for this project. Future Notion capture should store vendor docs, target examples, source ranking results, and canary outcomes in one ATS parsing research page so this does not live only in repo handoffs.
