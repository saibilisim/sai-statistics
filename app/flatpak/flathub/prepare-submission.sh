#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# Prepares the Flathub submission branch LOCALLY (clone of your fork, new branch, the
# five submission files, one commit). It deliberately stops before `git push` and the
# PR: Flathub's PR template asks the submitter to confirm the PR was not generated or
# automated by AI tools, so opening it is a manual step (commands are printed below).
#
# Usage:  flatpak/flathub/prepare-submission.sh [github-user] [target-dir]
#   github-user  owner of the flathub/flathub fork (default: the `gh` login)
#   target-dir   where to clone (default: ~/flathub-submission; must not exist)
# Needs: git, and a fork of flathub/flathub created WITH all branches (gh repo fork flathub/flathub).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ID="com.saibilisim.saistatistics"
FILES=(
  "$APP_ID.yml"
  "$APP_ID.desktop"
  "$APP_ID.metainfo.xml"
  "icon-512.png"
  "sai-statistics.sh"
)

GH_USER="${1:-$(gh api user -q .login 2>/dev/null || true)}"
TARGET="${2:-$HOME/flathub-submission}"

[ -n "$GH_USER" ] || { echo "error: pass your GitHub user as the first argument" >&2; exit 1; }
[ ! -e "$TARGET" ] || { echo "error: $TARGET already exists" >&2; exit 1; }

# A manifest still carrying placeholder values would be rejected on sight.
if grep -q "FILL-IN\|0000000000000000" "$HERE/$APP_ID.yml"; then
  echo "error: manifest still has placeholder url/sha256 — run update-manifest.cjs first" >&2
  exit 1
fi
for f in "${FILES[@]}"; do
  [ -f "$HERE/$f" ] || { echo "error: missing $HERE/$f" >&2; exit 1; }
done

git clone --branch new-pr --single-branch "https://github.com/$GH_USER/flathub.git" "$TARGET"
cd "$TARGET"
git switch -c "$APP_ID"
for f in "${FILES[@]}"; do cp "$HERE/$f" .; done
git add -- "${FILES[@]}"
git commit -q -m "Add $APP_ID"

cat <<EOF

Prepared in: $TARGET  (branch $APP_ID, 1 commit, NOT pushed)

Next, by hand:
  cd "$TARGET"
  git push -u origin $APP_ID
  # then open the PR on GitHub (or: gh pr create) with
  #   base repository: flathub/flathub   base branch: new-pr   (NOT master)
  #   title: Add $APP_ID
  # Use Flathub's PR template; a draft of the answers is in tmp/flathub-submission/PR-BODY-DRAFT.md
  # (video, development history, AI-disclosure and the "no AI-generated PR" box are yours to fill).
EOF
