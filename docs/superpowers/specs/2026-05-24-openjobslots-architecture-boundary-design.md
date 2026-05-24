# OpenJobSlots Architecture Boundary Design

## Status - May 24, 2026

This design starts from the aligned production branch, not the older local `codex/ats-parser-modularization` checkout. The implementation worktree is based on `origin/main` at `197e8f93185e6582aea2766c6d6ffc5acb13747d`, matching the live `/root/OpenJobSlots` deployment on production at the start of this thread.

The GitHub repository `batuhanboran/openjobslots` is private. The upstream inspiration repository `batuhanboran/OpenJobSlots` is public and must not be treated as a runtime dependency, sync source, or place to fetch code from. The public website remains public by design, so this boundary protects private source, deployment details, and server-side behavior rather than trying to hide public HTML, bundled client assets, or public API responses.

Current architecture facts:

- `server/index.js` is `10,437` lines on aligned `origin/main`.
- `server/ingestion/sources/<ats>/parse.js` owns pure parser logic across `59` source modules.
- `server/index.js` still owns legacy collector/discovery/fetch orchestration and exports `collectPostingsForCompany`.
- `server/ingestion/sources/common.js` still imports `collectPostingsForCompany` from `../../index` for legacy fallback.
- Production is Node/Express app plus worker, Postgres as source of truth, and Meilisearch as a derived public index.

## Goal

Make OpenJobSlots a private, independent production codebase that no longer depends architecturally on upstream OpenJobSlots, while shrinking `server/index.js` into a 2-3k line app bootstrap/orchestration file.

## Non-Goals

- Do not import, copy, or synchronize new code from `batuhanboran/OpenJobSlots`.
- Do not change public search ranking, parser quality thresholds, source apply behavior, worker budget, data retention, or Meili indexing as part of architecture extraction.
- Do not expose deployment paths, private hostnames, tokens, stack traces, raw parser payloads, `.env` values, or source-only diagnostics in public UI/routes.
- Do not repair the known Meili extra-document drift unless explicitly approved as a separate production write/reindex task.

## Privacy And Independence Boundary

The private boundary has three layers:

1. Repository boundary: `origin` must point at `batuhanboran/openjobslots`, not `batuhanboran/OpenJobSlots`; production must deploy from the private repository.
2. Public surface boundary: public HTML, bundled client JS, docs site content, and public API responses must not reveal private paths, secrets, production-only diagnostics, or stack traces.
3. Architecture boundary: source ingestion, parsing, worker, data-quality, and deployment logic must live in OpenJobSlots-owned modules. Upstream can be compared as prior art, but not consumed as code or runtime state.

This should be enforced with a local audit script that checks remotes, public-source strings, and god-file thresholds. The script should start as a ratchet rather than a final gate: fail on privacy leaks and upstream remotes immediately, then lower `server/index.js` line caps as extraction phases land.

## Target Server Shape

`server/index.js` should become an app runtime composition file:

- load environment/config
- create backend stores and search clients
- create shared runtime context
- register route modules
- wire scheduler/worker compatibility hooks
- start the HTTP server
- export a small compatibility surface required by tests or legacy scripts

It should not own:

- ATS source URL discovery
- ATS list/detail fetch functions
- ATS collector functions
- parser implementations
- public serializer/filter implementation details
- SEO/security middleware implementation details
- data-quality/report implementation details

Final target: `server/index.js` between 2,000 and 3,000 lines. The target is achievable only after the legacy `collectPostingsForCompany` fallback is moved out of `server/index.js`.

## Module Ownership

### Source Modules

Each ATS should move toward this contract:

```text
server/ingestion/sources/<ats>/
  index.js       # public source-module contract
  discover.js    # convert company URL/input into source target config
  fetchList.js   # fetch list/search payloads
  fetchDetail.js # optional bounded detail fetch
  parse.js       # parse raw payload into raw postings
  normalize.js   # normalize source-specific output where needed
  validate.js    # fixture-backed source contract validation
  fixtures/
```

`server/ingestion/sources/common.js` should orchestrate source modules through this contract. It should not import `server/index.js`.

### Runtime And HTTP Modules

Move non-source responsibilities out of `server/index.js` by ownership:

- `server/runtime/config.js`: environment parsing, defaults, and startup config.
- `server/runtime/appContext.js`: create dependency/context object passed to route modules.
- `server/http/security.js`: security headers, admin gate, rate limits, CORS helpers.
- `server/http/publicSeo.js`: SEO index rendering, robots, sitemap.
- `server/http/publicSerializers.js`: public-safe posting/status/source serialization.
- `server/search/locationFilters.js`: geo/search filter parsing and normalization helpers.

### Ingestion Modules

Move collector orchestration out in phases:

- `server/ingestion/sourceFetch.js`: shared source fetch wrappers, rate-limit integration, response limits.
- `server/ingestion/sourceDiscovery.js`: company URL to source config parsing.
- `server/ingestion/sourceCollectors.js`: `collectPostingsForCompany` and ATS-specific collectors.
- `server/ingestion/sourceRuntime.js`: source registry wiring used by worker, adapters, and source-job scripts.

## Extraction Strategy

Use a strangler pattern. Each slice must preserve behavior and tests before moving to the next slice.

1. Add the boundary audit and `server/index.js` line-count ratchet.
2. Extract HTTP/security/SEO/public serialization helpers; this has low data-risk and proves the pattern.
3. Extract search/location filter helpers; protect Turkey/Turkiye/Turkiye-alias and remote/country tests.
4. Extract shared source fetch wrappers and rate-limit constants.
5. Extract source discovery functions.
6. Extract ATS collectors into `server/ingestion/sourceCollectors.js`.
7. Remove `server/ingestion/sources/common.js` dependency on `../../index`.
8. Tighten the ratchet toward 3,000 lines after each successful extraction.

## Safety Rules

- Run on a branch/worktree based on `origin/main`, not the dirty old local branch.
- Preserve endpoint compatibility for `/health`, `/postings`, `/postings/filter-options`, `/search/suggest`, `/sync/status`, and `/ingestion/status`.
- Keep all public response sanitizers in the request path after extraction.
- Do not change source-quality gates, remote/geo inference, parser acceptance, or worker scheduling while moving files.
- Do not deploy until changes are committed, pushed, and explicitly approved for production.

## Verification

Local verification must include the smallest relevant set after each slice:

```powershell
node scripts/audit-architecture-boundary.js --json
npm.cmd run test:http
npm.cmd run test:search-corpus
npm.cmd run test:backend
git diff --check
```

Production verification, only after explicit deployment approval:

```bash
git -C /root/OpenJobSlots rev-parse HEAD
docker compose --project-directory /root/OpenJobSlots ps
curl -fsS http://127.0.0.1:8081/health
docker exec openjobslots-app npm run search:reindex:check -- --json
```

The known extra Meili placeholder document may keep `search:reindex:check` at `ok=false`; report it separately and do not repair it during architecture work.

## Success Criteria

- `batuhanboran/openjobslots` remains private and production deploys from that private repo.
- No upstream `batuhanboran/OpenJobSlots` remote or code-fetch dependency exists in the active implementation/deploy lane.
- Public UI/docs/routes do not expose secrets, `.env` values, private host paths, production stack traces, or source-only diagnostics.
- `server/ingestion/sources/common.js` no longer imports `../../index`.
- `collectPostingsForCompany` lives outside `server/index.js`.
- `server/index.js` is reduced below 3,000 lines and protected by a ratcheting architecture audit.
- Local tests pass for the touched ownership slices.
- Live deploy alignment is verified before any production success claim.
