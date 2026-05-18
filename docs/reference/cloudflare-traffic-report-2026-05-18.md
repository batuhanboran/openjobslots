# Cloudflare Traffic Report - 2026-05-18

Scope: `openjobslots.com`

Generated from Cloudflare GraphQL `httpRequestsAdaptiveGroups`.

## Method

Human-qualified filter:

- `requestSource = eyeball`
- `verifiedBotCategory = ""`
- Browser limited to Chrome, Firefox, Chrome Mobile, Mobile Safari, Edge, and Safari
- Excluded verified bot categories and obvious non-browser/headless traffic

Important caveat: Cloudflare Bot Score is not available on this zone/API plan, and Cloudflare Web Analytics/RUM REST access returned an authentication error from the connector. The unique number below is therefore a distinct-client-IP estimate, not Cloudflare's cookie-based "unique visitors" metric.

## Time Windows

All ranges are aligned to Europe/Istanbul local days.

- Today: 2026-05-18, UTC range `2026-05-17T21:00:00Z` to `2026-05-18T20:59:59Z`
- Yesterday: 2026-05-17, UTC range `2026-05-16T21:00:00Z` to `2026-05-17T20:59:59Z`
- Last 7 days: 2026-05-12 through 2026-05-18, UTC range `2026-05-11T21:00:00Z` to `2026-05-18T20:59:59Z`

## Summary

| Window | Human-qualified requests | Visits | Unique visitor estimate |
| --- | ---: | ---: | ---: |
| Today, 2026-05-18 | 157 | 132 | 7 |
| Yesterday, 2026-05-17 | 4,522 | 115 | 42 |
| Last 7 days | 36,021 | 1,830 | 232 |

## Today By Country

| Country | Unique visitor estimate | Requests | Visits |
| --- | ---: | ---: | ---: |
| US | 4 | 32 | 19 |
| SG | 3 | 125 | 113 |

## Yesterday By Country

| Country | Unique visitor estimate | Requests | Visits |
| --- | ---: | ---: | ---: |
| US | 17 | 66 | 12 |
| SG | 4 | 234 | 81 |
| KR | 4 | 8 | 0 |
| TR | 3 | 3,970 | 14 |
| JP | 3 | 43 | 0 |
| CN | 3 | 8 | 2 |
| DE | 2 | 176 | 2 |
| NL | 2 | 0 | 0 |
| CA | 1 | 9 | 1 |
| FR | 1 | 3 | 1 |
| ID | 1 | 2 | 0 |
| RO | 1 | 1 | 0 |

## Last 7 Days By Unique Visitor Estimate

| Country | Unique visitor estimate |
| --- | ---: |
| US | 95 |
| SG | 35 |
| JP | 15 |
| CN | 13 |
| NL | 10 |
| DE | 10 |
| HK | 9 |
| TR | 7 |
| KR | 7 |
| BR | 4 |
| CA | 3 |
| GB | 3 |
| FR | 3 |
| IN | 2 |
| SE | 2 |
| RU | 2 |
| PL | 2 |
| ID | 2 |

## Last 7 Days By Requests

| Country | Requests | Visits |
| --- | ---: | ---: |
| US | 24,943 | 224 |
| TR | 7,682 | 25 |
| NL | 1,352 | 425 |
| SG | 1,332 | 1,009 |
| DE | 197 | 3 |
| JP | 137 | 55 |
| CN | 87 | 11 |
| PL | 69 | 14 |
| KR | 34 | 4 |
| NG | 33 | 1 |
| FR | 27 | 19 |
| HK | 25 | 1 |
| CA | 24 | 4 |
| AU | 21 | 19 |
| GB | 15 | 3 |
| CH | 13 | 10 |
| BR | 10 | 0 |
| IN | 5 | 1 |
| RU | 4 | 1 |
| ID | 4 | 0 |

## Top Paths Last 7 Days

| Path | Requests | Visits |
| --- | ---: | ---: |
| `/sync/status` | 28,102 | 0 |
| `/postings` | 1,836 | 0 |
| `/frontend/log` | 1,809 | 0 |
| `/` | 641 | 251 |
| `/search/suggest` | 253 | 0 |
| `/postings/filter-options` | 158 | 0 |

There were also repeated WordPress-probing paths such as `//xmlrpc.php` and `//wp-includes/wlwmanifest.xml`. These are not product usage and should remain treated as scan/noise traffic.

## Search And Click Visibility

Cloudflare edge analytics can show requests, paths, visits, countries, browser families, and some request dimensions. It does not show real in-app button clicks unless Cloudflare Web Analytics/RUM or a first-party analytics event pipeline is installed.

Current visibility:

- Search API usage can be counted by path:
  - `/postings`: 1,836 requests over the last 7 days
  - `/search/suggest`: 253 requests over the last 7 days
- Query-string field access was not available through this Cloudflare GraphQL permission/path, so top exact search terms could not be extracted from Cloudflare in this run.
- Button clicks and card clicks are not visible from Cloudflare HTTP analytics unless they trigger distinct HTTP endpoints or frontend analytics events.

Recommended telemetry boundary:

- Add privacy-safe frontend events for:
  - search submitted
  - autocomplete selected
  - filter changed
  - sort changed
  - job card clicked
  - external apply link clicked
- Store only normalized event names, language, country, source page, timestamp bucket, and hashed/trimmed query terms where needed.
- Do not store IPs, raw user agents, full URLs with personal data, or raw query strings beyond a short retention/debug window.

## Token Handling

No Cloudflare API token or global API key is written in this report. Use the connected Cloudflare MCP connector or a gitignored local `.env.cloudflare.local` file for local scripts. Prefer API tokens over global API keys.
