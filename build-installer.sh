#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# build-installer.sh — tek komutla kurulum paketi derleme.
#
# Menüden hedefi seçersiniz; script gereken HER ŞEYİ kendisi hazırlar:
#   0) Ön koşullar  — eksikse otomatik kurulur (sisteme dokunmadan, proje
#      içindeki .tools/ altına): Node.js 24+, pnpm, micromamba (R runtime
#      üretimi için). Sistem paketi zorunlu olan tek durumlar: rpm hedefi
#      (rpmbuild), flatpak hedefi (flatpak-builder), Linux'tan Windows hedefi
#      (wine) — bunlar için onayınızla sudo apt çalıştırılır.
#   1) pnpm install
#   2) R runtime vendor adımı (hedef platforma göre, gerekirse)
#   3) pnpm build           (electron-vite production build)
#   4) electron-builder     (paket → app/dist/)
#
# Son kullanıcıya hiçbir şey kurdurmayan paket için 2. adım kritiktir —
# vendor atlanırsa uygulama çalışır ama analizler için kullanıcının kendi
# R'ını kurması gerekir.
#
# Platform kuralları:
#   - Linux hedefleri (deb/rpm/AppImage/Flatpak) yalnızca Linux'ta derlenir.
#   - Windows (NSIS) her platformda derlenir ama Linux/macOS'ta wine ister
#     (electron-builder .exe metadata'sını rcedit ile yazar).
#   - macOS (DMG) yalnızca macOS'ta derlenir.
#   - Windows/macOS için R runtime ancak O platformda üretilebilir
#     (conda-forge binary'leri çapraz üretilemez). Bu script'i Windows'ta
#     (Git Bash) veya macOS'ta çalıştırırsanız vendor adımı da otomatik
#     yapılır; Linux'tan Windows paketi derlerken R runtime'ı önceden bir
#     Windows makinede üretmiş olmanız gerekir.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/app"
TOOLS_DIR="$ROOT_DIR/.tools"
mkdir -p "$TOOLS_DIR/bin"
export MAMBA_ROOT_PREFIX="$TOOLS_DIR/mamba-root"

OS="$(uname -s)"
IS_WINDOWS=false
case "$OS" in
  MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=true ;;
esac

say()  { echo; echo "==> $*"; }
fail() { echo; echo "HATA: $*" >&2; exit 1; }

# ─── 0) Ön koşullar (otomatik, projeye özel) ─────────────────────────────────

