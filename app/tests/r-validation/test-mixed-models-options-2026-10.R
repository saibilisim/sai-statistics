# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-mixed-models-options-2026-10.R — the Fixed / Random / Estimation /
# Statistics / EM Means sub-dialog options of mixed-models.R.
#
# Reference: the same model fitted here with nlme::lme() directly (an
# independent call, not the script), anova() for the fixed-effect tests and
# emmeans() on that fit for the marginal means.

if (requireNamespace("nlme", quietly = TRUE)) {

set.seed(77)
mx_n_subj <- 24
mx <- data.frame(
  col_s = rep(paste0("s", seq_len(mx_n_subj)), each = 6),
  col_trt = rep(c("a", "b", "c"), length.out = mx_n_subj * 6),
  col_x = rnorm(mx_n_subj * 6),
  stringsAsFactors = FALSE)
u0 <- rnorm(mx_n_subj, sd = 1.5); u1 <- rnorm(mx_n_subj, sd = 0.6)
sid <- as.integer(factor(mx$col_s, levels = paste0("s", seq_len(mx_n_subj))))
mx$col_y <- 5 + (mx$col_trt == "b") * 1.2 + (mx$col_trt == "c") * 2 +
  (0.8 + u1[sid]) * mx$col_x + u0[sid] + rnorm(nrow(mx))

mx_params <- function(options = list()) list(
  dependent = "col_y", dependentName = "y", subject = "col_s",
  factors = list("col_trt"), covariates = list("col_x"),
  varNames = list(col_trt = "trt", col_x = "x"), options = options)

mx_ref <- function(method = "REML", random = ~1 | g, pd = NULL) {
  old <- options(contrasts = c("contr.sum", "contr.poly")); on.exit(options(old))
  d <- data.frame(y = mx$col_y, trt = factor(mx$col_trt), x = mx$col_x, g = factor(mx$col_s))
  rnd <- if (is.null(pd)) random else list(g = pd)
  nlme::lme(y ~ x + trt, random = rnd, data = d, method = method)
}

test_that("mixed: factor + covariate, Type III tests and estimates match nlme", {
  res <- run_analysis_script("mixed-models.R", write_fixture(mx, mx_params()))
  expect_true(isTRUE(res$success), "success")
  ref <- mx_ref(); av <- anova(ref, type = "marginal")
  t3 <- find_table(res, "output.mixed.type3Title")
  trt_row <- NULL; for (r in t3$rows) if (identical(r[[1]], "trt")) trt_row <- r
  expect_equal(as.numeric(trt_row[[4]]), round(av["trt", "F-value"], 3), tolerance = 1e-6, "trt F")
  expect_equal(as.numeric(trt_row[[5]]), round(av["trt", "p-value"], 6), tolerance = 1e-6, "trt Sig.")
  fe <- find_table(res, "output.mixed.fixedTitle")
  expect_equal(cell_num(fe, 2, 2), round(nlme::fixef(ref)[["x"]], 6), tolerance = 1e-6, "B x")
})

test_that("mixed: random slope with an unstructured covariance, ML", {
  res <- run_analysis_script("mixed-models.R", write_fixture(mx, mx_params(list(
    random = list(intercept = TRUE, slopes = list("col_x"), covType = "unstructured"),
    estimation = list(method = "ML"), statistics = list(covCI = TRUE)))))
  expect_true(isTRUE(res$success), "success")
  ref <- mx_ref("ML", pd = nlme::pdSymm(~ 1 + x))
  fit_t <- find_table(res, "output.mixed.fitTitle")
  expect_equal(cell_num(fit_t, 1, 2), round(-2 * as.numeric(logLik(ref)), 3), tolerance = 1e-6, "-2LL (ML)")
  # ML: n = cases, d = fixed + covariance parameters (SPSS MIXED algorithms).
  d <- attr(logLik(ref), "df")
  expect_equal(cell_num(fit_t, 2, 2), round(-2 * as.numeric(logLik(ref)) + 2 * d, 3), tolerance = 1e-6, "AIC (ML)")
  cv <- find_table(res, "output.mixed.covTitle")
  vc <- nlme::VarCorr(ref)
  slope_row <- NULL; for (r in cv$rows) if (identical(r[[1]], "output.mixed.slopeVar:x")) slope_row <- r
  expect_equal(as.numeric(slope_row[[2]]), round(as.numeric(vc["x", "Variance"]), 6), tolerance = 1e-4, "slope variance")
  expect_true(length(cv$columns) == 5, "confidence interval columns")
  expect_true(any(vapply(cv$rows, function(r) startsWith(r[[1]], "output.mixed.covBetween:"), logical(1))),
              "intercept-slope covariance row")
})

test_that("mixed: EM means and pairwise comparisons match emmeans on the lme fit", {
  if (!requireNamespace("emmeans", quietly = TRUE)) { cat("  (skipped: emmeans)\n"); return(invisible()) }
  res <- run_analysis_script("mixed-models.R", write_fixture(mx, mx_params(list(
    emMeans = list(terms = list("col_trt"), compareMainEffects = TRUE, ciAdjust = "bonferroni")))))
  ref <- mx_ref()
  em <- summary(emmeans::emmeans(ref, ~ trt))
  et <- find_table(res, "output.mixed.emTitle:trt")
  for (j in 1:3) {
    expect_equal(cell_num(et, j, 2), round(em$emmean[j], 3), tolerance = 1e-6, paste("emmean", j))
    expect_equal(cell_num(et, j, 3), round(em$SE[j], 3), tolerance = 1e-6, paste("SE", j))
  }
  pw <- find_table(res, "output.mixed.pairwiseTitle:trt")
  expect_equal(cell_num(pw, 1, 3), round(em$emmean[1] - em$emmean[2], 3), tolerance = 1e-6, "a - b")
})

test_that("mixed: descriptives and the df note", {
  res <- run_analysis_script("mixed-models.R", write_fixture(mx, mx_params(list(
    statistics = list(descriptives = TRUE)))))
  d <- find_table(res, "output.mixed.descriptivesTitle:y")
  ya <- mx$col_y[mx$col_trt == "a"]
  expect_equal(cell_num(d, 1, 3), round(mean(ya), 3), tolerance = 1e-9, "mean a")
  expect_true("output.mixed.dfNote" %in% unlist(res$notes), "df note")
})

}
