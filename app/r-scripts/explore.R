# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# explore.R — Explore analysis (SPSS-style).
#
# Params (from JSON):
#   parquetPath  — path to the exported Parquet dataset
#   rScriptsDir  — directory containing _bootstrap.R
#   variables    — character vector of dependent colIds
#   varNames     — named list colId → display name
#   factors      — character vector of factor (grouping) colIds (may be empty)
#   factorNames  — named list colId → display name
#   options      — named list:
#     display    — "both" | "statistics" | "plots"
#     missing    — "analysis" (default) | "listwise" — SPSS's Options radio
#     bootstrap  — BOOT1 sub-dialog params; bootstraps the mean per dependent ×
#                  group, same sai_bootstrap() pattern as descriptives.R
#     stats      — { descriptives, percentiles, mEstimators, outliers }
#     plots      — { boxplot, histogram, normality }
#
# Output: per dependent (× factor group) a Descriptives table; per dependent a
#         Percentiles / M-Estimators / Extreme Values table (when requested), a
#         Tests of Normality table (Kolmogorov-Smirnov w/ Lilliefors correction
#         + Shapiro-Wilk, same formulas as normality.R) and a grouped
#         boxplot/histogram.

suppressPackageStartupMessages(library(jsonlite))

.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(
  paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
  simplifyVector = FALSE
)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))

