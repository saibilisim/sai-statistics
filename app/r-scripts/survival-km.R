# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# survival-km.R — Kaplan-Meier survival analysis (SPSS-style).
#
# Params: timeVar, timeName, statusVar, statusName, eventValue, factor (opt),
#         factorName, factorValueLabels, strata (opt), strataName,
#         strataValueLabels,
#         options$compare = { logRank, breslow, taroneWare, mode }
#         options$stats   = { survivalTable, meanMedian, quartiles }
#         options$plots   = { survival, oneMinusSurvival, hazard, logSurvival }
# Output: "Case Processing Summary", optional "Survival Table",
#         "Means and Medians for Survival Time", optional "Percentiles",
#         "Overall Comparisons" / "Pairwise Comparisons" (weighted log-rank
#         family), + the requested plots.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

# ── Weighted log-rank family ──────────────────────────────────────────────────
# SPSS's Compare Factor dialog offers three tests that differ only in how each
# event time is weighted in the score statistic:
#
#   Log rank     w_j = 1            equal weight everywhere
#   Breslow      w_j = n_j          weights early times (Gehan-Wilcoxon)
#   Tarone-Ware  w_j = sqrt(n_j)    the compromise between the two
#
# survival::survdiff cannot produce Breslow/Tarone-Ware: its `rho` selects the
# Fleming-Harrington G-rho family (rho = 1 is Peto-Peto, NOT Gehan-Breslow),
# and there is no at-risk-count weighting in it at all. The `coin` package can,
# but it is an on-demand optional install here (setup.R), so a core SPSS
# comparison would silently disappear on most machines.
#
# So the k-sample score statistic is computed directly from the risk sets. This
# is not the "hand-rolled permutation algorithm" CLAUDE.md §11 warns against —
# it is the closed-form multivariate-hypergeometric score test every one of
# these tests is defined as, and the log-rank case is cross-checked against
# survdiff() in tests/r-validation/test-survival.R, which pins all of it.
#
#   U_i = Σ_j w_j (d_ij − d_j·n_ij/n_j)
#   V   = Σ_j w_j²·d_j(n_j−d_j)/(n_j−1) · (diag(p_j) − p_j p_j'),  p_j = n_j·/n_j
#   χ²  = U'V⁻U on k−1 df (last group dropped for a full-rank V)
#
# Strata enter by summing U and V over strata (the stratified test) — exactly
# SPSS's "Pooled over strata".
sai_weighted_logrank <- function(time, status, grp, strata = NULL, type = "logrank") {
  g <- levels(grp)
  k <- length(g)
  if (k < 2) return(NULL)
  st <- if (is.null(strata)) factor(rep("1", length(time))) else factor(strata)

  U <- numeric(k)
  V <- matrix(0, k, k)
  for (s in levels(st)) {
    ss <- st == s
    ti <- time[ss]; di <- status[ss]; gi <- as.character(grp[ss])
    ev_times <- sort(unique(ti[di == 1]))
    for (tt in ev_times) {
      at_risk <- ti >= tt
      nj <- sum(at_risk)
      dj <- sum(di == 1 & ti == tt)
      # n_j = 1 makes the hypergeometric variance 0/0; the term contributes
      # nothing to either sum, so skipping it is exact, not an approximation.
      if (nj <= 1 || dj == 0) next
      w <- switch(type, logrank = 1, breslow = nj, taroneWare = sqrt(nj),
                  stop("unknown weight type"))
      nij <- vapply(g, function(l) sum(at_risk & gi == l), numeric(1))
      dij <- vapply(g, function(l) sum(di == 1 & ti == tt & gi == l), numeric(1))
      p <- nij / nj
      U <- U + w * (dij - dj * p)
      V <- V + (w^2 * dj * (nj - dj) / (nj - 1)) * (diag(p, nrow = k) - outer(p, p))
    }
  }

  idx <- seq_len(k - 1)
  Ur <- U[idx]
  Vr <- V[idx, idx, drop = FALSE]
  # A group with no one ever at risk alongside the others leaves V singular;
  # the generalized inverse then gives the test on the rank it actually has,
  # which is the honest df — silently reporting k−1 would inflate nothing but
  # would understate the p-value.
  inv <- tryCatch(list(m = solve(Vr), df = length(idx)), error = function(e) NULL)
  if (is.null(inv)) {
    if (!requireNamespace("MASS", quietly = TRUE)) return(NULL)
    r <- qr(Vr)$rank
    if (r == 0) return(NULL)
    inv <- list(m = MASS::ginv(Vr), df = r)
  }
  chi <- as.numeric(t(Ur) %*% inv$m %*% Ur)
  if (!is.finite(chi) || chi < 0) return(NULL)
  list(chisq = chi, df = inv$df,
       p = stats::pchisq(chi, inv$df, lower.tail = FALSE))
}

