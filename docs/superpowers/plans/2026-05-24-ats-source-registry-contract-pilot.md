# ATS Source Registry Contract Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the OpenJobSlots source registry contract and prove it with Greenhouse and iCIMS before family-wide parallel implementation.

**Architecture:** Add contract validation and a registry wrapper that can accept current source modules without changing public behavior. Route only Greenhouse and iCIMS through the registry-backed path first, keep legacy fallback for all other sources, and extend the audit so ATS endpoint logic cannot return to `server/index.js`.

**Tech Stack:** Node.js CommonJS, `node:test`, existing source modules under `server/ingestion/sources/`, `npm.cmd run test:backend`, and the existing architecture audit.

---

## File Structure

- Create `server/ingestion/sourceContracts.js`: source contract constants, shape validation, result helpers, and test-only diagnostics.
- Create `server/ingestion/sourceContracts.test.js`: contract tests for valid, missing, unsupported, and malformed source modules.
- Create `server/ingestion/sourceRegistry.js`: registry map around `server/ingestion/sources/index.js` with family/status metadata and pilot enablement.
- Create `server/ingestion/sourceRegistry.test.js`: proves Greenhouse and iCIMS are pilot registry-backed and unsupported/missing keys are typed.
- Modify `server/ingestion/sources/greenhouse/index.js`: expose explicit contract fields while preserving existing parser exports.
- Modify `server/ingestion/sources/icims/index.js`: expose explicit contract fields while preserving existing parser exports.
- Modify `server/ingestion/sourceCollectors.js`: delegate only Greenhouse and iCIMS through registry helpers when possible; keep current legacy implementation for all other sources.
- Modify `server/ingestion/sourceCollectors.test.js`: add regression coverage for registry-backed pilot dispatch and legacy fallback.
- Modify `scripts/audit-architecture-boundary.js`: fail on source parser imports and selected ATS endpoint/domain implementation patterns in `server/index.js`.
- Modify `package.json`: include new source contract tests in `test:backend`.

---

## Task 1: Source Contract Validator

**Files:**
- Create: `server/ingestion/sourceContracts.js`
- Create: `server/ingestion/sourceContracts.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing contract test**

Create `server/ingestion/sourceContracts.test.js` with tests equivalent to:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SOURCE_FAMILIES,
  SOURCE_STATUSES,
  createUnsupportedSourceModule,
  validateSourceContract
} = require("./sourceContracts");

test("source contract accepts a complete module", () => {
  const module = {
    atsKey: "greenhouse",
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({ ok: true }),
    fetchList: async () => ({ raw: [] }),
    fetchDetail: async () => null,
    parse: () => [],
    normalize: () => null,
    validate: () => ({ ok: true }),
    rateLimit: { requestsPerMinute: 30 },
    fixtures: { list: "server/ingestion/sources/greenhouse/fixtures/list.json" }
  };

  assert.deepEqual(validateSourceContract(module), { ok: true, failures: [] });
});

test("source contract reports missing required functions", () => {
  const result = validateSourceContract({ atsKey: "broken", family: SOURCE_FAMILIES.directJsonStable });
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("missing discover"));
  assert.ok(result.failures.includes("missing fetchList"));
  assert.ok(result.failures.includes("missing parse"));
  assert.ok(result.failures.includes("missing normalize"));
  assert.ok(result.failures.includes("missing validate"));
});

test("unsupported source module is typed and valid", async () => {
  const source = createUnsupportedSourceModule("dayforcehcm", {
    family: SOURCE_FAMILIES.enterpriseDirect,
    reason: "disabled until raw fixtures exist"
  });

  assert.deepEqual(validateSourceContract(source), { ok: true, failures: [] });
  assert.equal(source.status, SOURCE_STATUSES.unsupported);
  assert.equal((await source.fetchList()).ok, false);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
node server/ingestion/sourceContracts.test.js
```

Expected: fails because `server/ingestion/sourceContracts.js` does not exist.

- [ ] **Step 3: Add the minimal contract module**

Create `server/ingestion/sourceContracts.js` exporting `SOURCE_FAMILIES`, `SOURCE_STATUSES`, `validateSourceContract`, and `createUnsupportedSourceModule`. Required functions are `discover`, `fetchList`, `parse`, `normalize`, and `validate`; `fetchDetail` is optional but should default to an async null function for unsupported modules.

- [ ] **Step 4: Verify green**

Run:

```powershell
node server/ingestion/sourceContracts.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Add backend test wiring**

Add `node --check server/ingestion/sourceContracts.js && node --check server/ingestion/sourceContracts.test.js && node server/ingestion/sourceContracts.test.js` to `test:backend` near other ingestion source tests.

---

## Task 2: Source Registry Pilot Map

**Files:**
- Create: `server/ingestion/sourceRegistry.js`
- Create: `server/ingestion/sourceRegistry.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing registry test**

Create `server/ingestion/sourceRegistry.test.js` that imports `getRegistrySourceModule`, `isRegistryPilotSource`, and `listRegistrySourceModules`. Test that `greenhouse` and `icims` are pilot sources, that their returned modules pass `validateSourceContract`, and that an unknown key returns an unsupported typed module.

- [ ] **Step 2: Run the failing test**

Run:

```powershell
node server/ingestion/sourceRegistry.test.js
```

Expected: fails because `sourceRegistry.js` does not exist.

- [ ] **Step 3: Add the minimal registry**

Create `server/ingestion/sourceRegistry.js`. It should import existing `getSourceModule` from `server/ingestion/sources/index.js`, wrap only `greenhouse` and `icims` as pilot registry-backed modules, and return `createUnsupportedSourceModule()` for missing keys.

