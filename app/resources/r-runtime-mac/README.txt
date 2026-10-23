Place the vendored macOS R runtime here (contents of this directory become
resources/r-runtime inside the packaged app).

Build it ON macOS with:

    pnpm vendor:r-runtime:mac

(scripts/vendor-r-runtime-mac.sh — requires conda/micromamba on PATH)

If this directory only contains this README at packaging time, the DMG ships
without a bundled R and the app falls back to a system R on PATH.
