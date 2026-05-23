# ATS Parser Modularization Implementation Plan

> **Status - May 24, 2026:** Completed and superseded by the implemented architecture. The original checklist below is historical execution context. Current canonical state: ATS posting parsers live in `server/ingestion/sources/<ats>/parse.js`, shared parser helpers live in `server/ingestion/parsers/shared/`, and `server/index.js` remains API/bootstrap plus legacy collector/discovery/fetch orchestration. Future work should move collectors out of `server/index.js` and keep parser fixes inside the relevant source module with fixtures.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ApplyToJob and Breezy parser logic out of `server/index.js` into focused ATS source modules without changing runtime behavior, then prepare a clean lane for fixture-backed parser quality fixes.

**Architecture:** Use a strangler pattern. First add source-owned `parse.js` modules and redirect the source registry to them, while preserving compatibility exports from `server/index.js` only where needed. Parser quality fixes are separate tasks after extraction parity is proven.

**Tech Stack:** Node.js CommonJS modules, built-in `node:test`, existing OpenJobSlots parser/source test suites, Postgres/Meili read-only production audits after explicit deploy approval.

---

## Preflight: Protect The Current Worktree

**Files:**
- Inspect: `server/index.js`
- Inspect: `docs/superpowers/specs/2026-05-23-ats-parser-modularization-design.md`
- Inspect: `docs/superpowers/plans/2026-05-23-ats-parser-modularization.md`

- [ ] **Step 1: Confirm current branch and dirty files**

Run:

```powershell
git status --short --branch
git diff --name-only
```

Expected:

```text
## main...origin/main
 M server/index.js
```

If `server/index.js` is still modified before implementation, do not stage it blindly. Either move implementation to an isolated worktree or explicitly separate/clean that formatting-only diff with user approval.

- [ ] **Step 2: Create an isolated implementation branch or worktree**

Preferred branch name:

```text
codex/ats-parser-modularization
```

Use an isolated worktree if the current checkout still has unrelated dirty changes. If working in-place, create the branch only after the unrelated diff is resolved.

- [ ] **Step 3: Run a small parser baseline**

Run:

```powershell
node --test server\ingestion\direct-parser-fixtures.test.js --test-name-pattern "applytojob|breezy"
node --test server\ingestion\sources\htmlPublicSourceModules.test.js --test-name-pattern "applytojob|breezy"
```

Expected: both commands pass before extraction. If they fail, stop and record baseline failures before editing.

---

## Task 1: Extract ApplyToJob Parser Into Source Module

**Files:**
- Create: `server/ingestion/sources/applytojob/parse.js`
- Modify: `server/ingestion/sources/applytojob/index.js`
- Modify: `server/ingestion/sources/common.js`
- Modify: `server/index.js`
- Test: `server/ingestion/direct-parser-fixtures.test.js`
- Test: `server/ingestion/sources/htmlPublicSourceModules.test.js`

- [ ] **Step 1: Create the parser module shell**

Create `server/ingestion/sources/applytojob/parse.js` with the parser-local helper block moved from `server/index.js`.

The module must export:

```js
module.exports = {
  cleanApplyToJobText,
  extractApplyToJobRemoteTypeFromValue,
  parseApplyToJobPostingsFromHtml
};
```

Move these ApplyToJob functions and constants from `server/index.js` into the new module:

```text
cleanApplyToJobText
extractApplyToJobIconField
extractApplyToJobLabeledField
APPLYTOJOB_LABELS
extractApplyToJobStructuredLabeledField
cleanApplyToJobStructuredValue
firstApplyToJobStructuredCountry
extractApplyToJobRemoteTypeFromValue
extractApplyToJobJsonLdFieldsFromObject
collectApplyToJobJsonLdPostings
applyToJobDetailKey
lookupApplyToJobDetailHtml
extractApplyToJobDetailFieldsFromHtml
extractApplyToJobSourceId
extractApplyToJobLabeledRemoteType
applyToJobSourceFailureReasons
enrichApplyToJobPosting
parseApplyToJobPostingsFromHtml
```

Also move any direct parser dependencies that are private to this block. If a dependency is shared with other parsers, import it from `server/index.js` only as a temporary compatibility bridge and record it in the PR summary.

