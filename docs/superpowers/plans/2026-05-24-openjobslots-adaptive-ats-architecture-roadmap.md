# OpenJobSlots Adaptive ATS Architecture Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden OpenJobSlots adaptive ATS source-module architecture so supported ATS claims scale beyond the current parser modularization without creating a new god file.

**Architecture:** Keep `server/index.js` as bootstrap/runtime composition, promote source ownership into per-ATS modules through a shared source contract, and fan out ATS work only after representative contract pilots prove the path. Parser bug fixes, source apply/canary runs, production backfills, cleanup jobs, worker budget changes, and deploys are out of scope for this roadmap.

**Tech Stack:** Node.js CommonJS, existing OpenJobSlots ingestion/source modules, source-contract tests, parser fixture tests, architecture-boundary audit, Postgres/Meili production model as read-only context only.

---

## Baseline Evidence

This roadmap was produced from a clean strategy worktree based on the current private repo mainline:

- Worktree: `<local-worktree>`
- Branch: `codex/openjobslots-adaptive-ats-architecture-roadmap`
- HEAD: `64a069db7232fb37325e3271396a39f75a1cccff`
- `origin/main`: `64a069db7232fb37325e3271396a39f75a1cccff`
- Remote: `https://github.com/batuhanboran/openjobslots.git`
- Pre-flight audit: `npm.cmd run audit:architecture-boundary -- --json` returned `ok: true`
- `server/index.js`: `2920` nonblank lines against cap `3000`
- Architecture audit warnings: known legacy bootstrap/alias debt remains in `server/index.js` for `legacy_dynamic_target_url`, `legacy_usajobs_endpoint_constant`, and `legacy_ats_alias_pattern`
- No production write, deploy, source apply, source canary, cleanup job, backfill, worker budget change, or reindex was run.

The old local checkout at `<local-checkout>` remains on dirty `codex/ats-parser-modularization` with `server/index.js` modified. This roadmap intentionally does not use that branch as its baseline.

## Current Architecture State

The architecture-boundary phase has succeeded at the first goal: `server/index.js` is no longer the primary ATS parser god file and is under the current cap. Parser bodies are extracted into `server/ingestion/sources/<ats>/parse.js`, shared parser helpers are under `server/ingestion/parsers/shared/`, and the backend tests now include source contract, registry, discovery, fetch, collector, and source module tests.

The architecture is only partially ready for the full supported ATS inventory:

- Configured ATS in current workbench: `60`.
- Current workbench status counts: `26` certified, `33` fallback, `1` unsupported.
- Source directories under `server/ingestion/sources`: `59`.
- Source modules exposed through `server/ingestion/sources/common.js` `SOURCE_SPECS`: `30`.
- Runtime registry pilots in `server/ingestion/sourceRegistry.js`: `greenhouse` and `icims` only.
- Parse-only legacy modules still routed through `sourceDiscovery.js` and `sourceCollectors.js`: most fallback/public, public-sector, and vendor-specific sources.
- User-requested additional inventory not configured in the current workbench: `PaycomOnline`, `AgileHR`, `Avature`, `Comeet`, `FactorialHR`, `Hireology`, `Crelate`, `HiringPlatform`, `Homerun`, `JibeApply`, `Jobs2Web`, `Occupop`, `PeopleAdmin`, `Personio`, `Recruiterflow`, `Softgarden`, `Trakstar`, `YCombinator`, `Yello`, `EdJoin`, `Webcruiter`, `AcademicJobsOnline`, `prismhr`, `silkroad`, and `paycor`.

Bottom line: the current system is a good parser extraction baseline and an early adaptive source-module baseline. It is not yet safe to claim the entire requested inventory is supported. Current support claims must distinguish certified/public, certified-but-held, fallback/public-risk, fallback/held, unsupported, alias-only, and inventory-only sources.

## Current God-File Risk

`server/index.js` is protected enough for this phase, but the next god-file risk has moved into ingestion source orchestration.

| File | Current lines | Risk | Finding | Required direction |
| --- | ---: | --- | --- | --- |
| `server/index.js` | 2920 | Medium | Under cap and audit-protected, but still has known legacy ATS bootstrap/alias warning patterns. | Keep cap at 3000; do not add ATS-specific domains, endpoints, parser imports, or source logic. |
| `server/ingestion/sourceCollectors.js` | 4364 | High | Centralized imports, rate-limit constants, endpoint URLs, per-ATS fetch functions, and giant dispatch make this the next god file. | Move fetch/discovery/detail behavior into per-source contracts; add line-count and ATS endpoint-pattern audit warnings for this file. |
| `server/ingestion/sourceDiscovery.js` | 1090 | High | Centralized `parse<Ats>Company` dispatch owns tenant parsing for many sources. | Move each discovery parser into `server/ingestion/sources/<ats>/discover.js`; keep only generic dispatch helpers. |
| `server/ingestion/sources/common.js` | 1760 | Medium-High | `SOURCE_SPECS` and `createSourceModule` help, but centralize family behavior and source-specific specs. | Keep generic normalization/gate helpers here; move source-specific specs into source folders. |
| `server/ingestion/sourceFetch.js` | 98 | Low | Generic fetch runtime with rate-limit state and retry-after parsing. | Keep shared and source-agnostic. |
| `server/ingestion/sourceContracts.js` | 74 | Low | Good generic contract definitions; current families/status enums need alignment with public roadmap family names. | Keep shared; extend only by contract version. |
| `server/ingestion/sourceRegistry.js` | 54 | Low now, incomplete | Registry is tiny because it only exposes `greenhouse` and `icims` as pilots. | Make it data-driven from certified source modules after contract hardening. |
| `server/ingestion/sources/index.js` | 15 | Low | Thin map over `SOURCE_SPECS`. | Keep thin; do not let it become dispatch logic. |

