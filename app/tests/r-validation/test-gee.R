# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-gee.R — validates r-scripts/gee.R's missing-dependency behaviour.
#
# geepack is NOT installed in this environment (and cannot be — it needs
# compilation toolchain deps unavailable here), so the numerical GEE path
# cannot be exercised. What CAN and MUST be validated is the honest guard:
# gee.R must detect the missing package and report it via the
# "output.gee.needsPackage" warning key with success=TRUE and empty tables —
# a clean, user-facing message instead of a crash (same honesty contract as
# the weight/missing/bootstrap "not applied" warnings in _bootstrap.R).

# Longitudinal fixture: 20 subjects x 4 repeated observations.
make_gee_fixture <- function(extra = list()) {
  set.seed(11)
  n_subj <- 20; n_obs <- 4
  subj <- rep(seq_len(n_subj), each = n_obs)
  df <- data.frame(
    col_1 = rnorm(n_subj * n_obs, mean = 50, sd = 10),      # dependent
    col_2 = rep(seq_len(n_obs), times = n_subj) + rnorm(n_subj * n_obs, 0, 0.5), # predictor
    col_3 = subj                                            # subject (cluster id)
  )
  write_fixture(df, c(list(
    dependent = "col_1",
    dependentName = "outcome",
    predictors = list("col_2"),
    subject = "col_3",
    varNames = list(col_1 = "outcome", col_2 = "time", col_3 = "id")
  ), extra))
}

test_that("gee.R: missing geepack is reported honestly (gaussian family)", {
  if (requireNamespace("geepack", quietly = TRUE)) {
    cat("  (skipped: geepack IS installed, so the missing-package path cannot run)
")
    return(invisible())
  }
  fixture <- make_gee_fixture(list(family = "gaussian", corstr = "exchangeable"))
  result <- run_analysis_script("gee.R", fixture)

  # No crash: the run completes as a successful result envelope...
  expect_true(isTRUE(result$success), "result$success")
  # ...with no error payload...
  expect_true(is.null(result$error), "result$error is NULL")
  # ...no fabricated tables (silence would imply the analysis ran)...
  expect_equal(length(result$tables), 0, label = "no tables emitted")
  # ...and the dedicated i18n warning key telling the user geepack is needed.
  expect_true("output.gee.needsPackage" %in% unlist(result$warnings),
              "warnings contain output.gee.needsPackage")
})

test_that("gee.R: needsPackage guard is family/corstr independent (binomial)", {
  if (requireNamespace("geepack", quietly = TRUE)) {
    cat("  (skipped: geepack IS installed, so the missing-package path cannot run)
")
    return(invisible())
  }
  set.seed(12)
  n_subj <- 20; n_obs <- 4
  df <- data.frame(
    col_1 = rbinom(n_subj * n_obs, 1, 0.4),
    col_2 = rnorm(n_subj * n_obs),
    col_3 = rep(seq_len(n_subj), each = n_obs)
  )
  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "y",
    predictors = list("col_2"), subject = "col_3",
    family = "binomial", corstr = "ar1",
    varNames = list(col_1 = "y", col_2 = "x", col_3 = "id")
  ))
  result <- run_analysis_script("gee.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  expect_equal(length(result$tables), 0, label = "no tables emitted")
  expect_true("output.gee.needsPackage" %in% unlist(result$warnings),
              "warnings contain output.gee.needsPackage")
})

test_that("gee.R: guard fires before parameter validation (documented ordering)", {
  if (requireNamespace("geepack", quietly = TRUE)) {
    cat("  (skipped: geepack IS installed, so the missing-package path cannot run)
")
    return(invisible())
  }
  # The needsPackage check precedes the dependent/subject/predictor checks in
  # gee.R, so even a malformed params payload yields the honest "package
  # missing" warning rather than a sai_error. This characterizes the actual
  # (sensible) behaviour: without geepack nothing can run anyway.
  fixture <- make_gee_fixture(list(dependent = "col_nonexistent"))
  result <- run_analysis_script("gee.R", fixture)
  expect_true(isTRUE(result$success), "result$success (no sai_error)")
  expect_true("output.gee.needsPackage" %in% unlist(result$warnings),
              "needsPackage warning even with bad dependent")
})

test_that("gee.R: needsPackage warning key resolves to a real user-facing message", {
  if (requireNamespace("geepack", quietly = TRUE)) {
    cat("  (skipped: geepack IS installed, so the missing-package path cannot run)
")
    return(invisible())
  }
  # The warning key is only honest if the UI can translate it; verify the key
  # exists in the shipped locale files (en + tr) and names the package.
  suppressPackageStartupMessages(library(jsonlite))
  locales_dir <- file.path(r_scripts_dir(), "..", "src", "i18n", "locales")
  for (lang in c("en", "tr")) {
    loc <- fromJSON(file.path(locales_dir, lang, "analysis.json"), simplifyVector = FALSE)
    msg <- loc$output$gee$needsPackage
    expect_true(is.character(msg) && nzchar(msg), paste(lang, "message exists"))
    expect_true(grepl("geepack", msg, fixed = TRUE), paste(lang, "message names geepack"))
  }
})

test_that("gee.R: missing-geepack run exits with status 0 (no crash)", {
  if (requireNamespace("geepack", quietly = TRUE)) {
    cat("  (skipped: geepack IS installed, so the missing-package path cannot run)
")
    return(invisible())
  }
  # run_analysis_script() only parses the result markers; additionally assert
  # the Rscript process itself exits cleanly.
  fixture <- make_gee_fixture()
  script_path <- file.path(fixture$rScriptsDir, "gee.R")
  user_lib <- file.path(path.expand("~"), "R", "library", paste(R.version$major, strsplit(R.version$minor, ".", fixed = TRUE)[[1]][1], sep = "."))
  existing <- Sys.getenv("R_LIBS")
  r_libs <- if (nzchar(existing)) paste(user_lib, existing, sep = .Platform$path.sep) else user_lib

  # system2()'s `env=` is Unix-only — on Windows R splices "NAME=value" into
  # the child's command line as a positional argument instead of setting it,
  # so Rscript is invoked with a bogus extra arg and exits non-zero. That made
  # this assertion fail for a reason that has nothing to do with gee.R (the
  # other assertions in this file, which go through _harness.R's already-fixed
  # run_analysis_script(), pass fine). Set it on the parent and restore on
  # exit — the child inherits it, identically on every platform.
  old_r_libs <- Sys.getenv("R_LIBS", unset = NA)
  Sys.setenv(R_LIBS = r_libs)
  on.exit(
    if (is.na(old_r_libs)) Sys.unsetenv("R_LIBS") else Sys.setenv(R_LIBS = old_r_libs),
    add = TRUE
  )
  status <- system2(
    file.path(R.home("bin"), "Rscript"),
    args = c("--no-save", "--no-restore", shQuote(script_path), shQuote(fixture$paramsPath)),
    stdout = FALSE, stderr = FALSE
  )
  expect_equal(status, 0, label = "exit status")
})
