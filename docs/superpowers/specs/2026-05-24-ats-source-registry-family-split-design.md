# ATS Source Registry Family Split Design

## Status - May 24, 2026

The approved architecture target is:

- `server/index.js` stays as bootstrap and orchestration only.
- ATS-specific logic lives under `server/ingestion/sources/{ats}/`.
- Each ATS source owns its own `discover`, `fetchList`, optional `fetchDetail`, `parse`, `normalize`, `validate`, and `fixtures`.
- `server/ingestion/sourceCollectors.js` becomes a transitional dispatcher over a source registry, not a god-file with ATS branches.
- `scripts/audit-architecture-boundary.js` prevents ATS domains, ATS endpoint patterns, and source collector implementations from moving back into `server/index.js`.

This design extends `docs/superpowers/specs/2026-05-24-openjobslots-architecture-boundary-design.md`. The previous phase reduced `server/index.js` below the 3,000-line audit cap. This phase keeps that cap and removes remaining ATS-specific source orchestration from the server bootstrap path.

## Non-Goals

- Do not change public quality thresholds, source apply behavior, worker budget, retention, Meili indexing, or public API contracts in this architecture phase.
- Do not run production write backfills, canary/apply jobs, cleanup, or replace-mode Meili reindexing.
- Do not certify unsupported or future ATS sources from normalized output alone. Certification still requires raw fixtures, expected normalized fixtures, parser metadata, and documented nullable fields.
- Do not fetch or copy code from `batuhanboran/OpenJobSlots`; this remains an independent private repository implementation.

## Core Source Contract

Every source module should converge on this shape:

```text
server/ingestion/sources/{ats}/
  index.js
  discover.js
  fetchList.js
  fetchDetail.js
  parse.js
  normalize.js
  validate.js
  fixtures/
```

`index.js` exports one contract object:

```js
{
  atsKey,
  family,
  status,
  discover,
  fetchList,
  fetchDetail,
  parse,
  normalize,
  validate,
  rateLimit,
  fixtures
}
```

Required behavior:

- `discover(company)` returns source target config or a typed unsupported/no-route result.
- `fetchList(target, context)` fetches bounded list/search payloads through central safe fetch and rate-limit helpers.
- `fetchDetail(target, posting, context)` is optional and bounded; it cannot silently fetch unbounded detail pages.
- `parse(raw, target, context)` returns source-shaped postings plus parser evidence.
- `normalize(rawPosting, target, context)` returns the standard normalized posting contract or a quarantine/rejection reason.
- `validate()` is fixture-backed and proves raw fixtures, expected normalized output, invalid-shape handling, parser metadata, and nullable fields.
- Source modules must not import `server/index.js`.

## Registry And Runner

Add a source registry layer after the pilot is approved:

```text
server/ingestion/sourceContracts.js
server/ingestion/sourceRegistry.js
server/ingestion/sourceRunner.js
server/ingestion/sourceCollectors.js
```

Responsibilities:

- `sourceContracts.js`: shared validation for source module shape, typed result objects, and family/status values.
- `sourceRegistry.js`: canonical map from ATS key to source module, family metadata, and default enablement.
- `sourceRunner.js`: executes the contract in order: discover -> fetchList -> parse -> normalize -> optional fetchDetail -> validate/report.
- `sourceCollectors.js`: transitional compatibility shim for existing callers. It delegates to `sourceRunner` and keeps legacy behavior until all callers are migrated.

`server/index.js` should import only coarse runtime functions. It should not know individual ATS endpoint URLs, host patterns, rate-limit constants, parser helpers, or collector branches.

## Audit Rules

Extend `scripts/audit-architecture-boundary.js` with these checks:

- Fail when `server/index.js` exceeds the 3,000-line cap.
- Fail when `server/index.js` contains known ATS endpoint domains or endpoint path patterns.
- Fail when `server/index.js` defines ATS-specific rate-limit constants such as `GREENHOUSE_RATE_LIMIT_WAIT_MS`.
- Fail when `server/index.js` imports source parser files directly.
- Fail when `server/ingestion/sources/common.js` or any source module imports `server/index.js`.
- Warn, then later fail, when `sourceCollectors.js` contains ATS-specific branches after the registry runner exists.

The audit should allow generic public ATS labels only while the public filter option list still lives in `server/index.js`. Once that list moves to metadata/config, the audit can also fail on hard-coded ATS option arrays in `server/index.js`.

