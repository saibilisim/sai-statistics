# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-m-estimators-2026-08.R — Explore's four M-estimators, pinned to
# independent references AND to two real SPSS EXAMINE runs.
#
# Background: tests/spss-parity/README.md's "Open differences" section used to
# record these four as unexplained (ACIK): an exhaustive search over scale
# conventions (fixed vs. re-estimated; MAD scaled by 1.4826, by 1/0.6745, by
# sqrt(pi/2), by 1.2533, and raw/unscaled; joint location-scale iteration;
# starting values 45-60) never reproduced the published numbers on that
# fixture (N=117, mean 52.9, SD 11.87 — mild, roughly symmetric).
#
# The 2026-08-23 session that added this file found why: on mild data the
# scale convention barely moves the IRLS fixed point (few/no points ever
# approach a psi cutoff either way), so every convention "returned our own
# number" and the search concluded nothing. Two clinical variables pasted
# from a real SPSS 26 Explore run (Hb and CRP, split by HBsAg) are skewed
# enough to tell the conventions apart — and their FULL raw data can be
# reconstructed exactly from the pasted stem-and-leaf plots + Extreme Values
# tables (every "Extremes" bucket resolves against the published Highest/
# Lowest-5 list, so nothing is approximated). Testing every scale/iteration
# combination against those two real, exact datasets isolated the answer:
# scale = the RAW median absolute deviation from the median (no 1.4826 /
# 1/0.6745 normal-consistency constant), computed ONCE and held FIXED across
# all IRLS iterations — not MASS::rlm()'s default ("MAD", consistency-
# corrected, re-estimated every iteration), which is what explore.R called
# before this fix. That took every estimator from 5-27% off SPSS (worse the
# more skewed the variable) to within ~0.1-0.5%.
#
# References below are computed independently of explore.R's internals, from
# the psi/weight-function definitions directly.

