# Flathub submission — com.saibilisim.saistatistics

Folder with the submission files for Flathub (`com.saibilisim.saistatistics`):
- `com.saibilisim.saistatistics.yml`: Flatpak manifest
- `com.saibilisim.saistatistics.desktop`: Desktop entry file
- `com.saibilisim.saistatistics.metainfo.xml`: AppStream metadata file
- `icon-512.png`: 512x512 application icon
- `sai-statistics.sh`: Application launcher script (runs under zypak)
- `update-manifest.cjs`: Script to update deb url & sha256 in the manifest
- `prepare-submission.sh`: Script to prepare local git branch for Flathub PR

Flathub guidelines: https://docs.flathub.org/docs/for-app-authors/requirements

## Open Source Status & Licensing

- **Project License:** AGPL-3.0-only (open source, redistributable)
- **Metadata License:** CC0-1.0
- **Source repository:** https://github.com/saibilisim/sai-statistics
- **Packaging route:** As an open source application with a complex native stack (Electron + DuckDB native bindings + bundled R runtime with 50+ CRAN packages), the manifest packages the official signed release package (`type: file`) extracted at build time directly into `/app/sai-statistics`. Because the software is open source and freely redistributable, proprietary-only `extra-data` (which forces client-side downloading at installation time) is not needed.

## Per release workflow

1. Build the official release `.deb` (`pnpm build && pnpm exec electron-builder --linux deb`) and publish it at a stable public HTTPS URL (a versioned filename, never overwritten).
2. Update manifest with the release URL and hash:
   ```bash
   node update-manifest.cjs <path-to.deb> <https-url-to-deb>
   ```
3. Update `<release>` version and date in `com.saibilisim.saistatistics.metainfo.xml`.
4. Ensure `StartupWMClass` in `com.saibilisim.saistatistics.desktop` matches the running window class (`sai-statistics`).
5. Run linters:
   ```bash
   flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest com.saibilisim.saistatistics.yml
   flatpak run --command=flatpak-builder-lint org.flatpak.Builder appstream com.saibilisim.saistatistics.metainfo.xml
   ```

## Local test

Test the build locally before submitting:

```bash
# Serve local .deb over HTTP for local test
python3 -m http.server 8765 --directory dist &

# Update manifest on a copy with local URL
node update-manifest.cjs dist/sai-statistics_0.2.38_amd64.deb http://127.0.0.1:8765/sai-statistics_0.2.38_amd64.deb

# Build and install locally
flatpak run org.flatpak.Builder --user --install --force-clean build-dir com.saibilisim.saistatistics.yml

# Run the app
flatpak run com.saibilisim.saistatistics
```

## Flathub PR Submission

Use `prepare-submission.sh` to stage the commit locally:

```bash
./prepare-submission.sh <github-user> [target-dir]
```

This clones your fork of `flathub/flathub` (branch `new-pr`), copies the submission files, and creates a commit.

### Flathub PR Requirements:
- **Human submission:** The PR description, checklists, and all review conversations on Flathub must be written directly by the maintainer. Fill in all checklist items in Flathub's PR template.
- **Domain verification:** After initial acceptance, add verification token to `https://saibilisim.com/.well-known/org.flathub.VerifiedApps.txt` or configure GitHub organization verification.
- **Screenshots:** Screenshots are served via HTTPS at 1280x800 and referenced in `com.saibilisim.saistatistics.metainfo.xml`.
