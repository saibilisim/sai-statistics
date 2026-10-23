# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-npar-kw-median-jt-2026-09.R — validates the Median test and the
# Jonckheere-Terpstra test added to npar-kruskal-wallis.R (K Independent
# Samples "Test Type" checkboxes), plus its per-group Descriptives/Quartiles
# table. Every reference value here is computed from scratch (chisq.test() on
# an independently-built table; a brute-force O(n^2) pair-counting J
# statistic with its own textbook tie-corrected variance formula) — never by
# calling back into the script's own rank()-based shortcuts.

test_that("Median test matches an independent chisq.test() on the above/at-or-below split", {
  set.seed(101)
  df <- data.frame(
    score = c(rnorm(15, 5), rnorm(15, 8), rnorm(15, 5.2)),
    grp = factor(rep(c("A", "B", "C"), each = 15))
  )
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    factor = "grp", factorName = "Group",
    options = list(testType = list(kruskalWallis = FALSE, median = TRUE))
  ))
  result <- run_analysis_script("npar-kruskal-wallis.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  # No Kruskal-Wallis tables when explicitly turned off.
  has_kw <- any(vapply(result$tables, function(t) startsWith(t$titleKey, "output.npar.ranksTitle"), logical(1)))
  expect_true(!has_kw, "Kruskal-Wallis tables absent when testType$kruskalWallis = FALSE")

  med <- median(df$score)
  above <- df$score > med
  ref_tab <- table(df$grp, above)
  ref <- chisq.test(ref_tab, correct = FALSE)

  freq <- find_table(result, "output.npar.medianFreqTitle")
  expect_true(length(freq$rows) == 3, "one Frequencies row per group")
  # Row 1 = group A: [name, group label, Above count, At-or-below count].
  expect_equal(cell_num(freq, 1, 3), sum(df$grp == "A" & above), tolerance = 1e-9, "A above-median count")
  expect_equal(cell_num(freq, 1, 4), sum(df$grp == "A" & !above), tolerance = 1e-9, "A at-or-below count")

  ts <- find_table(result, "output.npar.medianTestTitle")
  expect_equal(cell_num(ts, 1, 2), nrow(df), tolerance = 1e-9, "N")
  expect_equal(cell_num(ts, 1, 3), med, tolerance = 1e-4, "sample median")
  expect_equal(cell_num(ts, 1, 4), unname(ref$statistic), tolerance = 1e-4, "chi-square matches independent chisq.test()")
  expect_equal(cell_num(ts, 1, 5), unname(ref$parameter), tolerance = 1e-9, "df")
  expect_equal(cell_num(ts, 1, 6), ref$p.value, tolerance = 1e-3, "asymp. sig. matches independent chisq.test()")
})

