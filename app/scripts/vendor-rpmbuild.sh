#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# vendor-rpmbuild.sh — get a working `rpmbuild` on a Debian/Ubuntu dev box
# WITHOUT sudo/apt-get install, for machines where the operator can't type a
# root password into this session (e.g. driving Claude Code from a phone).
#
# `apt-get download` (unlike `apt-get install`) does not need root — it just
# fetches the .deb into cwd. This downloads rpm + its direct runtime deps,
# extracts them all with `dpkg-deb -x` (also no root) into one prefix, and
# verifies the result runs. Only missing deps not already satisfied by the
# system are downloaded (checked via `dpkg -l`).
#
# Usage: scripts/vendor-rpmbuild.sh
# Then:  source <(scripts/vendor-rpmbuild.sh --env)   # to load PATH/LD_LIBRARY_PATH
#        pnpm exec electron-builder --linux rpm
#
# This is a LOCAL DEV CONVENIENCE, not something to ship — a real Fedora/RHEL
# box or a properly `apt-get install rpm`'d CI image should just use its own
# system rpmbuild instead.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="$SCRIPT_DIR/../.rpmbuild-vendor"

if [ "${1:-}" = "--env" ]; then
  EXT="$PREFIX/extracted"
  echo "export PATH=\"$EXT/usr/bin:\$PATH\""
  echo "export LD_LIBRARY_PATH=\"$EXT/usr/lib/x86_64-linux-gnu\""
  echo "export RPM_CONFIGDIR=\"$EXT/usr/lib/rpm\""
  exit 0
fi

mkdir -p "$PREFIX/debs" "$PREFIX/extracted"
cd "$PREFIX/debs"

# Direct deps of Ubuntu's `rpm` package not already satisfied on this system.
# librpm9t64 et al. are versioned/renamed across Ubuntu releases (the t64
# suffix itself is a time_t transition artifact) — if this list 404s on a
# newer/older Ubuntu, `apt-cache depends rpm` will show the current names.
PACKAGES="rpm rpm-common librpm9t64 librpmbuild9t64 librpmio9t64 librpmsign9t64 debugedit rpm2cpio liblua5.3-0"

echo "[vendor-rpmbuild] downloading .debs (no sudo, apt-get download only)..."
apt-get download $PACKAGES 2>&1 | grep -v "^$" || true

echo "[vendor-rpmbuild] extracting (dpkg-deb -x, no install/no sudo)..."
for f in *.deb; do
  dpkg-deb -x "$f" "$PREFIX/extracted"
done

EXT="$PREFIX/extracted"
export PATH="$EXT/usr/bin:$PATH"
export LD_LIBRARY_PATH="$EXT/usr/lib/x86_64-linux-gnu"
export RPM_CONFIGDIR="$EXT/usr/lib/rpm"

echo "[vendor-rpmbuild] verifying..."
"$EXT/usr/bin/rpmbuild" --version

echo "[vendor-rpmbuild] done. To use in this shell:"
echo "  source <($SCRIPT_DIR/vendor-rpmbuild.sh --env)"
echo "  pnpm exec electron-builder --linux rpm"
