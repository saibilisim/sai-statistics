# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# _harness.R — minimal, dependency-free test harness for r-validation.
#
# CLAUDE.md §4/§11/§13.2 specify testthat for this suite. `testthat` cannot be
# installed in this sandbox (its dependency `fs` needs libuv-dev, a system
# package requiring `sudo apt install libuv1-dev`, or `cmake` for the bundled
# fallback — neither is available here without elevated/interactive install).
# This harness mimics testthat's `test_that()`/`expect_*()` shape closely
# enough that migrating to real testthat later is a mechanical find/replace,
# while requiring nothing beyond base R + jsonlite/arrow (already mandatory
# runtime deps, see _bootstrap.R).
#
# Usage in a test-*.R file:
#   source("_harness.R")
#   test_that("description", {
#     expect_equal(actual, expected, tolerance = 1e-4)
#   })
#   report()   # prints summary, sets exit status
#
# run-all.R sources every test-*.R file in this directory and reports totals.

.h_pass <- 0L
.h_fail <- 0L
.h_fail_msgs <- character(0)
.h_current_test <- NULL

test_that <- function(desc, code) {
  .h_current_test <<- desc
  tryCatch(
    {
      force(code)
    },
    error = function(e) {
      .h_fail <<- .h_fail + 1L
      .h_fail_msgs <<- c(.h_fail_msgs, sprintf("[FAIL] %s\n       %s", desc, conditionMessage(e)))
      cat(sprintf("FAIL: %s\n      %s\n", desc, conditionMessage(e)))
    }
  )
  invisible()
}

.h_expect_ok <- function() {
  .h_pass <<- .h_pass + 1L
}

.h_expect_fail <- function(msg) {
  stop(msg, call. = FALSE)
}

#' Numeric equality within tolerance (relative or absolute).
expect_equal <- function(actual, expected, tolerance = 1e-6, label = NULL) {
  lbl <- if (is.null(label)) deparse(substitute(actual)) else label
  if (length(actual) != length(expected)) {
    .h_expect_fail(sprintf(
      "%s: length mismatch (actual=%d, expected=%d)", lbl, length(actual), length(expected)
    ))
  }
  ok <- isTRUE(all.equal(actual, expected, tolerance = tolerance))
  if (!ok) {
    .h_expect_fail(sprintf(
      "%s: actual=%s expected=%s (tolerance=%s)",
      lbl, paste(format(actual, digits = 10), collapse = ", "),
      paste(format(expected, digits = 10), collapse = ", "), tolerance
    ))
  }
  .h_expect_ok()
}

expect_true <- function(actual, label = NULL) {
  lbl <- if (is.null(label)) deparse(substitute(actual)) else label
  if (!isTRUE(actual)) .h_expect_fail(sprintf("%s: expected TRUE, got %s", lbl, actual))
  .h_expect_ok()
}

expect_lt <- function(actual, threshold, label = NULL) {
  lbl <- if (is.null(label)) deparse(substitute(actual)) else label
  if (!(actual < threshold)) {
    .h_expect_fail(sprintf("%s: expected < %s, got %s", lbl, threshold, actual))
  }
  .h_expect_ok()
}

#' Print a pass/fail summary and exit(1) if anything failed (for CI wiring).
report <- function() {
  total <- .h_pass + .h_fail
  cat(sprintf("\n%d/%d assertions passed.\n", .h_pass, total))
  if (.h_fail > 0L) {
    cat("\nFailures:\n")
    cat(paste(.h_fail_msgs, collapse = "\n\n"), "\n")
    quit(save = "no", status = 1L)
  }
  invisible(TRUE)
}

# ── Shared fixture helpers ──────────────────────────────────────────────────

#' Absolute path to app/r-scripts/. run-all.R sets this via
#' `options(sai.rScriptsDir = ...)` before sourcing any test-*.R file.
r_scripts_dir <- function() {
  d <- getOption("sai.rScriptsDir")
  if (is.null(d)) {
    stop(
      "options('sai.rScriptsDir') is not set — run this suite via run-all.R, ",
      "not by sourcing a test-*.R file directly.",
      call. = FALSE
    )
  }
  d
}