The architecture audit currently protects:

- `server/index.js` line cap.
- Some ATS-specific domain/pattern bans inside `server/index.js`.
- Source-module import bans against importing `server/index.js`.
- Public surface leak scan over selected public files.
- Repository remote boundary against third-party templates.

Audit gaps to close next:

- No line cap or warning threshold for `sourceCollectors.js`, `sourceDiscovery.js`, or `sources/common.js`.
- No broad scan for ATS endpoint constants moving from `server/index.js` into a new shared god file.
- `sourceRegistry.js` is pilot-only, so green registry tests do not prove all source modules use the contract.
- Public leak scan is useful but intentionally narrow; admin/source diagnostics still need route-level discipline.

## Repository Independence

OpenJobSlots must continue to avoid third-party template dependencies:

- Use upstream only as conceptual prior art for god-file risk.
- Do not copy source code, endpoint implementations, parser behavior, or deployment assumptions.
- Do not make upstream a runtime dependency, sync source, submodule, package dependency, or deploy source.
- Keep production deployment tied to `batuhanboran/openjobslots` and the deploy host `<app-dir>`.

## Supported, Partial, And Unsupported Distinction

Use these labels in future threads and public/internal reporting:

- `certified/public`: strict parser fixture coverage exists and current workbench marks public writes enabled. Still not permission for broad source apply without recovery preflight.
- `certified/hold`: strict parser coverage exists, but live quality risk or public gate posture requires hold/quarantine.
- `fallback/public`: current system has runtime behavior and may be public-enabled, but source contract and raw fixture evidence are incomplete. Do not market as fully supported.
- `fallback/hold`: runtime/parser pieces exist, but public enablement should stay held until strict raw fixtures and source contract pass.
- `unsupported/disabled`: configured but intentionally not implemented.
- `alias-only`: do not duplicate logic; map to the canonical ATS implementation.
- `inventory-only`: listed by strategy, but absent from the configured workbench and source modules. Do not claim support.

Current `certified/public` keys:

`adp_workforcenow`, `applicantpro`, `applytojob`, `ashby`, `bamboohr`, `breezy`, `careerplug`, `fountain`, `greenhouse`, `hrmdirect`, `icims`, `jobvite`, `lever`, `manatal`, `oracle`, `paylocity`, `pinpointhq`, `recruitcrm`, `recruitee`, `smartrecruiters`, `talentreef`, `taleo`, `workday`, `zoho`.

Current `certified/hold` keys:

`applitrack`, `hirebridge`.

Current `fallback/public` keys:

`applicantai`, `careerpuck`, `careerspage`, `eightfold`, `freshteam`, `gem`, `getro`, `governmentjobs`, `jobaps`, `join`, `k12jobspot`, `loxo`, `rippling`, `schoolspring`, `simplicant`, `talentlyft`, `talexio`, `ultipro`.

Current `fallback/hold` keys:

`adp_myjobs`, `brassring`, `calcareers`, `calopps`, `hibob`, `isolvisolvedhire`, `pageup`, `peopleforce`, `policeapp`, `sagehr`, `saphrcloud`, `statejobsny`, `teamtailor`, `theapplicantmanager`, `usajobs`.

Current `unsupported/disabled` key:

`dayforcehcm`.

`UKG` is an alias path for `ultipro`, not a separate implemented ATS family.

## ATS Family Summary

