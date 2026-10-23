# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-wtd-functions.R — validates _bootstrap.R's weighted helpers that have no
# direct base-R counterpart and are not fully covered elsewhere:
#   wtd_welch_anova()  — weighted Welch (unequal-variance) one-way ANOVA
#   wtd_cor_test()     — weighted Pearson correlation + t/p significance test
#   wtd_quantile()     — percentiles by SPSS's HAVERAGE rule, weighted or not
#
# Reference strategy (suite convention: never re-use the script's own internals
# as the reference):
#   * unweighted (w = NULL) and unit-weight results are checked against base
#     R's own oneway.test(var.equal = FALSE) / cor.test() / quantile();
#   * integer-weight results are checked against row-expansion (a weight-k case
#     is k identical unweighted cases — SPSS frequency-weight semantics) fed to
#     those same base R functions;
#   * fractional-weight results are checked against the textbook definitions
#     hand-computed inside the test (weighted Pearson r, Welch F from per-group
#     weighted n/mean/var, HAVERAGE-positioned quantiles).
#
# Direct function calls (no parquet fixture), same pattern as
# test-skewness-kurtosis.R.
source(file.path(r_scripts_dir(), "_bootstrap.R"))

# ── wtd_welch_anova ───────────────────────────────────────────────────────────

test_that("wtd_welch_anova: unweighted matches oneway.test(var.equal = FALSE)", {
  set.seed(31)
  x <- c(rnorm(9, 20, 3), rnorm(11, 25, 5), rnorm(8, 18, 2))
  g <- rep(c("A", "B", "C"), c(9, 11, 8))

  ref <- oneway.test(x ~ factor(g), var.equal = FALSE)
  got <- wtd_welch_anova(x, g)

  expect_equal(got$statistic, unname(ref$statistic), tolerance = 1e-8, "Welch F")
  expect_equal(got$df1, unname(ref$parameter[1]), tolerance = 1e-8, "Welch df1")
  expect_equal(got$df2, unname(ref$parameter[2]), tolerance = 1e-8, "Welch df2")
  expect_equal(got$p.value, ref$p.value, tolerance = 1e-8, "Welch p")
})

test_that("wtd_welch_anova: integer weights match oneway.test on row-expanded data", {
  set.seed(32)
  x <- c(rnorm(9, 20, 3), rnorm(11, 25, 5), rnorm(8, 18, 2))
  g <- rep(c("A", "B", "C"), c(9, 11, 8))
  w <- sample(1:3, length(x), replace = TRUE)

  ex <- rep(x, times = w); eg <- rep(g, times = w)
  ref <- oneway.test(ex ~ factor(eg), var.equal = FALSE)
  got <- wtd_welch_anova(x, g, w)

  expect_equal(got$statistic, unname(ref$statistic), tolerance = 1e-8, "weighted Welch F")
  expect_equal(got$df2, unname(ref$parameter[2]), tolerance = 1e-8, "weighted Welch df2")
  expect_equal(got$p.value, ref$p.value, tolerance = 1e-8, "weighted Welch p")
})

