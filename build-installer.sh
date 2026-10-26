#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# build-installer.sh — builds an installer with one command.
#
# Pick a target from the menu; the script prepares EVERYTHING it needs:
#   0) Prerequisites — installed automatically if missing (project-local under
#      .tools/, the system is left alone): Node.js 24+, pnpm, micromamba (for
#      building the R runtime). The only cases that need a system package: the
#      rpm target (rpmbuild), the flatpak target (flatpak-builder) and the
#      Windows target from Linux (wine) — for those, sudo apt runs after you
#      confirm.
#   1) pnpm install
#   2) R runtime vendoring (per target platform, when needed)
#   3) pnpm build           (electron-vite production build)
#   4) electron-builder     (package → app/dist/)
#   5) verify the package
#
# Step 2 is what makes a package that installs nothing on the user's machine —
# skip vendoring and the app still runs, but the analyses need the user's own
# R installation.
#
# Platform rules:
#   - Linux targets (deb/rpm/AppImage/Flatpak) build only on Linux.
#   - Windows (NSIS) builds anywhere but needs wine on Linux/macOS
#     (electron-builder writes the .exe metadata with rcedit).
#   - macOS (DMG) builds only on macOS.
#   - The Windows/macOS R runtime can only be produced ON that platform
#     (conda-forge binaries can't be cross-built). Run this script on Windows
#     (Git Bash) or macOS and the vendoring step runs automatically; to build
#     the Windows package from Linux you must have produced the R runtime on a
#     Windows machine beforehand.

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
fail() { echo; echo "ERROR: $*" >&2; exit 1; }

# ─── 0) Prerequisites (automatic, project-local) ─────────────────────────────

ensure_node() {
  local major=0
  if command -v node >/dev/null 2>&1; then
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  fi
  [ "$major" -ge 24 ] 2>/dev/null && return 0

  say "Downloading Node.js 24+ (project-local: .tools/node — the system is left alone)"
  local plat ext
  case "$OS" in
    Linux)
      case "$(uname -m)" in
        x86_64)        plat=linux-x64 ;;
        aarch64|arm64) plat=linux-arm64 ;;
        *) fail "Unsupported architecture: $(uname -m)" ;;
      esac
      ext=tar.xz ;;
    Darwin)
      case "$(uname -m)" in
        x86_64) plat=darwin-x64 ;;
        arm64)  plat=darwin-arm64 ;;
        *) fail "Unsupported architecture: $(uname -m)" ;;
      esac
      ext=tar.gz ;;
    MINGW*|MSYS*|CYGWIN*) plat=win-x64; ext=zip ;;
    *) fail "Unsupported operating system: $OS" ;;
  esac

  command -v curl >/dev/null 2>&1 || fail "curl not found (needed to download Node)."
  local fname
  fname="$(curl -fsSL https://nodejs.org/dist/latest-v24.x/ | grep -o "node-v24[0-9.]*-$plat\.$ext" | head -1)"
  [ -n "$fname" ] || fail "Could not fetch the release list from nodejs.org — check your internet connection."

  curl -fsSL -o "$TOOLS_DIR/node.$ext" "https://nodejs.org/dist/latest-v24.x/$fname"
  # Verify against Node's published SHASUMS256.txt; stop before extracting on a mismatch.
  local expected actual
  expected="$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | awk -v f="$fname" '$2 == f { print $1 }')"
  [ -n "$expected" ] || fail "Could not fetch Node's SHASUMS256.txt, or it has no entry for $fname."
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$TOOLS_DIR/node.$ext" | awk '{ print $1 }')"
  else
    actual="$(shasum -a 256 "$TOOLS_DIR/node.$ext" | awk '{ print $1 }')"
  fi
  if [ "$actual" != "$expected" ]; then
    rm -f "$TOOLS_DIR/node.$ext"
    fail "Node archive SHA-256 mismatch (expected $expected, got $actual)."
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
  echo "    Node $(node --version) ready."
}

ensure_pnpm() {
  command -v pnpm >/dev/null 2>&1 && return 0
  say "Installing pnpm (via corepack, project-local)"
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@12.15.0 --activate || fail "Could not install pnpm (corepack)."
  command -v pnpm >/dev/null 2>&1 || fail "Could not install pnpm."
}

MICROMAMBA_VERSION=2.9.0-0

