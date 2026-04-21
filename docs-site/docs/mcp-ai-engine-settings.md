---
sidebar_position: 6
title: MCP / AI Engine Settings
description: Configure the MCP application agent, safety controls, credentials, and targeting preferences.
---

## Where to configure

Open:

- `Settings > MCP Settings`

This page controls the OpenJobSlots MCP application agent (AI service engine behavior).

## Installer dependency

For MSI installs, MCP runtime is included when you choose:

- `Complete`, or
- `Custom` with `MCP Apply Agent Server (AI Service Engine)` enabled

## Core safety toggles

- `Enable MCP application agent`: master switch for MCP candidate/apply endpoints.
- `Dry run only (do not submit)`: records payload preview without committing applications.
- `Require final user approval`: blocks commit unless explicit approval is provided.

## Agent identity and login fields

- `Preferred agent label`
- `Agent login email`
- `Agent login password`
- `MFA/login notes`

Use a dedicated mailbox account for automation workflows.

## Throughput and targeting fields

- `Max applications per run`
- `Preferred search text`
- `Preferred remote filter`
- `Preferred Industries`
- `Preferred Regions`
- `Preferred Countries`
- `Preferred States`
- `Preferred Counties`
- `Agent instructions`

## Save behavior

When MCP settings are saved:

- Settings are persisted through `/settings/mcp`.
- OpenJobSlots runs a preview candidate query.
- UI confirms with match count: `MCP settings saved. <count> candidate postings currently match.`

## API endpoints tied to this page

- `GET /settings/mcp`
- `PUT /settings/mcp`
- `GET /mcp/candidates`
- `POST /mcp/cover-letter-draft`
- `POST /mcp/applications/complete`

## Security note

MCP settings, including credentials, are stored in local SQLite fields by default. Use OS-level hardening if you need stronger controls.

## Recommended screenshots to add

Add these files under `README-Images/docs/` when available:

- `README-Images/docs/mcp-settings-toggles.png`
- `README-Images/docs/mcp-login-fields.png`
- `README-Images/docs/mcp-targeting-filters.png`
- `README-Images/docs/mcp-save-preview-count.png`
