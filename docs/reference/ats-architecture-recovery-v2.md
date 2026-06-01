# ATS Architecture & Recovery v2

This milestone turns ATS ingestion from parser-by-parser repair into a controlled source recovery system. The objective is not just passing fixtures; it is increasing reliable public rows while protecting search parity and avoiding invented geo, remote, date, or source-id fields.

## Current Baseline

- Production was checked read-only on June 1, 2026. The app was healthy, sync was idle, and no production writes were run.
- Public rows were about `331.7k`; visible ATS coverage was `37` ATS out of `62` configured ATS observed in production status.
- Data-quality pressure remains material: missing country about `6.37%`, missing any normalized geo about `13.28%`, and weak or unknown remote about `2.8%`.
- Search count parity was aligned, but Meili remote facets still drifted from Postgres and require explicit approval before repair or replace reindex.
- Source recovery order from read-only evidence starts with `zoho`, `hrmdirect`, `breezy`, `teamtailor`, `adp_workforcenow`, `bamboohr`, `ultipro`, `rippling`, and `applytojob`.

## Done In The Architecture Slice

- `server/ingestion/sources/common.js` no longer owns ATS parser imports or parser-function specs.
- Parser behavior for the remaining transitional sources was moved behind source-local `parse()` ownership in the corresponding `server/ingestion/sources/<ats>/index.js` modules.
- `audit:architecture-boundary` now fails if parser ownership for the cleaned ATS drifts back into `common.js`.
- The source-module contract remains fixture-backed through raw list fixtures, expected-normalized fixtures, invalid-shape fixtures, parser evidence, and public gate checks.

## Target State

Every configured ATS should have:

- A source-local module owning discovery, fetch, detail escalation, parse, normalization, validation, public gate behavior, rate limits, and fixtures.
- Raw/list/detail fixtures proving nullable fields are really absent when fields stay null.
- Parser evidence for title, company, canonical URL, source job id, geo, remote mode, and posting date when the source exposes them.
- A bounded read-only inventory scan before any canary or apply.
- A net-new estimate proving public-row upside without hiding or degrading existing public rows.
- A canary/apply guard that requires explicit production flags and a rollback path.
- Post-apply Meili/Postgres count and facet parity proof before calling the recovery successful.

## Non-Goals

- Do not run production source apply, backfill, cleanup, public-row hide/delete, worker-budget increases, deploys, or Meili repair/reindex without explicit approval.
- Do not infer countries, cities, dates, remote state, or source ids from title/body/company/tenant names unless the ATS-specific source fixture proves that field is source-labeled and deterministic.
- Do not move ATS-specific behavior into a new shared god file.

## Acceptance Gates

Architecture gates:

- `npm.cmd run audit:architecture-boundary -- --json`
- `node --check server\ingestion\sources\common.js`
- No `require("./<ats>/parse")` or `parser: parse<Ats>` ownership in `server/ingestion/sources/common.js`.
- No source module imports `server/index.js`.
- `server/ingestion/sourceCollectors.js`, `server/ingestion/sourceDiscovery.js`, `server/ingestion/sources/common.js`, and `server/ingestion/sourceRegistry.js` remain under architecture-boundary line caps so ATS behavior cannot silently move into a new shared god file.

Fixture and parser gates:

- `npm.cmd run test:parsers -- --runInBand`
- `node server\ingestion\sources\directSourceModules.test.js`
- `node server\ingestion\sources\enterpriseSourceModules.test.js`
- `node server\ingestion\sources\htmlPublicSourceModules.test.js`

Backend and public API gates:

- `npm.cmd run test:backend`
- `npm.cmd run test:api`
- `npm.cmd run ats:registry-index -- --json --no-write`
- `git diff --check`

Production read-only gates:

- `/health` and `/sync/status` remain healthy.
- `audit:data-quality -- --json --by-source` shows no new public no-geo/no-remote regression.
- `search:reindex:check -- --json` reports count and facet parity, or explicitly documents the remaining drift and the approval needed to repair it.

## Execution Phases

1. Architecture containment: keep source-local parser ownership out of `common.js`, and extend the architecture audit whenever a source is cleaned.
2. Legacy compatibility cleanup: replace remaining `__legacyParsed` compatibility paths only after source-owned fetch/detail fixtures cover the same behavior.
3. Source recovery lanes: work the live-priority ATS list one source at a time using raw fixtures, source-local parser evidence, inventory, net-new estimate, and canary planning.
4. Production apply lane: only after approval, run guarded source apply for one ATS, then prove accepted public rows, bad-row rate, and rollback metadata.
5. Search parity lane: only after approval, repair or replace-reindex Meili, then prove Postgres/Meili count and facet parity.
6. Deploy lane: deploy code separately from data changes, verify live SHA, health, status, and public search behavior.

## Success Definition

The milestone is complete only when the architecture gates pass, source-specific recovery evidence is saved, public rows do not drop, data-quality gaps improve by source, parser attention does not move to a new family, and Meili/Postgres parity is clean or explicitly approved as a known residual.
