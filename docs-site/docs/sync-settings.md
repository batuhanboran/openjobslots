---
sidebar_position: 5
title: Sync Settings
description: Configure automatic sync, network constraints, queue concurrency, and blocked companies.
---

## Where to configure

Open:

- `Settings > Sync Settings`

## Manual sync

From `Postings`, use `Sync Postings` for an immediate sync run.

Status text shows:

- Last sync time
- Company count
- Stored postings count
- Failed companies
- Excluded-by-24h count
- Live progress while syncing

## Automatic sync controls

### Enable automatic sync

- Toggle: `Enable automatic sync`
- Runs on a timer while the app is open

### Wi-Fi only (Android)

- Toggle: `Only sync on Wi-Fi (Android only)`
- Ignored on Web and Windows

### Sync interval

- Field: `Sync interval (seconds)`
- Default: `3600` (1 hour)
- Minimum: `60`
- Maximum clamp: `86400` (24 hours)

## ATS request queue concurrency

This controls backend ATS request parallelism.

- Field: `ATS request queue concurrency`
- Allowed range: `1` to `20`
- Higher values can increase throughput but can also increase `429` responses
- Runtime changes apply after backend service restart

## Blocked companies management

Sync Settings includes blocked company management:

- Shows currently blocked company list
- `Unblock` removes company from block list
- Blocked companies are hidden from Postings and excluded from sync collection

## Save behavior

When you click `Save Sync Settings`:

- Auto-sync timing settings are saved locally in app state.
- Queue concurrency is persisted to backend settings endpoint.
- UI confirms the saved mode and restart requirement for runtime concurrency updates.

## Recommended settings profile

- Start at `3600` seconds interval.
- Keep queue concurrency at `1-3` unless your network and ATS targets are stable.
- Block repeat-noise companies to reduce daily review load.

## Recommended screenshots to add

Add these files under `README-Images/docs/` when available:

- `README-Images/docs/sync-settings-page.png`
- `README-Images/docs/sync-interval-and-wifi.png`
- `README-Images/docs/sync-concurrency-help.png`
- `README-Images/docs/sync-blocked-companies-list.png`
