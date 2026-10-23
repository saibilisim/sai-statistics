# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-discriminant-explore-casesum.R — validates:
#   r-scripts/discriminant.R    (SPSS-style discriminant analysis)
#   r-scripts/explore.R         (SPSS-style Explore: descriptives + Shapiro-Wilk)
#   r-scripts/case-summaries.R  (SPSS SUMMARIZE: case listing + N/Mean/SD)
#
# References are computed independently of the scripts under test:
#   - discriminant: eigen decomposition of W^-1 B built from raw scatter
#     matrices (base R matrix ops), Wilks' Lambda via det(W)/det(W+B),
#     Bartlett's chi-square approximation (SPSS formula), and classification
#     accuracy from MASS::lda + predict (installed package).
#   - explore: base R mean/sd/var/median/quantile/IQR, canonical adjusted
#     Fisher-Pearson G1/G2 (NIST definitions, same as test-skewness-kurtosis.R),
#     SPSS SE formulas, stats::shapiro.test().
#   - case-summaries: base R per-group length/mean/sd and order().

# ── Shared reference helpers (base R only) ───────────────────────────────────

# Canonical adjusted Fisher-Pearson skewness G1 from BIASED population moments
# (NIST/Wikipedia definition; SPSS matches this — see test-skewness-kurtosis.R).
ref_skewness_G1 <- function(x) {
  n <- length(x); m <- mean(x)
  m2 <- mean((x - m)^2); m3 <- mean((x - m)^3)
  sqrt(n * (n - 1)) / (n - 2) * (m3 / m2^1.5)
}

# Canonical Fisher excess kurtosis G2 from BIASED population moments.
ref_kurtosis_G2 <- function(x) {
  n <- length(x); m <- mean(x)
  m2 <- mean((x - m)^2); m4 <- mean((x - m)^4)
  g2 <- m4 / m2^2 - 3
  (n - 1) / ((n - 2) * (n - 3)) * ((n + 1) * g2 + 6)
}

ref_se_skew <- function(n) sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3)))
ref_se_kurt <- function(n) sqrt(4 * (n^2 - 1) * ref_se_skew(n)^2 / ((n - 3) * (n + 5)))

# Independent discriminant reference (SPSS definitions, base R matrix ops —
# NOT via fit$svd, which is what the script uses):
#   eigenvalues = eigen of W^-1 B on the raw within/between SSCP matrices
#   canonical correlations = sqrt(ev/(1+ev))  (== stats::cancor on group dummies)
#   Wilks' Lambda = det(W)/det(W+B)           (== stats::manova Wilks)
#   Bartlett chi-square = -(n-1-(p+g)/2) * ln(Lambda), df = p*(g-1)  (SPSS formula)
# Classification accuracy reference: MASS::lda + predict (installed package).
ref_discriminant <- function(X, grp) {
  grp <- factor(grp)
  n <- nrow(X); p <- ncol(X); g <- nlevels(grp)
  grand <- colMeans(X)
  W <- matrix(0, p, p); B <- matrix(0, p, p)
  for (lv in levels(grp)) {
    Xg <- X[grp == lv, , drop = FALSE]
    ng <- nrow(Xg); mg <- colMeans(Xg)
    W <- W + crossprod(scale(Xg, center = mg, scale = FALSE))
    d <- matrix(mg - grand, nrow = 1)
    B <- B + ng * crossprod(d)
  }
  # Raw SSCP matrices: a common scale factor cancels in W^-1 B, so these give
  # the SPSS-canonical discriminant eigenvalues directly. (MASS::lda()$svd^2
  # are the same eigenvalues inflated by (n-g)/(g-1) — verified numerically —
  # which is why this reference deliberately avoids them.)
  ev_all <- Re(eigen(solve(W, B), symmetric = FALSE, only.values = TRUE)$values)
  ev <- sort(ev_all[ev_all > 1e-8], decreasing = TRUE)
  wilks <- det(W) / det(W + B)
  chi <- -(n - 1 - (p + g) / 2) * log(wilks)
  df <- p * (g - 1)
  list(
    ev = ev,
    pct = ev / sum(ev) * 100,
    cancorr = sqrt(ev / (1 + ev)),
    wilks = wilks, chi = chi, df = df,
    p = pchisq(chi, df, lower.tail = FALSE)
  )
}

