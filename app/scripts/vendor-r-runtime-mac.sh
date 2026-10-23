#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# vendor-r-runtime-mac.sh — macOS counterpart of vendor-r-runtime.sh: build a
# portable, self-contained R runtime and drop it into resources/r-runtime-mac/
# so electron-builder bundles it (mac.extraResources in electron-builder.json)
# and r-bridge.ts's detectBundledR() picks it up at
# resources/r-runtime/bin/Rscript before ever looking at the system PATH.
#
# Must be run ON macOS (conda-forge osx-64/osx-arm64 binaries cannot be
# produced on other OSes); the host CPU determines the bundled arch, matching
# electron-builder's default of packaging for the host arch. See the Linux
# script for why conda-forge (old SDK baseline, @rpath-relative dylibs, no
# env juggling at spawn time).
#
# What is vendored: everything in setup.R's `required` list — jsonlite + arrow
# (the JSON/Arrow transport every script needs), R's own recommended package
# set via r-recommended (boot, class, cluster, MASS, nlme, nnet, rpart,
# survival, …), and psych + nortest. The rule of thumb: the bundled runtime
# must never be a weaker R than the "user installs R themselves" path, and a
# stock CRAN R already ships the recommended set. OPTIONAL_PACKAGES power
# rarely-used advanced analyses and stay on-demand via the in-app R Packages
# manager by design — the user installs them in-app, only if they want them.
#
# Usage: scripts/vendor-r-runtime-mac.sh   (or: pnpm vendor:r-runtime:mac)
# Requires: conda (or micromamba/mamba — edit CONDA_BIN below) on PATH.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
DEST="$APP_DIR/resources/r-runtime-mac"
CONDA_BIN="${CONDA_BIN:-conda}"

if ! command -v "$CONDA_BIN" >/dev/null 2>&1; then
  echo "error: '$CONDA_BIN' not found on PATH. Install Miniconda/Miniforge first." >&2
  exit 1
fi

# Package list comes from shared/r-packages.json — the single source of truth
# the app, setup.R and the other two vendor scripts all read, so this list
# cannot drift out of sync with what the app actually needs (which is exactly
# how the missing recommended set shipped). node is already a build
# prerequisite, so no extra tooling (jq) is pulled in.
MANIFEST="$APP_DIR/shared/r-packages.json"
[ -f "$MANIFEST" ] || { echo "error: $MANIFEST not found" >&2; exit 1; }
# r-recommended installs R's own recommended set as a group; everything
# bundled outside that group is requested by name.
# The path goes in as argv, not interpolated into the JS source: keeps quoting
# in the path harmless and avoids require()'s path-resolution quirks.
_read_manifest() {
  node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const field = process.argv[2];
    // "console" packages (ggplot2, readxl …) are vendored too, for the R terminal.
    const all = [...m.bundled, ...m.console.packages];
    if (field === "conda") console.log(all.filter(p => !p.recommended).map(p => p.conda).join(" "));
    else if (field === "rnames") console.log(all.map(p => JSON.stringify(p.r)).join(","));
    else console.log(String(all.length));
  ' "$MANIFEST" "$1"
}
EXTRA_CONDA="$(_read_manifest conda)"
REQUIRED_R="$(_read_manifest rnames)"
echo "[vendor-r-runtime] manifest: $(_read_manifest count) bundled packages"

# BLAS/LAPACK backend. conda-forge's default for R is Intel MKL, which ships a
# separately compiled kernel per CPU generation and runs to ~300MB, of which a
# given machine uses exactly one. OpenBLAS does the same job in a fraction of
# that. Measured on Windows: bundle 1046MB -> 531MB, and the full r-validation
# suite came back 1341/4 either way — byte-identical verdicts, so the
# "different BLAS shifts the last decimals" risk is empirically nil at this
# suite's tolerances.
#
# Set SAI_BLAS=mkl to go back to conda-forge's default.
SAI_BLAS="${SAI_BLAS:-openblas}"
if [ "$SAI_BLAS" = "mkl" ]; then BLAS_SPEC=(); else BLAS_SPEC=("libblas=*=*openblas"); fi
echo "[vendor-r-runtime] BLAS backend: $SAI_BLAS"

TMP_ENV="$(mktemp -d)/r-runtime-env"
echo "[vendor-r-runtime] creating conda-forge env at $TMP_ENV ..."
# r-recommended = R's own recommended set (boot, class, cluster, MASS, nlme,
# nnet, rpart, survival, …). Stock CRAN R ships these; conda-forge's r-base
# does not, so without this line the bundled runtime is a weaker R than the
# "install R yourself" path. psych/nortest complete setup.R's `required` list.
# See vendor-r-runtime.sh for the full rationale.
"$CONDA_BIN" create -y -p "$TMP_ENV" -c conda-forge --override-channels \
  r-base=4.3 r-recommended=4.3 $EXTRA_CONDA "${BLAS_SPEC[@]}"

