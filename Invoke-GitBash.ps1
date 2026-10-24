# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
<#
.SYNOPSIS
  Bir .sh script'ini Git Bash ile çalıştırır (Windows).

.DESCRIPTION
  start.ps1 ve build-installer.ps1 yalnızca bunu çağırır. Amaç, .sh
  dosyalarındaki mantığı PowerShell'e KOPYALAMADAN onları PowerShell'den
  başlatılabilir kılmak — tek doğruluk kaynağı .sh dosyasının kendisidir.
  Buraya iş mantığı eklenmez; eklenecek şey varsa ilgili .sh'a eklenir.
#>
param(
  [Parameter(Mandatory = $true)][string] $ScriptPath,
  [string[]] $ScriptArgs = @()
)

$ErrorActionPreference = 'Stop'

function Resolve-GitBash {
  # DİKKAT: burada `Get-Command bash` KULLANILMAZ. Windows'ta o ad
  # %LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe'ye, yani WSL başlatıcısına
  # çözülür: WSL kurulu değilse anlamsız bir hata verir, kuruluysa da
  # script'i yanlış (Linux) ortamda çalıştırır. Git'in kendi bash'ini
  # doğrudan adresliyoruz.
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
  throw "Git Bash bulunamadı. Git for Windows kurun (https://git-scm.com/download/win) veya script'i doğrudan Git Bash içinden çalıştırın."
}

if (-not (Test-Path -LiteralPath $ScriptPath)) {
  throw "Script bulunamadı: $ScriptPath"
}

# Git Bash'e POSIX ayraçlı yol ver — ters bölü bash'te kaçış karakteridir.
$posixPath = (Resolve-Path -LiteralPath $ScriptPath).Path -replace '\\', '/'

& $bash $posixPath @ScriptArgs
exit $LASTEXITCODE