# ══ discriminant.R ═══════════════════════════════════════════════════════════

test_that("discriminant: 3-group iris matches independent W^-1 B eigen reference", {
  df <- data.frame(
    col_1 = iris$Sepal.Length, col_2 = iris$Sepal.Width,
    col_3 = iris$Petal.Length, col_4 = as.character(iris$Species),
    stringsAsFactors = FALSE
  )
  fixture <- write_fixture(df, list(
    groupVar = "col_4", groupName = "species",
    independents = list("col_1", "col_2", "col_3"),
    varNames = list(col_1 = "sl", col_2 = "sw", col_3 = "pl")
  ))
  result <- run_analysis_script("discriminant.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  X <- as.matrix(df[, c("col_1", "col_2", "col_3")])
  ref <- ref_discriminant(X, df$col_4)

  eig_table <- find_table(result, "output.discriminant.eigTitle")
  # 2 functions (min(g-1, p)); rows: function, eigenvalue, %var, cum%, cancorr
  expect_equal(length(eig_table$rows), 2L, tolerance = 0, "two discriminant functions")
  # cells are round(x, 3) / round(x, 1) in the script — assert within rounding half-ulp
  expect_lt(abs(cell_num(eig_table, 1, 2) - ref$ev[1]), 5.1e-4, "eigenvalue fn1")
  expect_lt(abs(cell_num(eig_table, 2, 2) - ref$ev[2]), 5.1e-4, "eigenvalue fn2")
  expect_lt(abs(cell_num(eig_table, 1, 3) - ref$pct[1]), 0.051, "% variance fn1")
  expect_lt(abs(cell_num(eig_table, 2, 4) - 100), 0.051, "cumulative % fn2")
  expect_lt(abs(cell_num(eig_table, 1, 5) - ref$cancorr[1]), 5.1e-4, "canonical corr fn1")
  expect_lt(abs(cell_num(eig_table, 2, 5) - ref$cancorr[2]), 5.1e-4, "canonical corr fn2")

  wilks_table <- find_table(result, "output.discriminant.wilksTitle")
  expect_lt(abs(cell_num(wilks_table, 1, 1) - ref$wilks), 5.1e-4, "Wilks' Lambda")
  expect_lt(abs(cell_num(wilks_table, 1, 2) - ref$chi), 5.1e-4, "Bartlett chi-square")
  expect_equal(cell_num(wilks_table, 1, 3), ref$df, tolerance = 0, "Wilks df")
  expect_lt(abs(cell_num(wilks_table, 1, 4) - ref$p), 5.1e-7, "Wilks p (rounded to 6)")

  # Classification accuracy vs MASS::lda resubstitution
  fit <- MASS::lda(X, grouping = factor(df$col_4))
  ref_pct <- mean(predict(fit)$class == factor(df$col_4)) * 100
  class_table <- find_table(result, "output.discriminant.classTitle")
  expect_lt(abs(cell_num(class_table, 1, 2) - ref_pct), 0.051, "% correctly classified")
})

test_that("discriminant: 2-group synthetic data matches reference (1 function)", {
  set.seed(99)
  n1 <- 40; n2 <- 40
  df <- data.frame(
    col_1 = c(rnorm(n1, 0, 1), rnorm(n2, 0.8, 1)),
    col_2 = c(rnorm(n1, 0, 1), rnorm(n2, -0.5, 1)),
    col_3 = rep(c("A", "B"), c(n1, n2)),
    stringsAsFactors = FALSE
  )
  fixture <- write_fixture(df, list(
    groupVar = "col_3", groupName = "grp",
    independents = list("col_1", "col_2"),
    varNames = list(col_1 = "x1", col_2 = "x2")
  ))
  result <- run_analysis_script("discriminant.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  X <- as.matrix(df[, c("col_1", "col_2")])
  ref <- ref_discriminant(X, df$col_3)
  expect_equal(length(ref$ev), 1L, tolerance = 0, "reference has one function")

  eig_table <- find_table(result, "output.discriminant.eigTitle")
  expect_equal(length(eig_table$rows), 1L, tolerance = 0, "one discriminant function")
  expect_lt(abs(cell_num(eig_table, 1, 2) - ref$ev[1]), 5.1e-4, "eigenvalue")
  expect_lt(abs(cell_num(eig_table, 1, 5) - ref$cancorr[1]), 5.1e-4, "canonical corr")

  wilks_table <- find_table(result, "output.discriminant.wilksTitle")
  expect_lt(abs(cell_num(wilks_table, 1, 1) - ref$wilks), 5.1e-4, "Wilks' Lambda")
  expect_lt(abs(cell_num(wilks_table, 1, 2) - ref$chi), 5.1e-4, "chi-square")
  expect_equal(cell_num(wilks_table, 1, 3), ref$df, tolerance = 0, "df = p*(g-1)")
  expect_lt(abs(cell_num(wilks_table, 1, 4) - ref$p), 5.1e-7, "p-value")

  fit <- MASS::lda(X, grouping = factor(df$col_3))
  ref_pct <- mean(predict(fit)$class == factor(df$col_3)) * 100
  class_table <- find_table(result, "output.discriminant.classTitle")
  expect_lt(abs(cell_num(class_table, 1, 2) - ref_pct), 0.051, "% correctly classified")
})

# ══ explore.R ════════════════════════════════════════════════════════════════

test_that("explore: descriptives table matches base R references (no factor)", {
  set.seed(21)
  x <- c(rgamma(40, shape = 3, rate = 1), NA)  # NA exercises the !is.na filter
  df <- data.frame(col_1 = x)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    options = list(
      display = "statistics",
      stats = list(descriptives = TRUE, percentiles = FALSE),
      plots = list(boxplot = FALSE, histogram = FALSE, normality = FALSE)
    )
  ))
  result <- run_analysis_script("explore.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  v <- x[!is.na(x)]
  n <- length(v)
  m <- mean(v); s <- sd(v); se <- s / sqrt(n); marg <- qt(0.975, df = n - 1) * se

  desc <- find_table(result, "output.explore.descTitle:score")
  # rows: (statisticKey, value), order fixed by the script
  expect_equal(cell_num(desc, 1, 2), n, tolerance = 0, "N")
  expect_equal(cell_num(desc, 2, 2), m, tolerance = 1e-5, "mean")
  expect_equal(cell_num(desc, 3, 2), se, tolerance = 1e-5, "SE mean")
  expect_equal(cell_num(desc, 4, 2), m - marg, tolerance = 1e-5, "CI lower")
  expect_equal(cell_num(desc, 5, 2), m + marg, tolerance = 1e-5, "CI upper")
  expect_equal(cell_num(desc, 6, 2), mean(v, trim = 0.05), tolerance = 1e-5, "5% trimmed mean")
  expect_equal(cell_num(desc, 7, 2), median(v), tolerance = 1e-5, "median")
  expect_equal(cell_num(desc, 8, 2), var(v), tolerance = 1e-5, "variance")
  expect_equal(cell_num(desc, 9, 2), s, tolerance = 1e-5, "std deviation")
  expect_equal(cell_num(desc, 10, 2), min(v), tolerance = 1e-5, "minimum")
  expect_equal(cell_num(desc, 11, 2), max(v), tolerance = 1e-5, "maximum")
  expect_equal(cell_num(desc, 12, 2), diff(range(v)), tolerance = 1e-5, "range")
  # type 6 = SPSS HAVERAGE, the rule wtd_quantile() uses for every percentile;
  # IQR() is type 7 and disagreed with the Percentiles table in the same output.
  expect_equal(cell_num(desc, 13, 2),
               diff(unname(quantile(v, c(0.25, 0.75), type = 6))),
               tolerance = 1e-5, "IQR")
  expect_equal(cell_num(desc, 14, 2), ref_skewness_G1(v), tolerance = 1e-5, "skewness (G1)")
  expect_equal(cell_num(desc, 15, 2), ref_se_skew(n), tolerance = 1e-5, "SE skewness")
  expect_equal(cell_num(desc, 16, 2), ref_kurtosis_G2(v), tolerance = 1e-5, "kurtosis (G2)")
  expect_equal(cell_num(desc, 17, 2), ref_se_kurt(n), tolerance = 1e-5, "SE kurtosis")

  # display="statistics" + all plot options off → no plots, no normality table
  expect_equal(length(result$plots), 0L, tolerance = 0, "no plots in statistics-only mode")
  has_normality_table <- any(vapply(
    result$tables, function(t) startsWith(t$titleKey, "output.explore.normalityTitle"), logical(1)
  ))
  expect_true(!has_normality_table, "no normality table when normality option off")
})

test_that("explore: normality table matches lillie.test()/ks.test() + shapiro.test()", {
  set.seed(22)
  df <- data.frame(col_1 = rnorm(60, mean = 5, sd = 2))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "x"),
    options = list(
      display = "statistics",
      stats = list(descriptives = FALSE),
      plots = list(boxplot = FALSE, histogram = FALSE, normality = TRUE)
    )
  ))
  result <- run_analysis_script("explore.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  sw <- shapiro.test(df$col_1)
  # Same branch explore.R (and normality.R) take: Lilliefors when nortest is
  # visible, plain ks.test() fallback otherwise.
  ks <- if (requireNamespace("nortest", quietly = TRUE)) {
    nortest::lillie.test(df$col_1)
  } else {
    suppressWarnings(ks.test(df$col_1, "pnorm", mean = mean(df$col_1), sd = sd(df$col_1)))
  }

  nt <- find_table(result, "output.explore.normalityTitle:x")
  # row: (group, ksStat, ksDf, ksSig, swStat, swDf, swSig)
  expect_equal(cell_num(nt, 1, 2), unname(ks$statistic), tolerance = 1e-4,
               "K-S statistic (script's own branch)")
  expect_equal(cell_num(nt, 1, 3), 60, tolerance = 0, "K-S df = n")
  expect_equal(cell_num(nt, 1, 4), ks$p.value, tolerance = 1e-3, "K-S p-value")
  expect_equal(cell_num(nt, 1, 5), unname(sw$statistic), tolerance = 1e-5, "Shapiro W")
  expect_equal(cell_num(nt, 1, 6), 60, tolerance = 0, "normality df = n")
  expect_equal(cell_num(nt, 1, 7), sw$p.value, tolerance = 1e-5, "Shapiro p")
})

