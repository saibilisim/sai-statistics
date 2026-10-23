#!/bin/sh
# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# Starts the bundled app under zypak so Chromium's own sandbox keeps working inside
# the Flatpak sandbox (no --no-sandbox).
export TMPDIR="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"
export GTK_USE_PORTAL=1
mkdir -p "$TMPDIR"
exec zypak-wrapper /app/sai-statistics/sai-statistics "$@"
