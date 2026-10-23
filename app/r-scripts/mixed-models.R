# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# mixed-models.R — Linear Mixed Models (SPSS Mixed → Linear).
#
# Params:
#   dependent, dependentName, subject (grouping colId)
#   factors (colIds), covariates (colIds), varNames (colId -> display name)
#   predictors (colIds) — back-compat alias for covariates (the first version
#     of this dialog had a single numeric "Predictors" list)
#   options:
#     fixed:  { model: 'main'|'factorial', intercept: TRUE, ssType: 'III'|'I' }
#     random: { intercept: TRUE, slopes: [covariate colIds],
#               covType: 'vc'|'diagonal'|'unstructured'|'identity' }
#     estimation: { method: 'REML'|'ML' }
#     statistics: { descriptives, paramEstimates (default TRUE),
#                   covParams (default TRUE), covCI, ciLevel (0-1) }
#     emMeans: { terms: ["OVERALL" | factor colId], compareMainEffects,
#                ciAdjust: 'none'|'bonferroni'|'sidak' }
#
# Output: Model Dimension-style Information Criteria, Type III (or I) Tests of
#   Fixed Effects, Estimates of Fixed Effects, Estimates of Covariance
#   Parameters (with confidence intervals on request), Descriptive Statistics,
#   Estimated Marginal Means and pairwise comparisons.
#
# Engine: nlme::lme (bundled). Its denominator degrees of freedom follow the
# containment ("between/within") rule, not SPSS's Satterthwaite; a note says
# so on every run rather than letting the df column look like SPSS's.
# Covariance types map onto nlme's pdMat classes: Variance Components and
# Diagonal -> pdDiag, Unstructured -> pdSymm, Scaled Identity -> pdIdent.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  if (!requireNamespace("nlme", quietly = TRUE)) {
    sai_output(tables = list(), warnings = "output.mixed.needsPackage"); quit(save = "no")
  }
  options(contrasts = c("contr.sum", "contr.poly"))
  dep   <- params$dependent
  dname <- if (is.null(params$dependentName)) dep else params$dependentName
  subj  <- params$subject
  facs  <- unlist(params$factors)
  covs  <- unique(c(unlist(params$covariates), unlist(params$predictors)))
  var_names <- if (is.null(params$varNames)) list() else params$varNames
  opts  <- if (is.null(params$options)) list() else params$options
  fx  <- if (is.null(opts$fixed)) list() else opts$fixed
  rnd <- if (is.null(opts$random)) list() else opts$random
  est <- if (is.null(opts$estimation)) list() else opts$estimation
  st  <- if (is.null(opts$statistics)) list() else opts$statistics
  nm_of <- function(c) if (!is.null(var_names[[c]])) var_names[[c]] else c

  if (is.null(dep) || !dep %in% names(df)) sai_error("Dependent variable not found")
  if (is.null(subj) || !subj %in% names(df)) sai_error("Subject variable not found")
  if (length(facs) + length(covs) == 0) sai_error("No predictors specified")
  for (v in c(facs, covs)) if (!v %in% names(df)) sai_error(paste("Column not found:", v))

  method <- if (identical(est$method, "ML")) "ML" else "REML"
  fixed_intercept <- !isFALSE(fx$intercept)
  ss_type <- if (identical(fx$ssType, "I")) "I" else "III"
  ci_level <- suppressWarnings(as.numeric(st$ciLevel))
  if (length(ci_level) != 1 || is.na(ci_level) || ci_level <= 0 || ci_level >= 1) ci_level <- 0.95
  ci_pct <- as.character(round_half_up(ci_level * 100, 4))
  r3 <- function(x) round_half_up(x, 3); r6 <- function(x) round_half_up(x, 6)

  # ── Data (listwise, user-missing applied) ───────────────────────────────────
  dat <- data.frame(.y = suppressWarnings(as.numeric(apply_user_missing(df[[dep]], dep, params))),
                    .g = factor(as.character(apply_user_missing(df[[subj]], subj, params))))
  for (i in seq_along(facs)) dat[[paste0("f", i)]] <-
    factor(as.character(apply_user_missing(df[[facs[i]]], facs[i], params)))
  for (i in seq_along(covs)) dat[[paste0("c", i)]] <-
    suppressWarnings(as.numeric(apply_user_missing(df[[covs[i]]], covs[i], params)))
  dat <- dat[stats::complete.cases(dat), , drop = FALSE]
  if (nrow(dat) <= length(facs) + length(covs) + 2) sai_error("Not enough complete cases")
  if (nlevels(dat$.g) < 2) sai_error("Subject factor needs at least 2 groups")

  label_tok <- function(tok) {
    idx <- as.integer(sub("^[fc]", "", tok))
    if (startsWith(tok, "f")) nm_of(facs[idx]) else nm_of(covs[idx])
  }
  label_term <- function(t) paste(vapply(strsplit(t, ":", fixed = TRUE)[[1]], label_tok, ""), collapse = " * ")

  # ── Fixed part ──────────────────────────────────────────────────────────────
  cov_terms <- if (length(covs)) paste0("c", seq_along(covs)) else character(0)
  fac_terms <- if (length(facs)) {
    if (identical(fx$model, "factorial")) paste(paste0("f", seq_along(facs)), collapse = " * ")
    else paste0("f", seq_along(facs))
  } else character(0)
  rhs <- paste(c(cov_terms, fac_terms), collapse = " + ")
  if (!fixed_intercept) rhs <- paste("0 +", rhs)
  fixed_f <- as.formula(paste(".y ~", rhs))

  # ── Random part ─────────────────────────────────────────────────────────────
  slopes <- intersect(unlist(rnd$slopes), covs)
  slope_terms <- if (length(slopes)) paste0("c", match(slopes, covs)) else character(0)
  rand_int <- !isFALSE(rnd$intercept)
  if (!rand_int && length(slope_terms) == 0) sai_error("The random effects part is empty")
  rand_rhs <- paste(c(if (rand_int) "1" else "0", slope_terms), collapse = " + ")
  rand_f <- as.formula(paste("~", rand_rhs))
  cov_type <- if (is.null(rnd$covType)) "vc" else rnd$covType
  pd <- switch(cov_type,
    unstructured = nlme::pdSymm(rand_f),
    identity     = nlme::pdIdent(rand_f),
    nlme::pdDiag(rand_f))
  random <- list(.g = pd)

  progress(40L, "progress.computing")
  fit <- nlme::lme(fixed_f, random = random, data = dat, method = method,
                   control = nlme::lmeControl(returnObject = TRUE))
  s <- summary(fit)
  tables <- list(); notes <- character(0); warns <- character(0)

  # ── Information Criteria ────────────────────────────────────────────────────
  # SPSS's Information Criteria, in its order: -2LL, AIC, AICC, CAIC, BIC,
  # exactly as the SPSS Statistics Algorithms manual (MIXED) defines them:
  # AIC = -2l + 2d, AICC = -2l + 2dn/(n-d-1), BIC = -2l + d log n,
  # CAIC = -2l + d (log n + 1), where under REML n = cases - fixed-effect
  # parameters and d = covariance parameters only, and under ML n = cases and
  # d = fixed + covariance parameters. (This used to apply the ML counting to
  # REML too — lme4's convention — so REML runs printed an AIC and BIC SPSS
  # would not.)
  ll <- as.numeric(logLik(fit)); npar <- attr(logLik(fit), "df"); N <- nrow(dat)
  p_fixed <- length(nlme::fixef(fit))
  ic_n <- if (method == "REML") N - p_fixed else N
  ic_d <- if (method == "REML") npar - p_fixed else npar
  m2ll <- -2 * ll
  tables[[length(tables) + 1L]] <- list(
    titleKey = "output.mixed.fitTitle",
    columns = list("output.col.statistic", "output.col.value"),
    rows = list(
      list(if (method == "REML") "output.mixed.m2ll" else "output.mixed.m2llML", r3(m2ll)),
      list("output.col.aic", r3(m2ll + 2 * ic_d)),
      list("output.mixed.aicc", r3(m2ll + 2 * ic_d * ic_n / (ic_n - ic_d - 1))),
      list("output.mixed.caic", r3(m2ll + ic_d * (log(ic_n) + 1))),
      list("output.col.bic", r3(m2ll + ic_d * log(ic_n)))),
    footnoteKey = paste0("output.mixed.depFootnote:", dname))

  # ── Tests of Fixed Effects ──────────────────────────────────────────────────
  av <- anova(fit, type = if (ss_type == "III") "marginal" else "sequential")
  frows <- lapply(rownames(av), function(rn) list(
    if (rn == "(Intercept)") "output.col.intercept" else label_term(rn),
    as.integer(av[rn, "numDF"]), r3(av[rn, "denDF"]), r3(av[rn, "F-value"]), r6(av[rn, "p-value"])))
  tables[[length(tables) + 1L]] <- list(
    titleKey = if (ss_type == "III") "output.mixed.type3Title" else "output.mixed.type1Title",
    columns = list("output.col.source", "output.col.numDf", "output.col.denDf",
                   "output.col.f", "output.col.sig"),
    rows = frows, footnoteKey = paste0("output.mixed.depFootnote:", dname))

  # ── Estimates of Fixed Effects ──────────────────────────────────────────────
  if (!isFALSE(st$paramEstimates)) {
    tt <- s$tTable
    coef_label <- function(cn) {
      if (cn == "(Intercept)") return("output.col.intercept")
      # Sum-to-zero codes are named f1A1, f1A2 ...; show the factor and the
      # level the column stands for (level k of k-1 coded columns).
      parts <- strsplit(cn, ":", fixed = TRUE)[[1]]
      paste(vapply(parts, function(p) {
        m <- regmatches(p, regexec("^(f\\d+)(\\d+)$", p))[[1]]
        if (length(m) == 3) {
          fi <- as.integer(sub("^f", "", m[2])); lv <- levels(dat[[m[2]]])[as.integer(m[3])]
          paste0(nm_of(facs[fi]), "=", lv)
        } else label_tok(p)
      }, ""), collapse = " * ")
    }
    tcrit <- function(d) qt(1 - (1 - ci_level) / 2, d)
    fe_rows <- lapply(seq_len(nrow(tt)), function(i) {
      b <- tt[i, "Value"]; se <- tt[i, "Std.Error"]; d <- tt[i, "DF"]
      list(coef_label(rownames(tt)[i]), r6(b), r6(se), r3(d), r3(tt[i, "t-value"]), r6(tt[i, "p-value"]),
           r6(b - tcrit(d) * se), r6(b + tcrit(d) * se))
    })
    tables[[length(tables) + 1L]] <- list(
      titleKey = "output.mixed.fixedTitle",
      columns = list("output.col.parameter", "output.col.b", "output.col.stdError", "output.col.df",
                     "output.col.t", "output.col.sig",
                     paste0("output.col.ciLowerPct:", ci_pct), paste0("output.col.ciUpperPct:", ci_pct)),
      rows = fe_rows,
      footnoteKey = if (length(facs)) "output.mixed.sumCodingFootnote" else NULL)
  }

  # ── Estimates of Covariance Parameters ──────────────────────────────────────
  if (!isFALSE(st$covParams)) {
    vc <- nlme::VarCorr(fit)
    rn <- rownames(vc)
    re_label <- function(r) if (r == "(Intercept)") "output.mixed.interceptVar"
                            else if (r == "Residual") "output.mixed.residualVar"
                            else paste0("output.mixed.slopeVar:", label_tok(r))
    want_ci <- isTRUE(st$covCI)
    ci <- if (want_ci) tryCatch(nlme::intervals(fit, level = ci_level, which = "var-cov"),
                                error = function(e) NULL) else NULL
    if (want_ci && is.null(ci)) warns <- c(warns, "output.mixed.covCiNotComputed")
    crow <- function(lbl, v, lo = NA, hi = NA) {
      r <- list(lbl, r6(v), r6(sqrt(v)))
      if (want_ci) r <- c(r, list(if (is.na(lo)) NULL else r6(lo^2), if (is.na(hi)) NULL else r6(hi^2)))
      r
    }
    cov_rows <- list()
    re_ci <- if (!is.null(ci)) ci$reStruct$.g else NULL
    # Residual first, then the random effects — SPSS's order.
    for (r in c("Residual", setdiff(rn, "Residual"))) {
      v <- suppressWarnings(as.numeric(vc[r, "Variance"]))
      if (is.na(v)) next
      lo <- hi <- NA
      if (r == "Residual" && !is.null(ci)) { lo <- ci$sigma[["lower"]]; hi <- ci$sigma[["upper"]] }
      else if (!is.null(re_ci)) {
        key <- paste0("sd(", r, ")")
        if (key %in% rownames(re_ci)) { lo <- re_ci[key, "lower"]; hi <- re_ci[key, "upper"] }
      }
      cov_rows[[length(cov_rows) + 1L]] <- crow(re_label(r), v, lo, hi)
    }
    # Unstructured: the covariances between random effects.
    if (cov_type == "unstructured" && "Corr" %in% colnames(vc)) {
      sds <- suppressWarnings(as.numeric(vc[, "StdDev"])); names(sds) <- rn
      cm <- nlme::corMatrix(fit$modelStruct$reStruct[[1]])
      if (is.matrix(cm) && nrow(cm) >= 2) for (i in 1:(nrow(cm) - 1)) for (j in (i + 1):nrow(cm)) {
        cv <- cm[i, j] * sds[rownames(cm)[i]] * sds[rownames(cm)[j]]
        cov_rows[[length(cov_rows) + 1L]] <- c(list(
          paste0("output.mixed.covBetween:", label_tok(rownames(cm)[i]), "|", label_tok(rownames(cm)[j])),
          r6(cv), NULL), if (want_ci) list(NULL, NULL))
      }
    }
    tables[[length(tables) + 1L]] <- list(
      titleKey = "output.mixed.covTitle",
      columns = c(list("output.col.parameter", "output.col.variance", "output.col.stdDev"),
                  if (want_ci) list(paste0("output.col.ciLowerPct:", ci_pct), paste0("output.col.ciUpperPct:", ci_pct))),
      rows = cov_rows,
      footnoteKey = paste0("output.mixed.covTypeFootnote:output.mixed.covType.", cov_type))
  }

  # ── Descriptive Statistics (by factor cell) ─────────────────────────────────
  if (isTRUE(st$descriptives)) {
    cells <- if (length(facs)) interaction(dat[, paste0("f", seq_along(facs)), drop = FALSE],
                                           drop = TRUE, sep = "\u001f") else factor(rep("all", nrow(dat)))
    drows <- lapply(levels(cells), function(lv) {
      y <- dat$.y[cells == lv]
      c(if (length(facs)) as.list(strsplit(lv, "\u001f", fixed = TRUE)[[1]]) else list("output.col.total"),
        list(length(y), r3(mean(y)), r3(sd(y))))
    })
    tables[[length(tables) + 1L]] <- list(
      titleKey = paste0("output.mixed.descriptivesTitle:", dname),
      columns = c(if (length(facs)) as.list(unname(vapply(facs, nm_of, ""))) else list("output.col.group"),
                  list("output.col.n", "output.col.mean", "output.col.stdDeviation")),
      rows = drows, footnoteKey = NULL)
  }

  # ── Estimated Marginal Means ────────────────────────────────────────────────
  em <- if (is.null(opts$emMeans)) list() else opts$emMeans
  em_terms <- unlist(em$terms)
  if (length(em_terms)) {
    beta <- nlme::fixef(fit); V <- vcov(fit)
    lvls <- lapply(seq_along(facs), function(i) levels(dat[[paste0("f", i)]]))
    grid <- if (length(facs)) expand.grid(setNames(lvls, paste0("f", seq_along(facs))),
                                          KEEP.OUT.ATTRS = FALSE, stringsAsFactors = TRUE)
            else data.frame(.one = 1)
    for (i in seq_along(covs)) grid[[paste0("c", i)]] <- mean(dat[[paste0("c", i)]])
    tt_fixed <- delete.response(terms(fixed_f))
    mf0 <- model.frame(tt_fixed, dat)
    Lg <- model.matrix(tt_fixed, model.frame(tt_fixed, grid, xlev = .getXlevels(tt_fixed, mf0)))
    # Residual df for the t quantile: nlme's within-group df (the containment
    # df of a lowest-level effect), stated in the note below.
    df_t <- fit$fixDF$X[length(fit$fixDF$X)]
    tq <- qt(1 - (1 - ci_level) / 2, df_t)
    emm <- function(rows) { l <- colMeans(Lg[rows, , drop = FALSE])
      c(est = sum(l * beta), se = sqrt(drop(t(l) %*% V %*% l))) }
    row_of <- function(lbls, r) c(lbls, list(r3(r[["est"]]), r3(r[["se"]]), r3(df_t),
      r3(r[["est"]] - tq * r[["se"]]), r3(r[["est"]] + tq * r[["se"]])))
    em_cols <- function(h) c(h, list("output.col.mean", "output.col.stdError", "output.col.df",
      paste0("output.col.ciLowerPct:", ci_pct), paste0("output.col.ciUpperPct:", ci_pct)))
    for (term in em_terms) {
      if (identical(term, "OVERALL")) {
        tables[[length(tables) + 1L]] <- list(titleKey = "output.mixed.emOverallTitle",
          columns = em_cols(list()), rows = list(row_of(list(), emm(seq_len(nrow(Lg))))), footnoteKey = NULL)
        next
      }
      fi <- match(term, facs); if (is.na(fi)) next
      fname <- nm_of(facs[fi]); col <- paste0("f", fi)
      tables[[length(tables) + 1L]] <- list(titleKey = paste0("output.mixed.emTitle:", fname),
        columns = em_cols(list(fname)),
        rows = lapply(lvls[[fi]], function(lv) row_of(list(lv), emm(which(grid[[col]] == lv)))),
        footnoteKey = NULL)
      if (isTRUE(em$compareMainEffects)) {
        adj <- if (is.null(em$ciAdjust)) "none" else em$ciAdjust
        lv <- lvls[[fi]]; m <- length(lv); ncmp <- m * (m - 1) / 2
        a_ci <- switch(adj, bonferroni = (1 - ci_level) / ncmp, sidak = 1 - ci_level^(1 / ncmp), 1 - ci_level)
        tc <- qt(1 - a_ci / 2, df_t); rr <- list()
        for (i in seq_len(m)) { first <- TRUE; for (j in seq_len(m)) if (i != j) {
          l <- colMeans(Lg[grid[[col]] == lv[i], , drop = FALSE]) - colMeans(Lg[grid[[col]] == lv[j], , drop = FALSE])
          d <- sum(l * beta); se <- sqrt(drop(t(l) %*% V %*% l))
          pv <- 2 * pt(-abs(d / se), df_t)
          pv <- switch(adj, bonferroni = min(1, pv * ncmp), sidak = 1 - (1 - pv)^ncmp, pv)
          rr[[length(rr) + 1L]] <- list(if (first) lv[i] else "", lv[j], r3(d), r3(se), r3(df_t), r6(pv),
                                        r3(d - tc * se), r3(d + tc * se))
          first <- FALSE
        } }
        tables[[length(tables) + 1L]] <- list(
          titleKey = paste0("output.mixed.pairwiseTitle:", fname),
          columns = list(paste0("output.col.levelI:", fname), paste0("output.col.levelJ:", fname),
                         "output.col.meanDiff", "output.col.stdError", "output.col.df", "output.col.sig",
                         paste0("output.col.ciLowerPct:", ci_pct), paste0("output.col.ciUpperPct:", ci_pct)),
          rows = rr,
          footnoteKey = paste0("output.glmRep.pairwiseFootnote:",
                               switch(adj, bonferroni = "output.glmRep.adjBonferroni",
                                      sidak = "output.glmRep.adjSidak", "output.glmRep.adjLsd")))
      }
    }
  }

  notes <- c(notes, "output.mixed.dfNote")
  progress(100L, "progress.done")
  sai_output(tables = tables, warnings = warns, notes = notes)
}, error = function(e) sai_error(conditionMessage(e)))
