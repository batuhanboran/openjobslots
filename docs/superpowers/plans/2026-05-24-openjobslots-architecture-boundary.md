# OpenJobSlots Architecture Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenJobSlots private-repo independent from upstream OpenJobSlots and reduce `server/index.js` to a 2-3k line bootstrap/orchestration file through safe modular extraction.

**Architecture:** Add a privacy/god-file boundary audit first, then move low-risk HTTP/runtime helpers out of `server/index.js`, followed by search/location helpers, source fetch/discovery, and finally legacy collectors. Each extraction is behavior-preserving and verified before tightening the line-count ratchet.

**Tech Stack:** Node.js CommonJS, Express, existing OpenJobSlots backend/search/parser test scripts, Postgres/Meili production verification after explicit deploy approval.

---

## File Structure

- Create `scripts/audit-architecture-boundary.js`: local audit for repository boundary, public-surface string leaks, known source-layer dependency debt, and `server/index.js` line-count ratchet.
- Modify `package.json`: add `audit:architecture-boundary` and include it in architecture closeout commands once stable.
- Create `server/http/security.js`: move security headers, admin access helpers, admin gate, generic error middleware, and route rate limit helpers.
- Create `server/http/publicSeo.js`: move SEO index rendering, robots, and sitemap generation.
- Create `server/http/publicSerializers.js`: move public posting/status/source sanitizers.
- Create `server/search/locationFilters.js`: move public search text, country, region, and location filter parsing helpers.
- Create `server/ingestion/sourceFetch.js`: move safe source fetch wrappers and source rate-limit constants.
- Create `server/ingestion/sourceDiscovery.js`: move company URL/source config parser functions.
- Create `server/ingestion/sourceCollectors.js`: move `collectPostingsForCompany` and ATS-specific collectors.
- Modify `server/ingestion/sources/common.js`: remove `require("../../index")` and consume collector/source contracts directly.
- Modify `server/index.js`: import extracted modules and retain only app/runtime composition.
- Modify existing tests or add focused tests beside extracted modules when a moved unit has no direct coverage.

---

## Task 1: Boundary Audit And Ratchet

**Files:**
- Create: `scripts/audit-architecture-boundary.js`
- Modify: `package.json`
- Test: `node scripts/audit-architecture-boundary.js --json`

- [ ] **Step 1: Add a failing script entry expectation**

Run:

```powershell
npm.cmd run audit:architecture-boundary
```

Expected: fail because the script does not exist yet.

- [ ] **Step 2: Create the audit script**

Create `scripts/audit-architecture-boundary.js` with this behavior:

```js
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVER_INDEX_CAP = Number(process.env.OPENJOBSLOTS_SERVER_INDEX_LINE_CAP || 10450);

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function lineCount(relativePath) {
  return readText(relativePath).split(/\r?\n/).length;
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function listTrackedFiles(paths) {
  return git(["ls-files", ...paths]).split(/\r?\n/).filter(Boolean);
}

function scanFiles(files, patterns) {
  const hits = [];
  for (const file of files) {
    const text = readText(file);
    for (const pattern of patterns) {
      if (pattern.regex.test(text)) hits.push({ file, pattern: pattern.name });
    }
  }
  return hits;
}

function main() {
  const json = process.argv.includes("--json");
  const remotes = git(["remote", "-v"]);
  const failures = [];
  const warnings = [];

  if (/batuhanboran\/OpenJobSlots/i.test(remotes)) {
    failures.push("git remotes must not point at batuhanboran/OpenJobSlots");
  }
  if (!/batuhanboran\/openjobslots/i.test(remotes)) {
    failures.push("origin must point at batuhanboran/openjobslots");
  }

  const serverIndexLines = lineCount("server/index.js");
  if (serverIndexLines > SERVER_INDEX_CAP) {
    failures.push(`server/index.js has ${serverIndexLines} lines, above cap ${SERVER_INDEX_CAP}`);
  }

  const publicFiles = listTrackedFiles(["App.js", "src", "server/http", "README.md"]);
  const leakHits = scanFiles(publicFiles, [
    { name: "windows_private_user_path", regex: /C:\\Users\\BaronPC/i },
    { name: "production_checkout_path", regex: /\/root\/OpenJobSlots/i },
    { name: "dotenv_secret_name_with_value", regex: /(TOKEN|SECRET|PASSWORD|MEILI_MASTER_KEY|DATABASE_URL)\s*=\s*['"][^'"]+['"]/i }
  ]);
  if (leakHits.length) failures.push(`public surface leak patterns: ${JSON.stringify(leakHits)}`);

  const sourceCommon = readText("server/ingestion/sources/common.js");
  if (/require\(["']\.\.\/\.\.\/index["']\)/.test(sourceCommon)) {
    warnings.push("known debt: server/ingestion/sources/common.js still imports ../../index for legacy collector fallback");
  }

  const result = {
    ok: failures.length === 0,
    server_index_lines: serverIndexLines,
    server_index_cap: SERVER_INDEX_CAP,
    failures,
    warnings
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`server/index.js lines: ${serverIndexLines}/${SERVER_INDEX_CAP}`);
    for (const warning of warnings) console.warn(`warning: ${warning}`);
    for (const failure of failures) console.error(`failure: ${failure}`);
  }

  if (!result.ok) process.exit(1);
}

main();
```

