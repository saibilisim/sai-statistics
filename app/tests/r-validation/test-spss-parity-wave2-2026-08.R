# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-spss-parity-wave2-2026-08.R — regression tests for the four defects that
# tests/spss-parity found when it was widened past its first ten procedures.
#
# Each is pinned against an INDEPENDENT reference (base R's own test function,
# or the textbook definition computed here), never against the script itself.

# Defined here, not borrowed: the closing report() used to read a .standalone
# that only an alphabetically earlier file had set, so running this file on its
# own (or first) died with "object '.standalone' not found".
.standalone <- !exists("test_that")
if (.standalone) source("_harness.R")

# ── 1. Friedman: the statistic must be tie-corrected ────────────────────────
test_that("friedman: tie-corrected chi-square matches stats::friedman.test", {
  # The uncorrected formula 12/(n·k·(k+1))·ΣRj² − 3n(k+1) assumes no ties
  # within a case. Likert-type items are nothing but ties, and it is biased
  # downward: on the parity fixture it gave 0.517 where SPSS and
  # friedman.test both give 0.768 (p .772 vs .681 — enough to flip a call).
  set.seed(4711)
  n <- 120
  lat <- rnorm(n)
  mk <- function() pmin(5, pmax(1, round(3 + 0.9 * lat + rnorm(n, 0, 0.8))))
  df <- data.frame(col_1 = mk(), col_2 = mk(), col_3 = mk())

  ref <- stats::friedman.test(as.matrix(df))

  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3"),
    varNames = list(col_1 = "q1", col_2 = "q2", col_3 = "q3")
  ))
  result <- run_analysis_script("npar-friedman.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  ts <- find_table(result, "output.npar.testStatsTitle")

  expect_equal(cell_num(ts, 1, 2), unname(ref$statistic), tolerance = 1e-3,
               "chi-square matches friedman.test")
  expect_equal(cell_num(ts, 1, 4), unname(ref$p.value), tolerance = 1e-4,
               "p matches friedman.test")

  # And the correction really is doing something on this data — otherwise the
  # assertions above would pass with the old formula too.
  m <- as.matrix(df)
  R <- t(apply(m, 1, rank))
  k <- ncol(m)
  uncorrected <- (12 / (n * k * (k + 1))) * sum(colSums(R)^2) - 3 * n * (k + 1)
  expect_true(abs(uncorrected - unname(ref$statistic)) > 0.05,
              "fixture actually has ties (uncorrected != corrected)")
})

# ── 2. Wilcoxon signed-rank: float noise must not create/destroy ties ───────
test_that("wilcoxon: near-tied |differences| are ranked as tied", {
  # Two-decimal data subtracted in binary floating point yields values like
  # 1.8399999999999892 and 1.8400000000000034 for a pair that is tied at 1.84.
  # Ranking them apart moves half a rank between the sign groups and shifts Z.
  # Constructed so the near-tie straddles the sign boundary, as in the fixture.
  # The first two pairs are the real ones from tests/spss-parity/data.csv:
  # 122.04 - 123.88 = -1.8399999999999892 and 79.36 - 77.52 = 1.8400000000000034.
  # Both are 1.84 in the data and neither is 1.84 in a double, so they are a
  # tie that only a rounded comparison can see — and they straddle the sign
  # boundary, which is what makes the rank sums half-integers.
  a <- c(123.88, 77.52, 30.00, 40.00, 50.00, 60.00)
  b <- c(122.04, 79.36, 33.00, 45.00, 57.00, 69.00)
  df <- data.frame(col_1 = a, col_2 = b)
  d <- b - a
  expect_true(!any(duplicated(abs(d))), "the tie is invisible to == (float noise)")
  expect_true(any(duplicated(round(abs(d), 10))), "and visible once rounded")

  fixture <- write_fixture(df, list(
    var1 = list("col_1"), var2 = list("col_2"),
    varNames = list(col_1 = "pre", col_2 = "post")
  ))
  result <- run_analysis_script("npar-wilcoxon.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  ranks <- find_table(result, "output.npar.ranksTitle")

  # Reference: average ranks of the ROUNDED absolute differences.
  r <- rank(round(abs(d), 10))
  expect_equal(cell_num(ranks, 1, 5), sum(r[d < 0]), tolerance = 1e-9,
               "negative rank sum")
  expect_equal(cell_num(ranks, 2, 5), sum(r[d > 0]), tolerance = 1e-9,
               "positive rank sum")
  # A tie straddling the sign boundary makes both sums half-integers; that is
  # the property the old code lost.
  expect_true(abs(cell_num(ranks, 1, 5) %% 1 - 0.5) < 1e-9,
              "the straddling tie produces a half-integer sum")
})

# ── 3. ROC: SE under the nonparametric assumption is SPSS's, not the shortcut ─
test_that("roc: standard error is the nonparametric one, not Hanley-McNeil's shortcut", {
  set.seed(99)
  n <- 120
  score <- rnorm(n, 50, 12)
  state <- rbinom(n, 1, 1 / (1 + exp(-(score - 50) / 8)))
  df <- data.frame(col_1 = score, col_2 = state)

  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    stateVar = "col_2", stateName = "state", stateValue = "1"
  ))
  result <- run_analysis_script("roc.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  auc_tbl <- find_table(result, "output.roc.aucTitle")

  pos <- score[state == 1]; neg <- score[state == 0]
  n1 <- length(pos); n0 <- length(neg)
  nonpar <- spss_auc_se_ref(pos, neg)

  auc <- cell_num(auc_tbl, 1, 2)
  q1 <- auc / (2 - auc); q2 <- 2 * auc^2 / (1 + auc)
  hanley <- sqrt((auc * (1 - auc) + (n1 - 1) * (q1 - auc^2) +
                  (n0 - 1) * (q2 - auc^2)) / (n1 * n0))

  # Compared at the printed precision: the script rounds the SE to 3 decimals.
  expect_equal(cell_num(auc_tbl, 1, 3), round(nonpar, 3), tolerance = 1e-9, "SE is the SPSS nonparametric one")
  expect_true(abs(nonpar - hanley) > 5e-4,
              "the two formulas actually differ on this data")
})

