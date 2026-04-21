$ErrorActionPreference = "Continue"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectInstallDir = Split-Path -Parent $scriptDir
$nodePath = Join-Path $scriptDir "node\node.exe"
$backendLauncherScriptPath = Join-Path $scriptDir "launcher.js"
$trayIconPath = Join-Path $scriptDir "tray.ico"
$openJobSlotsExePath = Join-Path $projectInstallDir "openjobslots.exe"
$backendSeedDatabasePath = Join-Path $scriptDir "jobs.db"
$backendDataRoot = Join-Path $env:LOCALAPPDATA "OpenJobSlots\backend"
$backendPidPath = Join-Path $backendDataRoot "backend.pid"
$backendPort = 8787

$mcpScriptPath = Join-Path $projectInstallDir "mcp\mcp-apply-server.js"
$mcpPidPath = Join-Path $backendDataRoot "ai-engine.pid"
$mcpLogDirectory = Join-Path $backendDataRoot "logs"
$mcpStdOutPath = Join-Path $mcpLogDirectory "ai-engine.out.log"
$mcpStdErrPath = Join-Path $mcpLogDirectory "ai-engine.err.log"
$mcpInstallDirectoryPath = Join-Path $projectInstallDir "mcp"
$trayLogPath = Join-Path $mcpLogDirectory "tray.log"

$mutexName = "Local\OpenJobSlotsBackendTray"
$script:backendManuallyStopped = $false
$script:mcpManuallyStopped = $false
$script:isExitingTray = $false
$script:serverScriptPathLower = (Join-Path $scriptDir "server\index.js").ToLowerInvariant()
$script:installDirLower = $projectInstallDir.ToLowerInvariant()
$script:mcpScriptPathLower = $mcpScriptPath.ToLowerInvariant()
$script:mcpInstallDirLower = $mcpInstallDirectoryPath.ToLowerInvariant()

function Write-TrayLog {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    try {
        Ensure-BackendDataRoot
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
        Add-Content -LiteralPath $trayLogPath -Value "[$timestamp] $Message" -Encoding UTF8
    }
    catch {
    }
}

function Ensure-BackendDataRoot {
    if (-not (Test-Path -LiteralPath $backendDataRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $backendDataRoot -Force | Out-Null
    }

    if (-not (Test-Path -LiteralPath $mcpLogDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $mcpLogDirectory -Force | Out-Null
    }
}

function Ensure-RuntimeDatabase {
    Ensure-BackendDataRoot

    $runtimeDatabasePath = Join-Path $backendDataRoot "jobs.db"
    if (-not (Test-Path -LiteralPath $runtimeDatabasePath -PathType Leaf) -and (Test-Path -LiteralPath $backendSeedDatabasePath -PathType Leaf)) {
        Copy-Item -LiteralPath $backendSeedDatabasePath -Destination $runtimeDatabasePath -Force
    }

    return $runtimeDatabasePath
}

function Read-PidFromFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PidFilePath
    )

    try {
        if (-not (Test-Path -LiteralPath $PidFilePath -PathType Leaf)) {
            return 0
        }

        $rawPid = (Get-Content -LiteralPath $PidFilePath -Raw).Trim()
        $parsedPid = [int]$rawPid
        if ($parsedPid -gt 0) {
            return $parsedPid
        }
    }
    catch {
    }

    return 0
}

function Test-PidRunning {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId
    )

    if ($ProcessId -le 0) {
        return $false
    }

    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        return $null -ne $process
    }
    catch {
        return $false
    }
}

function Test-BackendHealth {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$backendPort/health" -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Test-McpInstalled {
    return (Test-Path -LiteralPath $nodePath -PathType Leaf) -and (Test-Path -LiteralPath $mcpScriptPath -PathType Leaf)
}

function Set-NotifyIconText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        $notifyIcon.Text = "OpenJobSlots"
        return
    }

    if ($Text.Length -gt 63) {
        $notifyIcon.Text = $Text.Substring(0, 63)
    }
    else {
        $notifyIcon.Text = $Text
    }
}

function Invoke-BackendLauncher {
    if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { return }
    if (-not (Test-Path -LiteralPath $backendLauncherScriptPath -PathType Leaf)) { return }

    & $nodePath $backendLauncherScriptPath | Out-Null
}