#' Write a data.frame + params list to a temp Parquet/JSON pair and return
#' the params (with parquetPath/rScriptsDir set) ready to hand to read_params()
#' emulation, OR to spawn the real script via Rscript (see run_analysis_script).
write_fixture <- function(df, extra_params = list()) {
  suppressPackageStartupMessages({
    library(arrow)
    library(jsonlite)
  })
  tmp_parquet <- tempfile(fileext = ".parquet")
  write_parquet(df, tmp_parquet)
  rsd <- r_scripts_dir()
  params <- c(
    list(parquetPath = tmp_parquet, rScriptsDir = rsd),
    extra_params
  )
  tmp_params <- tempfile(fileext = ".json")
  writeLines(toJSON(params, auto_unbox = TRUE, null = "null"), tmp_params)
  list(parquetPath = tmp_parquet, paramsPath = tmp_params, rScriptsDir = rsd)
}

#' Spawn the real analysis script exactly like r-bridge.ts does (same R_LIBS
#' handling — R_LIBS prepends ~/R/library without hiding R's default personal
#' library, unlike R_LIBS_USER which would replace it) and parse its
#' __SAI_RESULT__ JSON. This exercises the *actual* production code path, not
#' a re-implementation.
run_analysis_script <- function(script_name, fixture) {
  suppressPackageStartupMessages(library(jsonlite))
  script_path <- file.path(fixture$rScriptsDir, script_name)
  user_lib <- file.path(path.expand("~"), "R", "library", paste(R.version$major, strsplit(R.version$minor, ".", fixed = TRUE)[[1]][1], sep = "."))
  existing <- Sys.getenv("R_LIBS")
  r_libs <- if (nzchar(existing)) paste(user_lib, existing, sep = .Platform$path.sep) else user_lib

  # system2()'s `env=` is Unix-only. On Windows R splices the "NAME=value"
  # strings into the command line as positional arguments instead of setting
  # them, so the child Rscript is invoked as `Rscript R_LIBS=... -e ...`,
  # bails out, and every test in the suite fails with an empty
  # "No __SAI_RESULT__ marker found". Setting the variable on the parent
  # (restored on exit) is equivalent — the child inherits our environment —
  # and behaves identically on every platform.
  old_r_libs <- Sys.getenv("R_LIBS", unset = NA)
  Sys.setenv(R_LIBS = r_libs)
  on.exit(
    if (is.na(old_r_libs)) Sys.unsetenv("R_LIBS") else Sys.setenv(R_LIBS = old_r_libs),
    add = TRUE
  )

  # Capture through a temp FILE rather than stdout = TRUE. On Windows the
  # pipe R uses for stdout = TRUE hard-wraps at ~8095 characters, returning
  # one long line as several elements; paste(collapse = "\n") then injects
  # newlines *inside* the JSON payload, and since "." does not match a newline
  # the __SAI_RESULT__ regex below stops matching at all. Any script with a
  # large plot payload (normality.R's histogram + Q-Q traces are >100KB on one
  # line) failed with a misleading "No __SAI_RESULT__ marker found" even
  # though it had run perfectly. Files have no such limit.
  out_file <- tempfile(fileext = ".out")
  on.exit(unlink(out_file), add = TRUE)
  suppressWarnings(system2(
    file.path(R.home("bin"), "Rscript"),
    args = c("--no-save", "--no-restore", shQuote(script_path), shQuote(fixture$paramsPath)),
    stdout = out_file, stderr = out_file
  ))
  out <- readLines(out_file, warn = FALSE)
  text <- paste(out, collapse = "\n")
  # sai_output() emits UTF-8 (jsonlite::toJSON always does, and r-bridge.ts
  # decodes it as UTF-8), but system2() hands the bytes back unmarked. In a
  # non-UTF-8 locale — e.g. R's default "C" locale on Windows — regexec()
  # then measures the pattern in characters while regmatches() slices in
  # bytes, so the capture comes up short by one byte per multi-byte character
  # in the payload. A single "×" in a table title (crosstabs' "A × B") was
  # enough to chop the JSON's closing brackets and fail every crosstabs test
  # with a misleading "premature EOF". Declaring the encoding we already know
  # keeps both sides in character units.
  Encoding(text) <- "UTF-8"
  m <- regmatches(text, regexec("__SAI_RESULT__\\s*\\n(.*?)\\n__END_RESULT__", text, perl = TRUE))[[1]]
  if (length(m) < 2) {
    .h_dump_result(script_name, fixture, NULL)
    stop(sprintf("No __SAI_RESULT__ marker found. Raw output:\n%s", text), call. = FALSE)
  }
  .h_dump_result(script_name, fixture, m[2])
  fromJSON(m[2], simplifyVector = FALSE)
}