test_that("Jonckheere-Terpstra matches a brute-force pair-counting J and its own tie-corrected variance", {
  set.seed(102)
  # Three ordered groups with a genuine monotone trend, plus deliberate ties
  # (round to 1dp) so the tie-correction terms are actually exercised.
  df <- data.frame(
    score = round(c(rnorm(12, 5), rnorm(12, 6), rnorm(12, 7.5)), 1),
    dose = factor(rep(c("1", "2", "3"), each = 12))
  )
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    factor = "dose", factorName = "Dose",
    options = list(testType = list(kruskalWallis = FALSE, jonckheereTerpstra = TRUE))
  ))
  result <- run_analysis_script("npar-kruskal-wallis.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  # Independent, brute-force reference: enumerate every pair across every
  # ordered group-pair by hand (no rank() shortcut), then the SAME
  # Hollander & Wolfe tie-corrected normal-approximation formula the script
  # documents, re-typed here rather than shared.
  lvls <- c("1", "2", "3")
  x <- df$score; g <- as.character(df$dose)
  J_ref <- 0
  for (i in 1:2) {
    for (j in (i + 1):3) {
      xi <- x[g == lvls[i]]; xj <- x[g == lvls[j]]
      for (a in xi) for (b in xj) {
        J_ref <- J_ref + (b > a) + 0.5 * (b == a)
      }
    }
  }
  n_i <- as.numeric(table(factor(g, levels = lvls)))
  N <- length(x)
  EJ_ref <- (N^2 - sum(n_i^2)) / 4
  tg <- as.numeric(table(x))
  term1 <- N * (N - 1) * (2 * N + 5) - sum(n_i * (n_i - 1) * (2 * n_i + 5)) - sum(tg * (tg - 1) * (2 * tg + 5))
  varJ_ref <- term1 / 72 +
    (sum(n_i * (n_i - 1) * (n_i - 2)) * sum(tg * (tg - 1) * (tg - 2))) / (36 * N * (N - 1) * (N - 2)) +
    (sum(n_i * (n_i - 1)) * sum(tg * (tg - 1))) / (8 * N * (N - 1))
  Z_ref <- (J_ref - EJ_ref) / sqrt(varJ_ref)
  p_ref <- 2 * pnorm(-abs(Z_ref))

  ts <- find_table(result, "output.npar.jtTestTitle")
  # Columns: variable, N, Levels, Observed J-T, Mean J-T, SD J-T, Std J-T, Asymp Sig.
  expect_equal(cell_num(ts, 1, 2), N, tolerance = 1e-9, "N")
  expect_equal(cell_num(ts, 1, 3), 3, tolerance = 1e-9, "3 levels")
  expect_equal(cell_num(ts, 1, 4), J_ref, tolerance = 1e-6, "Observed J-T statistic matches brute-force pair count")
  expect_equal(cell_num(ts, 1, 5), EJ_ref, tolerance = 1e-6, "Mean J-T statistic")
  expect_equal(cell_num(ts, 1, 6), sqrt(varJ_ref), tolerance = 1e-4, "SD of J-T statistic")
  expect_equal(cell_num(ts, 1, 7), Z_ref, tolerance = 1e-4, "Std. J-T statistic (Z)")
  expect_equal(cell_num(ts, 1, 8), p_ref, tolerance = 1e-3, "Asymp. Sig. (2-tailed)")

  # A genuine upward trend (group 3 >> group 1) must give a clearly positive,
  # significant Z — sanity check that the sign/direction convention is right.
  expect_true(Z_ref > 3, "strong monotone trend gives a large positive Z (sanity check)")
})

test_that("Jonckheere-Terpstra orders groups by NUMERIC factor value, not string order", {
  # "10" sorts before "2" alphabetically but must come AFTER it numerically —
  # construct data where only the numeric order gives the true monotone trend,
  # so a string-order bug would flip the sign of Z.
  set.seed(103)
  df <- data.frame(
    score = c(rnorm(10, 5), rnorm(10, 6), rnorm(10, 8)),
    code = factor(rep(c("2", "3", "10"), each = 10))
  )
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    factor = "code", factorName = "Code",
    options = list(testType = list(kruskalWallis = FALSE, jonckheereTerpstra = TRUE))
  ))
  result <- run_analysis_script("npar-kruskal-wallis.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  ts <- find_table(result, "output.npar.jtTestTitle")
  # Numeric order (2 < 3 < 10) matches the constructed upward trend -> large
  # positive Z. String order (10 < 2 < 3) would scramble it toward ~0 or
  # negative.
  expect_true(cell_num(ts, 1, 7) > 2, "Z reflects numeric group order (2 < 3 < 10), not string order")
})

test_that("Descriptives/Quartiles table (K Independent Samples) matches base R per group and Total", {
  set.seed(104)
  df <- data.frame(
    score = c(rnorm(10, 5), rnorm(10, 8), rnorm(10, 5.5)),
    grp = factor(rep(c("A", "B", "C"), each = 10))
  )
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    factor = "grp", factorName = "Group",
    options = list(descriptives = TRUE, quartiles = TRUE)
  ))
  result <- run_analysis_script("npar-kruskal-wallis.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  desc <- find_table(result, "output.npar.descriptivesTitle")
  # Row 1 = Total, rows 2-4 = groups A, B, C (Total-first, per the script).
  expect_equal(cell_num(desc, 1, 3), nrow(df), tolerance = 1e-9, "Total N")
  expect_equal(cell_num(desc, 1, 4), mean(df$score), tolerance = 1e-3, "Total mean")
  expect_equal(cell_num(desc, 1, 5), sd(df$score), tolerance = 1e-3, "Total SD")

  xa <- df$score[df$grp == "A"]
  expect_equal(cell_num(desc, 2, 3), length(xa), tolerance = 1e-9, "A: N")
  expect_equal(cell_num(desc, 2, 4), mean(xa), tolerance = 1e-3, "A: mean")
  expect_equal(cell_num(desc, 2, 6), min(xa), tolerance = 1e-3, "A: min")
  expect_equal(cell_num(desc, 2, 10), max(xa), tolerance = 1e-3, "A: max")
})