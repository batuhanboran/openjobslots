---
sidebar_position: 8
title: Windows Tray Notification Settings
description: Understand and control the OpenJobSlots backend tray process on Windows.
---

## Important behavior note

OpenJobSlots does not currently expose tray behavior in the in-app settings UI.

Tray behavior is controlled by:

- installer feature selection, and
- tray context menu actions

## When tray is available

Tray support is installed with the `Backend Service Worker` MSI feature.

## What the tray shows

Tray tooltip/status includes both services:

- Backend state (`running`, `disconnected`, `stopped`)
- AI Service Engine state (`running`, `ready`, `stopped`, `not installed`)

![Tray center](/tray_center_1.png)

## Tray menu actions

Right-click tray icon to access:

- `Open OpenJobSlots`
- `Restart Backend`
- `Stop Backend`
- `Restart AI Service Engine`
- `Stop AI Service Engine`
- `Exit Tray`

Double-clicking tray icon opens the desktop app.

![Tray center settings](/tray_center_2.png)

## Runtime paths (per user)

Under `%LOCALAPPDATA%\\OpenJobSlots\\backend`:

- `jobs.db` (runtime DB copy)
- `backend.pid`
- `ai-engine.pid`
- `logs\\backend.out.log`
- `logs\\backend.err.log`
- `logs\\ai-engine.out.log`
- `logs\\ai-engine.err.log`
- `logs\\tray.log`

## Practical operations

- If app data stops refreshing, try `Restart Backend` from tray.
- If MCP tool calls fail and MCP is installed, try `Restart AI Service Engine`.
- If tray is missing after install, verify Backend Service Worker feature is installed.
