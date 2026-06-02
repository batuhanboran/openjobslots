# OpenJobSlots 100k Index And 1k Daily Freshness Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move OpenJobSlots from roughly 51k visible postings to a reliable 100k public index while keeping daily freshness near 1k safe updates and reducing missing geo/remote gaps.

**Architecture:** Keep Postgres as source of truth and Meilisearch as derived public search. Improve parser/source quality first, then expand certified sources through inventory, canary, guarded apply, and parity checks. Treat Markdown evidence as a review artifact only; indexed fields must come from deterministic parsers.

**Tech Stack:** Node.js, Express, Postgres, Meilisearch, source-runner ATS modules, Playwright, Docker Compose on production.

---

## Current Baseline

Fresh read-only production evidence from May 18, 2026:

- Visible postings: `50,890`.
- Postgres indexable rows: `50,888`.
- Meilisearch documents: `50,888`.
- Meili/Postgres delta: `0`.
- New rows in 24h: `242`.
- Rows seen in 24h: `852`.
- Rows seen in 3d: `852`.
- Newest `last_seen`: `2026-05-18 14:15:26Z`.
- Worker is running with a `1000` daily target budget.
- Recent worker success rate is about `51%` targets, so the scale blocker is parser/source reliability, not only scheduler capacity.

Current data-quality gaps:

- Missing any normalized geo: `8,047` / `15.81%`.
- Weak or unknown remote: `2,160` / `4.24%`.
- Missing all geo plus weak/unknown remote: `23`.

## Decision Boundaries

- Do not lower thresholds to reach 100k.
- Do not invent country, region, city, remote mode, posting date, or source id.
- Do not run `ats:source:apply`, `ats:source:canary`, broad write backfills, clean rebuilds, or Meili replace reindex without explicit approval, backup, and a scoped source plan.
- Do not enable a source from sampled volume alone.
- Every promotion must keep Meili/Postgres delta at `0` and must not add `no_geo_no_remote` public rows.

## File Structure

- Modify: `server/ingestion/sourceRunner.js`
  - Add virtual target discovery for public-board sources that currently have zero company targets.
- Modify: `server/index.js`
  - Extract deterministic source ids and normalized location evidence where legacy collectors still own parsing.
- Modify: `server/ingestion/sources/*.js`
  - Add or repair source modules for disabled/source-gap candidates.
- Create/modify: `server/ingestion/fixtures/*`
  - Add raw and expected normalized fixtures for every source promoted through the roadmap.
- Modify: `scripts/ats-estimate-net-new.js`
  - Add background/report mode so all-source disabled estimates finish without interactive timeouts.
- Modify: `scripts/ats-inventory-scan.js`
  - Ensure target caps, resume state, and source buckets are explicit in JSON output.
- Modify: `docs/reference/ats-adapter-matrix.md`
  - Record source status changes, blockers, and official API choices.
- Modify: `docs/reference/data-quality-runbook.md`
  - Document the 30-day, by-source, by-parser audit path.
- Modify: `handoff.md` and `docs/PROJECT_STATE.md`
  - Update live evidence after each source wave.
- Test: `server/ingestion/direct-parser-fixtures.test.js`
- Test: `server/ingestion/sourceRunner.test.js`
- Test: `scripts/ats-estimate-net-new.test.js`
- Test: `scripts/ats-inventory-scan.test.js`

---

### Task 1: Release Hygiene And Main Alignment

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `app.json`
- Modify: `App.js`
- Modify: `docs/PROJECT_STATE.md`
- Modify: `handoff.md`

- [ ] **Step 1: Verify branch state**

Run:

```powershell
git status --short --branch
git log --oneline --decorate --max-count 12
git rev-parse origin/main
git rev-parse HEAD
```

Expected: the current branch contains the deployed May 18 recovery commits and `origin/main` is an ancestor before the final fast-forward.

- [ ] **Step 2: Verify no secret-bearing docs are staged**

Run:

```powershell
rg -n "cfk_|cfut_|OPENJOBSLOTS_POSTGRES_PASSWORD|MEILI_MASTER_KEY|DATABASE_URL|OPENJOBSLOTS_ADMIN_TOKEN|SENTRY_AUTH_TOKEN|Bearer|password|secret" docs package.json package-lock.json handoff.md
```

Expected: no raw credential value appears. Mentions of variable names in runbooks are acceptable.

- [ ] **Step 3: Run docs/version verification**

Run:

```powershell
git diff --check
npm.cmd run test:backend
```

Expected: whitespace check passes and backend parser/search safety tests pass.

- [ ] **Step 4: Publish release hygiene**

Run after tests pass:

```powershell
git add package.json package-lock.json docs handoff.md
git commit -m "chore: refresh project state and scale roadmap"
git push origin codex/production-baseline-audit
git switch main
git pull --ff-only origin main
git merge --ff-only codex/production-baseline-audit
git push origin main
git tag v1.9.3
git push origin v1.9.3
git switch codex/production-baseline-audit
```

