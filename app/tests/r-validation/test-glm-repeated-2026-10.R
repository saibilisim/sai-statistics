# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-glm-repeated-2026-10.R — GLM Repeated Measures with a between-subjects
# factor (mixed design), Options, EM Means, profile plot and post hoc.
#
# References: car::Anova(mlm, idata, idesign, type = 3) for the univariate
# and multivariate tests and the epsilons, emmeans() on the same mlm for the
# estimated marginal means, and glm-univariate.R on the subject averages for
# the between-subjects post hoc — never glm-repeated.R's own code.

set.seed(4242)
rm_n <- 36
rm_g <- rep(c("ctrl", "trtA", "trtB"), each = rm_n / 3)
rm_subj <- rnorm(rm_n, sd = 2)
rm_df <- data.frame(
  col_g = rm_g,
  col_t1 = 10 + rm_subj + rnorm(rm_n, sd = 1.5),
  col_t2 = 11 + rm_subj + 1.5 * (rm_g == "trtA") + rnorm(rm_n, sd = 1.8),
  col_t3 = 12 + rm_subj + 3 * (rm_g == "trtA") + 1 * (rm_g == "trtB") + rnorm(rm_n, sd = 2.4),
  stringsAsFactors = FALSE)

rm_params <- function(options = list()) list(
  variables = list("col_t1", "col_t2", "col_t3"),
  varNames = list(col_t1 = "T1", col_t2 = "T2", col_t3 = "T3"),
  factorName = "time",
  betweenFactors = list("col_g"), betweenNames = list(col_g = "group"),
  options = options)

rm_row <- function(tbl, effect, second) {
  cur <- NULL
  for (r in tbl$rows) {
    if (nzchar(r[[1]])) cur <- r[[1]]
    if (identical(cur, effect) && identical(r[[2]], second)) return(r)
  }
  stop("row not found: ", effect, " / ", second)
}

rm_car <- function() {
  old <- options(contrasts = c("contr.sum", "contr.poly")); on.exit(options(old))
  Y <- as.matrix(rm_df[, c("col_t1", "col_t2", "col_t3")])
  g <- factor(rm_df$col_g)
  fit <- lm(Y ~ g)
  list(fit = fit, av = car::Anova(fit, idata = data.frame(time = factor(1:3)),
                                  idesign = ~time, type = 3))
}

test_that("glm-repeated (mixed): within, interaction and between tests match car::Anova", {
  if (!requireNamespace("car", quietly = TRUE)) { cat("  (skipped: car)\n"); return(invisible()) }
  res <- run_analysis_script("glm-repeated.R", write_fixture(rm_df, rm_params()))
  expect_true(isTRUE(res$success), "success")
  ref <- rm_car(); s <- summary(ref$av, multivariate = FALSE)
  uni <- s$univariate.tests; eps <- s$pval.adjustments

  wt <- find_table(res, "output.glmRep.withinTitle")
  sph <- "output.col.sphericityAssumed"
  expect_equal(as.numeric(rm_row(wt, "time", sph)[[6]]), round(uni["time", "F value"], 3),
               tolerance = 1e-3, "time F")
  expect_equal(as.numeric(rm_row(wt, "time * group", sph)[[6]]), round(uni["g:time", "F value"], 3),
               tolerance = 1e-3, "time * group F")
  expect_equal(as.numeric(rm_row(wt, "time", sph)[[3]]), round(uni["time", "Sum Sq"], 3),
               tolerance = 1e-3, "time SS")
  expect_equal(as.numeric(rm_row(wt, "time * group", "output.col.greenhouse")[[7]]),
               round(eps["g:time", "Pr(>F[GG])"], 6), tolerance = 1e-3, "time * group GG Sig.")

  mt <- find_table(res, "output.glmRep.mauchlyTitle")
  expect_equal(cell_num(mt, 1, 6), round(eps["time", "GG eps"], 3), tolerance = 1e-3, "GG epsilon")

  bt <- find_table(res, "output.glmRep.betweenTitle")
  gr <- NULL; for (r in bt$rows) if (identical(r[[1]], "group")) gr <- r
  expect_equal(as.numeric(gr[[5]]), round(uni["g", "F value"], 3), tolerance = 1e-3, "between F (group)")
  expect_equal(as.numeric(gr[[6]]), round(uni["g", "Pr(>F)"], 6), tolerance = 1e-3, "between Sig. (group)")
})

