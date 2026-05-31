# SEO Sitemap And Content Architecture Research - 2026-05-31

## Scope

This note is limited to Semrush-driven SEO, sitemap, crawlability, and content architecture for openjobslots.com. It does not authorize parser fixes, source-quality backfills, production writes, or deployment.

## Inputs Checked

- Live sitemap: `https://openjobslots.com/sitemap.xml`
- Live health: `https://openjobslots.com/health`
- Local Semrush snapshots:
  - `reports/seo-research-2026-05-31/semrush-research.json`
  - `reports/seo-research-2026-05-31/refdomains.json`
- Current production SEO code shape from committed route files.
- Google Search Central docs for sitemaps, faceted navigation, hreflang, and JobPosting structured data.
- Semrush MCP documentation.
- Competitor sitemap structures for WorkWay, RemoteFirstJobs, Hidden Jobs, HiringCafe, ZenSearch, and Levels.fyi.

## Current OpenJobSlots Sitemap State

Live sitemap status: `200`

Live URL count: `56`

Current route shape:

| Segment | URL count | Notes |
| --- | ---: | --- |
| `/` | 1 | Root canonical page |
| `/en`, `/tr`, `/de`, `/fr`, `/es` | 5 | Localized home pages |
| Localized intent pages | 40 | Job openings, remote jobs, and six role clusters across five languages |
| `/en/*` source/content pages | 5 | ATS job boards, company career page jobs, direct apply jobs, hidden jobs, jobs not on LinkedIn |
| `/ats/*` pages | 5 | Greenhouse, Lever, Ashby, Workday, BambooHR |

Sample live page checks:

| URL | Status | Hreflang count | JSON-LD types | Approx words |
| --- | ---: | ---: | --- | ---: |
| `/en/ats-job-boards` | 200 | 0 | Organization, WebSite, CollectionPage, BreadcrumbList | 1387 |
| `/ats/greenhouse-jobs` | 200 | 0 | Organization, WebSite, CollectionPage, BreadcrumbList | 1306 |
| `/en/software-engineer-jobs` | 200 | 6 | Organization, WebSite, CollectionPage, BreadcrumbList | 1109 |
| `/en/hidden-jobs` | 200 | 0 | Organization, WebSite, CollectionPage, BreadcrumbList | 1361 |

Good current choices:

- Sitemap is curated and avoids query/filter URL explosion.
- Localized core role pages have hreflang.
- Listing pages do not use `JobPosting` JSON-LD, which avoids structured data policy risk.
- Canonicals are stable on sampled pages.

Main limitation:

The sitemap is safe but too shallow for a large job-search index. It does not expose enough crawlable, inventory-backed pages for ATS/source, role, location, company, or individual job demand.

## Semrush Snapshot

OpenJobSlots has no organic keyword rows in the local Semrush snapshot.

Backlink snapshot:

| Domain | Authority score | Backlinks | Referring domains | Follow links |
| --- | ---: | ---: | ---: | ---: |
| openjobslots.com | 0 | 8 | 2 | 0 |
| hiring.cafe | 34 | 11156 | 872 | 8988 |
| workway.dev | 6 | 417 | 80 | 200 |
| remotefirstjobs.com | 5 | 10190551 | 565 | 148058 |
| hidden-jobs.com | 7 | 170 | 95 | 120 |
| zensearch.jobs | 11 | 133 | 61 | 74 |
| simplify.jobs | 48 | 67674 | 4185 | 18089 |
| levels.fyi | 55 | 585551 | 12645 | 490580 |

Seed keyword opportunities:

| Keyword | Volume | KD | Current page fit |
| --- | ---: | ---: | --- |
| remote jobs | 823000 | 46 | Existing localized remote pages, needs stronger inventory/content |
| work from home jobs | 673000 | 65 | Needs separate page, high difficulty |
| data analyst jobs | 49500 | 42 | Existing role page |
| software engineer jobs | 27100 | 37 | Existing role page |
| product manager jobs | 8100 | 28 | Existing role page |
| customer success manager jobs | 5400 | 18 | Existing role page, good KD |
| devops engineer jobs | 2900 | 27 | Existing role page |
| technical support engineer jobs | 1600 | 25 | Existing role page |
| workday jobs | 8100 | 51 | Existing ATS page, high competition |
| greenhouse jobs | 4400 | 34 | Existing ATS page |
| lever jobs | 720 | 29 | Existing ATS page |
| bamboohr jobs | 720 | 29 | Existing ATS page |
| ashby jobs | 260 | 24 | Existing ATS page |
| ats jobs | 480 | 17 | Existing `/en/ats-job-boards`, needs better intent alignment |
| hidden jobs | 90 | 16 | Existing page, low volume but low difficulty |
| jobs not on linkedin | 20 | 0 | Existing page, low competition |

