# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# build-installer.ps1 — build-installer.sh'ı PowerShell'den başlatmak için
# ince sarmalayıcı.
#
# Burada mantık YOK: ön koşul kurulumu, R runtime vendor adımı, build ve
# electron-builder çağrısı tamamen build-installer.sh'ta (o script Windows
# host'u zaten destekliyor — MINGW/MSYS tespiti, win-x64 Node, win-64
# micromamba).
#
# Not: menüdeki Linux hedefleri (deb/rpm/AppImage/Flatpak) yalnızca Linux'ta
# derlenir; Windows'ta anlamlı seçenek 5 (Windows .exe). Yalnızca paket
# üretmek istiyorsan menüyü hiç açmadan `pnpm dist:win` de yeterli — menü,
# R runtime'ının da gömülmesini garanti ettiği için tercih edilir.
#
# Kullanım:
#   .\build-installer.ps1

& (Join-Path $PSScriptRoot 'Invoke-GitBash.ps1') `
  -ScriptPath (Join-Path $PSScriptRoot 'build-installer.sh') `
  -ScriptArgs $args
exit $LASTEXITCODE
