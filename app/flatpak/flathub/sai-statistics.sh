#!/bin/sh
export TMPDIR="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"
export GTK_USE_PORTAL=1
mkdir -p "$TMPDIR"
exec zypak-wrapper /app/extra/sai-statistics/sai-statistics "$@"
