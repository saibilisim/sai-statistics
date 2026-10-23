# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-anova-dunnett.R — validates the B6 post-hoc additions to
# anova-oneway.R (spss-parity-findings-2026-07-07): Dunnett's T3, Dunnett's C,
# and the standard Dunnett test (vs. control group).
#
# T3 oracle: base R has no Studentized Maximum Modulus distribution, so this
# uses the same computational route the script uses (mvtnorm::qmvt/pmvt) but
# computed independently here from scratch (not calling the script's helper).
# Standard Dunnett oracle: multcomp::glht(mcp(Dunnett)) directly — the exact
# package the script itself delegates to (this validates the SCRIPT's own
# data wiring: correct control group, correct contrast extraction — not the
# math multcomp already owns).

test_that("Dunnett's T3: sig/CI match an independent mvtnorm-based reference (PlantGrowth)", {
  skip_needs <- !requireNamespace("mvtnorm", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: mvtnorm not installed)\n")
    return(invisible())
  }

  data(PlantGrowth)
  df <- data.frame(col_1 = PlantGrowth$weight, col_2 = as.character(PlantGrowth$group))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "weight"),
    factor = "col_2", factorName = "group",
    options = list(dunnettT3 = TRUE, sigLevel = "0.05")
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  x <- PlantGrowth$weight; g <- factor(PlantGrowth$group); lvls <- levels(g)
  ni <- tapply(x, g, length); mns <- tapply(x, g, mean); vi <- tapply(x, g, var)
  k <- length(lvls); ncmp <- choose(k, 2)
  i <- 2; j <- 1  # trt1, ctrl -> row 3 in the k(k-1)=6-row table (i!=j order)
  diff <- mns[i] - mns[j]
  wi <- vi[i] / ni[i]; wj <- vi[j] / ni[j]
  se <- sqrt(wi + wj)
  dfij <- se^4 / (wi^2 / (ni[i] - 1) + wj^2 / (ni[j] - 1))
  df_int <- max(1L, round(dfij))
  corr <- diag(ncmp)
  set.seed(12345L)
  crit <- mvtnorm::qmvt(0.95, tail = "both.tails", df = df_int, corr = corr)$quantile
  tstat <- abs(diff) / se
  sig_ref <- 1 - as.numeric(mvtnorm::pmvt(lower = rep(-tstat, ncmp), upper = rep(tstat, ncmp),
                                           df = df_int, corr = corr))

  ph <- find_table(result, "output.anova.postHocTitle")
  # Single method (T3) requested -> 6 rows (k=3), row 3 = trt1-ctrl.
  expect_equal(ph$rows[[3]][[2]], "trt1", label = "T3 row3 groupI")
  expect_equal(ph$rows[[3]][[3]], "ctrl", label = "T3 row3 groupJ")
  expect_equal(cell_num(ph, 3, 6), sig_ref, tolerance = 2e-3, label = "T3 sig")
})

test_that("Dunnett's C: CI is internally consistent with its own reported Sig.", {
  data(PlantGrowth)
  df <- data.frame(col_1 = PlantGrowth$weight, col_2 = as.character(PlantGrowth$group))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "weight"),
    factor = "col_2", factorName = "group",
    options = list(dunnettC = TRUE, sigLevel = "0.05")
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ph <- find_table(result, "output.anova.postHocTitle")
  # Self-consistency: for every row, sig < alpha(0.05) iff the CI excludes 0.
  for (r in seq_along(ph$rows)) {
    sig <- cell_num(ph, r, 6); lo <- cell_num(ph, r, 7); hi <- cell_num(ph, r, 8)
    excludes_zero <- (lo > 0) || (hi < 0)
    sig_below_alpha <- !is.na(sig) && sig < 0.05
    expect_equal(sig_below_alpha, excludes_zero,
                 label = sprintf("row %d: sig<0.05 matches CI excluding 0", r))
  }
})

test_that("Dunnett vs. control: matches multcomp::glht(mcp(Dunnett)) directly (last category = control)", {
  skip_needs <- !requireNamespace("multcomp", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: multcomp not installed)\n")
    return(invisible())
  }

  data(PlantGrowth)
  df <- data.frame(col_1 = PlantGrowth$weight, col_2 = as.character(PlantGrowth$group))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "weight"),
    factor = "col_2", factorName = "group",
    options = list(dunnett = TRUE, dunnettControl = "last", sigLevel = "0.05")
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  x <- PlantGrowth$weight; g <- factor(PlantGrowth$group); lvls <- levels(g)
  control_lvl <- lvls[length(lvls)]  # "trt2"
  g_fac <- stats::relevel(factor(g, levels = lvls), ref = control_lvl)
  fit <- stats::aov(x ~ g_fac)
  mc <- multcomp::glht(fit, linfct = multcomp::mcp(g_fac = "Dunnett"))
  sm <- summary(mc)

  dt <- find_table(result, "output.anova.dunnettTitle")
  expect_equal(length(dt$rows), 2L, label = "2 comparisons (k=3, control excluded)")
  # Row order follows multcomp's own contrast order; find "trt1" row.
  row_i <- NULL
  for (r in seq_along(dt$rows)) if (identical(dt$rows[[r]][[1]], "trt1")) row_i <- r
  expect_true(!is.null(row_i), "trt1 row found")
  expect_equal(dt$rows[[row_i]][[2]], "trt2", label = "control column = trt2")
  # sm$test$pvalues has no names of its own; names() lives on $coefficients —
  # index both vectors at the same position.
  idx <- which(grepl("^trt1", names(sm$test$coefficients)))
  ref_p <- unname(sm$test$pvalues[idx])
  ref_diff <- unname(sm$test$coefficients[idx])
  expect_equal(cell_num(dt, row_i, 3), ref_diff, tolerance = 1e-4, label = "mean diff matches multcomp")
  expect_equal(cell_num(dt, row_i, 5), ref_p, tolerance = 1e-4, label = "sig matches multcomp adjusted p")
})
