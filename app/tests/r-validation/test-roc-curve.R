# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-roc-curve.R — validates roc.R (previously untested, flagged by an
# earlier hand-computation audit): AUC (Mann-Whitney relationship) against
# pROC::auc() directly, and the DeLong (1988) Std. Error against pROC's own
# `var()` (not calling the script's own code).
#
# The SE reference changed in 2026-08: the script used to use Hanley & McNeil's
# 1982 shortcut, which only reaches DeLong's answer when the scores are
# exponentially distributed. tests/spss-parity caught it (SPSS 0.037, ours
# 0.039 — SPSS's "nonparametric assumption" SE is DeLong's).

test_that("roc: AUC matches pROC::auc() and the SE matches SPSS's nonparametric formula", {
  skip_needs <- !requireNamespace("pROC", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: pROC not installed)\n")
    return(invisible())
  }

  set.seed(31)
  n <- 100
  state <- sample(c("no", "yes"), n, replace = TRUE, prob = c(0.55, 0.45))
  x <- rnorm(n) + ifelse(state == "yes", 0.9, 0)
  df <- data.frame(col_state = state, col_1 = x)

  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "test1"),
    stateVar = "col_state", stateName = "state", stateValue = "yes",
    options = list(direction = "larger")
  ))
  result <- run_analysis_script("roc.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  resp <- ifelse(state == "yes", "case", "control")
  r <- pROC::roc(response = resp, predictor = x, levels = c("control", "case"),
                 direction = "<", quiet = TRUE)
  ref_auc <- as.numeric(pROC::auc(r))

  # SPSS's nonparametric SE, from the algorithms manual (harness reference).
  ref_se <- spss_auc_se_ref(x[state == "yes"], x[state == "no"])

  auc_tbl <- find_table(result, "output.roc.aucTitle")
  expect_equal(cell_num(auc_tbl, 1, 2), ref_auc, tolerance = 1e-3, "AUC matches pROC::auc()")
  # tolerance 1e-2 (relative): all.equal's relative tolerance is too tight for
  # a small-magnitude value (SE ~0.06) combined with the script's 3-dp rounding
  # (e.g. 0.0586 -> "0.059" is a ~0.6% relative change).
  expect_equal(cell_num(auc_tbl, 1, 3), ref_se, tolerance = 1e-2, "SE matches the SPSS nonparametric formula")

  # Sanity: CI must bracket the point estimate and be within [0,1].
  lo <- cell_num(auc_tbl, 1, 5); hi <- cell_num(auc_tbl, 1, 6)
  expect_true(lo <= cell_num(auc_tbl, 1, 2) && cell_num(auc_tbl, 1, 2) <= hi, "CI brackets AUC")
  expect_true(lo >= 0 && hi <= 1, "CI within [0,1]")
})

test_that("roc: direction='smaller' produces the complementary AUC (1 - larger-direction AUC)", {
  set.seed(32)
  n <- 80
  state <- sample(c("no", "yes"), n, replace = TRUE)
  x <- rnorm(n) + ifelse(state == "yes", 0.7, 0)
  df <- data.frame(col_state = state, col_1 = x)

  fx_larger <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "test1"),
    stateVar = "col_state", stateName = "state", stateValue = "yes",
    options = list(direction = "larger")
  ))
  res_larger <- run_analysis_script("roc.R", fx_larger)
  auc_larger <- cell_num(find_table(res_larger, "output.roc.aucTitle"), 1, 2)

  fx_smaller <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "test1"),
    stateVar = "col_state", stateName = "state", stateValue = "yes",
    options = list(direction = "smaller")
  ))
  res_smaller <- run_analysis_script("roc.R", fx_smaller)
  auc_smaller <- cell_num(find_table(res_smaller, "output.roc.aucTitle"), 1, 2)

  expect_equal(auc_larger + auc_smaller, 1, tolerance = 1e-2,
               "AUC(larger) + AUC(smaller) == 1 (complementary directions)")
})
