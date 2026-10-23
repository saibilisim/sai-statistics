# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# survival-cox.R — Cox Regression (proportional hazards, SPSS-style).
#
# Params: timeVar, timeName, statusVar, eventValue, covariates (colIds),
#         varNames, categorical (colId -> {contrast, reference}),
#         categoricalValueLabels, strata (opt), strataName, method,
#         options$ci{ExpB,Level}, options$correlation, options$baseline,
#         options$phTest, options$display, options$entry, options$removal,
#         options$maxIterations,
#         plots = { survival, hazard, logMinusLog, oneMinusSurvival,
#                   separateBy, values }
# Output: "Omnibus Tests of Model Coefficients" + "Variables in the Equation"
#         (B, SE, Wald, df, Sig., Exp(B), CI), plus — as requested — the
#         stepwise history, the correlation matrix, the baseline table, the
#         proportional-hazards test and the covariate-adjusted plots.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

# ── SPSS contrast coding for categorical covariates ───────────────────────────
# SPSS's "Categorical…" sub-dialog offers seven codings. Three have direct base
# R equivalents; the other four are defined by WHICH COMPARISONS the
# coefficients should express, not by a coding matrix, so they are built from
# the comparison matrix C ((k-1) x k, rows summing to zero) via
#
#   L = C'(CC')^-1
#
# which is the unique coding making b = C·mu: with design mu = b0·1 + L·b,
# C·mu = (C1)b0 + (CL)b = 0 + (CL)b, and CL = CC'(CC')^-1 = I. The same
# identity gives 1'L = (C1)'(CC')^-1 = 0, so the intercept stays the grand mean
# and the contrasts are the comparisons SPSS documents — not a reparametrised
# lookalike that reports different standard errors.
sai_spss_contrast <- function(k, type = "indicator", reference = "last") {
  if (k < 2) return(NULL)
  ref <- if (identical(reference, "first")) 1L else k
  from_comparisons <- function(C) t(C) %*% solve(C %*% t(C))

  switch(type,
    # b_j = mu_j - mu_ref, intercept = mu_ref.
    indicator = diag(k)[, -ref, drop = FALSE],
    # b_j = mu_j - mu_ref, intercept = grand mean.
    simple = diag(k)[, -ref, drop = FALSE] - 1 / k,
    # b_j = mu_j - grand mean (the reference category has no coefficient).
    deviation = {
      L <- matrix(0, k, k - 1)
      others <- setdiff(seq_len(k), ref)
      for (j in seq_along(others)) { L[others[j], j] <- 1; L[ref, j] <- -1 }
      L
    },
    # b_i = mu_{i+1} - mean(mu_1..mu_i)  (reverse Helmert).
    difference = {
      C <- matrix(0, k - 1, k)
      for (i in seq_len(k - 1)) { C[i, seq_len(i)] <- -1 / i; C[i, i + 1] <- 1 }
      from_comparisons(C)
    },
    # b_i = mu_i - mean(mu_{i+1}..mu_k).
    helmert = {
      C <- matrix(0, k - 1, k)
      for (i in seq_len(k - 1)) { C[i, i] <- 1; C[i, (i + 1):k] <- -1 / (k - i) }
      from_comparisons(C)
    },
    # b_i = mu_i - mu_{i+1}  (adjacent categories).
    repeated = {
      C <- matrix(0, k - 1, k)
      for (i in seq_len(k - 1)) { C[i, i] <- 1; C[i, i + 1] <- -1 }
      from_comparisons(C)
    },
    # Orthogonal polynomial coding — linear, quadratic, … trends across the
    # (assumed equally spaced) categories.
    polynomial = stats::contr.poly(k),
    stop("unknown contrast type"))
}

