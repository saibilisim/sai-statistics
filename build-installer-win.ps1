# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# build-installer-win.ps1 — Windows üzerinde tek komutla kurulum paketi derleme.
#
# Bu betik, sisteminizde Node.js, pnpm veya R/Conda kurulu olmasa bile
# gerekli tüm araçları proje içi (.tools/) klasörüne otomatik olarak indirir
# ve her şey dahil (Node.js ve R gömülü) Windows kurulum paketini (.exe) derler.

$ErrorActionPreference = 'Stop'

$RootDir = $PSScriptRoot
$ToolsDir = Join-Path $RootDir ".tools"
$BinDir = Join-Path $ToolsDir "bin"
$AppDir = Join-Path $RootDir "app"

# Klasörleri oluştur
New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

Write-Host "==> 1/5 Ön Koşullar Kontrol Ediliyor..."

# 1. Node.js Kontrolü (Node 24)
$NodeDir = Join-Path $ToolsDir "node"
$NodeExe = Join-Path $NodeDir "node.exe"

if (-not (Test-Path $NodeExe)) {
    Write-Host "    Node.js bulunamadı. Projeye özel Node.js v24.16.0 indiriliyor..."
    $NodeZip = Join-Path $ToolsDir "node.zip"
    $NodeUrl = "https://nodejs.org/dist/v24.16.0/node-v24.16.0-win-x64.zip"
    
    Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZip
    
    Write-Host "    Arşivden çıkarılıyor..."
    $ExtractDir = Join-Path $ToolsDir "node-extract"
    Expand-Archive -Path $NodeZip -DestinationPath $ExtractDir -Force
    
    # Alt klasörü bulup taşı
    $SubDir = Get-ChildItem -Path $ExtractDir -Directory | Select-Object -First 1
    Move-Item -Path $SubDir.FullName -Destination $NodeDir
    
    # Temizlik
    Remove-Item -Path $NodeZip -Force
    Remove-Item -Path $ExtractDir -Recurse -Force
}

# Node.js yolunu PATH'e ekle
$env:PATH = "$NodeDir;$env:PATH"
Write-Host "    Node.exe Hazır: $(node -v)"

# 2. pnpm Kontrolü
$PnpmDir = Join-Path $ToolsDir "pnpm"
$PnpmCmd = Join-Path $PnpmDir "pnpm.cmd"

if (-not (Test-Path $PnpmCmd)) {
    Write-Host "    pnpm kuruluyor (projeye özel)..."
    # npm kullanarak pnpm'i .tools/pnpm altına kur
    $NpmCmd = Join-Path $NodeDir "npm.cmd"
    & $NpmCmd install -g pnpm --prefix $PnpmDir
}

# pnpm yolunu PATH'e ekle
$env:PATH = "$PnpmDir;$env:PATH"
Write-Host "    pnpm Hazır: $(pnpm -v)"

# 3. Micromamba Kontrolü (R runtime üretimi için)
$MicromambaExe = Join-Path $BinDir "micromamba.exe"

if (-not (Test-Path $MicromambaExe)) {
    Write-Host "    micromamba indiriliyor (R runtime üretimi için)..."
    $MambaUrl = "https://micro.mamba.pm/api/micromamba/win-64/latest"
    $MambaTar = Join-Path $ToolsDir "micromamba.tar.bz2"
    
    Invoke-WebRequest -Uri $MambaUrl -OutFile $MambaTar
    
    # tar.exe Windows 10/11'de gömülüdür
    if (Get-Command tar -ErrorAction SilentlyContinue) {
        & tar -xf $MambaTar -C $ToolsDir
        if (Test-Path (Join-Path $ToolsDir "Library\bin\micromamba.exe")) {
            Move-Item -Path (Join-Path $ToolsDir "Library\bin\micromamba.exe") -Destination $MicromambaExe -Force
            Remove-Item -Path (Join-Path $ToolsDir "Library") -Recurse -Force
        }
    } else {
        Write-Error "Sisteminizde 'tar' komutu bulunamadı. Lütfen Windows güncellemelerinizi kontrol edin veya tar aracını kurun."
        exit 1
    }
    Remove-Item -Path $MambaTar -Force
}

$env:CONDA_BIN = $MicromambaExe
$env:CONDA_PKGS_DIRS = "C:\m-pkgs"
Write-Host "    micromamba Hazır: $MicromambaExe"

# ─── Proje Bağımlılıklarını Kur ───
Write-Host "==> 2/5 pnpm install çalıştırılıyor..."
Set-Location -Path $AppDir
& $PnpmCmd install

# ─── R Runtime Hazırla ───
$DestR = Join-Path $AppDir "resources\r-runtime-win"
$RscriptExe1 = Join-Path $DestR "bin\Rscript.exe"
$RscriptExe2 = Join-Path $DestR "lib\R\bin\x64\Rscript.exe"

$RRuntimeExists = (Test-Path $RscriptExe1) -or (Test-Path $RscriptExe2)

if ($RRuntimeExists) {
    Write-Host "==> 3/5 R Runtime zaten hazır (resources/r-runtime-win altında mevcut). Yeniden oluşturma atlanıyor."
} else {
    Write-Host "==> 3/5 R Runtime (ve gerekli kütüphaneler) gömülüyor..."
    & powershell -ExecutionPolicy Bypass -File (Join-Path $AppDir "scripts\vendor-r-runtime-win.ps1")
    if ($LASTEXITCODE -ne 0) {
        Write-Error "R runtime derlemesi başarısız oldu! Devam edilemiyor."
        exit 1
    }
}

# ─── Electron Build Yap ───
Write-Host "==> 4/5 electron-vite build (Üretim sürümü derlemesi)..."
& $PnpmCmd run build

# ─── Installer Oluştur ───
Write-Host "==> 5/5 electron-builder ile Kurulum Paketi (.exe) Oluşturuluyor..."
& $PnpmCmd exec electron-builder --win nsis --x64 --publish never

Write-Host "==> BAŞARILI! Kurulum paketi başarıyla oluşturuldu."
Write-Host "    Çıktı Klasörü: $(Join-Path $AppDir 'dist')"
Get-ChildItem -Path (Join-Path $AppDir 'dist') -Filter "*.exe" | Select-Object Name, Length
