# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# vendor-r-runtime-win.ps1 - build a portable, self-contained R runtime for
# Windows and drop it into resources/r-runtime-win/ so electron-builder bundles
# it (win.extraResources in electron-builder.json) and r-bridge.ts's
# detectBundledR() picks it up at resources/r-runtime/bin/Rscript.exe before
# ever looking at the system PATH.
#
# Source (since 0.2.23): the official CRAN R for Windows + package binaries from
# a dated Posit Package Manager snapshot - both pinned in shared/r-packages.json
# ("runtime"). Until 0.2.22 this came from conda-forge; that stopped working:
#   - conda-forge's R 4.5 win-64 Fortran DLLs crash on load ("32 bit pseudo
#     relocation out of range": KernSmooth/ucminf 20/20, Cox/ordinal at random);
#   - R 4.6 has no r-arrow/r-ordinal/r-haven builds on ANY conda platform months
#     after R 4.6.0 - every R upgrade would wait on conda-forge's migration.
# CRAN R is relocatable as a plain folder (R_HOME comes from R.dll's location;
# no registry needed - verified below by moving it to a path with spaces), and
# its recommended package set ships in the installer. The dated snapshot is what
# prevents "version hell": the same URL returns the same package versions and
# Windows binaries on every run, so a rebuild reproduces the tested runtime.
# Measured before the switch (roadmap.md 2026-10-10): R 4.3.3 conda vs R 4.6.1
# CRAN on the full validation suite - 2889/2889, SPSS parity 678 OK / 0 FARK.
#
# What is vendored: R itself (incl. its recommended set) + every non-recommended
# package in shared/r-packages.json "bundled" and "console" — every package any
# analysis uses, so the installed app never downloads one (there are no optional
# packages since 0.2.28).
#
# Usage:   pnpm vendor:r-runtime:win
#          Official builds then sign the runtime's DLLs with SAI Bilişim's
#          certificate (release process, not in this repository).
# Env:     SAI_R_DEST - build somewhere else (e.g. to compare with the shipped one)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir    = Split-Path -Parent $ScriptDir
$Dest      = if ($env:SAI_R_DEST) { $env:SAI_R_DEST } else { Join-Path $AppDir 'resources\r-runtime-win' }

$Manifest  = Get-Content (Join-Path $AppDir 'shared\r-packages.json') -Raw | ConvertFrom-Json
$RVersion  = $Manifest.runtime.windowsR
$Sha256    = $Manifest.runtime.windowsInstallerSha256.ToLower()
$Snapshot  = $Manifest.runtime.cranSnapshot
# "console" packages (ggplot2, readxl …) are vendored too, for the R terminal.
$Console   = @($Manifest.console.packages | ForEach-Object { $_.r })
$Extra     = @($Manifest.bundled | Where-Object { -not $_.recommended } | ForEach-Object { $_.r }) + $Console
$RequiredR = @($Manifest.bundled | ForEach-Object { $_.r }) + $Console
Write-Host "[vendor-r-runtime] R $RVersion (CRAN) + $($Extra.Count) packages from $Snapshot"

# ── 1. Installer: cached, checksum-pinned ─────────────────────────────────────
$Cache = Join-Path $AppDir 'tmp\r-installers'
New-Item -ItemType Directory -Force -Path $Cache | Out-Null
$Installer = Join-Path $Cache "R-$RVersion-win.exe"
if (-not (Test-Path $Installer)) {
  # The current release lives under base/, earlier ones under base/old/<ver>/.
  $urls = @(
    "https://cloud.r-project.org/bin/windows/base/old/$RVersion/R-$RVersion-win.exe",
    "https://cloud.r-project.org/bin/windows/base/R-$RVersion-win.exe"
  )
  foreach ($u in $urls) {
    try {
      Write-Host "[vendor-r-runtime] downloading $u"
      Invoke-WebRequest $u -OutFile $Installer -UseBasicParsing
      break
    } catch { Remove-Item $Installer -ErrorAction SilentlyContinue }
  }
  if (-not (Test-Path $Installer)) { Write-Error "R $RVersion installer could not be downloaded"; exit 1 }
}
$actual = (Get-FileHash $Installer -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $Sha256) {
  Remove-Item $Installer -Force
  Write-Error "R installer checksum mismatch (expected $Sha256, got $actual) - refusing to build"
  exit 1
}

