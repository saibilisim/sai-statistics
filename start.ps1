# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# start.ps1 — thin wrapper that launches start.sh from PowerShell.
#
# There is NO logic here: resolving the environment, picking Node/pnpm and
# starting the dev server all live in start.sh. On Windows start.sh already
# hands itself over to PowerShell; this file only removes the friction of
# having to open Git Bash while you are in PowerShell.
#
# Usage:
#   .\start.ps1            starts the app in dev mode
#   .\start.ps1 --check    prints the resolved environment and exits

& (Join-Path $PSScriptRoot 'Invoke-GitBash.ps1') `
  -ScriptPath (Join-Path $PSScriptRoot 'start.sh') `
  -ScriptArgs $args
exit $LASTEXITCODE
