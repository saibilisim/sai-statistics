# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# start.ps1 — start.sh'ı PowerShell'den başlatmak için ince sarmalayıcı.
#
# Burada mantık YOK: ortam çözümleme, Node/pnpm seçimi ve dev sunucusunu
# başlatma tamamen start.sh'ta. start.sh Windows'ta zaten kendini PowerShell'e
# devrediyor; bu dosya sadece "PowerShell'deyken Git Bash açmak zorunda kalma"
# sürtünmesini kaldırır.
#
# Kullanım:
#   .\start.ps1            uygulamayı dev modunda başlatır
#   .\start.ps1 --check    çözümlenen ortamı yazdırır ve çıkar

& (Join-Path $PSScriptRoot 'Invoke-GitBash.ps1') `
  -ScriptPath (Join-Path $PSScriptRoot 'start.sh') `
  -ScriptArgs $args
exit $LASTEXITCODE