| Family | Current configured keys | Current architecture status | Roadmap posture |
| --- | --- | --- | --- |
| `direct_json` | `ashby`, `bamboohr`, `careerpuck`, `fountain`, `freshteam`, `gem`, `getro`, `greenhouse`, `lever`, `manatal`, `pinpointhq`, `recruitcrm`, `recruitee`, `rippling`, `smartrecruiters`, `talexio`, `teamtailor` | Strongest parser base, but only `greenhouse` is a registry pilot; many fallback/public keys remain parse-only legacy. | Use direct JSON as the first fan-out family after registry hardening. |
| `embedded_json` | `applicantpro`, `isolvisolvedhire`, `zoho` | `applicantpro` and `zoho` are certified, but `applicantpro` is still parse-only/legacy-owned and `isolvisolvedhire` is fallback/hold. | Fold into HTML/detail or vendor wave depending on source shape. |
| `html_detail` | `applicantai`, `applytojob`, `breezy`, `careerplug`, `careerspage`, `hibob`, `hirebridge`, `hrmdirect`, `icims`, `jobvite`, `join`, `loxo`, `peopleforce`, `sagehr`, `simplicant`, `talentlyft`, `talentreef`, `theapplicantmanager` | Highest risk of detail-fetch and source-quality mistakes; `icims` is a registry pilot, several others remain legacy parse-only. | Run one representative detail-heavy pilot before family fan-out. |
| `enterprise_api` | `adp_myjobs`, `adp_workforcenow`, `dayforcehcm`, `eightfold`, `oracle`, `pageup`, `paylocity`, `saphrcloud`, `ultipro`, `workday` | Mixed: several certified/public, several fallback/hold, Dayforce unsupported. Tenant discovery and pagination remain high risk. | Run one enterprise pilot after shared contract hardening. |
| `public_sector` | `applitrack`, `calcareers`, `calopps`, `governmentjobs`, `jobaps`, `k12jobspot`, `policeapp`, `schoolspring`, `statejobsny`, `usajobs` | Most are fallback and parse-only; date invention and city/agency location semantics are recurring risks. | Do not fan out until a public-sector pilot proves no fake date/geo behavior. |
| `brittle` | `brassring`, `taleo` | Taleo is certified/public but low confidence; BrassRing is fallback/hold. | Keep canary/quarantine-first; do not mix with direct JSON fan-out. |
| `unsupported / inventory-only` | `dayforcehcm` plus non-configured user inventory keys | No safe support claim. | Product decision and source research first; no implementation in parallel ATS threads. |

## ATS Architecture Matrix

Legend:

- `registry/common`: current source registry pilot path through `sourceRegistry.js` and `sources/common.js`.
- `common`: current generated source module path through `sources/common.js` `SOURCE_SPECS`.
- `legacy`: current `sourceDiscovery.js` plus `sourceCollectors.js` ownership.
- `strict`: current workbench marks parser fixtures as strict parser-fixture-backed.
- `partial`: source-local fixture files may exist, but current workbench still marks strict certification incomplete.
- `missing`: no strict fixture evidence for that column.
- `hold`: do not claim broad public support or run apply/canary without a separate recovery thread and full safety gates.