## Pilot Thread

### Thread 0: Core Contract Pilot

Goal: Build the registry contract and prove it with one direct API source and one difficult enterprise/HTML-detail source.

Pilot sources:

- `greenhouse`: direct JSON API, low-risk contract path.
- `icims`: enterprise/semi-structured public HTML, iframe/detail enrichment, high edge-case pressure.

Scope:

- Introduce `sourceContracts.js`, `sourceRegistry.js`, and a registry-backed `sourceRunner` path.
- Convert `greenhouse` and `icims` to the complete contract shape.
- Make `sourceCollectors.js` dispatch those two through the registry path while preserving legacy fallback for other sources.
- Extend architecture audit for ATS endpoint/domain regressions in `server/index.js`.

Definition of done:

- `server/index.js` remains below 3,000 audit lines.
- `server/index.js` contains no Greenhouse or iCIMS endpoint/domain/rate-limit implementation.
- `greenhouse` and `icims` pass fixture-backed module tests through the registry runner.
- Existing backend/parser tests pass.
- No production source apply, backfill, cleanup, or Meili mutation is run.

## Parallel Family Threads

Run family threads only after Thread 0 lands, because each family must use the same contract and registry runner.

### Thread 1: Direct JSON Stable

ATS keys:

`greenhouse`, `lever`, `ashby`, `smartrecruiters`, `recruitee`, `bamboohr`, `teamtailor`, `freshteam`, `pinpointhq`, `recruitcrm`, `fountain`, `getro`

Goal: Move direct/public JSON or stable public feed sources onto the complete source contract.

Expected focus:

- Tenant/site discovery from company URL.
- List pagination and per-host rate-limit config inside modules.
- Raw API fixtures plus invalid-shape fixtures.
- No HTML fallback unless the source already requires it and fixtures prove it.

Definition of done:

- Each source has contract exports and fixture-backed tests.
- No direct JSON endpoint or rate-limit constant for these ATS keys remains in `server/index.js`.
- `server/ingestion/sources/directSourceModules.test.js` proves registry execution for this family.

### Thread 2: Enterprise Direct

ATS keys:

`workday`, `oracle`, `adp_myjobs`, `adp_workforcenow`, `paylocity`, `dayforcehcm`, `eightfold`, `saphrcloud`, `ultipro`, `pageup`

Goal: Move enterprise source orchestration into source modules with strict tenant/site discovery and pagination.

Expected focus:

- Tenant/site parsing from URLs and embedded route config.
- Bounded pagination and retry/rate-limit behavior.
- Detail fetch only when list payload lacks required evidence.
- `dayforcehcm` remains disabled until real raw fixtures and a stable source path exist.

Definition of done:

- Enabled enterprise sources run through registry contracts.
- Unsupported enterprise sources return typed unsupported results, not fake postings.
- `server/ingestion/sources/enterpriseSourceModules.test.js` proves registry execution for this family.

### Thread 3: Embedded Or Semi-Structured

ATS keys:

`jobvite`, `icims`, `zoho`, `breezy`, `applicantpro`, `applytojob`, `theapplicantmanager`, `careerplug`, `talentreef`, `hirebridge`, `hrmdirect`, `isolvisolvedhire`

Goal: Move embedded JSON, public board HTML, and bounded detail enrichment into source modules.

Expected focus:

- Prefer embedded JSON over brittle DOM parsing.
- Treat detail-page fetch as bounded enrichment, never a broad crawl.
- Preserve parser evidence for geo, remote, date, and source id.
- Reject ambiguous narrative text instead of inventing geo or remote fields.

Definition of done:

- Each source has route discovery, list fetch, parser, and fixture-backed invalid-shape tests.
- Detail fetch budgets are explicit per module.
- `server/ingestion/sources/htmlPublicSourceModules.test.js` proves registry execution for this family.

### Thread 4: Vendor Specific

ATS keys:

`applicantai`, `gem`, `join`, `careerspage`, `manatal`, `hibob`, `sagehr`, `loxo`, `peopleforce`, `simplicant`, `rippling`, `careerpuck`, `talentlyft`, `talexio`

Goal: Normalize vendor-specific public board routes without pushing one-off logic back into shared collectors.

Expected focus:

- Source-specific route discovery inside each module.
- Conservative parser evidence for vendor-specific payloads.
- Clear unsupported/no-jobs/error taxonomy.
- Fixture coverage before any source is marked certified.

Definition of done:

