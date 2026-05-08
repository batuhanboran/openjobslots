# OpenJobSlots Parser Certification

Parser certification is source-evidence-based. A parser is not certified from a hand-normalized row alone; it needs a saved raw ATS response fixture, an expected normalized output fixture, invalid-source-shape rejection coverage, and adapter metadata that explains what the source can and cannot provide.

## Contract

The repo-owned contract lives in `server/ingestion/parserContract.js`. Certified normalized postings must include:

- `source_job_id`
- `ats_key`
- `company`
- `title`
- `location_text`
- `country`
- `region`
- `city`
- `remote_type`
- `department`
- `employment_type`
- `description_plain`
- `description_html`
- `canonical_url`
- `apply_url`
- `posted_at`
- `posted_at_epoch`
- `first_seen_epoch`
- `last_seen_epoch`
- `raw_hash`
- `parser_version`
- `parser_confidence`

Validation rejects postings that do not have a usable URL, company, or title. Placeholder titles such as `Untitled Position` are parser attention, not valid public search rows.

## Current Strict Raw Coverage

Strict raw parser-fixture-backed adapters: 22.

`adp_workforcenow`, `applicantpro`, `applitrack`, `applytojob`, `ashby`, `bamboohr`, `breezy`, `careerplug`, `fountain`, `greenhouse`, `icims`, `lever`, `manatal`, `oracle`, `paylocity`, `pinpointhq`, `recruitcrm`, `recruitee`, `smartrecruiters`, `taleo`, `workday`, `zoho`.

The v1.6 hardening batch promoted:

| ATS | New raw coverage | Confidence |
| --- | --- | --- |
| `greenhouse` | Job Board API `jobs[]`, nested location, office country, department, content, source id, tracking-query cleanup, missing title/company/url rejection. | Medium |
| `lever` | Postings API array, categories/allLocations, country code, createdAt, hosted/apply URLs, source id, tracking-query cleanup, missing title/company/url rejection. | Medium |
| `ashby` | Official public jobs shape plus current collector-compatible fields, primary/secondary locations, address country, publishedAt, job/apply URLs, missing title/company/url rejection. | Medium |
| `smartrecruiters` | Public search `content[]`, id/company/location/releasedDate/department/employment/remote fields, missing title/company/url rejection. | Medium |
| `workday` | CXS `jobPostings[]`, externalPath URL building, JR source id, Work From Home evidence, source date text, missing title/company/url rejection. | Medium |
| `taleo` | REST requisition rows, unstable column date/location scanning, boolean-date rejection, jobId/contestNo source id, missing title/company/url rejection. | Low |

## Certification Rules

- Do not invent `posted_at`. If the source omits a posting date, keep it null and use `last_seen_epoch` for freshness.
- Do not infer country from ambiguous short codes unless the location parser has source-context safeguards. `IN-KL-Kozhikode` is India; `Indianapolis, IN` is United States.
- `canonical_url` must be stable for dedupe and strip tracking noise such as fragments, `utm_*`, `source`, `ref`, `gh_src`, `lever-source`, and similar campaign parameters. Job id parameters such as `gh_jid` and `jobId` must remain.
- `apply_url` can differ from `canonical_url`.
- `remote_type` must be `remote`, `hybrid`, `onsite`, or empty when source evidence is insufficient.
- Parser confidence is an adapter property, not a replacement for test coverage.

## Remaining Risky Sources

- `hrmdirect` still has normalized fixture coverage but no strict saved raw fixture.
- `teamtailor`, `freshteam`, `getro`, `jobvite`, and most vendor/public-sector boards still need raw fixtures.
- `taleo` has raw REST coverage but remains low-confidence until AJAX and tenant-specific column variants are saved.
- `dayforcehcm` stays disabled/unsupported until a public source, parser, fixtures, and rate-limit policy exist.

## Validation Commands

Use:

```bash
npm run test:parsers
npm run test:backend
npm run test:api
npm run quality:gate
```

On Windows PowerShell where script execution blocks `npm`, use `npm.cmd` instead.