ensure_conda() {
  local c
  for c in conda mamba micromamba; do
    if command -v "$c" >/dev/null 2>&1; then export CONDA_BIN="$c"; return 0; fi
  done

  if [ ! -x "$TOOLS_DIR/bin/micromamba" ]; then
    say "Downloading micromamba $MICROMAMBA_VERSION (for building the R runtime, project-local: .tools/)"
    local mplat msha
    # Pinned release + SHA-256 of its .tar.bz2 (verified against GitHub's asset
    # digests). Bump both together. Windows no longer builds its R runtime with
    # conda (vendor-r-runtime-win.ps1 uses CRAN), so there is no win-64 entry.
    case "$OS" in
      Linux)
        case "$(uname -m)" in
          aarch64|arm64) mplat=linux-aarch64; msha=e705ffeed90ce0659eb546e4b1e1028c9eaf0bc9cc854867b19ac5ce0ba5852f ;;
          *)             mplat=linux-64;      msha=8761c382127e6363bd9e0a2451aa3ef90d071a79133f736e2f759a3bf13040dd ;;
        esac ;;
      Darwin)
        case "$(uname -m)" in
          arm64) mplat=osx-arm64; msha=500f5074feb8d02c4296ef9921c3650ed2874171805a9fbb8fbb53896433646b ;;
          *)     mplat=osx-64;    msha=0426ecdc41636d369f57b8fe6acbf4385a69eca45b56d9ee7d3a840a9965d44f ;;
        esac ;;
      *) fail "Unsupported operating system for micromamba: $OS" ;;
    esac
    curl -fsSL -o "$TOOLS_DIR/micromamba.tar.bz2" \
      "https://github.com/mamba-org/micromamba-releases/releases/download/$MICROMAMBA_VERSION/micromamba-$mplat.tar.bz2"
    local got
    if command -v sha256sum >/dev/null 2>&1; then
      got="$(sha256sum "$TOOLS_DIR/micromamba.tar.bz2" | cut -d' ' -f1)"
    else
      got="$(shasum -a 256 "$TOOLS_DIR/micromamba.tar.bz2" | cut -d' ' -f1)"
    fi
    if [ "$got" != "$msha" ]; then
      rm -f "$TOOLS_DIR/micromamba.tar.bz2"
      fail "micromamba checksum mismatch (expected $msha, got $got)."
    fi
    tar -xjf "$TOOLS_DIR/micromamba.tar.bz2" -C "$TOOLS_DIR"
    rm -f "$TOOLS_DIR/micromamba.tar.bz2"
  fi

  export CONDA_BIN="$TOOLS_DIR/bin/micromamba"
  echo "    micromamba ready ($CONDA_BIN)."
}

# The only place that needs a system package (Linux only, sudo after confirmation)
apt_ensure() { # $1 = command, $2 = apt package
  command -v "$1" >/dev/null 2>&1 && return 0
  if [ "$OS" != "Linux" ]; then
    fail "'$1' not found. This target needs it; install it with your package manager (e.g. brew / choco: $2)."
  fi
  command -v apt-get >/dev/null 2>&1 || fail "'$1' is missing and automatic installation is only supported on apt-based systems. Install it manually: $2"
  echo
  echo "    '$1' is missing. It needs to be installed: sudo apt-get install -y $2"
  read -r -p "    Install it now? (asks for your sudo password) [Y/n]: " a
  case "$a" in
    n|N) fail "This target cannot be built without '$1'." ;;
  esac
  sudo apt-get update && sudo apt-get install -y "$2"
  command -v "$1" >/dev/null 2>&1 || fail "Could not install '$1'."
}

ensure_node
ensure_pnpm

# ─── Menu ─────────────────────────────────────────────────────────────────────

echo
echo "  SAI Statistics — build an installer"
echo "  -----------------------------------"
echo "  1) Linux  .deb"
echo "  2) Linux  .rpm"
echo "  3) Linux  .AppImage"
echo "  4) Linux  .flatpak"
echo "  5) Windows  .exe (NSIS)"
echo "  6) macOS    .dmg"
echo "  0) Quit"
echo
read -r -p "Your choice [1-6]: " CHOICE