ensure_node() {
  local major=0
  if command -v node >/dev/null 2>&1; then
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  fi
  [ "$major" -ge 24 ] 2>/dev/null && return 0

  say "Node.js 24+ indiriliyor (projeye özel: .tools/node — sisteme dokunulmaz)"
  local plat ext
  case "$OS" in
    Linux)
      case "$(uname -m)" in
        x86_64)        plat=linux-x64 ;;
        aarch64|arm64) plat=linux-arm64 ;;
        *) fail "Desteklenmeyen mimari: $(uname -m)" ;;
      esac
      ext=tar.xz ;;
    Darwin)
      case "$(uname -m)" in
        x86_64) plat=darwin-x64 ;;
        arm64)  plat=darwin-arm64 ;;
        *) fail "Desteklenmeyen mimari: $(uname -m)" ;;
      esac
      ext=tar.gz ;;
    MINGW*|MSYS*|CYGWIN*) plat=win-x64; ext=zip ;;
    *) fail "Desteklenmeyen işletim sistemi: $OS" ;;
  esac

  command -v curl >/dev/null 2>&1 || fail "curl bulunamadı (Node indirmek için gerekli)."
  local fname
  fname="$(curl -fsSL https://nodejs.org/dist/latest-v24.x/ | grep -o "node-v24[0-9.]*-$plat\.$ext" | head -1)"
  [ -n "$fname" ] || fail "nodejs.org'dan sürüm listesi alınamadı — internet bağlantısını kontrol edin."

  curl -fsSL -o "$TOOLS_DIR/node.$ext" "https://nodejs.org/dist/latest-v24.x/$fname"
  # Node'un yayımladığı SHASUMS256.txt ile doğrula; uyuşmazsa açmadan dur.
  local expected actual
  expected="$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | awk -v f="$fname" '$2 == f { print $1 }')"
  [ -n "$expected" ] || fail "Node SHASUMS256.txt alınamadı veya $fname için kayıt yok."
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$TOOLS_DIR/node.$ext" | awk '{ print $1 }')"
  else
    actual="$(shasum -a 256 "$TOOLS_DIR/node.$ext" | awk '{ print $1 }')"
  fi
  if [ "$actual" != "$expected" ]; then
    rm -f "$TOOLS_DIR/node.$ext"
    fail "Node arşivi SHA-256 uyuşmuyor (beklenen $expected, gelen $actual)."
  fi
  rm -rf "$TOOLS_DIR/node" "$TOOLS_DIR/node-extract"
  mkdir -p "$TOOLS_DIR/node-extract"
  if [ "$ext" = zip ]; then
    unzip -q "$TOOLS_DIR/node.$ext" -d "$TOOLS_DIR/node-extract"
  else
    tar -xf "$TOOLS_DIR/node.$ext" -C "$TOOLS_DIR/node-extract"
  fi
  mv "$TOOLS_DIR/node-extract"/node-v24* "$TOOLS_DIR/node"
  rm -rf "$TOOLS_DIR/node-extract" "$TOOLS_DIR/node.$ext"

  export PATH="$TOOLS_DIR/node/bin:$TOOLS_DIR/node:$PATH"
  echo "    Node $(node --version) hazır."
}

ensure_pnpm() {
  command -v pnpm >/dev/null 2>&1 && return 0
  say "pnpm kuruluyor (corepack ile, projeye özel)"
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@latest --activate || fail "pnpm kurulamadı (corepack)."
  command -v pnpm >/dev/null 2>&1 || fail "pnpm kurulamadı."
}

ensure_conda() {
  local c
  for c in conda mamba micromamba; do
    if command -v "$c" >/dev/null 2>&1; then export CONDA_BIN="$c"; return 0; fi
  done

  if [ ! -x "$TOOLS_DIR/bin/micromamba" ] && [ ! -f "$TOOLS_DIR/bin/micromamba.exe" ]; then
    say "micromamba indiriliyor (R runtime üretimi için, projeye özel: .tools/)"
    local mplat
    case "$OS" in
      Linux)  case "$(uname -m)" in aarch64|arm64) mplat=linux-aarch64 ;; *) mplat=linux-64 ;; esac ;;
      Darwin) case "$(uname -m)" in arm64) mplat=osx-arm64 ;; *) mplat=osx-64 ;; esac ;;
      MINGW*|MSYS*|CYGWIN*) mplat=win-64 ;;
      *) fail "Desteklenmeyen işletim sistemi: $OS" ;;
    esac
    curl -fsSL -o "$TOOLS_DIR/micromamba.tar.bz2" "https://micro.mamba.pm/api/micromamba/$mplat/latest"
    tar -xjf "$TOOLS_DIR/micromamba.tar.bz2" -C "$TOOLS_DIR"
    # Unix: bin/micromamba · Windows: Library/bin/micromamba.exe
    if [ -f "$TOOLS_DIR/Library/bin/micromamba.exe" ]; then
      mv "$TOOLS_DIR/Library/bin/micromamba.exe" "$TOOLS_DIR/bin/"
      rm -rf "$TOOLS_DIR/Library"
    fi
    rm -f "$TOOLS_DIR/micromamba.tar.bz2"
  fi

  export CONDA_BIN="$TOOLS_DIR/bin/micromamba"
  if [ "$IS_WINDOWS" = true ]; then
    # PowerShell vendor script'i Windows tarzı yol ister
    CONDA_BIN="$(cygpath -w "$TOOLS_DIR/bin/micromamba.exe" 2>/dev/null || echo "$TOOLS_DIR/bin/micromamba.exe")"
  fi
  echo "    micromamba hazır ($CONDA_BIN)."
}

