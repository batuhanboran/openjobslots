[CmdletBinding()]
param(
    [ValidateSet("x64", "x86", "ARM64")]
    [string]$Arch = "x64",
    [switch]$SkipWindowsBuild,
    [string]$BackendDatabaseSource = "jobs.db"
)

$ErrorActionPreference = "Stop"

function Assert-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

function Assert-FileExists {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Description not found at '$Path'."
    }
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $false)]
        [string]$WorkingDirectory = (Get-Location).Path,
        [Parameter(Mandatory = $true)]
        [string]$FailureMessage
    )

    Push-Location $WorkingDirectory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw $FailureMessage
        }
    }
    finally {
        Pop-Location
    }
}

function Get-DependencyVersionFromRepo {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DependencyName,
        [Parameter(Mandatory = $true)]
        [object]$PackageData,
        [Parameter(Mandatory = $true)]
        [string]$ProjectRoot
    )

    $fromPackageJson = [string]$PackageData.dependencies.$DependencyName
    if (-not [string]::IsNullOrWhiteSpace($fromPackageJson)) {
        return $fromPackageJson
    }

    $dependencyPackageJsonPath = Join-Path $ProjectRoot "node_modules\$DependencyName\package.json"
    if (-not (Test-Path -LiteralPath $dependencyPackageJsonPath -PathType Leaf)) {
        throw "Missing dependency '$DependencyName' in package.json and node_modules. Unable to package runtime."
    }

    $dependencyPackageData = Get-Content -Raw $dependencyPackageJsonPath | ConvertFrom-Json
    $resolvedVersion = [string]$dependencyPackageData.version
    if ([string]::IsNullOrWhiteSpace($resolvedVersion)) {
        throw "Unable to resolve version for dependency '$DependencyName'."
    }

    return $resolvedVersion
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path

Set-Location $projectRoot

Assert-Command -Name "npx"
Assert-Command -Name "dotnet"
Assert-Command -Name "npm"
Assert-Command -Name "node"

$packageJsonPath = Join-Path $projectRoot "package.json"
$packageData = Get-Content -Raw $packageJsonPath | ConvertFrom-Json
$version = [string]$packageData.version

if ([string]::IsNullOrWhiteSpace($version)) {
    throw "Unable to read 'version' from package.json."
}

if (-not $SkipWindowsBuild.IsPresent) {
    Write-Host "Building React Native Windows app (Release, $Arch)..." -ForegroundColor Cyan
    $runWindowsArgs = @(
        "@react-native-community/cli",
        "run-windows",
        "--arch",
        $Arch,
        "--no-packager",
        "--no-launch",
        "--no-deploy",
        "--msbuildprops",
        "WindowsAppSDKSelfContained=true,BundlerExtraArgs=--config metro.windows.config.js --minify false",
        "--release"
    )

    & npx @runWindowsArgs

    if ($LASTEXITCODE -ne 0) {
        throw "React Native Windows Release build failed. MSI was not created."
    }
}

$buildOutputDir = Join-Path $projectRoot "windows\$Arch\Release"
$releaseExe = Join-Path $buildOutputDir "openjobslots.exe"
if (-not (Test-Path $releaseExe)) {
    throw "Release build output not found at '$releaseExe'. MSI was not created."
}

$stagingDir = Join-Path $projectRoot "windows\installer\staging\$Arch\Release"
if (Test-Path $stagingDir) {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force
}

New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
Copy-Item -Path (Join-Path $buildOutputDir "*") -Destination $stagingDir -Recurse -Force

Write-Host "Preparing backend service payload..." -ForegroundColor Cyan
$backendStagingDir = Join-Path $projectRoot "windows\installer\staging-backend\$Arch\Release"
if (Test-Path $backendStagingDir) {
    Remove-Item -LiteralPath $backendStagingDir -Recurse -Force
}
New-Item -ItemType Directory -Path $backendStagingDir -Force | Out-Null

$nodeExePath = (Get-Command node -ErrorAction Stop).Source
Assert-FileExists -Path $nodeExePath -Description "Node runtime executable"
$backendNodeDir = Join-Path $backendStagingDir "node"
New-Item -ItemType Directory -Path $backendNodeDir -Force | Out-Null
Copy-Item -LiteralPath $nodeExePath -Destination (Join-Path $backendNodeDir "node.exe") -Force

$serverEntryPath = Join-Path $projectRoot "server\index.js"
Assert-FileExists -Path $serverEntryPath -Description "Backend server entrypoint"
$backendServerDir = Join-Path $backendStagingDir "server"
New-Item -ItemType Directory -Path $backendServerDir -Force | Out-Null
Copy-Item -LiteralPath $serverEntryPath -Destination (Join-Path $backendServerDir "index.js") -Force

$databaseSourcePath = Join-Path $projectRoot $BackendDatabaseSource
Assert-FileExists -Path $databaseSourcePath -Description "Backend database source"
Copy-Item -LiteralPath $databaseSourcePath -Destination (Join-Path $backendStagingDir "jobs.db") -Force

