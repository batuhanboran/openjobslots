---
sidebar_position: 4
title: Filtering Jobs
description: Narrow postings by ATS, industry, geography, remote mode, and date availability.
---

## Open filters panel

From `Postings`, use:

- `Show Filters` to open panel
- `Clear` to reset all filters

## Search + structured filters

OpenJobSlots combines text search with structured filters.

### Text search

- Search box: `Search company or title`
- Debounced request behavior (fast typing does not spam API calls)

![Search company or title](/search_by_company_1.png)

### ATS filter

- Single-select ATS picker (`All ATS` by default)

![Search company or title](/filter_by_ats.png)

### Industry and location filters

- `Industries` (multi-select)
- `Regions` (multi-select)
- `Countries` (multi-select)
- `States` (multi-select)
- `Counties` (multi-select)

Dependency behavior:

- Region selections narrow country options.
- State selections narrow county options.

![Search company or title](/filter_by_options.png)

### Remote filter

Values:

- `All Locations`
- `Remote Only`
- `Hybrid Only`
- `On-Site / Unknown`

![Search company or title](/filter_by_remote.png)

### Date quality toggle

- `Hide postings with no date`

## Filtering behavior notes

- Applied postings are hidden in the default Postings view.
- Ignored postings are hidden in the default Postings view.
- Blocked companies are excluded before result rendering.

## Tips for faster triage

1. Start with ATS + remote filters.
2. Add industries.
3. Add region/country/state as needed.
4. Use `Hide postings with no date` when freshness matters.
5. Save and block aggressively to keep daily review short.

## API parity (advanced)

The UI maps directly to `/postings` query params, including:

- `search`
- `ats`
- `industries`
- `regions`
- `countries`
- `states`
- `counties`
- `remote`
- `hide_no_date`

