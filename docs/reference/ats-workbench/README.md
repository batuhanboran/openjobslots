# ATS Certification Workbench

This directory is the evidence scoreboard for ATS parser certification. It is generated from configured adapter metadata plus read-only production or test quality statistics.

- `scoreboard.json`: machine-readable ATS scoreboard for all configured ATS keys.
- `scoreboard.md`: human-readable ATS scoreboard with wave priority, blockers, exact parser action, and public-enabled recommendation.
- `index.json`: canonical ATS-specific workbench index generated from scoreboard, adapter metadata, certification records, and fixture inventory.
- `sources/<ats>.json`: one structured work packet per ATS with fetch method, parser method, fixture state, quality threshold, public/quarantine decision, and failure log.
- `../../../server/ingestion/sources/<ats>/`: dedicated source modules for direct JSON/API and enterprise/brittle repair waves. Each module exposes `discover`, `fetchList`, `fetchDetail`, `parse`, `normalize`, and `validate`, with local `fixtures/list.json`, `fixtures/expected-normalized.json`, and `fixtures/invalid-shapes.json`.

## Work Packet Coverage

This workbench was produced with four read-only ATS review packets, capped at four parallel lanes:

1. Direct JSON/API: `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `recruitee`, `bamboohr`, `teamtailor`, `freshteam`, `pinpointhq`, `recruitcrm`, `fountain`, `getro`.
2. Enterprise/brittle: `workday`, `oracle`, `adp_myjobs`, `adp_workforcenow`, `paylocity`, `dayforcehcm`, `eightfold`, `saphrcloud`, `ultipro`, `pageup`, `taleo`, `brassring`.
3. Embedded/HTML: `jobvite`, `icims`, `zoho`, `breezy`, `applicantpro`, `applytojob`, `theapplicantmanager`, `careerplug`, `talentreef`, `hirebridge`, `hrmdirect`, `isolvisolvedhire`, `applitrack`.
4. Vendor/public-sector: `applicantai`, `gem`, `join`, `careerspage`, `manatal`, `hibob`, `sagehr`, `loxo`, `peopleforce`, `simplicant`, `rippling`, `careerpuck`, `talentlyft`, `talexio`, `governmentjobs`, `usajobs`, `k12jobspot`, `schoolspring`, `calcareers`, `calopps`, `statejobsny`, `policeapp`, `jobaps`.

The work packets did not edit files and did not access production. Their findings are summarized in `../ats-adapter-matrix.md` and `../ats-source-certification.md`.

Regenerate from production snapshots without mutating data:

```bash
npm run audit:ats-quality -- --quality-summary=/path/to/quality-summary.json --parser-stats=/path/to/parser-stats.json --json --output=docs/reference/ats-workbench/scoreboard.json --markdown-output=docs/reference/ats-workbench/scoreboard.md
```

Run directly against the configured Postgres database:

```bash
npm run audit:ats-quality -- --json --output=reports/ats-quality-scoreboard.json --markdown-output=reports/ats-quality-scoreboard.md
```

Generate the ATS-specific workbench files from the latest scoreboard snapshot:

```bash
npm run ats:workbench
npm run ats:workbench -- --source=greenhouse --json
npm run ats:workbench -- --json
```

The command is read-only. It does not backfill, refetch detail pages, or reindex Meilisearch.

The current direct JSON/API source-module wave covers `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `recruitee`, `bamboohr`, `manatal`, `recruitcrm`, `pinpointhq`, `fountain`, and `zoho`. The enterprise/brittle source-module wave covers `workday`, `icims`, `taleo`, `oracle`, `paylocity`, `adp_workforcenow`, `adp_myjobs`, `ultipro`, `pageup`, `saphrcloud`, and `brassring`. Runtime adapters prefer these modules for those ATS keys, so future source canaries use source-specific raw fetch and parser logic instead of the legacy identity parser path.