## Competitor Sitemap Patterns

| Competitor | Sitemap pattern | SEO lesson |
| --- | --- | --- |
| WorkWay | Sitemap index with static, companies, domains, jobs, skills, location SEO, location-only | Uses programmatic inventory pages for company, skill, job, and role/location queries. |
| RemoteFirstJobs | Sitemap index with static, companies, company jobs, blog, skills, locations | Splits company pages from company job pages and supports blog/skill/location content. |
| ZenSearch | Multiple numbered sitemaps, mostly company pages | Heavy company-page footprint for long-tail discovery. |
| Levels.fyi | Sitemap index split by base, companies, job family, community, industry | Uses distinct page classes instead of a single flat sitemap. |
| HiringCafe | Small sitemap with product/company/career pages | Stronger backlink/brand authority means it relies less on programmatic pages. |
| Hidden Jobs | Minimal visible sitemap result | Narrow brand/intent positioning, not a model for broad job-index SEO. |

OpenJobSlots is closer to the safe/small model, but the product has enough inventory to justify a controlled programmatic sitemap architecture.

## Architecture Gap

Live health currently reports:

- `job_slot_count`: about `325k`
- `visible_company_count`: about `16k`
- `visible_ats_count`: `37`
- `configured_ats_count`: `62`

But the sitemap exposes only:

- 5 ATS source pages.
- No company pages.
- No role + location pages.
- No location-only pages.
- No individual job pages.
- No sitemap index split by page type.

This creates a mismatch: the internal search index is large, but the public crawl graph is small. Semrush will see a site with a job-search product but limited crawlable landing-page architecture.

## Google/Semrush Constraints That Matter

- Sitemaps help discovery for large/new sites and can include alternate language versions, but they do not guarantee indexing.
- Faceted filter URLs can create near-infinite crawl spaces; OpenJobSlots should keep query/filter combinations out of the sitemap and create curated landing URLs instead.
- Hreflang groups must be reciprocal and include self-references. English-only source/content pages are acceptable, but if localized variants are added they need a complete hreflang model.
- `JobPosting` structured data should only be used on a single job posting page, not a search/listing page.
- Expired jobs must be removed, expired via `validThrough`, or have `JobPosting` markup removed. For job pages, Google recommends the Indexing API for faster updates, while still keeping sitemaps for coverage.
- Semrush MCP can support daily keyword/backlink checks, competitor monitoring, and report automation, but this Codex session did not expose a callable Semrush MCP tool. Local API snapshots were used instead.

## Recommended Sitemap Architecture

Move from one flat sitemap file to a sitemap index:

| Sitemap | Purpose | Initial rule |
| --- | --- | --- |
| `/sitemap.xml` | Sitemap index | Points to child sitemaps only |
| `/sitemaps/static.xml` | Home, localized role pages, editorial/source explainers | Existing curated pages |
| `/sitemaps/ats-sources.xml` | ATS/source landing pages | Inventory-gated, source-backed |
| `/sitemaps/roles.xml` | Role landing pages | Inventory-gated role taxonomy |
| `/sitemaps/role-locations.xml` | Role + city/country pages | High-demand combinations only |
| `/sitemaps/locations.xml` | Location-only pages | Only high inventory locations |
| `/sitemaps/companies.xml` | Company profile/job pages | Stable canonical company slugs only |
| `/sitemaps/jobs.xml` | Single job detail pages | Only after JobPosting-quality fields exist |

Do not add raw `/postings?...` URLs to the sitemap.

## Inventory Gating Rules

Suggested first-pass thresholds:

| Page type | Sitemap threshold | Notes |
| --- | ---: | --- |
| ATS/source page | 50+ visible jobs or strategic keyword demand | Include strategic pages for Greenhouse, Lever, Ashby, Workday, BambooHR even if counts fluctuate. |
| Role page | 100+ visible jobs | Start with Semrush-backed roles and expand from live inventory. |
| Role + location page | 25+ visible jobs | Avoid thin city pages. |
| Location-only page | 100+ visible jobs | Useful for "jobs in X" queries. |
| Company page | 5+ active jobs and stable slug | Avoid stale/empty company pages. |
| Job page | 1 active visible job with required fields | Needs single-job route, apply link, lifecycle expiration, and schema validation. |

Pages below threshold can still exist as internal search/filter states, but should not be canonical SEO landing pages or sitemap entries.

## Content Model By Page Type

Source/ATS page:

- Source name and supported employer career-page pattern.
- Live job count, company count, top roles, top countries/cities, freshness signal.
- Explanation of why direct ATS/source search surfaces jobs missed by aggregator-first search.
- Internal links to top role pages, source + role pages where available, and related ATS sources.

Role page:

- Role intent summary based on current inventory.
- Live count and freshness.
- Top locations, top ATS sources, top companies.
- Related roles and remote/work-from-home variant links.

Role + location page:

- Role demand in that geography.
- Remote/hybrid/on-site split when known.
- Top companies and source systems.
- Canonical link to the landing page, not query-string filters.

Company page:

- Public company name and current job count.
- Top roles, locations, source/ATS, freshness.
- Links to company jobs and related companies only when public and stable.

Single job page:

- Only if one job is represented.
- Visible title, company, description, apply URL, date posted when source-backed, location/remote fields when source-backed.
- `JobPosting` JSON-LD only when content matches the visible page.
- Expiration lifecycle: 404/410, expired `validThrough`, or markup removal.

## Prioritized Action Plan

### Phase 0 - Measurement And Semrush Baseline

1. Export current Semrush Site Audit issues for openjobslots.com.
2. Build a local sitemap audit script that records status, title, canonical, hreflang count, JSON-LD types, word count, and internal links for each sitemap URL.
3. Compare live sitemap URLs against Semrush issue IDs and Search Console coverage data.
4. Keep the existing sitemap stable until a new sitemap index is tested.

### Phase 1 - Sitemap Index Refactor

1. Split SEO route definitions by page type: static, localized role, source/content, ATS/source.
2. Generate a sitemap index and child sitemaps.
3. Add tests proving:
   - No admin/internal/raw diagnostic URLs.
   - No query-string filter URLs.
   - Canonicals match sitemap URLs.
   - Hreflang groups are complete where localization exists.
   - Child sitemap URL counts stay within protocol limits.

### Phase 2 - ATS/Source Expansion

1. Expand beyond the current 5 ATS pages using live visible ATS counts.
2. Prioritize ATSs with both inventory and search value: Workday, Greenhouse, Lever, BambooHR, Ashby, iCIMS, Breezy, Recruitee, Teamtailor, Jobvite, Rippling, ApplicantPro.
3. Add inventory-backed page modules: count, companies, top roles, top locations, freshness.
4. Keep pages out of sitemap if the source has weak current inventory or thin public content.

### Phase 3 - Role, Location, And Company Programmatic Pages

1. Generate role pages from a controlled taxonomy, not from arbitrary user searches.
2. Add role + location pages only when inventory threshold is met.
3. Add company pages for high-confidence companies with stable slugs and active postings.
4. Add internal link blocks so new pages are discoverable without relying only on sitemap submission.

### Phase 4 - Job Detail Pages And Google Jobs Eligibility

1. Do not add `JobPosting` schema to listing pages.
2. Add single job detail routes only after ATS fields are source-backed enough: title, company, description, apply URL, datePosted when available, location or remote eligibility when available.
3. Add lifecycle handling for expired jobs.
4. Consider Google Indexing API for job URL updates after job detail pages are live.

### Phase 5 - Content And Backlink Growth

1. Build supporting content around low-KD clusters: ATS jobs, hidden jobs, jobs not on LinkedIn, customer success manager jobs, source-specific jobs.
2. Create shareable data assets from OpenJobSlots inventory: ATS hiring index, remote hiring report, fastest-refreshing company career pages.
3. Use Semrush backlink gap to target relevant directories, HR-tech roundups, startup/tool lists, and job-search resource pages.

## Immediate Recommendation

The first implementation target should be Phase 1 plus a small Phase 2 pilot:

1. Convert `/sitemap.xml` into a sitemap index.
2. Keep existing static/localized pages in `/sitemaps/static.xml`.
3. Add `/sitemaps/ats-sources.xml` with the current 5 ATS pages plus 5-10 inventory-backed ATS pages.
4. Add tests around sitemap shape, canonicals, hreflang, and blocked URL classes.
5. Run Semrush Site Audit again and compare issue deltas before expanding to company/job pages.

This is the safest first move because it improves crawl architecture without opening a large thin-content or stale-job surface.

## Sources

- Google Search Central sitemap documentation: https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview
- Google Search Central faceted navigation guidance: https://developers.google.com/search/blog/2024/12/crawling-december-faceted-nav
- Google Search Central JobPosting documentation: https://developers.google.com/search/docs/appearance/structured-data/job-posting
- Google Search Central localized versions documentation: https://developers.google.com/search/docs/specialty/international/localized-versions
- Semrush MCP documentation: https://developer.semrush.com/api/introduction/semrush-mcp/