- Vendor-specific modules expose the same contract as direct and enterprise sources.
- `sourceCollectors.js` has no vendor-specific branches for these keys.
- Parser and source-quality behavior remains unchanged except for ownership boundaries.

### Thread 5: Public Sector And Education

ATS keys:

`governmentjobs`, `usajobs`, `k12jobspot`, `schoolspring`, `calcareers`, `calopps`, `statejobsny`, `policeapp`, `jobaps`, `applitrack`

Goal: Treat public-sector and education boards as source-of-record providers with explicit attribution, polite pagination, and strict dedupe.

Expected focus:

- Preserve agency, school, department, and official posting URL evidence.
- Handle pagination with explicit caps and resume-safe cursors.
- Keep aggregator-like sources separate from company ATS modules where attribution or dedupe differs.
- Do not infer missing date/geo/source id from weak text.

Definition of done:

- Each source has official/source-of-record route config in its module.
- Pagination caps are explicit and tested.
- Public-sector source modules produce canonical URL and source id evidence without shared collector branches.

### Thread 6: Brittle High-Risk

ATS keys:

`taleo`, `brassring`

Goal: Keep brittle sources isolated, heavily tested, and conservative.

Expected focus:

- No broad public writes by default.
- Canary/quarantine-only posture unless raw fixtures prove stable parser behavior.
- Tenant-specific route shape handling inside modules.
- Strict date parsing; reject booleans, labels, and unstable columns as dates.

Definition of done:

- Taleo and BrassRing no longer require source-specific logic in `server/index.js` or `sourceCollectors.js`.
- Tests prove unsupported/unstable shapes return no public postings or quarantine-safe results.
- Source status remains conservative unless separately approved.

### Thread 7: Future Candidate Research

Candidate ATS/source names:

`PaycomOnline`, `AgileHR`, `Avature`, `Comeet`, `FactorialHR`, `Hireology`, `Crelate`, `HiringPlatform`, `Homerun`, `JibeApply`, `Jobs2Web`, `Occupop`, `PeopleAdmin`, `Personio`, `Recruiterflow`, `Softgarden`, `Trakstar`, `UKG`, `YCombinator`, `Yello`, `EdJoin`, `Webcruiter`, `AcademicJobsOnline`, `prismhr`, `silkroad`, `paycor`

Goal: Produce research artifacts only. Do not add active code until a source path is proven and approved.

Expected focus:

- Public endpoint or feed evidence.
- Terms/robots/attribution risk.
- One saved raw sample fixture when allowed.
- Required fields available: title, company, canonical URL, source id, location/date/remote evidence.
- Recommended family assignment for future implementation.

Definition of done:

- Each researched candidate has a short source note under `docs/reference/ats-workbench/sources/` or an approved future-candidate matrix.
- No runtime code is added for candidates without implementation approval.
- Unsupported candidates cannot be enabled by default.

## Copy-Paste Thread Objectives

### Thread 1 Objective: Direct JSON Stable

```text
Goal: Convert the Direct JSON Stable ATS family to the approved OpenJobSlots source registry contract.

Repository: batuhanboran/openjobslots private repo.
Family scope: greenhouse, lever, ashby, smartrecruiters, recruitee, bamboohr, teamtailor, freshteam, pinpointhq, recruitcrm, fountain, getro.

Architecture contract:
- server/index.js remains bootstrap/orchestration only.
- ATS-specific discover/fetch/parse/normalize/validate logic belongs under server/ingestion/sources/{ats}/.
- sourceCollectors.js is a transitional registry dispatcher only.
- audit-architecture-boundary must fail if ATS domains, endpoints, parser imports, or source collector implementations move back into server/index.js.

Constraints:
- Do not change source-quality thresholds, worker budgets, public API contracts, retention, or Meili indexing.
- Do not run production source apply/backfill/cleanup/reindex.
- Add or update raw/expected/invalid-shape fixtures before changing parser behavior.
- Keep unsupported sources disabled with typed unsupported results.

Required verification:
- npm.cmd run audit:architecture-boundary -- --json
- server/ingestion/sources/directSourceModules.test.js
- npm.cmd run test:backend
- git diff --check

Expected output:
- Summary of files changed.
- Which ATS keys are fully registry-backed.
- Which ATS keys remain blocked and why.
- Test evidence.
```

### Thread 2 Objective: Enterprise Direct

