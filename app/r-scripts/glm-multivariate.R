# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# glm-multivariate.R — GLM Multivariate (MANOVA / MANCOVA, SPSS-style).
#
# Params: dependents (colIds, >= 2), dependentNames, factors (colIds),
#         factorNames, covariates (colIds), covariateNames, and the same
#         `options` object as glm-univariate.R (ssType, includeIntercept,
#         sigLevel, descriptives, effectSize, power, paramEstimates,
#         homogeneity, contrasts, postHoc, emMeans).
#
# Output, in SPSS's order:
#   * Box's Test of Equality of Covariance Matrices (with "homogeneity")
#   * Multivariate Tests — Pillai's Trace, Wilks' Lambda, Hotelling's Trace and
#     Roy's Largest Root for the intercept and every model term, with partial
#     eta squared / observed power when requested
#   * then, per dependent variable, everything GLM Univariate prints for it —
#     produced by the SAME engine (_glm_univariate_core.R), so Tests of
#     Between-Subjects Effects, Descriptives, Levene, Parameter Estimates,
#     Post Hoc and EM Means cannot differ from running Univariate on that
#     dependent with the same case set.
#
# Case set: listwise across every dependent, factor and covariate (SPSS's
# MANOVA uses one case set for the whole multivariate model), so each
# per-dependent table describes the same cases the multivariate tests used.
#
# The multivariate tests use the hypothesis SSCP matrix H of each term, built
# with the SAME sum-of-squares type the univariate tables use (I, II, III/IV)
# — the diagonal of H is exactly each dependent's univariate SS for that term
# — and the error SSCP E of the full model. The four statistics and their F
# approximations are base R's own (stats:::Pillai/Wilks/HL/Roy, the functions
# summary.manova() calls), applied to the eigenvalues of E^-1 H.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)
source(file.path(.params_raw$rScriptsDir, "_glm_univariate_core.R"))

