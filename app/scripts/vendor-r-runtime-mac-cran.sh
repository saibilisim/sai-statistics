#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# vendor-r-runtime-mac-cran.sh — macOS runtime from CRAN's own R, the way
# vendor-r-runtime-win.ps1 builds the Windows one: CRAN's R (version, installer
# URL and SHA256 in shared/r-packages.json runtime.macosR / macosInstallers) and
# every bundled package as a binary from the same dated Posit snapshot
# (runtime.cranSnapshot), so macOS ships the R the validation and SPSS parity
# suites were run against on Windows and Linux.
#
# STATUS (2026-10-24): written on Windows from the Windows script and CRAN's
# installer layout; NOT yet run on macOS. .github/workflows/macos-runtime.yml
# runs it on GitHub's arm64 and Intel macOS runners and then the r-validation
# suite with the result. Until that passes, vendor-r-runtime-mac.sh keeps the
# conda-forge R 4.3 route as its default; this one runs with
#   SAI_R_VERSION=4.6.1 pnpm vendor:r-runtime:mac
#
# What it does:
#   1. downloads CRAN's .pkg for this Mac's CPU (cached in tmp/r-installers,
#      checksum-pinned) and unpacks it with pkgutil — nothing is installed and
#      no administrator rights are needed;
#   2. copies R.framework/Versions/<ver>/Resources (R_HOME) to a staging dir;
#   3. relocates it: CRAN's R expects to live at /Library/Frameworks/R.framework,
#      and every binary names libR.dylib & co. by that absolute path. Each Mach-O
#      file is rewritten to @rpath with an @loader_path-relative LC_RPATH and
#      re-signed ad hoc (arm64 refuses to run a binary whose signature was
#      invalidated). DYLD_* variables are no substitute: hardened-runtime
#      binaries ignore them, and a user with their own R installed would have
#      the wrong libR picked up at that absolute path;
#   4. replaces bin/Rscript (a compiled launcher with R_HOME baked in) with a
#      wrapper that sets R_HOME from its own location, as the conda route does;
#   5. installs the bundled + console packages from the snapshot into the
#      runtime's own library, rewrites their .so files the same way, prunes;
#   6. moves the result to a path with a space and loads every package from a
#      completely empty environment (relocatability self-check), and refuses to
#      finish if any Mach-O file still points into /Library/Frameworks.
#
# Env: SAI_R_ARCH   arm64 | x86_64 (default: this Mac's CPU)
#      SAI_R_DEST   build somewhere else (default resources/r-runtime-mac)
# Official builds re-sign the runtime with SAI Bilişim's Developer ID before
# packaging (release process, not in this repository).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
DEST="${SAI_R_DEST:-$APP_DIR/resources/r-runtime-mac}"

[ "$(uname -s)" = "Darwin" ] || { echo "error: run this on macOS (pkgutil, otool, install_name_tool, codesign)" >&2; exit 1; }
for tool in pkgutil otool install_name_tool codesign shasum curl node; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: '$tool' not found (Xcode Command Line Tools: xcode-select --install)" >&2; exit 1; }
done

ARCH="${SAI_R_ARCH:-$(uname -m)}"
case "$ARCH" in arm64 | x86_64) ;; *) echo "error: unsupported arch '$ARCH' (arm64 or x86_64)" >&2; exit 1 ;; esac

# Everything comes from shared/r-packages.json — the single source of truth the
# app, setup.R and the other vendor scripts read. The path goes in as argv, not
# interpolated into the JS source.
MANIFEST="$APP_DIR/shared/r-packages.json"
[ -f "$MANIFEST" ] || { echo "error: $MANIFEST not found" >&2; exit 1; }
_read_manifest() {
  node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const field = process.argv[2], arch = process.argv[3];
    // "console" packages (ggplot2, readxl …) are vendored too, for the R terminal.
    const all = [...m.bundled, ...m.console.packages];
    const inst = (m.runtime.macosInstallers || {})[arch] || {};
    if (field === "version") console.log(m.runtime.macosR);
    else if (field === "url") console.log(inst.url || "");
    else if (field === "sha256") console.log((inst.sha256 || "").toLowerCase());
    else if (field === "snapshot") console.log(m.runtime.cranSnapshot);
    else if (field === "extra") console.log(all.filter(p => !p.recommended).map(p => JSON.stringify(p.r)).join(","));
    else if (field === "rnames") console.log(all.map(p => JSON.stringify(p.r)).join(","));
    else console.log(String(all.length));
  ' "$MANIFEST" "$1" "$ARCH"
}
R_VERSION="$(_read_manifest version)"
URL="$(_read_manifest url)"
SHA256="$(_read_manifest sha256)"
SNAPSHOT="$(_read_manifest snapshot)"
EXTRA_R="$(_read_manifest extra)"
REQUIRED_R="$(_read_manifest rnames)"
[ -n "$URL" ] && [ -n "$SHA256" ] || { echo "error: no macosInstallers.$ARCH in $MANIFEST" >&2; exit 1; }
echo "[vendor-r-runtime] R $R_VERSION ($ARCH, CRAN) + $(_read_manifest count) packages from $SNAPSHOT"

