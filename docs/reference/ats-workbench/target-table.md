# ATS Target Table

Generated: 2026-05-24T19:28:21.580Z

This report is read-only. It ranks current ATS families by visible live postings and records the parser threshold target for each source.

## Target Conditions

- All ATS keys must be reviewed individually before a parser/source-quality success claim.
- Parser work stays inside `server/ingestion/sources/<ats>/parse.js` plus raw, expected, and invalid-shape fixtures.
- Public growth must keep `no_geo_no_remote` at zero and must not regress global or source geo/remote percentages.
- High-volume ATS (`>= 5,000` visible rows) target at least 95% `location_text`, 90% any normalized geo, 95% known `remote_type`, and 70% posting-date evidence unless saved raw fixtures prove the source omits dates.
- Medium-volume ATS (`>= 1,000` visible rows) target at least 90% `location_text`, 85% any normalized geo, 90% known `remote_type`, and 50% posting-date evidence unless source omission is fixture-backed.
- Uncertified ATS are fixture-first: raw response fixture, expected normalized fixture, invalid-shape test, source id rule, canonical URL rule, and minimum parser confidence before broad public writes.

## Summary

- ATS count: 62
- Visible rows: 107947
- Configured companies: 40860
- Rows seen in 24h: 32244
- Worker targets due now: 7568
- Worker successes in 24h: 1924
- Worker failures in 24h: 8019
- Parser attention events in 24h: 7022
- Source runs in 24h: 0

## ATS Table

