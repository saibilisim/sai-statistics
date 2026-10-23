#!/bin/bash
# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# start.sh — tek ve çapraz platformlu geliştirme başlatıcısı (SAI Statistics).
#
# macOS/Linux'ta doğrudan bash, Windows'ta (Git Bash / MSYS) ise arka planda
# PowerShell kodlarını çalıştırır. Tek bir script ile tüm platformları destekler.
#
# Kullanım:
#   ./start.sh            uygulamayı dev modunda başlatır
#   ./start.sh --check    çözümlenen ortamı yazdırır ve çıkar

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Windows Algılama & PowerShell Çalıştırma ────────────────────────────────
IS_WINDOWS=0
case "$(uname -s 2>/dev/null)" in
  MINGW* | MSYS* | CYGWIN*) IS_WINDOWS=1 ;;
esac
if [ "$OS" = "Windows_NT" ]; then
  IS_WINDOWS=1
fi

if [ "$IS_WINDOWS" -eq 1 ]; then
  # pwsh (PowerShell 7+) ÖNCE denenir. Eskiden bu blok powershell.exe'yi
  # tercih ediyor ve pwsh'a ancak o yoksa düşüyordu; pwsh 7 kurulu bir
  # makinede bu, bilerek daha zayıf kabuğu seçmek demekti (5.1'de `&&`/`||`,
  # ternary ve `??` yok, çıktı kodlaması da varsayılan UTF-8 değil).
  # Aşağıdaki gövde 5.1 ile de çalışır — sıra bir tercih, zorunluluk değil.
  PS_EXE=""
  for candidate in pwsh.exe pwsh powershell.exe powershell; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PS_EXE="$candidate"
      break
    fi
  done
  if [ -z "$PS_EXE" ]; then
    echo "PowerShell bulunamadı (denenenler: pwsh.exe, pwsh, powershell.exe, powershell)." >&2
    exit 1
  fi

  # Argümanlar tek tek PowerShell dizi elemanına çevrilir. Bu satır eskiden
  # @('$@') idi: $@ tırnak dışında genişlediği için birden çok argüman tek bir
  # string'e çöküyordu (`--check --foo` → @('--check --foo')), dolayısıyla
  # -contains eşleşmesi sessizce kaçıyordu. Tek argümanla çalıştığı için
  # fark edilmemişti. PowerShell'de tek tırnak, ikiye katlanarak kaçırılır.
  PS_ARGS=""
  for arg in "$@"; do
    escaped=$(printf '%s' "$arg" | sed "s/'/''/g")
    if [ -z "$PS_ARGS" ]; then
      PS_ARGS="'$escaped'"
    else
      PS_ARGS="$PS_ARGS,'$escaped'"
    fi
  done

  exec "$PS_EXE" -NoProfile -ExecutionPolicy Bypass -Command "
    \$ErrorActionPreference = 'Stop'
    \$ArgsList = @($PS_ARGS)
    \$IsCheck = \$ArgsList -contains '--check' -or \$ArgsList -contains '-Check' -or \$ArgsList -contains '-c'
    
    # Proje dizinini bul
    \$AppDir = Resolve-Path (Join-Path '$SCRIPT_DIR' 'app') -ErrorAction SilentlyContinue
    if (-not \$AppDir -or -not (Test-Path \$AppDir)) {
      \$AppDir = Join-Path (Get-Location) 'app'
    }
    if (-not (Test-Path \$AppDir)) {
      Write-Error \"app/ klasörü bulunamadı: \$AppDir\"
      exit 1
    }

    # 1. Node.js kontrolü
    \$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not \$NodeCmd) {
      \$EmbeddedNode = Join-Path \$AppDir '..\.tools\node\node.exe'
      if (Test-Path \$EmbeddedNode) {
        \$env:PATH = \"\$((Resolve-Path (Join-Path \$AppDir '..\.tools\node')).Path);\$env:PATH\"
        \$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
      }
    }
    if (-not \$NodeCmd) {
      Write-Error 'Node.js PATH üzerinde bulunamadı. Lütfen https://nodejs.org adresinden kurun.'
      exit 1
    }

    \$NodeVersion = (& node -v).Trim()
    \$HaveMajor = (\$NodeVersion -replace '^v','').Split('.')[0]
    \$NvmrcPath = Join-Path \$AppDir '.nvmrc'
    \$WantMajor = ''
    if (Test-Path \$NvmrcPath) {
      \$WantMajor = ((Get-Content \$NvmrcPath -Raw).Trim() -replace '^v','').Split('.')[0]
    }

    # 2. Paket yöneticisi seçimi
    \$EmbeddedPnpm = Join-Path \$AppDir '..\.tools\pnpm\pnpm.cmd'
    if (Test-Path \$EmbeddedPnpm) {
      \$env:PATH = \"\$((Resolve-Path (Join-Path \$AppDir '..\.tools\pnpm')).Path);\$env:PATH\"
    }

    \$Runner = ''
    \$RunArgs = @()
    \$InstallArgs = @()
    \$Label = ''

    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
      \$Runner = 'pnpm'
      \$RunArgs = @('dev')
      \$InstallArgs = @('install')
      \$Label = 'pnpm (on PATH)'
    } elseif (Get-Command corepack -ErrorAction SilentlyContinue) {
      \$Runner = 'corepack'
      \$RunArgs = @('pnpm', 'dev')
      \$InstallArgs = @('pnpm', 'install')
      \$Label = 'pnpm via corepack'
      \$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
    } elseif (Get-Command npx -ErrorAction SilentlyContinue) {
      \$Runner = 'npx'
      \$RunArgs = @('--yes', 'pnpm', 'dev')
      \$InstallArgs = @('--yes', 'pnpm', 'install')
      \$Label = 'pnpm via npx'
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
      \$Runner = 'npm'
      \$RunArgs = @('run', 'dev')
      \$InstallArgs = @('install')
      \$Label = 'npm (pnpm unavailable)'
    } else {
      Write-Error 'Paket yöneticisi (pnpm, corepack, npx, npm) bulunamadı.'
      exit 1
    }

    \$NodeModulesDir = Join-Path \$AppDir 'node_modules'
    \$NeedsInstall = -not (Test-Path \$NodeModulesDir)

    # 3. --check modu
    if (\$IsCheck) {
      Write-Host ''
      Write-Host 'Environment check:'
      Write-Host \"  platform        : Windows (PowerShell \$(\$PSVersionTable.PSVersion))\"
      Write-Host \"  app dir         : \$AppDir\"
      Write-Host \"  node            : \$(\$NodeCmd.Source) (\$NodeVersion)\"
      Write-Host \"  package manager : \$Label\"
      Write-Host \"  run command     : \$Runner \$(\$RunArgs -join ' ')\"
      Write-Host \"  install command : \$Runner \$(\$InstallArgs -join ' ')\"
      if (\$NeedsInstall) {
        Write-Host '  node_modules    : MISSING (an install would run first)'
      } else {
        Write-Host '  node_modules    : present'
      }
      exit 0
    }

    # 4. Sürüm uyarısı
    if (\$WantMajor -and (\$WantMajor -ne \$HaveMajor)) {
      Write-Warning \"Node major \$HaveMajor is running but .nvmrc pins \$WantMajor.\"
    }

    # 5. Başlat
    Write-Host \"Platform: Windows (PowerShell \$(\$PSVersionTable.PSVersion))\"
    Write-Host \"Using Node \$NodeVersion\"
    Write-Host \"Using \$Label\"

    Set-Location \$AppDir
    if (\$NeedsInstall) {
      Write-Host 'node_modules missing - installing dependencies first...'
      & \$Runner @InstallArgs
      if (\$LASTEXITCODE -ne 0) { exit \$LASTEXITCODE }
    }

    Write-Host 'Starting SAI-Statistics Application in Development Mode...'
    & \$Runner @RunArgs
    exit \$LASTEXITCODE
  "
