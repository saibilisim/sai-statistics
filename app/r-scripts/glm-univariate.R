# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# glm-univariate.R — GLM Univariate (factorial ANOVA / ANCOVA, SPSS-style).
#
# Params (JSON):
#   dependent, dependentName
#   factors (colIds), factorNames        — Fixed Factor(s), optional
#   covariates (colIds), covariateNames  — Covariate(s), optional (main effects only —
#                                           the default model never crosses a covariate
#                                           with a factor; that needs "Build custom
#                                           terms", not implemented yet)
#   wlsWeight, wlsWeightName             — WLS Weight, optional (regression weight for
#                                           lm(), independent of the global Weight Cases
#                                           frequency weight — see model_w below)
#   options:
#     ssType            'I'|'II'|'III'|'IV'  (default 'III'; IV is computed identically
#                        to III — see the ssType == 'IV' branch below)
#     includeIntercept   bool (default TRUE)
#     sigLevel           string, e.g. "0.05" (default .05) — used for effect-size/power,
#                        post hoc, and EM Means comparisons alike, same as SPSS's single
#                        Options-panel "Significance level" field
#     descriptives, effectSize, power, paramEstimates, homogeneity   bool
#     contrasts: { colId: { type: 'none'|'deviation'|'simple'|'difference'|
#                           'helmert'|'repeated'|'polynomial', reference: 'first'|'last' } }
#                — feeds the Parameter Estimates refit only (see that section)
#     postHoc: { factors: [colId,...], lsd, bonferroni, sidak, scheffe, tukey,
#                gamesHowell, tamhaneT2, dunnettT3, dunnettC,
#                snk, duncan, regwQ, wallerDuncan, wallerK,   — Homogeneous Subsets
#                dunnett, dunnettControl: 'first'|'last' }    — vs. control
#     emMeans: { terms: ["OVERALL" | colId | "colIdA*colIdB", ...],
#                compareMainEffects, ciAdjust }
#   createVars: { predicted, residual, standardized, studentized, deleted,
#                 leverage, cooks } — Save (NV1 pattern, see _bootstrap.R)
#
# Output: "Tests of Between-Subjects Effects" (Type I/II/III/IV SS; Corrected Model,
#         Intercept, each factor/interaction/covariate, Error, Total, Corrected Total) +
#         R²/adjusted-R² footnote, optionally with Partial Eta Squared / Observed Power
#         columns; optional Descriptive Statistics, Parameter Estimates (per-factor
#         Contrasts), Homogeneity of Variance, Post Hoc (pairwise + Homogeneous Subsets +
#         Dunnett vs. control, per selected factor), and Estimated Marginal Means (main
#         effects, interactions, compare main effects) tables; optional Save case variables.
#
# Deferred to a later round (documented, not silently missing): Random Factor(s),
# Build custom terms / non-default term ordering, Profile Plots, Bootstrap, and the
# Hochberg GT2/Gabriel post hoc tests (no maintained R package implements either).

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

source(file.path(.params_raw$rScriptsDir, "_glm_univariate_core.R"))

tryCatch({
  res <- glm_univariate_core(df, params)
  progress(100L, "progress.done")
  sai_output(tables = res$tables, warnings = res$warnings, notes = res$notes,
             caseVars = res$caseVars)
}, error = function(e) sai_error(conditionMessage(e)))