# ── 4. Kaplan-Meier median: smallest t with S(t) <= 0.5 ────────────────────
test_that("survival-km: median is the first time the curve reaches 0.5", {
  # survfit()'s own `median` column returns the MIDPOINT of a flat 0.5 stretch,
  # which need not be an observed time: on the parity fixture S(13.26) = 0.5
  # exactly, the next event is at 13.94, and it reported 13.60 — a time at
  # which nothing happened — where SPSS reports 13.26.
  if (!requireNamespace("survival", quietly = TRUE)) {
    cat("  (skipped: survival not installed)\n")
    return(invisible())
  }
  # 10 uncensored cases: S drops 0.1 per event, so S = 0.5 exactly at the 5th.
  df <- data.frame(col_1 = c(1, 2, 3, 4, 5, 9, 11, 13, 17, 19),
                   col_2 = rep(1, 10))
  fixture <- write_fixture(df, list(
    timeVar = "col_1", timeName = "time", statusVar = "col_2",
    statusName = "status", eventValue = "1"
  ))
  result <- run_analysis_script("survival-km.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  med <- find_table(result, "output.survival.medianTitle")

  # Column 6, not 2: the table gained the mean block (mean, SE, CI) in front of
  # the median block when Kaplan-Meier's Options panel landed.
  expect_equal(cell_num(med, 1, 6), 5, tolerance = 1e-9,
               "median is the 5th event time, where S first reaches 0.5")

  # survfit's own column would say 7 here (the midpoint of [5, 9]).
  fit <- survival::survfit(survival::Surv(col_1, col_2) ~ 1, data = df)
  expect_equal(unname(summary(fit)$table["median"]), 7, tolerance = 1e-9,
               "survfit's midpoint convention is what we deliberately left")
})


# ── 5. Factor loadings carry SPSS's sign convention ────────────────────────
test_that("factor: each component is reflected so its dominant loading is positive", {
  # An eigenvector's sign is arbitrary, so LAPACK's choice is as good as any
  # mathematically and useless to a reader. Without the reflection the whole
  # Component Matrix came out negated (-.800 where SPSS prints .800), which
  # reads as "these items load negatively" and inverts every interpretation.
  set.seed(808)
  n <- 120
  lat <- rnorm(n)
  df <- data.frame(
    col_1 = lat + rnorm(n, 0, 0.5), col_2 = lat + rnorm(n, 0, 0.5),
    col_3 = lat + rnorm(n, 0, 0.5), col_4 = lat + rnorm(n, 0, 0.5)
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3", "col_4"),
    varNames = list(col_1 = "a", col_2 = "b", col_3 = "c", col_4 = "d"),
    options = list(rotation = "none", extraction = "pc")
  ))
  result <- run_analysis_script("factor.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  m <- find_table(result, "output.factor.matrixTitle")

  loads <- vapply(m$rows, function(r) as.numeric(r[[2]]), numeric(1))
  expect_true(loads[which.max(abs(loads))] > 0,
              "the dominant loading on component 1 is positive")
  # Magnitudes must be untouched by the reflection: checked against an
  # eigen-decomposition computed here, independently of the script.
  e <- eigen(cor(df), symmetric = TRUE)
  ref <- abs(e$vectors[, 1] * sqrt(e$values[1]))
  expect_equal(abs(loads), ref, tolerance = 1e-3, "loading magnitudes unchanged")
})

# ── 6. Discriminant: equal priors classify, but must not move the fit ──────
test_that("discriminant: the classification prior does not shift the eigenvalue", {
  if (!requireNamespace("MASS", quietly = TRUE)) {
    cat("  (skipped: MASS not installed)\n")
    return(invisible())
  }
  # Deliberately unequal groups, so the two prior choices disagree.
  set.seed(707)
  n1 <- 30; n2 <- 90
  df <- data.frame(
    col_1 = c(rnorm(n1, 1), rnorm(n2, 0)),
    col_2 = c(rnorm(n1, 0.5), rnorm(n2, 0)),
    col_g = c(rep(1, n1), rep(2, n2))
  )
  fixture <- write_fixture(df, list(
    groupVar = "col_g", groupName = "g",
    independents = list("col_1", "col_2"),
    varNames = list(col_1 = "x1", col_2 = "x2")
  ))
  result <- run_analysis_script("discriminant.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  dat <- data.frame(x1 = df$col_1, x2 = df$col_2, g = factor(df$col_g))
  fit <- MASS::lda(g ~ ., data = dat)
  equal_pct <- mean(predict(fit, prior = c(0.5, 0.5))$class == dat$g) * 100
  prop_pct <- mean(predict(fit)$class == dat$g) * 100
  expect_true(abs(equal_pct - prop_pct) > 1,
              "the two prior choices really do disagree on this data")

  cls <- find_table(result, "output.discriminant.classTitle")
  expect_equal(cell_num(cls, 1, 2), equal_pct, tolerance = 1e-6,
               "classification uses equal priors, as SPSS does")

  # ...and the eigenvalue still comes from the unweighted fit. Setting the
  # prior on lda() itself would move it, and Wilks' chi-square with it
  # (11.911 against SPSS's 11.908 — measured).
  eig <- find_table(result, "output.discriminant.eigTitle")
  ref_ev <- fit$svd^2 * (2 - 1) / (nrow(dat) - 2)
  expect_equal(cell_num(eig, 1, 2), ref_ev[1], tolerance = 1e-3,
               "eigenvalue unaffected by the classification prior")
})



# ── 7. Explore's IQR and trimmed mean ─────────────────────────────────────
test_that("explore: IQR uses HAVERAGE and the trimmed mean trims exactly 5%", {
  # Two defects the sub-option wave caught, both in the Descriptives table:
  #   * the unweighted branch called IQR(), i.e. R's type 7, so the same data
  #     gave a different interquartile range depending only on whether a weight
  #     variable happened to be set — and it disagreed with the Percentiles
  #     table printed two rows below it (16.360 vs 61.065 - 44.170 = 16.895);
  #   * mean(trim = 0.05) drops floor(n*0.05) WHOLE cases, so with n = 117 it
  #     removed 5 where 5.85 are called for (52.817 against SPSS's 52.813).
  set.seed(606)
  x <- round(rnorm(117, 50, 12), 2)
  df <- data.frame(col_1 = x)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    options = list(display = "statistics",
                   stats = list(descriptives = TRUE, percentiles = TRUE))
  ))
  result <- run_analysis_script("explore.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  desc <- find_table(result, "output.explore.descTitle")

  statv <- function(key) {
    for (r in desc$rows) if (identical(as.character(r[[1]]), key)) return(as.numeric(r[[2]]))
    NA_real_
  }

  # IQR reference: base R's own type-6 quantiles, computed here.
  q <- unname(quantile(x, c(0.25, 0.75), type = 6))
  expect_equal(statv("output.stat.iqr"), q[2] - q[1], tolerance = 1e-4,
               "IQR is Q3 - Q1 under HAVERAGE")
  expect_true(abs((q[2] - q[1]) - IQR(x)) > 1e-6,
              "type 6 and type 7 actually differ on this sample")

  # Trimmed mean reference: the interpolated definition, written out here.
  xs <- sort(x); n <- length(xs); w <- n * 0.05; k <- floor(w); r <- w - k
  ref <- ((1 - r) * (xs[k + 1] + xs[n - k]) + sum(xs[(k + 2):(n - k - 1)])) / (n - 2 * w)
  expect_equal(statv("output.stat.trimmedMean"), ref, tolerance = 1e-6,
               "5% trimmed mean trims fractional cases")
  expect_true(abs(ref - mean(x, trim = 0.05)) > 1e-6,
              "the whole-case trim actually differs on this sample")
})

if (.standalone) report()
