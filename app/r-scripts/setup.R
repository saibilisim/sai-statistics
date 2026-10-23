#!/usr/bin/env Rscript
# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# SAI Statistics — R package setup
# Run once after installing R: Rscript r-scripts/setup.R

# The package list lives in shared/r-packages.json — the single source of truth
# the app, the three vendor scripts and this file all read, so it cannot drift
# (a hand-maintained copy here is exactly how `geepack` ended up listed as
# required while also being an on-demand optional package).
#
# Parsed with base R regex rather than jsonlite: this script's whole job is to
# install jsonlite, so it cannot depend on it. The shape it relies on is fixed
# and Prettier-stable, and tests/unit/r-packages-manifest.test.ts fails if this
# extraction stops agreeing with the manifest.
.manifest_path <- local({
  # Rscript sets --file=; source()/R CMD BATCH do not, so fall back to the
  # working directory being either app/ or app/r-scripts/.
  args <- commandArgs(trailingOnly = FALSE)
  f <- sub("^--file=", "", grep("^--file=", args, value = TRUE))
  roots <- c(
    if (length(f) == 1) dirname(dirname(normalizePath(f, mustWork = FALSE))) else NULL,
    getwd(),
    dirname(getwd())
  )
  hits <- Filter(file.exists, file.path(roots, "shared", "r-packages.json"))
  if (length(hits) == 0) {
    stop("Package manifest (shared/r-packages.json) not found near ",
         paste(roots, collapse = ", "), call. = FALSE)
  }
  hits[1]
})
required <- local({
  txt <- paste(readLines(.manifest_path, warn = FALSE), collapse = "\n")
  # Narrow to the "bundled" array: drop the $comment block before it (and any
  # array after it), so only bundled package names are picked up.
  # (?s) makes "." span newlines — without it these patterns silently match
  # nothing on a multi-line file and every optional package leaks in.
  block <- sub('(?s)^.*?"bundled"\\s*:', "", txt, perl = TRUE)
  block <- sub('(?s)"optional"\\s*:.*$', "", block, perl = TRUE)
  hits <- regmatches(block, gregexpr('"r"\\s*:\\s*"[^"]+"', block, perl = TRUE))[[1]]
  if (length(hits) == 0) stop("No bundled packages found in ", .manifest_path, call. = FALSE)
  sub('^.*"([^"]+)"$', "\\1", hits, perl = TRUE)
})

# Since 0.2.28 the list holds every package any analysis uses (lme4, mice,
# BayesFactor, coin, … included) — there are no optional packages any more.

cat("SAI Statistics — R paket kurulumu\n")
cat("===================================\n\n")

# SAI_R_REPO overrides the repository — CI points it at Posit Package
# Manager's prebuilt Linux binaries (cloud.r-project.org serves Linux only as
# source, so every CI run compiled ~50 packages: ~50 minutes per job).
repo <- Sys.getenv("SAI_R_REPO", unset = "")
if (!nzchar(repo)) repo <- "https://cloud.r-project.org"

for (pkg in required) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    cat(sprintf("Kuruluyor: %s ...\n", pkg))
    install.packages(pkg, repos = repo, quiet = FALSE)
  } else {
    cat(sprintf("OK: %s\n", pkg))
  }
}

cat("\nDoğrulama:\n")
ok <- TRUE
for (pkg in required) {
  loaded <- requireNamespace(pkg, quietly = TRUE)
  status <- if (loaded) "✓" else "✗ BAŞARISIZ"
  cat(sprintf("  %s %s\n", status, pkg))
  if (!loaded) ok <- FALSE
}

if (ok) {
  cat("\nTüm paketler hazır.\n")
} else {
  cat("\nBazı paketler kurulamadı — lütfen hata mesajlarını inceleyin.\n")
  quit(status = 1)
}