| ats_key / display name | source family | current module path | discover ownership | fetchList ownership | fetchDetail ownership | parse ownership | normalize/validate ownership | raw fixture status | expected normalized fixture status | invalid-shape fixture status | public gate/certification status | god-file risk | next recommended action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `adp_myjobs` / ADP MyJobs | enterprise_api | `server/ingestion/sources/adp_myjobs/index.js` | common | common | common/null | source parse.js | common posting gate | partial | partial | partial | fallback/hold | medium | Register contract and move tenant fetch/discovery out of collectors; keep held. |
| `adp_workforcenow` / ADP Workforce Now | enterprise_api | `server/ingestion/sources/adp_workforcenow/index.js` | common | common | common/null | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract and remove collector ownership. |
| `applicantai` / ApplicantAI | html_detail | `server/ingestion/sources/applicantai/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Promote from parse-only legacy collector to source contract before support claim. |
| `applicantpro` / ApplicantPro | embedded_json | `server/ingestion/sources/applicantpro/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | strict | strict | strict | certified/public | high | Move certified parser into full source contract. |
| `applytojob` / ApplyToJob | html_detail | `server/ingestion/sources/applytojob/index.js` | common | common | common/detail-supported | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract; keep detail behavior fixture-backed. |
| `ashby` / Ashby | direct_json | `server/ingestion/sources/ashby/index.js` | common | common | common/null | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Use as direct JSON fan-out candidate after registry hardening. |
| `bamboohr` / BambooHR | direct_json | `server/ingestion/sources/bamboohr/index.js` | common | common | common/null | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract; add sparse-location variants. |
| `brassring` / BrassRing | brittle | `server/ingestion/sources/brassring/index.js` | common | common | common/null | source parse.js | common posting gate | partial | partial | partial | fallback/hold | medium | Keep brittle/hold; add paired board/API variants before public claim. |
| `breezy` / BreezyHR | html_detail | `server/ingestion/sources/breezy/index.js` | common | common | common/detail-supported | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract; add detail variants for list omissions. |
| `careerplug` / CareerPlug | html_detail | `server/ingestion/sources/careerplug/index.js` | common | common | common/null | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract; keep placeholder-title rejection. |
| `careerpuck` / CareerPuck | direct_json | `server/ingestion/sources/careerpuck/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Promote to source contract with raw/expected/invalid fixtures. |
| `careerspage` / CareersPage | html_detail | `server/ingestion/sources/careerspage/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Promote to source contract with raw fixtures. |
| `dayforcehcm` / Dayforce | enterprise_api | none | none | none | none | none | none | unsupported | missing | missing | unsupported/disabled | none | Do not claim support; implement only after endpoint review. |
| `eightfold` / Eightfold | enterprise_api | `server/ingestion/sources/eightfold/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Add raw API fixture, source id, pagination, then contract. |
| `fountain` / Fountain | direct_json | `server/ingestion/sources/fountain/index.js` | common | common | common/null | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract; add path/pagination variants. |
| `freshteam` / Freshteam | direct_json | `server/ingestion/sources/freshteam/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Certify raw HTML/JSON shape before support claim. |
| `gem` / Gem | direct_json | `server/ingestion/sources/gem/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Add GraphQL batch fixture and source-id coverage. |
| `getro` / Getro | direct_json | `server/ingestion/sources/getro/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Add Next.js raw fixture and canonical/apply URL coverage. |
| `greenhouse` / Greenhouse | direct_json | `server/ingestion/sources/greenhouse/index.js` | registry/common | registry/common | registry/common/null | source parse.js | registry/common gate | strict | strict | strict | certified/public | low | Keep as direct JSON registry baseline. |
| `hirebridge` / Hirebridge | html_detail | `server/ingestion/sources/hirebridge/index.js` | common | common | common/detail-supported | source parse.js | common posting gate | strict | strict | strict | certified/hold | medium | Keep held; detail-refetch/quality proof before public promotion. |
| `hrmdirect` / HRMDirect | html_detail | `server/ingestion/sources/hrmdirect/index.js` | common | common | common/detail-supported | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract; add sparse-cell variants. |
| `icims` / iCIMS | html_detail | `server/ingestion/sources/icims/index.js` | registry/common | registry/common | registry/detail-supported | source parse.js | registry/common gate | strict | strict | strict | certified/public | low | Keep as HTML/detail registry baseline; continue bounded detail variants. |
| `jobaps` / JobAps | public_sector | `server/ingestion/sources/jobaps/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Add public-sector raw fixture and JobNum source id. |
| `jobvite` / Jobvite | html_detail | `server/ingestion/sources/jobvite/index.js` | common | common | common/detail-supported | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract; add grouped department/date variants. |
| `join` / JOIN | html_detail | `server/ingestion/sources/join/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Add Next.js state fixture and source-id coverage. |
| `lever` / Lever | direct_json | `server/ingestion/sources/lever/index.js` | common | common | common/null | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Good direct JSON pilot candidate after registry hardening. |
| `loxo` / Loxo | html_detail | `server/ingestion/sources/loxo/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Move through rate-limit wrapper and add fixtures. |
| `manatal` / Manatal | direct_json | `server/ingestion/sources/manatal/index.js` | common | common | common/null | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract; add API sparse-date variants. |
| `oracle` / Oracle Cloud | enterprise_api | `server/ingestion/sources/oracle/index.js` | common | common | common/null | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Enterprise pilot candidate; add site/language variants. |
| `pageup` / PageUp | enterprise_api | `server/ingestion/sources/pageup/index.js` | common | common | common/detail-supported | source parse.js | common posting gate | partial | partial | partial | fallback/hold | medium | Keep held until two-part search/detail fixtures and canary proof. |
| `paylocity` / Paylocity | enterprise_api | `server/ingestion/sources/paylocity/index.js` | common | common | common/null | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract; add malformed `Jobs` variants. |
| `peopleforce` / PeopleForce | html_detail | `server/ingestion/sources/peopleforce/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/hold | high | Add open/closed fixtures and source contract before promotion. |
| `pinpointhq` / PinpointHQ | direct_json | `server/ingestion/sources/pinpointhq/index.js` | common | common | common/null | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract; add sparse path/location variants. |
| `recruitcrm` / RecruitCRM | direct_json | `server/ingestion/sources/recruitcrm/index.js` | common | common | common/null | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract; add pagination/geo variants. |
| `recruitee` / Recruitee | direct_json | `server/ingestion/sources/recruitee/index.js` | common | common | common/null | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract; add language/sparse-date variants. |
| `rippling` / Rippling | direct_json | `server/ingestion/sources/rippling/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Add API fixture, pagination, source id, workplace type. |
| `sagehr` / SageHR | html_detail | `server/ingestion/sources/sagehr/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/hold | high | Add open/restricted response fixtures. |
| `saphrcloud` / SAP HR Cloud | enterprise_api | `server/ingestion/sources/saphrcloud/index.js` | common | common | common/null | source parse.js | common posting gate | partial | partial | partial | fallback/hold | medium | Add HTML fallback/pagination variants before promotion. |
| `simplicant` / Simplicant | html_detail | `server/ingestion/sources/simplicant/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Add jobs/leads path fixtures and source id. |
| `talentlyft` / Talentlyft | html_detail | `server/ingestion/sources/talentlyft/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Add landing plus fragment fixtures and source id. |
| `talentreef` / TalentReef | html_detail | `server/ingestion/sources/talentreef/index.js` | common | common | common/null | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract; verify alias/search split. |
| `taleo` / Taleo | brittle | `server/ingestion/sources/taleo/index.js` | common | common | common/detail-supported | source parse.js | common posting gate | strict | strict | strict | certified/public-low-confidence | medium | Keep canary/quarantine-first despite certification; add tenant variants. |
| `talexio` / Talexio | direct_json | `server/ingestion/sources/talexio/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Add API fixture, country normalization, remote/hybrid. |
| `teamtailor` / Teamtailor | direct_json | `server/ingestion/sources/teamtailor/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/hold | high | Prefer stable API or certify saved board fixture before claim. |
| `theapplicantmanager` / The Applicant Manager | html_detail | `server/ingestion/sources/theapplicantmanager/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/hold | high | Add raw fixture and detail strategy. |
| `ultipro` / UltiPro | enterprise_api | `server/ingestion/sources/ultipro/index.js` | common | common | common/null | source parse.js | common posting gate | partial | partial | partial | fallback/public-risk | medium | Add pagination/count and remote/hybrid variants before promotion. |
| `workday` / Workday | enterprise_api | `server/ingestion/sources/workday/index.js` | common | common | common/detail-supported | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Enterprise pilot candidate; add detail-description/pagination variants. |
| `zoho` / Zoho | embedded_json | `server/ingestion/sources/zoho/index.js` | common | common | common/null | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract; add malformed hidden JSON variants. |
| `governmentjobs` / governmentjobs | public_sector | `server/ingestion/sources/governmentjobs/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Public-sector pilot candidate; stop invented dates and add raw fixture. |
| `smartrecruiters` / smartrecruiters | direct_json | `server/ingestion/sources/smartrecruiters/index.js` | common | common | common/null | source parse.js | common posting gate | strict | strict | strict | certified/public | medium | Register contract; review authenticated API boundary separately. |
| `hibob` / hibob | html_detail | `server/ingestion/sources/hibob/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/hold | high | Add raw API fixture and source id. |
| `isolvisolvedhire` / isolvisolvedhire | embedded_json | `server/ingestion/sources/isolvisolvedhire/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/hold | high | Add board/API fixtures and absolutize URLs. |
| `policeapp` / policeapp | public_sector | `server/ingestion/sources/policeapp/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/hold | high | Add pagination/date strategy or leave date null; raw fixture. |
| `usajobs` / usajobs | public_sector | `server/ingestion/sources/usajobs/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/hold | high | Add official payload fixture and map `DocumentID`. |
| `k12jobspot` / k12jobspot | public_sector | `server/ingestion/sources/k12jobspot/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Add JSON fixture and job id mapping. |
| `schoolspring` / schoolspring | public_sector | `server/ingestion/sources/schoolspring/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/public-risk | high | Add JSON fixture and `jobId` source id. |
| `calcareers` / calcareers | public_sector | `server/ingestion/sources/calcareers/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/hold | high | Add postback fixture and JobControl source id. |
| `calopps` / calopps | public_sector | `server/ingestion/sources/calopps/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/hold | high | Stop invented dates; add fixture and source id. |
| `statejobsny` / statejobsny | public_sector | `server/ingestion/sources/statejobsny/index.js` | legacy | legacy | legacy/detail-if-needed | source parse.js only | posting/common gate | missing | missing | missing | fallback/hold | high | Add table fixture and vacancy id extraction. |
| `paycomonline` / PaycomOnline | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `agilehr` / AgileHR | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `avature` / Avature | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `comeet` / Comeet | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision; Comeet public token/config review before code. |
| `factorialhr` / FactorialHR | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `hireology` / Hireology | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `crelate` / Crelate | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `hiringplatform` / HiringPlatform | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `homerun` / Homerun | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `jibeapply` / JibeApply | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `jobs2web` / Jobs2Web | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `occupop` / Occupop | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `peopleadmin` / PeopleAdmin | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `personio` / Personio | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision; likely future direct XML/API source, not current support. |
| `recruiterflow` / Recruiterflow | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `softgarden` / Softgarden | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `trakstar` / Trakstar | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision; do not mix with existing `teamtailor`/HTML wave. |
| `ukg` / UKG | enterprise_api | `server/ingestion/sources/ultipro/index.js` alias | common | common | common/null | UltiPro source parse.js | common posting gate | partial | partial | partial | alias/fallback-public-risk | medium | Treat as UltiPro alias; do not create duplicate UKG logic. |
| `ycombinator` / YCombinator | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `yello` / Yello | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `edjoin` / EdJoin | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision; likely public-sector/education intake. |
| `webcruiter` / Webcruiter | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `academicjobsonline` / AcademicJobsOnline | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision; likely education/public-sector intake. |
| `prismhr` / prismhr | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `silkroad` / silkroad | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |
| `paycor` / paycor | unsupported/inventory-only | none | none | none | none | none | none | missing | missing | missing | inventory-only | none | Product decision, endpoint research, source module, fixtures. |