test_that("wtd_welch_anova: fractional weights match the textbook Welch formulas", {
  # Independent reference: Welch F built from per-group weighted n_i = Σw,
  # weighted mean, weighted variance (W-1 denominator), then the classic
  # Welch (1951) statistic with the 1 + 2(k-2)/(k^2-1) * Λ correction and
  # df2 = (k^2-1)/(3Λ) — computed here from first principles on the expanded
  # definition, not via wtd_* helpers.
  x <- c(12, 15, 18, 22, 25, 30)
  g <- c("A", "A", "B", "B", "C", "C")
  w <- c(0.5, 1.5, 2.0, 0.75, 1.25, 1.0)

  lvls <- c("A", "B", "C"); k <- 3
  ni <- mi <- vi <- numeric(k)
  for (i in seq_len(k)) {
    idx <- g == lvls[i]
    wi_ <- w[idx]; xi_ <- x[idx]
    ni[i] <- sum(wi_)
    mi[i] <- sum(wi_ * xi_) / ni[i]
    vi[i] <- sum(wi_ * (xi_ - mi[i])^2) / (ni[i] - 1)
  }
  prec <- ni / vi               # per-group precision n_i / s_i^2
  P <- sum(prec)
  grand <- sum(prec * mi) / P
  lambda <- sum((1 - prec / P)^2 / (ni - 1))
  ref_F <- sum(prec * (mi - grand)^2) / (k - 1) / (1 + 2 * (k - 2) / (k^2 - 1) * lambda)
  ref_df2 <- (k^2 - 1) / (3 * lambda)

  got <- wtd_welch_anova(x, g, w)
  expect_equal(got$statistic, ref_F, tolerance = 1e-9, "fractional-weight Welch F")
  expect_equal(got$df1, k - 1, tolerance = 1e-12, "fractional-weight Welch df1")
  expect_equal(got$df2, ref_df2, tolerance = 1e-9, "fractional-weight Welch df2")
  expect_equal(got$p.value, pf(ref_F, k - 1, ref_df2, lower.tail = FALSE),
               tolerance = 1e-12, "fractional-weight Welch p")
})

test_that("wtd_welch_anova: unit weights reduce exactly to the unweighted case", {
  set.seed(33)
  x <- rnorm(15, 50, 10)
  g <- rep(c("A", "B", "C"), 5)
  expect_equal(wtd_welch_anova(x, g, rep(1, 15)), wtd_welch_anova(x, g),
               tolerance = 1e-12, "w == 1 reduces to w = NULL")
})

test_that("wtd_welch_anova: zero-weight rows are ignored entirely", {
  x <- c(1, 2, 3, 4, 5, 6)
  g <- c("A", "A", "B", "B", "C", "C")
  w <- c(1, 2, 1, 1, 2, 1)
  # absurd values in the zero-weight rows: any leakage would move the result
  got <- wtd_welch_anova(c(x, 9999, -9999), c(g, "A", "B"), c(w, 0, 0))
  ref <- wtd_welch_anova(x, g, w)
  expect_equal(got$statistic, ref$statistic, tolerance = 1e-12, "F unchanged by w=0 rows")
  expect_equal(got$df2, ref$df2, tolerance = 1e-12, "df2 unchanged by w=0 rows")
  expect_equal(got$p.value, ref$p.value, tolerance = 1e-12, "p unchanged by w=0 rows")
})

test_that("wtd_welch_anova: single group is undefined (NaN), not an error", {
  # k = 1 leaves df1 = 0 and a 0/0 correction term; the statistic has no
  # meaning. The function must not throw — callers (anova-oneway.R robust
  # table) rely on getting a non-finite value back.
  got <- tryCatch(wtd_welch_anova(c(1, 2, 3, 4), rep("A", 4)),
                  error = function(e) e)
  expect_true(!inherits(got, "error"), "single group does not throw")
  expect_true(is.nan(got$statistic) || is.na(got$statistic), "single-group F is NaN/NA")
  expect_true(is.nan(got$p.value) || is.na(got$p.value), "single-group p is NaN/NA")
})

# ── wtd_cor_test ──────────────────────────────────────────────────────────────

test_that("wtd_cor_test: unweighted matches cor.test (estimate and p)", {
  set.seed(41)
  x <- rnorm(20, 100, 15); y <- 0.6 * x + rnorm(20, 0, 10)
  ref <- cor.test(x, y)
  got <- wtd_cor_test(x, y)
  expect_equal(got$estimate, unname(ref$estimate), tolerance = 1e-10, "unweighted r")
  expect_equal(got$p.value, ref$p.value, tolerance = 1e-10, "unweighted p")
  expect_equal(got$n, 20, tolerance = 1e-12, "unweighted n")
})