- [ ] **Step 4: Verify green**

Run:

```powershell
node server/ingestion/sourceRegistry.test.js
```

Expected: all registry tests pass.

- [ ] **Step 5: Add backend test wiring**

Add `node --check server/ingestion/sourceRegistry.js && node --check server/ingestion/sourceRegistry.test.js && node server/ingestion/sourceRegistry.test.js` to `test:backend`.

---

## Task 3: Greenhouse And iCIMS Explicit Contract Exports

**Files:**
- Modify: `server/ingestion/sources/greenhouse/index.js`
- Modify: `server/ingestion/sources/icims/index.js`
- Test: `server/ingestion/sourceRegistry.test.js`

- [ ] **Step 1: Extend the registry test**

Add assertions that the Greenhouse module reports `atsKey: "greenhouse"`, `family: "direct-json-stable"`, and callable `discover`, `fetchList`, `parse`, `normalize`, and `validate`. Add matching assertions for iCIMS with `family: "embedded-or-semi-structured"`.

- [ ] **Step 2: Run the test and confirm failure if fields are missing**

Run:

```powershell
node server/ingestion/sourceRegistry.test.js
```

Expected: fails on missing explicit metadata if current `createSourceModule()` output does not expose it.

- [ ] **Step 3: Update Greenhouse index**

Modify `server/ingestion/sources/greenhouse/index.js` to build the existing module once, then export it with explicit metadata:

```js
const { SOURCE_FAMILIES, SOURCE_STATUSES } = require("../../sourceContracts");
const { createSourceModule } = require("../common");
const parser = require("./parse");

const sourceModule = createSourceModule("greenhouse");

module.exports = {
  ...sourceModule,
  atsKey: "greenhouse",
  family: SOURCE_FAMILIES.directJsonStable,
  status: SOURCE_STATUSES.enabled,
  ...parser
};
```

- [ ] **Step 4: Update iCIMS index**

Modify `server/ingestion/sources/icims/index.js` the same way, using `atsKey: "icims"` and `family: SOURCE_FAMILIES.embeddedOrSemiStructured`.

- [ ] **Step 5: Verify green**

Run:

```powershell
node server/ingestion/sourceRegistry.test.js
node server/ingestion/sources/directSourceModules.test.js
node server/ingestion/sources/enterpriseSourceModules.test.js
node server/ingestion/sources/htmlPublicSourceModules.test.js
```

Expected: all pass.

---

## Task 4: Registry Dispatch In Source Collectors

**Files:**
- Modify: `server/ingestion/sourceCollectors.js`
- Modify: `server/ingestion/sourceCollectors.test.js`

- [ ] **Step 1: Write failing dispatch tests**

Add tests in `server/ingestion/sourceCollectors.test.js` that create a runtime with a stubbed fetcher and assert that `collectPostingsForCompany()` can collect Greenhouse and iCIMS through the registry-backed path without requiring `server/index.js`.

- [ ] **Step 2: Run failing tests**

Run:

```powershell
node server/ingestion/sourceCollectors.test.js
```

Expected: fails because registry dispatch is not wired.

- [ ] **Step 3: Add minimal registry delegation**

In `sourceCollectors.js`, import `getRegistrySourceModule` and `isRegistryPilotSource`. For `greenhouse` and `icims`, call the registry module's existing `fetchList` and parser/normalizer path instead of the local branch when the module contract validates. Keep all other ATS keys on the current legacy path.

- [ ] **Step 4: Verify green**

Run:

```powershell
node server/ingestion/sourceCollectors.test.js
```

Expected: all source collector tests pass.

---

## Task 5: Architecture Audit Tightening

**Files:**
- Modify: `scripts/audit-architecture-boundary.js`

- [ ] **Step 1: Add audit regression checks**

Extend the audit so it scans `server/index.js` and fails on:

```text
require("./ingestion/sources/
GREENHOUSE_RATE_LIMIT_WAIT_MS
ICIMS_RATE_LIMIT_WAIT_MS
boards-api.greenhouse.io
.icims.com/jobs/search
```

Also fail when files under `server/ingestion/sources/` contain `require("../../index")` or `require("../index")`.

- [ ] **Step 2: Verify audit passes**

Run:

```powershell
npm.cmd run audit:architecture-boundary -- --json
```

Expected: `ok: true`, `server_index_lines` below `3000`, no failures.

---

## Task 6: Full Local Verification And Commit

**Files:**
- All files changed by Tasks 1-5.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
node server/ingestion/sourceContracts.test.js
node server/ingestion/sourceRegistry.test.js
node server/ingestion/sourceCollectors.test.js
npm.cmd run audit:architecture-boundary -- --json
```

Expected: all pass.

- [ ] **Step 2: Run backend suite**

Run:

```powershell
npm.cmd run test:backend
```

Expected: all backend checks and tests pass.

- [ ] **Step 3: Run whitespace check**

Run:

```powershell
git diff --check
```

Expected: no output.

- [ ] **Step 4: Commit**

Run:

```powershell
git add package.json scripts/audit-architecture-boundary.js server/ingestion/sourceContracts.js server/ingestion/sourceContracts.test.js server/ingestion/sourceRegistry.js server/ingestion/sourceRegistry.test.js server/ingestion/sourceCollectors.js server/ingestion/sourceCollectors.test.js server/ingestion/sources/greenhouse/index.js server/ingestion/sources/icims/index.js
git commit -m "Add ATS source registry pilot"
```

Expected: one focused commit. Do not push or deploy until parent integration review completes.
