---
sidebar_position: 2
title: Install (MSI and Source)
description: Install OpenJobSlots using the Windows MSI installer or from source.
---

## Option 1: Windows MSI installer (recommended)

### 1. Download installer

Get the latest `.msi` from the GitHub Releases page:

- `https://github.com/batuhanboran/OpenJobSlots/releases`

### 2. Run the installer

Launch the MSI and follow the setup wizard.

During setup, choose one of these install types:

- `Typical`: Desktop app + backend service worker (recommended for most users).
- `Complete`: Desktop app + backend service worker + MCP Apply Agent Server (AI Service Engine).
- `Custom`: Pick exactly which features to install.

![Windows setup type selection](/windows_setup_type.png)

### 3. Finish and launch

After install, launch `OpenJobSlots` from Start Menu or desktop shortcut.

### 4. What gets installed

Default install location:

- `C:\Program Files\OpenJobSlots`

Feature payloads:

- Desktop app executable: `openjobslots.exe`
- Backend service worker files: `backend\...`
- Optional MCP AI engine files: `mcp\...` (if Complete/Custom includes MCP)

### 5. Startup behavior

If backend service worker is installed, the installer writes a startup entry that launches the backend tray process on sign-in.

## Option 2: Run from source

### Requirements

- Node.js `18+` and npm
- Windows target support: React Native Windows prerequisites
- Optional Android support: Android Studio/emulator/device

### Install dependencies

From the repository root (`OpenJobSlots`):

```powershell
npm install
```

### Run backend API

```powershell
npm run server
```

### Run web app

In a second terminal:

```powershell
npm run web
```

Open:

- `http://localhost:8081`

![MSI download page](/webui2.png)

API defaults:

- Web/Windows: `http://localhost:8787`
- Android emulator: `http://10.0.2.2:8787`

### Run Windows or Android client

```powershell
npm run windows
npm run android
```

### Run MCP apply-agent server (optional)

```powershell
npm run mcp:apply-agent
```

## Verify the install

After launch, confirm backend health:

- `http://localhost:8787/health`

You should receive a JSON response with `ok: true`.


