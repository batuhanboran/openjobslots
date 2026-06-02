# Mobile Store Readiness

This document records the first store-readiness architecture decision for the Expo iOS and Android app.

## Target

- Keep the backend, worker, Postgres, and Meilisearch architecture unchanged.
- Ship the public mobile app as an Expo React Native app for iOS and Android.
- Keep the mobile app search-first and public-safe.

## Public Mobile API Surface

The native store app may call only these public routes:

- `GET /postings`
- `GET /postings/filter-options`
- `GET /search/popular`
- `GET /search/suggest`
- `GET /sync/status`
- `GET /ingestion/status`

Admin settings, application tracking, MCP settings, raw parser state, raw diagnostics, source-quality controls, and ingestion write controls are not part of the public mobile app surface.

The production mobile API base URL is:

- `https://openjobslots.com`

Local development still uses Expo platform defaults through `src/mobile/publicSurface.js`.

## FlyonUI Boundary

FlyonUI is not a native mobile dependency. It depends on Tailwind CSS and DOM JavaScript components, so it belongs only in a separate web/landing/admin surface if the project later creates one.

Do not add `flyonui`, Tailwind, or DOM component imports to the Expo native app without a new architecture decision.

## Store Build Profiles

`eas.json` defines:

- `development`: internal development client.
- `preview`: internal Android APK and equivalent iOS internal build.
- `production`: App Store / Play Store production build profile.

All EAS profiles set:

- `EXPO_PUBLIC_API_BASE_URL=https://openjobslots.com`

## External Release Prerequisites

These are intentionally not stored in the repository:

- Apple Developer account access.
- Google Play Console access.
- iOS certificates and provisioning profiles.
- Android upload key or Play App Signing setup.
- App Store / Play Store listing copy, screenshots, ratings, and privacy questionnaire submissions.

Do not commit signing files, `.env` files, credentials, tokens, private keys, or console secrets.
