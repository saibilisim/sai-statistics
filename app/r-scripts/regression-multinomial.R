# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# Multinomial logistic regression: dialog and NOMREG share this entry point.
suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"), simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
source(file.path(.params_raw$rScriptsDir, "multinomial-engine.R"))
source(file.path(.params_raw$rScriptsDir, "multinomial-output.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  defaults <- function(given, base) {
    for (name in names(given)) base[name] <- given[name]
    base
  }
  model <- defaults(params$model, list(mode = 'main', intercept = TRUE, forced = list(), stepped = list(), method = 'forward'))
  opt <- defaults(params$options, list(scale = 'none', scaleValue = 1, entryProbability = .05, removalProbability = .1, entryTest = 'lr', removalTest = 'lr', minEffects = 0, maxEffects = NULL, hierarchy = 'all'))
  crit <- defaults(params$criteria, list(maxIterations = 100L, maxStepHalving = 5L, logLikelihood = 0, parameter = 1e-6, printHistory = FALSE, historyEvery = 1L, checkSeparation = TRUE, separationStart = 20L, delta = 0, singularity = 1e-8))
  st <- defaults(params$statistics, list(caseSummary = TRUE, pseudoR2 = TRUE, stepSummary = TRUE, modelFit = TRUE, informationCriteria = FALSE, cellProbabilities = FALSE, classification = FALSE, goodnessOfFit = FALSE, monotonicity = FALSE, estimates = TRUE, likelihoodRatio = TRUE, correlations = FALSE, covariances = FALSE, ciLevel = 95, subpopulationMode = 'predictors', subpopulations = list()))
  check_number <- function(x, lo, hi = Inf, integer = FALSE) length(x) == 1 && is.numeric(x) && is.finite(x) && x >= lo && x <= hi && (!integer || x == floor(x))
  if (!check_number(crit$maxIterations, 1, 100000, TRUE) || !check_number(crit$maxStepHalving, 1, 100, TRUE) || !check_number(crit$logLikelihood, 0) || !check_number(crit$parameter, 0) || !check_number(crit$historyEvery, 1, Inf, TRUE) || !check_number(crit$separationStart, 0, Inf, TRUE) || !check_number(crit$delta, 0, 1 - .Machine$double.eps) || !check_number(crit$singularity, .Machine$double.eps, .999999) || !check_number(st$ciLevel, 0, 99.999999)) stop('output.multinom.extra.invalidCriteria')
  if (!check_number(opt$scaleValue, .Machine$double.eps) || !check_number(opt$entryProbability, 0, 1) || !check_number(opt$removalProbability, opt$entryProbability, 1) || !check_number(opt$minEffects, 0, Inf, TRUE) || (!is.null(opt$maxEffects) && !check_number(opt$maxEffects, opt$minEffects, Inf, TRUE))) stop('output.multinom.extra.invalidOptions')
  if (!model$mode %in% c('main','factorial','custom') || !model$method %in% c('forward','backward','forwardStepwise','backwardStepwise') || !opt$scale %in% c('none','fixed','pearson','deviance') || !opt$hierarchy %in% c('none','all','factors','containment') || !opt$entryTest %in% c('lr','score') || !opt$removalTest %in% c('lr','wald')) stop('output.multinom.extra.invalidOption')
  dep <- params$dependent; covs <- unique(unlist(params$covariates)); factors <- unique(unlist(params$factors))
  predictors <- c(factors, covs)
  if (anyDuplicated(c(dep, predictors))) stop('output.multinom.extra.distinctVariables')
  subpop <- if (st$subpopulationMode == 'custom') unique(unlist(st$subpopulations)) else predictors
  if (st$subpopulationMode == 'custom' && !length(subpop)) stop('output.multinom.extra.selectSubpopulations')
  columns <- unique(c(dep, predictors, subpop))
  if (is.null(dep) || !all(columns %in% names(df))) stop('output.multinom.extra.unavailableVariable')
  # Formula identifiers are internal column IDs only, never source labels.
  if (any(!grepl('^[A-Za-z][A-Za-z0-9_]*$', predictors))) stop('output.multinom.extra.invalidPredictor')
  total_cases <- nrow(df)
  for (id in columns) df[[id]] <- apply_user_missing(df[[id]], id, params)
  weighted <- get_weights(df, params); df <- weighted$df
  w <- if (is.null(weighted$w)) rep(1, nrow(df)) else weighted$w
  dat <- df[, columns, drop = FALSE]
  dat$.y <- factor(df[[dep]])
  for (id in factors) dat[[id]] <- factor(dat[[id]])
  for (id in covs) dat[[id]] <- suppressWarnings(as.numeric(dat[[id]]))
  dat[['__row_idx']] <- row_index_of(df)
  complete <- complete.cases(dat) & is.finite(w)
  for (id in covs) complete <- complete & is.finite(dat[[id]])
  dat <- droplevels(dat[complete, , drop = FALSE]); w <- w[complete]
  if (!nrow(dat) || nlevels(dat$.y) < 2) stop('output.multinom.extra.dependentLevels')
  if (any(vapply(factors, function(id) nlevels(dat[[id]]) < 2, logical(1)))) stop('output.multinom.extra.factorLevels')
  # Reference category (NOMREG BASE=/ORDER=). The engine contrasts every logit
  # against level 1, so the reference becomes level 1; `disp` keeps the
  # tables that list all categories in the order the user asked for.
  ref <- defaults(params$reference, list(category = 'last', customValue = '', order = 'ascending'))
  if (!ref$category %in% c('first', 'last', 'custom') || !ref$order %in% c('ascending', 'descending')) stop('output.multinom.extra.invalidOption')
  display_levels <- levels(dat$.y)
  if (ref$order == 'descending') display_levels <- rev(display_levels)
  base_level <- switch(ref$category,
    first = display_levels[1],
    last = display_levels[length(display_levels)],
    custom = {
      wanted <- trimws(as.character(ref$customValue))
      hit <- display_levels[display_levels == wanted]
      # Numeric codes match by value, so "2" finds a level printed as "2.0".
      if (!length(hit) && !is.na(suppressWarnings(as.numeric(wanted)))) hit <- display_levels[suppressWarnings(as.numeric(display_levels)) %in% as.numeric(wanted)]
      if (!length(hit)) stop('output.multinom.extra.referenceNotFound')
      hit[1]
    })
  dat$.y <- factor(dat$.y, levels = c(base_level, setdiff(display_levels, base_level)))
  disp <- match(display_levels, levels(dat$.y))
  k <- nlevels(dat$.y); levels_y <- levels(dat$.y)
  cat_names <- resolve_var_names(levels_y, params$dependentValueLabels)
  outcome <- as.integer(dat$.y)
  group_id <- function(data, ids) {
    if (!length(ids)) return(rep(1L, nrow(data)))
    # Match tuples of integer codes, so punctuation in category labels cannot collide.
    codes <- lapply(data[, ids, drop = FALSE], function(v) match(v, unique(v)))
    key <- do.call(paste, c(codes, sep = '|'))
    match(key, unique(key))
  }
  g <- group_id(dat, predictors)
  first <- match(seq_len(max(g)), g); grouped <- dat[first, , drop = FALSE]
  y_case <- matrix(0, nrow(dat), k); y_case[cbind(seq_len(nrow(dat)), outcome)] <- w
  observed <- rowsum(y_case, g, reorder = FALSE)
  y <- observed; y[y == 0] <- crit$delta
  terms <- mn_terms(model, factors, covs)
  progress(25L, 'progress.loading')
  selection <- mn_select(grouped, y, model, opt, crit, terms, factors)
  fit <- selection$fit
  null <- mn_fit(mn_design(character(), grouped, model$intercept), y, crit)
  constant <- sum(lgamma(rowSums(y) + 1) - rowSums(lgamma(y + 1)))
  neg2ll <- -2 * (fit$ll + constant); null_neg2ll <- -2 * (null$ll + constant)
  warnings <- character()
  if (!fit$converged) warnings <- c(warnings, 'output.multinom.extra.notConverged')
  if (fit$halvingFailed) warnings <- c(warnings, 'output.multinom.extra.halvingFailed')
  if (fit$separated) warnings <- c(warnings, 'output.multinom.extra.separation')
  if (fit$aliased) warnings <- c(warnings, 'output.multinom.extra.aliased')
  if (crit$delta > 0) warnings <- c(warnings, 'output.multinom.extra.deltaApplied')
  pp <- fit$prob[g, , drop = FALSE]
  winner <- max.col(pp, ties.method = 'first')
  sg <- group_id(dat, subpop)
  obs <- rowsum(y_case, sg, reorder = FALSE)
  expected <- rowsum(pp * w, sg, reorder = FALSE)
  totals <- rowSums(obs)
  pearson <- sum((obs - expected)^2 / pmax(expected, .Machine$double.xmin))
  positive <- obs > 0
  deviance <- 2 * sum(obs[positive] * log(obs[positive] / pmax(expected[positive], .Machine$double.xmin)))
  residual_df <- nrow(obs) * (k - 1L) - fit$df
  scale <- switch(opt$scale, fixed = opt$scaleValue, pearson = pearson / residual_df, deviance = deviance / residual_df, 1)
  if (opt$scale %in% c('pearson', 'deviance') && (residual_df <= 0 || !is.finite(scale) || scale <= 0)) stop('output.multinom.extra.scaleError')
  covariance <- fit$reportCovariance * scale
  coefficient <- as.vector(fit$coef); se <- sqrt(pmax(0, diag(covariance)))
  # Constants use translation keys; user-provided names and category labels are data.
  label_term <- function(term) {
    for (id in predictors[order(nchar(predictors), decreasing = TRUE)]) {
      label <- if (!is.null(params$varNames[[id]])) params$varNames[[id]] else id
      term <- gsub(id, label, term, fixed = TRUE)
    }
    term
  }
  column_labels <- vapply(colnames(fit$x), function(x) if (x == '(Intercept)') 'output.col.intercept' else label_term(x), character(1))
  table_list <- list()
  add <- function(title, columns, rows, footnote = NULL) {
    table_list[[length(table_list) + 1L]] <<- list(titleKey = title, columns = as.list(columns), rows = rows, footnoteKey = footnote)
  }
  key <- function(x) paste0('output.multinom.extra.', x)
  sig <- function(stat, df) if (df > 0 && is.finite(stat)) pchisq(max(0, stat), df, lower.tail = FALSE) else NA_real_
  if (st$caseSummary) {
    counts <- colSums(y_case)
    rows <- lapply(disp, function(j) list(cat_names[j], counts[j], round(100 * counts[j] / sum(w), 3)))
    rows <- c(rows, list(list(key('valid'), nrow(dat), 100 * nrow(dat) / total_cases), list(key('excluded'), total_cases - nrow(dat), 100 * (total_cases - nrow(dat)) / total_cases)))
    add(key('caseSummary'), c('output.col.category', 'output.col.n', key('percent')), rows, if (!is.null(weighted$w)) key('weightedCounts') else NULL)
  }
  if (st$modelFit) add('output.multinom.fitTitle', c('output.col.model','output.col.neg2LL','output.col.chiSquare','output.col.df','output.col.sig'), list(
    list('output.col.intercept', round(null_neg2ll, 6), NA, NA, NA),
    list('output.col.final', round(neg2ll, 6), round(2 * (fit$ll - null$ll), 6), fit$df - null$df, sig(2 * (fit$ll - null$ll), fit$df - null$df))))
  if (st$pseudoR2) {
    cs <- 1 - exp(2 * (null$ll - fit$ll) / sum(y))
    add(key('pseudoR2'), c('output.col.model', key('value')), list(list('Cox & Snell', cs), list('Nagelkerke', cs / (1 - exp(2 * null$ll / sum(y)))), list('McFadden', 1 - fit$ll / null$ll)))
  }
  if (st$informationCriteria) add(key('informationCriteria'), c('output.col.model', 'AIC', 'BIC'), list(
    list('output.col.intercept', round(null_neg2ll + 2 * null$df, 6), round(null_neg2ll + log(sum(y)) * null$df, 6)),
    list('output.col.final', round(neg2ll + 2 * fit$df, 6), round(neg2ll + log(sum(y)) * fit$df, 6))))
  if (st$stepSummary && length(terms$stepped)) {
    rows <- lapply(selection$history, function(row) { row[[2]] <- key(row[[2]]); row[[3]] <- label_term(row[[3]]); row[[4]] <- row[[4]] - 2 * constant; row })
    add(key('stepSummary'), c(key('step'),key('action'),key('effect'),'output.col.neg2LL','output.col.sig'), rows)
  }
  if (crit$printHistory) {
    rows <- Filter(function(row) row[[1]] %% crit$historyEvery == 0L, fit$history)
    rows <- lapply(rows, function(row) { row[[2]] <- row[[2]] - 2 * constant; row })
    add(key('history'), c(key('iteration'),'output.col.neg2LL',key('parameterChange'),key('halvings')), rows)
  }
  if (st$estimates) {
    rows <- list(); z <- qnorm(.5 + st$ciLevel / 200); unreliable <- FALSE
    for (category in seq_len(k - 1L)) for (j in seq_len(ncol(fit$x))) {
      idx <- (category - 1L) * ncol(fit$x) + j
      b <- coefficient[idx]; s <- se[idx]
      # A non-finite SE means the information matrix was singular in this
      # direction (quasi/complete separation): B is still meaningful, but a
      # Wald/Sig/CI built on that SE would be fabricated, not measured — report
      # them missing instead of letting a near-zero SE manufacture a huge,
      # spuriously "significant" Wald statistic.
      reliable <- is.finite(s) && s > 0
      if (!reliable) unreliable <- TRUE
      wald <- if (reliable) (b / s)^2 else NA_real_
      rows[[length(rows) + 1L]] <- list(cat_names[category + 1L], column_labels[j], b,
        if (reliable) s else NA_real_, wald, 1L, if (reliable) sig(wald, 1L) else NA_real_,
        exp(b), if (reliable) exp(b - z * s) else NA_real_, if (reliable) exp(b + z * s) else NA_real_)
    }
    add('output.multinom.paramTitle', c('output.col.category','output.col.model','output.col.b','output.col.stdError','output.col.wald','output.col.df','output.col.sig','output.col.expB', paste0(key('lower'), ':', st$ciLevel), paste0(key('upper'), ':', st$ciLevel)), rows, paste0(key('reference'), ':', cat_names[1]))
    if (unreliable) warnings <- c(warnings, key('unreliableEstimates'))
  }
  if (st$likelihoodRatio) {
    rows <- lapply(fit$terms, function(term) {
      reduced <- selection$fit_terms(setdiff(fit$terms, term))
      chi <- max(0, 2 * (fit$ll - reduced$ll)); df_test <- fit$df - reduced$df
      list(label_term(term), -2 * (reduced$ll + constant), chi, df_test, if (reduced$converged && fit$converged) sig(chi, df_test) else NA_real_)
    })
    add(key('likelihoodRatio'), c(key('effect'),'output.col.neg2LL','output.col.chiSquare','output.col.df','output.col.sig'), rows)
  }
  if (st$correlations || st$covariances) {
    labels <- unlist(lapply(cat_names[-1], function(cat) paste0(key('coefficientLabel'), ':', cat, '|', column_labels)))
    matrix_table <- function(title, mat) add(key(title), c(key('parameter'), labels), lapply(seq_along(labels), function(i) c(list(labels[i]), as.list(mat[i, ]))))
    if (st$covariances) matrix_table('covariances', covariance)
    if (st$correlations) matrix_table('correlations', covariance / outer(se, se))
  }
  if (st$goodnessOfFit) add(key('goodnessOfFit'), c('output.col.model','output.col.chiSquare','output.col.df','output.col.sig'), list(list('Pearson', pearson, residual_df, sig(pearson, residual_df)), list(key('deviance'), deviance, residual_df, sig(deviance, residual_df))))
  if ((st$goodnessOfFit || st$cellProbabilities) && any(expected < 5)) warnings <- c(warnings, key('sparseCells'))
  if (st$cellProbabilities) {
    rows <- list(); first_sub <- match(seq_len(max(sg)), sg)
    sub_labels <- if (length(subpop)) apply(dat[first_sub, subpop, drop = FALSE], 1, paste, collapse = ' / ') else rep(key('allCases'), nrow(obs))
    for (i in seq_len(nrow(obs))) for (j in disp) rows[[length(rows) + 1L]] <- list(sub_labels[i], cat_names[j], obs[i,j], expected[i,j], obs[i,j] - expected[i,j], obs[i,j] / totals[i], expected[i,j] / totals[i])
    add(key('cellProbabilities'), c(key('subpopulation'),'output.col.category',key('observed'),key('expected'),key('residual'),key('observedProportion'),key('expectedProbability')), rows)
  }
  if (st$classification) {
    tab <- matrix(0, k, k)
    for (i in seq_len(nrow(dat))) tab[outcome[i], winner[i]] <- tab[outcome[i], winner[i]] + w[i]
    rows <- lapply(disp, function(j) c(list(cat_names[j]), as.list(tab[j, disp]), list(100 * tab[j,j] / sum(tab[j, ]))))
    rows[[length(rows) + 1L]] <- c(list(key('overall')), as.list(colSums(tab)[disp]), list(100 * sum(diag(tab)) / sum(tab)))
    add(key('classification'), c('output.col.category', cat_names[disp], key('percentCorrect')), rows)
  }
  if (st$monotonicity) add(key('monotonicity'), c('output.col.category',key('measure'),key('value')), mn_association(pp, outcome, w, cat_names), key('associationFootnote'))
  case_vars <- list(); want <- requested_new_vars(params)
  append_var <- function(name, values, label, type = 'numeric', measure = 'scale') {
    case_vars[[length(case_vars) + 1L]] <<- sai_case_var(name, values, dat, labelKey = label, type = type, measure = measure)
  }
  if (!is.null(want$predictedGroup)) append_var(want$predictedGroup, levels_y[winner], 'output.multinom.newVar.predictedGroup', 'string', 'nominal')
  if (!is.null(want$probability)) append_var(want$probability, pp[cbind(seq_len(nrow(dat)), winner)], 'output.multinom.newVar.probability')
  if (!is.null(want$actualProbability)) append_var(want$actualProbability, pp[cbind(seq_len(nrow(dat)), outcome)], key('actualProbability'))
  if (!is.null(want$estimatedProbabilities)) for (i in seq_len(k)) { j <- disp[i]; append_var(paste0(want$estimatedProbabilities, i), pp[, j], paste0(key('estimatedProbability'), ':', cat_names[j])) }
  xml <- NULL
  if (isTRUE(params$exportModel$enabled)) {
    if (!fit$converged || fit$separated) stop('output.multinom.extra.xmlConvergence')
    xml <- mn_pmml(fit, dat, dep, predictors, params$sourceNames, covariance, isTRUE(params$exportModel$covariance))
  }
  progress(100L, 'progress.done')
  sai_output(tables = table_list, caseVars = case_vars, warnings = warnings, modelXml = xml)
}, error = function(e) sai_error(conditionMessage(e)))