## Recommended Strategy

Choose **E. Hybrid strategy**.

The next work should be:

1. One shared contract/registry hardening thread.
2. Three to four representative ATS pilot threads that prove the contract across source families.
3. Family-based fan-out only after the pilots pass.
4. A final integration thread to reconcile docs, audit caps, workbench status, and broad tests.

Why not the other options:

- **A. One big shared contract implementation thread first** is necessary but insufficient. It can produce a clean abstraction that only works for `greenhouse` and `icims`, while enterprise, public-sector, and brittle variants still break when real source modules are migrated.
- **B. Two or three representative ATS pilot threads first** is too weak without shared contract hardening first. Parallel pilots would all need to edit `sourceRegistry.js`, `sourceCollectors.js`, `sourceDiscovery.js`, and `sources/common.js`, creating merge conflicts and inconsistent contracts.
- **C. Family-based parallel threads** is premature. Families still share central files, so parallel family branches would fight over the same dispatch and registry surfaces.
- **D. One ATS per thread** is too slow and would duplicate contract decisions dozens of times. It is useful only after the shared contract and family playbooks are stable.

The hybrid path maximizes learning while protecting shared files from parallel ATS-specific edits.

## Exact Next Thread List

### Thread 1: Shared Contract And Registry Hardening

- Branch: `codex/openjobslots-ats-contract-registry-hardening`
- Goal: make source contract, registry, and audits ready for multi-family pilots without migrating every ATS.
- Writable paths:
  - `server/ingestion/sourceContracts.js`
  - `server/ingestion/sourceContracts.test.js`
  - `server/ingestion/sourceRegistry.js`
  - `server/ingestion/sourceRegistry.test.js`
  - `server/ingestion/sources/index.js`
  - `scripts/audit-architecture-boundary.js`
  - `package.json` only if adding a script
  - `docs/superpowers/specs/2026-05-24-openjobslots-adaptive-ats-source-contract.md`
