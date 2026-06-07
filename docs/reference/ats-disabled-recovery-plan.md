# Disabled ATS Recovery Plan

Generated: 2026-06-04T23:16:50.116Z

This report is read-only. It combines local source-module readiness with production source state so disabled sources are not mistaken for recovered sources before canary/apply and Meili/Postgres parity proof.

## Summary

- Production data available: yes
- Target count: 7
- Local ready count: 7
- Production gated count: 7

## Targets

| ats | state | local registry | production status | visible rows | blocker | next action |
| --- | --- | --- | --- | ---: | --- | --- |
| `workday` | production_gated | canary | false/auto_disabled | 0 | production protection blocks sync: auto_disabled | after explicit approval, backup, preflight, and worker isolation, reset source protection to a bounded canary state |
| `manatal` | production_gated | canary | false/auto_disabled | 0 | production protection blocks sync: auto_disabled | after explicit approval, backup, preflight, and worker isolation, reset source protection to a bounded canary state |
| `dayforcehcm` | production_gated | canary | false/canary_only | 0 | excluded from default sync | run read-only inventory scan, net-new estimate, and tenant batch plan |
| `gem` | production_gated | canary | false/auto_disabled | 31 | production protection blocks sync: auto_disabled | after explicit approval, backup, preflight, and worker isolation, reset source protection to a bounded canary state |
| `adp_workforcenow` | production_gated | enabled | false/auto_disabled | 26 | legacy alias rows present: adpworkforcenow | canonicalize legacy production ATS aliases into the canonical source key before promotion |
| `personio` | production_gated | canary | missing/missing | 0 | production source row missing | deploy/seed local source registry so production creates the disabled source row |
| `workable` | production_gated | canary | missing/missing | 0 | production source row missing | deploy/seed local source registry so production creates the disabled source row |