params <- read_params()
df     <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")

  variables   <- unlist(params$variables)
  var_names   <- params$varNames
  factors     <- if (is.null(params$factors)) character(0) else unlist(params$factors)
  factor_names <- params$factorNames
  # colId -> (raw code -> value label) map, same shape/origin as chart.R's
  # groupValueLabels — Explore's factor levels are raw codes (e.g. "1"/"2")
  # unless resolved through this, so the boxplot legend, Percentiles/
  # M-Estimators/Normality/Extreme Values rows and the Case Processing
  # Summary would all show codes instead of labels (Graphs > Boxplot does
  # this resolution for its group variable; Explore did not).
  factor_value_labels <- if (is.null(params$factorValueLabels)) list() else params$factorValueLabels
  label_by    <- if (is.null(params$labelBy) || !nzchar(params$labelBy)) NULL else params$labelBy
  label_name  <- if (is.null(params$labelByName)) label_by else params$labelByName
  opts        <- params$options
  display     <- if (is.null(opts$display)) "both" else opts$display
  stats_opts  <- if (is.null(opts$stats)) list() else opts$stats
  plots_opts  <- if (is.null(opts$plots)) list() else opts$plots

  show_stats <- display == "both" || display == "statistics"
  show_plots <- display == "both" || display == "plots"

  BAR_COLOR <- "#3b6ea5"
  SOFT_PALETTE <- c(
    "#4C78A8",  # Soft Steel Blue
    "#72B7B2",  # Soft Sage / Teal
    "#E45756",  # Soft Coral
    "#F58518",  # Soft Amber / Peach
    "#54A24B",  # Soft Mint Green
    "#EECA3B",  # Soft Honey
    "#B279A2",  # Soft Lavender / Purple
    "#FF9DA6",  # Soft Rose / Pink
    "#9D755D",  # Soft Warm Taupe
    "#79706E"   # Soft Slate
  )

  if (length(variables) == 0) {
    sai_error("No dependent variables specified for explore analysis")
  }

  # SPSS's Extreme Values table identifies rows by their position in the data
  # file, so the case number has to be captured BEFORE any row filtering
  # (listwise deletion below, per-group/per-variable !is.na() selection later)
  # renumbers the frame.
  df$.sai_case <- seq_len(nrow(df))
  if (!is.null(label_by)) {
    if (!(label_by %in% names(df))) sai_error(paste("Label Cases by column not found:", label_by))
    df$.sai_case_label <- as.character(df[[label_by]])
  } else {
    df$.sai_case_label <- NULL
  }

  # Missing Values (MV1/MV2): SPSS EXAMINE's default IS listwise across
  # dependents + factors — verified against SPSS 26 (job-missing.sps: the run
  # without /MISSING and the /MISSING=LISTWISE run produced identical tables).
  # Only an explicit "analysis" opts out into per-variable exclusion, which is
  # a beyond-SPSS mode the dialog still offers.
  if (is.null(params$options$missing)) params$options$missing <- "listwise"
  # The Case Processing Summary counts against the frame BEFORE deletion: SPSS
  # reports a listwise-dropped case as Missing, not as absent (a factor level of
  # 40 with 4 dropped reads 36 valid / 4 missing / 40 total). Counting on the
  # filtered frame produced "36 valid / 0 missing / 36 total" and hid the very
  # exclusion the table exists to make visible.
  df_pre <- df
  df <- apply_listwise(df, c(variables, factors), params)

  # Weight Cases (W1): only the Descriptives table (n/mean/CI/median/variance/
  # sd/IQR/skewness/kurtosis) is weighted — Shapiro-Wilk normality, boxplot,
  # histogram and Q-Q plot stay unweighted (rank/order-based or purely visual;
  # see release plan's "hard" category) and get an explicit note below instead
  # of relying on the generic sai_output() auto-warning (which only fires when
  # NOTHING in the script consumed the weight — not the case here).
  .gw <- get_weights(df, params)
  df  <- .gw$df
  w   <- .gw$w
  weight_note_needed <- FALSE

  # Same weight filter on the pre-deletion frame, so the CPS totals are on the
  # same footing as the statistics (SPSS drops non-positive weights outright).
  w_pre <- NULL
  if (!is.null(w)) {
    w_pre_all <- suppressWarnings(as.numeric(df_pre[[params$weightVariable]]))
    keep_pre  <- !is.na(w_pre_all) & w_pre_all > 0
    df_pre    <- df_pre[keep_pre, , drop = FALSE]
    w_pre     <- w_pre_all[keep_pre]
  }

  # ── M-Estimators (SPSS EXAMINE /MESTIMATORS) ────────────────────────────────
  # Robust estimators of location: each down-weights outliers with its own psi
  # function instead of discarding them. Weight functions come from MASS
  # (psi.huber/psi.bisquare/psi.hampel), so only Andrews' wave needs one of our
  # own (CLAUDE.md §5: use the package when one matches). Weighting constants
  # are SPSS's, not MASS's defaults (which differ for Huber and Hampel).
  #
  # MASS psi convention: deriv = 0 returns the WEIGHT psi(u)/u normalised to 1
  # at u = 0; deriv = 1 returns psi'(u) under the same normalisation.
  #
  # Andrews' wave with SPSS's constant a = 1.34: psi(u) = sin(u/a) on
  # |u| <= a*pi and 0 beyond, so the weight is sin(u/a)/(u/a) and the
  # derivative cos(u/a). Note the wave argument is u/a while the cutoff is
  # a*pi — dividing the argument by the cutoff instead leaves the weight at
  # sin(1)/1 = 0.84 where it must reach sin(pi)/pi = 0, which breaks the
  # continuity the estimator depends on.
  psi_andrews <- function(u, a = 1.34, deriv = 0) {
    inside <- abs(u) <= a * pi
    z <- u / a
    if (!deriv) {
      return(ifelse(inside, ifelse(abs(z) < 1e-8, 1, sin(z) / z), 0))
    }
    ifelse(inside, cos(z), 0)
  }

  # IRLS for location, scale held FIXED at the RAW median absolute deviation
  # from the median — no normal-consistency constant (1.4826, equivalently
  # dividing by 0.6745), and NOT re-estimated across iterations.
  #
  # This used to be `MASS::rlm(x ~ 1, psi = psi, ...)`, whose default
  # `scale.est = "MAD"` both applies the 1.4826 consistency constant AND
  # re-estimates scale from the current residuals every iteration. That
  # matched SPSS closely on mild, roughly-symmetric data (tests/spss-parity's
  # fixture: N=117, ~0.06 off on a location of 52.8 — see that README's "Open
  # differences", where an exhaustive algorithm search still called this
  # unexplained) but diverged 5-27% from SPSS on real, skewed clinical data —
  # verified by exactly reconstructing two SPSS EXAMINE runs from their
  # published stem-and-leaf + extreme-values tables (case notes in
  # tests/r-validation/test-m-estimators-2026-08.R) and testing every
  # scale/iteration combination against the real published numbers: only
  # "raw MAD, fixed once from the overall median" reproduces all four
  # estimators on both fixtures to within 0.1-0.5%. The N=117 fixture simply
  # wasn't skewed enough for the two scale conventions to disagree — most
  # points never approach a psi cutoff either way — which is why the earlier
  # search came back empty.
  m_estimate <- function(x, weight_fn, ..., tol = 1e-10, maxit = 200) {
    # A distribution with zero spread around the median makes every scaled
    # residual 0/0 — SPSS reports these as "cannot be computed because of the
    # highly centralized distribution around the median" and so do we (NULL →
    # the renderer's "." marker).
    if (length(x) < 3) return(NULL)
    scale <- median(abs(x - median(x)))
    if (!is.finite(scale) || scale <= 0) return(NULL)

    mu <- median(x)
    for (i in seq_len(maxit)) {
      w <- weight_fn((x - mu) / scale, ...)
      denom <- sum(w)
      if (!is.finite(denom) || denom <= 0) return(NULL)
      mu_new <- sum(w * x) / denom
      if (abs(mu_new - mu) < tol) { mu <- mu_new; break }
      mu <- mu_new
    }
    if (!is.finite(mu)) return(NULL)
    round(mu, 6)
  }

  has_mass    <- requireNamespace("MASS", quietly = TRUE)
  # Kolmogorov-Smirnov with the Lilliefors correction (SPSS's own default for
  # EXAMINE's K-S column — same package/call as the Normality tab's
  # normality.R, so the two agree). Falls back to plain ks.test() with a
  # warning when 'nortest' isn't installed, same fallback normality.R uses.
  has_nortest <- requireNamespace("nortest", quietly = TRUE)

  # Percentile probabilities shown by SPSS's Percentiles table.
  PCTS <- c(5, 10, 25, 50, 75, 90, 95)

  # ── Distribution helpers (SPSS formulas) ─────────────────────────────────────
  # calc_skewness()/calc_kurtosis() are now _bootstrap.R's wtd_skewness()/
  # wtd_kurtosis() (identical formula; w = NULL reproduces this exactly).
  # se_skewness()/se_kurtosis() are _bootstrap.R shared helpers.

  # ── Grouping key from factor columns ─────────────────────────────────────────
  if (length(factors) > 0) {
    for (fc in factors) {
      if (!fc %in% names(df)) sai_error(paste("Factor column not found:", fc))
    }
    factor_cols <- lapply(factors, function(fc) as.character(df[[fc]]))
    group_key   <- do.call(paste, c(factor_cols, sep = " * "))
    group_key[is.na(group_key)] <- NA_character_
    group_key_pre <- do.call(paste, c(lapply(factors, function(fc) as.character(df_pre[[fc]])),
                                      sep = " * "))
    has_factors <- TRUE
  } else {
    group_key   <- rep("__all__", nrow(df))
    group_key_pre <- rep("__all__", nrow(df_pre))
    has_factors <- FALSE
  }
  group_levels <- sort(unique(group_key[!is.na(group_key)]))
  has_label    <- !is.null(df$.sai_case_label)

  all_tables <- list()
  all_plots  <- list()
  boot_rows  <- list()
  n_vars     <- length(variables)
  # SPSS opens EXAMINE with a Case Processing Summary: per dependent (and per
  # factor level when factors are given) how many cases are Valid vs Missing.
  # Rows accumulate through the loops below and the table is prepended once
  # every dependent has been seen.
  cps_rows   <- list()

  for (vi in seq_along(variables)) {
    col_id   <- variables[vi]
    var_name <- resolve_var_name(col_id, var_names)
    progress(as.integer(10 + 70 * (vi - 1) / n_vars), "progress.computing")

    if (!col_id %in% names(df)) sai_error(paste("Column not found in dataset:", col_id))

    num_all <- suppressWarnings(as.numeric(apply_user_missing(df[[col_id]], col_id, params)))

    # Per-variable rows that accumulate across groups (one table per variable,
    # one row per group).
    normality_rows <- list()
    box_traces     <- list()
    pct_rows       <- list()
    mest_rows      <- list()
    extreme_rows   <- list()

    for (g in group_levels) {
      if (has_factors) {
        group_parts   <- strsplit(g, " \\* ", fixed = FALSE)[[1]]
        resolved_parts <- vapply(seq_along(factors), function(i) {
          resolve_var_name(group_parts[i], factor_value_labels[[factors[i]]])
        }, character(1))
        grp_label <- paste(resolved_parts, collapse = " * ")
        factor_title_parts <- paste0(unlist(factor_names[factors]), " = ", resolved_parts)
        title_name <- paste0(var_name, " (", paste(factor_title_parts, collapse = ", "), ")")
      } else {
        grp_label  <- var_name
        title_name <- var_name
      }

      sel_raw <- if (has_factors) (!is.na(group_key) & group_key == g) else rep(TRUE, length(num_all))
      sel     <- sel_raw & !is.na(num_all)
      vals    <- num_all[sel]
      wv      <- if (is.null(w)) NULL else w[sel]
      case_no <- df$.sai_case[sel]
      n       <- length(vals)

      # Case Processing Summary row — emitted before the n == 0 bail-out below
      # so a factor level whose cases are all missing still appears, which is
      # exactly the situation the table exists to make visible.
      sel_pre   <- if (has_factors) (!is.na(group_key_pre) & group_key_pre == g) else rep(TRUE, nrow(df_pre))
      cps_valid <- if (is.null(w)) n else round(sum(w[sel]), 6)
      cps_tot   <- if (is.null(w_pre)) sum(sel_pre) else round(sum(w_pre[sel_pre]), 6)
      cps_pct   <- function(x) if (cps_tot > 0) round(x / cps_tot * 100, 1) else 0
      cps_rows  <- c(cps_rows, list(list(
        var_name, if (has_factors) grp_label else "",
        cps_valid, cps_pct(cps_valid),
        cps_tot - cps_valid, cps_pct(cps_tot - cps_valid),
        cps_tot, cps_pct(cps_tot)
      )))

      if (n == 0) next
      n_disp  <- if (is.null(wv)) n else round(sum(wv), 6)

      # ── Descriptives table (Statistic | Value) ────────────────────────────────
      if (show_stats && isTRUE(stats_opts$descriptives)) {
        m   <- wtd_mean(vals, wv)
        sdv <- if (n > 1) wtd_sd(vals, wv) else NA_real_
        se  <- if (n > 1) sdv / sqrt(n_disp) else NA_real_
        ci_margin <- if (n > 1) qt(0.975, df = n_disp - 1) * se else NA_real_
        # Both branches go through wtd_quantile, which is SPSS's HAVERAGE. The
        # unweighted branch used to call IQR(), i.e. R's type 7, so the same
        # data gave a different interquartile range depending only on whether a
        # weight variable happened to be set — and the unweighted one disagreed
        # with the Percentiles table printed two rows below it (16.360 against
        # 61.065 - 44.170 = 16.895, which is what SPSS reports).
        iqr_w <- diff(wtd_quantile(vals, wv, c(0.25, 0.75)))

        # Trimmed mean has no settled weighted-frequency definition (SPSS
        # trims by case count, not cumulative weight) — left unweighted, and
        # flagged via weight_note_needed below when weighting is active.
        if (!is.null(wv)) weight_note_needed <- TRUE

        # 5% trimmed mean: _bootstrap.R's trimmed_mean_5() (SPSS's fractional
        # boundary weighting, shared with ONEWAY's Levene variant).

        sk <- if (n > 2) wtd_skewness(vals, wv) else NA_real_
        sk_finite <- is.finite(sk)
        kt <- if (n > 3) wtd_kurtosis(vals, wv) else NA_real_
        kt_finite <- is.finite(kt)

        rows <- list(
          list("output.stat.n",           n_disp),
          list("output.stat.mean",        round(m, 6)),
          list("output.stat.seMean",      if (n > 1) round(se, 6) else NULL),
          list("output.stat.ciLower",     if (is.na(ci_margin)) NULL else round(m - ci_margin, 6)),
          list("output.stat.ciUpper",     if (is.na(ci_margin)) NULL else round(m + ci_margin, 6)),
          list("output.stat.trimmedMean", round(trimmed_mean_5(vals), 6)),
          list("output.stat.median",      round(wtd_median(vals, wv), 6)),
          list("output.stat.variance",    if (n > 1) round(wtd_var(vals, wv), 6) else NULL),
          list("output.stat.sd",          if (n > 1) round(sdv, 6) else NULL),
          list("output.stat.min",         round(min(vals), 6)),
          list("output.stat.max",         round(max(vals), 6)),
          list("output.stat.range",       round(diff(range(vals)), 6)),
          list("output.stat.iqr",         round(iqr_w, 6)),
          list("output.stat.skewness",    if (sk_finite) round(sk, 6) else NULL),
          list("output.stat.seSkew",      if (sk_finite) round(se_skewness(n_disp), 6) else NULL),
          list("output.stat.kurtosis",    if (kt_finite) round(kt, 6) else NULL),
          list("output.stat.seKurt",      if (kt_finite) round(se_kurtosis(n_disp), 6) else NULL)
        )
        all_tables <- c(all_tables, list(list(
          titleKey    = paste0("output.explore.descTitle:", title_name),
          columns     = list("output.col.statistic", "output.col.value"),
          rows        = rows,
          footnoteKey = NULL
        )))
      }

      # ── Percentiles row ───────────────────────────────────────────────────────
      # Two rows per group, exactly like SPSS's Percentiles table: the ordinary
      # weighted-average percentiles, then Tukey's Hinges (defined only for the
      # quartiles, so the outer columns stay blank).
      if (show_stats && isTRUE(stats_opts$percentiles)) {
        q <- wtd_quantile(vals, wv, probs = PCTS / 100)
        pct_rows <- c(pct_rows, list(c(
          list("output.explore.pctWeightedAvg", grp_label),
          lapply(q, function(v) round(v, 6))
        )))
        # fivenum()'s hinges have no weighted-frequency definition (same
        # situation as the trimmed mean above) — computed unweighted and
        # flagged.
        if (!is.null(wv)) weight_note_needed <- TRUE
        fv <- fivenum(vals)
        pct_rows <- c(pct_rows, list(list(
          "output.explore.pctTukeyHinges", grp_label,
          NULL, NULL, round(fv[2], 6), round(fv[3], 6), round(fv[4], 6), NULL, NULL
        )))
      }

      # ── M-Estimators row ──────────────────────────────────────────────────────
      # Robust location estimates; unweighted (rlm has no frequency-weight
      # semantics that match SPSS's case replication here).
      if (show_stats && isTRUE(stats_opts$mEstimators) && has_mass) {
        if (!is.null(wv)) weight_note_needed <- TRUE
        mest_rows <- c(mest_rows, list(list(
          grp_label,
          m_estimate(vals, MASS::psi.huber,    k = 1.339),
          m_estimate(vals, MASS::psi.bisquare, c = 4.685),
          m_estimate(vals, MASS::psi.hampel,   a = 1.7, b = 3.4, c = 8.5),
          m_estimate(vals, psi_andrews)
        )))
      }

      # ── Extreme Values rows ───────────────────────────────────────────────────
      # SPSS's Outliers table: the 5 largest and 5 smallest cases, identified by
      # their position in the data file and (optionally) the user-supplied label
      # variable. Unweighted — these are individual cases, not aggregates.
      if (show_stats && isTRUE(stats_opts$outliers)) {
        n_ext      <- min(5L, n)
        ord        <- order(vals, decreasing = TRUE)
        hi         <- ord[seq_len(n_ext)]
        lo         <- rev(ord)[seq_len(n_ext)]
        case_label <- if (has_label) df$.sai_case_label[sel] else NULL
        for (k in seq_len(n_ext)) {
          row <- list(grp_label, "output.explore.extremeHighest", k, case_no[hi[k]])
          if (has_label) row <- c(row, list(case_label[hi[k]]))
          row <- c(row, list(round(vals[hi[k]], 6)))
          extreme_rows <- c(extreme_rows, list(row))
        }
        for (k in seq_len(n_ext)) {
          row <- list(grp_label, "output.explore.extremeLowest", k, case_no[lo[k]])
          if (has_label) row <- c(row, list(case_label[lo[k]]))
          row <- c(row, list(round(vals[lo[k]], 6)))
          extreme_rows <- c(extreme_rows, list(row))
        }
      }

      # ── Bootstrap the mean (BOOT1) ────────────────────────────────────────────
      # Same choke point as descriptives.R: one bootstrap per dependent × group,
      # merged into a single table at the end. Deliberately not tied to the
      # Descriptives checkbox — asking for a bootstrap is itself the request.
      if (show_stats) {
        boot_out <- sai_bootstrap(
          data.frame(x = vals),
          function(data, indices) c(mean = mean(data$x[indices])),
          params, weight = wv
        )
        if (!is.null(boot_out)) {
          for (r in boot_out) {
            boot_rows <- c(boot_rows, list(list(
              title_name, round(r$estimate, 6), round(r$bias, 6), round(r$se, 6),
              round(r$ci_lower, 6), round(r$ci_upper, 6))))
          }
        }
      }

      # ── Normality (Kolmogorov-Smirnov + Shapiro-Wilk) row ────────────────────
      # Rank/order-based tests — no settled weighted-frequency formulation
      # (release plan's "hard" category); stay unweighted regardless. Same
      # formulas as the Normality tab's normality.R: K-S uses the Lilliefors
      # correction (nortest::lillie.test) to match SPSS's own default, SW is
      # valid for 3 <= n <= 5000.
      if (isTRUE(plots_opts$normality) && n >= 3) {
        if (!is.null(wv)) weight_note_needed <- TRUE
        sdv_uw <- if (n > 1) sd(vals) else NA_real_

        ks_stat <- NULL; ks_df <- NULL; ks_p <- NULL
        if (n >= 4 && !is.na(sdv_uw) && sdv_uw > 0) {
          if (has_nortest) {
            kt <- tryCatch(nortest::lillie.test(vals), error = function(e) NULL)
          } else {
            kt <- tryCatch(
              suppressWarnings(ks.test(vals, "pnorm", mean = mean(vals), sd = sdv_uw)),
              error = function(e) NULL
            )
          }
          if (!is.null(kt)) {
            ks_stat <- round(unname(kt$statistic), 6); ks_df <- n; ks_p <- round(kt$p.value, 6)
          }
        }

        sw_stat <- NULL; sw_df <- NULL; sw_p <- NULL
        if (n <= 5000 && !is.na(sdv_uw) && sdv_uw > 0) {
          sw <- tryCatch(shapiro.test(vals), error = function(e) NULL)
          if (!is.null(sw)) {
            sw_stat <- round(unname(sw$statistic), 6); sw_df <- n; sw_p <- round(sw$p.value, 6)
          }
        }

        if (!is.null(ks_stat) || !is.null(sw_stat)) {
          normality_rows <- c(normality_rows, list(list(
            grp_label, ks_stat, ks_df, ks_p, sw_stat, sw_df, sw_p
          )))
        }
      }

      # ── Boxplot trace per group ───────────────────────────────────────────────
      # Visual only — plotted from raw (unweighted) case values.
      if (show_plots && isTRUE(plots_opts$boxplot)) {
        if (!is.null(wv)) weight_note_needed <- TRUE
        grp_idx <- length(box_traces) + 1
        grp_col <- SOFT_PALETTE[(grp_idx - 1) %% length(SOFT_PALETTE) + 1]
        box_traces <- c(box_traces, list(list(
          type = "box", y = as.list(vals), name = grp_label,
          boxpoints = "outliers", marker = list(color = grp_col),
          line = list(color = grp_col)
        )))
      }
    }

    # Percentiles table (one per dependent, rows = method × group)
    if (length(pct_rows) > 0) {
      all_tables <- c(all_tables, list(list(
        titleKey    = paste0("output.explore.percentilesTitle:", var_name),
        columns     = c(
          list("output.col.method", "output.col.group"),
          lapply(PCTS, function(p) paste0("output.stat.pct", p))
        ),
        rows        = pct_rows,
        footnoteKey = NULL
      )))
    }

    # M-Estimators table (one per dependent, rows = groups)
    if (length(mest_rows) > 0) {
      all_tables <- c(all_tables, list(list(
        titleKey    = paste0("output.explore.mEstimatorsTitle:", var_name),
        columns     = list("output.col.group", "output.explore.mHuber",
                           "output.explore.mTukey", "output.explore.mHampel",
                           "output.explore.mAndrews"),
        rows        = mest_rows,
        footnoteKey = "output.explore.mEstimatorsFootnote"
      )))
    }

    # Extreme Values table (one per dependent, rows = group × highest/lowest)
    if (length(extreme_rows) > 0) {
      extreme_cols <- c(
        list("output.col.group", "output.col.type", "output.col.rank",
             "output.caseSummaries.caseNumber"),
        if (has_label) list("output.col.label") else NULL,
        list("output.col.value")
      )
      all_tables <- c(all_tables, list(list(
        titleKey    = paste0("output.explore.extremeTitle:", var_name),
        columns     = extreme_cols,
        rows        = extreme_rows,
        footnoteKey = NULL
      )))
    }

    # Normality table (one per dependent, rows = groups). Column keys are
    # shared with the Normality tab's own table (normality.R) — same tests,
    # same labels.
    if (length(normality_rows) > 0) {
      all_tables <- c(all_tables, list(list(
        titleKey    = paste0("output.explore.normalityTitle:", var_name),
        columns     = list("output.col.group",
                           "output.normality.col.ksStat", "output.normality.col.ksDf",
                           "output.normality.col.ksSig",
                           "output.normality.col.swStat", "output.normality.col.swDf",
                           "output.normality.col.swSig"),
        rows        = normality_rows,
        footnoteKey = "output.explore.normalityFootnote"
      )))
    }

    # Boxplot (one per dependent, grouped)
    if (length(box_traces) > 0) {
      # Same shape as chart.R's boxplot: y-axis names the measured (dependent)
      # variable, x-axis names the grouping factor(s) (joined the same way as
      # multi-factor table titles above), and the legend is on — Graphs >
      # Boxplot always shows it, Explore's was previously forced off and had
      # no x-axis title at all, so a grouped boxplot gave no way to tell which
      # variable the groups belonged to or which trace was which group.
      layout <- list(
        yaxis  = list(title = list(text = var_name)),
        xaxis  = if (has_factors) {
          list(title = list(text = paste(unlist(factor_names[factors]), collapse = " * ")))
        } else NULL,
        margin = list(t = 40, r = 20, b = 40, l = 60),
        showlegend = TRUE
      )
      all_plots <- c(all_plots, list(list(
        titleKey = paste0("output.explore.boxplotTitle:", var_name),
        type     = "plotly",
        data     = list(data = box_traces, layout = layout)
      )))
    }

    # Histogram (one per dependent, all groups pooled) — visual only, unweighted.
    if (show_plots && isTRUE(plots_opts$histogram)) {
      if (!is.null(w)) weight_note_needed <- TRUE
      nv <- num_all[!is.na(num_all)]
      if (length(nv) >= 2) {
        trace <- sai_histogram_trace(nv, name = var_name, color = BAR_COLOR)
        layout <- list(
          xaxis = list(title = list(text = var_name)),
          yaxis = list(title = list(text = "Frequency")),
          bargap = 0.02, margin = list(t = 40, r = 20, b = 40, l = 60)
        )
        all_plots <- c(all_plots, list(list(
          titleKey = paste0("output.explore.histTitle:", var_name),
          type     = "plotly",
          data     = list(data = list(trace), layout = layout)
        )))
      }
    }

    # Normal Q-Q plot (paired with the normality tests): theoretical normal
    # quantiles (x) vs observed sorted values (y) + a reference line through the
    # data quartiles.
    if (show_plots && isTRUE(plots_opts$normality)) {
      if (!is.null(w)) weight_note_needed <- TRUE
      nv <- sort(num_all[!is.na(num_all)])
      if (length(nv) >= 3) {
        theo <- qnorm(ppoints(length(nv)))
        q_o <- quantile(nv, c(0.25, 0.75)); q_t <- qnorm(c(0.25, 0.75))
        slope <- (q_o[2] - q_o[1]) / (q_t[2] - q_t[1])
        intc  <- q_o[1] - slope * q_t[1]
        pts  <- list(type = "scatter", mode = "markers", showlegend = FALSE,
                     x = as.list(theo), y = as.list(nv),
                     marker = list(color = BAR_COLOR, size = 5))
        lx   <- c(min(theo), max(theo))
        line <- list(type = "scatter", mode = "lines", showlegend = FALSE,
                     x = as.list(lx), y = as.list(intc + slope * lx),
                     line = list(color = "#888"))
        qlayout <- list(
          xaxis = list(title = list(text = "Expected Normal")),
          yaxis = list(title = list(text = "Observed Value")),
          margin = list(t = 20, r = 20, b = 40, l = 60))
        all_plots <- c(all_plots, list(list(
          titleKey = paste0("output.explore.qqTitle:", var_name),
          type     = "plotly",
          data     = list(data = list(pts, line), layout = qlayout))))
      }
    }
  }

  # Bootstrap table (all dependents × groups pooled, like descriptives.R)
  if (length(boot_rows) > 0) {
    all_tables <- c(all_tables, list(list(
      titleKey    = "output.bootstrap.meanTitle",
      columns     = list("output.col.variable", "output.col.mean", "output.bootstrap.bias",
                         "output.bootstrap.stdError", "output.bootstrap.ciLower",
                         "output.bootstrap.ciUpper"),
      rows        = boot_rows,
      footnoteKey = "output.bootstrap.footnote"
    )))
  }

  # Case Processing Summary goes first, ahead of every dependent's own tables.
  if (length(cps_rows) > 0) {
    cps_cols <- c(list("output.col.variable"),
                  if (has_factors) list("output.col.group") else list(""),
                  list("output.cps.validN", "output.cps.validPct",
                       "output.cps.missingN", "output.cps.missingPct",
                       "output.cps.totalN", "output.cps.totalPct"))
    all_tables <- c(list(list(
      titleKey = "output.cps.title",
      columns  = cps_cols,
      rows     = cps_rows
    )), all_tables)
  }

  warn_keys <- character(0)
  if (isTRUE(stats_opts$mEstimators) && !has_mass) {
    warn_keys <- c(warn_keys, "output.explore.warnMassMissing")
  }
  if (isTRUE(plots_opts$normality) && !has_nortest) {
    warn_keys <- c(warn_keys, "output.explore.warnNortestMissing")
  }

  progress(100L, "progress.done")
  sai_output(
    tables   = all_tables,
    plots    = all_plots,
    warnings = warn_keys,
    notes    = if (weight_note_needed) "output.explore.noteWeightPartial" else character(0)
  )

}, error = function(e) {
  sai_error(conditionMessage(e))
})