- Shared read-only paths:
  - `server/index.js`
  - `server/ingestion/sourceCollectors.js`
  - `server/ingestion/sourceDiscovery.js`
  - `server/ingestion/sourceFetch.js`
  - `server/ingestion/sources/common.js`
  - all `server/ingestion/sources/<ats>/parse.js`
- Tests:
  - `npm.cmd run audit:architecture-boundary -- --json`
  - `node server/ingestion/sourceContracts.test.js`
  - `node server/ingestion/sourceRegistry.test.js`
  - `npm.cmd run test:backend`
  - `git diff --check`
- Stop conditions:
  - Needs parser-specific behavior change.
  - Needs production source apply/canary/backfill.
  - Requires lowering source-quality thresholds or worker budgets.
  - Adds source-specific endpoint logic to `server/index.js`.
  - Makes `sourceRegistry.js` another hand-maintained per-ATS dispatch table.

### Thread 2: Direct JSON Pilot - Lever Or Ashby

- Branch: `codex/openjobslots-ats-pilot-direct-json-lever`
- Goal: migrate one non-registry certified direct JSON source from `common`/collector ownership into a source-local contract without parser behavior changes.
- Preferred source: `lever` because it is certified/public and representative of simple direct JSON pagination/source-id concerns.
- Writable paths:
  - `server/ingestion/sources/lever/**`
  - `server/ingestion/sources/directSourceModules.test.js`
  - source-local fixture files under `server/ingestion/sources/lever/fixtures/**`
  - one source-local workbench doc JSON/markdown entry if regenerated for `lever`
- Shared read-only paths:
  - `server/index.js`
  - `server/ingestion/sourceCollectors.js`
  - `server/ingestion/sourceDiscovery.js`
  - `server/ingestion/sourceFetch.js`
  - `server/ingestion/sourceRegistry.js`
  - `server/ingestion/sources/common.js`
- Tests:
  - `npm.cmd run audit:architecture-boundary -- --json`
  - `npm.cmd run test:parsers`
  - `npm.cmd run test:backend`
  - `git diff --check`
- Stop conditions:
  - Needs new production endpoint probing beyond saved fixtures.
  - Parser output changes without new raw/expected/invalid fixture evidence.
  - Requires editing shared dispatch files beyond the contract extension defined in Thread 1.

### Thread 3: Enterprise API Pilot - Workday

- Branch: `codex/openjobslots-ats-pilot-enterprise-workday`
- Goal: prove tenant/site discovery, paginated list fetch, source ids, relative date handling, and enterprise rate-limit behavior can live source-locally.
- Writable paths:
  - `server/ingestion/sources/workday/**`
  - `server/ingestion/sources/enterpriseSourceModules.test.js`
  - source-local fixture files under `server/ingestion/sources/workday/fixtures/**`
- Shared read-only paths:
  - `server/index.js`
  - `server/ingestion/sourceCollectors.js`
  - `server/ingestion/sourceDiscovery.js`
  - `server/ingestion/sourceFetch.js`
  - `server/ingestion/sourceRegistry.js`
  - `server/ingestion/sources/common.js`
- Tests:
  - `npm.cmd run audit:architecture-boundary -- --json`
  - `npm.cmd run test:parsers`
  - `npm.cmd run test:backend`
  - `git diff --check`
- Stop conditions:
  - Needs live Workday crawling.
  - Invents posting dates from relative labels without fixture-stable reference time.
  - Moves enterprise API constants into a shared god file instead of source-local module.

### Thread 4: HTML Detail Pilot - iCIMS

