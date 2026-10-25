# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
<#
.SYNOPSIS
  Runs a .sh script with Git Bash (Windows).

.DESCRIPTION
  start.ps1 and build-installer.ps1 do nothing but call this. The point is to
  make the .sh files launchable from PowerShell WITHOUT copying their logic
  into PowerShell — the .sh file itself stays the single source of truth.
  No business logic goes here; anything new belongs in the relevant .sh.
#>
param(
  [Parameter(Mandatory = $true)][string] $ScriptPath,
  [string[]] $ScriptArgs = @()
)

$ErrorActionPreference = 'Stop'

function Resolve-GitBash {
  # CAUTION: `Get-Command bash` is deliberately NOT used here. On Windows that
  # name resolves to %LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe, the WSL
  # launcher: without WSL it fails with a meaningless error, and with WSL it
  # runs the script in the wrong (Linux) environment. Git's own bash is
  # addressed directly.
  $candidates = New-Object System.Collections.Generic.List[string]

  $git = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($git) {
    # ...\Git\cmd\git.exe  →  ...\Git\bin\bash.exe
    $gitRoot = Split-Path -Parent (Split-Path -Parent $git.Source)
    $candidates.Add((Join-Path $gitRoot 'bin\bash.exe'))
  }
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, "$env:LOCALAPPDATA\Programs")) {
    if ($base) { $candidates.Add((Join-Path $base 'Git\bin\bash.exe')) }
  }

  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }
  return $null
}

$bash = Resolve-GitBash
if (-not $bash) {
  throw "Git Bash not found. Install Git for Windows (https://git-scm.com/download/win) or run the script from Git Bash directly."
}

if (-not (Test-Path -LiteralPath $ScriptPath)) {
  throw "Script not found: $ScriptPath"
}

# Hand Git Bash a path with POSIX separators — a backslash is an escape
# character in bash.
$posixPath = (Resolve-Path -LiteralPath $ScriptPath).Path -replace '\\', '/'

& $bash $posixPath @ScriptArgs
exit $LASTEXITCODE