test_that("explore: grouped descriptives match per-group base R references", {
  set.seed(23)
  df <- data.frame(
    col_1 = c(rnorm(30, 10, 2), rnorm(25, 14, 3)),
    col_2 = rep(c("A", "B"), c(30, 25)),
    stringsAsFactors = FALSE
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    factors = list("col_2"), factorNames = list(col_2 = "grp"),
    options = list(
      display = "statistics",
      stats = list(descriptives = TRUE, percentiles = FALSE),
      plots = list(boxplot = FALSE, histogram = FALSE, normality = TRUE)
    )
  ))
  result <- run_analysis_script("explore.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  for (i in 1:2) {
    lv <- c("A", "B")[i]
    v <- df$col_1[df$col_2 == lv]
    # Grouped titles name the factor as well as the level ("score (grp = A)"),
    # so the table stays self-describing when several factors are crossed.
    desc <- find_table(result, paste0("output.explore.descTitle:score (grp = ", lv, ")"))
    expect_equal(cell_num(desc, 1, 2), length(v), tolerance = 0, paste("N", lv))
    expect_equal(cell_num(desc, 2, 2), mean(v), tolerance = 1e-5, paste("mean", lv))
    expect_equal(cell_num(desc, 9, 2), sd(v), tolerance = 1e-5, paste("sd", lv))
    expect_equal(cell_num(desc, 14, 2), ref_skewness_G1(v), tolerance = 1e-5, paste("skewness", lv))
    expect_equal(cell_num(desc, 16, 2), ref_kurtosis_G2(v), tolerance = 1e-5, paste("kurtosis", lv))
  }

  # normality table has one row per group, in sorted group order
  # columns: (group, ksStat, ksDf, ksSig, swStat, swDf, swSig)
  nt <- find_table(result, "output.explore.normalityTitle:score")
  expect_equal(length(nt$rows), 2L, tolerance = 0, "normality rows = 2 groups")
  ref_a <- shapiro.test(df$col_1[df$col_2 == "A"])
  ref_b <- shapiro.test(df$col_1[df$col_2 == "B"])
  expect_equal(cell_num(nt, 1, 5), unname(ref_a$statistic), tolerance = 1e-5, "Shapiro W (A)")
  expect_equal(cell_num(nt, 1, 7), ref_a$p.value, tolerance = 1e-5, "Shapiro p (A)")
  expect_equal(cell_num(nt, 2, 5), unname(ref_b$statistic), tolerance = 1e-5, "Shapiro W (B)")
  expect_equal(cell_num(nt, 2, 7), ref_b$p.value, tolerance = 1e-5, "Shapiro p (B)")
})

