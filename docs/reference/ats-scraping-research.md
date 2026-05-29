# ATS Scraping Research And Method Plan

Snapshot date: May 29, 2026.

This document converts external scraping research into the OpenJobSlots ATS source-module roadmap. External scraper output is evidence only. Public posting fields must still come from deterministic source modules, saved raw fixtures, expected fixtures, parser tests, source-quality gates, and Postgres/Meili parity.

## External Repositories

| Repository | Observed stars | License | Role |
| --- | ---: | --- | --- |
| `firecrawl/firecrawl` | 125,891 | AGPL-3.0 | Optional detail markdown evidence provider only. |
| `unclecode/crawl4ai` | 67,146 | Apache-2.0 | Optional self-hosted evidence provider only. |
| `scrapy/scrapy` | 61,960 | BSD-3-Clause | Crawler architecture reference; not the default runtime path. |
| `ScrapeGraphAI/Scrapegraph-ai` | 26,396 | MIT | AI extraction reference; not a truth source. |
| `apify/crawlee` | 23,542 | Apache-2.0 | Best fit for a future Node rendered-fetch sidecar. |
| `lorien/awesome-web-scraping` | 7,914 | NOASSERTION | Tool catalog for research. |
| `kalil0321/ats-scrapers` | 58 | MIT | ATS method reference; do not vendor code without review. |

## Four Phases

1. Phase 1: research-to-backlog map.
   Convert external ATS methods into repo-local targets. This phase adds `docs/reference/ats-external-method-map.json` and `scripts/report-ats-external-method-map.js`.
2. Phase 2: method profile and experiment runner.
   Add source method profiles and make `ats:method:experiment` work across selected sources instead of the current narrow source allowlist.
3. Phase 3: pilot source hardening.
   Apply the method map to `teamtailor`, `icims`, `applitrack`, and the expansion candidates `personio`, `recruiterbox`, and `workable` only after fixture-backed gates are ready.
4. Phase 4: external evidence provider sidecar.
   Add Crawlee, Firecrawl, or Crawl4AI only as optional evidence providers behind source caps, response limits, and deterministic parser fixtures. The repo-side abstraction is `server/ingestion/externalEvidenceProviders.js`; it is disabled by default and requires explicit injected adapters.

## Priority Targets

| Priority | Target | Type | Recommended action |
| ---: | --- | --- | --- |
| 1 | `teamtailor` | existing source method repair | Use Teamtailor RSS as the preferred method and keep HTML fixture parsing as a fallback guard. |
| 2 | `icims` | existing detail evidence repair | Compare list, paged iframe, and bounded detail fetch evidence without weakening parser gates. |
| 3 | `applitrack` | existing detail evidence repair | Profile `Output.asp` list fetch versus bounded detail fetches and keep detail output as parser evidence. |
| 4 | `personio` | expansion candidate | Review the public XML feed, then add raw XML and expected normalized fixtures before implementation. |
| 5 | `recruiterbox` | expansion candidate | Review the Trakstar Hire frontend openings API and tenant discovery before implementation. |
| 6 | `workable` | expansion candidate | Hold until public widget/API token handling is documented and fixture-backed. |

## Backend Boundary

Do not replace `safeFetch`, source modules, or parser fixtures with a generic scrape API. If Phase 4 adds an external provider, it should sit behind an interface that returns bounded evidence metadata, not normalized truth fields. The source module remains responsible for deciding `source_job_id`, `canonical_url`, `country`, `region`, `city`, `remote_type`, and `posting_date`.