- Branch: `codex/openjobslots-ats-pilot-html-detail-icims`
- Goal: prove a detail-escalation source can keep list fetch, bounded detail fetch, parse, normalize, and gate evidence source-local.
- Writable paths:
  - `server/ingestion/sources/icims/**`
  - `server/ingestion/sources/enterpriseSourceModules.test.js`
  - source-local fixture files under `server/ingestion/sources/icims/fixtures/**`
- Shared read-only paths:
  - `server/index.js`
  - `server/ingestion/sourceCollectors.js`
  - `server/ingestion/sourceDiscovery.js`
  - `server/ingestion/sourceFetch.js`
  - `server/ingestion/sourceRegistry.js`
  - `server/ingestion/sources/common.js`
  - `server/ingestion/publicPostingGate.js`
  - `server/ingestion/parserEvidence.js`
- Tests:
  - `npm.cmd run audit:architecture-boundary -- --json`
  - `npm.cmd run test:parsers`
  - `npm.cmd run test:backend`
  - `git diff --check`
- Stop conditions:
  - Needs unbounded detail crawl.
  - Treats generic body text as geo/remote evidence.
  - Changes public gate thresholds.
  - Requires source apply/canary or detail-refetch writes.

### Thread 5: Public Sector Pilot - GovernmentJobs

- Branch: `codex/openjobslots-ats-pilot-public-sector-governmentjobs`
- Goal: prove a public-sector fallback source can be promoted without invented posting dates, fake geo, or broad scraping.
- Writable paths:
  - `server/ingestion/sources/governmentjobs/**`
  - a new public-sector source-module test file if needed
  - source-local fixture files under `server/ingestion/sources/governmentjobs/fixtures/**`
- Shared read-only paths:
  - `server/index.js`
  - `server/ingestion/sourceCollectors.js`
  - `server/ingestion/sourceDiscovery.js`
  - `server/ingestion/sourceFetch.js`
  - `server/ingestion/sourceRegistry.js`
  - `server/ingestion/sources/common.js`
- Tests:
  - `npm.cmd run audit:architecture-boundary -- --json`
  - `npm.cmd run test:parsers`
  - `npm.cmd run test:backend`
  - `git diff --check`
- Stop conditions:
  - Parser uses current time or "posted today" unless source fixture proves it.
  - Parser infers city/country from agency-wide or body text.
  - Needs public-sector broad crawl or production writes.

### Thread 6: Direct JSON Family Fan-Out

- Branch: `codex/openjobslots-ats-family-direct-json-contract`
- Start only after Threads 1-4 pass.
- Writable paths:
  - source-local folders for selected direct JSON sources only: `server/ingestion/sources/{ashby,bamboohr,fountain,pinpointhq,recruitcrm,recruitee,smartrecruiters,manatal}/**`
  - direct source tests and source-local fixtures
- Shared read-only paths:
  - all shared ingestion files unless the final integration thread owns the shared change
- Tests:
  - `npm.cmd run test:parsers`
  - `npm.cmd run test:backend`
  - `npm.cmd run audit:architecture-boundary -- --json`
  - `git diff --check`
- Stop conditions:
  - More than one shared file needs edits.
  - Fallback sources without raw fixtures are included in the same thread.

### Thread 7: HTML/Embedded Detail Family Fan-Out

- Branch: `codex/openjobslots-ats-family-html-embedded-contract`
- Start after iCIMS and GovernmentJobs pilots pass.
- Writable paths:
  - source-local folders for `applytojob`, `breezy`, `careerplug`, `hrmdirect`, `jobvite`, `talentreef`, `applicantpro`, `zoho`
  - HTML/public source tests and fixtures
- Shared read-only paths:
  - `server/ingestion/publicPostingGate.js`
  - `server/ingestion/parserEvidence.js`
  - `server/ingestion/sourceCollectors.js`
  - `server/ingestion/sourceDiscovery.js`
- Tests:
  - `npm.cmd run test:parsers`
  - `npm.cmd run test:backend`
  - `npm.cmd run audit:architecture-boundary -- --json`
  - `git diff --check`
- Stop conditions:
  - Need to adjust public gate policy.
  - Need to run source apply/canary/backfill/detail-refetch writes.

### Thread 8: Enterprise/Brittle Family Fan-Out

- Branch: `codex/openjobslots-ats-family-enterprise-brittle-contract`
- Start after Workday pilot passes.
- Writable paths:
  - source-local folders for `adp_workforcenow`, `paylocity`, `oracle`, `pageup`, `saphrcloud`, `ultipro`, `taleo`, `brassring`
  - enterprise tests and fixtures
- Shared read-only paths:
  - all central source dispatch and source-quality files
- Tests:
  - `npm.cmd run test:parsers`
  - `npm.cmd run test:backend`
  - `npm.cmd run audit:architecture-boundary -- --json`
  - `git diff --check`
- Stop conditions:
  - Brittle sources need public promotion claims.
  - Tenant-specific code starts entering shared modules.

### Thread 9: Public Sector Family Fan-Out

