#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# vendor-r-runtime.sh — build a portable, self-contained R runtime and drop it
# into resources/r-runtime/ so electron-builder bundles it (extraResources in
# electron-builder.json) and r-bridge.ts's detectBundledR() picks it up at
# resources/r-runtime/bin/Rscript before ever looking at the system PATH.
#
# Why conda-forge: distro glibc/libgfortran/libreadline ABIs differ across
# Linux versions, so a plain `cp` of a system R breaks on other machines. The
# conda-forge R build is compiled against an old glibc baseline (like the
# manylinux approach) and ships its own libgfortran/libreadline/openblas/arrow
# etc. under lib/ with $ORIGIN-relative RPATHs — verified below to run with a
# completely empty environment after being moved to an arbitrary path, so no
# LD_LIBRARY_PATH juggling is needed at spawn time.
#
# What is vendored: every package in shared/r-packages.json "bundled" (every
# package any analysis uses, R's recommended set included) and "console"
# (ggplot2, readxl, lubridate for the R terminal). The installed app never
# downloads a package; there are no optional packages since 0.2.28. The rule
# of thumb: the bundled runtime must never be a weaker R than the "user
# installs R themselves" path, and a stock CRAN R already ships the
# recommended set.
#
# R version (SAI_R_VERSION, default 4.6.1 = what the Windows runtime ships):
#   4.6.x  conda-forge supplies r-base, the toolchain and the C/C++ libraries
#          (libarrow, openblas, ICU …), but NOT the R packages: conda-forge's R
#          4.6 migration is still pending (no r-arrow/r-ordinal/r-haven/
#          r-recommended for 4.6). The packages are compiled from source from
#          the same dated Posit snapshot the Windows runtime uses
#          (shared/r-packages.json runtime.cranSnapshot), so both platforms
#          carry identical package versions. The whole dependency tree is
#          requested and verified, as vendor-r-runtime-win.ps1 does.
#   4.3.x  the previous route, kept as a fallback: every package comes from
#          conda-forge (r-base=4.3 + r-recommended + r-*). Known to work.
#          Use it with: SAI_R_VERSION=4.3 pnpm vendor:r-runtime
#
# Usage: scripts/vendor-r-runtime.sh
# Requires: conda (or micromamba/mamba — edit CONDA_BIN below) on PATH and,
# for 4.6, network access to conda-forge and packagemanager.posit.co.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
DEST="$APP_DIR/resources/r-runtime"
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
    else if (field === "snapshot") console.log(m.runtime.cranSnapshot);
    else console.log(String(all.length));
  ' "$MANIFEST" "$1"
}
EXTRA_CONDA="$(_read_manifest conda)"
REQUIRED_R="$(_read_manifest rnames)"
CRAN_SNAPSHOT="$(_read_manifest snapshot)"
echo "[vendor-r-runtime] manifest: $(_read_manifest count) bundled packages"

SAI_R_VERSION="${SAI_R_VERSION:-4.6.1}"
case "$SAI_R_VERSION" in
  4.3*) R_ROUTE=conda; R_PIN="4.3" ;;
  4.6*) R_ROUTE=source; R_PIN="$SAI_R_VERSION" ;;
  *) echo "error: SAI_R_VERSION=$SAI_R_VERSION unsupported (use 4.6.x or 4.3)" >&2; exit 1 ;;
esac
echo "[vendor-r-runtime] R $SAI_R_VERSION ($R_ROUTE route)"

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
# r-recommended pulls R's own recommended package set (boot, class, cluster,
# codetools, foreign, KernSmooth, lattice, MASS, Matrix, mgcv, nlme, nnet,
# rpart, spatial, survival). Every stock CRAN/official R install ships these,
# but conda-forge's r-base does NOT — it packages them separately. Without it
# the bundled runtime was a strictly *weaker* R than "install R yourself":
# Bootstrap (boot), Survival (survival), Discriminant/Ordinal (MASS),
# Multinomial (nnet), Mixed Models (nlme), KNN (class) and Trees (rpart) all
# silently degraded or failed in the packaged app, and MASS had to be hand-
# dropped into the bundle as a loose CRAN binary to make Discriminant work.
# psych and nortest are not recommended packages but setup.R marks them
# required too (Factor Analysis KMO/Bartlett/Promax, Lilliefors-corrected K-S),
# so the bundle now covers setup.R's full `required` list.
if [ "$R_ROUTE" = conda ]; then
  "$CONDA_BIN" create -y -p "$TMP_ENV" -c conda-forge --override-channels \
    "r-base=$R_PIN" "r-recommended=$R_PIN" $EXTRA_CONDA "${BLAS_SPEC[@]}"
