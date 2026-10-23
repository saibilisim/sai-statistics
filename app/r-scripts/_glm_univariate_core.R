# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# _glm_univariate_core.R — the GLM Univariate engine, as a function.
#
# Extracted from glm-univariate.R (2026-10) so GLM Multivariate can run the
# exact same per-dependent analysis — Tests of Between-Subjects Effects,
# Descriptives, Levene, Parameter Estimates, Post Hoc, EM Means — instead of a
# second, thinner implementation that would drift from the one validated
# against SPSS. glm-univariate.R calls it once; glm-multivariate.R once per
# dependent. The params contract is glm-univariate.R's (see its header).
#
# Sourced after _bootstrap.R; returns list(tables, warnings, notes, caseVars).

glm_univariate_core <- function(df, params) {
  progress(10L, "progress.loading")
  options(contrasts = c("contr.sum", "contr.poly"))

  dep   <- params$dependent
  dname <- if (is.null(params$dependentName)) dep else params$dependentName
  facs  <- unlist(params$factors); fac_names <- params$factorNames
  covs  <- unlist(params$covariates); cov_names <- params$covariateNames
  wls_col  <- params$wlsWeight
  wls_name <- if (is.null(params$wlsWeightName)) wls_col else params$wlsWeightName
  opts <- if (is.null(params$options)) list() else params$options

  if (is.null(dep) || !dep %in% names(df)) sai_error("Dependent variable not found")
  if (length(facs) == 0 && length(covs) == 0) {
    sai_error("No fixed factors or covariates specified")
  }

  ss_type <- if (!is.null(opts$ssType) && opts$ssType %in% c("I", "II", "III", "IV")) {
    opts$ssType
  } else "III"
  include_intercept <- if (!is.null(opts$includeIntercept)) isTRUE(opts$includeIntercept) else TRUE
  alpha <- suppressWarnings(as.numeric(opts$sigLevel))
  if (is.null(alpha) || length(alpha) == 0 || is.na(alpha) || alpha <= 0 || alpha >= 1) alpha <- 0.05
  ci_pct <- as.character(round((1 - alpha) * 100, 4))

  # ── Weight Cases (W1) + WLS Weight ──────────────────────────────────────────
  # SPSS's GLM has its own "WLS Weight" field — a regression weight passed
  # straight to the fit (lm(weights=)) — independent of the global Weight Cases
  # frequency weight (Data > Weight Cases). Both can theoretically be active at
  # once; there's no documented SPSS convention for combining them, so this
  # script's policy (documented, not silent): the WLS Weight field wins when
  # present, falling back to the global frequency weight otherwise. Either way
  # rows with NA/zero/negative weight are excluded, same as get_weights().
  .gw <- get_weights(df, params); df <- .gw$df; freq_w <- .gw$w
  wls_w <- NULL
  if (!is.null(wls_col) && nzchar(wls_col)) {
    if (!wls_col %in% names(df)) sai_error("WLS Weight column not found")
    wv <- suppressWarnings(as.numeric(apply_user_missing(df[[wls_col]], wls_col, params)))
    keep_w <- !is.na(wv) & wv > 0
    if (!any(keep_w)) sai_error("No cases remain after applying the WLS weight")
    df <- df[keep_w, , drop = FALSE]
    if (!is.null(freq_w)) freq_w <- freq_w[keep_w]
    wls_w <- wv[keep_w]
  }
  w <- if (!is.null(wls_w)) wls_w else freq_w

  # ── Assemble the model frame ─────────────────────────────────────────────────
  dat <- data.frame(.y = suppressWarnings(as.numeric(apply_user_missing(df[[dep]], dep, params))))
  dat[["__row_idx"]] <- row_index_of(df)
  for (i in seq_along(facs)) {
    dat[[paste0("f", i)]] <- factor(as.character(apply_user_missing(df[[facs[i]]], facs[i], params)))
  }
  for (i in seq_along(covs)) {
    dat[[paste0("c", i)]] <- suppressWarnings(as.numeric(apply_user_missing(df[[covs[i]]], covs[i], params)))
  }
  keep2 <- stats::complete.cases(dat)
  dat <- dat[keep2, , drop = FALSE]
  if (!is.null(w)) w <- w[keep2]
  n <- nrow(dat)
  if (n <= length(facs) + length(covs) + 1) sai_error("Not enough complete cases")

  y <- dat$.y

  # ── Model formula ────────────────────────────────────────────────────────────
  # Full factorial among factors; covariates enter as additive main-effect terms
  # only (SPSS's default Full Factorial model never crosses a covariate with a
  # factor). Term order follows entry order (covariates, then factor main
  # effects, then interactions in increasing degree) — a defensible default in
  # the absence of "Build custom terms" (not implemented yet), and what Type I's
  # sequential SS below is computed against.
  cov_terms <- if (length(covs) > 0) paste0("c", seq_along(covs)) else character(0)
  fac_terms <- if (length(facs) > 0) paste(paste0("f", seq_along(facs)), collapse = " * ") else character(0)
  rhs_parts <- c(cov_terms, fac_terms)

  build_formula <- function(terms_vec) {
    if (length(terms_vec) == 0) {
      rhs <- if (include_intercept) "1" else "0"
    } else {
      rhs <- paste(terms_vec, collapse = " + ")
      if (!include_intercept) rhs <- paste0("0 + ", rhs)
    }
    paste(".y ~", rhs)
  }
  formula_str <- build_formula(rhs_parts)
  fit_lm <- function(f) {
    if (is.null(w)) lm(as.formula(f), data = dat) else lm(as.formula(f), data = dat, weights = w)
  }
  full <- fit_lm(formula_str)

  SSE    <- deviance(full)
  dfres  <- df.residual(full)
  MSE    <- SSE / dfres
  wsum   <- function(v) sum((if (is.null(w)) rep(1, length(v)) else w) * v)
  ybar   <- wtd_mean(y, w)
  SSTc   <- wsum((y - ybar)^2)          # corrected total
  SST    <- wsum(y^2)                  # uncorrected total
  n_disp <- if (is.null(w)) n else sum(w)
  dfnum  <- function(x) if (is.null(w)) as.integer(x) else round(x, 3)

  tl <- attr(terms(full), "term.labels")
  if (length(tl) == 0) sai_error("Model has no effects to test")

  label_term <- function(t) {
    toks <- strsplit(t, ":", fixed = TRUE)[[1]]
    paste(vapply(toks, function(tok) {
      if (startsWith(tok, "f")) {
        idx <- as.integer(sub("^f", "", tok))
        nm  <- fac_names[[facs[idx]]]
        if (is.null(nm)) facs[idx] else nm
      } else {
        idx <- as.integer(sub("^c", "", tok))
        nm  <- cov_names[[covs[idx]]]
        if (is.null(nm)) covs[idx] else nm
      }
    }, character(1)), collapse = " * ")
  }

  # ── Sum-of-squares type ──────────────────────────────────────────────────────
  X_full <- model.matrix(full)
  asg    <- attr(X_full, "assign")

  # Type III (also used for Type IV — see below, and always used for the
  # Intercept row regardless of ssType, matching SPSS/car convention where
  # Intercept has no sequential ambiguity to speak of): SS(term) = SSE(model
  # with just that term's model-matrix columns dropped) − SSE(full). Correct
  # under contr.sum even in the presence of an interaction (single-column
  # deletion, not formula deletion).
  wsse <- function(Xmat) {
    if (ncol(Xmat) == 0) return(wsum(y^2))
    if (is.null(w)) sum(lm.fit(Xmat, y)$residuals^2)
    else sum(w * lm.wfit(Xmat, y, w)$residuals^2)
  }
  ss_drop_col <- function(mask) wsse(X_full[, !mask, drop = FALSE]) - SSE

  ss_type3_vals <- vapply(seq_along(tl), function(j) ss_drop_col(asg == j), numeric(1))
  df_vals       <- vapply(seq_along(tl), function(j) sum(asg == j), integer(1))

  # Type I (sequential): base R's own anova.lm() already computes this in
  # formula-entry order — same order as `tl` — and honors the model's weights.
  ss_type1_vals <- if (ss_type == "I") {
    at <- anova(full)
    unname(vapply(tl, function(t) at[t, "Sum Sq"], numeric(1)))
  } else NULL

  # Type II: SS(term) adjusted for every OTHER term not containing it (i.e. its
  # "marginal" terms) — reduced model = all terms except `term` and except any
  # term that has `term`'s variables as a strict subset of its own (`term`'s
  # higher-order relatives). Generic over factor interactions AND covariates:
  # a covariate is never a subset of a factor interaction (or vice versa) under
  # the default model, so a covariate's Type II SS coincides with its Type III
  # SS — as it should (nothing is "marginal" to a plain additive covariate).
  ss_type2_vals <- if (ss_type == "II") {
    term_vars <- lapply(tl, function(t) strsplit(t, ":", fixed = TRUE)[[1]])
    names(term_vars) <- tl
    vapply(tl, function(term) {
      tv <- term_vars[[term]]
      supersets <- tl[vapply(tl, function(t2) {
        t2v <- term_vars[[t2]]
        length(tv) < length(t2v) && all(tv %in% t2v)
      }, logical(1))]
      reduced <- setdiff(tl, c(term, supersets))
      m0 <- fit_lm(build_formula(reduced))
      m1 <- fit_lm(build_formula(c(reduced, term)))
      deviance(m0) - deviance(m1)
    }, numeric(1))
  } else NULL

  term_ss <- switch(ss_type,
    "I"  = ss_type1_vals,
    "II" = ss_type2_vals,
    ss_type3_vals  # III and IV
  )
  term_df <- df_vals
  ss_col_key <- switch(ss_type,
    "I" = "output.col.typeISS", "II" = "output.col.typeIISS",
    "IV" = "output.col.typeIVSS", "output.col.typeIIISS")

  intercept_ss <- if (include_intercept) ss_drop_col(asg == 0) else NA_real_
  intercept_df <- if (include_intercept) sum(asg == 0) else NA_integer_
  if (include_intercept && ss_type == "I") {
    # Type I's Intercept row is the reduction from the empty model to the
    # intercept-only model — the classic n·ȳ² identity (weighted analog),
    # since Intercept truly is "first in sequence" under Type I.
    intercept_ss <- wsum(y)^2 / wsum(rep(1, n))
  }

  model_rank <- qr(X_full)$rank
  model_df   <- model_rank - as.integer(include_intercept)
  total_ss_ref <- if (include_intercept) SSTc else SST
  model_ss   <- total_ss_ref - SSE

  # ── Effect size (partial η²) and observed power ─────────────────────────────
  # Noncentrality λ = SS_effect / MSE (SPSS's own documented formula); observed
  # power = P(F > F_crit(α, df1, dfres) | noncentral F(df1, dfres, λ)).
  partial_eta2 <- function(ss) ss / (ss + SSE)
  obs_power <- function(ss, df1) {
    lambda <- ss / MSE
    crit   <- qf(1 - alpha, df1, dfres)
    stats::pf(crit, df1, dfres, ncp = lambda, lower.tail = FALSE)
  }
  want_es    <- isTRUE(opts$effectSize)
  want_power <- isTRUE(opts$power)

  # ── Assemble "Tests of Between-Subjects Effects" ────────────────────────────
  extra_cols <- character(0)
  if (want_es) extra_cols <- c(extra_cols, "output.col.partialEtaSquared")
  if (want_power) extra_cols <- c(extra_cols, "output.col.observedPower")

  row_of <- function(labelKey, ss, dft, es_df1 = dft) {
    Fv <- (ss / dft) / MSE
    base <- list(labelKey, round(ss, 3), dfnum(dft), round(ss / dft, 3),
                 round(Fv, 3), round(pf(Fv, dft, dfres, lower.tail = FALSE), 6))
    extra <- list()
    if (want_es) extra <- c(extra, list(round(partial_eta2(ss), 6)))
    if (want_power) extra <- c(extra, list(round(obs_power(ss, es_df1), 6)))
    c(base, extra)
  }
  blank_row <- function(labelKey, ss, dft, ms = NULL) {
    c(list(labelKey, round(ss, 3), dfnum(dft), if (is.null(ms)) NULL else round(ms, 3), NULL, NULL),
      as.list(rep(NA, length(extra_cols))))
  }

  rows <- list()
  rows <- c(rows, list(row_of(if (include_intercept) "output.col.correctedModel" else "output.col.model",
                               model_ss, model_df)))
  if (include_intercept) {
    rows <- c(rows, list(row_of("output.col.intercept", intercept_ss, intercept_df)))
  }
  for (j in seq_along(tl)) {
    rows <- c(rows, list(row_of(label_term(tl[j]), term_ss[j], term_df[j])))
  }
  rows <- c(rows, list(blank_row("output.col.error", SSE, dfres, MSE)))
  rows <- c(rows, list(blank_row("output.col.totalUncorrected", SST, dfnum(n_disp))))
  if (include_intercept) {
    rows <- c(rows, list(blank_row("output.col.correctedTotal", SSTc, dfnum(n_disp - 1))))
  }

  rsq     <- 1 - SSE / total_ss_ref
  total_df_for_adj <- if (include_intercept) n_disp - 1 else n_disp
  adj_rsq <- 1 - (SSE / dfres) / (total_ss_ref / total_df_for_adj)

  ss_type_note <- if (ss_type == "IV") {
    "output.glmUni.type4Note"
  } else NULL

  tables <- list(list(
    titleKey    = paste0("output.glmUni.title:", dname),
    columns     = c(list("output.col.source", ss_col_key, "output.col.df",
                          "output.col.meanSq", "output.col.f", "output.col.sig"),
                     as.list(extra_cols)),
    rows        = rows,
    footnoteKey = paste0("output.glmUni.rsqFootnote:", round(rsq, 3), "|", round(adj_rsq, 3))
  ))
  warns <- character(0)
  notes <- character(0)
  if (!is.null(ss_type_note)) warns <- c(warns, ss_type_note)

  # ── Descriptive Statistics (per cell, cross of all factors) ─────────────────
  # SPSS nests per-single-factor subtotal rows too; this shows the full-cell
  # breakdown + a grand total, a documented simplification for this round.
  if (isTRUE(opts$descriptives) && length(facs) > 0) {
    fcols <- paste0("f", seq_along(facs))
    cellf <- interaction(dat[fcols], drop = TRUE, sep = ", ")
    desc_rows <- list()
    for (lvl in levels(cellf)) {
      idx <- cellf == lvl
      xs <- y[idx]; ws <- if (is.null(w)) NULL else w[idx]
      desc_rows <- c(desc_rows, list(list(
        lvl, round(wtd_mean(xs, ws), 6), round(wtd_sd(xs, ws), 6), format_wtd_count(sum(idx * (if (is.null(w)) 1 else w)), ws))))
    }
    desc_rows <- c(desc_rows, list(list(
      "output.col.total", round(wtd_mean(y, w), 6), round(wtd_sd(y, w), 6), format_wtd_count(n_disp, w))))
    fac_disp_names <- vapply(seq_along(facs), function(i) {
      nm <- fac_names[[facs[i]]]; if (is.null(nm)) facs[i] else nm
    }, character(1))
    tables <- c(tables, list(list(
      titleKey = paste0("output.glmUni.descriptivesTitle:", dname),
      columns  = c(list(paste(fac_disp_names, collapse = " * ")), list("output.col.mean", "output.col.stdDeviation", "output.col.n")),
      rows     = desc_rows, footnoteKey = NULL)))
  }

  # ── Homogeneity of Variance (Levene, 3 variants — same set anova-oneway.R
  # uses, see that script's comment for why "median with adjusted df" is
  # omitted) — grouped by the full cross of factors (SPSS's own grouping). ────
  if (isTRUE(opts$homogeneity) && length(facs) > 0) {
    fcols <- paste0("f", seq_along(facs))
    g <- interaction(dat[fcols], drop = TRUE, sep = ", ")
    k <- nlevels(g)
    if (k >= 2 && n > k) {
      idx_by_g <- split(seq_along(y), g)
      levene_variant <- function(center_fn, wtd_center_fn) {
        if (is.null(w)) {
          z  <- abs(y - ave(y, g, FUN = center_fn))
          zb <- mean(z)
          lssb <- sum(tapply(z, g, function(v) length(v) * (mean(v) - zb)^2))
          lssw <- sum(tapply(z, g, function(v) sum((v - mean(v))^2)))
        } else {
          grp_centers <- vapply(idx_by_g, function(idx) wtd_center_fn(y[idx], w[idx]), numeric(1))
          z  <- abs(y - grp_centers[as.character(g)])
          zb <- wtd_mean(z, w)
          lssb <- sum(vapply(idx_by_g, function(idx) sum(w[idx]) * (wtd_mean(z[idx], w[idx]) - zb)^2, numeric(1)))
          lssw <- sum(vapply(idx_by_g, function(idx) sum(w[idx] * (z[idx] - wtd_mean(z[idx], w[idx]))^2), numeric(1)))
        }
        dfb_l <- k - 1; dfw_l <- n - k
        Lf <- (lssb / dfb_l) / (lssw / dfw_l)
        list(stat = Lf, df1 = dfb_l, df2 = dfw_l, sig = pf(Lf, dfb_l, dfw_l, lower.tail = FALSE))
      }
      lev_mean <- levene_variant(mean, wtd_mean)
      lev_med  <- levene_variant(median, wtd_median)
      lev_trim <- levene_variant(trimmed_mean_5, function(v, wt) trimmed_mean_5(v))
      tables <- c(tables, list(list(
        titleKey = paste0("output.glmUni.homogTitle:", dname),
        columns  = list("output.col.method", "output.col.leveneStatistic",
                        "output.col.df1", "output.col.df2", "output.col.sig"),
        rows     = list(
          list("output.anova.leveneBasedOnMean",    round(lev_mean$stat, 3), dfnum(lev_mean$df1), dfnum(lev_mean$df2), round(lev_mean$sig, 6)),
          list("output.anova.leveneBasedOnMedian",  round(lev_med$stat, 3),  dfnum(lev_med$df1),  dfnum(lev_med$df2),  round(lev_med$sig, 6)),
          list("output.anova.leveneBasedOnTrimmed", round(lev_trim$stat, 3), dfnum(lev_trim$df1), dfnum(lev_trim$df2), round(lev_trim$sig, 6))
        ), footnoteKey = NULL)))
    }
  }

  # ── Parameter Estimates ──────────────────────────────────────────────────────
  # Refit with a per-factor contrast coding purely for this table — distinct
  # from the contr.sum coding the SS computation above needs for correctness.
  # Default (no Contrasts choice made) is contr.SAS (last level = reference),
  # SPSS's own documented convention ("the last category is redundant").
  #
  # A factor's chosen contrast maps to a base-R equivalent, empirically
  # verified against known per-level means before shipping (a mislabeled
  # contrast is as wrong as a mislabeled p-value):
  #   None       -> contr.SAS            (last level redundant, as before)
  #   Simple     -> contr.treatment (reference=first) or contr.SAS-equivalent
  #                 via releveling (reference=last)
  #   Deviation  -> contr.sum (reference=last, R's own default) or the same
  #                 with the factor releveled so the FIRST level becomes the
  #                 omitted/implied one (reference=first)
  #   Helmert    -> contr.helmert on the REVERSED level order — R's own
  #                 contr.helmert compares each level to the mean of the
  #                 PRECEDING levels (SPSS calls that "Difference"); SPSS's
  #                 own "Helmert" compares to the mean of SUBSEQUENT levels,
  #                 the mirror image, which reversing the level order before
  #                 applying contr.helmert produces
  #   Difference -> contr.helmert as-is (see above — this is what it computes)
  #   Repeated   -> MASS::contr.sdif — verified to equal the raw adjacent-level
  #                 mean differences (level2-level1, level3-level2, …) exactly
  #   Polynomial -> contr.poly (orthogonal linear/quadratic/… trend contrasts)
  if (isTRUE(opts$paramEstimates)) {
    contrast_opts <- if (is.null(opts$contrasts)) list() else opts$contrasts
    dat_param <- dat
    fac_contrasts <- list()
    contrast_used <- character(0)
    for (i in seq_along(facs)) {
      fcol <- paste0("f", i)
      spec  <- contrast_opts[[facs[i]]]
      ctype <- if (!is.null(spec$type) && nzchar(spec$type)) spec$type else "none"
      cref  <- if (!is.null(spec$reference)) spec$reference else "last"
      lvls_orig <- levels(dat[[fcol]])
      built <- switch(ctype,
        "deviation" = {
          if (identical(cref, "first") && length(lvls_orig) > 1) {
            dat_param[[fcol]] <- factor(as.character(dat[[fcol]]), levels = c(lvls_orig[-1], lvls_orig[1]))
          }
          list(fun = "contr.sum", showRef = TRUE)
        },
        "simple" = {
          if (identical(cref, "last") && length(lvls_orig) > 1) {
            k_ <- length(lvls_orig)
            dat_param[[fcol]] <- factor(as.character(dat[[fcol]]), levels = c(lvls_orig[k_], lvls_orig[-k_]))
          }
          list(fun = "contr.treatment", showRef = TRUE)
        },
        "helmert" = {
          dat_param[[fcol]] <- factor(as.character(dat[[fcol]]), levels = rev(lvls_orig))
          list(fun = "contr.helmert", showRef = FALSE)
        },
        "difference" = list(fun = "contr.helmert", showRef = FALSE),
        "repeated"   = list(fun = MASS::contr.sdif, showRef = FALSE),
        "polynomial" = list(fun = "contr.poly", showRef = FALSE),
        list(fun = "contr.SAS", showRef = FALSE)  # "none" (default)
      )
      fac_contrasts[[fcol]] <- built$fun
      if (!identical(ctype, "none")) {
        nm <- fac_names[[facs[i]]]; if (is.null(nm)) nm <- facs[i]
        # output.cox.contrast.* already names every one of these coding types
        # generically (Cox Regression's own Categorical Covariates panel offers
        # the identical SPSS contrast set) — reused rather than duplicated.
        note <- if (isTRUE(built$showRef)) {
          paste0("output.cox.contrastNote:", nm, "|output.cox.contrast.", ctype,
                 "|output.glmUni.contrastRef.", cref)
        } else {
          paste0("output.glmUni.contrastNote2:", nm, "|output.cox.contrast.", ctype)
        }
        contrast_used <- c(contrast_used, note)
      }
    }
    full_param <- if (length(facs) > 0) {
      if (is.null(w)) lm(as.formula(formula_str), data = dat_param, contrasts = fac_contrasts)
      else lm(as.formula(formula_str), data = dat_param, weights = w, contrasts = fac_contrasts)
    } else full
    if (length(contrast_used) > 0) notes <- c(notes, contrast_used)
    sm  <- summary(full_param)$coefficients
    cfi <- suppressWarnings(confint(full_param, level = 1 - alpha))
    cn  <- rownames(sm)
    param_label <- function(coef_name) {
      if (coef_name == "(Intercept)") return("output.col.intercept")
      # e.g. "f1a1" -> factor 1, level "a1"; "c1" -> covariate 1 (numeric term, no level suffix)
      for (i in seq_along(facs)) {
        pfx <- paste0("f", i)
        if (startsWith(coef_name, pfx) && nchar(coef_name) > nchar(pfx)) {
          lvl <- substring(coef_name, nchar(pfx) + 1)
          nm <- fac_names[[facs[i]]]; if (is.null(nm)) nm <- facs[i]
          return(paste0(nm, " = ", lvl))
        }
      }
      for (i in seq_along(covs)) {
        if (coef_name == paste0("c", i)) {
          nm <- cov_names[[covs[i]]]; return(if (is.null(nm)) covs[i] else nm)
        }
      }
      coef_name
    }
    param_rows <- lapply(seq_along(cn), function(i) {
      tval <- sm[i, "t value"]
      row <- list(param_label(cn[i]), round(sm[i, "Estimate"], 6), round(sm[i, "Std. Error"], 6),
                  round(tval, 3), round(sm[i, "Pr(>|t|)"], 6),
                  round(cfi[i, 1], 6), round(cfi[i, 2], 6))
      if (want_es) row <- c(row, list(round(tval^2 / (tval^2 + dfres), 6)))
      if (want_power) row <- c(row, list(round(obs_power(tval^2 * MSE, 1), 6)))
      row
    })
    param_cols <- c(list("output.col.source", "output.col.b", "output.col.stdError",
                          "output.col.t", "output.col.sig",
                          paste0("output.col.ciLowerPct:", ci_pct), paste0("output.col.ciUpperPct:", ci_pct)),
                     as.list(extra_cols))
    # The generic "redundant last category" caveat only holds when every
    # factor actually used that default (contr.SAS) coding — once any factor
    # has a custom Contrasts choice, the per-factor notes above already say
    # precisely what was used, and the blanket caveat would be misleading for
    # e.g. a factor coded Helmert (nothing "redundant" about it).
    param_footnote <- if (length(facs) > 0 && length(contrast_used) == 0) "output.glmUni.paramFootnote" else NULL
    tables <- c(tables, list(list(
      titleKey = paste0("output.glmUni.paramTitle:", dname),
      columns  = param_cols, rows = param_rows,
      footnoteKey = param_footnote)))
  }

  # ── Post Hoc (per selected factor; observed marginal means, pooled MSE/dfres
  # from the FULL model as the error term — SPSS's own documented behavior).
  # Same 8 pairwise tests anova-oneway.R implements (see that script for the
  # derivation of each formula), PLUS (below) the Homogeneous Subsets tests
  # (S-N-K/Duncan/R-E-G-W-Q/Waller-Duncan, agricolae-backed, same pattern
  # anova-oneway.R uses) and Dunnett (vs. control, emmeans-backed). Hochberg
  # GT2/Gabriel remain deferred — no maintained R package implements either. ──
  ph_factors <- unlist(opts$postHoc$factors)
  if (length(ph_factors) > 0) {
    for (fi in seq_along(facs)) {
      if (!(facs[fi] %in% ph_factors)) next
      fcol <- paste0("f", fi); g <- dat[[fcol]]; lvls <- levels(g)
      k <- nlevels(g)
      if (k < 2) next
      fac_disp <- fac_names[[facs[fi]]]; if (is.null(fac_disp)) fac_disp <- facs[fi]
      idx_by_g <- split(seq_along(y), g)
      ni  <- vapply(idx_by_g, function(idx) if (is.null(w)) length(idx) else sum(w[idx]), numeric(1))
      mns <- vapply(idx_by_g, function(idx) wtd_mean(y[idx], if (is.null(w)) NULL else w[idx]), numeric(1))
      vi  <- vapply(idx_by_g, function(idx) wtd_var(y[idx], if (is.null(w)) NULL else w[idx]), numeric(1))
      ncmp <- choose(k, 2)
      ph_rows <- list()
      dfw_full <- dfres; msw_full <- MSE

      add_eq <- function(method_key, stat_fn) {
        first <- TRUE
        for (i in seq_len(k)) for (j in seq_len(k)) if (i != j) {
          diff <- mns[i] - mns[j]; se <- sqrt(msw_full * (1 / ni[i] + 1 / ni[j]))
          r <- stat_fn(diff, se)
          ph_rows[[length(ph_rows) + 1L]] <<- list(
            if (first) method_key else "", lvls[i], lvls[j], round(diff, 4),
            round(se, 4), round(r$sig, 6), round(r$lo, 4), round(r$hi, 4))
          first <- FALSE
        }
      }
      add_uneq <- function(method_key, stat_fn) {
        first <- TRUE
        for (i in seq_len(k)) for (j in seq_len(k)) if (i != j) {
          diff <- mns[i] - mns[j]
          wi_ <- vi[i] / ni[i]; wj_ <- vi[j] / ni[j]; se <- sqrt(wi_ + wj_)
          dfij <- se^4 / (wi_^2 / (ni[i] - 1) + wj_^2 / (ni[j] - 1))
          if (ni[i] < 2 || ni[j] < 2 || !is.finite(se) || se <= 0 || !is.finite(dfij)) next
          r <- stat_fn(diff, se, dfij)
          ph_rows[[length(ph_rows) + 1L]] <<- list(
            if (first) method_key else "", lvls[i], lvls[j], round(diff, 4),
            round(se, 4), round(r$sig, 6), round(r$lo, 4), round(r$hi, 4))
          first <- FALSE
        }
      }

      po <- opts$postHoc
      if (isTRUE(po$lsd)) add_eq("output.col.lsd", function(diff, se) {
        crit <- qt(1 - alpha / 2, dfw_full)
        list(sig = 2 * pt(-abs(diff / se), dfw_full), lo = diff - crit * se, hi = diff + crit * se)
      })
      if (isTRUE(po$bonferroni)) add_eq("output.col.bonferroni", function(diff, se) {
        praw <- 2 * pt(-abs(diff / se), dfw_full); crit <- qt(1 - alpha / (2 * ncmp), dfw_full)
        list(sig = min(1, praw * ncmp), lo = diff - crit * se, hi = diff + crit * se)
      })
      if (isTRUE(po$sidak)) add_eq("output.col.sidak", function(diff, se) {
        alpha_per <- 1 - (1 - alpha)^(1 / ncmp); crit <- qt(1 - alpha_per / 2, dfw_full)
        praw <- 2 * pt(-abs(diff / se), dfw_full)
        list(sig = min(1, 1 - (1 - praw)^ncmp), lo = diff - crit * se, hi = diff + crit * se)
      })
      if (isTRUE(po$scheffe)) add_eq("output.col.scheffe", function(diff, se) {
        n_terms_for_scheffe <- k - 1
        critF <- qf(1 - alpha, n_terms_for_scheffe, dfw_full); crit <- sqrt(n_terms_for_scheffe * critF)
        F0 <- (diff / se)^2 / n_terms_for_scheffe
        list(sig = pf(F0, n_terms_for_scheffe, dfw_full, lower.tail = FALSE), lo = diff - crit * se, hi = diff + crit * se)
      })
      if (isTRUE(po$tukey)) add_eq("output.col.tukeyHSD", function(diff, se) {
        q <- abs(diff) / se * sqrt(2); crit <- qtukey(1 - alpha, k, dfw_full)
        list(sig = ptukey(q, k, dfw_full, lower.tail = FALSE), lo = diff - crit / sqrt(2) * se, hi = diff + crit / sqrt(2) * se)
      })
      if (isTRUE(po$gamesHowell)) add_uneq("output.col.gamesHowell", function(diff, se, dfij) {
        q <- abs(diff) / se * sqrt(2); crit <- qtukey(1 - alpha, k, dfij)
        list(sig = ptukey(q, k, dfij, lower.tail = FALSE), lo = diff - crit / sqrt(2) * se, hi = diff + crit / sqrt(2) * se)
      })
      if (isTRUE(po$tamhaneT2)) add_uneq("output.col.tamhaneT2", function(diff, se, dfij) {
        alpha_per <- 1 - (1 - alpha)^(1 / ncmp); crit <- qt(1 - alpha_per / 2, dfij)
        praw <- 2 * pt(-abs(diff / se), dfij)
        list(sig = min(1, 1 - (1 - praw)^ncmp), lo = diff - crit * se, hi = diff + crit * se)
      })
      if (isTRUE(po$dunnettT3)) add_uneq("output.col.dunnettT3", function(diff, se, dfij) {
        if (!requireNamespace("mvtnorm", quietly = TRUE)) return(list(sig = NA_real_, lo = NA_real_, hi = NA_real_))
        corr <- diag(ncmp); df_int <- max(1L, round(dfij))
        set.seed(12345L)
        crit <- mvtnorm::qmvt(1 - alpha, tail = "both.tails", df = df_int, corr = corr)$quantile
        tstat <- abs(diff) / se
        sig <- 1 - as.numeric(mvtnorm::pmvt(lower = rep(-tstat, ncmp), upper = rep(tstat, ncmp), df = df_int, corr = corr))
        list(sig = min(max(sig, 0), 1), lo = diff - crit * se, hi = diff + crit * se)
      })
      if (isTRUE(po$dunnettC)) {
        dfi_all <- ni - 1
        add_uneq_c <- function(method_key) {
          first <- TRUE
          for (i in seq_len(k)) for (j in seq_len(k)) if (i != j) {
            diff <- mns[i] - mns[j]
            wi_ <- vi[i] / ni[i]; wj_ <- vi[j] / ni[j]; se <- sqrt(wi_ + wj_)
            if (ni[i] < 2 || ni[j] < 2 || !is.finite(se) || se <= 0) next
            q_crit_at <- function(a) {
              qi <- qtukey(1 - a, k, dfi_all[i]); qj <- qtukey(1 - a, k, dfi_all[j])
              (wi_ * qi + wj_ * qj) / (wi_ + wj_)
            }
            crit <- q_crit_at(alpha) / sqrt(2); q_obs <- abs(diff) / se * sqrt(2)
            eps <- 1e-9; f <- function(a) q_crit_at(a) - q_obs
            sig <- tryCatch({
              if (f(eps) <= 0) eps else if (f(1 - eps) >= 0) 1 - eps else uniroot(f, c(eps, 1 - eps))$root
            }, error = function(e) NA_real_)
            ph_rows[[length(ph_rows) + 1L]] <<- list(
              if (first) method_key else "", lvls[i], lvls[j], round(diff, 4),
              round(se, 4), round(sig, 6), round(diff - crit * se, 4), round(diff + crit * se, 4))
            first <- FALSE
          }
        }
        add_uneq_c("output.col.dunnettC")
      }

      if (length(ph_rows) > 0) {
        tables <- c(tables, list(list(
          titleKey = paste0("output.glmUni.postHocTitle:", dname, "|", fac_disp),
          columns  = list("output.col.method", "output.col.groupI", "output.col.groupJ",
                          "output.col.meanDiff", "output.col.stdError", "output.col.sig",
                          paste0("output.col.ciLowerPct:", ci_pct), paste0("output.col.ciUpperPct:", ci_pct)),
          rows = ph_rows, footnoteKey = NULL)))
      }

      # ── Homogeneous Subsets (S-N-K, Duncan, R-E-G-W-Q, Waller-Duncan, plus a
      # Tukey HSD/Scheffe subset variant when those are also requested) — same
      # agricolae-backed approach and independently re-derived per-subset "Sig."
      # formulas as anova-oneway.R (see that script's comment for the full
      # rationale and which methods' Sig. row is/isn't reproduced), fed this
      # factor's OBSERVED means/N and the FULL model's pooled dfres/MSE.
      hs_wanted <- c("tukey", "scheffe", "snk", "duncan", "regwQ", "wallerDuncan")
      if (any(vapply(hs_wanted, function(kk) isTRUE(po[[kk]]), logical(1)))) {
        if (!requireNamespace("agricolae", quietly = TRUE)) {
          warns <- c(warns, "output.warn.agricolaeNotAvailable")
        } else {
          hs_x <- y; hs_g <- g; hs_ok <- TRUE
          if (!is.null(w)) {
            if (any(abs(w - round(w)) > 1e-8)) {
              warns <- c(warns, "output.warn.homogeneousSubsetsNotComputed"); hs_ok <- FALSE
            } else {
              reps <- pmax(as.integer(round(w)), 0L)
              idx  <- rep(seq_along(hs_x), reps)
              hs_x <- hs_x[idx]; hs_g <- hs_g[idx]
            }
          }
          if (hs_ok) {
            hs_nh <- k / sum(1 / ni)  # SPSS's "Harmonic Mean Sample Size"
            hs_sdtdif <- sqrt(msw_full / hs_nh)
            fac_term_idx <- match(fcol, tl)
            Fv_fac <- if (!is.na(fac_term_idx)) (term_ss[fac_term_idx] / term_df[fac_term_idx]) / MSE else NA_real_

            to_subset_rows <- function(groups_df, sig_fn = NULL) {
              letters_by_lvl <- setNames(as.character(groups_df$groups), rownames(groups_df))[lvls]
              means_by_lvl   <- setNames(groups_df[[1]], rownames(groups_df))[lvls]
              all_letters <- sort(unique(unlist(strsplit(letters_by_lvl, ""))))
              subset_mean <- vapply(all_letters, function(L) {
                min(means_by_lvl[grepl(L, letters_by_lvl, fixed = TRUE)])
              }, numeric(1))
              all_letters <- all_letters[order(subset_mean)]
              rows <- lapply(lvls[order(means_by_lvl)], function(lvl) {
                c(list(lvl, format_wtd_count(ni[lvl], w)), lapply(all_letters, function(L) {
                  if (grepl(L, letters_by_lvl[lvl], fixed = TRUE)) round(means_by_lvl[lvl], 6) else NULL
                }))
              })
              if (!is.null(sig_fn)) {
                sig_cells <- lapply(all_letters, function(L) {
                  members <- means_by_lvl[grepl(L, letters_by_lvl, fixed = TRUE)]
                  round(if (length(members) < 2) 1 else sig_fn(diff(range(members)), length(members)), 6)
                })
                rows <- c(rows, list(c(list("output.anova.sigRow", NA_real_), sig_cells)))
              }
              list(rows = rows, nSubsets = length(all_letters))
            }
            add_hs_table <- function(method_key, fit) {
              built <- to_subset_rows(fit$groups, if (identical(method_key, "output.col.tukeyHSD")) sig_tukey
                                       else if (identical(method_key, "output.anova.snk")) sig_snk
                                       else if (identical(method_key, "output.anova.duncan")) sig_duncan
                                       else NULL)
              cols <- c(list(fac_disp, "output.col.n"),
                        lapply(seq_len(built$nSubsets), function(i) paste0("output.anova.subsetN:", i)))
              tables <<- c(tables, list(list(
                titleKey    = paste0("output.glmUni.homogSubsetsTitle:", dname, "|", fac_disp, "|", method_key),
                columns     = cols, rows = built$rows,
                footnoteKey = paste0("output.anova.harmonicMeanFootnote:", round(hs_nh, 3)))))
            }
            sig_tukey  <- function(rng, r) ptukey(rng / hs_sdtdif, k, dfw_full, lower.tail = FALSE)
            sig_snk    <- function(rng, r) ptukey(rng / hs_sdtdif, r, dfw_full, lower.tail = FALSE)
            sig_duncan <- function(rng, r) 1 - ptukey(rng / hs_sdtdif, r, dfw_full)^(1 / (r - 1))

            if (isTRUE(po$tukey)) tryCatch(
              add_hs_table("output.col.tukeyHSD", agricolae::HSD.test(hs_x, hs_g, dfw_full, msw_full, alpha = alpha, group = TRUE)),
              error = function(e) warns <<- c(warns, "output.warn.homogeneousSubsetsNotComputed"))
            if (isTRUE(po$scheffe)) tryCatch(
              add_hs_table("output.col.scheffe", agricolae::scheffe.test(hs_x, hs_g, dfw_full, msw_full, Fv_fac, alpha = alpha, group = TRUE)),
              error = function(e) warns <<- c(warns, "output.warn.homogeneousSubsetsNotComputed"))
            if (isTRUE(po$snk)) tryCatch(
              add_hs_table("output.anova.snk", agricolae::SNK.test(hs_x, hs_g, dfw_full, msw_full, alpha = alpha, group = TRUE)),
              error = function(e) warns <<- c(warns, "output.warn.homogeneousSubsetsNotComputed"))
            if (isTRUE(po$duncan)) tryCatch(
              add_hs_table("output.anova.duncan", agricolae::duncan.test(hs_x, hs_g, dfw_full, msw_full, alpha = alpha, group = TRUE)),
              error = function(e) warns <<- c(warns, "output.warn.homogeneousSubsetsNotComputed"))
            if (isTRUE(po$regwQ)) tryCatch(
              add_hs_table("output.anova.regwQ", agricolae::REGW.test(hs_x, hs_g, dfw_full, msw_full, alpha = alpha, group = TRUE)),
              error = function(e) warns <<- c(warns, "output.warn.homogeneousSubsetsNotComputed"))
            if (isTRUE(po$wallerDuncan)) tryCatch(
              add_hs_table("output.anova.wallerDuncan", agricolae::waller.test(
                hs_x, hs_g, dfw_full, msw_full, Fv_fac,
                K = if (!is.null(po$wallerK)) as.numeric(po$wallerK) else 100, group = TRUE)),
              error = function(e) warns <<- c(warns, "output.warn.wallerDuncanNotComputed"))
          }
        }
      }

      # ── Dunnett (vs. control) — emmeans-backed. Unlike the pairwise tests
      # above, this needs the model's full multivariate-t joint distribution
      # across the k-1 control comparisons, which emmeans/mvtnorm implements
      # correctly (dunnettx); a hand-rolled version would repeat the same
      # SMM/correlation derivation Dunnett T3 above already needs mvtnorm for,
      # with more failure surface (k-1 correlated contrasts, not one pair).
      if (isTRUE(po$dunnett)) {
        if (!requireNamespace("emmeans", quietly = TRUE)) {
          warns <- c(warns, "output.warn.emmeansNotAvailable")
        } else {
          control_ref <- if (identical(po$dunnettControl, "first")) 1L else k
          dun <- tryCatch({
            spec <- stats::as.formula(paste("~", fcol))
            em <- emmeans::emmeans(full, spec)
            summary(emmeans::contrast(em, method = "trt.vs.ctrl", ref = control_ref),
                     infer = c(TRUE, TRUE))
          }, error = function(e) NULL)
          if (is.null(dun)) {
            warns <- c(warns, "output.warn.dunnettNotComputed")
          } else {
            dun_rows <- lapply(seq_len(nrow(dun)), function(i) list(
              sub(" - .*$", "", as.character(dun$contrast[i])), lvls[control_ref],
              round(dun$estimate[i], 4), round(dun$SE[i], 4), round(dun$p.value[i], 6),
              round(dun$lower.CL[i], 4), round(dun$upper.CL[i], 4)))
            tables <- c(tables, list(list(
              titleKey = paste0("output.glmUni.dunnettTitle:", dname, "|", fac_disp),
              columns  = list("output.col.groupI", "output.col.controlGroup",
                              "output.col.meanDiff", "output.col.stdError", "output.col.sig",
                              paste0("output.col.ciLowerPct:", ci_pct), paste0("output.col.ciUpperPct:", ci_pct)),
              rows = dun_rows, footnoteKey = "output.anova.dunnettFootnote")))
          }
        }
      }
    }
  }

  # ── Estimated Marginal Means ─────────────────────────────────────────────────
  # Equal-weight average over a balanced grid of the OTHER factors' levels
  # (covariates fixed at their sample mean) — the standard "estimated marginal
  # means" definition (SPSS's own, and what emmeans/effects call a balanced
  # reference grid). Only "OVERALL" and single-factor main-effect terms are
  # supported this round (interaction terms deferred, see file header).
  em_terms <- unlist(opts$emMeans$terms)
  if (length(em_terms) > 0) {
    cov_means <- if (length(covs) > 0) {
      setNames(vapply(seq_along(covs), function(i) wtd_mean(dat[[paste0("c", i)]], w), numeric(1)),
               paste0("c", seq_along(covs)))
    } else NULL
    fac_levels <- lapply(seq_along(facs), function(i) levels(dat[[paste0("f", i)]]))
    # NB: paste0("f", integer(0)) is NOT character(0) — paste0 recycles a
    # zero-length argument to "" by default (recycle0=FALSE), so it returns
    # "f" instead. Guarding explicitly avoids assigning a length-1 names
    # vector to the (correctly) length-0 fac_levels when there are no factors.
    names(fac_levels) <- if (length(facs) > 0) paste0("f", seq_along(facs)) else character(0)
    mm_terms <- delete.response(terms(full))

    # Predicted value(s) + covariance for every row of `grid`, then equal-
    # weight average across rows -> one EM mean + its correct (correlated)
    # standard error, via Var(mean) = (1/m^2) * sum(Xg %*% vcov(full) %*% t(Xg)).
    em_estimate <- function(grid) {
      for (nm in names(cov_means)) grid[[nm]] <- cov_means[[nm]]
      Xg <- model.matrix(mm_terms, data = grid)
      fits <- as.numeric(Xg %*% coef(full))
      V <- Xg %*% vcov(full) %*% t(Xg)
      m <- nrow(Xg)
      est <- mean(fits)
      se  <- sqrt(sum(V) / m^2)
      list(est = est, se = se, V = V, Xg = Xg, m = m)
    }

    em_tables <- list()
    for (term in em_terms) {
      if (identical(term, "OVERALL")) {
        grid <- if (length(fac_levels) > 0) do.call(expand.grid, c(fac_levels, stringsAsFactors = TRUE)) else data.frame(.dummy = 1)
        r <- em_estimate(grid)
        crit <- qt(1 - alpha / 2, dfres)
        em_tables <- c(em_tables, list(list(
          titleKey = paste0("output.glmUni.emMeansTitle:", dname, "|", "output.col.overall"),
          columns  = list("output.col.emMean", "output.col.stdError",
                          paste0("output.col.ciLowerPct:", ci_pct), paste0("output.col.ciUpperPct:", ci_pct)),
          rows = list(list(round(r$est, 4), round(r$se, 4),
                            round(r$est - crit * r$se, 4), round(r$est + crit * r$se, 4))),
          footnoteKey = NULL)))
        next
      }
      # Interaction term (UI sends "colIdA*colIdB[*colIdC…]") — emmeans-backed,
      # unlike the OVERALL/main-effect cases above (plain linear algebra on the
      # model matrix): emmeans's own reference-grid machinery already handles
      # an arbitrary number of crossed factors correctly, where hand-rolling it
      # here would mean re-deriving the joint grid/covariance construction
      # this section already does for ONE factor, for N of them.
      if (grepl("*", term, fixed = TRUE)) {
        parts <- strsplit(term, "*", fixed = TRUE)[[1]]
        idxs <- match(parts, facs)
        if (any(is.na(idxs)) || length(idxs) < 2) next
        if (!requireNamespace("emmeans", quietly = TRUE)) {
          warns <- c(warns, "output.warn.emmeansNotAvailable")
          next
        }
        fcols_i <- paste0("f", idxs)
        spec  <- stats::as.formula(paste("~", paste(fcols_i, collapse = ":")))
        emres <- tryCatch(
          summary(emmeans::emmeans(full, spec), infer = c(TRUE, TRUE), level = 1 - alpha),
          error = function(e) NULL)
        if (is.null(emres)) {
          warns <- c(warns, "output.warn.emMeansInteractionNotComputed")
          next
        }
        disp_names <- vapply(idxs, function(fi2) {
          nm <- fac_names[[facs[fi2]]]; if (is.null(nm)) facs[fi2] else nm
        }, character(1))
        int_rows <- lapply(seq_len(nrow(emres)), function(i) {
          c(lapply(fcols_i, function(fc) as.character(emres[[fc]][i])),
            list(round(emres$emmean[i], 4), round(emres$SE[i], 4),
                 round(emres$lower.CL[i], 4), round(emres$upper.CL[i], 4)))
        })
        term_label_disp <- paste(disp_names, collapse = " * ")
        em_tables <- c(em_tables, list(list(
          titleKey = paste0("output.glmUni.emMeansTitle:", dname, "|", term_label_disp),
          columns  = c(as.list(disp_names), list(
                        "output.col.emMean", "output.col.stdError",
                        paste0("output.col.ciLowerPct:", ci_pct), paste0("output.col.ciUpperPct:", ci_pct))),
          rows = int_rows, footnoteKey = NULL)))
        next
      }
      fi <- match(term, facs)
      if (is.na(fi)) next
      fcol <- paste0("f", fi); other_levels <- fac_levels[setdiff(names(fac_levels), fcol)]
      lvls <- fac_levels[[fcol]]
      ests <- numeric(length(lvls)); ses <- numeric(length(lvls))
      Vlist <- vector("list", length(lvls)); avg_rows <- vector("list", length(lvls))
      for (li in seq_along(lvls)) {
        grid <- if (length(other_levels) > 0) do.call(expand.grid, c(other_levels, stringsAsFactors = TRUE)) else data.frame(.dummy = 1)
        grid[[fcol]] <- factor(lvls[li], levels = lvls)
        r <- em_estimate(grid)
        ests[li] <- r$est; ses[li] <- r$se
        avg_rows[[li]] <- colMeans(r$Xg)
      }
      # Covariance between two levels' EM means: both are equal-weight averages
      # of model-matrix rows, so Cov(mean_i, mean_j) = avgrow_i %*% vcov %*% avgrow_j.
      avg_mat <- do.call(rbind, avg_rows)
      Vfull <- avg_mat %*% vcov(full) %*% t(avg_mat)
      crit <- qt(1 - alpha / 2, dfres)
      em_rows <- lapply(seq_along(lvls), function(li) list(
        lvls[li], round(ests[li], 4), round(sqrt(Vfull[li, li]), 4),
        round(ests[li] - crit * sqrt(Vfull[li, li]), 4), round(ests[li] + crit * sqrt(Vfull[li, li]), 4)))
      fac_disp <- fac_names[[facs[fi]]]; if (is.null(fac_disp)) fac_disp <- facs[fi]
      em_tables <- c(em_tables, list(list(
        titleKey = paste0("output.glmUni.emMeansTitle:", dname, "|", fac_disp),
        columns  = list(fac_disp, "output.col.emMean", "output.col.stdError",
                        paste0("output.col.ciLowerPct:", ci_pct), paste0("output.col.ciUpperPct:", ci_pct)),
        rows = em_rows, footnoteKey = NULL)))

      if (isTRUE(opts$emMeans$compareMainEffects) && length(lvls) >= 2) {
        adjust <- opts$emMeans$ciAdjust
        ncmp_e <- choose(length(lvls), 2)
        cmp_rows <- list()
        for (i in seq_len(length(lvls))) for (j in seq_len(length(lvls))) if (i != j) {
          diff <- ests[i] - ests[j]
          se_d <- sqrt(Vfull[i, i] + Vfull[j, j] - 2 * Vfull[i, j])
          if (identical(adjust, "bonferroni")) {
            praw <- 2 * pt(-abs(diff / se_d), dfres); sig <- min(1, praw * ncmp_e)
            crit_c <- qt(1 - (alpha / ncmp_e) / 2, dfres)
          } else if (identical(adjust, "sidak")) {
            alpha_per <- 1 - (1 - alpha)^(1 / ncmp_e)
            praw <- 2 * pt(-abs(diff / se_d), dfres); sig <- min(1, 1 - (1 - praw)^ncmp_e)
            crit_c <- qt(1 - alpha_per / 2, dfres)
          } else {
            sig <- 2 * pt(-abs(diff / se_d), dfres); crit_c <- qt(1 - alpha / 2, dfres)
          }
          cmp_rows[[length(cmp_rows) + 1L]] <- list(
            lvls[i], lvls[j], round(diff, 4), round(se_d, 4), round(sig, 6),
            round(diff - crit_c * se_d, 4), round(diff + crit_c * se_d, 4))
        }
        em_tables <- c(em_tables, list(list(
          titleKey = paste0("output.glmUni.emCompareTitle:", dname, "|", fac_disp),
          columns  = list("output.col.groupI", "output.col.groupJ", "output.col.meanDiff",
                          "output.col.stdError", "output.col.sig",
                          paste0("output.col.ciLowerPct:", ci_pct), paste0("output.col.ciUpperPct:", ci_pct)),
          rows = cmp_rows, footnoteKey = NULL)))
      }
    }
    tables <- c(tables, em_tables)
  }

  # ── Save (new case variables) ───────────────────────────────────────────────
  # Predicted values and residual diagnostics from the FULL model — these are
  # invariant to the contrast coding Parameter Estimates/Contrasts choose
  # (fitted values and residuals depend only on the fitted hyperplane, not its
  # parametrization), so they always come from `full`, never `full_param`.
  case_vars <- list()
  want_new <- requested_new_vars(params)
  if (length(want_new) > 0) {
    add_var <- function(key, values, decimals = 4) {
      if (!is.null(want_new[[key]])) {
        case_vars[[length(case_vars) + 1L]] <<- sai_case_var(
          want_new[[key]], values, dat, labelKey = paste0("output.glmUni.newVar.", key), decimals = decimals)
      }
    }
    add_var("predicted", stats::fitted(full))
    add_var("residual", stats::residuals(full))
    se_est <- sqrt(MSE)
    add_var("standardized", stats::residuals(full) / se_est)
    add_var("studentized", stats::rstandard(full))
    add_var("deleted", stats::rstudent(full))
    add_var("leverage", stats::hatvalues(full))
    add_var("cooks", stats::cooks.distance(full))
  }

  list(tables = tables, warnings = warns, notes = notes, caseVars = case_vars)
}
