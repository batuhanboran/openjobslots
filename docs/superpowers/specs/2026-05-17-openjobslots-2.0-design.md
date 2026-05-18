# OpenJobSlots 2.0 Design Spec

Date: 2026-05-17
Project: OpenJobSlots
Target release: 2.0.0
Status: Approved direction, demo-first execution

## Goal

Prepare a 2.0.0 frontend and backend upgrade that makes public job search faster to scan, safer to operate, and ready for future ATS source parsing without exposing internal diagnostics to public users.

## Selected Direction

Build Public Job Search 2.0 first, backed by a read-only ATS intelligence layer. The frontend upgrade should be visible in local demos before any live app changes are merged or deployed. Backend work should focus on source quality, parser confidence, and operational readiness rather than adding new ATS parsers immediately.

## Non-Goals

- No production deployment during the demo phase.
- No public exposure of detailed posting or ingestion diagnostics.
- No broad parser expansion before the read-only source ranking workbench is reviewed.
- No data-changing ATS recovery, apply, rebuild, or reindex job without explicit approval.

## Product Shape

### Public Search Cockpit

The first 2.0 surface is a dense job search workspace, not a marketing landing page. Users should land directly in a search and results experience with:

- A strong search command area.
- Global filters that remain scannable on desktop and collapse cleanly on mobile.
- Job cards optimized for repeated comparison.
- Clear saved, applied, ignored, and company block states.
- Fast visual feedback when cards are expanded or acted on.

### Animated Job Cards

Cards should use short, restrained motion to communicate state changes:

- Entry: fade and translate up over 180 to 220 ms.
- Hover or press: slight translate and border emphasis.
- Save/apply/ignore: button state changes and compact status badge update.
- Expand: source-safe details slide open with opacity and height/scale cues.

Motion must use React Native primitives in app code, mostly `Animated` with `transform` and `opacity`. Static demos may use CSS transitions to preview the interaction language. A reduced-motion path must keep all actions usable without animated movement.

### ATS Intelligence Layer

ATS intelligence is internal support data, not public diagnostics. The backend should provide a read-only summary model with:

- ATS/source key.
- Last success and last failure age.
- Accepted row count.
- Rejected row count.
- Parser confidence.
- Quality risk flags.
- Estimated clean net-new value.
- Recommendation: promote, monitor, repair, or hold.

The public app may display coarse user-safe labels such as "Verified source" or "Fresh source" only when derived from non-sensitive summary fields. Detailed parser flags, failure reasons, host details, and internal diagnostics stay behind admin controls.

### Admin/Operator View

The internal view should support ATS planning and operations:

- Ranked source table from the existing workbench direction.
- Source cards with trend, parser health, freshness, and risk.
- Links to safe local reports or admin-only endpoints.
- Clear distinction between read-only inspection, canary, and apply operations.

## Visual Direction

Use a sober operational palette with high contrast and clear status colors:

- Background: near-white neutral.
- Ink: dark blue-gray.
- Primary: teal-green for positive actions.
- Secondary: steel/blue-gray for navigation and metadata.
- Warning: amber.
- Danger: red.

Avoid a one-color theme and avoid decorative blobs, oversized marketing sections, or nested cards. Cards are used only for repeated job/source items and modals.

Typography should favor compact, readable UI text. Headings inside panels stay modest, and long job titles must wrap without overlapping action controls.

## Accessibility and UX Requirements

- Minimum 44 by 44 px touch targets.
- Keyboard reachable controls.
- Text must fit on mobile and desktop without overlap.
- Status changes use visible text, not color alone.
- Reduced motion support.
- Buttons use direct labels such as Save, Applied, Ignore, Block, Filters, and Open.
- Public cards must not require hover to reveal primary actions.

## Backend Requirements

2.0 backend work should build on the existing hardened state:

- Preserve admin gating for `/postings/diagnostics` and per-posting diagnostics.
- Keep `/sync/status` and `/ingestion/status` coarse for public use.
- Reuse the shared safe ATS fetch wrapper for any future source probing.
- Prefer read-only workbench/report APIs before any parser write path.
- Keep canary/apply operations explicit and gated.

## Sentry Readiness

Live Sentry inspection is blocked until the local environment has:

- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

The 2.0 implementation should still prepare frontend/backend error boundaries and structured logging points so production error tracking can be enabled when those values are present.

## Cloudflare Readiness

Cloudflare changes are not applied in the demo phase. The 2.0 readiness checklist should verify:

- WAF protects admin diagnostics and mutation endpoints.
- Rate limits cover sync, ingestion, search suggestions, and apply/canary endpoints.
- Cache rules do not cache personalized/admin responses.
- Security headers are set for the public web app.
- Logs are available for blocked admin, bot, and suspicious ATS fetch traffic.

## Demo Acceptance

Before live app implementation, produce local demos for:

1. Dense Search Cockpit.
2. Mobile Job Card Stack.
3. ATS Intelligence Overlay.

Each demo must be reviewable locally, animate buttons/cards, and avoid production API calls.

## Release Acceptance

2.0.0 is ready for release only when:

- Local demos are reviewed and direction is accepted.
- Frontend tests cover search, filters, card actions, and mobile layout.
- API tests confirm public diagnostics remain admin-gated.
- Backend tests pass for source ranking and safe fetch behavior.
- Sentry readiness is documented, or live Sentry query is completed when credentials are available.
- Cloudflare/WAF checklist is documented before deployment.
- No production visible posting count decrease is introduced by backend changes.