else
  # Toolchain + the C/C++ libraries the compiled R packages link against.
  # libarrow ships Parquet/Dataset/Acero/Substrait/Compute as SEPARATE conda
  # packages; arrow's configure fails on missing parquet/type_fwd.h without them.
  # They are pinned to the major version of the snapshot's R arrow: Arrow C++
  # breaks ABI every major release, and an unpinned env pulled libarrow 26 for
  # R arrow 25.0.1 (arrow.so: undefined symbol arrow::compute::Function).
  ARROW_MAJOR="$(curl -fsSL "$CRAN_SNAPSHOT/src/contrib/PACKAGES" |
    awk '/^Package: arrow$/ { f = 1 } f && !done && /^Version:/ { split($2, v, "."); print v[1]; done = 1 }')"
  [ -n "$ARROW_MAJOR" ] || { echo "error: no arrow version in $CRAN_SNAPSHOT/src/contrib/PACKAGES" >&2; exit 1; }
  echo "[vendor-r-runtime] libarrow pinned to $ARROW_MAJOR.* (R arrow in the snapshot)"
  ARROW_LIBS=()
  for lib in libarrow libparquet libarrow-dataset libarrow-acero libarrow-substrait libarrow-compute; do
    ARROW_LIBS+=("$lib=$ARROW_MAJOR.*")
  done
  "$CONDA_BIN" create -y -p "$TMP_ENV" -c conda-forge --override-channels \
    "r-base=$R_PIN" compilers pkg-config cmake make \
    "${ARROW_LIBS[@]}" \
    icu zlib libxml2 libcurl openssl libpng libjpeg-turbo freetype fontconfig \
    "${BLAS_SPEC[@]}"

  echo "[vendor-r-runtime] building R packages from the $CRAN_SNAPSHOT snapshot..."
  # A CLEAN environment (env -i) is mandatory: with another conda env active in
  # the calling shell (e.g. base anaconda3), its include/ ends up on the compile
  # path and an OLD libarrow's headers shadow the right ones — arrow then fails
  # with "ChunkResolver does not name a type". Only the build env is visible.
  BUILD_HOME="$(mktemp -d)"
  NCPU="$(nproc 2>/dev/null || echo 2)"
  build_env() {
    env -i HOME="$BUILD_HOME" PATH="$TMP_ENV/bin:/usr/bin:/bin" \
      PKG_CONFIG_PATH="$TMP_ENV/lib/pkgconfig" LIBARROW_BINARY=false \
      ARROW_USE_PKG_CONFIG=true R_LIBS_USER= MAKEFLAGS="-j$NCPU" "$@"
  }
  # conda-forge has no r-recommended for 4.6: R's own recommended set comes from
  # CRAN too (every stock R ships it; the bundle must never be weaker).
  RECOMMENDED_R='"boot","class","cluster","codetools","foreign","KernSmooth","lattice","MASS","Matrix","mgcv","nlme","nnet","rpart","spatial","survival"'
  # Installed into the site library inside the runtime, so everything lives in
  # one place (lib/R/library) like the Windows runtime — no R_LIBS needed.
  # The WHOLE dependency tree is requested and checked, up to three rounds: a
  # dependency whose build failed is otherwise skipped silently (on Windows
  # `stringi`, a BayesFactor dependency, went missing exactly that way).
  build_env "$TMP_ENV/bin/Rscript" -e "
    options(repos = c(CRAN = '$CRAN_SNAPSHOT'), Ncpus = $NCPU)
    lib <- file.path(R.home(), 'library')
    pk <- unique(c($REQUIRED_R, $RECOMMENDED_R))
    ap <- available.packages(type = 'source')
    deps <- unlist(tools::package_dependencies(pk, db = ap, recursive = TRUE,
      which = c('Depends', 'Imports', 'LinkingTo')))
    want <- setdiff(unique(c(pk, deps)), rownames(installed.packages(priority = 'base')))
    for (round in 1:3) {
      missing <- setdiff(want, rownames(installed.packages(lib.loc = lib)))
      if (!length(missing)) break
      cat('round', round, ': installing', length(missing), 'packages\n')
      install.packages(missing, lib = lib, type = 'source',
        dependencies = c('Depends', 'Imports', 'LinkingTo'))
    }
    missing <- setdiff(want, rownames(installed.packages(lib.loc = lib)))
    if (length(missing)) stop('packages missing after 3 rounds: ', paste(missing, collapse = ', '))
    cat('installed', length(want), 'packages (incl. dependencies)\n')
  "
  rm -rf "$BUILD_HOME"
