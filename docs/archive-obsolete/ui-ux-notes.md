# OpenJobSlots UI/UX Notes

Archived UI/UX pass notes. Current project state lives in `../PROJECT_STATE.md`; QA guidance lives in `../reference/QA_RUNBOOK.md`.

## Fixed In This Pass

- Public status failures no longer write to the global error banner. The coverage panel now shows a friendly unavailable state while search stays usable.
- The public Clear button now resets search, filters, suggestions, and result mode together. This matches the search-engine layout where the button sits beside the main search controls.
- Release notes can be closed with Escape, the Close button, or the backdrop. The release notes scroll region now has a stable test id for artifact review.
- Playwright coverage now includes controlled no-results behavior, status failure sanitization, Clear reset behavior, and release-note close behavior.

## Remaining UX Risks

- Search suggestions still depend partly on backend timing after the immediate local fallback. Slow API responses should not block typing, but deeper suggestion ranking work belongs in search quality hardening.
- The public coverage panel is compact, but large parser-attention counts can still make the page feel operational rather than consumer-facing. Keep detailed parser diagnostics in admin views.
- Mobile coverage and filter density are acceptable for the current data volume, but long filter option lists may eventually need virtualized option rendering.

