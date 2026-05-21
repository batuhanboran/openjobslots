# ATS Quality Worker Throughput Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve parser/source quality and worker throughput without lowering quality thresholds.

**Architecture:** Keep production data writes out of scope. Harden one high-risk direct JSON parser path with raw fixture-backed tests, then make the worker target selector source-aware so healthy sources fill automatic runs before diagnostics-only sources. Apply only the first, reversible throughput stage in Compose defaults.

**Tech Stack:** Node.js, node:test, Express ingestion worker, Postgres-backed worker state, Docker Compose environment defaults.

---

### Task 1: Worker Due-Target Selection

**Files:**
- Modify: `server/ingestion/worker-concurrency.test.js`
- Modify: `server/ingestion/worker.js`

- [x] **Step 1: Write the failing test**

Add a test proving `selectPostgresDueTargets()` over-selects candidates and still fills the requested run when the earliest due source has exhausted its source daily budget.

- [x] **Step 2: Run test to verify it fails**

Run: `node server/ingestion/worker-concurrency.test.js`

- [x] **Step 3: Implement minimal scheduler change**

Add a bounded candidate multiplier, prioritize `normal` before `canary_only` before `quarantine_only`, and sort candidates defensively before applying source budgets.

- [x] **Step 4: Run test to verify it passes**

Run: `node server/ingestion/worker-concurrency.test.js`

### Task 2: RecruitCRM Parser Location Variants

**Files:**
- Modify: `server/ingestion/sources/directSourceModules.test.js`
- Modify: `server/index.js`

- [x] **Step 1: Write the failing test**

Add a source-module test proving RecruitCRM preserves nested location object evidence and string `job_location` evidence.

- [x] **Step 2: Run test to verify it fails**

Run: `node server/ingestion/sources/directSourceModules.test.js`

- [x] **Step 3: Implement minimal parser change**

Read RecruitCRM location from top-level fields, nested `location`/`job_location` objects, and string location labels. Keep rows quarantined when evidence is absent.

- [x] **Step 4: Run test to verify it passes**

Run: `node server/ingestion/sources/directSourceModules.test.js`

### Task 3: Stage-1 Worker Throughput Defaults

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docs/reference/deployment.md`

- [x] **Step 1: Update reversible defaults**

Change automatic worker defaults to `15m` interval, `2000` daily target budget, `50` targets per run, and source daily target budget `200`. Keep worker concurrency `2` and per-host concurrency `1`.

- [x] **Step 2: Document rollback**

Document that env overrides can restore the previous conservative values without code rollback.

### Task 4: Verification And Publish

**Files:**
- Verify all touched files.

- [x] **Step 1: Run focused checks**

Run:

```powershell
node server/ingestion/worker-concurrency.test.js
node server/ingestion/sources/directSourceModules.test.js
npm.cmd run test:parsers
git diff --check
```

- [ ] **Step 2: Commit and push**

Commit with a terse message and push the current branch.