test_that("glm-repeated (mixed): multivariate tests match car", {
  if (!requireNamespace("car", quietly = TRUE)) { cat("  (skipped: car)\n"); return(invisible()) }
  res <- run_analysis_script("glm-repeated.R", write_fixture(rm_df, rm_params()))
  mv <- find_table(res, "output.glmRep.mvTitle")
  ref <- rm_car()$av
  pillai <- function(term) {
    ev <- Re(eigen(solve(ref$SSPE[[term]]) %*% ref$SSP[[term]], only.values = TRUE)$values)
    sum(ev / (1 + ev))
  }
  expect_equal(as.numeric(rm_row(mv, "time", "output.col.pillai")[[3]]), round(pillai("time"), 3),
               tolerance = 1e-9, "Pillai time")
  expect_equal(as.numeric(rm_row(mv, "time * group", "output.col.pillai")[[3]]), round(pillai("g:time"), 3),
               tolerance = 1e-9, "Pillai time * group")
})

test_that("glm-repeated: EM means and pairwise comparisons match emmeans", {
  if (!requireNamespace("emmeans", quietly = TRUE)) { cat("  (skipped: emmeans)\n"); return(invisible()) }
  # The reference (rm_car) uses car, a test-only package the app does not ship.
  if (!requireNamespace("car", quietly = TRUE)) { cat("  (skipped: car)\n"); return(invisible()) }
  res <- run_analysis_script("glm-repeated.R", write_fixture(rm_df, rm_params(list(
    emMeans = list(terms = list("WITHIN", "col_g", "WITHIN*col_g"), compareMainEffects = TRUE,
                   ciAdjust = "bonferroni")))))
  expect_true(isTRUE(res$success), "success")
  fit <- rm_car()$fit
  em_t <- summary(emmeans::emmeans(fit, ~ rep.meas))
  em_g <- summary(emmeans::emmeans(fit, ~ g))
  et <- find_table(res, "output.glmRep.emTitle:time")
  eg <- find_table(res, "output.glmRep.emTitle:group")
  for (j in 1:3) {
    expect_equal(cell_num(et, j, 2), round(em_t$emmean[j], 3), tolerance = 1e-6, paste("time", j, "mean"))
    expect_equal(cell_num(et, j, 3), round(em_t$SE[j], 3), tolerance = 1e-6, paste("time", j, "SE"))
    expect_equal(cell_num(eg, j, 2), round(em_g$emmean[j], 3), tolerance = 1e-6, paste("group", j, "mean"))
    expect_equal(cell_num(eg, j, 3), round(em_g$SE[j], 3), tolerance = 1e-6, paste("group", j, "SE"))
  }
  pw <- summary(emmeans::contrast(emmeans::emmeans(fit, ~ rep.meas), "pairwise", adjust = "bonferroni"))
  pt_tbl <- find_table(res, "output.glmRep.pairwiseTitle:time")
  r12 <- pt_tbl$rows[[1]]   # 1 vs 2
  expect_equal(as.numeric(r12[[3]]), round(pw$estimate[1], 3), tolerance = 1e-6, "1 - 2 difference")
  expect_equal(as.numeric(r12[[5]]), round(pw$p.value[1], 6), tolerance = 1e-4, "1 - 2 Bonferroni Sig.")
})