```text
Goal: Convert the Enterprise Direct ATS family to the approved OpenJobSlots source registry contract.

Repository: batuhanboran/openjobslots private repo.
Family scope: workday, oracle, adp_myjobs, adp_workforcenow, paylocity, dayforcehcm, eightfold, saphrcloud, ultipro, pageup.

Architecture contract:
- server/index.js remains bootstrap/orchestration only.
- ATS-specific discover/fetch/parse/normalize/validate logic belongs under server/ingestion/sources/{ats}/.
- sourceCollectors.js is a transitional registry dispatcher only.
- audit-architecture-boundary must fail if ATS domains, endpoints, parser imports, or source collector implementations move back into server/index.js.

Constraints:
- Do not change source-quality thresholds, worker budgets, public API contracts, retention, or Meili indexing.
- Do not run production source apply/backfill/cleanup/reindex.
- Add or update raw/expected/invalid-shape fixtures before changing parser behavior.
- dayforcehcm stays disabled until a stable public source path and raw fixtures exist.

Required verification:
- npm.cmd run audit:architecture-boundary -- --json
- server/ingestion/sources/enterpriseSourceModules.test.js
- npm.cmd run test:backend
- git diff --check

Expected output:
- Summary of files changed.
- Which ATS keys are fully registry-backed.
- Which ATS keys remain blocked and why.
- Test evidence.
```

### Thread 3 Objective: Embedded Or Semi-Structured

```text
Goal: Convert the Embedded Or Semi-Structured ATS family to the approved OpenJobSlots source registry contract.

Repository: batuhanboran/openjobslots private repo.
Family scope: jobvite, icims, zoho, breezy, applicantpro, applytojob, theapplicantmanager, careerplug, talentreef, hirebridge, hrmdirect, isolvisolvedhire.

Architecture contract:
- server/index.js remains bootstrap/orchestration only.
- ATS-specific discover/fetch/parse/normalize/validate logic belongs under server/ingestion/sources/{ats}/.
- sourceCollectors.js is a transitional registry dispatcher only.
- audit-architecture-boundary must fail if ATS domains, endpoints, parser imports, or source collector implementations move back into server/index.js.

Constraints:
- Do not change source-quality thresholds, worker budgets, public API contracts, retention, or Meili indexing.
- Do not run production source apply/backfill/cleanup/reindex.
- Prefer embedded JSON over brittle DOM parsing.
- Keep detail fetch bounded and fixture-backed.

Required verification:
- npm.cmd run audit:architecture-boundary -- --json
- server/ingestion/sources/htmlPublicSourceModules.test.js
- npm.cmd run test:backend
- git diff --check

Expected output:
- Summary of files changed.
- Which ATS keys are fully registry-backed.
- Which ATS keys remain blocked and why.
- Test evidence.
```

### Thread 4 Objective: Vendor Specific

```text
Goal: Convert the Vendor Specific ATS family to the approved OpenJobSlots source registry contract.

Repository: batuhanboran/openjobslots private repo.
Family scope: applicantai, gem, join, careerspage, manatal, hibob, sagehr, loxo, peopleforce, simplicant, rippling, careerpuck, talentlyft, talexio.

Architecture contract:
- server/index.js remains bootstrap/orchestration only.
- ATS-specific discover/fetch/parse/normalize/validate logic belongs under server/ingestion/sources/{ats}/.
- sourceCollectors.js is a transitional registry dispatcher only.
- audit-architecture-boundary must fail if ATS domains, endpoints, parser imports, or source collector implementations move back into server/index.js.

Constraints:
- Do not change source-quality thresholds, worker budgets, public API contracts, retention, or Meili indexing.
- Do not run production source apply/backfill/cleanup/reindex.
- Keep route discovery inside source modules.
- Do not mark a source certified without raw fixtures, expected normalized fixtures, invalid-shape tests, and parser metadata.

Required verification:
- npm.cmd run audit:architecture-boundary -- --json
- relevant source module tests added for this family
- npm.cmd run test:backend
- git diff --check

Expected output:
- Summary of files changed.
- Which ATS keys are fully registry-backed.
- Which ATS keys remain blocked and why.
- Test evidence.
```

### Thread 5 Objective: Public Sector And Education

