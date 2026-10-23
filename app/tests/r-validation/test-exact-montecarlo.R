# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-exact-montecarlo.R — validates the Exact/Monte Carlo p-value module
# (EXACT1, see spss-parity-analysis.md §3.4): sai_monte_carlo_chisq()'s own
# contract, plus its wiring into crosstabs.R's Pearson Chi-Square table.

test_that("sai_monte_carlo_chisq: disabled/omitted options return NULL (no-op)", {
  source(file.path(r_scripts_dir(), "_bootstrap.R"))
  tab <- matrix(c(10, 2, 3, 8), nrow = 2)
  expect_true(is.null(sai_monte_carlo_chisq(tab, list(options = list()))), "no pMethod key")
  expect_true(
    is.null(sai_monte_carlo_chisq(tab, list(options = list(pMethod = list(method = "asymptotic"))))),
    "method = asymptotic"
  )
})

test_that("sai_monte_carlo_chisq: seed reproducibility and plausible p-value", {
  source(file.path(r_scripts_dir(), "_bootstrap.R"))
  tab <- matrix(c(10, 2, 3, 8), nrow = 2)
  opt <- list(options = list(pMethod = list(method = "montecarlo", samples = 3000, seed = 7)))

  r1 <- sai_monte_carlo_chisq(tab, opt)
  r2 <- sai_monte_carlo_chisq(tab, opt)
  expect_true(!is.null(r1), "returns a result")
  expect_equal(r1$p.value, r2$p.value, tolerance = 1e-9, "same seed -> same p-value (repro)")
  expect_true(r1$p.value > 0 && r1$p.value < 1, "p-value in (0, 1)")
  expect_equal(r1$samples, 3000, tolerance = 0, "samples echoed back")
})

test_that("crosstabs: Monte Carlo Sig. column appears only when requested", {
  set.seed(5)
  df <- data.frame(
    a = sample(c("x", "y"), 60, replace = TRUE),
    b = sample(c("p", "q"), 60, replace = TRUE)
  )

  fixture_off <- write_fixture(df, list(
    rows = list("a"), rowNames = list(a = "A"),
    cols = list("b"), colNames = list(b = "B"),
    options = list(cells = list(), stats = list(chisquare = TRUE))
  ))
  result_off <- run_analysis_script("crosstabs.R", fixture_off)
  expect_true(isTRUE(result_off$success), "off: result$success")
  chisq_table_off <- find_table(result_off, "output.crosstabs.chiSqTitle")
  expect_true(
    !("output.col.monteCarloSig" %in% unlist(chisq_table_off$columns)),
    "no Monte Carlo Sig. column when not requested"
  )
  expect_true(length(result_off$warnings) == 0, "no warnings when pMethod not requested")

  fixture_on <- write_fixture(df, list(
    rows = list("a"), rowNames = list(a = "A"),
    cols = list("b"), colNames = list(b = "B"),
    options = list(
      cells = list(),
      stats = list(chisquare = TRUE),
      pMethod = list(method = "montecarlo", samples = 2000, seed = 11)
    )
  ))
  result_on <- run_analysis_script("crosstabs.R", fixture_on)
  expect_true(isTRUE(result_on$success), "on: result$success")
  chisq_table_on <- find_table(result_on, "output.crosstabs.chiSqTitle")
  expect_true(
    "output.col.monteCarloSig" %in% unlist(chisq_table_on$columns),
    "Monte Carlo Sig. column present when requested"
  )
  mc_p <- cell_num(chisq_table_on, 1, 5)
  expect_true(!is.na(mc_p) && mc_p >= 0 && mc_p <= 1, "Monte Carlo p-value is a valid probability")
})

# ── sai_coin_pvalue (rank-test exact/MC via coin) — helper contract ──────────
# Runs without arrow (direct helper call). Verifies the opt-in + honesty
# contract; the actual exact/MC numbers require the coin package and are
# exercised by the KW/Friedman script tests below when coin is installed.
test_that("sai_coin_pvalue: no-op unless montecarlo/exact requested", {
  source(file.path(r_scripts_dir(), "_bootstrap.R"))
  builder <- function(dist) stop("builder must not be called")
  expect_true(is.null(sai_coin_pvalue(builder, list(options = list()))), "no pMethod key")
  expect_true(
    is.null(sai_coin_pvalue(builder, list(options = list(pMethod = list(method = "asymptotic"))))),
    "asymptotic -> NULL"
  )
})

test_that("sai_coin_pvalue: requested-but-coin-absent returns NULL and flags the honesty warning", {
  source(file.path(r_scripts_dir(), "_bootstrap.R"))
  .sai_pmethod_requested <<- FALSE
  .sai_pmethod_applied <<- FALSE
  res <- sai_coin_pvalue(function(dist) NULL,
                         list(options = list(pMethod = list(method = "montecarlo", samples = 500))))
  if (requireNamespace("coin", quietly = TRUE)) {
    # coin present: builder returns NULL -> tryCatch -> NULL, still requested.
    expect_true(is.null(res), "NULL when builder yields nothing")
  } else {
    expect_true(is.null(res), "NULL when coin missing")
  }
  expect_true(.sai_pmethod_requested, "pMethod recorded as requested (drives pMethodNotApplied)")
  expect_true(!.sai_pmethod_applied, "not marked applied when nothing computed")
})

# ── npar-chisquare goodness-of-fit Monte Carlo (no coin needed) ──────────────
test_that("npar-chisquare: Monte Carlo Sig. column appears only when requested", {
  set.seed(9)
  df <- data.frame(col_1 = sample(c("A", "B", "C", "D"), 80, replace = TRUE))

  fx_on <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "cat"),
    options = list(pMethod = list(method = "montecarlo", samples = 2000, seed = 3))
  ))
  res_on <- run_analysis_script("npar-chisquare.R", fx_on)
  expect_true(isTRUE(res_on$success), "on: success")
  ts <- find_table(res_on, "output.npar.testStatsTitle")
  expect_true("output.col.monteCarloSig" %in% unlist(ts$columns), "MC column present when requested")
  mc_p <- cell_num(ts, 1, 5)
  expect_true(!is.na(mc_p) && mc_p >= 0 && mc_p <= 1, "GoF Monte Carlo p is a valid probability")

  fx_off <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "cat")
  ))
  res_off <- run_analysis_script("npar-chisquare.R", fx_off)
  ts_off <- find_table(res_off, "output.npar.testStatsTitle")
  expect_true(!("output.col.monteCarloSig" %in% unlist(ts_off$columns)),
              "no MC column when not requested")
})
