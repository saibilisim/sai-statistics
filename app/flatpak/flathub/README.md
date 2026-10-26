# Flathub submission — com.saibilisim.saistatistics

Folder with the five files of the Flathub submission (manifest, desktop file, MetaInfo,
icon, launcher). Rules: https://docs.flathub.org/docs/for-app-authors/requirements

## Status

The first submission (flathub/flathub#10667, 2026-10-16) was closed automatically by the
submission checker (checklist incomplete) and later labelled "AI Slop" by a reviewer.
Reasons that still apply:

- **Generative AI policy:** Flathub manifests must not contain AI-generated or AI-assisted
  content, and disclosure does not exempt them. Other packaging material (MetaInfo, desktop
  file, launcher) is judged at the reviewers' discretion. AI tools must not open the PR or
  write its description, commit messages or replies. So these files, the PR and every
  reply in it must be written by a human.
- **extra-data:** the current manifest repackages the official .deb. The app is AGPL
  now, and Flathub requires source-available apps to be built entirely from source with
  no binaries in the PR. Expect the reviewers to ask for a from-source manifest.

Until a human-written submission is ready, this folder is only a working copy. The
self-contained .flatpak published on the vendor's site (`app/flatpak/*.yml`) is
unaffected.

## Per release

1. Build the .deb (`pnpm build && pnpm exec electron-builder --linux deb`) and publish
   it at a **stable public https URL** (a versioned file name, never overwritten).
2. `node flatpak/flathub/update-manifest.cjs <deb> <https-url>` → fills url/sha256/size.
3. Bump `<release>` in the MetaInfo.
   `StartupWMClass` in the desktop file must equal the running window's class
   (`xprop WM_CLASS`, click the window) — currently `sai-statistics`.
4. Lint (the linter runs in a Flatpak and cannot see /tmp — copy under $HOME):
   `flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest com.saibilisim.saistatistics.yml`
   `flatpak run --command=flatpak-builder-lint org.flatpak.Builder appstream com.saibilisim.saistatistics.metainfo.xml`

## Local test

    python3 -m http.server 8765 --directory <dir-containing-the-deb> &
    node flatpak/flathub/update-manifest.cjs <deb> http://127.0.0.1:8765/<deb-name>   # on a COPY
    flatpak run org.flatpak.Builder --user --install --force-clean build-dir <copy>/com.saibilisim.saistatistics.yml
    flatpak run com.saibilisim.saistatistics

## First submission (needs the vendor's GitHub account)

`flatpak/flathub/prepare-submission.sh [github-user] [dir]` clones your fork's `new-pr`,
creates the branch and commits the 5 submission files — it stops before `git push` and the PR
(Flathub's template requires the PR itself not to be AI-generated/automated).

- Domain proof: serve `/.well-known/org.flathub.VerifiedApps.txt` on saibilisim.com
  (token shown in the Flathub developer portal after the app is accepted).
- Fork flathub/flathub (uncheck "copy master only"), branch from `new-pr`, add these
  files at the repo root, open a PR against `new-pr` titled
  "Add com.saibilisim.saistatistics"; comment `bot, build` once reviewers are happy.
- Screenshots: `node scripts/flathub-screenshots.cjs` (English UI, 1280x800), hosted at
  https://api.saistatistics.com/downloads/flathub/ and referenced from the MetaInfo.