```text
Goal: Convert the Public Sector And Education ATS/source family to the approved OpenJobSlots source registry contract.

Repository: batuhanboran/openjobslots private repo.
Family scope: governmentjobs, usajobs, k12jobspot, schoolspring, calcareers, calopps, statejobsny, policeapp, jobaps, applitrack.

Architecture contract:
- server/index.js remains bootstrap/orchestration only.
- ATS-specific discover/fetch/parse/normalize/validate logic belongs under server/ingestion/sources/{ats}/.
- sourceCollectors.js is a transitional registry dispatcher only.
- audit-architecture-boundary must fail if ATS domains, endpoints, parser imports, or source collector implementations move back into server/index.js.

Constraints:
- Do not change source-quality thresholds, worker budgets, public API contracts, retention, or Meili indexing.
- Do not run production source apply/backfill/cleanup/reindex.
- Preserve agency, school, department, official URL, and source-id evidence.
- Use explicit pagination caps and resume-safe cursors.

Required verification:
- npm.cmd run audit:architecture-boundary -- --json
- relevant source module tests added for this family
- npm.cmd run test:backend
- git diff --check

Expected output:
- Summary of files changed.
- Which ATS keys are fully registry-backed.
- Which ATS keys remain blocked and why.
- Test evidence.
```

### Thread 6 Objective: Brittle High-Risk

```text
Goal: Convert the Brittle High-Risk ATS family to the approved OpenJobSlots source registry contract while keeping conservative source status.

Repository: batuhanboran/openjobslots private repo.
Family scope: taleo, brassring.

Architecture contract:
- server/index.js remains bootstrap/orchestration only.
- ATS-specific discover/fetch/parse/normalize/validate logic belongs under server/ingestion/sources/{ats}/.
- sourceCollectors.js is a transitional registry dispatcher only.
- audit-architecture-boundary must fail if ATS domains, endpoints, parser imports, or source collector implementations move back into server/index.js.

Constraints:
- Do not change source-quality thresholds, worker budgets, public API contracts, retention, or Meili indexing.
- Do not run production source apply/backfill/cleanup/reindex.
- Keep broad public writes disabled by default.
- Reject unstable columns, booleans, labels, and weak text as posting dates.

Required verification:
- npm.cmd run audit:architecture-boundary -- --json
- relevant source module tests added for this family
- npm.cmd run test:backend
- git diff --check

Expected output:
- Summary of files changed.
- Which ATS keys are fully registry-backed.
- Which ATS keys remain blocked and why.
- Test evidence.
```

### Thread 7 Objective: Future Candidate Research

```text
Goal: Research future ATS/source candidates without adding runtime code.

Repository: batuhanboran/openjobslots private repo.
Candidate scope: PaycomOnline, AgileHR, Avature, Comeet, FactorialHR, Hireology, Crelate, HiringPlatform, Homerun, JibeApply, Jobs2Web, Occupop, PeopleAdmin, Personio, Recruiterflow, Softgarden, Trakstar, UKG, YCombinator, Yello, EdJoin, Webcruiter, AcademicJobsOnline, prismhr, silkroad, paycor.

Architecture contract:
- Research artifacts only unless implementation is separately approved.
- Unsupported candidates cannot be enabled by default.
- Runtime source code is not added until a public endpoint/feed, fixture strategy, and source family assignment are proven.

Constraints:
- Do not change source-quality thresholds, worker budgets, public API contracts, retention, or Meili indexing.
- Do not run production source apply/backfill/cleanup/reindex.
- Do not add source modules for candidates without implementation approval.

Required verification:
- git diff --check
- docs/reference/ats-workbench/sources notes or an approved candidate matrix for researched sources

Expected output:
- Public endpoint/feed evidence per candidate.
- Terms/robots/attribution risk notes.
- Required field availability.
- Recommended family assignment and implementation priority.
```

## Sequencing

1. Complete Thread 0 first in this thread.
2. After Thread 0 lands, run Threads 1 through 6 in parallel, one family per thread.
3. Run Thread 7 as research-only in parallel if desired; it must not touch runtime source code without approval.
4. Parent/integration thread merges family work, reruns full backend tests, tightens the audit from warning to failure on remaining `sourceCollectors.js` branches, and only then considers production deployment.

## Success Criteria

- `server/index.js` remains under the 3,000-line audit cap and contains no ATS endpoint/domain implementation.
- `sourceCollectors.js` delegates by registry and no longer owns ATS-specific collector logic after family threads land.
- Every supported ATS has a module-local source contract or an explicit disabled/unsupported contract.
- Existing public endpoints stay compatible.
- Public dataset quality gates are unchanged.
- No production write/reindex operation is mixed into this architecture work.