fi

# ── Linux / macOS (Bash) ───────────────────────────────────────────────────
APP_DIR="$SCRIPT_DIR/app"

if [ ! -d "$APP_DIR" ]; then
  echo "app/ not found next to start.sh (looked in '$APP_DIR')." >&2
  exit 1
fi
cd "$APP_DIR" || exit 1

# ── Argümanlar ─────────────────────────────────────────────────────────────
CHECK=0
for arg in "$@"; do
  if [ "$arg" = "--check" ] || [ "$arg" = "-Check" ]; then
    CHECK=1
  fi
done

# ── nvm: kuruluysa yükle ve .nvmrc sürümüne geç ────────────────────────────
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  nvm use >/dev/null 2>&1 || echo "WARN: 'nvm use' failed; continuing with $(node -v)" >&2
fi

# ── Node sürümü ────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found on PATH. Install it from https://nodejs.org (see .nvmrc for the expected major version)." >&2
  exit 1
fi
NODE_VERSION="$(node -v)"
HAVE_MAJOR="${NODE_VERSION#v}"
HAVE_MAJOR="${HAVE_MAJOR%%.*}"

WANT_MAJOR=""
if [ -f .nvmrc ]; then
  WANT_MAJOR="$(head -n 1 .nvmrc | tr -d '[:space:]' | sed 's/^v//; s/\..*//')"
