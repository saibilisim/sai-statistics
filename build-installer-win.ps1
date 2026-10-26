# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# build-installer-win.ps1 — builds the Windows installer with one command.
#
# Even with no Node.js, pnpm or R/Conda on the system, this script downloads
# every tool it needs into the project-local .tools/ folder and builds the
# all-in-one Windows installer (.exe) with Node.js and R embedded.

$ErrorActionPreference = 'Stop'

$RootDir = $PSScriptRoot
$ToolsDir = Join-Path $RootDir ".tools"
$BinDir = Join-Path $ToolsDir "bin"
$AppDir = Join-Path $RootDir "app"

# Create the folders
New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

Write-Host "==> 1/5 Checking prerequisites..."

# 1. Node.js (Node 24)
$NodeDir = Join-Path $ToolsDir "node"
$NodeExe = Join-Path $NodeDir "node.exe"

if (-not (Test-Path $NodeExe)) {
    Write-Host "    Node.js not found. Downloading a project-local Node.js v24.16.0..."
    $NodeZip = Join-Path $ToolsDir "node.zip"
    $NodeUrl = "https://nodejs.org/dist/v24.16.0/node-v24.16.0-win-x64.zip"

    Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZip

    # nodejs.org/dist/v24.16.0/SHASUMS256.txt — update together with the version.
    $NodeSha256 = "edaca9bd58ec8e92037dac4e877d52f6b8f430b81c18b57e264b4e2fb111cd56"
    $actual = (Get-FileHash -Algorithm SHA256 $NodeZip).Hash.ToLower()
    if ($actual -ne $NodeSha256) {
        Remove-Item $NodeZip -Force
        Write-Error "Node.js archive SHA-256 mismatch (expected $NodeSha256, got $actual)."
        exit 1
    }

    Write-Host "    Extracting..."
    $ExtractDir = Join-Path $ToolsDir "node-extract"
    Expand-Archive -Path $NodeZip -DestinationPath $ExtractDir -Force

    # Find the subfolder and move it into place
    $SubDir = Get-ChildItem -Path $ExtractDir -Directory | Select-Object -First 1
    Move-Item -Path $SubDir.FullName -Destination $NodeDir

    # Clean up
    Remove-Item -Path $NodeZip -Force
    Remove-Item -Path $ExtractDir -Recurse -Force
}

# Put Node.js on PATH
$env:PATH = "$NodeDir;$env:PATH"
Write-Host "    node.exe ready: $(node -v)"

# 2. pnpm
$PnpmDir = Join-Path $ToolsDir "pnpm"
$PnpmCmd = Join-Path $PnpmDir "pnpm.cmd"

if (-not (Test-Path $PnpmCmd)) {
    Write-Host "    Installing pnpm (project-local)..."
    # Install pnpm under .tools/pnpm with npm
    $NpmCmd = Join-Path $NodeDir "npm.cmd"
    & $NpmCmd install -g pnpm@12.15.0 --prefix $PnpmDir
}

# Put pnpm on PATH
$env:PATH = "$PnpmDir;$env:PATH"
Write-Host "    pnpm ready: $(pnpm -v)"

# (No micromamba: the Windows R runtime comes from CRAN, see vendor-r-runtime-win.ps1.)

# ─── Install project dependencies ───
Write-Host "==> 2/5 Running pnpm install..."
Set-Location -Path $AppDir
& $PnpmCmd install

# ─── Prepare the R runtime ───
$DestR = Join-Path $AppDir "resources\r-runtime-win"
$RscriptExe1 = Join-Path $DestR "bin\Rscript.exe"
$RscriptExe2 = Join-Path $DestR "lib\R\bin\x64\Rscript.exe"

$RRuntimeExists = (Test-Path $RscriptExe1) -or (Test-Path $RscriptExe2)

if ($RRuntimeExists) {
    Write-Host "==> 3/5 R runtime already present under resources/r-runtime-win. Skipping the rebuild."
} else {
    Write-Host "==> 3/5 Embedding the R runtime (and its packages)..."
    & powershell -ExecutionPolicy Bypass -File (Join-Path $AppDir "scripts\vendor-r-runtime-win.ps1")
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Building the R runtime failed. Cannot continue."
        exit 1
    }
}

# ─── Electron build ───
Write-Host "==> 4/5 electron-vite build (production build)..."
& $PnpmCmd run build

# ─── Create the installer ───
Write-Host "==> 5/5 Creating the installer (.exe) with electron-builder..."
& $PnpmCmd exec electron-builder --win nsis --x64 --publish never

Write-Host "==> SUCCESS! The installer was built."
Write-Host "    Output folder: $(Join-Path $AppDir 'dist')"
Get-ChildItem -Path (Join-Path $AppDir 'dist') -Filter "*.exe" | Select-Object Name, Length