- [ ] **Step 3: Add npm script**

In `package.json`, add:

```json
"audit:architecture-boundary": "node scripts/audit-architecture-boundary.js"
```

- [ ] **Step 4: Verify audit passes with known debt warning**

Run:

```powershell
npm.cmd run audit:architecture-boundary -- --json
```

Expected: `ok: true`, `server_index_lines` around `10437`, and one warning for the known `common.js` legacy fallback import.

- [ ] **Step 5: Commit boundary audit**

Run:

```powershell
git add package.json scripts/audit-architecture-boundary.js
git commit -m "Add architecture boundary audit"
```

---

## Task 2: Extract Public HTTP Boundary Helpers

**Files:**
- Create: `server/http/security.js`
- Create: `server/http/publicSeo.js`
- Create: `server/http/publicSerializers.js`
- Modify: `server/index.js`
- Test: `npm.cmd run test:http`

- [ ] **Step 1: Capture current public route behavior**

Run:

```powershell
npm.cmd run test:http
```

Expected: pass before extraction.

- [ ] **Step 2: Move security helpers**

Move these existing functions/constants from `server/index.js` to `server/http/security.js` and export them:

```js
module.exports = {
  adminGateMiddleware,
  buildSecurityContentSecurityPolicy,
  createRateLimiter,
  genericErrorMiddleware,
  hasAdminAccess,
  isControlRoute,
  isLocalRequest,
  securityHeadersMiddleware
};
```

Keep function bodies behavior-identical. Import the exported functions back into `server/index.js`.

- [ ] **Step 3: Move SEO helpers**

Move these existing functions from `server/index.js` to `server/http/publicSeo.js` and export them:

```js
module.exports = {
  buildRobotsTxt,
  buildSitemapXml,
  getPublicSiteCanonicalUrl,
  renderSeoIndexHtml
};
```

Import them in `server/index.js` and keep route registration behavior unchanged.

- [ ] **Step 4: Move public serializers**

Move public-safe serializer helpers from `server/index.js` to `server/http/publicSerializers.js`:

```js
module.exports = {
  roundPublicMetric,
  sanitizePublicPostingItem,
  sanitizePublicPostings,
  sanitizePublicSourceFacetItem,
  sanitizePublicSourceFacets
};
```

Import them in `server/index.js`. Public output must remain sanitized.

- [ ] **Step 5: Run HTTP and architecture checks**

Run:

```powershell
npm.cmd run test:http
npm.cmd run audit:architecture-boundary -- --json
git diff --check
```

Expected: tests pass and `server/index.js` line count decreases.

- [ ] **Step 6: Commit HTTP boundary extraction**

Run:

```powershell
git add server/index.js server/http/security.js server/http/publicSeo.js server/http/publicSerializers.js
git commit -m "Extract public HTTP boundary helpers"
```

---

## Task 3: Extract Search And Location Filter Helpers

**Files:**
- Create: `server/search/locationFilters.js`
- Modify: `server/index.js`
- Test: `npm.cmd run test:search-corpus`
- Test: `npm.cmd run test:http`

- [ ] **Step 1: Capture search behavior**

Run:

```powershell
npm.cmd run test:search-corpus
npm.cmd run test:http
```

Expected: pass before extraction.

- [ ] **Step 2: Move search/location helpers**

Move public search text and geo filter helpers from `server/index.js` into `server/search/locationFilters.js`, including:

