# OpenJobSlots ATS Source Certification

OpenJobSlots should add ATS breadth only after parser correctness is proven. Third-party scraper repositories can be used for research, but source code should not be vendored unless license, maintenance, and correctness are reviewed.

## Current Coverage

- Configured ATS keys: 60.
- Fixture-backed ATS keys: 18.
- Implemented collectors pending fixtures: 41.
- Disabled unsupported ATS: `dayforcehcm`.

## Certification Gate

An ATS is certified only when all of these exist:

- Official documentation or a stable public endpoint description.
- Endpoint or URL pattern, pagination rule, rate-limit rule, and sample company URLs.
- Saved raw fixture from the source response.
- Expected normalized fixture using the common posting shape.
- Parser test that rejects missing title, company, or canonical URL.
- Adapter notes for date parsing, location parsing, remote/hybrid handling, known failure modes, and confidence.

## Expansion Priority

### Wave 1

| ATS | Source | Endpoint pattern | Notes |
| --- | --- | --- | --- |
| Personio | https://developer.personio.de/v1.0/reference/get_xml | `https://{company}.jobs.personio.de/xml?language=en` | Official XML feed; strong EU coverage. |
| Trakstar Hire / Recruiterbox | https://apiv1.recruiterbox.com/frontend_api.html | `https://jsapi.recruiterbox.com/v1/openings?client_name={client}` | Official frontend openings API. |
| JobScore | https://support.jobscore.com/hc/en-us/articles/202001320-Developers-Guide-to-Job-Feed-APIs | `https://careers.jobscore.com/jobs/{company}/feed.json` | Official JSON/XML feed. |

### Wave 2

| ATS | Source | Gate before enabling |
| --- | --- | --- |
| Workable | https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page | Review public widget config or API token handling. |
| Bullhorn | https://bullhorn.github.io/Public-API/ | Document `cls` and `corpToken` discovery/config. |
| Comeet / Spark Hire Recruit | https://developers.comeet.com/reference | Review public token handling and company UID discovery. |

## Aggregator Boundary

Remote/job-board aggregators such as Remotive, Himalayas, and Arbeitnow must stay separate from direct ATS adapters. They require stronger canonical URL dedupe and may have attribution or link-back requirements.
