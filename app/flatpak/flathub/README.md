# Flathub submission — com.saibilisim.saistatistics

Repackages the official .deb through `extra-data` (the user's Flatpak downloads the
vendor's .deb and unpacks it with `apply_extra`). The Flathub PR contains only the files
in this folder (no binaries). `extra-data` was chosen while the app was closed-source; it
is AGPL-3.0-only now, so Flathub may ask for a regular `file` source or a build from
source instead. Rules: https://docs.flathub.org/docs/for-app-authors/requirements

## Per release

1. Build the .deb (`pnpm build && pnpm exec electron-builder --linux deb`) and publish
   it at a **stable public https URL** (a versioned file name, never overwritten).
2. `node flatpak/flathub/update-manifest.cjs <deb> <https-url>` → fills url/sha256/size.
3. Bump `<release>` in the MetaInfo.
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