# ── 1. Installer: cached, checksum-pinned ─────────────────────────────────────
CACHE="$APP_DIR/tmp/r-installers"
mkdir -p "$CACHE"
PKG="$CACHE/R-$R_VERSION-$ARCH.pkg"
if [ ! -f "$PKG" ]; then
  # The current release lives under base/, earlier ones under base/old/<ver>/.
  for u in "$URL" "${URL/\/base\//\/base\/old\/$R_VERSION\/}"; do
    echo "[vendor-r-runtime] downloading $u"
    if curl -fsSL -o "$PKG.part" "$u"; then mv "$PKG.part" "$PKG"; break; fi
    rm -f "$PKG.part"
  done
  [ -f "$PKG" ] || { echo "error: R $R_VERSION installer could not be downloaded" >&2; exit 1; }
fi
ACTUAL="$(shasum -a 256 "$PKG" | cut -d' ' -f1)"
if [ "$ACTUAL" != "$SHA256" ]; then
  rm -f "$PKG"
  echo "error: R installer checksum mismatch (expected $SHA256, got $ACTUAL) - refusing to build" >&2
  exit 1
fi

# ── 2. Unpack (no install) and stage R_HOME ───────────────────────────────────
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "[vendor-r-runtime] unpacking $(basename "$PKG") ..."
pkgutil --expand-full "$PKG" "$WORK/pkg"
FW_RES=""
for d in "$WORK"/pkg/R-fw.pkg/Payload/R.framework/Versions/*/Resources; do
  case "$d" in */Current/Resources) continue ;; esac
  [ -d "$d" ] && FW_RES="$d" && break
done
[ -n "$FW_RES" ] || { echo "error: R.framework/Versions/<ver>/Resources not found in the installer" >&2; exit 1; }
echo "[vendor-r-runtime] R_HOME in the installer: ${FW_RES#"$WORK/pkg/R-fw.pkg/Payload/"}"
STAGE="$WORK/r-runtime"
cp -R "$FW_RES" "$STAGE"
# A symlink pointing outside the runtime would dangle once it is moved. CRAN's
# fontconfig/fonts/conf.d links point at conf.avail by absolute framework path;
# any link into R_HOME is rewritten as a relative one, anything else is fatal.
find "$STAGE" -type l -lname '/*' -print | while IFS= read -r link; do
  target="$(readlink "$link")"
  rel="$(printf '%s\n' "$target" | sed -E 's#^/Library/Frameworks/R\.framework/(Versions/[^/]+/)?Resources/##')"
  if [ "$rel" != "$target" ] && [ -e "$STAGE/$rel" ]; then
    ln -sfn "$(node -e 'const p=require("path"); console.log(p.relative(p.dirname(process.argv[1]), process.argv[2]))' "$link" "$STAGE/$rel")" "$link"
  fi
done
OUTSIDE="$(find "$STAGE" -type l -lname '/*' -exec sh -c 'printf "%s -> %s\n" "$1" "$(readlink "$1")"' _ {} \;)"
[ -z "$OUTSIDE" ] || { echo "error: absolute symlinks in the runtime:" >&2; echo "$OUTSIDE" >&2; exit 1; }
DANGLING="$(find "$STAGE" -type l ! -exec test -e {} \; -print)"
[ -z "$DANGLING" ] || { echo "error: dangling symlinks in the runtime:" >&2; echo "$DANGLING" >&2; exit 1; }

