# ATS Disabled Source Gap Report - 2026-05-17

This report is read-only. No production posting data was mutated, no ATS source apply/canary was run, no clean rebuild was run, and no Meili reindex was run.

## Scope

User focus:

- Re-check the four disabled candidate sources: `jobvite`, `eightfold`, `jobaps`, `hirebridge`.
- Explain why nine disabled sources have zero configured targets.
- Define how to reorganize ATS source recovery so only sources that pass quality thresholds are enabled/indexed.
- Define a direct JSON / HTTP parser / Markdown evidence path for better source review and future indexing.

## Threshold Boundary

Current public row gate requires real source evidence. Rows need a title, company, canonical URL, source job id, parser metadata, minimum quality, and minimum confidence. Rows without safe geo or explicit remote/hybrid/onsite evidence are quarantined rather than invented.

Source-level promotion remains stricter than row-level acceptance. The current source quality policy expects a source to stay below unsafe missing-geo / unknown-remote rates before broad public writes. The practical gate for this wave is:

- Direct/enterprise/API sources: high parser success and source-module fixtures before enablement.
- HTML/public-sector sources: fixture-backed parser, stable source id, accepted rows, low no-geo/no-remote rate.
- No source should be enabled simply because it has volume.

## Four-Source Read-Only Estimate

Command shape used on <PROD_HOST>:

```bash
node scripts/ats-estimate-net-new.js --source=<source> --limit=50 --include-disabled --json --statement-timeout-ms=60000
```

This command fetched and parsed source targets but did not write postings, did not enable sources, and did not index anything.

| Source | Configured targets | Targets sampled | Rows parsed | Clean candidates | Net-new clean | Quarantine | Main quality risk | Threshold decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `jobvite` | 454 | 50 | 1,039 | 1,038 | 1,038 | 1 | 27.1% missing any geo, 18.8% unknown remote, 0 no-geo/no-remote among net-new clean rows | Best first candidate. Passes the sampled row/source quality shape, but should run full inventory or bounded canary only after approval. |
| `eightfold` | 56 | 50 | 409 | 409 | 399 | 0 | 20.1% missing any geo, 1.8% unknown remote, 2 fetch failures | Quality looks good, but source-module fixtures are missing. Add fixtures/module certification before enablement. |
| `jobaps` | 15 | 15 | 1,080 | 824 | 824 | 256 | 51.1% missing any geo, 49.3% unknown remote, 5.58% no-geo/no-remote among net-new clean rows | Do not enable yet. It is just over the no-geo/no-remote threshold and lacks source-module fixtures. |
| `hirebridge` | 169 | 50 | 4,246 | 4,168 | 4,167 | 78 | 100% missing any geo, 97.3% unknown remote | Do not enable yet. High volume, but source-level quality fails until geo/remote normalization is fixed. |

### Four-Source Decision

1. `jobvite`: candidate for the next guarded wave.
2. `eightfold`: candidate after source-module fixtures and invalid-shape tests.
3. `jobaps`: fix source-module fixtures plus geo/remote proof before promotion.
4. `hirebridge`: fix country/region and remote evidence before promotion despite strong volume.

## Nine Disabled Zero-Target Sources

Production `ats_sources` has these sources disabled with `protection_status = normal`, but `companies` has zero configured targets:

- `adp_myjobs`
- `calcareers`
- `calopps`
- `governmentjobs`
- `k12jobspot`
- `policeapp`
- `schoolspring`
- `statejobsny`
- `usajobs`

Root cause: `server/ingestion/sourceRunner.js` discovers targets only from the `companies` table. Legacy sync code in `server/index.js` can inject dynamic public-board targets for several of these sources, but the newer source runner, estimator, and inventory scan do not create virtual targets for them. So the modern safe tooling sees zero targets even when legacy collectors exist.

## Zero-Target Virtual Probe Findings

The virtual probe called known public entrypoints in memory only. It did not insert company rows or postings.