test_that("glm-repeated: descriptives, homogeneity, profile plot and post hoc", {
  res <- run_analysis_script("glm-repeated.R", write_fixture(rm_df, rm_params(list(
    descriptives = TRUE, homogeneity = TRUE, effectSize = TRUE,
    profilePlot = list(horizontal = "WITHIN", lines = "col_g", errorBars = TRUE),
    postHoc = list(factors = list("col_g"), tukey = TRUE)))))
  expect_true(isTRUE(res$success), "success")
  d <- find_table(res, "output.glmRep.descriptivesTitle")
  ctrl <- rm_df$col_t1[rm_df$col_g == "ctrl"]
  expect_equal(cell_num(d, 1, 3), round(mean(ctrl), 3), tolerance = 1e-9, "T1 ctrl mean")
  expect_equal(cell_num(d, 1, 4), round(sd(ctrl), 3), tolerance = 1e-9, "T1 ctrl SD")
  lev <- find_table(res, "output.glmRep.leveneTitle")
  z <- abs(rm_df$col_t2 - ave(rm_df$col_t2, rm_df$col_g))
  ref_lev <- anova(lm(z ~ rm_df$col_g))
  expect_equal(cell_num(lev, 2, 2), round(ref_lev[1, "F value"], 3), tolerance = 1e-9, "Levene T2")
  find_table(res, "output.glmMulti.boxTitle")
  wt <- find_table(res, "output.glmRep.withinTitle")
  expect_true(length(wt$columns) == 8, "partial eta squared column")
  expect_true(length(res$plots) == 1 && length(res$plots[[1]]$data$data) == 3, "3 profile lines")

  ph <- Filter(function(t) startsWith(t$titleKey, "output.glmUni.postHocTitle"), res$tables)
  expect_true(length(ph) == 1, "post hoc table for group")
  avg_df <- data.frame(col_avg = rowMeans(rm_df[, c("col_t1", "col_t2", "col_t3")]), col_g = rm_df$col_g)
  uni <- run_analysis_script("glm-univariate.R", write_fixture(avg_df, list(
    dependent = "col_avg", dependentName = "avg", factors = list("col_g"),
    factorNames = list(col_g = "group"), options = list(postHoc = list(factors = list("col_g"), tukey = TRUE)))))
  ref_ph <- Filter(function(t) startsWith(t$titleKey, "output.glmUni.postHocTitle"), uni$tables)[[1]]
  expect_true(identical(ph[[1]]$rows, ref_ph$rows), "post hoc = Univariate on subject averages")
})

test_that("glm-repeated: pure within design still matches the one-group case", {
  one <- rm_df[, c("col_t1", "col_t2", "col_t3")]
  p <- rm_params(); p$betweenFactors <- NULL; p$betweenNames <- NULL
  res <- run_analysis_script("glm-repeated.R", write_fixture(one, p))
  expect_true(isTRUE(res$success), "success")
  find_table(res, "output.glmRep.betweenTitle")
  find_table(res, "output.glmRep.contrastsTitle:time")
})

test_that("glm-repeated (mixed): descriptives table columns reach JSON as an array", {
  # Regression 2026-10-11: the between-factor column name kept its colId as a
  # name, toJSON wrote {"col_g":"group",...}, and the app rejected the result
  # ("tables.0.columns: expected array") — every mixed design with PRINT=
  # DESCRIPTIVE failed, from the dialog and from GLM ... /WSFACTOR syntax.
  res <- run_analysis_script("glm-repeated.R", write_fixture(rm_df, rm_params(list(
    descriptives = TRUE, effectSize = TRUE, homogeneity = TRUE))))
  expect_true(isTRUE(res$success), "success")
  for (tb in res$tables) {
    expect_true(is.null(names(tb$columns)), paste("unnamed columns:", tb$titleKey))
  }
  desc <- Filter(function(tb) identical(tb$titleKey, "output.glmRep.descriptivesTitle"), res$tables)[[1]]
  expect_true(identical(desc$columns[[2]], "group"), "between-factor column is the factor name")
})
