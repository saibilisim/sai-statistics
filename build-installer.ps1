# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# build-installer.ps1 — thin wrapper that launches build-installer.sh from
# PowerShell.
#
# There is NO logic here: installing prerequisites, vendoring the R runtime,
# the build and the electron-builder call all live in build-installer.sh
# (which already supports a Windows host — MINGW/MSYS detection, win-x64
# Node; the R runtime comes from CRAN).
#
# Note: the menu's Linux targets (deb/rpm/AppImage/Flatpak) only build on
# Linux; on Windows the meaningful choice is 5 (Windows .exe). If all you
# want is the package, `pnpm dist:win` works without the menu — the menu is
# preferred because it guarantees the R runtime is embedded too.
#
# Usage:
#   .\build-installer.ps1

& (Join-Path $PSScriptRoot 'Invoke-GitBash.ps1') `
  -ScriptPath (Join-Path $PSScriptRoot 'build-installer.sh') `
  -ScriptArgs $args
exit $LASTEXITCODE