test_that("wtd_cor_test: integer weights match cor.test on row-expanded data", {
  set.seed(42)
  x <- rnorm(15, 50, 8); y <- x + rnorm(15, 0, 5)
  w <- sample(1:3, 15, replace = TRUE)
  ref <- cor.test(rep(x, times = w), rep(y, times = w))
  got <- wtd_cor_test(x, y, w)
  expect_equal(got$estimate, unname(ref$estimate), tolerance = 1e-10, "weighted r")
  expect_equal(got$p.value, ref$p.value, tolerance = 1e-10, "weighted p")
  expect_equal(got$n, sum(w), tolerance = 1e-12, "weighted n = Σw")
})

test_that("wtd_cor_test: fractional weights match the textbook weighted Pearson test", {
  # Independent reference: r from weighted sums about weighted means,
  # t = r·sqrt(n-2)/sqrt(1-r²), two-sided p on n-2 df with n = Σw.
  x <- c(1, 2, 3, 4, 5)
  y <- c(2, 1, 4, 3, 6)
  w <- c(0.5, 1.5, 2.0, 0.75, 1.25)

  n <- sum(w)
  mx <- sum(w * x) / n; my <- sum(w * y) / n
  ref_r <- sum(w * (x - mx) * (y - my)) /
    sqrt(sum(w * (x - mx)^2) * sum(w * (y - my)^2))
  ref_t <- ref_r * sqrt(n - 2) / sqrt(1 - ref_r^2)
  ref_p <- 2 * pt(-abs(ref_t), n - 2)

  got <- wtd_cor_test(x, y, w)
  expect_equal(got$estimate, ref_r, tolerance = 1e-10, "fractional-weight r")
  expect_equal(got$p.value, ref_p, tolerance = 1e-10, "fractional-weight p")
  expect_equal(got$n, n, tolerance = 1e-12, "fractional-weight n")
})

test_that("wtd_cor_test: unit weights reduce to unweighted, zero-weight rows are ignored", {
  set.seed(43)
  x <- rnorm(12); y <- rnorm(12)
  base <- wtd_cor_test(x, y)
  unit <- wtd_cor_test(x, y, rep(1, 12))
  expect_equal(unit$estimate, base$estimate, tolerance = 1e-12, "w == 1 r equals unweighted r")
  expect_equal(unit$p.value, base$p.value, tolerance = 1e-12, "w == 1 p equals unweighted p")

  # zero-weight rows carrying extreme leverage values must not move anything
  w <- sample(1:3, 12, replace = TRUE)
  ref <- wtd_cor_test(x, y, w)
  got <- wtd_cor_test(c(x, 1e6), c(y, -1e6), c(w, 0))
  expect_equal(got$estimate, ref$estimate, tolerance = 1e-12, "r unchanged by w=0 row")
  expect_equal(got$p.value, ref$p.value, tolerance = 1e-12, "p unchanged by w=0 row")
  expect_equal(got$n, ref$n, tolerance = 1e-12, "n unchanged by w=0 row")
})

# ── wtd_quantile (weighted branch) ────────────────────────────────────────────

test_that("wtd_quantile: unweighted matches stats::quantile(type = 6)", {
  # type 6 is SPSS's HAVERAGE ("Weighted Average (Definition 1)"), h = (n+1)p —
  # NOT R's default type 7. Verified against a real SPSS run in
  # tests/spss-parity (age, n = 120, p = 0.90 → 63.9, where type 7 gives 63.1).
  set.seed(51)
  x <- rnorm(30)
  probs <- c(0.05, 0.25, 0.5, 0.75, 0.95)
  expect_equal(wtd_quantile(x, probs = probs),
               unname(quantile(x, probs = probs, type = 6)),
               tolerance = 1e-12, "w = NULL uses HAVERAGE, not type 7")
  expect_true(!isTRUE(all.equal(unname(quantile(x, probs = probs, type = 6)),
                                unname(quantile(x, probs = probs, type = 7)))),
              "the two conventions really do differ on this sample")
})

