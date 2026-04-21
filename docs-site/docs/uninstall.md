---
sidebar_position: 9
title: Uninstall OpenJobSlots
description: Remove OpenJobSlots from Windows and optionally clean local runtime data.
---

## Uninstall MSI-installed app (Windows)

Use either:

- `Settings > Apps > Installed apps > OpenJobSlots > Uninstall`, or
- `Control Panel > Programs and Features > OpenJobSlots > Uninstall`

Follow the MSI uninstall wizard.

## What uninstall removes

MSI uninstall removes installed program files, including:

- desktop app binary
- backend service worker payload
- optional MCP service payload
- Start Menu entry and desktop shortcut

## What may remain (optional cleanup)

Runtime data is stored per user in local app data. This can remain after uninstall.

Path:

- `%LOCALAPPDATA%\\OpenJobSlots\\backend`

Contains DB, PID files, and logs.

If you want a full cleanup, remove this folder manually after uninstall.

## Remove source-based setup

If you ran OpenJobSlots from source, stop running processes and remove project files:

1. Close OpenJobSlots and terminal processes (`npm run server`, `npm run web`, etc.).
2. Delete the local clone directory when you no longer need it.

## Post-uninstall verification

1. Confirm `OpenJobSlots` no longer appears in Installed Apps.
2. Confirm Start Menu shortcut is removed.
3. Confirm `%LOCALAPPDATA%\\OpenJobSlots\\backend` is removed if you performed full cleanup.

## Recommended screenshots to add

Add these files under `README-Images/docs/` when available:

- `README-Images/docs/uninstall-installed-apps.png`
- `README-Images/docs/uninstall-confirmation.png`
- `README-Images/docs/uninstall-localappdata-cleanup.png`