- Branch: `codex/openjobslots-ats-family-public-sector-contract`
- Start after GovernmentJobs pilot passes.
- Writable paths:
  - source-local folders for `jobaps`, `k12jobspot`, `schoolspring`, `calcareers`, `calopps`, `statejobsny`, `policeapp`, `usajobs`, `applitrack`
  - public-sector tests and fixtures
- Shared read-only paths:
  - all central source dispatch and public gate files
- Tests:
  - `npm.cmd run test:parsers`
  - `npm.cmd run test:backend`
  - `npm.cmd run audit:architecture-boundary -- --json`
  - `git diff --check`
- Stop conditions:
  - Date or geo invention appears.
  - A source needs live crawling or production writes to prove the contract.

### Thread 10: Inventory Intake Research

- Branch: `codex/openjobslots-ats-inventory-intake-research`
- Goal: classify non-configured requested inventory without implementation.
- Writable paths:
  - `docs/reference/ats-adapter-matrix.md`
  - `docs/reference/ats-source-certification.md`
  - new docs-only inventory notes if needed
- Shared read-only paths:
  - all code paths
- Tests:
  - `git diff --check`
  - `npm.cmd run audit:architecture-boundary -- --json`
- Stop conditions:
  - Code changes are required.
  - Any source is marked supported without raw fixture and contract plan.

### Thread 11: Final Integration

- Branch: `codex/openjobslots-ats-adaptive-architecture-integration`
- Goal: reconcile all pilots/family migrations, update docs/workbench status, tighten audit caps, and run broad local validation.
- Writable paths:
  - `scripts/audit-architecture-boundary.js`
  - `docs/PROJECT_STATE.md`
  - `handoff.md`
  - `docs/reference/ats-adapter-matrix.md`
  - `docs/reference/ats-source-certification.md`
  - `docs/reference/ats-workbench/**` only if regenerated by read-only tooling
  - shared ingestion files only for integration fixes that cannot remain source-local
- Tests:
  - `npm.cmd run audit:architecture-boundary -- --json`
  - `npm.cmd run test:backend`
  - `npm.cmd run test:parsers`
  - `git diff --check`
  - `npm.cmd run test:api` only if public API shape changed
  - `npm.cmd run search:parity` only if normalized public fields or search behavior changed
- Stop conditions:
  - Needs production write, deploy, source apply/canary, backfill, cleanup, or replace reindex.
  - Meili/Postgres parity repair becomes necessary.
  - Public API/UI would expose private paths, raw payloads, stack traces, or internal diagnostics.

## Shared File Protection Rules

Parallel ATS-specific threads must treat these files as read-only unless they are the named shared-contract or final-integration thread:

- `server/index.js`
- `server/ingestion/sourceContracts.js`
- `server/ingestion/sourceRegistry.js`
- `server/ingestion/sourceCollectors.js`
- `server/ingestion/sourceDiscovery.js`
- `server/ingestion/sourceFetch.js`
- `server/ingestion/sources/common.js`
- `server/ingestion/sources/index.js`
- `server/ingestion/publicPostingGate.js`
- `server/ingestion/parserEvidence.js`
- `server/ingestion/posting.js`
- `server/ingestion/safeFetch.js`
- `scripts/audit-architecture-boundary.js`
- `package.json`

ATS-specific threads should normally write only:

- `server/ingestion/sources/<ats>/**`
- source-local fixtures under `server/ingestion/sources/<ats>/fixtures/**`
- the relevant source-family test file
- a source-local workbench or docs entry when needed

If an ATS-specific thread needs to edit a protected shared file, it must stop and become a shared-contract/integration thread.

## Global Stop Conditions

Stop the active thread and report if any of these become true:

- Working tree is dirty before edits and the dirt is unrelated or unexplained.
- Branch is not based on current `origin/main`.
- `npm.cmd run audit:architecture-boundary -- --json` fails before work starts.
- `server/index.js` exceeds the architecture cap or gains ATS-specific implementation patterns.
- A change requires production source apply/canary, write backfill, cleanup, replace reindex, worker budget change, or threshold lowering.
- A parser behavior change is required but no raw fixture, expected normalized fixture, and invalid-shape fixture are in scope.
- Public UI/API/docs would expose private paths, secrets, stack traces, raw parser payloads, or internal diagnostics.
- A source can only be made to pass by inventing geo, remote state, source id, or posting date.
- A thread proposes copying code from third-party templates.

## Completion Criteria For The Whole Architecture Program

- `server/index.js` stays under the architecture cap and contains no ATS-specific implementation logic.
- `sourceCollectors.js`, `sourceDiscovery.js`, and `sources/common.js` no longer grow as central ATS-specific god files.
- Every public-supported ATS is either source-contract-backed with raw/expected/invalid fixtures or clearly labeled fallback/hold.
- Inventory-only ATS are not claimed as supported.
- Parallel ATS threads have clear writable paths and do not edit shared files.
- No production mutation happens without a separate explicitly approved recovery/deploy thread.
- Final integration updates `handoff.md`, `docs/PROJECT_STATE.md`, and the ATS reference/workbench docs with the new architecture state.