test_that("explore: factorValueLabels resolve group codes in boxplot/table labels", {
  # Graphs > Boxplot resolves group codes through groupValueLabels
  # (chart.R:158); Explore previously showed the raw factor code ("1"/"2")
  # in the boxplot legend, Percentiles/M-Estimators/Extreme Values rows,
  # table titles and the Case Processing Summary because it never received
  # or applied a value-label map. This locks in the fix.
  set.seed(25)
  df <- data.frame(
    col_1 = c(rnorm(20, 10, 2), rnorm(18, 14, 3)),
    col_2 = rep(c("1", "2"), c(20, 18)),
    stringsAsFactors = FALSE
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    factors = list("col_2"), factorNames = list(col_2 = "grp"),
    factorValueLabels = list(col_2 = list(`1` = "Male", `2` = "Female")),
    options = list(
      display = "both",
      stats = list(descriptives = FALSE, percentiles = TRUE, outliers = TRUE),
      plots = list(boxplot = TRUE, histogram = FALSE, normality = FALSE)
    )
  ))
  result <- run_analysis_script("explore.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  # Percentiles table rows are labelled with the resolved group name.
  pct <- find_table(result, "output.explore.percentilesTitle:score")
  pct_labels <- vapply(pct$rows, function(r) as.character(r[[2]]), character(1))
  expect_true(all(c("Male", "Female") %in% pct_labels), "percentile rows use resolved labels")
  expect_true(!any(c("1", "2") %in% pct_labels), "percentile rows do not leak raw codes")

  # Case Processing Summary's group column is resolved too.
  cps <- find_table(result, "output.cps.title")
  cps_labels <- vapply(cps$rows, function(r) as.character(r[[2]]), character(1))
  expect_true(all(c("Male", "Female") %in% cps_labels), "case processing summary uses resolved labels")

  # Boxplot trace names (plot legend) are resolved, not raw codes.
  box_plot <- Filter(function(p) startsWith(p$titleKey, "output.explore.boxplotTitle"), result$plots)[[1]]
  trace_names <- vapply(box_plot$data$data, function(tr) tr$name, character(1))
  expect_true(all(c("Male", "Female") %in% trace_names), "boxplot legend uses resolved labels")

  # Title, axes and legend must all be present (previously the boxplot had no
  # x-axis title at all and the legend was forced off, same "which
  # variable/group is this" complaint as the resolved-code bug above).
  expect_equal(box_plot$titleKey, "output.explore.boxplotTitle:score", "title names the dependent")
  expect_equal(box_plot$data$layout$yaxis$title$text, "score", "y-axis names the dependent")
  expect_equal(box_plot$data$layout$xaxis$title$text, "grp", "x-axis names the factor")
  expect_true(isTRUE(box_plot$data$layout$showlegend), "legend is on")
})