echo "[vendor-r-runtime] pruning build-only toolchain (compiler, headers, docs)..."
rm -rf \
  "$TMP_ENV"/*-apple-darwin* \
  "$TMP_ENV/libexec" \
  "$TMP_ENV/include" \
  "$TMP_ENV/share/man" \
  "$TMP_ENV/share/info" \
  "$TMP_ENV/share/doc" \
  "$TMP_ENV/share/locale" \
  "$TMP_ENV/conda-meta" \
  "$TMP_ENV/pkgs" 2>/dev/null || true

echo "[vendor-r-runtime] patching hardcoded build-time paths for relocatability..."
# Same problem as on Linux: conda-forge's r-base bakes the absolute build
# prefix into lib/R/bin/R (used for R.home()/install.packages() from inside a
# running session) and into the compiled bin/Rscript launcher. Patch the
# former to resolve itself dynamically, replace the latter with a wrapper —
# see vendor-r-runtime.sh for the full explanation.
sed -i.bak \
  -e "s#^R_HOME_DIR=${TMP_ENV}/lib/R\$#R_HOME_DIR=\"\$(cd \"\$(dirname \"\$0\")/..\" \&\& pwd)\"#" \
  -e "s#^R_SHARE_DIR=${TMP_ENV}/lib/R/share\$#R_SHARE_DIR=\"\${R_HOME_DIR}/share\"#" \
  -e "s#^R_INCLUDE_DIR=${TMP_ENV}/lib/R/include\$#R_INCLUDE_DIR=\"\${R_HOME_DIR}/include\"#" \
  -e "s#^R_DOC_DIR=${TMP_ENV}/lib/R/doc\$#R_DOC_DIR=\"\${R_HOME_DIR}/doc\"#" \
  -e "s#^SED=${TMP_ENV}/bin/sed\$#SED=sed#" \
  "$TMP_ENV/lib/R/bin/R"
rm -f "$TMP_ENV/lib/R/bin/R.bak"

# DYLD_FALLBACK_LIBRARY_PATH (not DYLD_LIBRARY_PATH): honored for children of
# non-SIP processes like the Electron app, and conda-forge dylibs are already
# @rpath/@loader_path-relative, so this is only a fallback for edge cases.
cat > "$TMP_ENV/bin/Rscript" <<'RSCRIPT_WRAPPER'
#!/bin/bash
set -e
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export R_HOME="$SELF_DIR/../lib/R"
export R_SHARE_DIR="$R_HOME/share"
export R_INCLUDE_DIR="$R_HOME/include"
export R_DOC_DIR="$R_HOME/doc"
export DYLD_FALLBACK_LIBRARY_PATH="$SELF_DIR/../lib:$R_HOME/lib${DYLD_FALLBACK_LIBRARY_PATH:+:$DYLD_FALLBACK_LIBRARY_PATH}"

r_args=()
trailing=()
file=""
i=1
n=$#
while [ "$i" -le "$n" ]; do
  arg="${!i}"
  if [ -z "$file" ]; then
    if [ "$arg" = "-e" ]; then
      i=$((i + 1))
      r_args+=("-e" "${!i}")
    elif [[ "$arg" == -* ]]; then
      r_args+=("$arg")
    else
      file="$arg"
    fi
  else
    trailing+=("$arg")
  fi
  i=$((i + 1))
done

if [ -n "$file" ]; then
  exec "$R_HOME/bin/exec/R" --no-echo --no-restore "${r_args[@]}" --file="$file" --args "${trailing[@]}"
else
  exec "$R_HOME/bin/exec/R" --no-echo --no-restore "${r_args[@]}"
fi
RSCRIPT_WRAPPER
chmod +x "$TMP_ENV/bin/Rscript"

echo "[vendor-r-runtime] verifying bundled R is genuinely relocatable..."
# Move (not copy) to a differently-named path with a space, mimicking the
# .app bundle layout ("/Applications/SAI Statistics.app/Contents/Resources"),
# and run with a completely empty environment.
RELOC_CHECK="$(mktemp -d)/moved dir/r-runtime"
mkdir -p "$(dirname "$RELOC_CHECK")"
mv "$TMP_ENV" "$RELOC_CHECK"
# Load every package setup.R marks required, not just jsonlite/arrow — see
# vendor-r-runtime.sh for why the narrow check let a whole missing package set
# ship unnoticed.
if ! env -i HOME=/tmp PATH=/usr/bin:/bin "$RELOC_CHECK/bin/Rscript" -e \
  "for (p in c($REQUIRED_R)) library(p, character.only=TRUE); cat(jsonlite::toJSON(list(ok=TRUE)), \"\\n\")" | grep -q '"ok":\[true\]'; then
  echo "error: bundled Rscript failed relocatability self-check" >&2
  exit 1
fi
TMP_ENV="$RELOC_CHECK"

echo "[vendor-r-runtime] installing to $DEST ..."
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$TMP_ENV" "$DEST"
rmdir "$(dirname "$TMP_ENV")" 2>/dev/null || true

SIZE="$(du -sh "$DEST" | cut -f1)"
echo "[vendor-r-runtime] done. $DEST ($SIZE)"
echo "[vendor-r-runtime] electron-builder.json's mac.extraResources copies this to"
echo "                   resourcesPath/r-runtime in the packaged app."