```js
module.exports = {
  collectCountryCandidates,
  inferLocationGeo,
  normalizeGeoText,
  normalizeSearchText,
  parseCountryFilters,
  parseRegionFilters,
  stripSearchDiacritics,
  tokenizeSearchText
};
```

Keep Turkey/Turkiye/Turkiye-alias normalization behavior identical.

- [ ] **Step 3: Import helper module in server bootstrap**

Replace local helper references in `server/index.js` with imports from `server/search/locationFilters.js`.

- [ ] **Step 4: Verify search behavior**

Run:

```powershell
npm.cmd run test:search-corpus
npm.cmd run test:http
npm.cmd run audit:architecture-boundary -- --json
git diff --check
```

Expected: tests pass and line count decreases.

- [ ] **Step 5: Commit search/location extraction**

Run:

```powershell
git add server/index.js server/search/locationFilters.js
git commit -m "Extract public search location helpers"
```

---

## Task 4: Extract Source Fetch Runtime

**Files:**
- Create: `server/ingestion/sourceFetch.js`
- Modify: `server/index.js`
- Test: `npm.cmd run test:backend`

- [ ] **Step 1: Run backend baseline**

Run:

```powershell
npm.cmd run test:backend
```

Expected: pass before extraction.

- [ ] **Step 2: Move shared fetch wrappers and rate limits**

Move `fetchWithAtsRateLimit`, shared ATS rate-limit constants, `fetchJson`, `fetchText`, `makeSourceFetchError`, and `classifyPublicRouteStatus` into `server/ingestion/sourceFetch.js`.

Export:

```js
module.exports = {
  classifyPublicRouteStatus,
  fetchJson,
  fetchText,
  fetchWithAtsRateLimit,
  getAtsRateLimitWaitMs,
  makeSourceFetchError
};
```

- [ ] **Step 3: Replace direct helper usage**

Import these helpers in `server/index.js`. Do not change request headers, response size limits, error codes, or retry/rate-limit behavior.

- [ ] **Step 4: Verify backend behavior**

Run:

```powershell
npm.cmd run test:backend
npm.cmd run audit:architecture-boundary -- --json
git diff --check
```

Expected: tests pass and line count decreases.

- [ ] **Step 5: Commit source fetch extraction**

Run:

```powershell
git add server/index.js server/ingestion/sourceFetch.js
git commit -m "Extract source fetch runtime"
```

---

## Task 5: Extract Source Discovery

**Files:**
- Create: `server/ingestion/sourceDiscovery.js`
- Modify: `server/index.js`
- Test: `npm.cmd run test:parsers`
- Test: `npm.cmd run test:backend`

- [ ] **Step 1: Move company/source parsers**

Move `parseWorkdayCompany`, `parseAshbyCompany`, and the rest of the `parse<Ats>Company` / route-config extraction functions out of `server/index.js` into `server/ingestion/sourceDiscovery.js`.

Export:

```js
module.exports = {
  parseCompanySourceConfig,
  parseWorkdayCompany,
  parseAshbyCompany,
  parseGreenhouseCompany
};
```

Also export every named parser still used by collectors. `parseCompanySourceConfig(atsKey, urlString)` should dispatch to the specific parser without changing return shapes.

- [ ] **Step 2: Replace local parser usage**

Import from `server/ingestion/sourceDiscovery.js` in `server/index.js`. Keep all source-specific config object keys unchanged.

- [ ] **Step 3: Verify parser and backend suites**

Run:

```powershell
npm.cmd run test:parsers
npm.cmd run test:backend
npm.cmd run audit:architecture-boundary -- --json
git diff --check
```

Expected: tests pass and line count decreases.

- [ ] **Step 4: Commit source discovery extraction**

Run:

```powershell
git add server/index.js server/ingestion/sourceDiscovery.js
git commit -m "Extract source discovery helpers"
```

---

## Task 6: Extract Source Collectors And Remove Index Dependency

**Files:**
- Create: `server/ingestion/sourceCollectors.js`
- Modify: `server/index.js`
- Modify: `server/ingestion/sources/common.js`
- Modify: `server/ingestion/adapters.js`
- Test: `npm.cmd run test:backend`
- Test: `npm.cmd run test:parsers`

- [ ] **Step 1: Move collector functions**

Move all `collectPostingsFor<Ats>Company` functions and `collectPostingsForCompany` from `server/index.js` to `server/ingestion/sourceCollectors.js`.