test_that("explore: display='both' emits boxplot, histogram and Q-Q plots", {
  set.seed(24)
  df <- data.frame(col_1 = rnorm(50))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "x"),
    options = list(
      display = "both",
      stats = list(descriptives = TRUE, percentiles = FALSE),
      plots = list(boxplot = TRUE, histogram = TRUE, normality = TRUE)
    )
  ))
  result <- run_analysis_script("explore.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  plot_keys <- vapply(result$plots, function(p) p$titleKey, character(1))
  expect_true(any(startsWith(plot_keys, "output.explore.boxplotTitle")), "boxplot emitted")
  expect_true(any(startsWith(plot_keys, "output.explore.histTitle")), "histogram emitted")
  expect_true(any(startsWith(plot_keys, "output.explore.qqTitle")), "Q-Q plot emitted")
})

# ══ case-summaries.R ═════════════════════════════════════════════════════════

test_that("case-summaries: ungrouped listing + total summary match base R", {
  set.seed(31)
  df <- data.frame(
    col_1 = rnorm(20, 50, 10),
    col_2 = sample(c("red", "blue"), 20, replace = TRUE),
    stringsAsFactors = FALSE
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "score", col_2 = "color")
  ))
  result <- run_analysis_script("case-summaries.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  list_table <- find_table(result, "output.caseSummaries.listTitle")
  expect_equal(length(list_table$rows), 20L, tolerance = 0, "all 20 cases listed (default limit 100)")
  # case numbers are sequential; values match the original row order
  expect_equal(cell_num(list_table, 1, 1), 1, tolerance = 0, "case number 1")
  expect_equal(cell_num(list_table, 5, 2), df$col_1[5], tolerance = 1e-9, "row 5 value matches df")
  expect_equal(cell_num(list_table, 20, 2), df$col_1[20], tolerance = 1e-9, "row 20 value matches df")
  expect_true(list_table$rows[[3]][[3]] == df$col_2[3], "character value passes through")

  summary_table <- find_table(result, "output.caseSummaries.summaryTitle")
  # No groupVar → one Total block. It now holds a row per variable INCLUDING
  # the string col_2: SPSS reports N/Minimum/Maximum/First/Last for a string
  # column and leaves the arithmetic cells blank, which this script used to
  # skip entirely (it filtered to numeric variables).
  expect_equal(length(summary_table$rows), 2L, tolerance = 0, "one row per variable")
  expect_equal(cell_num(summary_table, 1, 3), 20, tolerance = 0, "total N")
  expect_equal(cell_num(summary_table, 1, 4), mean(df$col_1), tolerance = 1e-5, "total mean")
  # This run selects no statistics, so the default trio applies (N, Mean,
  # Std. Deviation) and column 5 is still the standard deviation — the shared
  # registry reorders the full menu, but a three-statistic selection lands the
  # same way.
  expect_equal(cell_num(summary_table, 1, 5), sd(df$col_1), tolerance = 1e-5, "total sd")
})

