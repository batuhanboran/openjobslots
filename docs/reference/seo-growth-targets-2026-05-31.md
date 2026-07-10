# SEO Growth Targets - May 31, 2026

This plan follows the May 31 deploy of `f44a890` and the Semrush-backed keyword/content research. It is scoped to traffic growth for `openjobslots.com`; it does not approve production data writes, ATS backfills, Meilisearch replace reindexes, or changes to public data-quality thresholds.

## Live Deploy Baseline

- Deployed commit: `f44a890cd1be14c482ada1ad6276b79778d53459`.
- Production checkout: `<app-dir>`.
- Public health after deploy: `ok=true`.
- Sitemap now includes:
  - `/en/ats-job-boards`
  - `/en/company-career-page-jobs`
  - `/en/direct-apply-jobs`
  - `/en/hidden-jobs`
  - `/en/jobs-not-on-linkedin`
- `/en/direct-apply-jobs` renders crawler-visible static SEO content and `CollectionPage` JSON-LD.
- `robots.txt` is standards-compatible and has no `Content-Signal` directive.

## Research Inputs

- Semrush raw research:
  - `reports/seo-research-2026-05-31/semrush-research.json`
  - `reports/seo-research-2026-05-31/refdomains.json`
- Previous analysis:
  - `docs/reference/seo-content-keyword-gap-2026-05-31.md`
