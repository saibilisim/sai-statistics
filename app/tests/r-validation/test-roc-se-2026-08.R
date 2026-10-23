# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-roc-se-2026-08.R — the AUC standard error is SPSS's nonparametric
# one, and BOTH ROC dialogs compute it.
#
# The defect this pins: roc.R computed the nonparametric SE while
# roc-analysis.R still used Hanley & McNeil's 1982 Q1/Q2 shortcut, so one
# dataset gave two different confidence intervals depending on which dialog the
# user opened. Only roc.R was ever compared against a reference — which is
# exactly how the second implementation drifted unnoticed.
#
# Both references below are computed here from the definition, never read back
# from the scripts.

# The nonparametric reference is spss_auc_se_ref() in _harness.R, written
# from the SPSS algorithms manual. 2026-10: it replaced DeLong's structural-
# component variance here, which agrees with SPSS on untied data but not on
# tied scores (a 294-case clinical dataset: INR SE .0570 vs SPSS .057 with
# bounds .711/.935 against SPSS's .712/.934; the manual's formula reproduces
# every printed value).

# Hanley & McNeil (1982), the shortcut that assumes exponentially distributed
# scores — here only to prove the fixture tells the two apart.
hanley_se_ref <- function(auc, np, nn) {
  q1 <- auc / (2 - auc); q2 <- 2 * auc^2 / (1 + auc)
  sqrt((auc * (1 - auc) + (np - 1) * (q1 - auc^2) + (nn - 1) * (q2 - auc^2)) / (np * nn))
}

auc_ref <- function(xp, xn) mean(outer(xp, xn, ">") + 0.5 * outer(xp, xn, "=="))

# Heavily tied ordinal scores in unbalanced groups: the shape a rating scale
# actually has, and the one the exponential shortcut handles worst (SE .025
# against the nonparametric .015 here). Written out rather than sampled, so the
# separation does not depend on an RNG stream staying put.
roc_fixture <- function() {
  xp <- c(rep(5, 20), rep(4, 8), rep(2, 2))
  xn <- c(rep(1, 60), rep(2, 30), rep(4, 8), rep(5, 2))
  data.frame(col_1 = c(xp, xn),
             col_2 = c(rep(1, length(xp)), rep(0, length(xn))))
}

roc_params <- function(extra = list()) {
  c(list(variables = list("col_1"), varNames = list(col_1 = "score"),
         stateVar = "col_2", stateName = "state", stateValue = "1"), extra)
}

test_that("roc: the AUC standard error is the SPSS nonparametric one", {
  df <- roc_fixture()
  xp <- df$col_1[df$col_2 == 1]; xn <- df$col_1[df$col_2 == 0]
  ref   <- spss_auc_se_ref(xp, xn)
  wrong <- hanley_se_ref(auc_ref(xp, xn), length(xp), length(xn))

  # The two estimators must actually disagree on this data at the printed
  # precision, or the assertion below would pass with either implementation and
  # would pin nothing at all.
  expect_true(abs(ref - wrong) > 2e-3,
              "the fixture separates the two standard errors")

  result <- run_analysis_script("roc.R", write_fixture(df, roc_params()))
  expect_true(isTRUE(result$success), "result$success")
  t <- find_table(result, "output.roc.aucTitle")
  expect_equal(cell_num(t, 1, 3), round(ref, 3), tolerance = 1e-3,
               "roc.R SE equals the SPSS nonparametric reference")
})

test_that("roc-analysis: the same area gets the same standard error", {
  df <- roc_fixture()
  xp <- df$col_1[df$col_2 == 1]; xn <- df$col_1[df$col_2 == 0]
  ref <- spss_auc_se_ref(xp, xn)

  result <- run_analysis_script("roc-analysis.R", write_fixture(df, roc_params()))
  expect_true(isTRUE(result$success), "result$success")
  t <- find_table(result, "output.rocAnalysis.aucTitle")
  expect_equal(cell_num(t, 1, 3), round(ref, 3), tolerance = 1e-3,
               "roc-analysis.R SE equals the SPSS nonparametric reference")

  # And the two dialogs agree with each other — the property a user notices:
  # one area, one interval, whichever menu item they opened.
  other <- run_analysis_script("roc.R", write_fixture(df, roc_params()))
  t2 <- find_table(other, "output.roc.aucTitle")
  expect_equal(cell_num(t, 1, 2), cell_num(t2, 1, 2), tolerance = 1e-9,
               "same area from both dialogs")
  expect_equal(cell_num(t, 1, 3), cell_num(t2, 1, 3), tolerance = 1e-9,
               "same standard error from both dialogs")
})

test_that("roc: weighted cases keep the nonparametric standard error", {
  # Integer weights are case replication, so the weighted SE must equal the SE
  # of the expanded frame — the same reference the weight suite uses elsewhere.
  df <- roc_fixture()
  df$col_3 <- rep(c(1L, 2L, 3L), length.out = nrow(df))
  expanded <- df[rep(seq_len(nrow(df)), df$col_3), ]
  ref <- spss_auc_se_ref(expanded$col_1[expanded$col_2 == 1],
                       expanded$col_1[expanded$col_2 == 0])

  result <- run_analysis_script("roc.R", write_fixture(df, roc_params(list(
    weightVariable = "col_3"))))
  expect_true(isTRUE(result$success), "result$success")
  t <- find_table(result, "output.roc.aucTitle")
  expect_equal(cell_num(t, 1, 3), round(ref, 3), tolerance = 1e-3,
               "weighted SE matches the replicated-frame SE")
})

test_that("roc: the SPSS algorithms manual's worked example (SE = 0.183)", {
  # SPSS 29 algorithms manual, ROC ANALYSIS §2.1.4–2.1.6 (Tables 7–8):
  # negatives {1, 3, 3, 5, 6}, positives {2, 3, 5, 6, 8} -> W = 0.64,
  # Q1 ~ 0.467, Q2 ~ 0.504, SE ~ 0.183. Ties between the groups at 3, 5 and 6.
  df <- data.frame(col_1 = c(1, 3, 3, 5, 6, 2, 3, 5, 6, 8),
                   col_2 = c(0, 0, 0, 0, 0, 1, 1, 1, 1, 1))
  expect_equal(spss_auc_se_ref(c(2, 3, 5, 6, 8), c(1, 3, 3, 5, 6)), 0.183,
               tolerance = 2e-3, "the reference reproduces the manual (printed to 3 dp)")
  for (script in c("roc.R", "roc-analysis.R")) {
    res <- run_analysis_script(script, write_fixture(df, roc_params()))
    t <- res$tables[[2]]
    expect_equal(cell_num(t, 1, 2), 0.64, tolerance = 1e-9, paste(script, "area"))
    expect_equal(cell_num(t, 1, 3), 0.183, tolerance = 1e-9, paste(script, "SE"))
  }
})