fi

echo "[vendor-r-runtime] pruning build-only toolchain (compiler, headers, docs)..."
rm -rf \
  "$TMP_ENV/x86_64-conda-linux-gnu" \
  "$TMP_ENV/libexec" \
  "$TMP_ENV/include" \
  "$TMP_ENV/lib/gcc" \
  "$TMP_ENV/share/python_compiler_compat" \
  "$TMP_ENV/lib/cmake" \
  "$TMP_ENV/lib/pkgconfig" \
  "$TMP_ENV/share/pkgconfig" \
  "$TMP_ENV"/share/cmake* \
  "$TMP_ENV"/bin/cmake "$TMP_ENV"/bin/ctest "$TMP_ENV"/bin/cpack "$TMP_ENV"/bin/ccmake \
  "$TMP_ENV"/bin/make "$TMP_ENV"/bin/pkg-config \
  "$TMP_ENV"/share/gcc-* \
  "$TMP_ENV/share/man" \
  "$TMP_ENV/share/info" \
  "$TMP_ENV/share/doc" \
  "$TMP_ENV/share/gir-1.0" \
  "$TMP_ENV/share/locale" \
  "$TMP_ENV/share/X11" \
  "$TMP_ENV/share/glib-2.0" \
  "$TMP_ENV/share/grpc" \
  "$TMP_ENV/conda-meta" \
  "$TMP_ENV/pkgs" 2>/dev/null || true
rm -f "$TMP_ENV"/bin/x86_64-conda-linux-gnu-* 2>/dev/null || true
# Unprefixed compiler names are symlinks to the prefixed ones removed above.
(cd "$TMP_ENV/bin" && rm -f cc c++ cpp gcc g++ gfortran gcc-ar gcc-nm gcc-ranlib gcov gcov-dump gcov-tool) 2>/dev/null || true
# Static archives are link-time only (the shared libs are what runs).
find "$TMP_ENV/lib" -maxdepth 2 -name '*.a' -delete 2>/dev/null || true

# Pruning a directory can leave dangling symlinks elsewhere pointing into it
# (e.g. etc/fonts/conf.d/*.conf -> ../../../share/fontconfig/conf.avail/*.conf
# broke this way once before, when share/fontconfig was on the prune list —
# .deb tolerates broken symlinks silently, rpmbuild's %files check does not
# and fails the whole build). Fail loudly here instead of shipping a broken
# runtime or re-discovering it later as an opaque rpmbuild error.
dangling="$(find "$TMP_ENV" -xtype l 2>/dev/null)"
if [ -n "$dangling" ]; then
  echo "error: pruning left dangling symlinks (fix the rm -rf list above):" >&2
  echo "$dangling" >&2
  exit 1
fi

echo "[vendor-r-runtime] patching hardcoded build-time paths for relocatability..."
# conda-forge's r-base is built with an absolute --prefix baked into its
# launcher scripts/binaries. Two places break once this env is copied
# elsewhere (electron-builder -> /opt/... for .deb, or a per-run random
# AppImage mount point):
#
# 1. lib/R/bin/R (plain shell script) hardcodes R_HOME_DIR/R_SHARE_DIR/
#    R_INCLUDE_DIR/R_DOC_DIR/SED as this exact $TMP_ENV path. This script is
#    what R.home("bin") + system()-based install.packages()/R CMD calls
#    invoke from *inside* a running R session, so it must resolve itself
#    dynamically or on-demand package installs silently break post-move.
sed -i \
  -e "s#^R_HOME_DIR=${TMP_ENV}/lib/R\$#R_HOME_DIR=\"\$(cd \"\$(dirname \"\$0\")/..\" \&\& pwd)\"#" \
  -e "s#^R_SHARE_DIR=${TMP_ENV}/lib/R/share\$#R_SHARE_DIR=\"\${R_HOME_DIR}/share\"#" \
  -e "s#^R_INCLUDE_DIR=${TMP_ENV}/lib/R/include\$#R_INCLUDE_DIR=\"\${R_HOME_DIR}/include\"#" \
  -e "s#^R_DOC_DIR=${TMP_ENV}/lib/R/doc\$#R_DOC_DIR=\"\${R_HOME_DIR}/doc\"#" \
  -e "s#^SED=${TMP_ENV}/bin/sed\$#SED=sed#" \
  "$TMP_ENV/lib/R/bin/R"