function Stop-BackendProcess {
    try {
        $backendPidValue = Read-PidFromFile -PidFilePath $backendPidPath
        if ($backendPidValue -gt 0) {
            Stop-Process -Id $backendPidValue -Force -ErrorAction SilentlyContinue
        }
    }
    catch {
    }
    finally {
        Remove-Item -LiteralPath $backendPidPath -Force -ErrorAction SilentlyContinue
    }

    try {
        Get-NetTCPConnection -LocalPort $backendPort -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            ForEach-Object {
                if ($_ -gt 0) {
                    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
                }
            }
    }
    catch {
    }

    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        ForEach-Object {
            $commandLine = [string]$_.CommandLine
            if ([string]::IsNullOrWhiteSpace($commandLine)) {
                return
            }

            $commandLineLower = $commandLine.ToLowerInvariant()
            if ($commandLineLower.Contains($script:serverScriptPathLower) -or $commandLineLower.Contains($script:installDirLower)) {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
        }
}

function Start-McpProcess {
    if (-not (Test-McpInstalled)) {
        return $false
    }

    $runtimeDatabasePath = Ensure-RuntimeDatabase

    $existingPid = Read-PidFromFile -PidFilePath $mcpPidPath
    if (Test-PidRunning -ProcessId $existingPid) {
        return $true
    }

    $previousNodePath = $env:NODE_PATH
    $previousDbPath = $env:DB_PATH

    try {
        $env:NODE_PATH = Join-Path $scriptDir "node_modules"
        $env:DB_PATH = $runtimeDatabasePath

        $process = Start-Process -FilePath $nodePath `
                                 -ArgumentList @("`"$mcpScriptPath`"") `
                                 -WorkingDirectory (Split-Path -Parent $mcpScriptPath) `
                                 -WindowStyle Hidden `
                                 -RedirectStandardOutput $mcpStdOutPath `
                                 -RedirectStandardError $mcpStdErrPath `
                                 -PassThru

        if ($null -ne $process -and $process.Id -gt 0) {
            Set-Content -LiteralPath $mcpPidPath -Value "$($process.Id)`n" -Encoding ASCII
            Start-Sleep -Milliseconds 400
            return (Test-PidRunning -ProcessId $process.Id)
        }
    }
    catch {
        Write-TrayLog -Message "Start-McpProcess failed: $($_.Exception.Message)"
    }
    finally {
        if ($null -ne $previousNodePath) {
            $env:NODE_PATH = $previousNodePath
        }
        else {
            Remove-Item Env:NODE_PATH -ErrorAction SilentlyContinue
        }

        if ($null -ne $previousDbPath) {
            $env:DB_PATH = $previousDbPath
        }
        else {
            Remove-Item Env:DB_PATH -ErrorAction SilentlyContinue
        }
    }

    return $false
}

function Stop-McpProcess {
    try {
        $mcpPidValue = Read-PidFromFile -PidFilePath $mcpPidPath
        if ($mcpPidValue -gt 0) {
            Stop-Process -Id $mcpPidValue -Force -ErrorAction SilentlyContinue
        }
    }
    catch {
    }
    finally {
        Remove-Item -LiteralPath $mcpPidPath -Force -ErrorAction SilentlyContinue
    }

    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        ForEach-Object {
            $commandLine = [string]$_.CommandLine
            if ([string]::IsNullOrWhiteSpace($commandLine)) {
                return
            }

            $commandLineLower = $commandLine.ToLowerInvariant()
            if ($commandLineLower.Contains($script:mcpScriptPathLower) -or $commandLineLower.Contains($script:mcpInstallDirLower)) {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
        }
}

function Stop-OpenJobSlotsAppProcess {
    Get-Process openjobslots -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    & taskkill /F /IM openjobslots.exe | Out-Null
}

function Ensure-BackendRunning {
    Ensure-RuntimeDatabase | Out-Null

    if ($script:backendManuallyStopped -or $script:isExitingTray) {
        return $false
    }

    if (-not (Test-BackendHealth)) {
        Invoke-BackendLauncher
        Start-Sleep -Milliseconds 800
    }

    return (Test-BackendHealth)
}

function Ensure-McpRunning {
    if (-not (Test-McpInstalled)) {
        return $null
    }

    if ($script:mcpManuallyStopped -or $script:isExitingTray) {
        return $false
    }

    $existingPid = Read-PidFromFile -PidFilePath $mcpPidPath
    if (Test-PidRunning -ProcessId $existingPid) {
        return $true
    }

    return (Start-McpProcess)
}

function Resolve-McpStateText {
    if (-not (Test-McpInstalled)) {
        return "not installed"
    }

    if ($script:mcpManuallyStopped -or $script:isExitingTray) {
        return "stopped"
    }

    $existingPid = Read-PidFromFile -PidFilePath $mcpPidPath
    if (Test-PidRunning -ProcessId $existingPid) {
        return "running"
    }

    $launchResult = Start-McpProcess
    if ($launchResult) {
        return "running"
    }

    return "ready"
}

function Update-StatusDisplay {
    $backendStateText = ""
    if ($script:backendManuallyStopped -or $script:isExitingTray) {
        $backendStateText = "stopped"
    }
    else {
        $backendStateText = if (Ensure-BackendRunning) { "running" } else { "disconnected" }
    }

    $mcpStateText = Resolve-McpStateText

    $statusMenuItem.Text = "Backend: $backendStateText | AI Service Engine: $mcpStateText"
    Set-NotifyIconText -Text "OpenJobSlots B:$backendStateText AI:$mcpStateText"
}

function Update-StatusDisplaySafely {
    try {
        Update-StatusDisplay
    }
    catch {
        Write-TrayLog -Message "Status update failed: $($_.Exception.Message)"
    }
}

[bool]$createdNew = $false
$mutex = $null
try {
    $mutex = New-Object System.Threading.Mutex($false, $mutexName, [ref]$createdNew)
}
catch {
    Write-TrayLog -Message "Mutex create failed: $($_.Exception.Message)"
    exit 0
}

if (-not $createdNew) {
    Write-TrayLog -Message "Tray already running. Exiting duplicate instance."
    if ($mutex) {
        $mutex.Dispose()
    }
    exit 0
}

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path -LiteralPath $trayIconPath -PathType Leaf) {
    $notifyIcon.Icon = New-Object System.Drawing.Icon($trayIconPath)
}
else {
    $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}
$notifyIcon.Visible = $true
Set-NotifyIconText -Text "OpenJobSlots Backend"

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusMenuItem = $menu.Items.Add("Backend: starting | AI Service Engine: starting")
$statusMenuItem.Enabled = $false
[void]$menu.Items.Add("-")
$openMenuItem = $menu.Items.Add("Open OpenJobSlots")
$restartMenuItem = $menu.Items.Add("Restart Backend")
$stopMenuItem = $menu.Items.Add("Stop Backend")
$restartAiMenuItem = $menu.Items.Add("Restart AI Service Engine")
$stopAiMenuItem = $menu.Items.Add("Stop AI Service Engine")
[void]$menu.Items.Add("-")
$exitMenuItem = $menu.Items.Add("Exit Tray")
$notifyIcon.ContextMenuStrip = $menu

if (-not (Test-McpInstalled)) {
    $restartAiMenuItem.Enabled = $false
    $stopAiMenuItem.Enabled = $false
}

$applicationContext = New-Object System.Windows.Forms.ApplicationContext

$openMenuItem.add_Click({
    if (Test-Path -LiteralPath $openJobSlotsExePath -PathType Leaf) {
        Start-Process -FilePath $openJobSlotsExePath | Out-Null
    }
})

$restartMenuItem.add_Click({
    $script:backendManuallyStopped = $false
    Stop-BackendProcess
    Start-Sleep -Milliseconds 350
    Update-StatusDisplaySafely
})

$stopMenuItem.add_Click({
    $script:backendManuallyStopped = $true
    Stop-BackendProcess
    Update-StatusDisplaySafely
})

$restartAiMenuItem.add_Click({
    $script:mcpManuallyStopped = $false
    Stop-McpProcess
    Start-Sleep -Milliseconds 350
    Update-StatusDisplaySafely
})

$stopAiMenuItem.add_Click({
    $script:mcpManuallyStopped = $true
    Stop-McpProcess
    Update-StatusDisplaySafely
})

$exitMenuItem.add_Click({
    $script:isExitingTray = $true
    $script:backendManuallyStopped = $true
    $script:mcpManuallyStopped = $true
    $healthTimer.Stop()
    Stop-McpProcess
    Stop-BackendProcess
    Stop-OpenJobSlotsAppProcess
    $applicationContext.ExitThread()
})

$notifyIcon.add_DoubleClick({
    if (Test-Path -LiteralPath $openJobSlotsExePath -PathType Leaf) {
        Start-Process -FilePath $openJobSlotsExePath | Out-Null
    }
})

$healthTimer = New-Object System.Windows.Forms.Timer
$healthTimer.Interval = 3000
$healthTimer.add_Tick({
    Update-StatusDisplaySafely
})

try {
    Write-TrayLog -Message "Tray process started."
    Update-StatusDisplaySafely
    $healthTimer.Start()
    [System.Windows.Forms.Application]::Run($applicationContext)
}
finally {
    $healthTimer.Stop()
    if ($script:isExitingTray) {
        Stop-McpProcess
        Stop-BackendProcess
        Stop-OpenJobSlotsAppProcess
    }

    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()

    if ($mutex) {
        try {
            $mutex.ReleaseMutex() | Out-Null
        }
        catch {
        }
        $mutex.Dispose()
    }
    Write-TrayLog -Message "Tray process exited."
}