tryCatch({
  progress(10L, "progress.loading")
  options(contrasts = c("contr.sum", "contr.poly"))
  deps  <- unlist(params$dependents); dnames <- params$dependentNames
  facs  <- unlist(params$factors);    fnames <- params$factorNames
  covs  <- unlist(params$covariates); cnames <- params$covariateNames
  opts  <- if (is.null(params$options)) list() else params$options
  if (length(deps) < 2) sai_error("Multivariate needs at least two dependent variables")
  if (length(facs) == 0 && length(covs) == 0) sai_error("No fixed factors or covariates specified")
  for (v in c(deps, facs, covs)) if (!v %in% names(df)) sai_error(paste("Column not found:", v))
  nm_of <- function(c, tbl) if (!is.null(tbl[[c]])) tbl[[c]] else c

  ss_type <- if (!is.null(opts$ssType) && opts$ssType %in% c("I", "II", "III", "IV")) opts$ssType else "III"
  include_intercept <- if (!is.null(opts$includeIntercept)) isTRUE(opts$includeIntercept) else TRUE
  alpha <- suppressWarnings(as.numeric(opts$sigLevel))
  if (length(alpha) != 1 || is.na(alpha) || alpha <= 0 || alpha >= 1) alpha <- 0.05

  # ── One listwise case set for the whole model ───────────────────────────────
  .gw <- get_weights(df, params); df <- .gw$df; w <- .gw$w
  dat <- data.frame(.row = seq_len(nrow(df)))
  for (i in seq_along(deps)) dat[[paste0("y", i)]] <-
    suppressWarnings(as.numeric(apply_user_missing(df[[deps[i]]], deps[i], params)))
  for (i in seq_along(facs)) dat[[paste0("f", i)]] <-
    factor(as.character(apply_user_missing(df[[facs[i]]], facs[i], params)))
  for (i in seq_along(covs)) dat[[paste0("c", i)]] <-
    suppressWarnings(as.numeric(apply_user_missing(df[[covs[i]]], covs[i], params)))
  keep <- stats::complete.cases(dat)
  dat <- dat[keep, , drop = FALSE]; df <- df[keep, , drop = FALSE]
  if (!is.null(w)) w <- w[keep]
  n <- nrow(dat); p <- length(deps)
  if (n <= p + length(facs) + length(covs) + 1) sai_error("Not enough complete cases")
  Y <- as.matrix(dat[, paste0("y", seq_len(p)), drop = FALSE])

  # ── Model matrix — the same formula the univariate engine builds ────────────
  cov_terms <- if (length(covs) > 0) paste0("c", seq_along(covs)) else character(0)
  fac_terms <- if (length(facs) > 0) paste(paste0("f", seq_along(facs)), collapse = " * ") else character(0)
  rhs <- paste(c(cov_terms, fac_terms), collapse = " + ")
  if (!include_intercept) rhs <- paste0("0 + ", rhs)
  mf <- model.frame(as.formula(paste("~", rhs)), data = dat)
  X  <- model.matrix(attr(mf, "terms"), mf)
  asg <- attr(X, "assign")
  tl  <- attr(attr(mf, "terms"), "term.labels")

  wvec <- if (is.null(w)) rep(1, n) else w
  resid_sscp <- function(cols) {
    if (sum(cols) == 0) return(crossprod(Y * sqrt(wvec)))
    R <- if (is.null(w)) lm.fit(X[, cols, drop = FALSE], Y)$residuals
         else lm.wfit(X[, cols, drop = FALSE], Y, w)$residuals
    R <- as.matrix(R)
    crossprod(R * sqrt(wvec))
  }
  all_cols <- rep(TRUE, ncol(X))
  E <- resid_sscp(all_cols)
  # Frequency weights stand for sum(w) cases: error df is sum(w) - rank.
  dfres <- (if (is.null(w)) n else sum(w)) - qr(X)$rank
  if (dfres < p) sai_error("Not enough error degrees of freedom for the multivariate tests")

  # Hypothesis SSCP per term, by sum-of-squares type (mirrors the core).
  term_vars <- lapply(tl, function(t) strsplit(t, ":", fixed = TRUE)[[1]])
  H_of <- function(j) {
    if (ss_type == "I") {
      before <- asg < j
      return(resid_sscp(before) - resid_sscp(asg <= j))
    }
    if (ss_type == "II") {
      tv <- term_vars[[j]]
      sup <- which(vapply(term_vars, function(t2) length(tv) < length(t2) && all(tv %in% t2), logical(1)))
      reduced <- !(asg %in% c(j, sup))
      return(resid_sscp(reduced) - resid_sscp(reduced | asg == j))
    }
    resid_sscp(asg != j) - E
  }
  H_int <- if (!include_intercept) NULL else if (ss_type == "I") {
    m <- colSums(Y * wvec); tcrossprod(m) / sum(wvec)
  } else resid_sscp(asg != 0) - E

  # ── Multivariate tests ──────────────────────────────────────────────────────
  want_es <- isTRUE(opts$effectSize); want_power <- isTRUE(opts$power)
  stat_fns <- list(
    list(key = "output.col.pillai",    fn = stats:::Pillai),
    list(key = "output.col.wilks",     fn = stats:::Wilks),
    list(key = "output.col.hotelling", fn = stats:::HL),
    list(key = "output.col.roy",       fn = stats:::Roy))
  # Partial eta squared as SPSS defines it for each statistic (s = min(p, q)).
  pes <- function(k, v, s) switch(k,
    "output.col.pillai" = v / s,
    "output.col.wilks" = 1 - v^(1 / s),
    "output.col.hotelling" = (v / s) / (v / s + 1),
    "output.col.roy" = v / (1 + v))
  Einv <- tryCatch(solve(E), error = function(e) sai_error("The error SSCP matrix is singular"))
  mv_rows <- list(); mv_footnote <- NULL
  add_effect <- function(label, H, q) {
    eig <- Re(eigen(Einv %*% H, only.values = TRUE)$values)
    eig <- pmax(eig, 0)
    s <- min(p, q)
    first <- TRUE
    for (sf in stat_fns) {
      r <- sf$fn(eig, q, dfres)
      Fv <- r[2]; df1 <- r[3]; df2 <- r[4]
      row <- list(if (first) label else "", sf$key, round_half_up(r[1], 3), round_half_up(Fv, 3),
                  round_half_up(df1, 3), round_half_up(df2, 3),
                  round(pf(Fv, df1, df2, lower.tail = FALSE), 6))
      if (want_es) row <- c(row, list(round_half_up(pes(sf$key, r[1], s), 3)))
      if (want_power) {
        crit <- qf(1 - alpha, df1, df2)
        row <- c(row, list(round_half_up(pf(crit, df1, df2, ncp = Fv * df1, lower.tail = FALSE), 3)))
      }
      mv_rows[[length(mv_rows) + 1L]] <<- row
      first <- FALSE
    }
    # Roy's F is an upper bound; SPSS footnotes it, and so do we once.
    if (s > 1) mv_footnote <<- "output.glmMulti.royFootnote"
  }
  label_term <- function(t) paste(vapply(strsplit(t, ":", fixed = TRUE)[[1]], function(tok) {
    idx <- as.integer(sub("^[fc]", "", tok))
    if (startsWith(tok, "f")) nm_of(facs[idx], fnames) else nm_of(covs[idx], cnames)
  }, character(1)), collapse = " * ")
  if (include_intercept) add_effect("output.col.intercept", H_int, 1)
  for (j in seq_along(tl)) add_effect(label_term(tl[j]), H_of(j), sum(asg == j))

  mv_cols <- list("output.col.effect", "output.col.statistic", "output.col.value",
                  "output.col.f", "output.col.hypDf", "output.col.errorDf", "output.col.sig")
  if (want_es) mv_cols <- c(mv_cols, list("output.col.partialEtaSquared"))
  if (want_power) mv_cols <- c(mv_cols, list("output.col.observedPower"))
  tables <- list(list(titleKey = "output.glmMulti.mvTitle", columns = mv_cols,
                      rows = mv_rows, footnoteKey = mv_footnote))
  warns <- character(0); notes <- character(0)

  # ── Box's M (Options ▸ Homogeneity tests) — sai_box_m() in _bootstrap.R ─────
  if (isTRUE(opts$homogeneity) && length(facs) > 0) {
    cell <- interaction(dat[, paste0("f", seq_along(facs)), drop = FALSE], drop = TRUE)
    bx <- sai_box_m(Y, cell, w)
    if (is.null(bx$table)) {
      warns <- c(warns, "output.glmMulti.boxNotComputed")
    } else {
      tables <- c(list(bx$table), tables)
      if (bx$skipped > 0) notes <- c(notes, paste0("output.glmMulti.boxSkippedNote:", bx$skipped))
    }
  }

  # ── Per-dependent univariate results, from the Univariate engine ────────────
  # The case set is already listwise; the core re-applies user-missing and
  # weights to an already clean frame, which changes nothing. Save is not
  # offered for Multivariate, so createVars is dropped.
  progress(40L, "progress.loading")
  for (i in seq_along(deps)) {
    sub <- params
    sub$dependent <- deps[i]; sub$dependentName <- nm_of(deps[i], dnames)
    sub$createVars <- NULL
    res <- glm_univariate_core(df, sub)
    tables <- c(tables, res$tables)
    warns <- c(warns, res$warnings); notes <- c(notes, res$notes)
  }

  progress(100L, "progress.done")
  sai_output(tables = tables, warnings = unique(warns), notes = unique(notes))
}, error = function(e) sai_error(conditionMessage(e)))
