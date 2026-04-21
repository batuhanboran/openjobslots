---
sidebar_position: 7
title: Applicantee AI Settings
description: Configure reusable applicantee profile information used by OpenJobSlots and AI workflows.
---

## Where to configure

Open:

- `Settings > Applicantee Information`

This data is the reusable applicant context for manual and AI-assisted application flows.

## Fields captured

### Identity and contact

- `First Name`
- `Middle Name`
- `Last Name`
- `Email`
- `Phone Number`
- `Address`

### Public profiles

- `LinkedIn URL`
- `GitHub URL`
- `Portfolio URL`

### Local document paths

- `Resume File Path`
- `Projects Portfolio File Path`
- `Certifications Folder Path`

### Optional profile attributes

- `Ethnicity`
- `Gender`
- `Age`
- `Years of Experience`
- `Veteran Status`
- `Disability Status`
- `Education Level`

## Save behavior

Click `Save Applicantee Information` to persist data through:

- `PUT /settings/personal-information`

Successful save shows:

- `Applicantee information saved.`

## Data quality tips for AI use

1. Keep resume and portfolio file paths valid and local.
2. Keep URLs current and reachable.
3. Use realistic `Years of Experience` and `Education Level` values.
4. Only fill optional demographic fields when you explicitly want them available for workflows.

## Related MCP usage

When MCP tools request applicant context, this profile is returned alongside MCP settings.

## Recommended screenshots to add

Add these files under `README-Images/docs/` when available:

- `README-Images/docs/applicantee-settings-form-top.png`
- `README-Images/docs/applicantee-settings-document-paths.png`
- `README-Images/docs/applicantee-settings-save-confirmation.png`