- Primary references:
  - [Google JobPosting structured data](https://developers.google.com/search/docs/appearance/structured-data/job-posting)
  - [Google faceted navigation crawl guidance](https://developers.google.com/search/blog/2024/12/crawling-december-faceted-nav)
  - [Google pagination guidance](https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading)
  - [Semrush MCP documentation](https://developer.semrush.com/api/introduction/semrush-mcp/)

## Strategic Direction

OpenJobSlots should not try to beat job-search competitors with generic blog volume first. The defensible edge is source-first search:

1. Public employer ATS and career-page coverage.
2. Direct employer apply links.
3. Freshness and source transparency.
4. Conservative parser evidence instead of invented geo/date/remote values.
5. Crawlable topic clusters that explain the product while linking to real search entry points.

The next phases should build from this moat.

## Target 1 - Technical SEO And Semrush Monitoring

Goal: keep Semrush crawl health high while expanding pages.

Actions:

- Run Semrush Site Audit after each SEO deploy and track:
  - errors
  - low word count
  - hreflang mismatches
  - orphaned sitemap pages
  - crawl depth
  - duplicate titles/descriptions
- Use Semrush MCP/API for daily checks:
  - domain organic keyword changes for `openjobslots.com`
  - keyword movement for role, ATS, and direct-apply terms
  - backlink/referring-domain changes
  - competitor movement for HiringCafe, WorkWay, RemoteFirstJobs, Hidden Jobs, ZenSearch, Simplify, and Levels.fyi
- Keep a weekly Markdown report under `reports/` or a non-committed export path, then commit only the summarized action plan under `docs/reference/`.

Why:

- Semrush MCP supports SEO API data, read-only Projects API data, and daily keyword/backlink monitoring workflows.
- Organic ranking will lag deploys, so monitoring must be repeated instead of judged immediately.

## Target 2 - Role And Source Cluster Expansion

Goal: rank for non-brand, high-intent pages before competitors own the long tail.

Already live:

- role pages for software engineer, data analyst, product manager, customer success manager, DevOps engineer, and technical support engineer
- ATS pages for Greenhouse, Lever, Ashby, Workday, and BambooHR
- source-first content pages for ATS job boards, company career pages, direct apply, hidden jobs, and jobs not on LinkedIn

Next additions:

- `/en/entry-level-remote-jobs`
- `/en/data-entry-remote-jobs`
- `/en/remote-customer-support-jobs`
- `/en/remote-product-manager-jobs`
- `/en/startup-jobs`
- `/en/saas-jobs`

Gate:

- Add only pages where the live public index can satisfy the intent.
- Keep weak pages out of the sitemap.
- Each page needs route-specific title, description, static content, FAQ, canonical, and internal links.

## Target 3 - Role + Location Programmatic Pages

Goal: compete with WorkWay-style long-tail pages without creating thin crawl waste.

Candidate pages:

- `/en/product-manager-jobs-in-london`
- `/en/software-engineer-jobs-in-united-states`
- `/en/data-analyst-jobs-in-canada`
- `/en/customer-success-jobs-in-germany`
- `/en/devops-engineer-jobs-in-europe`

Required gate before publishing:

- minimum live result count by role/location
- at least one crawlable internal link path from a parent route
- unique title and description
- content explains role, location, remote/hybrid behavior, direct apply, and ATS source coverage
- empty combinations return no sitemap entry

Why:

- Google warns that uncontrolled faceted navigation can generate near-infinite URLs and slow discovery of important pages.
- The route catalog should publish selected pages only; broad search/filter parameters should remain out of the sitemap.

## Target 4 - Individual Job Detail Pages With JobPosting Schema

Goal: unlock Google job-search eligibility where source data is strong enough.

This is the biggest traffic opportunity, but it must be implemented carefully.

Required design:

- stable public job detail URL per canonical posting
- one job per page
- `JobPosting` JSON-LD only on the leaf job page, not list/search pages
- canonical employer apply link visible on the page
- required fields only when source-backed:
  - title
  - description
  - datePosted
  - hiringOrganization
  - jobLocation or remote fields
  - validThrough when known, or removal/expiry logic when not known
- expired/removed jobs should drop markup, return `404/410`, or carry past `validThrough` when reliable
- Indexing API integration should be considered only after correctness is proven

Do not start this until:

- public detail route design is reviewed
- retention/expiry behavior is clear
- source-backed field quality is strong enough
- search parity stays green

Why:

- Google says `JobPosting` markup belongs on the most detailed leaf page, not list/search result pages.
- Google recommends Indexing API for job posting URL changes, while still recommending sitemaps for full-site coverage.

## Target 5 - Backlink And Authority Growth

Goal: close the largest current gap: authority and referring domains.

OpenJobSlots baseline from Semrush:

- Authority Score: `0`
- backlinks: `8`
- referring domains: `2`
- follow links: `0`

Priority assets to earn links:

- "What OpenJobSlots indexes" public page
- ATS/source coverage page
- data-quality methodology page
- direct apply jobs guide
- hidden jobs guide
- public launch/press page with job slot, ATS, and company coverage counts

Outreach lanes:

- university and bootcamp career resource pages
- founder/startup newsletters
- HR and recruiting communities
- Product Hunt-style launch channels
- curated career tool directories
- AI/tool directories only if the page honestly positions OpenJobSlots as AI-assisted or data-assisted discovery

Guardrail:

- Do not copy the spam-heavy backlink matrix into outreach. Manually vet domains for relevance and quality.

## Target 6 - International Expansion

Goal: expand beyond English only after existing hreflang and content quality are stable.

Current state:

- Core localized pages exist for English, Turkish, German, French, and Spanish.
- There are uncommitted local changes adding more UI languages; they are not part of the deployed SEO batch.

Recommended next step:

- Add localized SEO routes in small batches only when:
  - UI language support is committed and tested
  - `PUBLIC_SEO_SUPPORTED_LANGUAGES` is updated
  - hreflang reciprocal tests pass
  - localized static content clears low-word-count checks

Do not publish auto-translated pages at scale without tests and route-specific metadata.

## Execution Order

1. Fresh Semrush Site Audit after deploy.
2. Fix any crawlability regressions from the new pages.
3. Add a Semrush monitoring script/report for:
   - organic keyword count
   - ranking keywords by cluster
   - competitor delta
   - backlink/referring-domain delta
4. Add the next 6 high-intent pages from Target 2.
5. Add inventory-gated role + location route generation.
6. Design public job detail pages and `JobPosting` schema behind tests.
7. Build backlink assets and outreach list.

## Success Metrics

30-day targets:

- Semrush Site Audit errors: `0`
- low-word-count sitemap pages: `0`
- sitemap pages with internal root/fallback links: `100%`
- first non-brand organic keyword rows for `openjobslots.com`
- referring domains above `10`

90-day targets:

- at least `50` curated SEO routes
- at least `25` non-brand tracked organic keywords
- at least `30` referring domains
- validated design for job detail pages and `JobPosting` schema

## Next Implementation Batch

Build Target 2 next:

- add the six high-intent English pages
- add route-specific static paragraphs and FAQ
- include them in sitemap, `llms.txt`, root fallback links, and tests
- run `npm.cmd run test:http`, `npm.cmd run build:web`, and `git diff --check`

Deploy only after the batch is committed and explicitly approved.