tryCatch({
  progress(10L, "progress.loading")
  if (!requireNamespace("survival", quietly = TRUE)) {
    sai_output(tables = list(), warnings = "output.survival.needsPackage"); quit(save = "no")
  }
  tv <- params$timeVar; stv <- params$statusVar
  ev <- as.character(params$eventValue)
  covs <- unlist(params$covariates); var_names <- params$varNames
  cat_spec <- params$categorical
  sv <- params$strata
  opts <- params$options
  plots_opt <- params$plots
  on_flag <- function(x, default = FALSE) if (is.null(x)) default else isTRUE(x)
  method <- if (is.null(params$method)) "enter" else params$method

  if (is.null(tv) || !tv %in% names(df)) sai_error("Time variable not found")
  if (is.null(stv) || !stv %in% names(df)) sai_error("Status variable not found")
  if (length(covs) == 0) sai_error("No covariates specified")

  ci_level <- if (is.null(opts$ciLevel)) 0.95 else as.numeric(opts$ciLevel) / 100
  if (!is.finite(ci_level) || ci_level <= 0 || ci_level >= 1) ci_level <- 0.95
  z_crit <- stats::qnorm(1 - (1 - ci_level) / 2)
  p_entry <- if (is.null(opts$entry)) 0.05 else as.numeric(opts$entry)
  p_removal <- if (is.null(opts$removal)) 0.10 else as.numeric(opts$removal)
  max_iter <- if (is.null(opts$maxIterations)) 20L else as.integer(opts$maxIterations)
  ctrl <- survival::coxph.control(iter.max = max_iter)

  cov_names <- vapply(covs, function(c) resolve_var_name(c, var_names), character(1))
  has_strata <- !is.null(sv) && sv %in% names(df)

  # ── Model frame ────────────────────────────────────────────────────────────
  dat <- data.frame(
    .time = suppressWarnings(as.numeric(apply_user_missing(df[[tv]], tv, params))),
    .status = as.integer(as.character(apply_user_missing(df[[stv]], stv, params)) == ev))
  # Carried through the listwise deletion below so any new variable this run
  # creates knows which dataset rows its values belong to (NV1). Assigned by
  # name, not via data.frame(), whose check.names would rewrite it to X__row_idx.
  dat[["__row_idx"]] <- row_index_of(df)
  if (has_strata) dat$.strat <- as.character(apply_user_missing(df[[sv]], sv, params))

  term_ids <- paste0("v", seq_along(covs))
  # Raw covariate columns first; the categorical ones stay as characters until
  # after the listwise deletion so a category that only appears on incomplete
  # rows never reaches the contrast matrix.
  cat_state <- list()
  for (i in seq_along(covs)) {
    cid <- covs[i]
    if (!cid %in% names(df)) sai_error(sprintf("Covariate not found: %s", cid))
    raw <- apply_user_missing(df[[cid]], cid, params)
    if (!is.null(cat_spec[[cid]])) {
      v <- as.character(raw)
      v[!nzchar(v)] <- NA_character_
      dat[[term_ids[i]]] <- v
      cat_state[[term_ids[i]]] <- cat_spec[[cid]]
    } else {
      x <- suppressWarnings(as.numeric(raw))
      if (all(is.na(x))) sai_error(sprintf(
        "Covariate is not numeric — mark it categorical to use it: %s", cov_names[i]))
      dat[[term_ids[i]]] <- x
    }
  }

  dat <- dat[stats::complete.cases(dat), , drop = FALSE]
  if (nrow(dat) == 0) sai_error("Not enough complete cases")
  if (sum(dat$.status) == 0) sai_error("No events (all cases are censored)")

  # A categorical covariate becomes its own EXPLICIT numeric contrast columns
  # rather than a factor with a `contrasts` attribute, and the model is fitted
  # on those columns directly.
  #
  # This is not a style preference. survfit.coxph() rebuilds the design for
  # `newdata` WITHOUT honouring a factor's custom contrast matrix — R silently
  # drops the attribute (data.frame row-binding drops it too) and falls back to
  # contr.treatment. predict() honours it, survfit() does not, so the two
  # disagree about what row means what: on the validation fixture the survival
  # curves came out attached to the WRONG categories, with the lowest-hazard
  # group drawn as the worst-surviving one, while every coefficient in the
  # table was correct. Building the design ourselves removes the disagreement
  # at its source — there is no factor left for anything to reinterpret.
  #
  # Per term we keep how many coefficients it contributes and what each is
  # called, computed from the levels rather than parsed back out of coefficient
  # names: a category label containing a digit or a colon would defeat any
  # name-parsing scheme, while the coefficient ORDER is fixed by the formula.
  term_meta <- list()
  for (i in seq_along(covs)) {
    id <- term_ids[i]
    spec <- cat_state[[id]]
    if (is.null(spec)) {
      term_meta[[i]] <- list(id = id, name = cov_names[i], colId = covs[i],
                             ncoef = 1L, labels = cov_names[i], cols = id,
                             categorical = FALSE)
      next
    }
    f <- factor(dat[[id]])
    lv <- levels(f)
    k <- length(lv)
    if (k < 2) sai_error(sprintf(
      "Categorical covariate has fewer than two categories: %s", cov_names[i]))
    ctype <- if (is.null(spec$contrast)) "indicator" else spec$contrast
    cref  <- if (is.null(spec$reference)) "last" else spec$reference
    L <- sai_spss_contrast(k, ctype, cref)
    cols <- paste0(id, "_c", seq_len(k - 1))
    Z <- L[as.integer(f), , drop = FALSE]
    dat[[id]] <- NULL
    for (j in seq_along(cols)) dat[[cols[j]]] <- as.numeric(Z[, j])
    term_meta[[i]] <- list(id = id, name = cov_names[i], colId = covs[i],
                           ncoef = k - 1L, labels = paste0(cov_names[i], "(",
                                                           seq_len(k - 1), ")"),
                           cols = cols, categorical = TRUE, levels = lv,
                           contrastMatrix = L, contrast = ctype, reference = cref)
  }
  n_coef_full <- sum(vapply(term_meta, function(m) m$ncoef, numeric(1)))
  if (nrow(dat) <= n_coef_full + 1) sai_error("Not enough complete cases")

  # ── Fitting ────────────────────────────────────────────────────────────────
  # A term is a VARIABLE; the formula it expands to is that variable's design
  # columns. Selection therefore adds or drops a categorical covariate's
  # contrast columns as one unit, which is the only way that is meaningful —
  # testing a single dummy of a three-level factor tests nothing.
  fit_terms <- function(ids) {
    if (length(ids) == 0) return(NULL)
    cols <- unlist(lapply(ids, function(i) meta_by_id[[i]]$cols))
    rhs <- c(cols, if (has_strata) "strata(.strat)")
    f <- stats::as.formula(paste("survival::Surv(.time, .status) ~",
                                 paste(rhs, collapse = " + ")))
    tryCatch(survival::coxph(f, data = dat, control = ctrl), error = function(e) NULL)
  }
  ll_of <- function(fit) if (is.null(fit)) ll_null else fit$loglik[length(fit$loglik)]
  npar_of <- function(fit) if (is.null(fit)) 0L else length(stats::coef(fit))

  all_ids <- vapply(term_meta, function(m) m$id, character(1))
  meta_by_id <- setNames(term_meta, all_ids)
  full <- fit_terms(all_ids)
  if (is.null(full)) sai_error("The Cox model did not converge")
  ll_null <- full$loglik[1]

  #' Coefficient indices of one term inside a model holding `ids`, in formula
  #' order — the order coxph lays its coefficients out in.
  idx_of <- function(ids, id) {
    off <- 0L
    for (i in ids) {
      n <- meta_by_id[[i]]$ncoef
      if (i == id) return(off + seq_len(n))
      off <- off + n
    }
    integer(0)
  }
  #' Multivariate Wald chi-square for one term (df = its number of
  #' coefficients). The single-coefficient case reduces to (B/SE)^2, which is
  #' the number SPSS prints for a scale covariate.
  wald_of <- function(fit, ids, id) {
    idx <- idx_of(ids, id)
    if (length(idx) == 0) return(NULL)
    b <- stats::coef(fit)[idx]
    V <- as.matrix(stats::vcov(fit))[idx, idx, drop = FALSE]
    chi <- tryCatch(as.numeric(t(b) %*% solve(V) %*% b), error = function(e) NA_real_)
    if (!is.finite(chi)) return(NULL)
    list(chisq = chi, df = length(idx),
         p = stats::pchisq(chi, length(idx), lower.tail = FALSE))
  }
  lr_between <- function(fit_small, fit_big) {
    chi <- 2 * (ll_of(fit_big) - ll_of(fit_small))
    d <- npar_of(fit_big) - npar_of(fit_small)
    if (!is.finite(chi) || d <= 0) return(NULL)
    chi <- max(chi, 0)
    list(chisq = chi, df = d, p = stats::pchisq(chi, d, lower.tail = FALSE))
  }

  progress(40L, "progress.computing")
  notes <- character(0)
  warnings <- character(0)
  steps <- list()
  step_fits <- list()

  # ── Variable selection ─────────────────────────────────────────────────────
  # SPSS drives entry off the SCORE statistic and removal off the criterion
  # named in the method (Wald / LR / conditional). Both statistics here are
  # computed from the partial likelihood the model is actually fitted with —
  # LR for entry in every method, and LR or Wald for removal as named — because
  # a score test for adding a term to an already-fitted Cox model has no
  # supported entry point in `survival` and hand-rolling one is exactly the
  # kind of reimplementation CLAUDE.md §11 rules out. The statistic used is
  # printed under the table, so nobody has to infer it from a mismatch with
  # SPSS's third decimal.
  #
  # Selection operates on TERMS, not coefficients: a categorical covariate's
  # contrast columns enter and leave together, as they must — testing one dummy
  # of a three-level factor tests nothing meaningful.
  use_wald_removal <- method %in% c("forwardWald", "backwardWald")
  is_forward <- method %in% c("forwardLR", "forwardWald")
  is_backward <- method %in% c("backwardLR", "backwardWald")
  removal_stat <- function(fit, ids, id) {
    if (use_wald_removal) return(wald_of(fit, ids, id))
    lr_between(fit_terms(setdiff(ids, id)), fit)
  }

  if (is_forward || is_backward) {
    current <- if (is_backward) all_ids else character(0)
    fit_cur <- if (is_backward) full else NULL
    step_no <- 0L
    # Each pass adds or drops at most one term, so the loop cannot outlive
    # twice the term count plus the alternations between the two.
    max_steps <- 2L * length(all_ids) + 5L
    repeat {
      if (step_no >= max_steps) { warnings <- c(warnings, "output.cox.stepLimit"); break }
      acted <- FALSE

      if (is_forward) {
        best <- NULL
        for (cand in setdiff(all_ids, current)) {
          f <- fit_terms(c(current, cand))
          if (is.null(f)) next
          r <- lr_between(fit_cur, f)
          if (is.null(r)) next
          if (is.null(best) || r$p < best$p) best <- c(r, list(id = cand, fit = f))
        }
        if (!is.null(best) && best$p < p_entry) {
          step_no <- step_no + 1L
          current <- c(current, best$id)
          fit_cur <- best$fit
          steps <- c(steps, list(list(step = step_no, action = "output.col.entered",
                                      term = meta_by_id[[best$id]]$name,
                                      chisq = best$chisq, df = best$df, p = best$p)))
          step_fits <- c(step_fits, list(fit_cur))
          acted <- TRUE
        }
      }

      # Backward starts here (nothing entered yet), and forward runs the same
      # block after each entry — SPSS re-tests the terms already in the model
      # at every step, because a term can become redundant once a correlated
      # one joins it.
      repeat {
        if (length(current) == 0) break
        worst <- NULL
        for (id in current) {
          r <- removal_stat(fit_cur, current, id)
          if (is.null(r)) next
          if (is.null(worst) || r$p > worst$p) worst <- c(r, list(id = id))
        }
        if (is.null(worst) || worst$p <= p_removal) break
        step_no <- step_no + 1L
        current <- setdiff(current, worst$id)
        fit_cur <- fit_terms(current)
        steps <- c(steps, list(list(step = step_no, action = "output.col.removed",
                                    term = meta_by_id[[worst$id]]$name,
                                    chisq = worst$chisq, df = worst$df, p = worst$p)))
        step_fits <- c(step_fits, list(fit_cur))
        acted <- TRUE
        if (is_backward && step_no >= max_steps) break
      }

      if (!acted) break
    }
    final_ids <- current
    fit <- fit_cur
    notes <- c(notes, if (use_wald_removal) "output.cox.stepWaldNote" else "output.cox.stepLRNote")
  } else {
    final_ids <- all_ids
    fit <- full
  }

  if (is.null(fit) || length(final_ids) == 0) {
    # A forward run where nothing cleared the entry threshold is a real result,
    # not an error — report it as one instead of failing with an empty model.
    progress(100L, "progress.done")
    sai_output(tables = list(), notes = notes,
               warnings = c(warnings, "output.cox.noTermsEntered"))
    quit(save = "no")
  }

  sm <- summary(fit, conf.int = ci_level)
  co <- sm$coefficients            # coef, exp(coef), se(coef), z, Pr(>|z|)
  b_all <- stats::coef(fit)
  se_all <- sqrt(diag(as.matrix(stats::vcov(fit))))

  # ── Variables in the Equation ──────────────────────────────────────────────
  ci_cols <- if (on_flag(opts$ciExpB, TRUE))
    list("output.col.expBLower", "output.col.expBUpper") else list()
  eq_rows <- list()
  for (id in final_ids) {
    m <- meta_by_id[[id]]
    idx <- idx_of(final_ids, id)
    if (m$categorical) {
      # SPSS heads a categorical covariate with its overall (multi-df) Wald
      # test and then lists one row per contrast; without the header row a
      # three-level factor has no single "is this variable significant" answer.
      w <- wald_of(fit, final_ids, id)
      eq_rows <- c(eq_rows, list(c(
        list(m$name, "", "",
             if (is.null(w)) "" else round(w$chisq, 3),
             if (is.null(w)) "" else w$df,
             if (is.null(w)) "" else round(w$p, 6), "", ""),
        rep(list(""), length(ci_cols)))))
    }
    for (j in seq_along(idx)) {
      k <- idx[j]
      b <- b_all[k]; se <- se_all[k]
      label <- if (m$categorical) m$labels[j] else m$name
      row <- list(label, round(b, 6), round(se, 6), round((b / se)^2, 3), 1L,
                  round(co[k, "Pr(>|z|)"], 6), round(exp(b), 3))
      if (length(ci_cols) > 0) row <- c(row, list(round(exp(b - z_crit * se), 3),
                                                  round(exp(b + z_crit * se), 3)))
      eq_rows <- c(eq_rows, list(row))
    }
  }

  # ── Omnibus test ───────────────────────────────────────────────────────────
  lr <- sm$logtest                 # test, df, pvalue
  m2ll <- -2 * ll_of(fit)
  tables <- list(
    list(titleKey = "output.cox.omnibusTitle",
         columns = list("output.col.neg2LL", "output.col.chiSquare", "output.col.df",
                        "output.col.sig"),
         rows = list(list(round(m2ll, 3), round(as.numeric(lr["test"]), 3),
                          as.integer(lr["df"]), round(as.numeric(lr["pvalue"]), 6))),
         footnoteKey = NULL))

  # ── Stepwise history ───────────────────────────────────────────────────────
  if (length(steps) > 0) {
    tables <- c(tables, list(list(
      titleKey = "output.cox.stepsTitle",
      columns = list("output.col.step", "output.col.stepAction", "output.col.variable",
                     "output.col.chiSquare", "output.col.df", "output.col.sig"),
      rows = lapply(steps, function(s) list(s$step, s$action, s$term,
                                            round(s$chisq, 3), s$df, round(s$p, 6))),
      footnoteKey = NULL)))
    if (identical(opts$display, "each")) {
      tables <- c(tables, list(list(
        titleKey = "output.cox.stepOmnibusTitle",
        columns = list("output.col.step", "output.col.neg2LL", "output.col.chiSquare",
                       "output.col.df", "output.col.sig"),
        rows = lapply(seq_along(step_fits), function(i) {
          f <- step_fits[[i]]
          s <- summary(f)$logtest
          list(i, round(-2 * ll_of(f), 3), round(as.numeric(s["test"]), 3),
               as.integer(s["df"]), round(as.numeric(s["pvalue"]), 6))
        }),
        footnoteKey = NULL)))
    }
    left_out <- setdiff(all_ids, final_ids)
    if (length(left_out) > 0) {
      tables <- c(tables, list(list(
        titleKey = "output.cox.notInEquationTitle",
        columns = list("output.col.variable", "output.col.chiSquare", "output.col.df",
                       "output.col.sig"),
        rows = lapply(left_out, function(id) {
          r <- lr_between(fit, fit_terms(c(final_ids, id)))
          list(meta_by_id[[id]]$name,
               if (is.null(r)) "" else round(r$chisq, 3),
               if (is.null(r)) "" else r$df,
               if (is.null(r)) "" else round(r$p, 6))
        }),
        footnoteKey = NULL)))
    }
  }

  tables <- c(tables, list(list(
    titleKey = "output.cox.equationTitle",
    columns = c(list("output.col.model", "output.col.b", "output.col.stdError",
                     "output.col.wald", "output.col.df", "output.col.sig",
                     "output.col.expB"), ci_cols),
    rows = eq_rows, footnoteKey = NULL)))

  # Categorical codings change what every coefficient MEANS — an "indicator"
  # B and a "deviation" B on the same data answer different questions — so the
  # coding and its reference category go under the table rather than living
  # only in the dialog the user has since closed.
  for (id in final_ids) {
    m <- meta_by_id[[id]]
    if (!m$categorical) next
    notes <- c(notes, paste0("output.cox.contrastNote:", m$name, "|",
                             paste0("output.cox.contrast.", m$contrast), "|",
                             if (identical(m$reference, "first"))
                               m$levels[1] else m$levels[length(m$levels)]))
  }

  # ── Correlation of estimates ───────────────────────────────────────────────
  if (on_flag(opts$correlation)) {
    labels <- unlist(lapply(final_ids, function(id) meta_by_id[[id]]$labels))
    R <- tryCatch(stats::cov2cor(as.matrix(stats::vcov(fit))), error = function(e) NULL)
    if (!is.null(R)) {
      tables <- c(tables, list(list(
        titleKey = "output.cox.correlationTitle",
        columns = c(list("output.col.variable"), as.list(labels)),
        rows = lapply(seq_len(nrow(R)), function(i)
          c(list(labels[i]), lapply(seq_len(ncol(R)), function(j) round(R[i, j], 3)))),
        footnoteKey = NULL)))
    }
  }

  # ── Covariate reference point for the baseline table and the plots ─────────
  # SPSS's "Covariate Values Plotted at: Mean". For a scale covariate that is
  # the mean; for a categorical one the "mean of the dummies" it implies is not
  # a case that can exist, so the most frequent category is used instead and
  # the note says so — a curve the reader can actually point at.
  plot_values <- plots_opt$values
  #' Which category of a categorical term is the most frequent, as a row index
  #' into its contrast matrix.
  modal_level <- function(m) {
    Z <- as.matrix(dat[, m$cols, drop = FALSE])
    # Recover each case's level by matching its design row against the contrast
    # matrix — the design columns are all that survives into `dat`.
    key <- apply(round(Z, 10), 1, paste, collapse = "|")
    ref <- apply(round(m$contrastMatrix, 10), 1, paste, collapse = "|")
    tab <- table(factor(key, levels = ref))
    which.max(tab)
  }
  #' One row of design-column values: scale covariates at their mean (or the
  #' value the Plots dialog pinned them to), categorical ones at the category
  #' named by `levels_at` — the modal one unless a caller overrides it.
  ref_row <- function(levels_at = list()) {
    nd <- list()
    used_modal <- FALSE
    for (id in final_ids) {
      m <- meta_by_id[[id]]
      if (m$categorical) {
        li <- levels_at[[id]]
        if (is.null(li)) { li <- modal_level(m); used_modal <- TRUE }
        for (j in seq_along(m$cols)) nd[[m$cols[j]]] <- m$contrastMatrix[li, j]
      } else {
        override <- if (is.null(plot_values)) NULL else plot_values[[m$colId]]
        v <- if (is.null(override)) mean(dat[[id]]) else suppressWarnings(as.numeric(override))
        nd[[m$cols[1]]] <- if (is.finite(v)) v else mean(dat[[id]])
      }
    }
    list(nd = nd, modal = used_modal)
  }

  # ── Baseline / survival table ──────────────────────────────────────────────
  if (on_flag(opts$baseline)) {
    rr <- ref_row()
    nd <- as.data.frame(rr$nd, stringsAsFactors = FALSE)
    sf0 <- tryCatch(survival::survfit(fit, newdata = nd), error = function(e) NULL)
    if (is.null(sf0)) {
      warnings <- c(warnings, "output.cox.baselineUnavailable")
    } else {
      st_lab <- if (is.null(sf0$strata)) rep(NA_character_, length(sf0$time))
                else rep(sub("^\\.strat=", "", names(sf0$strata)), sf0$strata)
      surv <- as.numeric(sf0$surv)
      se_surv <- surv * as.numeric(sf0$std.err)
      rows <- lapply(seq_along(sf0$time), function(i)
        c(if (is.null(sf0$strata)) list() else list(st_lab[i]),
          list(round(sf0$time[i], 6), round(-log(surv[i]), 6),
               round(surv[i], 6), round(se_surv[i], 6))))
      tables <- c(tables, list(list(
        titleKey = "output.cox.baselineTitle",
        columns = c(if (is.null(sf0$strata)) list() else list(params$strataName),
                    list("output.col.time", "output.col.cumHazard",
                         "output.col.cumSurvival", "output.col.stdError")),
        rows = rows, footnoteKey = NULL)))
      notes <- c(notes, if (rr$modal) "output.cox.refModalNote" else "output.cox.refMeanNote")
    }
  }

  # ── Proportional hazards test ──────────────────────────────────────────────
  # Not in SPSS's dialogs at all — it makes you eyeball a log-minus-log plot —
  # but proportional hazards is the single assumption the whole model rests on,
  # and CLAUDE.md §11 takes the correct statistic over the SPSS imitation.
  # Scaled Schoenfeld residuals correlated with time (Grambsch & Therneau):
  # a small p means the hazard ratio is not constant over follow-up.
  if (on_flag(opts$phTest)) {
    zph <- tryCatch(survival::cox.zph(fit), error = function(e) NULL)
    if (is.null(zph)) {
      warnings <- c(warnings, "output.cox.phUnavailable")
    } else {
      tb <- zph$table
      rn <- rownames(tb)
      # cox.zph rows are the model's DESIGN columns, so a categorical
      # covariate contributes one row per contrast — labelled "name(1)…" like
      # the equation table, not left as the internal "v2_c1".
      col_labels <- list()
      for (id in final_ids) {
        m <- meta_by_id[[id]]
        for (j in seq_along(m$cols)) col_labels[[m$cols[j]]] <- m$labels[j]
      }
      label_for <- function(nm) {
        if (identical(nm, "GLOBAL")) return("output.col.global")
        lab <- col_labels[[nm]]
        if (is.null(lab)) nm else lab
      }
      tables <- c(tables, list(list(
        titleKey = "output.cox.phTestTitle",
        columns = list("output.col.variable", "output.col.chiSquare", "output.col.df",
                       "output.col.sig"),
        rows = lapply(seq_len(nrow(tb)), function(i)
          list(label_for(rn[i]), round(tb[i, "chisq"], 3), round(tb[i, "df"], 3),
               round(tb[i, "p"], 6))),
        footnoteKey = NULL)))
      notes <- c(notes, "output.cox.phNote")
    }
  }

  # ── Plots ──────────────────────────────────────────────────────────────────
  progress(80L, "progress.computing")
  plots <- list()
  plot_defs <- list(
    list(key = "survival", titleKey = "output.cox.survPlotTitle",
         yTitle = "Cum. Survival", f = function(s) s,
         guard = function(s) rep(TRUE, length(s))),
    list(key = "oneMinusSurvival", titleKey = "output.cox.oneMinusPlotTitle",
         yTitle = "1 - Cum. Survival", f = function(s) 1 - s,
         guard = function(s) rep(TRUE, length(s))),
    list(key = "hazard", titleKey = "output.cox.hazardPlotTitle",
         yTitle = "Cum. Hazard", f = function(s) -log(s),
         guard = function(s) s > 0),
    list(key = "logMinusLog", titleKey = "output.cox.logMinusLogPlotTitle",
         yTitle = "Log minus log", f = function(s) log(-log(s)),
         guard = function(s) s > 0 & s < 1))
  wanted <- Filter(function(d) on_flag(plots_opt[[d$key]]), plot_defs)

  if (length(wanted) > 0) {
    sep <- plots_opt$separateBy
    sep_id <- NULL
    if (!is.null(sep) && nzchar(sep)) {
      hit <- Filter(function(id) identical(meta_by_id[[id]]$colId, sep), final_ids)
      if (length(hit) == 1 && meta_by_id[[hit[[1]]]]$categorical) sep_id <- hit[[1]]
      else warnings <- c(warnings, "output.cox.separateNotCategorical")
    }
    lvls <- if (is.null(sep_id)) NA_character_ else meta_by_id[[sep_id]]$levels
    # The separating variable is set explicitly on each curve, so only the
    # OTHER categorical covariates are held at their modal category — that is
    # what the footnote has to claim.
    held_modal <- any(vapply(final_ids, function(id)
      meta_by_id[[id]]$categorical && !identical(id, sep_id), logical(1)))
    nd <- do.call(rbind, lapply(seq_along(lvls), function(j) {
      r <- if (is.null(sep_id)) ref_row() else ref_row(setNames(list(j), sep_id))
      as.data.frame(r$nd, stringsAsFactors = FALSE)
    }))
    sfp <- tryCatch(survival::survfit(fit, newdata = nd), error = function(e) NULL)
    if (is.null(sfp)) {
      warnings <- c(warnings, "output.cox.plotUnavailable")
    } else {
      surv_m <- as.matrix(sfp$surv)
      # A stratified model has one baseline hazard per stratum, so survfit
      # returns the strata's curves CONCATENATED along $time. Plotting the raw
      # vector would draw a single line that jumps backwards in time at every
      # stratum boundary; each stratum gets its own trace instead.
      seg <- if (is.null(sfp$strata)) list(list(idx = seq_along(sfp$time), label = NULL))
             else {
               ends <- cumsum(sfp$strata)
               starts <- c(1L, head(ends, -1) + 1L)
               lapply(seq_along(ends), function(i) list(
                 idx = starts[i]:ends[i],
                 label = sub("^\\.strat=", "", names(sfp$strata)[i])))
             }
      series_name <- function(j, st_label) {
        base <- if (is.null(sep_id)) "Survival" else
          resolve_var_name(lvls[j], params$categoricalValueLabels[[meta_by_id[[sep_id]]$colId]])
        if (is.null(st_label)) base else paste0(base, " | ", st_label)
      }
      for (d in wanted) {
        traces <- list()
        for (sg in seg) for (j in seq_len(ncol(surv_m))) {
          s <- surv_m[sg$idx, j]
          tt <- sfp$time[sg$idx]
          ok <- d$guard(s)
          traces <- c(traces, list(list(
            type = "scatter", mode = "lines", line = list(shape = "hv"),
            name = series_name(j, sg$label),
            x = as.list(tt[ok]), y = as.list(d$f(s[ok])))))
        }
        plots <- c(plots, list(list(
          titleKey = d$titleKey, type = "plotly",
          data = list(data = traces, layout = list(
            xaxis = list(title = list(text = if (!is.null(params$timeName))
              params$timeName else "Time")),
            yaxis = list(title = list(text = d$yTitle)),
            margin = list(t = 40, r = 20, b = 40, l = 60),
            showlegend = !is.null(sep_id) || length(seg) > 1)))))
      }
      notes <- c(notes, if (held_modal) "output.cox.refModalNote" else "output.cox.refMeanNote")
    }
  }

  # Tie handling is a modelling choice, and it moves -2LL, the LR chi-square and
  # the coefficients — small, but enough to make two packages disagree in the
  # third decimal on the same data. Say which one produced these numbers instead
  # of leaving the user to work it out from a difference. coxph() defaults to
  # Efron's correction, the more accurate one when ties are present (CLAUDE.md
  # §11 takes R's default where it is the better statistic).
  #
  # Only when the data actually has tied event times: with no ties every
  # correction gives identical results and the note would be noise.
  # Distinct event times shared by more than one case — which is what the note
  # says. duplicated() alone counts the extra cases, a different number.
  ev_times <- dat$.time[dat$.status == 1]
  n_tied <- length(unique(ev_times[duplicated(ev_times)]))
  if (n_tied > 0) notes <- c(notes, paste0("output.cox.tiesEfronNote:", n_tied))
  if (!is.null(fit$nevent) && fit$nevent < 10 * n_coef_full) {
    warnings <- c(warnings, paste0("output.cox.epvWarn:", fit$nevent, "|", n_coef_full))
  }

  # ── New variables (NV1) ────────────────────────────────────────────────────
  # Per-case model output as dataset columns. Computed from `fit` (the model
  # actually reported, so a stepwise run saves the FINAL model's values) over
  # `dat`, which still carries __row_idx — cases dropped by listwise deletion
  # simply get no value and stay empty in Data View.
  case_vars <- list()
  want <- requested_new_vars(params)
  if (length(want) > 0) {
    # type="expected" is the expected event count under the model, i.e. the
    # cumulative hazard H_i at that case's own follow-up time; survival is
    # exp(-H) and SPSS's log-minus-log is log(H) exactly.
    cumhaz <- suppressWarnings(as.numeric(stats::predict(fit, type = "expected")))
    lp <- suppressWarnings(as.numeric(stats::predict(fit, type = "lp")))
    add <- function(key, values, decimals = 4) {
      if (!is.null(want[[key]])) {
        case_vars[[length(case_vars) + 1L]] <<-
          sai_case_var(want[[key]], values, dat,
                       labelKey = paste0("output.cox.newVar.", key), decimals = decimals)
      }
    }
    add("survival", exp(-cumhaz))
    add("hazard", cumhaz)
    add("lml", log(cumhaz))
    add("xbeta", lp)

    # One column PER COEFFICIENT, so the name the user typed is a STEM that
    # gets 1, 2, 3… appended. These were left out of the first pass precisely
    # because a single name field cannot express that.
    coef_names <- names(stats::coef(fit))
    add_per_coef <- function(key, mat, labelKey) {
      stem <- want[[key]]
      if (is.null(stem) || is.null(mat)) return(invisible(NULL))
      m <- as.matrix(mat)
      for (j in seq_len(min(ncol(m), length(coef_names)))) {
        case_vars[[length(case_vars) + 1L]] <<- sai_case_var(
          paste0(stem, j), m[, j], dat,
          labelKey = paste0(labelKey, ":", coef_names[j]), decimals = 6)
      }
    }
    # DfBeta: how much each coefficient MOVES when the case is dropped — the
    # per-case influence measure, one number per coefficient per case.
    add_per_coef("dfbeta", stats::residuals(fit, type = "dfbeta"),
                 "output.cox.newVar.dfbeta")
    # Schoenfeld residuals exist only for the EVENTS, not for censored cases,
    # so this column is legitimately empty on every censored row — the same
    # honest blank a listwise-dropped case gets.
    #
    # Mapping them back is the delicate part: residuals(type="schoenfeld")
    # returns ONE ROW PER EVENT ordered by event time (within stratum), and its
    # row names are the event TIMES, not case identifiers — matching on them
    # produces NAs, which is how this first went wrong. The order is
    # reconstructed instead, and then VERIFIED against those times; if the
    # check fails the column is skipped rather than written misaligned, since a
    # silently shuffled influence column is worse than an absent one.
    if (!is.null(want[["schoenfeld"]])) {
      schoen <- tryCatch(stats::residuals(fit, type = "schoenfeld"),
                         error = function(e) NULL)
      sm <- if (is.null(schoen)) NULL else as.matrix(schoen)
      ev_rows <- which(dat$.status == 1)
      ord <- if (has_strata) {
        ev_rows[order(as.integer(factor(dat$.strat[ev_rows])), dat$.time[ev_rows])]
      } else {
        ev_rows[order(dat$.time[ev_rows])]
      }
      aligned <- !is.null(sm) && nrow(sm) == length(ord) &&
        isTRUE(all.equal(as.numeric(rownames(sm)), unname(dat$.time[ord]),
                         tolerance = 1e-8))
      if (aligned) {
        for (j in seq_len(min(ncol(sm), length(coef_names)))) {
          vals <- rep(NA_real_, nrow(dat))
          vals[ord] <- sm[, j]
          case_vars[[length(case_vars) + 1L]] <- sai_case_var(
            paste0(want[["schoenfeld"]], j), vals, dat,
            labelKey = paste0("output.cox.newVar.schoenfeld:", coef_names[j]), decimals = 6)
        }
      } else {
        warnings <- c(warnings, "output.cox.schoenfeldNotAligned")
      }
    }
  }

  progress(100L, "progress.done")
  sai_output(tables = tables, plots = plots, notes = unique(notes), warnings = warnings,
             caseVars = case_vars)
}, error = function(e) sai_error(conditionMessage(e)))