- [ ] **Step 2: Export ApplyToJob parser through the source folder**

Update `server/ingestion/sources/applytojob/index.js` from:

```js
const { createSourceModule } = require("../common");

module.exports = createSourceModule("applytojob");
```

to:

```js
const { createSourceModule } = require("../common");
const parser = require("./parse");

module.exports = {
  ...createSourceModule("applytojob"),
  ...parser
};
```

- [ ] **Step 3: Redirect common registry import**

In `server/ingestion/sources/common.js`, replace the ApplyToJob parser import from `../../index` with:

```js
const {
  parseApplyToJobPostingsFromHtml
} = require("./applytojob/parse");
```

Keep all existing fetch/detail prioritization logic in `common.js` unchanged in this task.

- [ ] **Step 4: Preserve compatibility exports only if needed**

If tests or legacy scripts still import `parseApplyToJobPostingsFromHtml` from `server/index.js`, change the `server/index.js` export to re-export from the new module:

```js
const {
  parseApplyToJobPostingsFromHtml
} = require("./ingestion/sources/applytojob/parse");
```

Do not keep duplicate parser implementations in both files.

- [ ] **Step 5: Run targeted ApplyToJob tests**

Run:

```powershell
node --test server\ingestion\direct-parser-fixtures.test.js --test-name-pattern "applytojob"
node --test server\ingestion\sources\htmlPublicSourceModules.test.js --test-name-pattern "applytojob"
```

Expected: all ApplyToJob-targeted tests pass with unchanged assertions.

- [ ] **Step 6: Commit ApplyToJob extraction**

Stage only extraction files:

```powershell
git add server\ingestion\sources\applytojob\parse.js server\ingestion\sources\applytojob\index.js server\ingestion\sources\common.js server\index.js
git commit -m "Extract ApplyToJob parser module"
```

Do not include unrelated formatting-only changes from `server/index.js` unless the extraction intentionally removed those exact lines.

---

## Task 2: Extract Breezy Parser Into Source Module

**Files:**
- Create: `server/ingestion/sources/breezy/parse.js`
- Modify: `server/ingestion/sources/breezy/index.js`
- Modify: `server/ingestion/sources/common.js`
- Modify: `server/index.js`
- Test: `server/ingestion/direct-parser-fixtures.test.js`
- Test: `server/ingestion/sources/htmlPublicSourceModules.test.js`

- [ ] **Step 1: Create the parser module shell**

Create `server/ingestion/sources/breezy/parse.js` with the parser-local helper block moved from `server/index.js`.

The module must export:

```js
module.exports = {
  cleanBreezyText,
  breezyLocationLooksNarrativeText,
  cleanBreezyLocationText,
  parseBreezyPostingsFromHtml
};
```

Move these Breezy functions and constants from `server/index.js` into the new module:

```text
cleanBreezyText
breezyLocationLooksNarrativeText
cleanBreezyLocationText
BREEZY_POLYGOT_LABELS
translateBreezyPolygotLabels
extractBreezySourceId
canonicalBreezyDetailKey
lookupBreezyDetailHtml
extractBreezyLabeledField
extractBreezyRemoteTypeFromValue
extractBreezyLabeledRemoteType
extractBreezyDetailFieldsFromHtml
extractBreezyListSegment
extractBreezyListLocation
extractBreezyListGroupHeader
extractBreezyListTitle
parseBreezyPostingsFromHtml
```

Also move any private helper used only by Breezy. Shared helpers should be imported through a temporary compatibility bridge only if extracting them would widen the task.

- [ ] **Step 2: Export Breezy parser through the source folder**

Update `server/ingestion/sources/breezy/index.js` from:

```js
const { createSourceModule } = require("../common");

module.exports = createSourceModule("breezy");
```

to:

```js
const { createSourceModule } = require("../common");
const parser = require("./parse");

module.exports = {
  ...createSourceModule("breezy"),
  ...parser
};
```

- [ ] **Step 3: Redirect common registry import**

In `server/ingestion/sources/common.js`, replace the Breezy parser import from `../../index` with:

```js
const {
  parseBreezyPostingsFromHtml
} = require("./breezy/parse");
```

Keep existing Breezy detail prioritization in `common.js` unchanged in this task.

