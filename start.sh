#!/bin/bash
# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# start.sh — the single, cross-platform development launcher (SAI Statistics).
#
# Runs as plain bash on macOS/Linux; on Windows (Git Bash / MSYS) it runs the
# PowerShell body below instead. One script covers every platform.
#
# Usage:
#   ./start.sh            starts the app in dev mode
#   ./start.sh --check    prints the resolved environment and exits

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Windows detection & PowerShell hand-off ─────────────────────────────────
IS_WINDOWS=0
case "$(uname -s 2>/dev/null)" in
  MINGW* | MSYS* | CYGWIN*) IS_WINDOWS=1 ;;
esac
if [ "$OS" = "Windows_NT" ]; then
  IS_WINDOWS=1
fi

if [ "$IS_WINDOWS" -eq 1 ]; then
  # pwsh (PowerShell 7+) is tried FIRST. This block used to prefer
  # powershell.exe and fall back to pwsh only when it was missing; on a machine
  # with pwsh 7 that meant deliberately picking the weaker shell (5.1 has no
  # `&&`/`||`, ternary or `??`, and its output encoding isn't UTF-8 by default).
  # The body below also works on 5.1 — the order is a preference, not a need.
  PS_EXE=""
  for candidate in pwsh.exe pwsh powershell.exe powershell; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PS_EXE="$candidate"
      break
    fi
  done
  if [ -z "$PS_EXE" ]; then
    echo "PowerShell not found (tried: pwsh.exe, pwsh, powershell.exe, powershell)." >&2
    exit 1
  fi

  # Each argument becomes its own PowerShell array element. This line used to
  # be @('$@'): $@ expanded unquoted, so several arguments collapsed into one
  # string (`--check --foo` → @('--check --foo')) and the -contains match
  # silently missed. It went unnoticed because it worked with one argument.
  # In PowerShell a single quote is escaped by doubling it.
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

    # Locate the app directory
    \$AppDir = Resolve-Path (Join-Path '$SCRIPT_DIR' 'app') -ErrorAction SilentlyContinue
    if (-not \$AppDir -or -not (Test-Path \$AppDir)) {
      \$AppDir = Join-Path (Get-Location) 'app'
    }
    if (-not (Test-Path \$AppDir)) {
      Write-Error \"app/ folder not found: \$AppDir\"
      exit 1
    }

    # 1. Node.js
    \$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not \$NodeCmd) {
      \$EmbeddedNode = Join-Path \$AppDir '..\.tools\node\node.exe'
      if (Test-Path \$EmbeddedNode) {
        \$env:PATH = \"\$((Resolve-Path (Join-Path \$AppDir '..\.tools\node')).Path);\$env:PATH\"
        \$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
      }
    }
    if (-not \$NodeCmd) {
      Write-Error 'Node.js not found on PATH. Install it from https://nodejs.org.'
      exit 1
    }

    \$NodeVersion = (& node -v).Trim()
    \$HaveMajor = (\$NodeVersion -replace '^v','').Split('.')[0]
    \$NvmrcPath = Join-Path \$AppDir '.nvmrc'
    \$WantMajor = ''
    if (Test-Path \$NvmrcPath) {
      \$WantMajor = ((Get-Content \$NvmrcPath -Raw).Trim() -replace '^v','').Split('.')[0]
    }

    # 2. Package manager
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
      Write-Error 'No package manager found (pnpm, corepack, npx, npm).'
      exit 1
    }

    \$NodeModulesDir = Join-Path \$AppDir 'node_modules'
    \$NeedsInstall = -not (Test-Path \$NodeModulesDir)

    # 3. --check mode
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

    # 4. Version warning
    if (\$WantMajor -and (\$WantMajor -ne \$HaveMajor)) {
      Write-Warning \"Node major \$HaveMajor is running but .nvmrc pins \$WantMajor.\"
    }

    # 5. Start
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

# ── Arguments ──────────────────────────────────────────────────────────────
CHECK=0
for arg in "$@"; do
  if [ "$arg" = "--check" ] || [ "$arg" = "-Check" ]; then
    CHECK=1
  fi
done

# ── nvm: if installed, load it and switch to the .nvmrc version ────────────
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  nvm use >/dev/null 2>&1 || echo "WARN: 'nvm use' failed; continuing with $(node -v)" >&2
fi

# ── Node version ───────────────────────────────────────────────────────────
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

# ── Package manager ────────────────────────────────────────────────────────
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

# ── --check mode ───────────────────────────────────────────────────────────
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

# ── Warning ────────────────────────────────────────────────────────────────
if [ -n "$WANT_MAJOR" ] && [ "$WANT_MAJOR" != "$HAVE_MAJOR" ]; then
  echo "WARN: Node major $HAVE_MAJOR is running but .nvmrc pins $WANT_MAJOR. If the build misbehaves, switch versions (nvm: 'nvm use $WANT_MAJOR'; fnm: 'fnm use $WANT_MAJOR')." >&2
fi

# ── Start ──────────────────────────────────────────────────────────────────
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
