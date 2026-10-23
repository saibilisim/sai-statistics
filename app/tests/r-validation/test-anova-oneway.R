# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-anova-oneway.R — validates r-scripts/anova-oneway.R against R's own
# aov()/oneway.test() (independent implementation) using the classic
# PlantGrowth textbook dataset (published F=4.846, p=0.0159 in R docs/many texts).

test_that("one-way ANOVA matches aov() reference (PlantGrowth dataset)", {
  data(PlantGrowth)
  df <- data.frame(col_1 = PlantGrowth$weight, col_2 = as.character(PlantGrowth$group))

  fixture <- write_fixture(df, list(
    variables = list("col_1"),
    varNames = list(col_1 = "weight"),
    factor = "col_2",
    factorName = "group"
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- aov(weight ~ group, data = PlantGrowth)
  s <- summary(ref)[[1]]
  ref_F <- s[["F value"]][1]
  ref_p <- s[["Pr(>F)"]][1]
  ref_ssb <- s[["Sum Sq"]][1]
  ref_ssw <- s[["Sum Sq"]][2]
  ref_dfb <- s[["Df"]][1]
  ref_dfw <- s[["Df"]][2]

  anova_table <- find_table(result, "output.anova.title")
  expect_equal(cell_num(anova_table, 1, 2), ref_ssb, tolerance = 1e-3, "SS between")
  expect_equal(cell_num(anova_table, 1, 3), ref_dfb, tolerance = 1e-9, "df between")
  expect_equal(cell_num(anova_table, 1, 5), ref_F, tolerance = 1e-3, "F statistic")
  expect_equal(cell_num(anova_table, 1, 6), ref_p, tolerance = 1e-3, "p-value")
  expect_equal(cell_num(anova_table, 2, 2), ref_ssw, tolerance = 1e-3, "SS within")
  expect_equal(cell_num(anova_table, 2, 3), ref_dfw, tolerance = 1e-9, "df within")

  # Sanity-check against the well-known published values for this dataset.
  expect_equal(round(ref_F, 3), 4.846, tolerance = 1e-3, "published F=4.846")
  expect_lt(ref_p, 0.05, "published p<0.05")

  desc_table <- find_table(result, "output.anova.descTitle")
  ctrl <- PlantGrowth$weight[PlantGrowth$group == "ctrl"]
  expect_equal(cell_num(desc_table, 1, 3), mean(ctrl), tolerance = 1e-6, "ctrl group mean")
  expect_equal(cell_num(desc_table, 1, 4), sd(ctrl), tolerance = 1e-6, "ctrl group sd")
})

# A3 (spss-parity-findings-2026-07-07): SPSS reports 3 (of its 4) usable
# Levene variants — mean/median/trimmed mean, each the same F-test on
# |deviation from group center|, only the center differs. Verified here
# against a from-scratch reference implementation (not the script's own
# helper), using the PlantGrowth dataset again.
test_that("Levene 3-variant homogeneity test matches independent reference computation", {
  data(PlantGrowth)
  df <- data.frame(col_1 = PlantGrowth$weight, col_2 = as.character(PlantGrowth$group))

  fixture <- write_fixture(df, list(
    variables = list("col_1"),
    varNames = list(col_1 = "weight"),
    factor = "col_2",
    factorName = "group",
    options = list(homogeneity = TRUE)
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref_levene <- function(center_fn) {
    x <- PlantGrowth$weight; g <- factor(PlantGrowth$group)
    z <- abs(x - ave(x, g, FUN = center_fn))
    zb <- mean(z); k <- nlevels(g); n <- length(x)
    dfb <- k - 1; dfw <- n - k
    lssb <- sum(tapply(z, g, function(v) length(v) * (mean(v) - zb)^2))
    lssw <- sum(tapply(z, g, function(v) sum((v - mean(v))^2)))
    Lf <- (lssb / dfb) / (lssw / dfw)
    list(stat = Lf, p = pf(Lf, dfb, dfw, lower.tail = FALSE))
  }

  # SPSS's trimmed mean removes EXACTLY 5% of the cases per tail: with n = 10
  # per group that is half a case at each end, which R's mean(trim = 0.05)
  # rounds down to none. Written here as a weight vector — a different route to
  # the same definition than the script's, so it stays an independent check.
  # (Verified against SPSS 26 in tests/spss-parity/compare-ui.R: R's rounding
  # put this variant at .916 where SPSS reports .912.)
  ref_trim_center <- function(v) {
    v <- sort(v); n <- length(v)
    cut <- n * 0.05; full <- floor(cut); frac <- cut - full
    if (n - 2 * full < 2) return(mean(v))
    wt <- rep(1, n)
    if (full > 0) { wt[seq_len(full)] <- 0; wt[(n - full + 1):n] <- 0 }
    wt[full + 1] <- wt[full + 1] - frac
    wt[n - full] <- wt[n - full] - frac
    sum(wt * v) / sum(wt)
  }

  homog <- find_table(result, "output.anova.homogTitle")
  ref_mean  <- ref_levene(mean)
  ref_med   <- ref_levene(median)
  ref_trim  <- ref_levene(ref_trim_center)

  expect_equal(cell_num(homog, 1, 2), ref_mean$stat, tolerance = 5e-4, "Levene based-on-mean statistic")
  expect_equal(cell_num(homog, 1, 5), ref_mean$p,    tolerance = 2e-4, "Levene based-on-mean sig.")
  expect_equal(cell_num(homog, 2, 2), ref_med$stat,  tolerance = 5e-4, "Levene based-on-median statistic")
  expect_equal(cell_num(homog, 2, 5), ref_med$p,     tolerance = 2e-4, "Levene based-on-median sig.")
  expect_equal(cell_num(homog, 3, 2), ref_trim$stat, tolerance = 5e-4, "Levene based-on-trimmed-mean statistic")
  expect_equal(cell_num(homog, 3, 5), ref_trim$p,    tolerance = 2e-4, "Levene based-on-trimmed-mean sig.")
})

# Brown-Forsythe robust test of equality of means (Brown & Forsythe, 1974):
# F* = SSB / Sum((1-n_i/N)*s_i^2), df1=k-1, df2 via Satterthwaite. Validated
# two ways: (1) on the balanced PlantGrowth dataset, where Brown-Forsythe's
# F* is known to reduce algebraically to the classical ANOVA F (since
# (1-n_i/N) is constant across equal-size groups) — this alone would not
# catch an unbalanced-df2 bug; (2) on an unbalanced subset (n=8/7/10) against
# an independent from-scratch reference computation, which does exercise the
# Satterthwaite df2 formula.
test_that("Brown-Forsythe F statistic reduces to classical F on balanced PlantGrowth data", {
  data(PlantGrowth)
  df <- data.frame(col_1 = PlantGrowth$weight, col_2 = as.character(PlantGrowth$group))

  fixture <- write_fixture(df, list(
    variables = list("col_1"),
    varNames = list(col_1 = "weight"),
    factor = "col_2",
    factorName = "group",
    options = list(brownForsythe = TRUE)
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  # Only the F statistic itself reduces to the classical F here (equal group
  # sizes make (1-n_i/N) constant, collapsing Brown-Forsythe's weighted
  # denominator to a rescaled MSW) — the Satterthwaite df2 does NOT reduce to
  # the classical dfw (PlantGrowth's groups have unequal variances), so the
  # resulting p-value legitimately differs; that path is checked against an
  # independent reference on unbalanced data below instead.
  robust <- find_table(result, "output.anova.robustTitle")
  ref <- aov(weight ~ group, data = PlantGrowth)
  s <- summary(ref)[[1]]
  expect_equal(cell_num(robust, 1, 2), s[["F value"]][1], tolerance = 1e-3, "Brown-Forsythe F == classical F (balanced)")
})

test_that("Brown-Forsythe robust test matches independent reference on unbalanced data", {
  data(PlantGrowth)
  unbal <- PlantGrowth[-c(1, 2, 11, 12, 13), ]
  df <- data.frame(col_1 = unbal$weight, col_2 = as.character(unbal$group))

  fixture <- write_fixture(df, list(
    variables = list("col_1"),
    varNames = list(col_1 = "weight"),
    factor = "col_2",
    factorName = "group",
    options = list(brownForsythe = TRUE)
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  x <- unbal$weight; g <- factor(unbal$group)
  k <- nlevels(g); N <- length(x)
  ni <- tapply(x, g, length); mi <- tapply(x, g, mean); vi <- tapply(x, g, var)
  gm <- mean(x)
  ssb <- sum(ni * (mi - gm)^2)
  dfb <- k - 1
  ci  <- 1 - ni / N
  den <- sum(ci * vi)
  ref_F   <- ssb / den
  ref_df2 <- den^2 / sum((ci * vi)^2 / (ni - 1))
  ref_p   <- pf(ref_F, dfb, ref_df2, lower.tail = FALSE)

  robust <- find_table(result, "output.anova.robustTitle")
  expect_equal(cell_num(robust, 1, 2), ref_F,   tolerance = 1e-3, "Brown-Forsythe F (unbalanced)")
  expect_equal(cell_num(robust, 1, 4), ref_df2, tolerance = 1e-3, "Brown-Forsythe df2 (unbalanced)")
  expect_equal(cell_num(robust, 1, 5), ref_p,   tolerance = 1e-3, "Brown-Forsythe sig. (unbalanced)")
})
