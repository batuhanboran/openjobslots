# ATS Certification Workbench

This folder tracks the v1.5.17 ATS parser certification effort. It is intentionally stricter than the public ATS list: an ATS can be implemented and still remain uncertified until raw source fixtures prove how geo, posting date, remote mode, and source id are extracted or deliberately left null.

## Lane Files

- `../direct-json-api-ats-field-certification.json`: direct JSON/API sources.
- `enterprise-direct.md`: enterprise ATS and direct board APIs.
- `embedded-boards.md`: embedded JSON and semi-structured HTML boards.
- `vendor-specific.md`: smaller vendor-specific collectors.
- `public-education.md`: public sector and education boards.

## Certification Rule

Each configured ATS must have:

- source endpoint or page pattern;
- parser path;
- raw fixture status;
- geo/date/remote/source-id field decisions;
- tests still needed before certification.

Nullable fields are acceptable only when saved raw fixtures prove the source omitted the field or when the certification notes explicitly reject unsafe inference.
