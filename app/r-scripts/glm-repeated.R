# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# glm-repeated.R — GLM Repeated Measures (SPSS-style): one within-subject
# factor, optional between-subjects factors and covariates (mixed design).
#
# Params:
#   variables (k level colIds, in level order), varNames, factorName
#   betweenFactors (colIds), betweenNames, covariates (colIds), covariateNames
#   options:
#     multivariate (default TRUE), withinContrasts (default TRUE) — SPSS prints
#       both by default
#     descriptives, effectSize, power, homogeneity          bool
#     sigLevel                                               "0.05"
#     emMeans: { terms: ["OVERALL" | "WITHIN" | colId | "WITHIN*colId" |
#                        "colA*colB"], compareMainEffects, ciAdjust:
#                        'none'|'bonferroni'|'sidak' }
#     profilePlot: { horizontal: "WITHIN" | colId, lines: "WITHIN" | colId |
#                    null, errorBars: bool }
#     postHoc: the GLM Univariate postHoc object, for between factors
#
# Method — the one SPSS's GLM and car::Anova(idesign=) use. With Y the n x k
# level scores and X the between-subjects design (sum-to-zero contrasts,
# covariates additive, factors fully crossed):
#   * between-subjects effects: Type III ANOVA of the orthonormal average
#     Y 1/sqrt(k) on X;
#   * within-subjects effects: the orthonormal polynomial contrasts Z = Y C
#     (k - 1 columns) regressed on X. E is their error SSCP; the within main
#     effect is the intercept's hypothesis SSCP, an interaction W x T is term
#     T's (Type III, columns dropped). Sphericity-assumed SS = trace(H), its
#     error trace(E); Greenhouse-Geisser / Huynh-Feldt / lower-bound epsilons
#     and Mauchly's test come from E / df_error; multivariate tests from the
#     eigenvalues of E^-1 H (base R's stats:::Pillai/Wilks/HL/Roy).
#   * EM means: l' B m over the between design's balanced reference grid
#     (covariates at their mean), Var = (l' (X'X)^-1 l)(m' S m) with S the
#     residual covariance of Y — the multivariate linear model's own variance.

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
  vars  <- unlist(params$variables); var_names <- params$varNames
  wname <- if (is.null(params$factorName) || !nzchar(params$factorName)) "factor1" else params$factorName
  bfacs <- unlist(params$betweenFactors); bnames <- params$betweenNames
  covs  <- unlist(params$covariates);     cnames <- params$covariateNames
  opts  <- if (is.null(params$options)) list() else params$options
  k <- length(vars)
  if (k < 2) sai_error("Repeated measures needs at least two level variables")
  for (v in c(vars, bfacs, covs)) if (!v %in% names(df)) sai_error(paste("Column not found:", v))
  nm_of <- function(c, tbl) if (!is.null(tbl[[c]])) tbl[[c]] else c
  alpha <- suppressWarnings(as.numeric(opts$sigLevel))
  if (length(alpha) != 1 || is.na(alpha) || alpha <= 0 || alpha >= 1) alpha <- 0.05
  ci_pct <- as.character(round_half_up((1 - alpha) * 100, 4))
  want_mv    <- !isFALSE(opts$multivariate)
  want_ctr   <- !isFALSE(opts$withinContrasts)
  want_es    <- isTRUE(opts$effectSize)
  want_power <- isTRUE(opts$power)
  r3 <- function(x) round_half_up(x, 3)

  # ── Listwise case set ───────────────────────────────────────────────────────
  .gw <- get_weights(df, params); df <- .gw$df; w <- .gw$w
  dat <- data.frame(.row = seq_len(nrow(df)))
  for (i in seq_len(k)) dat[[paste0("y", i)]] <-
    suppressWarnings(as.numeric(apply_user_missing(df[[vars[i]]], vars[i], params)))
  for (i in seq_along(bfacs)) dat[[paste0("f", i)]] <-
    factor(as.character(apply_user_missing(df[[bfacs[i]]], bfacs[i], params)))
  for (i in seq_along(covs)) dat[[paste0("c", i)]] <-
    suppressWarnings(as.numeric(apply_user_missing(df[[covs[i]]], covs[i], params)))
  keep <- stats::complete.cases(dat)
  dat <- dat[keep, , drop = FALSE]; df <- df[keep, , drop = FALSE]
  if (!is.null(w)) w <- w[keep]
  n <- nrow(dat)
  Y <- as.matrix(dat[, paste0("y", seq_len(k)), drop = FALSE])
  wv <- if (is.null(w)) rep(1, n) else w

  # ── Between-subjects design ─────────────────────────────────────────────────
  rhs_parts <- c(if (length(covs)) paste0("c", seq_along(covs)),
                 if (length(bfacs)) paste(paste0("f", seq_along(bfacs)), collapse = " * "))
  rhs <- if (length(rhs_parts)) paste(rhs_parts, collapse = " + ") else "1"
  mf  <- model.frame(as.formula(paste("~", rhs)), data = dat)
  tt  <- attr(mf, "terms")
  X   <- model.matrix(tt, mf)
  asg <- attr(X, "assign"); tl <- attr(tt, "term.labels")
  rankX <- qr(X)$rank
  if (rankX < ncol(X)) sai_error("The between-subjects design has empty cells")
  dfe <- n - rankX
  p <- k - 1
  if (dfe < 1) sai_error("Not enough complete cases")

  label_term <- function(t) paste(vapply(strsplit(t, ":", fixed = TRUE)[[1]], function(tok) {
    idx <- as.integer(sub("^[fc]", "", tok))
    if (startsWith(tok, "f")) nm_of(bfacs[idx], bnames) else nm_of(covs[idx], cnames)
  }, character(1)), collapse = " * ")

  resid_sscp <- function(M, cols) {
    M <- as.matrix(M)
    if (sum(cols) == 0) return(crossprod(M * sqrt(wv)))
    R <- if (is.null(w)) lm.fit(X[, cols, drop = FALSE], M)$residuals
         else lm.wfit(X[, cols, drop = FALSE], M, w)$residuals
    crossprod(as.matrix(R) * sqrt(wv))
  }
  all_cols <- rep(TRUE, ncol(X))
  H_type3 <- function(M, E, j) resid_sscp(M, asg != j) - E

  partial_eta2 <- function(ss, sse) ss / (ss + sse)
  obs_power <- function(Fv, df1, df2) {
    crit <- qf(1 - alpha, df1, df2)
    pf(crit, df1, df2, ncp = Fv * df1, lower.tail = FALSE)
  }
  extra_cols <- c(if (want_es) "output.col.partialEtaSquared",
                  if (want_power) "output.col.observedPower")
  f_row <- function(ss, df1, sse, df2) {
    Fv <- (ss / df1) / (sse / df2)
    row <- list(r3(ss), r3(df1), r3(ss / df1), r3(Fv), round(pf(Fv, df1, df2, lower.tail = FALSE), 6))
    if (want_es) row <- c(row, list(r3(partial_eta2(ss, sse))))
    if (want_power) row <- c(row, list(r3(obs_power(Fv, df1, df2))))
    row
  }
  blank_extra <- function() as.list(rep(NA, length(extra_cols)))

  tables <- list(); plots <- list(); warns <- character(0); notes <- character(0)

  # ── Descriptive Statistics ──────────────────────────────────────────────────
  wmean <- function(x, ww) sum(x * ww) / sum(ww)
  wsd <- function(x, ww) {
    if (sum(ww) < 2) return(NA_real_)
    m <- wmean(x, ww); sqrt(sum(ww * (x - m)^2) / (sum(ww) - 1))
  }
  if (isTRUE(opts$descriptives)) {
    cell <- if (length(bfacs)) interaction(dat[, paste0("f", seq_along(bfacs)), drop = FALSE],
                                           drop = TRUE, sep = "\u001f") else NULL
    drows <- list()
    for (i in seq_len(k)) {
      first <- TRUE
      if (!is.null(cell)) {
        for (lv in levels(cell)) {
          idx <- which(cell == lv)
          parts <- strsplit(lv, "\u001f", fixed = TRUE)[[1]]
          drows[[length(drows) + 1L]] <- c(list(if (first) nm_of(vars[i], var_names) else ""),
            as.list(parts),
            list(r3(wmean(Y[idx, i], wv[idx])), r3(wsd(Y[idx, i], wv[idx])), r3(sum(wv[idx]))))
          first <- FALSE
        }
      }
      drows[[length(drows) + 1L]] <- c(list(if (first) nm_of(vars[i], var_names) else ""),
        as.list(rep("output.col.total", length(bfacs))),
        list(r3(wmean(Y[, i], wv)), r3(wsd(Y[, i], wv)), r3(sum(wv))))
    }
    tables[[length(tables) + 1L]] <- list(
      titleKey = "output.glmRep.descriptivesTitle",
      # unname(): vapply keeps bfacs' colIds as names, and one named element
      # turns the whole list into a JSON object ({"col_g":"group",...}) —
      # AnalysisResultSchema then rejected every mixed design with
      # descriptives on ("tables.0.columns: expected array", 2026-10-11).
      columns = c(list("output.col.variable"), as.list(unname(vapply(bfacs, nm_of, "", tbl = bnames))),
                  list("output.col.mean", "output.col.stdDeviation", "output.col.n")),
      rows = drows, footnoteKey = NULL)
  }

  # ── Box's M + Levene (Options ▸ Homogeneity tests) ──────────────────────────
  if (isTRUE(opts$homogeneity) && length(bfacs)) {
    cell <- interaction(dat[, paste0("f", seq_along(bfacs)), drop = FALSE], drop = TRUE)
    bx <- sai_box_m(Y, cell, w)
    if (is.null(bx$table)) warns <- c(warns, "output.glmMulti.boxNotComputed")
    else {
      tables[[length(tables) + 1L]] <- bx$table
      if (bx$skipped > 0) notes <- c(notes, paste0("output.glmMulti.boxSkippedNote:", bx$skipped))
    }
    # Levene's test based on the mean, per level variable: one-way ANOVA of the
    # absolute deviations from the cell means.
    lrows <- lapply(seq_len(k), function(i) {
      cm <- tapply(seq_len(n), cell, function(idx) wmean(Y[idx, i], wv[idx]))
      z  <- abs(Y[, i] - cm[as.character(cell)])
      fit <- if (is.null(w)) lm(z ~ cell) else lm(z ~ cell, weights = w)
      a <- anova(fit)
      list(nm_of(vars[i], var_names), r3(a[1, "F value"]), as.integer(a[1, "Df"]),
           as.integer(a[2, "Df"]), round(a[1, "Pr(>F)"], 6))
    })
    tables[[length(tables) + 1L]] <- list(
      titleKey = "output.glmRep.leveneTitle",
      columns = list("output.col.variable", "output.col.leveneStatistic", "output.col.df1",
                     "output.col.df2", "output.col.sig"),
      rows = lrows, footnoteKey = "output.glmRep.leveneFootnote")
  }

  # ── Within-subjects machinery ───────────────────────────────────────────────
  C  <- contr.poly(k)                     # k x (k-1), orthonormal columns
  Z  <- Y %*% C
  E  <- resid_sscp(Z, all_cols)
  within_effects <- c(list(list(label = wname, H = resid_sscp(Z, asg != 0) - E, q = 1)),
                      lapply(seq_along(tl), function(j) list(
                        label = paste(wname, "*", label_term(tl[j])),
                        H = H_type3(Z, E, j), q = sum(asg == j))))

  # Sphericity: S = E / dfe is the covariance of the orthonormal contrasts.
  S <- E / dfe
  eig <- pmax(eigen(S, symmetric = TRUE, only.values = TRUE)$values, 0)
  gg <- sum(eig)^2 / (p * sum(eig^2))
  # Huynh & Feldt (1976): N = all subjects, df_error = N - rank(X) (N - g
  # for g groups and no covariates).
  hf <- min(1, ((dfe + rankX) * p * gg - 2) / (p * (dfe - p * gg)))
  lb <- 1 / p
  if (p >= 2 && dfe >= p) {
    W   <- det(S) / (sum(diag(S)) / p)^p
    dfm <- p * (p + 1) / 2 - 1
    chi <- -(dfe - (2 * p^2 + p + 2) / (6 * p)) * log(W)
    p_m <- pchisq(chi, dfm, lower.tail = FALSE)
    m_row <- list(wname, r3(W), r3(chi), as.integer(dfm), round(p_m, 6), r3(gg), r3(hf), r3(lb))
  } else {
    # Two levels: sphericity holds trivially (one contrast), as SPSS prints it.
    m_row <- list(wname, 1, 0, 0L, NULL, 1, 1, 1)
  }
  mauchly <- list(
    titleKey = paste0("output.glmRep.mauchlyTitle:", wname),
    columns = list("output.col.withinEffect", "output.col.mauchlyW", "output.col.chiSquare",
                   "output.col.df", "output.col.sig", "output.col.greenhouse",
                   "output.col.huynh", "output.col.lowerBound"),
    rows = list(m_row), footnoteKey = "output.glmRep.mauchlyFootnote")

  # Multivariate tests.
  mv_tbl <- NULL
  if (want_mv) {
    stat_fns <- list(
      list(key = "output.col.pillai", fn = stats:::Pillai),
      list(key = "output.col.wilks", fn = stats:::Wilks),
      list(key = "output.col.hotelling", fn = stats:::HL),
      list(key = "output.col.roy", fn = stats:::Roy))
    pes_mv <- function(key, v, s) switch(key,
      "output.col.pillai" = v / s, "output.col.wilks" = 1 - v^(1 / s),
      "output.col.hotelling" = (v / s) / (v / s + 1), "output.col.roy" = v / (1 + v))
    Einv <- tryCatch(solve(E), error = function(e) NULL)
    if (is.null(Einv) || dfe < p) {
      warns <- c(warns, "output.glmRep.mvNotComputed")
    } else {
      mrows <- list()
      for (ef in within_effects) {
        ev <- pmax(Re(eigen(Einv %*% ef$H, only.values = TRUE)$values), 0)
        s <- min(p, ef$q); first <- TRUE
        for (sf in stat_fns) {
          rr <- sf$fn(ev, ef$q, dfe)
          row <- list(if (first) ef$label else "", sf$key, r3(rr[1]), r3(rr[2]), r3(rr[3]), r3(rr[4]),
                      round(pf(rr[2], rr[3], rr[4], lower.tail = FALSE), 6))
          if (want_es) row <- c(row, list(r3(pes_mv(sf$key, rr[1], s))))
          if (want_power) row <- c(row, list(r3(obs_power(rr[2], rr[3], rr[4]))))
          mrows[[length(mrows) + 1L]] <- row
          first <- FALSE
        }
      }
      mv_tbl <- list(
        titleKey = "output.glmRep.mvTitle",
        columns = c(list("output.col.effect", "output.col.statistic", "output.col.value",
                         "output.col.f", "output.col.hypDf", "output.col.errorDf", "output.col.sig"),
                    as.list(extra_cols)),
        rows = mrows, footnoteKey = NULL)
    }
  }

  # Tests of Within-Subjects Effects (univariate, with the epsilon corrections).
  sse_w <- sum(diag(E))
  corr_rows <- list(c("output.col.sphericityAssumed", 1), c("output.col.greenhouse", gg),
                    c("output.col.huynh", hf), c("output.col.lowerBound", lb))
  wrows <- list()
  for (ef in within_effects) {
    ss <- sum(diag(ef$H)); first <- TRUE
    for (cr in corr_rows) {
      eps <- as.numeric(cr[2])
      wrows[[length(wrows) + 1L]] <- c(list(if (first) ef$label else "", cr[1]),
                                       f_row(ss, ef$q * p * eps, sse_w, dfe * p * eps))
      first <- FALSE
    }
  }
  first <- TRUE
  for (cr in corr_rows) {
    eps <- as.numeric(cr[2]); dfr <- dfe * p * eps
    wrows[[length(wrows) + 1L]] <- c(list(if (first) paste0("output.glmRep.errorOf:", wname) else "",
                                          cr[1], r3(sse_w), r3(dfr), r3(sse_w / dfr), NULL, NULL),
                                     blank_extra())
    first <- FALSE
  }
  within_tbl <- list(
    titleKey = paste0("output.glmRep.withinTitle:", wname),
    columns = c(list("output.col.source", "output.col.correction", "output.col.typeIIISS",
                     "output.col.df", "output.col.meanSq", "output.col.f", "output.col.sig"),
                as.list(extra_cols)),
    rows = wrows, footnoteKey = NULL)

  # Tests of Within-Subjects Contrasts (polynomial).
  ctr_tbl <- NULL
  if (want_ctr) {
    poly_lbl <- function(i) switch(as.character(i), "1" = "output.glmRep.polyLinear",
      "2" = "output.glmRep.polyQuadratic", "3" = "output.glmRep.polyCubic",
      paste0("output.glmRep.polyOrder:", i))
    crows <- list()
    for (ef in within_effects) for (ci in seq_len(p)) {
      crows[[length(crows) + 1L]] <- c(list(if (ci == 1) ef$label else "", poly_lbl(ci)),
                                       f_row(ef$H[ci, ci], ef$q, E[ci, ci], dfe))
    }
    for (ci in seq_len(p)) {
      crows[[length(crows) + 1L]] <- c(list(if (ci == 1) paste0("output.glmRep.errorOf:", wname) else "",
                                            poly_lbl(ci), r3(E[ci, ci]), as.integer(dfe),
                                            r3(E[ci, ci] / dfe), NULL, NULL), blank_extra())
    }
    ctr_tbl <- list(
      titleKey = paste0("output.glmRep.contrastsTitle:", wname),
      columns = c(list("output.col.source", paste0("output.glmRep.contrastCol:", wname),
                       "output.col.typeIIISS", "output.col.df", "output.col.meanSq",
                       "output.col.f", "output.col.sig"), as.list(extra_cols)),
      rows = crows, footnoteKey = NULL)
  }

  # Tests of Between-Subjects Effects — the orthonormal average.
  yb <- Y %*% rep(1 / sqrt(k), k)
  Eb <- resid_sscp(yb, all_cols)[1, 1]
  brows <- list(c(list("output.col.intercept"), f_row((resid_sscp(yb, asg != 0) - Eb)[1, 1], 1, Eb, dfe)))
  for (j in seq_along(tl)) {
    brows[[length(brows) + 1L]] <- c(list(label_term(tl[j])),
                                     f_row(H_type3(yb, Eb, j)[1, 1], sum(asg == j), Eb, dfe))
  }
  brows[[length(brows) + 1L]] <- c(list("output.col.error", r3(Eb), as.integer(dfe), r3(Eb / dfe),
                                        NULL, NULL), blank_extra())
  between_tbl <- list(
    titleKey = "output.glmRep.betweenTitle",
    columns = c(list("output.col.source", "output.col.typeIIISS", "output.col.df",
                     "output.col.meanSq", "output.col.f", "output.col.sig"), as.list(extra_cols)),
    rows = brows, footnoteKey = "output.glmRep.betweenFootnote")

  tables <- c(tables, Filter(Negate(is.null), list(mv_tbl, mauchly, within_tbl, ctr_tbl, between_tbl)))

  # ── Estimated Marginal Means + profile plot ─────────────────────────────────
  sw <- sqrt(wv)
  B  <- qr.coef(qr(X * sw), Y * sw)                 # q x k
  XtXi <- chol2inv(qr.R(qr(X * sw)))
  Sy <- resid_sscp(Y, all_cols) / dfe               # k x k
  lvls <- lapply(seq_along(bfacs), function(i) levels(dat[[paste0("f", i)]]))
  grid <- if (length(bfacs)) expand.grid(setNames(lvls, paste0("f", seq_along(bfacs))),
                                         KEEP.OUT.ATTRS = FALSE, stringsAsFactors = TRUE)
          else data.frame(.one = 1)
  for (i in seq_along(covs)) grid[[paste0("c", i)]] <- wmean(dat[[paste0("c", i)]], wv)
  Lg <- model.matrix(delete.response(tt), model.frame(delete.response(tt), grid,
                                                      xlev = .getXlevels(tt, mf)))
  emm <- function(rows, m) {
    l <- colMeans(Lg[rows, , drop = FALSE])
    est <- drop(t(l) %*% B %*% m)
    se  <- sqrt(drop(t(l) %*% XtXi %*% l) * drop(t(m) %*% Sy %*% m))
    c(est = est, se = se)
  }
  emm_diff <- function(rows1, m1, rows2, m2) {
    l1 <- colMeans(Lg[rows1, , drop = FALSE]); l2 <- colMeans(Lg[rows2, , drop = FALSE])
    if (identical(rows1, rows2)) {
      l <- l1; m <- m1 - m2
      return(c(est = drop(t(l) %*% B %*% m), se = sqrt(drop(t(l) %*% XtXi %*% l) * drop(t(m) %*% Sy %*% m))))
    }
    l <- l1 - l2; m <- m1
    c(est = drop(t(l) %*% B %*% m), se = sqrt(drop(t(l) %*% XtXi %*% l) * drop(t(m) %*% Sy %*% m)))
  }
  tq <- qt(1 - alpha / 2, dfe)
  all_rows <- seq_len(nrow(Lg))
  mavg <- rep(1 / k, k)
  e_j <- function(j) { v <- numeric(k); v[j] <- 1; v }
  rows_for <- function(fi, lv) if (length(bfacs)) which(grid[[paste0("f", fi)]] == lv) else all_rows
  em <- if (is.null(opts$emMeans)) list() else opts$emMeans
  em_terms <- unlist(em$terms)
  emm_row <- function(lbls, r) c(lbls, list(r3(r[["est"]]), r3(r[["se"]]),
                                       r3(r[["est"]] - tq * r[["se"]]), r3(r[["est"]] + tq * r[["se"]])))
  emm_cols <- function(heads) c(heads, list("output.col.mean", "output.col.stdError",
    paste0("output.col.ciLowerPct:", ci_pct), paste0("output.col.ciUpperPct:", ci_pct)))
  fac_idx <- function(colId) match(colId, bfacs)
  for (term in em_terms) {
    if (identical(term, "OVERALL")) {
      tables[[length(tables) + 1L]] <- list(titleKey = "output.glmRep.emOverallTitle",
        columns = emm_cols(list()), rows = list(emm_row(list(), emm(all_rows, mavg))), footnoteKey = NULL)
    } else if (identical(term, "WITHIN")) {
      tables[[length(tables) + 1L]] <- list(titleKey = paste0("output.glmRep.emTitle:", wname),
        columns = emm_cols(list(wname)),
        rows = lapply(seq_len(k), function(j) emm_row(list(as.character(j)), emm(all_rows, e_j(j)))),
        footnoteKey = NULL)
    } else if (startsWith(term, "WITHIN*")) {
      fi <- fac_idx(sub("^WITHIN\\*", "", term)); if (is.na(fi)) next
      fname <- nm_of(bfacs[fi], bnames); rr <- list()
      for (lv in lvls[[fi]]) for (j in seq_len(k)) {
        rr[[length(rr) + 1L]] <- emm_row(list(if (j == 1) lv else "", as.character(j)), emm(rows_for(fi, lv), e_j(j)))
      }
      tables[[length(tables) + 1L]] <- list(titleKey = paste0("output.glmRep.emTitle:", fname, " * ", wname),
        columns = emm_cols(list(fname, wname)), rows = rr, footnoteKey = NULL)
    } else if (grepl("*", term, fixed = TRUE)) {
      parts <- strsplit(term, "*", fixed = TRUE)[[1]]; idx <- match(parts, bfacs)
      if (any(is.na(idx))) next
      combos <- unique(grid[, paste0("f", idx), drop = FALSE]); rr <- list()
      for (ri in seq_len(nrow(combos))) {
        sel <- Reduce(`&`, lapply(seq_along(idx), function(t) grid[[paste0("f", idx[t])]] == combos[ri, t]))
        rr[[length(rr) + 1L]] <- emm_row(lapply(seq_along(idx), function(t) as.character(combos[ri, t])),
                                         emm(which(sel), mavg))
      }
      fl <- vapply(idx, function(i) nm_of(bfacs[i], bnames), "")
      tables[[length(tables) + 1L]] <- list(titleKey = paste0("output.glmRep.emTitle:", paste(fl, collapse = " * ")),
        columns = emm_cols(as.list(fl)), rows = rr, footnoteKey = NULL)
    } else {
      fi <- fac_idx(term); if (is.na(fi)) next
      fname <- nm_of(bfacs[fi], bnames)
      tables[[length(tables) + 1L]] <- list(titleKey = paste0("output.glmRep.emTitle:", fname),
        columns = emm_cols(list(fname)),
        rows = lapply(lvls[[fi]], function(lv) emm_row(list(lv), emm(rows_for(fi, lv), mavg))),
        footnoteKey = NULL)
    }
  }

  # Pairwise comparisons of the main effects (EM Means ▸ Compare main effects).
  if (isTRUE(em$compareMainEffects)) {
    adj <- if (is.null(em$ciAdjust)) "none" else em$ciAdjust
    pair_table <- function(title, head, labels, diff_of) {
      m <- length(labels); ncmp <- m * (m - 1) / 2
      a_ci <- switch(adj, bonferroni = alpha / ncmp, sidak = 1 - (1 - alpha)^(1 / ncmp), alpha)
      tcrit <- qt(1 - a_ci / 2, dfe); rr <- list()
      for (i in seq_len(m)) { first <- TRUE; for (j in seq_len(m)) if (i != j) {
        d <- diff_of(i, j); pv <- 2 * pt(-abs(d[["est"]] / d[["se"]]), dfe)
        pv <- switch(adj, bonferroni = min(1, pv * ncmp), sidak = 1 - (1 - pv)^ncmp, pv)
        rr[[length(rr) + 1L]] <- list(if (first) labels[i] else "", labels[j], r3(d[["est"]]), r3(d[["se"]]),
                                      round(pv, 6), r3(d[["est"]] - tcrit * d[["se"]]), r3(d[["est"]] + tcrit * d[["se"]]))
        first <- FALSE
      } }
      list(titleKey = title,
           columns = list(paste0("output.col.levelI:", head), paste0("output.col.levelJ:", head),
                          "output.col.meanDiff", "output.col.stdError", "output.col.sig",
                          paste0("output.col.ciLowerPct:", ci_pct), paste0("output.col.ciUpperPct:", ci_pct)),
           rows = rr,
           footnoteKey = paste0("output.glmRep.pairwiseFootnote:",
                                switch(adj, bonferroni = "output.glmRep.adjBonferroni",
                                       sidak = "output.glmRep.adjSidak", "output.glmRep.adjLsd")))
    }
    if ("WITHIN" %in% em_terms) {
      tables[[length(tables) + 1L]] <- pair_table(paste0("output.glmRep.pairwiseTitle:", wname), wname,
        as.character(seq_len(k)), function(i, j) emm_diff(all_rows, e_j(i), all_rows, e_j(j)))
    }
    for (fi in seq_along(bfacs)) if (bfacs[fi] %in% em_terms) {
      fname <- nm_of(bfacs[fi], bnames); lv <- lvls[[fi]]
      tables[[length(tables) + 1L]] <- pair_table(paste0("output.glmRep.pairwiseTitle:", fname), fname, lv,
        function(i, j) emm_diff(rows_for(fi, lv[i]), mavg, rows_for(fi, lv[j]), mavg))
    }
  }

  pp <- opts$profilePlot
  if (!is.null(pp$horizontal) && nzchar(pp$horizontal)) {
    pal <- c("#3b6ea5", "#e07b39", "#3f9142", "#a3419b", "#c94040", "#3aa6a6")
    axis_of <- function(id) if (identical(id, "WITHIN")) list(name = wname, levels = as.character(seq_len(k)))
      else { fi <- fac_idx(id); if (is.na(fi)) NULL else list(name = nm_of(bfacs[fi], bnames), levels = lvls[[fi]], fi = fi) }
    hx <- axis_of(pp$horizontal)
    ln <- if (is.null(pp$lines) || !nzchar(pp$lines)) NULL else axis_of(pp$lines)
    point <- function(hlv, llv) {
      rows <- all_rows; m <- mavg
      for (ax in Filter(Negate(is.null), list(list(a = hx, v = hlv), if (!is.null(ln)) list(a = ln, v = llv)))) {
        if (is.null(ax$a$fi)) m <- e_j(as.integer(ax$v))
        else rows <- intersect(rows, rows_for(ax$a$fi, ax$v))
      }
      emm(rows, m)
    }
    if (!is.null(hx)) {
      line_lvls <- if (is.null(ln)) list(NULL) else as.list(ln$levels)
      traces <- lapply(seq_along(line_lvls), function(t) {
        pts <- lapply(hx$levels, function(h) point(h, line_lvls[[t]]))
        est <- vapply(pts, function(r) r[["est"]], 0); se <- vapply(pts, function(r) r[["se"]], 0)
        tr <- list(type = "scatter", mode = "lines+markers",
                   name = if (is.null(line_lvls[[t]])) wname else line_lvls[[t]],
                   x = as.list(hx$levels), y = as.list(round(est, 4)),
                   line = list(color = pal[((t - 1) %% length(pal)) + 1]))
        if (isTRUE(pp$errorBars)) tr$error_y <- list(type = "data", array = as.list(round(tq * se, 4)), visible = TRUE)
        tr
      })
      plots[[length(plots) + 1L]] <- list(
        titleKey = "output.glmRep.profileTitle", type = "plotly",
        data = list(data = traces, layout = list(
          xaxis = list(title = list(text = hx$name), type = "category"),
          yaxis = list(title = list(text = "Estimated Marginal Means")),
          showlegend = !is.null(ln),
          margin = list(t = 40, r = 20, b = 50, l = 60))))
      if (isTRUE(pp$errorBars)) notes <- c(notes, paste0("output.glmRep.errorBarsNote:", ci_pct))
    }
  }

  # ── Post Hoc for between factors — the Univariate engine on the average ─────
  # SPSS bases RM post hoc tests on the observed means of the between-subjects
  # analysis; running the GLM engine on each subject's mean over the levels
  # gives the same comparisons (differences and t statistics are invariant to
  # the 1/k vs 1/sqrt(k) scaling of the average).
  ph <- opts$postHoc
  if (!is.null(ph) && length(unlist(ph$factors)) && length(bfacs)) {
    df2 <- df; df2[["__rm_avg"]] <- rowMeans(Y)
    sub <- params
    sub$dependent <- "__rm_avg"
    sub$dependentName <- paste0("output.glmRep.averageOf:", wname)
    sub$factors <- as.list(bfacs); sub$factorNames <- bnames
    sub$covariates <- as.list(covs); sub$covariateNames <- cnames
    sub$options <- list(postHoc = ph, sigLevel = opts$sigLevel)
    sub$createVars <- NULL
    res <- glm_univariate_core(df2, sub)
    keep_t <- vapply(res$tables, function(t) grepl("^output\\.glmUni\\.(postHoc|homogSubsets|dunnett)Title", t$titleKey), logical(1))
    tables <- c(tables, res$tables[keep_t])
    warns <- c(warns, res$warnings)
  }

  progress(100L, "progress.done")
  sai_output(tables = tables, plots = plots, warnings = unique(warns), notes = unique(notes))
}, error = function(e) sai_error(conditionMessage(e)))