test_that("wtd_quantile: integer weights equal the expanded sample's percentile", {
  # SPSS frequency-weight semantics: a weight-k case IS k identical cases, so
  # the reference is base R's own type-6 quantile of the expanded vector.
  # Hand-checked for x = (10, 20, 30), w = (1, 2, 1) → (10, 20, 20, 30), W = 4:
  #   p=0.10 → h = 0.50 < 1  → boundary: 10
  #   p=0.25 → h = 1.25      → 10 + 0.25·(20-10) = 12.5
  #   p=0.50 → h = 2.50      → 20 + 0.50·(20-20) = 20
  #   p=0.75 → h = 3.75      → 20 + 0.75·(30-20) = 27.5
  #   p=0.95 → h = 4.75 > W  → boundary: 30
  probs <- c(0.10, 0.25, 0.50, 0.75, 0.95)
  got <- wtd_quantile(c(10, 20, 30), c(1, 2, 1), probs = probs)
  expect_equal(got, c(10, 12.5, 20, 27.5, 30), tolerance = 1e-9,
               "hand-computed HAVERAGE quantiles")
  expect_equal(got, unname(quantile(c(10, 20, 20, 30), probs = probs, type = 6)),
               tolerance = 1e-12, "equals the expanded sample's type-6 quantile")
})

test_that("wtd_quantile: fractional weights interpolate on the weight scale", {
  # x = (1, 2), w = (0.5, 1.5): cumulative weights (0.5, 2.0), W = 2.
  #   p=0.5 → tc = 0.5·(2+1) = 1.5; both the floor (1) and ceiling (2) of that
  #   position fall inside case 2's weight span (0.5 … 2.0), so the percentile
  #   is that case's value. Under frequency-weight semantics the light case
  #   simply does not reach the median.
  got <- wtd_quantile(c(1, 2), c(0.5, 1.5), probs = 0.5)
  expect_equal(got, 2, tolerance = 1e-12, "fractional-weight interpolated quantile")
})

test_that("wtd_quantile: scaling every weight replicates the sample", {
  # Constant weights c·1 are NOT a no-op, and must not be: c = 3 means every
  # case counts three times, so the effective n triples and h = p(W+1) moves.
  # (The old implementation was scale-invariant here, which is what a
  # frequency weight is precisely not.) Reference: base R on the expanded data.
  set.seed(52)
  x <- rnorm(12)
  probs <- c(0.1, 0.25, 0.5, 0.9)
  for (c_ in c(2, 3)) {
    expect_equal(wtd_quantile(x, rep(c_, 12), probs = probs),
                 unname(quantile(rep(sort(x), each = c_), probs = probs, type = 6)),
                 tolerance = 1e-12, sprintf("w = %d·1 equals the %d× expansion", c_, c_))
  }
})

test_that("wtd_quantile: NA values are dropped before ranking", {
  got <- wtd_quantile(c(1, NA, 3, 5), c(1, 1, 1, 1), probs = 0.5)
  ref <- wtd_quantile(c(1, 3, 5), c(1, 1, 1), probs = 0.5)
  expect_equal(got, ref, tolerance = 1e-12, "NA x dropped (weight kept position ignored)")
})

test_that("wtd_quantile: zero-weight rows do not move the percentile", {
  # This used to be a documented deviation: the midweight method pinned an
  # anchor at a w = 0 case's value, so a case SPSS excludes entirely could
  # still drag an interpolated percentile (p = 0.4 came out 2.2 instead of
  # 20.8). Positioning on the cumulative weight scale removes it for free — a
  # zero-weight case adds nothing to cumsum(w) and is therefore never the
  # first case to reach a target position. Now an equality assertion, as the
  # old comment invited.
  with_zero <- wtd_quantile(c(1, 3, 100), c(1, 0, 1), probs = c(0.25, 0.4, 0.5))
  dropped   <- wtd_quantile(c(1, 100), c(1, 1), probs = c(0.25, 0.4, 0.5))
  expect_equal(with_zero, dropped, tolerance = 1e-12,
               "w = 0 case is invisible, as in SPSS")
})
