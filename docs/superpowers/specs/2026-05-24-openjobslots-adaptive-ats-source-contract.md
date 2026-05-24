# OpenJobSlots Adaptive ATS Source Contract Spec

## Purpose

This spec defines the architecture contract future ATS source modules must satisfy before OpenJobSlots can claim that an ATS is supported beyond legacy fallback behavior.

The contract is architecture-level. It does not authorize parser bug fixes, production source apply/canary runs, production backfills, cleanup jobs, worker budget changes, threshold changes, deploys, or Meili replace reindexing.

## Required Source Module Shape

Each implemented ATS should converge on:

```text
server/ingestion/sources/<ats>/
  index.js
  discover.js
  fetchList.js
  fetchDetail.js
  parse.js
  normalize.js
  validate.js
  fixtures/
    company.json
    list.json
    expected-normalized.json
    invalid-shapes.json
```

`fetchDetail.js` may export a no-op/null detail fetch when the source family does not need detail pages. It must still be explicit so the detail-escalation decision is documented.

## Runtime Contract

Each source module must expose:

```js
{
  atsKey,
  family,
  status,
  parserVersion,
  discover(company),
  fetchList(company, options),
  fetchDetail(candidate, options),
  parse(rawPayload, company),
  normalize(rawPosting, company, options),
  validate(normalizedPosting),
  validatePublic(normalizedPosting),
  rateLimit(),
  qualityThreshold(),
  fixtures()
}
```

The module may reuse shared helpers for canonical URL cleanup, posting normalization, parser evidence, public gate evaluation, safe fetch, and rate limiting. It must not import `server/index.js`.

## Family Values

Use these public roadmap family names:

- `direct_json`
- `embedded_json`
- `html_detail`
- `enterprise_api`
- `public_sector`
- `brittle`
- `unsupported`

Current internal enum names in `sourceContracts.js` can be mapped to these values, but new docs and thread plans should use the roadmap names above.

## Status Values

Use these status meanings:

- `certified_public`: strict parser fixture coverage exists and public writes are allowed by current source-quality posture.
- `certified_hold`: strict parser fixture coverage exists, but source-quality risk keeps the source held or quarantine-first.
- `fallback_public`: runtime behavior exists and may currently be public-enabled, but strict source contract evidence is incomplete.
- `fallback_hold`: runtime behavior exists, but public support must stay held until strict fixtures and canary evidence exist.
- `unsupported_disabled`: configured but intentionally not implemented.
- `alias_only`: route to a canonical source implementation and do not duplicate source logic.
- `inventory_only`: listed by strategy but absent from configured sources and source modules.

Do not use "supported" without one of these qualifiers.

## Evidence Rules

Certified source support requires:

- Source discovery rule from company URL or configured target.
- Bounded list fetch rule with rate-limit posture.
- Detail fetch rule or explicit statement that detail is unnecessary.
- Raw source fixture from the actual HTML/JSON/API shape.
- Expected normalized fixture.
- Invalid-shape fixture proving missing title, company, canonical URL, source id, or unsafe geo/remote/date behavior is rejected or quarantined.
- Parser evidence for title, company, canonical URL, source job id, location, normalized geo, remote type, and posting date.
- Public gate result for fixture rows.
- Null/unknown fields justified by source fixture evidence, not by convenience.

Generic body text, district-wide language, unlabeled narrative text, and broad agency/school descriptions are not valid evidence for public geo or remote classification.

## Ownership Rules

Per-ATS ownership belongs in `server/ingestion/sources/<ats>/**`.

Shared files must remain source-agnostic:

- `server/ingestion/sourceContracts.js`
- `server/ingestion/sourceRegistry.js`
- `server/ingestion/sourceFetch.js`
- `server/ingestion/publicPostingGate.js`
- `server/ingestion/parserEvidence.js`
- `server/ingestion/posting.js`
- `server/ingestion/safeFetch.js`

These files must not become tenant- or ATS-specific dispatch files.

Files currently carrying central ATS-specific debt:

- `server/ingestion/sourceCollectors.js`
- `server/ingestion/sourceDiscovery.js`
- `server/ingestion/sources/common.js`

Future work should shrink those files by moving source-specific logic into source folders. Do not add new ATS implementation logic to `server/index.js`.

## Thread Write Boundaries

ATS-specific threads may write:

- `server/ingestion/sources/<ats>/**`
- source-local fixtures
- the relevant source-family test file
- source-local docs/workbench entries when the thread owns them

ATS-specific threads must treat these as read-only:

- `server/index.js`
- `server/ingestion/sourceCollectors.js`
- `server/ingestion/sourceDiscovery.js`
- `server/ingestion/sources/common.js`
- `server/ingestion/sourceRegistry.js`
- `server/ingestion/sourceContracts.js`
- `server/ingestion/sourceFetch.js`
- `scripts/audit-architecture-boundary.js`
- `package.json`

Shared contract and final integration threads may edit shared files, but must not include parser behavior changes unless explicitly scoped with fixtures and tests.

## Public Surface Boundary

No public route, UI bundle, docs site page, release note, or public status response may expose:

- private repo paths
- production private details beyond approved coarse public status
- `.env` values
- tokens, credentials, keys, or connection strings
- raw parser payloads
- stack traces
- source-only diagnostics intended for admin or operator use

Public source-quality status must stay coarse unless behind admin/session controls.

## Validation Rules

Docs-only source architecture work:

```powershell
git diff --check
npm.cmd run audit:architecture-boundary -- --json
```

Shared source contract or audit changes:

```powershell
npm.cmd run audit:architecture-boundary -- --json
npm.cmd run test:backend
git diff --check
```

ATS source-module changes that alter parse, normalize, validate, discover, or fetch behavior:

```powershell
npm.cmd run audit:architecture-boundary -- --json
npm.cmd run test:parsers
npm.cmd run test:backend
git diff --check
```

Search/public field behavior changes also require the relevant search/API parity commands from the current runbooks.

## Non-Goals

- No deployment.
- No production write.
- No `ats:source:apply`.
- No `ats:source:canary`.
- No write backfill.
- No cleanup job.
- No `search:reindex:replace`.
- No source-quality threshold lowering.
- No worker budget change.
- No copying code from `batuhanboran/OpenJobSlots`.
