# ATS Parser Modularization Design

## Goal

Reduce the OpenJobSlots god-file risk by moving ATS parser logic out of `server/index.js` into focused source modules, starting with ApplyToJob and Breezy. The first implementation phase must preserve behavior exactly; parser quality fixes come only after extraction tests prove parity.

## Current Shape

`server/index.js` is the primary god file. It contains API/server concerns, database-adjacent helpers, fetch collectors, and many ATS parsers in one file. The source-module layer already exists under `server/ingestion/sources/`, but many source folders are thin wrappers around `createSourceModule()`, while the real parser functions still come from `server/index.js` through `server/ingestion/sources/common.js`.

The highest-risk parser targets are:

- `ApplyToJob`: parser at `server/index.js:9001`, helpers around `server/index.js:8549-8999`.
- `Breezy`: parser at `server/index.js:9899`, helpers around `server/index.js:9388-9898`.
- `CareerPlug`: parser at `server/index.js:5392`, pending residual parser-attention follow-up.
- `Greenhouse`: parser at `server/index.js:12770`, pending residual parser-attention follow-up.
- `Taleo`, `Jobvite`, and `iCIMS`: brittle or disabled/quarantined sources that should be later extraction candidates.

The current working tree has an unrelated `server/index.js` formatting diff. The modularization work must not stage or rely on that diff unless it is intentionally cleaned or separated first.

## Target Shape

Each ATS source should own its parser and parser-local helpers inside its source folder:

```text
server/ingestion/sources/applytojob/
  index.js
  parse.js
  fetchList.js
  normalize.js
  validate.js
  fixtures/

server/ingestion/sources/breezy/
  index.js
  parse.js
  fetchList.js
  normalize.js
  validate.js
  fixtures/
```

For the first phase, only `parse.js` is mandatory for ApplyToJob and Breezy. Existing fetch/detail prioritization can remain in `server/ingestion/sources/common.js` until parser extraction is stable. The source registry should import parser functions from the ATS folder instead of importing them from `server/index.js`.

## Architecture

The extraction uses a strangler pattern:

1. Create focused parser modules that export the same parser function names currently exported by `server/index.js`.
2. Move parser-local helper functions with the parser so no parser still reaches into `server/index.js`.
3. Change `server/ingestion/sources/common.js` to import those parser functions from `./applytojob/parse` and `./breezy/parse`.
4. Keep `server/index.js` exporting compatibility symbols only if tests or legacy code still require them.
5. After parity tests pass, remove compatibility exports in a later phase when no consumers depend on them.

This reduces blast radius while avoiding a big-bang migration.

## Behavior Rules

- Phase 1 must be behavior-preserving: no new remote, geo, date, or source-id inference.
- Do not invent posting dates, countries, regions, cities, remote state, or source IDs.
- Do not run production source apply, backfill, cleanup, or Meili replace reindex as part of modularization.
- Parser changes must be fixture-backed before being called fixed.
- Public endpoints must remain compatible: `/health`, `/postings`, `/postings/filter-options`, `/search/suggest`, `/sync/status`, `/ingestion/status`.

## Antigravity Findings To Reuse

Use the Antigravity report as a hypothesis source, not as a source of truth.

Keep:

- Breezy short narrative leakage is plausible because `breezyLocationLooksNarrativeText()` ignores text shorter than 45 chars.
- Taleo Ajax token offsets are brittle and should be isolated later.
- Jobvite table/class regex dependency is brittle and should be isolated later.
- ApplyToJob parenthesized and multi-location ambiguity is real, but should be treated as ambiguous evidence, not fake remote or fake geo.

Reject or correct:

- `ApplyToJob 7628`, `Breezy 7469`, and `iCIMS 7348` line references are wrong for the current checkout.
- The current worker budget is not mismatched; live app and worker read `4000/50/200`.
- Meili/Postgres `count_delta=-1` is one extra Meili Lever demo placeholder document, not a Postgres source-of-truth issue.
- The quarantine table in the report is stale.

## Implementation Phases

### Phase 1: ApplyToJob and Breezy Extraction

Move ApplyToJob and Breezy parser/helper code into source-owned parser modules. Keep runtime behavior identical and prove it with parser/source tests.

### Phase 2: Parser Quality Fixes

After extraction, implement fixture-backed fixes:

- ApplyToJob: ambiguous parenthesized/multiple-state/multiple-location strings should not become public geo evidence without source detail proof.
- Breezy: short boilerplate and narrative snippets should not leak into `location`, `city`, or useful geo evidence.
- CareerPlug and Greenhouse: use latest unresolved parser-attention samples to add focused fixtures before changing logic.

### Phase 3: Broader Parser Migration

Move brittle or disabled/quarantined parsers after Phase 1 is stable: CareerPlug, Greenhouse, Taleo, Jobvite, iCIMS, Applitrack, HRMDirect, then remaining high-volume sources.

### Phase 4: Registry Cleanup

Remove the parser dependency from `server/ingestion/sources/common.js` to `server/index.js`. Keep `server/index.js` focused on server/API runtime and move source-specific parser logic into source folders.

## Test Strategy

Minimum local verification for Phase 1:

```powershell
npm.cmd run test:parsers
npm.cmd run test:backend
npm.cmd run test:worker-backlog
git diff --check
```

For Phase 2 parser fixes, add targeted red/green tests before implementation:

```powershell
node --test server\ingestion\direct-parser-fixtures.test.js --test-name-pattern "applytojob|breezy|careerplug|greenhouse"
node --test server\ingestion\sources\htmlPublicSourceModules.test.js --test-name-pattern "applytojob|breezy|careerplug"
```

Production verification, only after explicit deploy approval:

```bash
curl -fsS http://127.0.0.1:8081/health
docker exec openjobslots-app npm run audit:worker-backlog -- --diagnostics --targets=applytojob,breezy,careerplug,greenhouse --json
docker exec openjobslots-app npm run audit:source-freshness -- --json
docker exec openjobslots-app npm run search:reindex:check -- --json
```

## Success Criteria

- ApplyToJob and Breezy parser code no longer lives in `server/index.js`.
- `server/ingestion/sources/common.js` imports ApplyToJob and Breezy parsers from source-owned modules.
- Existing parser and backend tests pass.
- No production write, backfill, source apply, cleanup, or reindex is run.
- The next parser fix PR can be made in small source files without reading or editing the full `server/index.js` god file.