# Sistem paketi gerektiren tek nokta (yalnızca Linux, onaylı sudo)
apt_ensure() { # $1 = komut, $2 = apt paketi
  command -v "$1" >/dev/null 2>&1 && return 0
  if [ "$OS" != "Linux" ]; then
    fail "'$1' bulunamadı. Bu hedef için gerekli; paket yöneticinizle kurun (örn. brew / choco: $2)."
  fi
  command -v apt-get >/dev/null 2>&1 || fail "'$1' eksik ve otomatik kurulum yalnızca apt tabanlı sistemlerde destekleniyor. Elle kurun: $2"
  echo
  echo "    '$1' eksik. Kurulması gerekiyor: sudo apt-get install -y $2"
  read -r -p "    Şimdi kurulsun mu? (sudo parolanız istenir) [E/h]: " a
  case "$a" in
    h|H|n|N) fail "'$1' olmadan bu hedef derlenemez." ;;
  esac
  sudo apt-get update && sudo apt-get install -y "$2"
  command -v "$1" >/dev/null 2>&1 || fail "'$1' kurulamadı."
}

ensure_node
ensure_pnpm

# ─── Menü ─────────────────────────────────────────────────────────────────────

echo
echo "  SAI Statistics — kurulum paketi derleme"
echo "  ---------------------------------------"
echo "  1) Linux  .deb"
echo "  2) Linux  .rpm"
echo "  3) Linux  .AppImage"
echo "  4) Linux  .flatpak"
echo "  5) Windows  .exe (NSIS)"
echo "  6) macOS    .dmg"
echo "  0) Çıkış"
echo
read -r -p "Seçiminiz [1-6]: " CHOICE

case "$CHOICE" in
  1) TARGET_NAME="Linux .deb";       BUILDER_ARGS=(--linux deb) ;;
  2) TARGET_NAME="Linux .rpm";       BUILDER_ARGS=(--linux rpm) ;;
  3) TARGET_NAME="Linux .AppImage";  BUILDER_ARGS=(--linux AppImage) ;;
  4) TARGET_NAME="Linux .flatpak";   BUILDER_ARGS=(--linux flatpak) ;;
  5) TARGET_NAME="Windows .exe";     BUILDER_ARGS=(--win nsis --x64) ;;
  6) TARGET_NAME="macOS .dmg";       BUILDER_ARGS=(--mac dmg) ;;
  0) echo "Çıkıldı."; exit 0 ;;
  *) fail "Geçersiz seçim: '$CHOICE'" ;;
esac

# ─── Platform kontrolleri + hedefe özel gereksinimler ────────────────────────

case "$CHOICE" in
  1|2|3|4)
    [ "$OS" = "Linux" ] || fail "Linux hedefleri yalnızca Linux'ta derlenebilir (bu makine: $OS)."
    ;;
  5)
    if [ "$IS_WINDOWS" = false ]; then
      apt_ensure wine wine64
    fi
    ;;
  6)
    [ "$OS" = "Darwin" ] || fail "DMG yalnızca macOS'ta derlenebilir (bu makine: $OS)."
    ;;
esac

if [ "$CHOICE" = "2" ]; then
  apt_ensure rpmbuild rpm
fi

if [ "$CHOICE" = "4" ]; then
  apt_ensure flatpak flatpak
  apt_ensure flatpak-builder flatpak-builder
  # electron-builder'ın flatpak hedefi org.electronplatform.ElectronApp
  # runtime'ını ister; kullanıcı bazında (sudo'suz) kurulur.
  if ! flatpak info org.electronplatform.ElectronApp >/dev/null 2>&1; then
    say "flatpak runtime'ı kuruluyor (org.electronplatform.ElectronApp, --user)"
    flatpak --user remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo || true
    flatpak --user install -y --noninteractive flathub org.electronplatform.ElectronApp \
      || fail "flatpak runtime kurulamadı. Elle deneyin: flatpak --user install flathub org.electronplatform.ElectronApp"
  fi