Expected: `main` points to the same commit as the recovery branch and tag `v1.9.3` points to that commit.

### Task 2: Live Freshness Control Loop

**Files:**
- Modify: `scripts/audit-source-freshness.js`
- Modify: `docs/reference/ingestion-runbook.md`
- Modify: `docs/reference/data-quality-runbook.md`

- [ ] **Step 1: Capture baseline before scheduler changes**

Run on production:

```bash
cd /app
npm run search:parity -- --json
npm run audit:data-quality -- --json --by-source --by-parser --last-seen-days=30
npm run audit:source-freshness -- --json --last-seen-days=30
```

Expected: search delta is `0`, visible rows are non-decreasing, and source due counts are reported without writes.

- [ ] **Step 2: Add daily source health summary**

Add a report section to `audit-source-freshness` that emits:

```json
{
  "daily_target_budget": 1000,
  "targets_due": 27975,
  "targets_processed_24h": 125,
  "target_success_pct_24h": 51.2,
  "rows_seen_24h": 852,
  "rows_new_24h": 242,
  "top_failure_sources": []
}
```

Expected: the script reports worker throughput without starting or stopping the worker.

- [ ] **Step 3: Gate budget changes**

Document this gate in `docs/reference/ingestion-runbook.md`:

```text
Increase worker target budget only when target success is >= 80%, Meili/Postgres delta is 0, no heavy job is active, and the last 24h adds 0 new no_geo_no_remote public rows.
```

Expected: budget changes are controlled by measured parser/source health.

### Task 3: Live Source Gap Cleanup Wave

**Files:**
- Modify: `server/index.js`
- Modify: `server/ingestion/sources/*.js`
- Modify: `server/ingestion/fixtures/*`
- Test: `server/ingestion/direct-parser-fixtures.test.js`
- Test: `server/ingestion/sources/directSourceModules.test.js`
- Test: `server/ingestion/sources/enterpriseSourceModules.test.js`

- [ ] **Step 1: Start with the highest public gap sources**

Work in this order:

```text
applytojob -> greenhouse -> ashby -> hrmdirect -> bamboohr -> careerplug -> lever
```

Expected: each source gets a fresh raw fixture, normalized expected fixture, invalid-shape fixture, and a parser test before parser code changes.

- [ ] **Step 2: Prove missing fields are absent before leaving them blank**

For each fixture, record:

```text
source_url
source_job_id
raw_title
raw_company
raw_location
raw_posted_date
parsed_city
parsed_region
parsed_country
remote_evidence
posted_at_epoch
parser_version
quality_gate
```

Expected: null fields are justified by missing source evidence, not by parser omission.

- [ ] **Step 3: Run source-specific dry-run only**

Run:

```powershell
npm.cmd run test:parsers
npm.cmd run test:backend
```

Run on production when code is deployed for read-only validation:

```bash
npm run ats:estimate-net-new -- --source=<source> --limit=250 --company-limit=250 --json
```

Expected: no public writes; estimates show reduced missing-geo/remote risk before any canary is requested.

### Task 4: Disabled Candidate Certification Wave

**Files:**
- Modify: `server/ingestion/sources/*.js`
- Modify: `server/ingestion/fixtures/jobvite-*`
- Modify: `server/ingestion/fixtures/eightfold-*`
- Modify: `docs/reference/ats-adapter-matrix.md`

- [ ] **Step 1: Certify Jobvite**

Run:

```bash
npm run ats:inventory:scan -- --source=jobvite --company-limit=454 --json
npm run ats:estimate-net-new -- --source=jobvite --include-disabled --limit=454 --company-limit=454 --json
```

Expected: full inventory evidence proves net-new candidates, missing-any-geo risk, weak/unknown remote risk, and no-geo/no-remote count.

- [ ] **Step 2: Certify Eightfold**

Run:

```powershell
npm.cmd run test:parsers
npm.cmd run test:backend
```

Then run on production:

```bash
npm run ats:inventory:scan -- --source=eightfold --company-limit=56 --json
npm run ats:estimate-net-new -- --source=eightfold --include-disabled --limit=56 --company-limit=56 --json
```

Expected: eightfold has source-module fixtures and full inventory evidence before canary approval.

### Task 5: Blocked High-Volume Repair Wave

**Files:**
- Modify: `server/ingestion/sources/*.js`
- Modify: `server/index.js`
- Modify: `server/ingestion/fixtures/*`

- [ ] **Step 1: Keep Hirebridge blocked until geo/remote risk is fixed**

Run:

```bash
npm run ats:estimate-net-new -- --source=hirebridge --include-disabled --limit=50 --company-limit=50 --json
```

Expected before enablement: missing-any-geo is no longer near `100%`, weak/unknown remote is no longer near `97%`, and no-geo/no-remote candidates are `0`.