test_that("case-summaries: grouped + limitCases match base R per-group stats", {
  set.seed(32)
  df <- data.frame(
    col_1 = c(rnorm(6, 100, 5), rnorm(6, 200, 5)),
    col_3 = rep(c("B", "A"), each = 6),  # unsorted on purpose: listing must sort by group
    stringsAsFactors = FALSE
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1"),
    varNames = list(col_1 = "score"),
    groupVar = "col_3", groupVarName = "grp",
    limitCases = 5L
  ))
  result <- run_analysis_script("case-summaries.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  list_table <- find_table(result, "output.caseSummaries.listTitle")
  expect_equal(length(list_table$rows), 5L, tolerance = 0, "listing limited to 5 cases")
  expect_equal(
    list_table$footnoteKey, "output.caseSummaries.limitedFootnote:5|12",
    tolerance = 0, "limited footnote 5|12"
  )
  # The limit takes the first 5 cases in FILE order — rows 1..5, all group B —
  # and only then groups them for display. This assertion previously required
  # the opposite (sort by group first, so the listing was all group A): that
  # was the defect a manual SPSS comparison exposed, where a 100-case limit on
  # a 309-case file listed 100 cases of one category and never reached the
  # other, while SPSS listed 48 + 52.
  ord <- seq_len(5)
  expect_true(all(vapply(list_table$rows, function(r) r[[2]], character(1)) == "B"),
              "first 5 listed cases are the file's first 5 (group B)")
  expect_equal(cell_num(list_table, 1, 3), df$col_1[ord[1]], tolerance = 1e-9, "first listed value")
  expect_equal(cell_num(list_table, 5, 3), df$col_1[ord[5]], tolerance = 1e-9, "fifth listed value")

  # "Limit cases to first N" restricts the WHOLE procedure, not just the
  # listing — verified against SPSS's own output (manuel-test/: with the limit
  # at 100 of 309 cases SPSS reports group Ns of 48/52/100, not 139/170/309).
  # This script used to summarise the full file while the listing above showed
  # only the first N, putting two different Ns for the same groups on one
  # screen. Here the first 5 cases in file order are all group B, so group A
  # falls outside the limit and drops out of the summary entirely.
  summary_table <- find_table(result, "output.caseSummaries.summaryTitle")
  expect_equal(length(summary_table$rows), 2L, tolerance = 0, "B + Total rows (A outside the limit)")
  x_limited <- df$col_1[ord[seq_len(5)]]
  expect_equal(cell_num(summary_table, 1, 3), 5, tolerance = 0, "N group B within limit")
  expect_equal(cell_num(summary_table, 1, 4), mean(x_limited), tolerance = 1e-5, "mean group B within limit")
  expect_equal(cell_num(summary_table, 2, 3), 5, tolerance = 0, "total N within limit")
  expect_equal(cell_num(summary_table, 2, 4), mean(x_limited), tolerance = 1e-5, "total mean within limit")
  expect_equal(
    summary_table$footnoteKey, "output.caseSummaries.limitedFootnote:5|12",
    tolerance = 0, "summary table repeats the limited footnote"
  )
})