#' R-version comparison (scripts/compare-r-versions.cjs): when SAI_RESULT_DUMP
#' names a directory, every script result is also written there, keyed by test
#' file + call order + script, so two runs of this suite under different R
#' builds can be diffed number by number. A failed run is recorded as such
#' (".failed") — "ran on one R, broke on the other" is the most important diff.
.h_dump_seq <- new.env()
.h_dump_result <- function(script_name, fixture, json) {
  dir <- Sys.getenv("SAI_RESULT_DUMP")
  if (!nzchar(dir)) return(invisible())
  src <- getOption("sai.currentTestFile", "unknown")
  key <- paste(src, script_name, sep = "__")
  n <- (if (is.null(.h_dump_seq[[key]])) 0L else .h_dump_seq[[key]]) + 1L
  .h_dump_seq[[key]] <- n
  base <- file.path(dir, sprintf("%s__%03d", sub("\\.R$", "", key), n))
  dir.create(dir, showWarnings = FALSE, recursive = TRUE)
  if (is.null(json)) {
    writeLines("", paste0(base, ".failed"))
  } else {
    con <- file(paste0(base, ".json"), open = "w", encoding = "UTF-8")
    writeLines(json, con)
    close(con)
  }
  invisible()
}

#' Find a table by (partial) titleKey prefix, e.g. "output.ttestInd.testTitle".
find_table <- function(result, title_prefix) {
  for (t in result$tables) {
    if (startsWith(t$titleKey, title_prefix)) return(t)
  }
  stop(sprintf("No table found with titleKey prefix '%s'", title_prefix), call. = FALSE)
}

#' Index a result's created case variables by the column name they will be
#' written under. Lives here rather than in one test file because run-all.R
#' sources tests alphabetically, so a helper defined in test-new-variables.R is
#' not yet in scope when test-new-variables-2.R runs.
by_name <- function(result) {
  setNames(result$caseVars, vapply(result$caseVars, function(c) c$name, character(1)))
}

#' Extract a numeric cell from a table's rows (1-indexed row/col).
cell_num <- function(table, row, col) {
  v <- table$rows[[row]][[col]]
  if (is.null(v)) return(NA_real_)
  as.numeric(v)
}

#' Reference AUC standard error under SPSS's nonparametric assumption, written
#' straight from the SPSS 29 algorithms manual (ROC ANALYSIS §2.1.6, eq. 8–10)
#' case by case — deliberately not the production code's cumulative-count
#' version. For each negative case, a = positives above it and b = positives
#' tied with it, and Q1 averages a² + a·b + b²/3 (Q2 mirrors it over the
#' positives); SE = sqrt((A(1-A) + (n+ - 1)(Q1 - A²) + (n- - 1)(Q2 - A²)) / (n+ n-)).
#' Shared here because three ROC test files assert against it.
spss_auc_se_ref <- function(xp, xn) {
  np <- length(xp); nn <- length(xn)
  A <- mean(outer(xp, xn, ">") + 0.5 * outer(xp, xn, "=="))
  q1 <- mean(vapply(xn, function(t) {
    a <- sum(xp > t); b <- sum(xp == t); a^2 + a * b + b^2 / 3
  }, numeric(1))) / np^2
  q2 <- mean(vapply(xp, function(t) {
    c <- sum(xn < t); d <- sum(xn == t); c^2 + c * d + d^2 / 3
  }, numeric(1))) / nn^2
  sqrt((A * (1 - A) + (np - 1) * (q1 - A^2) + (nn - 1) * (q2 - A^2)) / (np * nn))
}