#' The p-th percentile of a KM curve: the SMALLEST observed time at which the
#' survival estimate has fallen to 1−p. Same textbook rule the median uses (see
#' the long note where km_quantile is called) — survfit()'s own `median`
#' column returns an interval MIDPOINT when S(t) sits exactly on the level,
#' which need not be a time anything happened at.
km_quantile <- function(times, surv, p) {
  hit <- which(surv <= 1 - p)
  if (length(hit) == 0) return(NA_real_)
  times[hit[1]]
}

tryCatch({
  progress(10L, "progress.loading")
  if (!requireNamespace("survival", quietly = TRUE)) {
    sai_output(tables = list(), warnings = "output.survival.needsPackage"); quit(save = "no")
  }
  tv <- params$timeVar; stv <- params$statusVar
  ev <- as.character(params$eventValue)
  fv <- params$factor
  fname <- if (is.null(params$factorName)) fv else params$factorName
  sv <- params$strata
  sname <- if (is.null(params$strataName)) sv else params$strataName
  opts <- params$options
  cmp <- opts$compare
  stats_opt <- opts$stats
  plots_opt <- opts$plots
  on_flag <- function(x, default = FALSE) if (is.null(x)) default else isTRUE(x)

  if (is.null(tv) || !tv %in% names(df)) sai_error("Time variable not found")
  if (is.null(stv) || !stv %in% names(df)) sai_error("Status variable not found")

  time <- suppressWarnings(as.numeric(apply_user_missing(df[[tv]], tv, params)))
  status_raw <- apply_user_missing(df[[stv]], stv, params)
  status <- as.integer(as.character(status_raw) == ev)
  has_f <- !is.null(fv) && fv %in% names(df)
  has_s <- !is.null(sv) && sv %in% names(df)
  grp <- if (has_f) as.character(apply_user_missing(df[[fv]], fv, params)) else rep("1", length(time))
  strat <- if (has_s) as.character(apply_user_missing(df[[sv]], sv, params)) else rep("1", length(time))

  keep <- !is.na(time) & !is.na(status) & !is.na(grp) & !is.na(strat)
  # Kept alongside the analysis vectors so any new variable this run creates
  # knows which dataset rows survived the listwise deletion (NV1).
  row_idx <- row_index_of(df)[keep]
  time <- time[keep]; status <- status[keep]
  grp <- factor(grp[keep]); strat <- factor(strat[keep])
  if (length(time) == 0) sai_error("No complete cases for the survival analysis")

  grp_label <- function(lvl) if (has_f) resolve_var_name(lvl, params$factorValueLabels) else "output.col.total"
  strat_label <- function(lvl) if (has_s) resolve_var_name(lvl, params$strataValueLabels) else lvl

  Surv <- survival::Surv(time, status)
  fit  <- survival::survfit(Surv ~ grp)
  strata_n <- if (is.null(fit$strata)) length(fit$time) else fit$strata
  starts <- cumsum(c(0, head(strata_n, -1)))
  grp_rows <- function(i) starts[i] + seq_len(strata_n[i])

  # ── Case Processing Summary ────────────────────────────────────────────────
  cps_rows <- list()
  for (lvl in levels(grp)) {
    idx <- grp == lvl; ntot <- sum(idx); nev <- sum(status[idx]); ncen <- ntot - nev
    cps_rows <- c(cps_rows, list(list(
      grp_label(lvl), ntot, nev, ncen, round(100 * ncen / ntot, 1))))
  }
  if (has_f) cps_rows <- c(cps_rows, list(list(
    "output.col.total", length(time), sum(status), length(time) - sum(status),
    round(100 * (length(time) - sum(status)) / length(time), 1))))

  tables <- list(
    list(titleKey = "output.survival.cpsTitle",
         columns = list(if (has_f) fname else "output.col.group", "output.col.nTotal",
                        "output.col.nEvents", "output.col.nCensored", "output.col.pctCensored"),
         rows = cps_rows, footnoteKey = NULL))
  notes <- character(0)
  warnings <- character(0)

  # ── Survival Table (per case, SPSS's own layout) ───────────────────────────
  if (on_flag(stats_opt$survivalTable)) {
    progress(30L, "progress.computing")
    surv_rows <- list()
    truncated <- FALSE
    # The table is one row per CASE, which is what makes it useful (a reader
    # follows individual censorings) and also what makes it unbounded. A big
    # dataset would push tens of thousands of rows through IPC into a plain
    # HTML <table>; cap it and say so rather than freezing the Output view.
    row_budget <- 5000L
    for (i in seq_along(levels(grp))) {
      lvl <- levels(grp)[i]
      idx <- which(grp == lvl)
      ord <- idx[order(time[idx], -status[idx])]
      # KM estimate + Greenwood SE, looked up per event time from the fit.
      rows_i <- grp_rows(i)
      ft <- fit$time[rows_i]; fs <- fit$surv[rows_i]
      # survfit's $std.err is the SE of the CUMULATIVE HAZARD (i.e. of log S),
      # so the SE of S itself — the "Std. Error" column SPSS prints beside the
      # estimate — is S × std.err. Using std.err directly here would report a
      # number several times too large near the tail.
      fse <- fs * fit$std.err[rows_i]
      cum_ev <- 0L
      n_left <- length(ord)
      for (j in seq_along(ord)) {
        if (length(surv_rows) >= row_budget) { truncated <- TRUE; break }
        cs <- ord[j]
        n_left <- n_left - 1L
        if (status[cs] == 1) cum_ev <- cum_ev + 1L
        # SPSS prints the estimate once per distinct event time, on the LAST
        # of the tied cases — blank on censored rows and on the earlier ties.
        last_of_tie <- j == length(ord) || time[ord[j + 1]] != time[cs] ||
          status[ord[j + 1]] != status[cs]
        show_est <- status[cs] == 1 && last_of_tie
        k <- if (show_est) which(abs(ft - time[cs]) < 1e-9)[1] else NA_integer_
        surv_rows <- c(surv_rows, list(list(
          grp_label(lvl), j, round(time[cs], 6),
          if (status[cs] == 1) "output.col.event" else "output.col.censored",
          if (!is.na(k)) round(fs[k], 6) else "",
          if (!is.na(k)) round(fse[k], 6) else "",
          cum_ev, n_left)))
      }
      if (truncated) break
    }
    if (truncated) warnings <- c(warnings, "output.survival.tableTruncated")
    tables <- c(tables, list(list(
      titleKey = "output.survival.tableTitle",
      columns = list(if (has_f) fname else "output.col.group", "output.col.case",
                     "output.col.time", "output.col.status", "output.col.cumSurvival",
                     "output.col.stdError", "output.col.cumEvents", "output.col.nRemaining"),
      rows = surv_rows, footnoteKey = NULL)))
  }

  # ── Means and Medians for Survival Time ────────────────────────────────────
  # The median is the SMALLEST time at which the survival estimate reaches 0.5
  # — the textbook Kaplan-Meier median, and SPSS's. survfit()'s own `median`
  # column does not use that rule: when S(t) is exactly 0.5 across an interval
  # it returns the interval's MIDPOINT, which need not be an observed time at
  # all. On the parity fixture S(13.26) = 0.5 exactly and the next event is at
  # 13.94, so survfit reported 13.60 — a time nothing happened at — where SPSS
  # reports 13.26. Recomputed from the curve instead; the confidence limits
  # still come from survfit (see the note in tests/spss-parity/README.md on why
  # they legitimately differ from SPSS's median ± 1.96·SE).
  if (on_flag(stats_opt$meanMedian, TRUE)) {
    # rmean = "individual" restricts each group's mean to its OWN largest
    # observed time — the restriction SPSS's "Estimation is limited to the
    # largest survival time if it is censored" footnote describes. The
    # alternative ("common") would restrict every group to the same horizon and
    # quietly change the per-group means.
    smry <- summary(fit, rmean = "individual")$table
    if (is.null(dim(smry))) smry <- t(as.matrix(smry))
    # survival has printed the restricted-mean columns under both "rmean" and
    # "*rmean" across versions (the asterisk marks the restriction). Match on
    # the substring so a runtime upgrade cannot turn the Mean columns blank.
    col_rmean <- grep("rmean", colnames(smry), fixed = TRUE)
    i_mean <- col_rmean[!grepl("se(", colnames(smry)[col_rmean], fixed = TRUE)][1]
    i_se   <- col_rmean[grepl("se(", colnames(smry)[col_rmean], fixed = TRUE)][1]
    med_rows <- list()
    for (i in seq_len(nrow(smry))) {
      idx <- grp_rows(i)
      med <- km_quantile(fit$time[idx], fit$surv[idx], 0.5)
      lcl <- smry[i, "0.95LCL"]; ucl <- smry[i, "0.95UCL"]
      rmean    <- if (is.na(i_mean)) NA_real_ else smry[i, i_mean]
      rmean_se <- if (is.na(i_se))   NA_real_ else smry[i, i_se]
      num <- function(x) if (is.na(x)) "" else round(x, 3)
      med_rows <- c(med_rows, list(list(
        grp_label(levels(grp)[i]),
        num(rmean), num(rmean_se),
        num(rmean - 1.96 * rmean_se), num(rmean + 1.96 * rmean_se),
        num(med), num(lcl), num(ucl))))
    }
    tables <- c(tables, list(list(
      titleKey = "output.survival.medianTitle",
      columns = list(if (has_f) fname else "output.col.group",
                     "output.col.meanEst", "output.col.stdError",
                     "output.col.meanCiLower", "output.col.meanCiUpper",
                     "output.col.medianEst", "output.col.ciLower95", "output.col.ciUpper95"),
      rows = med_rows, footnoteKey = NULL)))
    # Both the median and its interval are construction choices, and the
    # interval is the one that visibly differs between implementations:
    # inverting the confidence band for S(t) and the linear median ± 1.96·SE
    # can land well apart in a censored tail. State the construction under the
    # table so a user comparing two outputs can see which one they look at.
    notes <- c(notes, "output.survival.medianCiNote", "output.survival.meanRestrictedNote")
  }

  # ── Percentiles (SPSS's Quartiles checkbox) ────────────────────────────────
  if (on_flag(stats_opt$quartiles)) {
    q_rows <- list()
    # quantile.survfit supplies the confidence limits (the same band inversion
    # the median's limits come from); the point estimates keep km_quantile's
    # rule so the 50% row cannot disagree with the median printed above.
    qs <- tryCatch(stats::quantile(fit, probs = c(0.25, 0.5, 0.75), conf.int = TRUE),
                   error = function(e) NULL)
    for (i in seq_along(levels(grp))) {
      idx <- grp_rows(i)
      pick <- function(m, j) {
        if (is.null(qs) || is.null(m)) return(NA_real_)
        v <- if (is.matrix(m)) m[i, j] else m[j]
        if (is.null(v)) NA_real_ else v
      }
      row <- list(grp_label(levels(grp)[i]))
      for (j in seq_along(c(0.25, 0.5, 0.75))) {
        p <- c(0.25, 0.5, 0.75)[j]
        est <- km_quantile(fit$time[idx], fit$surv[idx], p)
        lo <- pick(qs$lower, j); hi <- pick(qs$upper, j)
        row <- c(row, list(if (is.na(est)) "" else round(est, 3),
                           if (is.na(lo)) "" else round(lo, 3),
                           if (is.na(hi)) "" else round(hi, 3)))
      }
      q_rows <- c(q_rows, list(row))
    }
    tables <- c(tables, list(list(
      titleKey = "output.survival.percentilesTitle",
      columns = list(if (has_f) fname else "output.col.group",
                     "output.col.p25", "output.col.p25Lower", "output.col.p25Upper",
                     "output.col.median", "output.col.medianLower", "output.col.medianUpper",
                     "output.col.p75", "output.col.p75Lower", "output.col.p75Upper"),
      rows = q_rows, footnoteKey = NULL)))
  }

  # ── Comparisons ────────────────────────────────────────────────────────────
  progress(60L, "progress.computing")
  if (has_f && nlevels(grp) >= 2) {
    active <- c(
      if (on_flag(cmp$logRank, TRUE)) "logrank",
      if (on_flag(cmp$breslow)) "breslow",
      if (on_flag(cmp$taroneWare)) "taroneWare")
    if (length(active) == 0) active <- "logrank"
    mode <- if (is.null(cmp$mode)) "pooled" else cmp$mode
    if (!has_s && mode %in% c("perStratum", "pairwisePerStratum")) {
      # "For each stratum" without a stratum variable is not a different test,
      # it is the same one — say so instead of printing a table labelled as
      # something it isn't.
      mode <- if (mode == "perStratum") "pooled" else "pairwise"
      warnings <- c(warnings, "output.survival.noStrataForMode")
    }
    if (mode == "pairwisePooled") mode <- "pairwise"

    test_key <- c(logrank = "output.col.logRank", breslow = "output.col.breslow",
                  taroneWare = "output.col.taroneWare")
    fmt <- function(r) if (is.null(r)) list("", "", "") else
      list(round(r$chisq, 3), r$df, round(r$p, 6))

    if (mode %in% c("pooled", "perStratum")) {
      rows <- list()
      strata_iter <- if (mode == "perStratum") levels(strat) else NA
      for (s in strata_iter) {
        sel <- if (is.na(s)) rep(TRUE, length(time)) else strat == s
        gsub_f <- droplevels(grp[sel])
        for (ty in active) {
          r <- if (nlevels(gsub_f) < 2) NULL else sai_weighted_logrank(
            time[sel], status[sel], gsub_f,
            if (mode == "pooled" && has_s) strat[sel] else NULL, ty)
          row <- c(if (mode == "perStratum") list(strat_label(s)) else list(),
                   list(test_key[[ty]]), fmt(r))
          rows <- c(rows, list(row))
        }
      }
      tables <- c(tables, list(list(
        titleKey = if (mode == "perStratum") "output.survival.logrankPerStratumTitle"
                   else "output.survival.logrankTitle",
        columns = c(if (mode == "perStratum") list(sname) else list(),
                    list("output.col.statistic", "output.col.chiSquare", "output.col.df",
                         "output.col.sig")),
        rows = rows, footnoteKey = NULL)))
    } else {
      lv <- levels(grp)
      rows <- list()
      strata_iter <- if (mode == "pairwisePerStratum") levels(strat) else NA
      for (s in strata_iter) {
        sel_s <- if (is.na(s)) rep(TRUE, length(time)) else strat == s
        for (a in seq_len(length(lv) - 1)) for (b in (a + 1):length(lv)) {
          sel <- sel_s & grp %in% c(lv[a], lv[b])
          gsub_f <- droplevels(grp[sel])
          for (ty in active) {
            r <- if (nlevels(gsub_f) < 2) NULL else sai_weighted_logrank(
              time[sel], status[sel], gsub_f,
              if (mode == "pairwise" && has_s) strat[sel] else NULL, ty)
            row <- c(if (mode == "pairwisePerStratum") list(strat_label(s)) else list(),
                     list(grp_label(lv[a]), grp_label(lv[b]), test_key[[ty]]), fmt(r))
            rows <- c(rows, list(row))
          }
        }
      }
      tables <- c(tables, list(list(
        titleKey = "output.survival.pairwiseTitle",
        columns = c(if (mode == "pairwisePerStratum") list(sname) else list(),
                    list("output.col.groupI", "output.col.groupJ", "output.col.statistic",
                         "output.col.chiSquare", "output.col.df", "output.col.sig")),
        rows = rows, footnoteKey = NULL)))
      # Pairwise here means "the same two-sample test run on each pair", which
      # is what SPSS's dialog produces and what it does NOT adjust for. Saying
      # so is the difference between a reader treating .04 as significant or as
      # one of six chances to see .04.
      notes <- c(notes, "output.survival.pairwiseNoAdjustNote")
    }
  }

  # ── Plots ──────────────────────────────────────────────────────────────────
  progress(85L, "progress.computing")
  sf <- summary(fit)
  sf_strata <- if (is.null(sf$strata)) rep(levels(grp)[1], length(sf$time)) else as.character(sf$strata)
  # Every plot is the same step curve under a different transform of S(t);
  # `guard` drops the points a transform is undefined at (log 0, log(−log 1))
  # rather than emitting Inf/NaN, which Plotly renders as a gap anyway but
  # jsonlite cannot serialise.
  #
  # Axis titles are plain strings, not i18n keys: OutputPlotView passes a
  # plot's `layout` straight to Plotly and only translates `titleKey`, so a key
  # here would render literally as "output.survival.axisSurvival". Same
  # convention as every other plotting script (chart.R, roc-analysis.R, …) —
  # translating Plotly layouts is a cross-cutting change, not this one's.
  x_title <- if (!is.null(params$timeName)) params$timeName else "Time"
  plot_defs <- list(
    list(key = "survival", titleKey = "output.survival.kmPlotTitle",
         yTitle = "Cum. Survival", f = function(s) s,
         guard = function(s) rep(TRUE, length(s)), y0 = 1, range = list(0, 1)),
    list(key = "oneMinusSurvival", titleKey = "output.survival.oneMinusPlotTitle",
         yTitle = "1 - Cum. Survival", f = function(s) 1 - s,
         guard = function(s) rep(TRUE, length(s)), y0 = 0, range = list(0, 1)),
    list(key = "hazard", titleKey = "output.survival.hazardPlotTitle",
         yTitle = "Cum. Hazard", f = function(s) -log(s),
         guard = function(s) s > 0, y0 = 0, range = NULL),
    list(key = "logSurvival", titleKey = "output.survival.logPlotTitle",
         yTitle = "Log Survival", f = function(s) log(s),
         guard = function(s) s > 0, y0 = 0, range = NULL))

  wanted <- Filter(function(d) on_flag(plots_opt[[d$key]], d$key == "survival"), plot_defs)
  plots <- list()
  for (d in wanted) {
    traces <- list()
    for (lvl in unique(sf_strata)) {
      idx <- sf_strata == lvl
      nm <- sub("^grp=", "", lvl)
      ok <- d$guard(sf$surv[idx])
      xs <- sf$time[idx][ok]; ys <- d$f(sf$surv[idx][ok])
      traces <- c(traces, list(list(
        type = "scatter", mode = "lines", line = list(shape = "hv"),
        name = if (has_f) resolve_var_name(nm, params$factorValueLabels) else "Survival",
        x = as.list(c(0, xs)), y = as.list(c(d$y0, ys)))))
    }
    yaxis <- list(title = list(text = d$yTitle))
    if (!is.null(d$range)) yaxis$range <- d$range
    plots <- c(plots, list(list(
      titleKey = d$titleKey, type = "plotly",
      data = list(data = traces,
                  layout = list(xaxis = list(title = list(text = x_title)),
                                yaxis = yaxis,
                                margin = list(t = 40, r = 20, b = 40, l = 60),
                                showlegend = has_f)))))
  }

  # ── New variables (NV1) ────────────────────────────────────────────────────
  # Each case gets its OWN group's curve evaluated at its OWN follow-up time —
  # that is what makes these useful as columns rather than a copy of the table.
  case_vars <- list()
  want <- requested_new_vars(params)
  if (length(want) > 0) {
    n_case <- length(time)
    v_surv <- rep(NA_real_, n_case); v_se <- rep(NA_real_, n_case)
    v_haz <- rep(NA_real_, n_case); v_events <- rep(NA_real_, n_case)
    for (i in seq_along(levels(grp))) {
      r <- grp_rows(i)
      ft <- fit$time[r]; fs <- fit$surv[r]
      # survfit stores std.err as the SE of the CUMULATIVE HAZARD, so the SE of
      # the survival estimate is S * std.err (same conversion the survival
      # table above uses — kept identical on purpose).
      fse <- fs * fit$std.err[r]
      fev <- cumsum(fit$n.event[r])
      in_g <- which(grp == levels(grp)[i])
      # findInterval gives the last event/censor time at or before t; 0 means
      # the case is earlier than any of them, where S is still 1 by definition.
      j <- findInterval(time[in_g], ft)
      v_surv[in_g] <- ifelse(j == 0, 1, fs[pmax(j, 1)])
      v_se[in_g] <- ifelse(j == 0, 0, fse[pmax(j, 1)])
      v_events[in_g] <- ifelse(j == 0, 0, fev[pmax(j, 1)])
    }
    v_haz <- -log(v_surv)
    case_df <- data.frame(.i = seq_len(n_case))
    case_df[["__row_idx"]] <- row_idx
    add <- function(key, values, decimals = 4) {
      if (!is.null(want[[key]])) {
        case_vars[[length(case_vars) + 1L]] <<-
          sai_case_var(want[[key]], values, case_df,
                       labelKey = paste0("output.survival.newVar.", key), decimals = decimals)
      }
    }
    add("survival", v_surv)
    add("se", v_se)
    add("hazard", v_haz)
    add("cumEvents", v_events, decimals = 0)
  }

  progress(100L, "progress.done")
  sai_output(tables = tables, notes = notes, warnings = warnings, plots = plots,
             caseVars = case_vars)
}, error = function(e) sai_error(conditionMessage(e)))
