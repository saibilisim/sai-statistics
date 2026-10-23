# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# run-all.R — R-validation suite entry point (CLAUDE.md §4/§11/§13.2).
#
# Runs every test-*.R file in this directory against the real, production
# r-scripts/*.R analysis scripts (spawned exactly like electron/ipc/r-bridge.ts
# does, including R_LIBS_USER handling for a non-sudo ~/R/library install), and
# compares their output to independently computed reference values (R base
# stats functions: t.test, aov/pf, cor.test, chisq.test, lm — never the
# analysis script's own internals).
#
# Usage:
#   Rscript tests/r-validation/run-all.R
#
# Exit status is non-zero if any assertion fails (wire into CI).

this_dir <- dirname(normalizePath(sub("--file=", "", grep("--file=", commandArgs(trailingOnly = FALSE), value = TRUE))))
if (length(this_dir) == 0 || !nzchar(this_dir)) this_dir <- getwd()

# Mirror the app's library search order in THIS parent process too (the spawned
# scripts get it via _harness.R's R_LIBS env): ~/R/library first, then R's
# defaults. Without this, a plain `Rscript run-all.R` can pick up a broken or
# stale package copy from the default personal library (e.g. an interrupted
# arrow install leaving a 00LOCK dir) that the app itself would never see.
.sai_user_lib <- file.path(path.expand("~"), "R", "library", paste(R.version$major, strsplit(R.version$minor, ".", fixed = TRUE)[[1]][1], sep = "."))
if (dir.exists(.sai_user_lib)) .libPaths(c(.sai_user_lib, .libPaths()))

options(sai.rScriptsDir = normalizePath(file.path(this_dir, "..", "..", "r-scripts")))

source(file.path(this_dir, "_harness.R"))

test_files <- sort(list.files(this_dir, pattern = "^test-.*\\.R$", full.names = TRUE))
# Targeted run: `Rscript run-all.R <regex>` keeps only matching file names
# (e.g. "bayes"), same idea as tests/e2e/run-e2e.cjs <pattern>.
.sai_filter <- commandArgs(trailingOnly = TRUE)
if (length(.sai_filter) > 0) test_files <- test_files[grepl(.sai_filter[1], basename(test_files))]
if (length(test_files) == 0) {
  cat("No test-*.R files found in", this_dir, "\n")
  quit(save = "no", status = 1L)
}

cat(sprintf("Running %d r-validation file(s)...\n\n", length(test_files)))

# A file that dies while being sourced (a missing optional package, a typo)
# used to abort the whole run. Because files are sourced in sorted order, that
# turned one unrelated failure into silence for every file after it — a
# BayesFactor-less machine reported nothing at all about the 50 files sorting
# after test-bayes-*. Report the load failure loudly, count it, and keep going;
# the exit status below is still non-zero.
load_failures <- character(0)
for (f in test_files) {
  cat(sprintf("--- %s ---\n", basename(f)))
  options(sai.currentTestFile = basename(f)) # _harness.R result dump key
  tryCatch(source(f), error = function(e) {
    load_failures <<- c(load_failures, basename(f))
    cat(sprintf("  [LOAD FAIL] %s\n", conditionMessage(e)))
  })
}

if (length(load_failures) > 0) {
  cat(sprintf("\n%d file(s) failed to load: %s\n",
              length(load_failures), paste(load_failures, collapse = ", ")))
}

report()
if (length(load_failures) > 0) quit(save = "no", status = 1L)