| Source | Probe result | Current blocker |
| --- | --- | --- |
| `governmentjobs` | 23 rows collected; all quarantined | Parser has usable URL/location, but normalized rows miss `source_job_id`. Extract `/jobs/<id>` into source id. |
| `k12jobspot` | 1,671 rows collected; first 300 evaluated; all quarantined | Parser has usable URL/location, but normalized rows miss `source_job_id`. Extract `/Job/Detail/<id>`. |
| `calcareers` | 96 rows collected; all quarantined | Parser has usable `JobControlId` in URL, but normalized rows miss `source_job_id`. Also needs county/state normalization. |
| `schoolspring` | Direct API probe returned JSON 200 with `jobsList` and `jobId`; full collector hit timeout | Needs bounded page/row limits in safe tooling and `jobId` as source id. |
| `policeapp` | 403 challenge response | Keep disabled unless a compliant non-bypass access path exists. Do not try to evade WAF. |
| `usajobs` | Current HTML/token collector failed: request verification token missing | Replace with official USAJOBS API. It requires API key and proper headers. |
| `calopps` | 403 response | Keep disabled until access path is reviewed. Do not bypass protections. |
| `statejobsny` | Current endpoint returned zero rows | Needs endpoint/parameter refresh and fixture proof. |
| `adp_myjobs` | Generic target returned zero rows | Requires company-specific MyJobs tenant URLs; cannot use a single generic virtual target. |

## Parser Reorganization Plan

No source should be enabled until the safe tooling can prove the same thing it will write.

1. Add virtual target discovery to `sourceRunner` for public aggregate boards:
   - `governmentjobs`
   - `k12jobspot`
   - `schoolspring`
   - `calcareers`
   - `statejobsny`
   - optionally `usajobs` after official API config exists
2. Add or repair source job id extraction in the parser/normalization path:
   - GovernmentJobs: `/jobs/<id>`
   - K12JobSpot: `/Job/Detail/<id>`
   - SchoolSpring: `jobId`
   - CalCareers: `JobControlId`
   - StateJobsNY: `id`
3. Convert fallback-only sources to source modules with:
   - raw list fixture
   - raw detail fixture when needed
   - expected normalized fixture
   - invalid-shape rejection/quarantine fixture
4. Run `ats:estimate-net-new` and `ats:inventory:scan` against the source runner, not legacy sync-only code.
5. Enable or canary only sources that pass the thresholds with real evidence.

## Markdown Evidence Strategy

Use Markdown as an evidence/review layer, not as a replacement for structured parsing.

For every parser candidate, generate bounded source evidence snapshots:

```markdown
## <source> / <source_job_id>

- Source URL:
- Canonical URL:
- Raw title:
- Raw company/agency:
- Raw location:
- Parsed city:
- Parsed region:
- Parsed country:
- Raw posted/open date:
- Parsed posted epoch:
- Remote evidence:
- Parser version:
- Quality gate:
- Missing fields:

### Description excerpt

<plain text excerpt capped to a safe length>
```

Rules:

- Markdown can help reviewers and Notion documentation see what the ATS actually exposed.
- Public index fields must still come from deterministic parsers and the public gate.
- Do not use Markdown/LLM inference to invent country, region, city, remote mode, posting date, or source id.
- Store only bounded samples, not every production job row, unless a separate storage budget and privacy review is approved.

## External Research Notes

- USAJOBS has an official REST API at `https://data.usajobs.gov/api/Search`; search requires API key authentication and supports paging. Use this instead of scraping the current HTML token flow.
- Jobvite documentation confirms hosted career site URLs under `jobs.jobvite.com/<company>`, and Jobvite has XML/JSON feed options for customer career-site integrations. Prefer official feed where a public feed URL is discoverable; otherwise keep fixture-backed HTML parsing.
- Eightfold has official authenticated APIs for platform integrations. Public career pages also expose observed careers/job API patterns, but source enablement needs fixture proof per tenant shape.
- GovernmentJobs, PoliceApp, CalOpps, SchoolSpring, K12JobSpot, CalCareers, and StateJobsNY are public job boards or public-sector boards; access must respect published public endpoints and should not bypass anti-bot or WAF challenges.

## Tooling Gaps

- GitHub MCP connector failed with upstream connection refused before repository search.
- `gh` CLI is not installed on this machine.
- Notion MCP connector failed with upstream connection refused before the enhanced Markdown spec could be fetched, so this local Markdown report is the documentation fallback.

## Safe Next Steps

1. Implement source id extraction for the zero-target public boards.
2. Add virtual target discovery to the source runner so zero-target boards can be audited by the same safe tools as company-backed ATS sources.
3. Add `eightfold` source module fixtures.
4. Improve `hirebridge` country/region and explicit remote evidence extraction before considering it for enablement.
5. Re-run read-only estimates and inventory scans.
6. Request explicit approval before any source enablement, canary, apply, or indexing.