| ats | rows | companies | seen 24h | due | worker ok 24h | worker fail 24h | parser attn 24h | location % | any geo % | complete geo % | remote known % | posting date % | source id % | parse threshold | priority | next action |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| `hrmdirect` | 24384 | 2403 | 7009 | 850 | 200 | 389 | 211 | 99.66 | 99.62 | 96.42 | 97.33 | 0 | 100 | high_volume_quality_gate | 77.6 | review ATS individually; improve posting_date evidence in source parser and fixtures; inspect worker errors and parser attention events |
| `ashby` | 20135 | 1443 | 3660 | 878 | 200 | 33 | 1 | 100 | 98.87 | 78.62 | 99.08 | 100 | 100 | high_volume_quality_gate | 59.43 | review ATS individually; inspect worker errors and parser attention events |
| `applytojob` | 13770 | 3466 | 3110 | 926 | 200 | 3015 | 2932 | 98.32 | 86.85 | 80.5 | 96.3 | 13.2 | 100 | high_volume_quality_gate | 74.52 | review ATS individually; improve geo, posting_date evidence in source parser and fixtures; inspect worker errors and parser attention events |
| `applicantpro` | 9964 | 1554 | 2826 | 922 | 200 | 89 | 2 | 100 | 100 | 98.84 | 99.07 | 100 | 100 | high_volume_quality_gate | 56.99 | review ATS individually; inspect worker errors and parser attention events |
| `lever` | 9696 | 235 | 6443 | 0 | 211 | 12 | 2 | 99.92 | 99.97 | 75.75 | 100 | 100 | 100 | high_volume_quality_gate | 45.89 | review ATS individually; inspect worker errors and parser attention events |
| `bamboohr` | 8062 | 5144 | 1269 | 988 | 200 | 177 | 35 | 99.78 | 99.75 | 82.9 | 94 | 0 | 100 | high_volume_quality_gate | 74.2 | review ATS individually; improve remote_type, posting_date evidence in source parser and fixtures; inspect worker errors and parser attention events |
| `careerplug` | 6289 | 280 | 3596 | 20 | 239 | 50 | 0 | 100 | 99.94 | 90.83 | 94.43 | 0.11 | 100 | high_volume_quality_gate | 73.12 | review ATS individually; improve remote_type, posting_date evidence in source parser and fixtures; inspect worker errors and parser attention events |
| `breezy` | 5966 | 4317 | 2384 | 1112 | 200 | 4119 | 3831 | 100 | 99.55 | 90.14 | 90.75 | 30.44 | 100 | high_volume_quality_gate | 67.01 | review ATS individually; improve remote_type, posting_date evidence in source parser and fixtures; inspect worker errors and parser attention events |
| `greenhouse` | 5201 | 44 | 1578 | 0 | 27 | 9 | 5 | 100 | 97.37 | 76.68 | 88.54 | 100 | 100 | high_volume_quality_gate | 46.64 | review ATS individually; improve remote_type evidence in source parser and fixtures; inspect worker errors and parser attention events |
| `zoho` | 2606 | 1751 | 0 | 346 | 0 | 0 | 0 | 96.35 | 96.32 | 82.19 | 97.62 | 63.74 | 100 | medium_volume_quality_gate | 27.33 | monitor; current parser threshold is inside target range |
| `recruitcrm` | 522 | 26 | 0 | 26 | 0 | 0 | 0 | 100 | 91.38 | 8.62 | 98.08 | 0 | 100 | quarantine_quality_gate | 36.75 | review ATS individually; improve posting_date evidence in source parser and fixtures |
| `recruitee` | 519 | 2734 | 0 | 364 | 0 | 0 | 0 | 100 | 100 | 97.88 | 100 | 100 | 100 | quarantine_quality_gate | 21.73 | monitor; current parser threshold is inside target range |
| `fountain` | 409 | 17 | 369 | 0 | 17 | 10 | 3 | 100 | 99.27 | 62.84 | 64.55 | 0 | 100 | low_volume_monitor | 53.1 | review ATS individually; improve remote_type, posting_date evidence in source parser and fixtures; inspect worker errors and parser attention events |
| `applitrack` | 237 | 1323 | 0 | 445 | 0 | 0 | 0 | 100 | 100 | 0.84 | 0.84 | 83.12 | 100 | quarantine_quality_gate | 61.38 | review ATS individually; improve remote_type evidence in source parser and fixtures |
| `taleo` | 111 | 554 | 0 | 135 | 0 | 0 | 0 | 100 | 100 | 99.1 | 100 | 99.1 | 100 | disabled | -83.61 | keep disabled until source-backed parser and safety policy exist |
| `icims` | 64 | 2392 | 0 | 166 | 0 | 0 | 0 | 100 | 98.44 | 68.75 | 100 | 73.44 | 100 | quarantine_quality_gate | 14.5 | monitor; current parser threshold is inside target range |
| `pinpointhq` | 12 | 416 | 0 | 110 | 0 | 0 | 0 | 100 | 100 | 25 | 100 | 0 | 100 | disabled | -91.09 | keep disabled until source-backed parser and safety policy exist |
| `oracle` | 0 | 90 | 0 | 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no_live_rows_fixture_target | 59.65 | review ATS individually; add raw response fixture, expected normalized fixture, invalid-shape test, and source module threshold |
| `paylocity` | 0 | 291 | 0 | 42 | 229 | 16 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no_live_rows_fixture_target | 50.65 | review ATS individually; add raw response fixture, expected normalized fixture, invalid-shape test, and source module threshold |
| `adp_workforcenow` | 0 | 1 | 0 | 21 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no_live_rows_fixture_target | 34.65 | review ATS individually; add raw response fixture, expected normalized fixture, invalid-shape test, and source module threshold |
| `smartrecruiters` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no_live_rows_fixture_target | 34.65 | review ATS individually; add raw response fixture, expected normalized fixture, invalid-shape test, and source module threshold |
| `adp_myjobs` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `adpmyjobs` | 0 | 544 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `adpworkforcenow` | 0 | 231 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `applicantai` | 0 | 179 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `brassring` | 0 | 136 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `calcareers` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until bounded live canary and source quality evidence are approved |
| `calopps` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until bounded live canary and source quality evidence are approved |
| `careerpuck` | 0 | 57 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `careerspage` | 0 | 132 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `dayforcehcm` | 0 | 226 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `eightfold` | 0 | 56 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `freshteam` | 0 | 987 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `gem` | 0 | 364 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `getro` | 0 | 61 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `governmentjobs` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `hibob` | 0 | 227 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | source-local registry module; keep disabled until bounded live canary and source quality evidence are approved |
| `hirebridge` | 0 | 169 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `isolvisolvedhire` | 0 | 494 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `jobaps` | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `jobvite` | 0 | 454 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `join` | 0 | 1543 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `k12jobspot` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `loxo` | 0 | 110 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `manatal` | 0 | 1238 | 0 | 109 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `pageup` | 0 | 153 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `peopleforce` | 0 | 71 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `policeapp` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `rippling` | 0 | 1380 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `sagehr` | 0 | 110 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `saphrcloud` | 0 | 16 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `schoolspring` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `simplicant` | 0 | 19 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `statejobsny` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `talentlyft` | 0 | 188 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `talentreef` | 0 | 170 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `talexio` | 0 | 46 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `teamtailor` | 0 | 1019 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `theapplicantmanager` | 0 | 156 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `ultipro` | 0 | 936 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `usajobs` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
| `workday` | 0 | 892 | 0 | 108 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | disabled | -65.35 | keep disabled until source-backed parser and safety policy exist |