$backendScriptSourceDir = Join-Path $projectRoot "scripts\windows\backend"
$backendLauncherSourcePath = Join-Path $backendScriptSourceDir "launcher.js"
$backendTrayScriptSourcePath = Join-Path $backendScriptSourceDir "backend-tray.ps1"
$backendVbsSourcePath = Join-Path $backendScriptSourceDir "launch-backend.vbs"
$backendTrayIconSourcePath = Join-Path $projectRoot "windows\openjobslots\openjobslots.ico"
Assert-FileExists -Path $backendLauncherSourcePath -Description "Backend launcher script"
Assert-FileExists -Path $backendTrayScriptSourcePath -Description "Backend tray script"
Assert-FileExists -Path $backendVbsSourcePath -Description "Backend launcher VBS script"
Assert-FileExists -Path $backendTrayIconSourcePath -Description "Backend tray icon"
Copy-Item -LiteralPath $backendLauncherSourcePath -Destination (Join-Path $backendStagingDir "launcher.js") -Force
Copy-Item -LiteralPath $backendTrayScriptSourcePath -Destination (Join-Path $backendStagingDir "backend-tray.ps1") -Force
Copy-Item -LiteralPath $backendVbsSourcePath -Destination (Join-Path $backendStagingDir "launch-backend.vbs") -Force
Copy-Item -LiteralPath $backendTrayIconSourcePath -Destination (Join-Path $backendStagingDir "tray.ico") -Force

$mcpStagingDir = Join-Path $projectRoot "windows\installer\staging-mcp\$Arch\Release"
if (Test-Path $mcpStagingDir) {
    Remove-Item -LiteralPath $mcpStagingDir -Recurse -Force
}
New-Item -ItemType Directory -Path $mcpStagingDir -Force | Out-Null

$mcpServerEntryPath = Join-Path $projectRoot "server\mcp-apply-server.js"
Assert-FileExists -Path $mcpServerEntryPath -Description "MCP apply agent server entrypoint"
Copy-Item -LiteralPath $mcpServerEntryPath -Destination (Join-Path $mcpStagingDir "mcp-apply-server.js") -Force

$backendRuntimeDir = Join-Path $projectRoot "windows\installer\temp\backend-runtime\$Arch"
if (Test-Path $backendRuntimeDir) {
    Remove-Item -LiteralPath $backendRuntimeDir -Recurse -Force
}
New-Item -ItemType Directory -Path $backendRuntimeDir -Force | Out-Null

try {
    $backendDependencyNames = @("cors", "express", "sqlite", "sqlite3", "@modelcontextprotocol/sdk", "zod")
    $backendDependencies = [ordered]@{}
    foreach ($dependencyName in $backendDependencyNames) {
        $dependencyVersion = Get-DependencyVersionFromRepo `
            -DependencyName $dependencyName `
            -PackageData $packageData `
            -ProjectRoot $projectRoot

        $backendDependencies[$dependencyName] = $dependencyVersion
    }

    $backendPackageJson = [ordered]@{
        name = "openjobslots-backend-runtime"
        version = $version
        private = $true
        license = "UNLICENSED"
        description = "OpenJobSlots backend runtime payload"
        dependencies = $backendDependencies
    }

    $backendPackageJsonPath = Join-Path $backendRuntimeDir "package.json"
    $backendPackageJson | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $backendPackageJsonPath -Encoding UTF8 -NoNewline

    Invoke-CheckedCommand `
        -Command "npm" `
        -Arguments @("install", "--omit=dev", "--no-audit", "--no-fund") `
        -WorkingDirectory $backendRuntimeDir `
        -FailureMessage "npm install failed while preparing backend runtime payload."

    $runtimeNodeModulesPath = Join-Path $backendRuntimeDir "node_modules"
    if (-not (Test-Path -LiteralPath $runtimeNodeModulesPath -PathType Container)) {
        throw "Backend runtime node_modules directory was not created at '$runtimeNodeModulesPath'."
    }

    Copy-Item -LiteralPath $runtimeNodeModulesPath -Destination (Join-Path $backendStagingDir "node_modules") -Recurse -Force
}
finally {
    if (Test-Path $backendRuntimeDir) {
        Remove-Item -LiteralPath $backendRuntimeDir -Recurse -Force
    }
}

$installerProject = Join-Path $projectRoot "windows\installer\OpenJobSlots.WindowsInstaller.wixproj"
if (-not (Test-Path $installerProject)) {
    throw "Installer project not found at '$installerProject'."
}

$distDir = Join-Path $projectRoot "windows\installer\dist"
New-Item -ItemType Directory -Path $distDir -Force | Out-Null

$msiOutputName = "openjobslots-$version-$Arch"

Write-Host "Building MSI installer..." -ForegroundColor Cyan
$dotnetBuildArgs = @(
    "build",
    $installerProject,
    "-c",
    "Release",
    "/p:Platform=$Arch",
    "/p:AppSourceDir=$stagingDir",
    "/p:BackendSourceDir=$backendStagingDir",
    "/p:McpSourceDir=$mcpStagingDir",
    "/p:ProductVersion=$version",
    "/p:MsiOutputName=$msiOutputName",
    "/p:OutputPath=$distDir\"
)

& dotnet @dotnetBuildArgs

if ($LASTEXITCODE -ne 0) {
    throw "MSI build failed."
}

$msiPath = Join-Path $distDir "$msiOutputName.msi"
if (-not (Test-Path $msiPath)) {
    throw "MSI build completed but expected output was not found at '$msiPath'."
}

Write-Host ""
Write-Host "MSI ready: $msiPath" -ForegroundColor Green