- [ ] **Step 2: Keep JobAps blocked until no-geo/no-remote risk drops**

Run:

```bash
npm run ats:estimate-net-new -- --source=jobaps --include-disabled --limit=15 --company-limit=15 --json
```

Expected before enablement: no-geo/no-remote candidates are `0`, and source module fixtures prove source id, posted date, and location extraction.

### Task 6: Zero-Target Public Board Support

**Files:**
- Modify: `server/ingestion/sourceRunner.js`
- Modify: `server/index.js`
- Modify: `server/ingestion/fixtures/governmentjobs-*`
- Modify: `server/ingestion/fixtures/k12jobspot-*`
- Modify: `server/ingestion/fixtures/schoolspring-*`
- Modify: `server/ingestion/fixtures/calcareers-*`
- Modify: `docs/reference/ats-adapter-matrix.md`

- [ ] **Step 1: Add virtual target discovery**

Add source-runner virtual targets for:

```text
governmentjobs
k12jobspot
schoolspring
calcareers
statejobsny
usajobs
```

Expected: `ats:estimate-net-new -- --source=<source> --include-disabled --limit=25 --json` no longer reports `0` targets only because `companies` lacks tenant rows.

- [ ] **Step 2: Extract deterministic source IDs**

Use these source ids where present:

```text
governmentjobs: /jobs/<id>
k12jobspot: /Job/Detail/<id>
schoolspring: jobId
calcareers: JobControlId
statejobsny: id
usajobs: DocumentID
```

Expected: parser validation no longer quarantines rows only because source id was missing.

- [ ] **Step 3: Use USAJOBS official API**

Implement USAJOBS through `https://data.usajobs.gov/api/Search` with configured `Host`, `User-Agent`, and `Authorization-Key` headers from a non-committed environment secret.

Expected: no HTML verification-token scraping for USAJOBS.

### Task 7: Background All-Source Estimator

**Files:**
- Modify: `scripts/ats-estimate-net-new.js`
- Modify: `server/ingestion/netNewEstimator.js`
- Modify: `scripts/ats-estimate-net-new.test.js`
- Modify: `docs/reference/data-quality-runbook.md`

- [ ] **Step 1: Add resumable report mode**

Add:

```text
--all --include-disabled --limit=25 --json --output=reports/ats-estimate-all-<timestamp>.json --resume
```

Expected: the command can resume after timeout and writes partial source buckets without writing postings.

- [ ] **Step 2: Emit source buckets**

Emit:

```text
pass_candidate
parser_quality_fix
geo_remote_fix
blocked_fetch
zero_virtual_target
timeout
```

Expected: daily planning can rank sources without reading raw logs.

### Task 8: Promotion Gate

**Files:**
- Modify: `docs/reference/ingestion-runbook.md`
- Modify: `docs/reference/search-quality-runbook.md`
- Modify: `docs/PROJECT_STATE.md`
- Modify: `handoff.md`

- [ ] **Step 1: Run pre-write release checks**

Run before any source canary/apply:

```bash
npm run ats:recovery:preflight
npm run ats:plan-batches
npm run search:parity
```

Expected: fresh backup is present, heavy-job lock is clear, Meili/Postgres delta is `0`, and batch plan is bounded.

- [ ] **Step 2: Require explicit source approval**

Approval must name:

```text
source key
mode: canary or apply
target limit
expected accepted row gain
expected quality risk
rollback path
backup path
```

Expected: broad indexing never starts from a sampled dry-run alone.

## 100k Feasibility

The 100k target is feasible if source certification creates roughly `49k` additional public-safe rows. The current evidence suggests:

- `jobvite` can be a first disabled-source candidate after full inventory.
- `eightfold` can follow after fixtures and full inventory.
- `hirebridge` has large volume but fails geo/remote quality and must not be indexed yet.
- Public-board virtual targets can unlock volume, but only after deterministic source id and location parsing are fixture-backed.
- Live sources can contribute more freshness, but first need parser drift and missing-geo cleanup to raise worker target success above `80%`.

## 1k Daily Freshness Feasibility

The worker budget is already configured for `1000` targets/day, but recent success is too low. The practical path is:

1. Reduce parser drift and fetch failures for active sources.
2. Keep target batches small until success is stable.
3. Raise per-run target count only when target success is at least `80%`.
4. Use read-only source freshness reports to avoid starving stale sources.
5. Keep 30-day pruning based on `last_seen_epoch`.

## Validation Set

Run after code changes:

```powershell
npm.cmd run test:backend
npm.cmd run test:parsers
npm.cmd run test:api
npm.cmd run quality:gate
```

Run after source or search deployment:

```bash
curl -fsS http://127.0.0.1:8081/health
npm run search:parity -- --json
npm run audit:data-quality -- --json --by-source --by-parser --last-seen-days=30
npm run audit:source-freshness -- --json --last-seen-days=30
```
