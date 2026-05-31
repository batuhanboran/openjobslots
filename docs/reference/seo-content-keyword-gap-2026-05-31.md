# SEO Content, Keyword Gap, And Backlink Gap Research - May 31, 2026

This note turns the May 31 Semrush and web research pass into an implementation backlog for openjobslots.com. It is for the public SEO/content surface only. It does not approve production deploys, ATS source writes, backfills, Meilisearch reindexes, or worker changes.

## Inputs

- Semrush API research snapshot:
  - `reports/seo-research-2026-05-31/semrush-research.json`
  - `reports/seo-research-2026-05-31/refdomains.json`
- Public competitor pages checked:
  - [HiringCafe](https://hiring.cafe/)
  - [Glever](https://glever.co/)
  - [WorkWay](https://www.workway.dev/)
  - [RemoteFirstJobs](https://remotefirstjobs.com/)
  - [Hidden Jobs](https://hidden-jobs.com/)
  - [ZenSearch](https://zensearch.jobs/)
  - [Simplify Jobs](https://simplify.jobs/)
  - [Levels.fyi Jobs](https://www.levels.fyi/jobs)

## Summary

OpenJobSlots has a clear SEO gap: Semrush returned no tracked organic keyword rows for `openjobslots.com`, and backlinks are effectively at a starting baseline (`AS 0`, `8` backlinks, `2` referring domains, all nofollow). The fastest SEO path is not a blog-first program. It is a crawlable landing-page system around high-intent job searches, ATS/source intent, remote/direct-apply intent, and selected informational pages that explain why direct employer ATS boards are fresher than reposted job-board inventory.

The strongest near-term content angle is:

- "fresh jobs from employer ATS and company career pages"
- "direct apply jobs from Greenhouse, Lever, Ashby, BambooHR, Workday, and similar systems"
- "hidden jobs and jobs not on LinkedIn from public employer career pages"
- role pages where OpenJobSlots already has enough result density

## Competitor SEO Snapshot

| Domain | Role in comparison | Semrush organic rows | First visible organic pattern | Authority / referring domains | SEO note |
| --- | --- | ---: | --- | ---: | --- |
| `openjobslots.com` | Own site | 0 | No Semrush organic rows returned | AS 0 / 2 domains | Treat every relevant seed and competitor keyword as a gap. |
| `hiring.cafe` | Direct company-career-page search | 25 | Branded queries: `hiring cafe`, `hiring cafe jobs` | AS 34 / 872 domains | Strong product brand demand, broad visible index. |
| `glever.co` | ATS-specific search | 0 | No Semrush organic rows returned | AS 2 / 2 domains | Product positioning is relevant even though organic footprint is small. |
| `workway.dev` | ATS/company jobs search | 25 | Company pages and role/location pages | AS 6 / 80 domains | Best model for long-tail company and role-location landing pages. |
| `remotefirstjobs.com` | Remote/company job index | 25 | Company pages and remote blog queries | AS 5 / 565 domains | Captures remote and company-career-page long tail, but backlink profile has heavy noise. |
| `hidden-jobs.com` | Hidden/company career-page positioning | 25 | `hidden jobs`, `secret job`, `hidden companies` | AS 7 / 95 domains | Good positioning reference for "hidden jobs" language. |
| `zensearch.jobs` | Company-career-page search | 25 | Mostly branded queries | AS 11 / 61 domains | Referring domains include Product Hunt and Substack, both worth manual outreach/launch testing. |
| `simplify.jobs` | AI job search and application tooling | 25 | Strong branded queries | AS 48 / 4,185 domains | Useful authority benchmark; backlink channels include AI/tool directories and university pages. |
| `levels.fyi` | Broader tech jobs authority benchmark | 25 | Brand and salary/jobs authority | AS 55 / 12,645 domains | Not a direct competitor, but useful for authority expectations in tech jobs. |

## Keyword Gap Priorities

Semrush returned no tracked organic rows for OpenJobSlots, so the gap should be prioritized by intent fit, difficulty, and whether the current product can satisfy the page without thin content.

### Tier 1 - Role Landing Pages

These are high-intent pages with reasonable KD compared with broad "remote jobs" terms. They should be generated as crawlable, localized landing pages only when result density is adequate.

| Keyword | Volume | KD | Why it matters |
| --- | ---: | ---: | --- |
| `customer success manager jobs` | 5,400 | 18 | Best low-KD role page in the seed set. |
| `technical support engineer jobs` | 1,600 | 25 | Specific, likely enough ATS inventory, lower competition. |
| `devops engineer jobs` | 2,900 | 27 | Strong technical role intent and manageable KD. |
| `product manager jobs` | 8,100 | 28 | Good volume/KD balance; supports role-location expansion. |
| `software engineer jobs` | 27,100 | 37 | Core tech-job query, higher competition but product-relevant. |
| `data analyst jobs` | 49,500 | 42 | Large demand; needs strong result density and internal links. |

### Tier 2 - ATS And Source Intent Pages

These should explain what each ATS board is, how OpenJobSlots indexes public employer postings, and link into live search results. They also help the brand own its technical differentiation.

| Keyword | Volume | KD | Content angle |
| --- | ---: | ---: | --- |
| `greenhouse jobs` | 4,400 | 34 | "Find current Greenhouse jobs from employer career pages." |
| `workday jobs` | 8,100 | 51 | Higher KD; keep as a pillar source page once inventory is strong. |
| `lever jobs` | 720 | 29 | "What jobs.lever.co means and how to search Lever postings." |
| `bamboohr jobs` | 720 | 29 | Specific ATS/source landing page. |
| `ashby jobs` | 260 | 24 | Lower volume but strong product fit and lower KD. |
| `ats jobs` | 480 | 17 | Educational page around ATS-backed public job search. |

### Tier 3 - Direct Apply, Hidden Jobs, And Trust Intent

These are lower-volume but strategically strong because they match the OpenJobSlots difference versus generic boards.

| Keyword | Volume | KD | Content angle |
| --- | ---: | ---: | --- |
| `hidden jobs` | 90 | 16 | "Hidden jobs from public employer career pages." |
| `jobs not on linkedin` | 20 | 0 | "How to find employer career-page jobs before reposts spread." |
| `direct apply jobs` | 40 | 50 | Competitive but highly aligned; use as a supporting concept first. |
| `public job boards` | 20 | 0 | Explain public ATS boards and direct employer listings. |
| `fresh job openings` | 0 | 0 | Use as supporting copy, not a primary page target yet. |

### Tier 4 - Remote Jobs

Remote terms have major volume but are harder and more generic. They should be supported by search-result pages and internal links, not treated as the first content-only win.

| Keyword | Volume | KD | Recommendation |
| --- | ---: | ---: | --- |
| `remote jobs` | 823,000 | 46 | Keep as a pillar/search landing page with strong live inventory. |
| `work from home jobs` | 673,000 | 65 | Too broad for early priority; support with related pages. |
| `entry level remote jobs` | 27,100 | 38 | Build only if filters can support entry-level intent. |
| `data entry remote jobs` | 74,000 | 45 | Opportunity exists, but only if inventory quality is high. |
| `remote jobs near me` | 74,000 | 55 | Needs location-aware pages and careful intent handling. |

## Competitor Keyword Lessons

WorkWay is the most useful programmatic SEO model. Its visible organic footprint includes company pages such as `altos labs jobs`, `dr squatch careers`, and `subsplash jobs`, plus role-location pages such as `jobs product manager london`. This supports a phased OpenJobSlots route strategy:

1. Role pages first.
2. ATS/source pages second.
3. Role plus country/region/city pages where the live result set is deep enough.
4. Company pages only when the canonical company/profile data is stable and has enough public postings.

RemoteFirstJobs shows that company-career pages and blog content can rank together, but several visible queries are company-specific or informational rather than generic "remote jobs" wins. Hidden Jobs shows that a narrow positioning phrase can rank with a focused homepage. HiringCafe and Simplify show that brand demand can become the largest organic asset once the product is known, but OpenJobSlots should not depend on brand search yet.

## Content Backlog

### Batch A - Route Catalog Expansion

Add crawlable, localized public SEO routes for role pages with strong intent:

- Customer Success Manager jobs
- Technical Support Engineer jobs
- Product Manager jobs
- Software Engineer jobs
- Data Analyst jobs
- DevOps Engineer jobs

Each route should include:

- localized title/meta description
- canonical URL
- hreflang alternates
- crawler-visible explanatory content
- internal links to ATS/source pages, remote jobs, and live search
- minimum 200 meaningful words per Semrush low-word-count target

### Batch B - ATS Source Pages

Add source intent pages when they can link to real search/filter URLs:

- Greenhouse jobs
- Lever jobs
- Ashby jobs
- Workday jobs
- BambooHR jobs
- ATS jobs / ATS job boards

The copy should explain that OpenJobSlots indexes public employer ATS and career-page postings. Avoid implying official partnership with any ATS vendor.

### Batch C - Direct Apply And Hidden Jobs Pages

Add informational pages that can earn links and explain the product:

- Jobs not on LinkedIn
- Direct apply jobs from employer career pages
- Hidden jobs from public ATS boards
- Fresh job openings from company career pages

These pages should have clear public-safe language: OpenJobSlots finds public employer postings and links users back to the original employer apply page. Do not claim exclusive access or non-public jobs.

### Batch D - Role + Location Pages

Add these only after result-density checks. WorkWay's long-tail pattern is attractive, but thin pages will create crawl waste. Candidate patterns:

- `/en/product-manager-jobs-in-london`
- `/en/software-engineer-jobs-in-united-states`
- `/en/data-analyst-remote-jobs`
- localized equivalents only where search demand and result density exist

Gate each page on live inventory counts and keep empty/weak pages out of the sitemap.

## Backlink Gap

OpenJobSlots has the largest immediate gap in link authority:

| Domain | Authority score | Backlinks | Referring domains | Follow links | Nofollow links |
| --- | ---: | ---: | ---: | ---: | ---: |
| `openjobslots.com` | 0 | 8 | 2 | 0 | 8 |
| `hiring.cafe` | 34 | 11,156 | 872 | 8,988 | 1,762 |
| `workway.dev` | 6 | 417 | 80 | 200 | 212 |
| `hidden-jobs.com` | 7 | 170 | 95 | 120 | 49 |
| `zensearch.jobs` | 11 | 133 | 61 | 74 | 57 |
| `simplify.jobs` | 48 | 67,674 | 4,185 | 18,089 | 38,815 |
| `levels.fyi` | 55 | 585,551 | 12,645 | 490,580 | 82,768 |

The Semrush backlink matrix for domains linking to competitors but not OpenJobSlots returned many low-quality or irrelevant directories. Do not use that matrix as an automatic outreach list.

Prioritize manually vetted links from:

- university and bootcamp career resource pages
- job-search resource pages and curated career tools
- startup/product launch communities such as Product Hunt-style channels
- AI/tool directories only if the public positioning includes AI-assisted search or discovery
- HR, recruiting, talent, and founder newsletters
- technical blog posts about public ATS indexing, data quality, and direct employer apply links

Initial outreach assets to create before outreach:

1. A public "What OpenJobSlots indexes" page.
2. A public ATS/source coverage page with supported systems and freshness language.
3. A short data-quality methodology page explaining direct employer apply URLs, canonical links, and freshness.
4. A launch/press page with the public count of job slots, ATS coverage, and company coverage.

## Implementation Order

1. Keep the Semrush site-audit fixes deployed and re-audited first: robots, hreflang, sitemap, low-word-count pages.
2. Expand `src/publicSeoRoutes.js` with the highest-priority role and ATS pages.
3. Add route-aware crawler-visible content in `server/http/publicSeo.js` for the new pages.
4. Add tests in `src/publicSeoRoutes.test.js` and `server/http/publicSeo.test.js` for canonical routes, hreflang coverage, sitemap inclusion, and minimum visible content.
5. Run `npm.cmd run test:http`, `npm.cmd run build:web`, and `git diff --check`.
6. Deploy only after explicit approval, then rerun Semrush Site Audit.

## Guardrails

- Do not publish thin pages. If a role, ATS, or location page has too little result inventory, keep it out of the sitemap until coverage improves.
- Do not claim partnership with ATS vendors or employers.
- Do not say OpenJobSlots has private, hidden, leaked, or exclusive jobs. Use "public employer career pages" and "direct employer apply pages."
- Do not auto-import backlink targets from Semrush without manual quality review.
- Do not expose internal parser errors, source diagnostics, production paths, or secrets in public SEO copy.