fi

# ── Paket yöneticisi seçimi ────────────────────────────────────────────────
RUNNER=""
RUN_ARGS=()
INSTALL_ARGS=(install)
LABEL=""

if command -v pnpm >/dev/null 2>&1; then
  RUNNER="pnpm"
  LABEL="pnpm (on PATH)"
elif command -v corepack >/dev/null 2>&1; then
  RUNNER="corepack"
  RUN_ARGS=(pnpm)
  INSTALL_ARGS=(pnpm install)
  LABEL="pnpm via corepack"
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
elif command -v npx >/dev/null 2>&1; then
  RUNNER="npx"
  RUN_ARGS=(--yes pnpm)
  INSTALL_ARGS=(--yes pnpm install)
  LABEL="pnpm via npx"
else
  RUNNER="npm"
  RUN_ARGS=(run)
  LABEL="npm (pnpm unavailable)"
fi

NEEDS_INSTALL=0
[ -d node_modules ] || NEEDS_INSTALL=1

platform_name() {
  case "$(uname -s)" in
    Darwin) echo "macOS" ;;
    Linux) echo "Linux" ;;
    *) echo "$(uname -s)" ;;
  esac
}

cmd_line() {
  local out="$1"
  shift
  for a in "$@"; do out="$out $a"; done
  echo "$out"
}

# ── --check modu ───────────────────────────────────────────────────────────
if [ "$CHECK" = "1" ]; then
  echo ""
  echo "Environment check:"
  echo "  platform        : $(platform_name)"
  echo "  app dir         : $APP_DIR"
  echo "  node            : $(command -v node) ($NODE_VERSION)"
  echo "  package manager : $LABEL"
  echo "  run command     : $(cmd_line "$RUNNER" "${RUN_ARGS[@]}" dev)"
  echo "  install command : $(cmd_line "$RUNNER" "${INSTALL_ARGS[@]}")"
  if [ "$NEEDS_INSTALL" = "1" ]; then
    echo "  node_modules    : MISSING (an install would run first)"
  else
    echo "  node_modules    : present"
  fi
  exit 0
fi

# ── Uyarı ──────────────────────────────────────────────────────────────────
if [ -n "$WANT_MAJOR" ] && [ "$WANT_MAJOR" != "$HAVE_MAJOR" ]; then
  echo "WARN: Node major $HAVE_MAJOR is running but .nvmrc pins $WANT_MAJOR. If the build misbehaves, switch versions (nvm: 'nvm use $WANT_MAJOR'; fnm: 'fnm use $WANT_MAJOR')." >&2
fi

# ── Başlat ─────────────────────────────────────────────────────────────────
echo "Platform: $(platform_name)"
echo "Using Node $NODE_VERSION"
echo "Using $LABEL"

if [ "$NEEDS_INSTALL" = "1" ]; then
  echo "node_modules missing - installing dependencies first..."
  "$RUNNER" "${INSTALL_ARGS[@]}" || exit $?
fi

echo "Starting SAI-Statistics Application in Development Mode..."
"$RUNNER" "${RUN_ARGS[@]}" dev
exit $?