fi

cd "$APP_DIR"

# ─── 1) Bağımlılıklar ─────────────────────────────────────────────────────────

say "1/5  pnpm install"
pnpm install

# ─── 2) R runtime vendor ─────────────────────────────────────────────────────

say "2/5  R runtime (vendor)"

runtime_ready() { # $1 = runtime dizini; içinde gerçek bir R var mı?
  [ -x "$1/bin/Rscript" ] || [ -f "$1/bin/Rscript.exe" ] || [ -f "$1/lib/R/bin/x64/Rscript.exe" ]
}

ask_rebuild() { # kullanıcı isterse true döner
  read -r -p "    $1 zaten mevcut. Yeniden üretilsin mi? [e/H]: " a
  [[ "$a" =~ ^[eEyY]$ ]]
}

case "$CHOICE" in
  1|2|3|4)
    if runtime_ready resources/r-runtime; then
      if ask_rebuild resources/r-runtime; then
        ensure_conda && bash scripts/vendor-r-runtime.sh
      fi
    else
      ensure_conda && bash scripts/vendor-r-runtime.sh
    fi
    ;;
  5)
    if runtime_ready resources/r-runtime-win; then
      if [ "$IS_WINDOWS" = true ]; then
        if ask_rebuild resources/r-runtime-win; then
          ensure_conda && powershell -ExecutionPolicy Bypass -File scripts/vendor-r-runtime-win.ps1
        fi
      else
        echo "    resources/r-runtime-win mevcut — pakete gömülecek."
      fi
    elif [ "$IS_WINDOWS" = true ]; then
      ensure_conda && powershell -ExecutionPolicy Bypass -File scripts/vendor-r-runtime-win.ps1
    else
      echo "    UYARI: Windows R runtime'ı yok (resources/r-runtime-win boş)."
      echo "    Windows paketine gömülü R ancak bir Windows makinede üretilebilir:"
      echo "      Windows'ta Git Bash ile bu script'i çalıştırın (5. seçenek) —"
      echo "      vendor adımı orada otomatik yapılır."
      read -r -p "    Gömülü R OLMADAN devam edilsin mi? (uygulama kullanıcının sistem R'ına düşer) [e/H]: " a
      [[ "$a" =~ ^[eEyY]$ ]] || fail "İptal edildi."
    fi
    ;;
  6)
    if runtime_ready resources/r-runtime-mac; then
      if ask_rebuild resources/r-runtime-mac; then
        ensure_conda && bash scripts/vendor-r-runtime-mac.sh
      fi
    else
      ensure_conda && bash scripts/vendor-r-runtime-mac.sh
    fi
    ;;
esac

# ─── 3) Production build ─────────────────────────────────────────────────────

say "3/5  pnpm build (electron-vite)"
pnpm build

# ─── 4) Paketleme ─────────────────────────────────────────────────────────────

say "4/5  electron-builder → $TARGET_NAME"
pnpm exec electron-builder "${BUILDER_ARGS[@]}" --publish never

# ─── 5) Paketi doğrula ────────────────────────────────────────────────────────
# Buraya kadarki her adım KAYNAK kodu doğruluyor; bu adım ÜRETİLEN PAKETİ
# doğruluyor. Aradaki fark önemli: gömülü R'ı üreten vendor adımı ile onu
# pakete kopyalayan electron-builder ayrı iki iş ve ikincisi de bozulabilir.
# Nitekim eksik R paketleriyle çıkan sürüm tam buradan geçmişti — kaynak
# testleri yeşildi, pakete kimse bakmıyordu.
say "5/5  Paketi doğrula"
if node "$APP_DIR/scripts/verify-packaged-build.cjs"; then
  :
else
  fail "Paket doğrulaması başarısız — yukarıdaki mesaja bakın. Paket dağıtıma HAZIR DEĞİL."
fi

say "Tamamlandı: $TARGET_NAME"
echo "    Çıktı: $APP_DIR/dist/"
ls -lh "$APP_DIR/dist/" | grep -vi unpacked || true