# ── 2. Silent per-user install into a short temp path ─────────────────────────
# Short path: Windows MAX_PATH (260) is tight for deep package trees.
$Tag     = [guid]::NewGuid().ToString('N').Substring(0, 8)
$Install = "C:\r-inst-$Tag"
$Stage   = "C:\r-env-$Tag"
Write-Host "[vendor-r-runtime] installing R into $Install ..."
# !recordversion: no HKCU\Software\R-core entry (nothing system-wide points at
# this copy); !associate: no .RData file association. Quoted /DIR - the
# argument string is passed verbatim to the installer.
$p = Start-Process $Installer -Wait -PassThru -ArgumentList (
  "/VERYSILENT /SUPPRESSMSGBOXES /CURRENTUSER /NORESTART /NOICONS " +
  "/MERGETASKS=!recordversion,!associate `"/DIR=$Install`"")
if ($p.ExitCode -ne 0) { Write-Error "R installer failed (exit $($p.ExitCode))"; exit 1 }
# Keep a copy, then uninstall the original so the per-user "Apps" entry the
# installer registered disappears again - the build machine stays clean.
Copy-Item $Install $Stage -Recurse
Start-Process (Join-Path $Install 'unins000.exe') -Wait -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART'
Remove-Item -Recurse -Force $Install -ErrorAction SilentlyContinue
Get-ChildItem $Stage -Filter 'unins000.*' | Remove-Item -Force

$Rscript = Join-Path $Stage 'bin\x64\Rscript.exe'
if (-not (Test-Path $Rscript)) { Write-Error "Rscript.exe not found in $Stage"; exit 1 }

# A clean environment for every R call below: only R's own bin on PATH and no
# personal library, so nothing from this machine's own R setup leaks in.
function Invoke-R([string]$exe, [string]$code) {
  $saved = @{ PATH = $env:PATH; R_LIBS = $env:R_LIBS; R_LIBS_USER = $env:R_LIBS_USER; R_USER = $env:R_USER; HOME = $env:HOME }
  try {
    $env:PATH = "$(Split-Path -Parent $exe);$env:SystemRoot\System32;$env:SystemRoot"
    $env:R_LIBS = ''
    $env:R_LIBS_USER = 'NUL-no-user-library'
    $empty = Join-Path ([IO.Path]::GetTempPath()) "r-home-$Tag"
    New-Item -ItemType Directory -Force -Path $empty | Out-Null
    $env:R_USER = $empty; $env:HOME = $empty
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = & $exe --vanilla -e $code 2>&1
    $ErrorActionPreference = $old
    return @{ code = $LASTEXITCODE; out = "$out" }
  } finally {
    foreach ($k in $saved.Keys) { Set-Item "env:$k" $saved[$k] }
  }
}

# ── 3. Bundled packages from the dated snapshot ───────────────────────────────
Write-Host "[vendor-r-runtime] installing bundled packages: $($Extra -join ', ')"
$pkgVec = ($Extra | ForEach-Object { "'$_'" }) -join ','
# The WHOLE dependency tree is requested and checked, up to three rounds: a
# dependency whose download failed is otherwise skipped silently while its
# parent still installs (stringi under BayesFactor, 2026-10-11 - caught only by
# the relocatability check below).
$r = Invoke-R $Rscript ("options(repos = c(CRAN = '$Snapshot')); " +
  "pk <- c($pkgVec); ap <- available.packages(type = 'binary'); " +
  "deps <- unlist(tools::package_dependencies(pk, db = ap, recursive = TRUE, which = c('Depends','Imports','LinkingTo'))); " +
  "want <- setdiff(unique(c(pk, deps)), rownames(installed.packages(priority = 'base'))); " +
  "for (i in 1:3) { need <- setdiff(want, rownames(installed.packages(.Library))); if (!length(need)) break; " +
  "install.packages(need, lib = .Library, type = 'binary', quiet = TRUE) }; " +
  "miss <- setdiff(want, rownames(installed.packages(.Library))); " +
  "if (length(miss)) { cat('MISSING:', miss); quit(status = 1) }; cat('OK_INSTALL', length(want))")
if ($r.code -ne 0 -or $r.out -notmatch 'OK_INSTALL') { Write-Error "package install failed:`n$($r.out)"; exit 1 }

# ── 4. Prune what a runtime never reads ───────────────────────────────────────
# PDF manuals and package test suites; help pages stay (the R console's ?topic).
foreach ($p in @('doc\manual')) {
  $full = Join-Path $Stage $p
  if (Test-Path $full) { Remove-Item -Recurse -Force $full }
}
Get-ChildItem (Join-Path $Stage 'library') -Directory | ForEach-Object {
  $t = Join-Path $_.FullName 'tests'
  if (Test-Path $t) { Remove-Item -Recurse -Force $t }
}

# A record of exactly what shipped (Help ▸ Report Issue / support questions).
$r = Invoke-R $Rscript ("ip <- installed.packages(.Library); " +
  "cat(jsonlite::toJSON(list(r = as.character(getRversion()), snapshot = '$Snapshot', " +
  "packages = as.list(setNames(ip[, 'Version'], rownames(ip)))), auto_unbox = TRUE, pretty = TRUE))")
if ($r.code -ne 0) { Write-Error "could not list packages:`n$($r.out)"; exit 1 }
Set-Content -Path (Join-Path $Stage 'sai-runtime.json') -Value $r.out -Encoding utf8

# ── 5. Relocatability self-check ──────────────────────────────────────────────
# Move (not copy) to a path with a space, mimicking the per-user install layout
# ("C:\Users\<name>\AppData\Local\Programs\SAI Statistics"), and load every
# bundled package there - a package that quietly failed to make it in would
# otherwise surface only as a degraded analysis in the installed app.
Write-Host "[vendor-r-runtime] verifying the runtime is relocatable..."
$RelocParent = Join-Path ([IO.Path]::GetTempPath()) ("moved dir-" + [guid]::NewGuid().ToString('N'))
$Reloc = Join-Path $RelocParent 'r-runtime'
New-Item -ItemType Directory -Force -Path $RelocParent | Out-Null
Move-Item $Stage $Reloc
$CheckList = ($RequiredR | ForEach-Object { "'$_'" }) -join ','
$r = Invoke-R (Join-Path $Reloc 'bin\x64\Rscript.exe') ("for (p in c($CheckList)) library(p, character.only = TRUE); " +
  "stopifnot(startsWith(normalizePath(R.home(), '/'), normalizePath('$($Reloc -replace '\\','/')', '/'))); cat('OK_CHECK')")
if ($r.code -ne 0 -or $r.out -notmatch 'OK_CHECK') {
  Write-Error "error: bundled Rscript failed relocatability self-check:`n$($r.out)"
  exit 1
}

Write-Host "[vendor-r-runtime] installing to $Dest ..."
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Dest) | Out-Null
Move-Item $Reloc $Dest
Remove-Item -Force $RelocParent -ErrorAction SilentlyContinue

$size = '{0:N0} MB' -f (((Get-ChildItem -Recurse $Dest | Measure-Object Length -Sum).Sum) / 1MB)
Write-Host "[vendor-r-runtime] done. $Dest ($size)"
Write-Host "[vendor-r-runtime] note: CRAN's DLLs are not Authenticode-signed; official builds sign them before packaging"