# The prefix every CRAN binary uses for its own libraries, read from libR.dylib.
OLD_PREFIX="$(otool -D "$STAGE/lib/libR.dylib" | tail -n 1)"
OLD_PREFIX="${OLD_PREFIX%/lib/libR.dylib}"
case "$OLD_PREFIX" in /Library/Frameworks/R.framework/*) ;; *) echo "error: unexpected libR.dylib install name: $OLD_PREFIX" >&2; exit 1 ;; esac
echo "[vendor-r-runtime] relocating binaries away from $OLD_PREFIX"

# ── 3. Relocation: @rpath + @loader_path, ad hoc re-sign ──────────────────────
is_macho() { file -b "$1" | grep -q 'Mach-O'; }
# @loader_path/<../ per directory level>lib — the runtime's lib/ seen from $1.
rpath_for() {
  local rel="${1#"$STAGE"/}" up="" d
  d="$(dirname "$rel")"
  while [ "$d" != "." ]; do up="../$up"; d="$(dirname "$d")"; done
  echo "@loader_path/${up}lib"
}
relocate() { # $1 = directory to scan
  local f dep changed
  while IFS= read -r -d '' f; do
    is_macho "$f" || continue
    changed=0
    # Mach-O lists its dependencies after the first line (otool -L), and for a
    # dylib the first entry is its own id.
    # Any R.framework version path, not only $OLD_PREFIX: a package binary may
    # have been linked against .../Versions/4.6/... rather than 4.6-arm64.
    while IFS= read -r dep; do
      case "$dep" in
        /Library/Frameworks/R.framework/*/lib/*) install_name_tool -change "$dep" "@rpath/${dep##*/}" "$f" 2>/dev/null; changed=1 ;;
      esac
    done < <(otool -L "$f" | tail -n +2 | awk '{print $1}')
    case "$(otool -D "$f" | tail -n 1)" in
      /Library/Frameworks/R.framework/*/lib/*) install_name_tool -id "@rpath/$(basename "$f")" "$f" 2>/dev/null; changed=1 ;;
    esac
    if [ "$changed" = 1 ]; then
      local rp
      rp="$(rpath_for "$f")"
      otool -l "$f" | grep -q "path $rp " || install_name_tool -add_rpath "$rp" "$f" 2>/dev/null
      codesign --force --sign - "$f" 2>/dev/null
    fi
  done < <(find "$1" -type f \( -name '*.dylib' -o -name '*.so' -o -perm -u+x \) -print0)
}
relocate "$STAGE"

# bin/R (a shell script) hardcodes R_HOME_DIR; resolve it from its own place.
sed -i '' \
  -e 's#^R_HOME_DIR=.*$#R_HOME_DIR="$(cd "$(dirname "$0")/.." \&\& pwd)"#' \
  -e 's#^R_SHARE_DIR=.*$#R_SHARE_DIR="${R_HOME_DIR}/share"#' \
  -e 's#^R_INCLUDE_DIR=.*$#R_INCLUDE_DIR="${R_HOME_DIR}/include"#' \
  -e 's#^R_DOC_DIR=.*$#R_DOC_DIR="${R_HOME_DIR}/doc"#' \
  "$STAGE/bin/R"

# bin/Rscript: CRAN's is a compiled launcher with R_HOME baked in. The app
# (r-bridge.ts) runs <runtime>/bin/Rscript, so it becomes the same wrapper the
# conda route uses — here R_HOME is the runtime root itself (CRAN layout).
rm -f "$STAGE/bin/Rscript"
cat > "$STAGE/bin/Rscript" <<'RSCRIPT_WRAPPER'
#!/bin/bash
set -e
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export R_HOME="$(cd "$SELF_DIR/.." && pwd)"
export R_SHARE_DIR="$R_HOME/share"
export R_INCLUDE_DIR="$R_HOME/include"
export R_DOC_DIR="$R_HOME/doc"

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
chmod +x "$STAGE/bin/Rscript"

# A clean environment for every R call below: no personal library, nothing from
# this machine's own R setup.
EMPTY_HOME="$WORK/home"
mkdir -p "$EMPTY_HOME"
run_r() { # $1 = runtime root, $2 = R code
  env -i HOME="$EMPTY_HOME" PATH=/usr/bin:/bin R_LIBS= R_LIBS_USER=/dev/null/no-user-library \
    "$1/bin/Rscript" --vanilla -e "$2"
}

# ── 4. Bundled packages from the dated snapshot ───────────────────────────────
echo "[vendor-r-runtime] installing bundled packages (binary, $SNAPSHOT) ..."
# The WHOLE dependency tree is requested and checked, up to three rounds (a
# dependency whose download failed is otherwise skipped silently while its
# parent still installs — stringi under BayesFactor on Windows, 2026-10-11).
OUT="$(run_r "$STAGE" "options(repos = c(CRAN = '$SNAPSHOT')); \
  cat('pkgType:', .Platform\$pkgType, '\n'); \
  pk <- c($EXTRA_R); ap <- available.packages(type = 'binary'); \
  deps <- unlist(tools::package_dependencies(pk, db = ap, recursive = TRUE, which = c('Depends','Imports','LinkingTo'))); \
  want <- setdiff(unique(c(pk, deps)), rownames(installed.packages(priority = 'base'))); \
  for (i in 1:3) { need <- setdiff(want, rownames(installed.packages(.Library))); if (!length(need)) break; \
    install.packages(need, lib = .Library, type = 'binary', quiet = TRUE) }; \
  miss <- setdiff(want, rownames(installed.packages(.Library))); \
  if (length(miss)) { cat('MISSING:', miss, '\n'); quit(status = 1) }; cat('OK_INSTALL', length(want), '\n')" 2>&1)" || true
echo "$OUT" | grep -E 'pkgType:|MISSING:|OK_INSTALL|rror' | head -20
echo "$OUT" | grep -q OK_INSTALL || { echo "error: package install failed:" >&2; echo "$OUT" | tail -40 >&2; exit 1; }
relocate "$STAGE/library"

# ── 5. Prune what a runtime never reads ───────────────────────────────────────
# PDF manuals and package test suites; help pages stay (the R console's ?topic).
rm -rf "$STAGE/doc/manual"
find "$STAGE/library" -mindepth 2 -maxdepth 2 -type d -name tests -exec rm -rf {} +

# A record of exactly what shipped (Help ▸ Report Issue / support questions).
run_r "$STAGE" "ip <- installed.packages(.Library); \
  cat(jsonlite::toJSON(list(r = as.character(getRversion()), arch = R.version\$arch, snapshot = '$SNAPSHOT', \
  packages = as.list(setNames(ip[, 'Version'], rownames(ip)))), auto_unbox = TRUE, pretty = TRUE))" \
  > "$STAGE/sai-runtime.json"

# ── 6. Self-checks ────────────────────────────────────────────────────────────
# Nothing may still point into /Library/Frameworks/R.framework: on a machine
# without R it fails to load, on one with another R it loads the wrong libR.
# /opt/X11 (XQuartz, the X11 device) and /opt/R (CRAN's separate Tcl/Tk) are
# optional system add-ons R itself loads lazily; they are listed, not fatal.
echo "[vendor-r-runtime] checking for leftover absolute library paths ..."
LEFT=""
OPTIONAL=""
while IFS= read -r -d '' f; do
  is_macho "$f" || continue
  while IFS= read -r dep; do
    case "$dep" in
      /usr/lib/* | /System/*) ;;
      /Library/Frameworks/R.framework/*) LEFT="$LEFT
  ${f#"$STAGE"/} -> $dep" ;;
      /opt/X11/* | /opt/R/*) OPTIONAL="$OPTIONAL
  ${f#"$STAGE"/} -> $dep" ;;
    esac
  done < <(otool -L "$f" | tail -n +2 | awk '{print $1}')
done < <(find "$STAGE" -type f \( -name '*.dylib' -o -name '*.so' -o -perm -u+x \) -print0)
[ -z "$OPTIONAL" ] || echo "[vendor-r-runtime] optional system libraries (loaded only if present):$OPTIONAL"
[ -z "$LEFT" ] || { echo "error: binaries still reference the system R framework:$LEFT" >&2; exit 1; }

# Move (not copy) to a path with a space, mimicking the .app bundle
# ("/Applications/SAI Statistics.app/Contents/Resources"), and load every
# bundled package from a completely empty environment.
echo "[vendor-r-runtime] verifying the runtime is relocatable ..."
RELOC_PARENT="$WORK/moved dir"
mkdir -p "$RELOC_PARENT"
mv "$STAGE" "$RELOC_PARENT/r-runtime"
RELOC="$RELOC_PARENT/r-runtime"
CHECK="$(run_r "$RELOC" "for (p in c($REQUIRED_R)) library(p, character.only = TRUE); \
  stopifnot(startsWith(normalizePath(R.home()), normalizePath('$RELOC'))); cat('OK_CHECK', '\n')" 2>&1)" || true
echo "$CHECK" | grep -q OK_CHECK || { echo "error: bundled Rscript failed relocatability self-check:" >&2; echo "$CHECK" | tail -30 >&2; exit 1; }

echo "[vendor-r-runtime] installing to $DEST ..."
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$RELOC" "$DEST"

echo "[vendor-r-runtime] done. $DEST ($(du -sh "$DEST" | cut -f1))"
echo "[vendor-r-runtime] note: binaries are signed ad hoc; official builds re-sign them with the Developer ID before packaging"