- [ ] **Step 4: Preserve compatibility exports only if needed**

If tests or legacy scripts still import `parseBreezyPostingsFromHtml` from `server/index.js`, re-export from the new module:

```js
const {
  parseBreezyPostingsFromHtml
} = require("./ingestion/sources/breezy/parse");
```

Do not keep duplicate parser implementations.

- [ ] **Step 5: Run targeted Breezy tests**

Run:

```powershell
node --test server\ingestion\direct-parser-fixtures.test.js --test-name-pattern "breezy"
node --test server\ingestion\sources\htmlPublicSourceModules.test.js --test-name-pattern "breezy"
```

Expected: all Breezy-targeted tests pass with unchanged assertions.

- [ ] **Step 6: Commit Breezy extraction**

```powershell
git add server\ingestion\sources\breezy\parse.js server\ingestion\sources\breezy\index.js server\ingestion\sources\common.js server\index.js
git commit -m "Extract Breezy parser module"
```

---

## Task 3: Full Extraction Verification

**Files:**
- Verify: `server/index.js`
- Verify: `server/ingestion/sources/common.js`
- Verify: `server/ingestion/sources/applytojob/parse.js`
- Verify: `server/ingestion/sources/breezy/parse.js`

- [ ] **Step 1: Confirm parser dependency direction**

Run:

```powershell
rg -n "parseApplyToJobPostingsFromHtml|parseBreezyPostingsFromHtml" server\index.js server\ingestion\sources\common.js server\ingestion\sources\applytojob server\ingestion\sources\breezy
```

Expected:

- `parseApplyToJobPostingsFromHtml` implementation exists only in `server/ingestion/sources/applytojob/parse.js`.
- `parseBreezyPostingsFromHtml` implementation exists only in `server/ingestion/sources/breezy/parse.js`.
- `server/ingestion/sources/common.js` imports both from source folders.
- `server/index.js` has no duplicate implementation.

- [ ] **Step 2: Run parser and backend suites**

Run:

```powershell
npm.cmd run test:parsers
npm.cmd run test:worker-backlog
npm.cmd run test:backend
git diff --check
```

Expected: all commands pass. `git diff --check` may show line-ending warnings only if already present; whitespace errors must be fixed.

- [ ] **Step 3: Commit final extraction verification if any test-only edits were needed**

If tests required import path updates, commit them separately:

```powershell
git add server\ingestion\direct-parser-fixtures.test.js server\ingestion\sources\htmlPublicSourceModules.test.js
git commit -m "Update parser tests for source modules"
```

Skip this commit if no test files changed.

---

## Task 4: Apply Antigravity Parser Hypotheses After Extraction

**Files:**
- Modify: `server/ingestion/sources/applytojob/parse.js`
- Modify: `server/ingestion/sources/breezy/parse.js`
- Test: `server/ingestion/direct-parser-fixtures.test.js`
- Test: `server/ingestion/sources/htmlPublicSourceModules.test.js`

- [ ] **Step 1: Add failing ApplyToJob ambiguity fixture**

Add a test showing that parenthesized multi-location text is not treated as concrete geo evidence:

```js
test("applytojob parser flags parenthesized multiple-state location as ambiguous evidence", () => {
  const parsed = parseApplyToJobPostingsFromHtml("Fixture ApplyToJob", {
    baseOrigin: "https://fixture.applytojob.com"
  }, `
    <li class="list-group-item">
      <h3 class="list-group-item-heading"><a href="/job/ATJ-MULTI">Field Specialist</a></h3>
      <i class="fa fa-map-marker"></i> (Multiple states)
    </li>
  `);
  assert.equal(parsed.length, 1);
  assert.ok(parsed[0].source_failure_reasons.includes("ambiguous_location"));
});
```

Run:

```powershell
node --test server\ingestion\direct-parser-fixtures.test.js --test-name-pattern "applytojob parser flags parenthesized"
```

Expected before fix: fail if current parser does not mark the row ambiguous.

- [ ] **Step 2: Fix ApplyToJob ambiguity without inventing geo or remote**

In `server/ingestion/sources/applytojob/parse.js`, update the ambiguity detection used by `applyToJobSourceFailureReasons()` so it treats these normalized values as ambiguous:

```text
(multiple states)
multiple states
multiple locations
multiple countries
multiple cities
multiple regions
multiple areas
various locations
all locations
anywhere
global
tbd
to be determined
```

The fix must add `ambiguous_location` and must not set `remote_type`, `country`, `region`, or `city`.

- [ ] **Step 3: Add failing Breezy short-boilerplate fixture**

Add a test showing that short non-location boilerplate is rejected as list location evidence:

```js
test("breezy parser drops short boilerplate from location evidence", () => {
  const parsed = parseBreezyPostingsFromHtml("Fixture Breezy", {
    origin: "https://fixture.breezy.hr"
  }, `
    <a href="/p/boilerplate-role">
      <h2>Program Coordinator</h2>
      <ul>
        <li class="location">Number of positions: 1</li>
      </ul>
    </a>
  `);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].location, null);
});
```

Run:

```powershell
node --test server\ingestion\direct-parser-fixtures.test.js --test-name-pattern "breezy parser drops short boilerplate"
```

Expected before fix: fail if current parser keeps the boilerplate as `location`.

- [ ] **Step 4: Fix Breezy short-boilerplate filtering**

In `server/ingestion/sources/breezy/parse.js`, update `breezyLocationLooksNarrativeText()` or `cleanBreezyLocationText()` to reject short location values matching these markers:

```text
number of positions
employment terms
flexible start
terms of service
americorps
duration:
responsibilities:
requirements:
```

The fix must return an empty location string and must not infer city/country/remote.

- [ ] **Step 5: Run quality-fix verification**

Run:

```powershell
node --test server\ingestion\direct-parser-fixtures.test.js --test-name-pattern "applytojob|breezy"
node --test server\ingestion\sources\htmlPublicSourceModules.test.js --test-name-pattern "applytojob|breezy"
npm.cmd run test:parsers
npm.cmd run test:backend
```

Expected: all commands pass.

- [ ] **Step 6: Commit parser quality fixes**

```powershell
git add server\ingestion\sources\applytojob\parse.js server\ingestion\sources\breezy\parse.js server\ingestion\direct-parser-fixtures.test.js server\ingestion\sources\htmlPublicSourceModules.test.js
git commit -m "Harden ApplyToJob and Breezy parser evidence"
```

---

## Task 5: PR And Production-Safe Closeout

**Files:**
- Verify: `docs/superpowers/specs/2026-05-23-ats-parser-modularization-design.md`
- Verify: `docs/superpowers/plans/2026-05-23-ats-parser-modularization.md`

- [ ] **Step 1: Summarize changed surface**

Run:

```powershell
git log --oneline main..HEAD
git diff --stat main..HEAD
```

Expected: commits are focused on parser modularization and parser evidence hardening.

- [ ] **Step 2: Push branch**

Run:

```powershell
git push -u origin codex/ats-parser-modularization
```

- [ ] **Step 3: Open a draft PR**

PR title:

```text
Modularize ApplyToJob and Breezy parser logic
```

PR body:

```markdown
## Summary
- Moves ApplyToJob and Breezy parser logic out of `server/index.js` into source-owned parser modules.
- Keeps extraction behavior-preserving before applying parser quality hardening.
- Adds fixture-backed coverage for ApplyToJob ambiguous multi-location evidence and Breezy short-boilerplate location leakage.

## Safety
- No production source apply, backfill, cleanup, public-row delete/hide, or Meili replace reindex.
- Postgres remains source of truth; Meili remains derived.
- Public endpoint compatibility is unchanged.

## Tests
- `npm.cmd run test:parsers`
- `npm.cmd run test:worker-backlog`
- `npm.cmd run test:backend`
- `git diff --check`
```

- [ ] **Step 4: Deploy only after explicit approval**

Do not deploy from this plan unless the user explicitly approves production deployment. If deploy is approved later, run read-only verification after deploy:

```bash
curl -fsS http://127.0.0.1:8081/health
docker exec openjobslots-app npm run audit:worker-backlog -- --diagnostics --targets=applytojob,breezy,careerplug,greenhouse --json
docker exec openjobslots-app npm run audit:source-freshness -- --json
docker exec openjobslots-app npm run search:reindex:check -- --json
```