case "$CHOICE" in
  1) TARGET_NAME="Linux .deb";       BUILDER_ARGS=(--linux deb) ;;
  2) TARGET_NAME="Linux .rpm";       BUILDER_ARGS=(--linux rpm) ;;
  3) TARGET_NAME="Linux .AppImage";  BUILDER_ARGS=(--linux AppImage) ;;
  4) TARGET_NAME="Linux .flatpak";   BUILDER_ARGS=(--linux flatpak) ;;
  5) TARGET_NAME="Windows .exe";     BUILDER_ARGS=(--win nsis --x64) ;;
  6) TARGET_NAME="macOS .dmg";       BUILDER_ARGS=(--mac dmg) ;;
  0) echo "Bye."; exit 0 ;;
  *) fail "Invalid choice: '$CHOICE'" ;;
esac

# ─── Platform checks + target-specific requirements ──────────────────────────

case "$CHOICE" in
  1|2|3|4)
    [ "$OS" = "Linux" ] || fail "Linux targets can only be built on Linux (this machine: $OS)."
    ;;
  5)
    if [ "$IS_WINDOWS" = false ]; then
      apt_ensure wine wine64
    fi
    ;;
  6)
    [ "$OS" = "Darwin" ] || fail "A DMG can only be built on macOS (this machine: $OS)."
    ;;
esac

if [ "$CHOICE" = "2" ]; then
  apt_ensure rpmbuild rpm
fi

if [ "$CHOICE" = "4" ]; then
  apt_ensure flatpak flatpak
  apt_ensure flatpak-builder flatpak-builder
  # electron-builder's flatpak target needs the org.electronplatform.ElectronApp
  # runtime; it is installed per user (no sudo).
  if ! flatpak info org.electronplatform.ElectronApp >/dev/null 2>&1; then
    say "Installing the flatpak runtime (org.electronplatform.ElectronApp, --user)"
    flatpak --user remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo || true
    flatpak --user install -y --noninteractive flathub org.electronplatform.ElectronApp \
      || fail "Could not install the flatpak runtime. Try manually: flatpak --user install flathub org.electronplatform.ElectronApp"
  fi
fi

cd "$APP_DIR"

# ─── 1) Dependencies ──────────────────────────────────────────────────────────

say "1/5  pnpm install"
pnpm install

# ─── 2) R runtime vendoring ──────────────────────────────────────────────────

say "2/5  R runtime (vendor)"

runtime_ready() { # $1 = runtime directory; does it hold a real R?
  [ -x "$1/bin/Rscript" ] || [ -f "$1/bin/Rscript.exe" ] || [ -f "$1/lib/R/bin/x64/Rscript.exe" ]
}

ask_rebuild() { # returns true if the user wants it
  read -r -p "    $1 already exists. Rebuild it? [y/N]: " a
  [[ "$a" =~ ^[yY]$ ]]
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
          powershell -ExecutionPolicy Bypass -File scripts/vendor-r-runtime-win.ps1
        fi
      else
        echo "    resources/r-runtime-win exists — it will be embedded in the package."
      fi
    elif [ "$IS_WINDOWS" = true ]; then
      powershell -ExecutionPolicy Bypass -File scripts/vendor-r-runtime-win.ps1
    else
      echo "    WARNING: no Windows R runtime (resources/r-runtime-win is empty)."
      echo "    The R embedded in the Windows package can only be produced on a Windows machine:"
      echo "      run this script there with Git Bash (option 5) —"
      echo "      the vendoring step runs automatically."
      read -r -p "    Continue WITHOUT an embedded R? (the app falls back to the user's system R) [y/N]: " a
      [[ "$a" =~ ^[yY]$ ]] || fail "Cancelled."
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

# ─── 4) Packaging ─────────────────────────────────────────────────────────────

say "4/5  electron-builder → $TARGET_NAME"
pnpm exec electron-builder "${BUILDER_ARGS[@]}" --publish never

# ─── 5) Verify the package ────────────────────────────────────────────────────
# Every step so far checks the SOURCE; this one checks the PACKAGE THAT WAS
# PRODUCED. The difference matters: the vendor step that builds the embedded R
# and the electron-builder step that copies it into the package are two
# separate jobs, and the second can break too. A release with missing R
# packages slipped through exactly here — source tests were green, nobody was
# looking at the package.
say "5/5  Verify the package"
if node "$APP_DIR/scripts/verify-packaged-build.cjs"; then
  :
else
  fail "Package verification failed — see the message above. The package is NOT ready to ship."
fi

say "Done: $TARGET_NAME"
echo "    Output: $APP_DIR/dist/"
ls -lh "$APP_DIR/dist/" | grep -vi unpacked || true