test_that("case-summaries: grouped without a limit summarises every case", {
  set.seed(32)
  df <- data.frame(
    col_1 = c(rnorm(6, 100, 5), rnorm(6, 200, 5)),
    col_3 = rep(c("B", "A"), each = 6),
    stringsAsFactors = FALSE
  )
  # No limitCases key at all — the dialog omits it when "Limit cases" is off.
  fixture <- write_fixture(df, list(
    variables = list("col_1"),
    varNames = list(col_1 = "score"),
    groupVar = "col_3", groupVarName = "grp"
  ))
  result <- run_analysis_script("case-summaries.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  list_table <- find_table(result, "output.caseSummaries.listTitle")
  expect_equal(length(list_table$rows), 12L, tolerance = 0, "all 12 cases listed")
  expect_true(is.null(list_table$footnoteKey), "no limited footnote")

  summary_table <- find_table(result, "output.caseSummaries.summaryTitle")
  # group levels sorted: A, B, then Total
  expect_equal(length(summary_table$rows), 3L, tolerance = 0, "A + B + Total rows")
  xa <- df$col_1[df$col_3 == "A"]; xb <- df$col_1[df$col_3 == "B"]
  expect_equal(cell_num(summary_table, 1, 3), length(xa), tolerance = 0, "N group A")
  expect_equal(cell_num(summary_table, 1, 4), mean(xa), tolerance = 1e-5, "mean group A")
  expect_equal(cell_num(summary_table, 1, 5), sd(xa), tolerance = 1e-5, "sd group A")
  expect_equal(cell_num(summary_table, 2, 3), length(xb), tolerance = 0, "N group B")
  expect_equal(cell_num(summary_table, 2, 4), mean(xb), tolerance = 1e-5, "mean group B")
  expect_equal(cell_num(summary_table, 2, 5), sd(xb), tolerance = 1e-5, "sd group B")
  expect_equal(cell_num(summary_table, 3, 3), 12, tolerance = 0, "total N")
  expect_equal(cell_num(summary_table, 3, 4), mean(df$col_1), tolerance = 1e-5, "total mean")
  expect_equal(cell_num(summary_table, 3, 5), sd(df$col_1), tolerance = 1e-5, "total sd")
})

test_that("case-summaries: subtotals restart case numbers and close each group", {
  # SPSS's /FORMAT=TOTAL grouped listing, checked against a real SPSS run:
  # cases are numbered 1..n INSIDE each group, every block closes with a
  # "Total | N | <valid n>" row, and a grand Total row closes the table.
  # (That run listed 1..48 / Total N 48, 1..52 / Total N 52, Total N 100.)
  df <- data.frame(
    col_1 = c(10, 20, 30, 40, NA, 60, 70),
    col_3 = c("B", "B", "A", "A", "A", "B", "A"),
    stringsAsFactors = FALSE
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1"),
    varNames = list(col_1 = "score"),
    groupVar = "col_3", groupVarName = "grp",
    subtotals = TRUE
  ))
  result <- run_analysis_script("case-summaries.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  lt <- find_table(result, "output.caseSummaries.listTitle")
  # 4 A-cases + Total, 3 B-cases + Total, grand Total = 10 rows.
  expect_equal(length(lt$rows), 10L, tolerance = 0, "7 cases + 2 subtotals + grand total")

  # Group A sorts first and its four cases are numbered 1..4 …
  expect_equal(vapply(lt$rows[1:4], function(r) as.numeric(r[[1]]), numeric(1)),
               c(1, 2, 3, 4), tolerance = 0, "group A case numbers")
  # … then the numbering RESTARTS at 1 for group B rather than continuing at 6.
  expect_equal(vapply(lt$rows[6:8], function(r) as.numeric(r[[1]]), numeric(1)),
               c(1, 2, 3), tolerance = 0, "group B case numbers restart at 1")

  # Subtotal rows: "Total" in the case-number column, "N" in the group column,
  # then each variable's VALID n (group A has one NA, so 3 not 4).
  expect_true(identical(lt$rows[[5]][[1]], "output.col.total"), "A subtotal label")
  expect_true(identical(lt$rows[[5]][[2]], "output.col.n"), "A subtotal stat label")
  expect_equal(cell_num(lt, 5, 3), 3, tolerance = 0, "group A valid N excludes the NA")
  expect_equal(cell_num(lt, 9, 3), 3, tolerance = 0, "group B valid N")
  expect_equal(cell_num(lt, 10, 3), 6, tolerance = 0, "grand total valid N")
})

test_that("case-summaries: Case Processing Summary counts included vs excluded", {
  df <- data.frame(
    col_1 = c(1, 2, NA, 4, 5),
    col_2 = c(NA, NA, 3, 4, 5),
    stringsAsFactors = FALSE
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "score", col_2 = "other")
  ))
  result <- run_analysis_script("case-summaries.R", fixture)
  cps <- find_table(result, "output.caseSummaries.cpsTitle")
  expect_equal(length(cps$rows), 2L, tolerance = 0, "one row per variable")

  # Columns: variable, included N, included %, excluded N, excluded %, total N, total %.
  expect_equal(cell_num(cps, 1, 2), 4, tolerance = 0, "score included")
  expect_equal(cell_num(cps, 1, 3), 80, tolerance = 1e-9, "score included %")
  expect_equal(cell_num(cps, 1, 4), 1, tolerance = 0, "score excluded")
  expect_equal(cell_num(cps, 1, 6), 5, tolerance = 0, "score total")
  expect_equal(cell_num(cps, 2, 2), 3, tolerance = 0, "other included")
  expect_equal(cell_num(cps, 2, 4), 2, tolerance = 0, "other excluded")
  expect_equal(cell_num(cps, 2, 5), 40, tolerance = 1e-9, "other excluded %")
})