# 2. bin/Rscript (and lib/R/bin/Rscript) is a *compiled* ELF that hardcodes
#    the same absolute prefix as the path to execve() into (lib/R/bin/R) —
#    unlike lib/R/bin/exec/R, whose RPATH is genuinely $ORIGIN-relative, this
#    one has no env-var escape hatch (R_HOME is ignored) and just fails with
#    ENOENT once moved. r-bridge.ts/r-session.ts only ever invoke top-level
#    bin/Rscript, so replace just that one with a POSIX wrapper that
#    computes R_HOME from its own location and execs the real engine
#    directly (lib/R/bin/exec/R), translating Rscript's `file args...`
#    convention into R's `--file=... --args ...` the same way real Rscript
#    does (verified against system R's strace output).
cat > "$TMP_ENV/bin/Rscript" <<'RSCRIPT_WRAPPER'
#!/bin/bash
set -e
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export R_HOME="$SELF_DIR/../lib/R"
export R_SHARE_DIR="$R_HOME/share"
export R_INCLUDE_DIR="$R_HOME/include"
export R_DOC_DIR="$R_HOME/doc"
export LD_LIBRARY_PATH="$SELF_DIR/../lib:$R_HOME/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

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
# .deb install layout ("/opt/SAI Statistics/resources/r-runtime") — proves
# nothing depends on the original conda-create prefix still existing.
RELOC_CHECK="$(mktemp -d)/moved dir/r-runtime"
mkdir -p "$(dirname "$RELOC_CHECK")"
mv "$TMP_ENV" "$RELOC_CHECK"
# Load every package setup.R marks required, not just jsonlite/arrow: the
# bundle now claims to cover that whole list, and a package that quietly
# failed to make it in would otherwise ship unnoticed and only surface as a
# degraded analysis in the installed app (how the missing recommended set went
# undetected for so long).
if ! env -i HOME=/tmp PATH=/usr/bin:/bin "$RELOC_CHECK/bin/Rscript" -e \
  "for (p in c($REQUIRED_R)) library(p, character.only=TRUE); cat(jsonlite::toJSON(list(ok=TRUE)), \"\\n\")" | grep -q '"ok":\[true\]'; then
  echo "error: bundled Rscript failed relocatability self-check" >&2
  exit 1
fi

# Packages compiled here carry an absolute RPATH to the build prefix, which is
# gone after the move. The wrapper's LD_LIBRARY_PATH (bin/../lib, lib/R/lib) is
# what makes them load — so resolve every shared object exactly as the wrapper
# would, and fail on anything that is not found (a library that slipped out of
# the bundle would otherwise fail only on a machine that lacks it).
if [ "$R_ROUTE" = source ]; then
  echo "[vendor-r-runtime] checking every shared object resolves its libraries..."
  unresolved="$(find "$RELOC_CHECK/lib/R/library" -name '*.so' -print0 |
    LD_LIBRARY_PATH="$RELOC_CHECK/lib:$RELOC_CHECK/lib/R/lib" xargs -0 -n1 ldd 2>/dev/null |
    { grep 'not found' || true; } | sort -u)"
  if [ -n "$unresolved" ]; then
    echo "error: R package libraries with unresolved shared libraries:" >&2
    echo "$unresolved" >&2
    exit 1
  fi
fi
TMP_ENV="$RELOC_CHECK"

echo "[vendor-r-runtime] installing to $DEST ..."
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$TMP_ENV" "$DEST"
rmdir "$(dirname "$TMP_ENV")" 2>/dev/null || true

SIZE="$(du -sh "$DEST" | cut -f1)"
echo "[vendor-r-runtime] done. $DEST ($SIZE)"
echo "[vendor-r-runtime] electron-builder.json's extraResources copies this to"
echo "                   resourcesPath/r-runtime in the packaged app."