if (!requireNamespace("MASS", quietly = TRUE)) {
  cat("  (skipped: MASS not installed — explore.R omits the table too)\n")
} else {

# Weight functions w(u) = psi(u)/u, from the definitions, with SPSS's constants.
W_REF <- list(
  huber   = function(u) ifelse(abs(u) <= 1.339, 1, 1.339 / abs(u)),
  tukey   = function(u) ifelse(abs(u) <= 4.685, (1 - (u / 4.685)^2)^2, 0),
  hampel  = function(u) {
    a <- 1.7; b <- 3.4; cc <- 8.5; au <- abs(u)
    ifelse(au <= a, 1,
    ifelse(au <= b, a / au,
    ifelse(au <= cc, a * (cc - au) / ((cc - b) * au), 0)))
  },
  andrews = function(u) {
    z <- u / 1.34
    ifelse(abs(u) <= 1.34 * pi, ifelse(abs(z) < 1e-12, 1, sin(z) / z), 0)
  }
)

# The IRLS fixed point explore.R now implements: scale = raw MAD from the
# median, fixed for every iteration (SPSS's own convention — see above).
irls_ref <- function(x, w, iters = 500, tol = 1e-12) {
  s <- median(abs(x - median(x)))
  if (!is.finite(s) || s <= 0) return(NA_real_)
  t <- median(x)
  for (i in seq_len(iters)) {
    ww <- w((x - t) / s)
    if (sum(ww) == 0) return(NA_real_)
    tn <- sum(ww * x) / sum(ww)
    if (abs(tn - t) < tol) return(tn)
    t <- tn
  }
  t
}

# Deterministic, mildly skewed with a couple of far points — enough that the
# four estimators separate from each other and from the mean/median, so the
# assertions below distinguish implementations instead of all landing on the
# same central value.
mest_fixture <- function() {
  x <- c(seq(40, 66, by = 0.5), 31.2, 33.7, 35.1, 72.4, 78.9, 91.3, 24.6,
         52.1, 52.3, 52.7, 53.4, 51.8, 50.9, 54.2)
  data.frame(col_1 = x)
}

mest_params <- list(
  variables = list("col_1"), varNames = list(col_1 = "score"),
  options = list(display = "statistics",
                 stats = list(descriptives = TRUE, mEstimators = TRUE))
)

test_that("explore: the four M-estimators match the IRLS fixed point (self-consistency)", {
  df <- mest_fixture()
  x <- df$col_1

  result <- run_analysis_script("explore.R", write_fixture(df, mest_params))
  expect_true(isTRUE(result$success), "result$success")
  t <- find_table(result, "output.explore.mEstimatorsTitle:score")

  # Column 1 is the group label; the four estimators follow in table order.
  for (i in seq_along(names(W_REF))) {
    k <- names(W_REF)[i]
    expect_equal(cell_num(t, 1, i + 1), irls_ref(x, W_REF[[k]]), tolerance = 1e-4,
                 sprintf("%s equals the IRLS fixed point", k))
  }

  # The estimators must actually differ here, or four identical assertions
  # would pass against an implementation that returned the median four times.
  vals <- vapply(seq_along(W_REF), function(i) cell_num(t, 1, i + 1), numeric(1))
  expect_true(diff(range(vals)) > 0.05, "the fixture separates the four estimators")
  expect_true(abs(vals[1] - median(x)) > 0.01, "and separates them from the median")
})

test_that("explore: M-estimators are omitted when the distribution has no spread", {
  # Every scaled residual is 0/0 when MAD = 0; the estimators are undefined
  # rather than equal to the constant, and the script must not invent a number.
  df <- data.frame(col_1 = rep(50, 40))
  result <- run_analysis_script("explore.R", write_fixture(df, mest_params))
  expect_true(isTRUE(result$success), "result$success")
  t <- find_table(result, "output.explore.mEstimatorsTitle:score")
  for (i in 2:5) {
    v <- t$rows[[1]][[i]]
    expect_true(is.null(v) || is.na(v) || identical(as.character(v), ""),
                sprintf("column %d is empty, not a fabricated value", i))
  }
})

# ══ Real SPSS 26 EXAMINE runs, reconstructed exactly from published output ═══
#
# Both datasets below are reconstructed from a real SPSS 26 Explore run's
# pasted stem-and-leaf plot (stem width given, "each leaf = 1 case") plus its
# Extreme Values table — every "Extremes" bucket's count matches the number
# of Highest/Lowest-5 entries at or beyond the bucket's boundary, so every one
# of the reconstructed values below is an exact reading of the real case, not
# an approximation. Confirmed exact by matching N/mean/median/SD/min/max
# against SPSS's own Descriptives table before trusting the M-Estimators
# comparison (assertions below).

test_that("explore: M-estimators match a real SPSS run (Hb, HBsAg=0, n=209)", {
  # Reconstructed from SPSS's stem-and-leaf (stem width 1.0, all values whole
  # numbers) + Extreme Values (Lowest 5: 5,6,6,7,7; Highest 5: 19,16,16,16,16).
  x <- c(
    rep(5.0, 1), rep(6.0, 2),   # "Extremes (<=6.0)" bucket (3 cases)
    rep(7.0, 3), rep(8.0, 2), rep(9.0, 4), rep(10.0, 16), rep(11.0, 27),
    rep(12.0, 36), rep(13.0, 46), rep(14.0, 33), rep(15.0, 24), rep(16.0, 14),
    rep(19.0, 1)                # "Extremes (>=19.0)" bucket (1 case)
  )
  # Sanity: the reconstruction must reproduce SPSS's own Descriptives table
  # before the M-Estimators comparison below means anything.
  expect_equal(length(x), 209, tolerance = 0, "n")
  expect_equal(mean(x), 12.641, tolerance = 5e-4, "mean")
  expect_equal(median(x), 13, tolerance = 0, "median")
  expect_equal(sd(x), 2.1214, tolerance = 5e-4, "sd")

  df <- data.frame(col_1 = x)
  result <- run_analysis_script("explore.R", write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "Hb"),
    options = list(display = "statistics", stats = list(mEstimators = TRUE))
  )))
  expect_true(isTRUE(result$success), "result$success")
  t <- find_table(result, "output.explore.mEstimatorsTitle:Hb")

  spss <- c(huber = 12.808, tukey = 12.903, hampel = 12.825, andrews = 12.937)
  for (i in seq_along(spss)) {
    expect_equal(cell_num(t, 1, i + 1), unname(spss[i]), tolerance = 0.1,
                 sprintf("%s within 0.1 of the real SPSS value", names(spss)[i]))
  }
})

test_that("explore: M-estimators match a real SPSS run (CRP, HBsAg=1, n=38)", {
  # Reconstructed from SPSS's stem-and-leaf (stem width 10, each leaf = 1
  # case) + Extreme Values (Lowest 5: 0,1,4,4,5; Highest 5: 64,61,57,57,32 —
  # the "4 Extremes >=57" bucket is exactly the top 4 of those five: 32 falls
  # inside the plotted stem "3" leaf "2" instead).
  x <- c(0, 1, 4, 4,
         5, 5, 5, 5, 6, 7, 8, 9, 9, 9,
         10, 10, 10, 11, 11, 13, 13, 14, 14,
         15, 15, 16, 17, 17, 18,
         21,
         25, 26, 29,
         32,
         57, 57, 61, 64)
  expect_equal(length(x), 38, tolerance = 0, "n")
  expect_equal(mean(x), 17.184, tolerance = 5e-4, "mean")
  expect_equal(median(x), 12, tolerance = 0, "median")
  expect_equal(sd(x), 16.527, tolerance = 5e-4, "sd")

  df <- data.frame(col_1 = x)
  result <- run_analysis_script("explore.R", write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "CRP"),
    options = list(display = "statistics", stats = list(mEstimators = TRUE))
  )))
  expect_true(isTRUE(result$success), "result$success")
  t <- find_table(result, "output.explore.mEstimatorsTitle:CRP")

  spss <- c(huber = 12.338, tukey = 10.923, hampel = 11.418, andrews = 10.917)
  for (i in seq_along(spss)) {
    expect_equal(cell_num(t, 1, i + 1), unname(spss[i]), tolerance = 0.05,
                 sprintf("%s within 0.05 of the real SPSS value", names(spss)[i]))
  }
})

}
