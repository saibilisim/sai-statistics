# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# Ordinal regression: cumulative link location/scale models (PLUM).
suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"), simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
source(file.path(.params_raw$rScriptsDir, "_ordinal-fit.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  if (!requireNamespace("ordinal", quietly = TRUE)) {
    sai_output(tables = list(), warnings = "output.ordinal.extra.needsPackage"); quit(save = "no")
  }
  defaults <- list(
    location = list(mode = "main", terms = list()), scale = list(terms = list()),
    options = list(maxIterations = 100L, maxStepHalving = 5L, logLikelihood = 0,
      parameter = 1e-6, ciLevel = 95, delta = 0, singularity = 1e-8, link = "logit"),
    output = list(history = FALSE, historyEvery = 1L, goodnessOfFit = TRUE,
      summary = TRUE, estimates = TRUE, correlations = FALSE, covariances = FALSE,
      cellInfo = FALSE, parallelLines = FALSE, includeConstant = TRUE))
  s <- defaults
  # Shallow field merge preserves unnamed JSON arrays of model terms.
  for (section in names(params$settings)) {
    if (!section %in% names(defaults)) sai_error("output.ordinal.extra.invalid")
    for (key in names(params$settings[[section]])) s[[section]][[key]] <- params$settings[[section]][[key]]
  }
  o <- s$options; out <- s$output
  number <- function(x, min = 0, max = Inf, integer = FALSE) {
    is.numeric(x) && length(x) == 1 && is.finite(x) && x >= min && x <= max && (!integer || x == floor(x))
  }
  if (!number(o$maxIterations, integer = TRUE) || !number(o$maxStepHalving, 1, integer = TRUE) ||
      !number(o$logLikelihood) || !number(o$parameter) || !number(o$ciLevel, 0, 100) || o$ciLevel >= 100 ||
      !number(o$delta, 0, 1) || o$delta >= 1 || !number(o$singularity, .Machine$double.xmin) ||
      !number(out$historyEvery, 1, integer = TRUE) ||
      !o$link %in% c("logit", "probit", "cloglog", "loglog", "cauchit") ||
      !s$location$mode %in% c("main", "custom") ||
      !all(vapply(out[names(out) != "historyEvery"], function(x) is.logical(x) && length(x) == 1 && !is.na(x), logical(1))))
    sai_error("output.ordinal.extra.invalid")
  dep <- params$dependent; factors <- unlist(params$factors); covs <- unlist(params$covariates)
  predictors <- c(factors, covs)
  if (length(dep) != 1 || !dep %in% names(df) || any(!predictors %in% names(df)) ||
      anyDuplicated(c(dep, predictors))) sai_error("output.ordinal.extra.invalidVariables")
  aliases <- setNames(sprintf("v%04d__", seq_along(predictors)), predictors)
  terms_rhs <- function(terms) {
    if (!length(terms)) return("1")
    strings <- vapply(terms, function(term) {
      term <- unlist(term)
      if (!length(term) || any(!term %in% predictors) || anyDuplicated(term))
        sai_error("output.ordinal.extra.invalidTerms")
      paste(aliases[term], collapse = ":")
    }, character(1))
    paste(unique(strings), collapse = " + ")
  }
  location_rhs <- if (s$location$mode == "main") terms_rhs(lapply(predictors, function(x) x)) else terms_rhs(s$location$terms)
  scale_rhs <- terms_rhs(s$scale$terms)
  location <- stats::as.formula(paste(".y ~", location_rhs))
  scale <- stats::as.formula(paste("~", scale_rhs))
  weighted <- get_weights(df, params); df <- weighted$df
  y <- apply_user_missing(df[[dep]], dep, params)
  # Numeric response codes sort numerically (1, 2, 10), not lexically.
  lev <- sort(unique(y[!is.na(y)]))
  dat <- data.frame(.y = factor(y, levels = lev, ordered = TRUE), .w = if (is.null(weighted$w)) rep(1, nrow(df)) else weighted$w)
  dat[["__row_idx"]] <- row_index_of(df)
  for (id in predictors) {
    x <- apply_user_missing(df[[id]], id, params)
    dat[[aliases[[id]]]] <- if (id %in% factors) factor(x) else suppressWarnings(as.numeric(x))
  }
  keep <- complete.cases(dat) & is.finite(dat$.w)
  for (id in covs) keep <- keep & is.finite(dat[[aliases[[id]]]])
  dat <- droplevels(dat[keep, , drop = FALSE])
  if (!nrow(dat) || nlevels(dat$.y) < 3) sai_error("output.ordinal.extra.tooFewCategories")
  if (any(vapply(aliases[factors], function(id) nlevels(dat[[id]]) < 2, logical(1))))
    sai_error("output.ordinal.extra.constantFactor")
  # Encode columns before grouping to avoid delimiter collisions and an
  # enormous Cartesian product when continuous covariates are present.
  codes <- lapply(unname(aliases), function(id) match(dat[[id]], unique(dat[[id]])))
  group <- if (length(codes)) match(do.call(paste, c(codes, sep = ":")), unique(do.call(paste, c(codes, sep = ":")))) else rep(1L, nrow(dat))
  ng <- max(group); k <- nlevels(dat$.y)
  observed <- matrix(0, ng, k)
  for (i in seq_len(nrow(dat))) observed[group[i], as.integer(dat$.y[i])] <- observed[group[i], as.integer(dat$.y[i])] + dat$.w[i]
  first <- match(seq_len(ng), group)
  fit_dat <- dat; warnings <- character()
  if (o$delta > 0) {
    zeros <- which(observed == 0, arr.ind = TRUE)
    if (nrow(zeros)) {
      pseudo <- dat[first[zeros[, 1]], , drop = FALSE]
      pseudo$.y <- factor(levels(dat$.y)[zeros[, 2]], levels = levels(dat$.y), ordered = TRUE)
      pseudo$.w <- o$delta
      fit_dat <- rbind(dat, pseudo)
      observed[zeros] <- o$delta
      warnings <- c(warnings, "output.ordinal.extra.deltaApplied")
    }
  }
  progress(30L, "progress.computing")
  main <- sai_ordinal_fit(location, scale, fit_dat, o)
  fit <- main$fit
  null <- sai_ordinal_fit(.y ~ 1, ~1, fit_dat, o)
  if (!main$converged || !null$converged) warnings <- c(warnings, "output.ordinal.extra.notConverged")
  if (any(unlist(fit$aliased))) warnings <- c(warnings, "output.ordinal.extra.aliased")
  constant <- if (out$includeConstant) sum(lgamma(rowSums(observed) + 1) - rowSums(lgamma(observed + 1))) else 0
  ll <- as.numeric(logLik(fit)); ll0 <- as.numeric(logLik(null$fit))
  dfm <- fit$edf - null$fit$edf; lr <- 2 * (ll - ll0)
  p_lr <- if (dfm > 0 && lr >= -1e-7 && main$converged && null$converged) pchisq(max(0, lr), dfm, lower.tail = FALSE) else NA_real_
  tables <- list(list(titleKey = "output.ordinal.fitTitle",
    columns = list("output.col.model", "output.col.neg2LL", "output.col.chiSquare", "output.col.df", "output.col.sig"),
    rows = list(list("output.col.final", round(-2 * (ll + constant), 6), round(lr, 6), dfm, p_lr),
                list("output.ordinal.extra.interceptOnly", round(-2 * (ll0 + constant), 6), NA_real_, NA_real_, NA_real_))))
  add_table <- function(key, columns, rows) {
    # Named R lists serialize to JSON objects, but the output contract requires
    # arrays. model/vcov labels must never change that transport shape.
    tables[[length(tables) + 1L]] <<- list(titleKey = key,
      columns = unname(as.list(columns)), rows = lapply(rows, unname))
  }
  label <- function(x) {
    # Replace only generated prefixes, never text inside a user label. The
    # delimiter in each alias distinguishes a factor level from another ID.
    parts <- strsplit(x, ":", fixed = TRUE)[[1]]
    paste(vapply(parts, function(part) {
      ids <- predictors[startsWith(part, unname(aliases))]
      if (!length(ids)) return(part)
      id <- ids[1]
      name <- if (is.null(params$varNames[[id]])) id else params$varNames[[id]]
      suffix <- substring(part, nchar(aliases[[id]]) + 1L)
      if (id %in% factors && nzchar(suffix)) paste0(name, "[", suffix, "]") else paste0(name, suffix)
    }, character(1)), collapse = " × ")
  }
  co <- coef(fit); vc <- vcov(fit)
  identifiable <- !any(unlist(fit$aliased)) && nrow(vc) == length(co) && all(is.finite(vc)) && all(eigen(fit$Hessian, symmetric = TRUE, only.values = TRUE)$values > o$singularity)
  if (!identifiable) warnings <- c(warnings, "output.ordinal.extra.singular")
  se <- if (identifiable) sqrt(diag(vc)) else rep(NA_real_, length(co))
  names(se) <- names(co)
  z <- qnorm((1 + o$ciLevel / 100) / 2)
  labels <- vapply(names(co), label, character(1))
  if (out$estimates) {
    rows <- lapply(seq_along(co), function(i) {
      nm <- names(co)[i]
      type <- if (i <= length(fit$alpha)) "output.col.threshold" else if (i <= length(fit$alpha) + length(fit$beta)) "output.col.location" else "output.ordinal.extra.scale"
      lbl <- if (type == "output.col.threshold") paste(resolve_var_names(strsplit(nm, "|", fixed = TRUE)[[1]], params$dependentValueLabels), collapse = "|") else labels[i]
      wald <- (co[i] / se[i])^2
      list(type, lbl, unname(co[i]), unname(se[i]), unname(wald), 1L,
        unname(pchisq(wald, 1, lower.tail = FALSE)), unname(co[i] - z * se[i]), unname(co[i] + z * se[i]))
    })
    add_table("output.ordinal.paramTitle", c("output.col.category", "output.col.model", "output.col.estimate", "output.col.stdError", "output.col.wald", "output.col.df", "output.col.sig", "output.ordinal.extra.lower", "output.ordinal.extra.upper"), rows)
  }
  if (out$correlations || out$covariances) {
    # Mathematical coefficient groups disambiguate the same predictor in
    # location and scale columns without embedding translated UI text in R.
    matrix_labels <- paste0(c(rep("α: ", length(fit$alpha)), rep("β: ", length(fit$beta)),
      rep("ζ: ", length(fit$zeta))), labels)
    for (key in c("covariances", "correlations")) if (isTRUE(out[[key]])) {
      mat <- if (identifiable) { if (key == "correlations") cov2cor(vc) else vc } else matrix(NA_real_, length(co), length(co))
      add_table(paste0("output.ordinal.extra.", key), c("output.col.model", matrix_labels),
        lapply(seq_along(co), function(i) c(list(matrix_labels[i]), as.list(mat[i, ]))))
    }
  }
  pp <- predict(fit, newdata = dat[, setdiff(names(dat), ".y"), drop = FALSE], type = "prob")$fit
  expected <- pp[first, , drop = FALSE] * rowSums(observed)
  if (out$summary) {
    counts <- colSums(observed); n <- sum(counts)
    add_table("output.ordinal.extra.caseSummary", c("output.col.category", "output.ordinal.extra.count", "output.ordinal.extra.percent"),
      lapply(seq_len(k), function(i) list(resolve_var_names(levels(dat$.y)[i], params$dependentValueLabels), counts[i], 100 * counts[i] / n)))
    cox <- 1 - exp(2 * (ll0 - ll) / n)
    add_table("output.ordinal.extra.pseudoR2", c("output.col.model", "output.ordinal.extra.value"),
      list(list("output.ordinal.extra.coxSnell", cox), list("output.ordinal.extra.nagelkerke", cox / (1 - exp(2 * ll0 / n))), list("output.ordinal.extra.mcfadden", 1 - ll / ll0)))
  }
  if (out$goodnessOfFit) {
    pearson <- sum((observed - expected)^2 / expected)
    positive <- observed > 0
    deviance <- 2 * sum(observed[positive] * log(observed[positive] / expected[positive]))
    dfg <- ng * (k - 1) - fit$edf
    sig <- function(x) if (dfg > 0 && main$converged) pchisq(x, dfg, lower.tail = FALSE) else NA_real_
    add_table("output.ordinal.extra.goodnessOfFit", c("output.col.model", "output.col.chiSquare", "output.col.df", "output.col.sig"),
      list(list("output.ordinal.extra.pearson", pearson, dfg, sig(pearson)), list("output.ordinal.extra.deviance", deviance, dfg, sig(deviance))))
    if (any(expected < 5)) warnings <- c(warnings, "output.ordinal.extra.sparseCells")
  }
  if (out$cellInfo) {
    rows <- list()
    for (g in seq_len(ng)) for (j in seq_len(k)) rows[[length(rows) + 1L]] <- c(
      list(g), lapply(unname(aliases), function(id) as.character(dat[[id]][first[g]])),
      list(resolve_var_names(levels(dat$.y)[j], params$dependentValueLabels), observed[g, j], expected[g, j], pp[first[g], j]))
    add_table("output.ordinal.extra.cellInfo", c("output.ordinal.extra.pattern", vapply(unname(aliases), label, character(1)), "output.col.category", "output.ordinal.extra.observed", "output.ordinal.extra.expected", "output.ordinal.extra.probability"), rows)
  }
  if (out$history) {
    history <- Filter(function(row) row[[1]] %% out$historyEvery == 0, main$history)
    add_table("output.ordinal.extra.history", c("output.ordinal.extra.iteration", "output.ordinal.extra.logLikelihood", "output.ordinal.extra.parameterChange"),
      lapply(history, function(row) { row[[2]] <- row[[2]] + constant; row }))
  }
  if (out$parallelLines) {
    general <- tryCatch(sai_ordinal_fit(.y ~ 1, scale, fit_dat, o,
      nominal = as.formula(paste("~", location_rhs))), error = function(e) NULL)
    test_ok <- !is.null(general) && general$converged && main$converged &&
      isTRUE(general$fit$convergence$code == 0)
    statistic <- if (test_ok) 2 * (as.numeric(logLik(general$fit)) - ll) else NA_real_
    difference <- if (test_ok) general$fit$edf - fit$edf else NA_real_
    test_ok <- test_ok && is.finite(statistic) && statistic >= -1e-7 && difference > 0
    add_table("output.ordinal.extra.parallelLines", c("output.col.model", "output.col.chiSquare", "output.col.df", "output.col.sig"),
      list(list("output.ordinal.extra.parallelNull", if (test_ok) max(0, statistic) else NA_real_, difference,
        if (test_ok) pchisq(max(0, statistic), difference, lower.tail = FALSE) else NA_real_)))
    if (!test_ok) warnings <- c(warnings, "output.ordinal.extra.parallelUnavailable")
  }
  case_vars <- list(); want <- requested_new_vars(params)
  save <- function(key, values, type = "numeric", measure = "scale", labelKey = paste0("output.ordinal.newVar.", key)) {
    if (!is.null(want[[key]])) case_vars[[length(case_vars) + 1L]] <<- sai_case_var(want[[key]], values, dat, labelKey = labelKey, type = type, measure = measure)
  }
  winner <- max.col(pp, ties.method = "first")
  save("predictedGroup", levels(dat$.y)[winner], "string", "ordinal")
  save("probability", pp[cbind(seq_len(nrow(dat)), winner)])
  save("actualProbability", pp[cbind(seq_len(nrow(dat)), as.integer(dat$.y))], labelKey = "output.ordinal.extra.actualProbability")
  if (!is.null(want$estimatedProbabilities)) for (j in seq_len(k)) {
    case_vars[[length(case_vars) + 1L]] <- sai_case_var(paste0(want$estimatedProbabilities, j), pp[, j], dat,
      labelKey = "output.ordinal.extra.estimatedProbability")
  }
  progress(100L, "progress.done")
  sai_output(tables = tables, caseVars = case_vars, warnings = unique(warnings))
}, error = function(e) sai_error(conditionMessage(e)))