Export:

```js
module.exports = {
  collectPostingsForCompany,
  collectPostingsForSourceTarget
};
```

`collectPostingsForCompany(company)` must preserve the existing public function signature.

- [ ] **Step 2: Wire dependencies explicitly**

If collectors need shared runtime state such as rate-limit store or fetch helpers, pass it through a local dependency object created in `server/index.js` instead of importing `server/index.js` from source modules.

Use this shape:

```js
function createSourceCollectorRuntime(dependencies) {
  return {
    collectPostingsForCompany(company) {
      return collectPostingsForCompany(company, dependencies);
    }
  };
}
```

- [ ] **Step 3: Remove source-layer import from index**

In `server/ingestion/sources/common.js`, remove:

```js
const {
  collectPostingsForCompany
} = require("../../index");
```

Import the collector from `server/ingestion/sourceCollectors.js` or receive it through the source-module runtime context. After this step, this command must return no results:

```powershell
rg -n -F 'require("../../index")' server\ingestion
```

- [ ] **Step 4: Verify source behavior**

Run:

```powershell
npm.cmd run test:parsers
npm.cmd run test:backend
npm.cmd run audit:architecture-boundary -- --json
git diff --check
```

Expected: tests pass; the architecture audit warning about `common.js` legacy fallback is gone.

- [ ] **Step 5: Commit collector extraction**

Run:

```powershell
git add server/index.js server/ingestion/sourceCollectors.js server/ingestion/sources/common.js server/ingestion/adapters.js
git commit -m "Extract source collectors from server bootstrap"
```

---

## Task 7: Tighten Server Index Cap To Final Target

**Files:**
- Modify: `scripts/audit-architecture-boundary.js`
- Modify: `docs/PROJECT_STATE.md`
- Modify: `handoff.md`
- Test: `npm.cmd run audit:architecture-boundary -- --json`

- [ ] **Step 1: Measure final line count**

Run:

```powershell
(Get-Content -LiteralPath server\index.js | Measure-Object -Line).Lines
```

Expected: `3000` or lower after collector extraction.

- [ ] **Step 2: Tighten audit cap**

In `scripts/audit-architecture-boundary.js`, change:

```js
const SERVER_INDEX_CAP = Number(process.env.OPENJOBSLOTS_SERVER_INDEX_LINE_CAP || 10450);
```

to:

```js
const SERVER_INDEX_CAP = Number(process.env.OPENJOBSLOTS_SERVER_INDEX_LINE_CAP || 3000);
```

- [ ] **Step 3: Update project docs**

Update `docs/PROJECT_STATE.md` and `handoff.md` with the final architecture state:

```text
server/index.js is now below the 3k-line architecture cap. Source discovery, fetch, and collector logic live under server/ingestion, while server/index.js is bootstrap/runtime composition.
```

- [ ] **Step 4: Run final local verification**

Run:

```powershell
npm.cmd run audit:architecture-boundary -- --json
npm.cmd run test:http
npm.cmd run test:search-corpus
npm.cmd run test:parsers
npm.cmd run test:backend
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit final ratchet**

Run:

```powershell
git add scripts/audit-architecture-boundary.js docs/PROJECT_STATE.md handoff.md
git commit -m "Tighten server bootstrap architecture cap"
```

---

## Task 8: Push And Production Verification

**Files:**
- Verify only: no direct file edits.

- [ ] **Step 1: Summarize branch changes**

Run:

```powershell
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD
```

Expected: focused architecture-boundary commits only.

- [ ] **Step 2: Push branch**

Run:

```powershell
git push -u origin codex/openjobslots-architecture-boundary
```

- [ ] **Step 3: Deploy only after explicit approval**

Do not deploy without explicit approval. If approval is given, fast-forward production and rebuild app/worker using the deployment runbook.

- [ ] **Step 4: Verify production after approved deploy**

Run on production:

```bash
git -C /root/OpenJobSlots rev-parse HEAD
docker compose --project-directory /root/OpenJobSlots ps
curl -fsS http://127.0.0.1:8081/health
docker exec openjobslots-app npm run search:reindex:check -- --json
```

Expected: host commit matches pushed commit, services are up, health is `ok:true`. If `search:reindex:check` still reports the known extra Lever demo placeholder, report it as residual derived-index drift and do not repair it during this architecture task.
