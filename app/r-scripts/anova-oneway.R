# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# anova-oneway.R — One-Way ANOVA (SPSS-style).
#
# Params (from JSON):
#   rScriptsDir — directory containing _bootstrap.R
#   variables   — character vector of dependent colIds
#   varNames    — named list colId → display name
#   factor      — grouping-variable colId
#   factorName  — display name of the factor
#   options$bootstrap — BOOT2 (spss-parity-findings-2026-07-07 §B1): SPSS's
#     own Bootstrapping support for One-Way ANOVA covers the Group Statistics
#     table (mean + SD per group), not the F statistic — bootstraps each
#     group's own mean via case-resampling, same pattern as means.R.
#
# Output: per dependent a "Descriptives" table (N, Mean, SD, SE per group) and
#         an "ANOVA" table (Between/Within/Total: SS, df, MS, F, Sig.).

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

  vars      <- unlist(params$variables)
  var_names <- params$varNames
  fvar      <- params$factor
  fname     <- if (is.null(params$factorName)) fvar else params$factorName
  opts      <- if (is.null(params$options)) list() else params$options

  if (length(vars) == 0) sai_error("No dependent variables specified")
  if (is.null(fvar) || !fvar %in% names(df)) sai_error("Factor variable not found")

  # Missing Values (MV): listwise drops a case if ANY dependent variable or
  # the factor is missing. Must run before get_weights() so the weight
  # vector stays aligned to df's rows.
  df <- apply_listwise(df, c(vars, fvar), params)

  # Weight Cases (W1): descriptives, the ANOVA SS/df/MS/F decomposition,
  # Levene's homogeneity test, Welch's robust test, and post-hoc comparisons
  # all use weighted N/mean/variance (SPSS frequency-weight semantics).
  .gw <- get_weights(df, params)
  df  <- .gw$df
  w   <- .gw$w

  fcol_all <- as.character(apply_user_missing(df[[fvar]], fvar, params))
  tables    <- list()
  plots     <- list()
  boot_rows <- list()
  warns     <- character(0)
  cnt <- function(x) format_wtd_count(x, w)

  for (v in vars) {
    if (!v %in% names(df)) sai_error(paste("Column not found:", v))
    nm <- if (!is.null(var_names[[v]])) var_names[[v]] else v
    xv <- suppressWarnings(as.numeric(apply_user_missing(df[[v]], v, params)))

    keep <- !is.na(xv) & !is.na(fcol_all) & fcol_all != "NA"
    x <- xv[keep]; g <- factor(fcol_all[keep])
    wv <- if (is.null(w)) NULL else w[keep]
    if (nlevels(g) < 2 || length(x) <= nlevels(g)) next

    # Descriptives per group.
    desc_rows <- list()
    for (lvl in levels(g)) {
      idx <- g == lvl
      xs <- x[idx]; ws <- if (is.null(wv)) NULL else wv[idx]
      ns_disp <- if (is.null(ws)) length(xs) else sum(ws)
      desc_rows <- c(desc_rows, list(list(
        lvl, cnt(ns_disp), round(wtd_mean(xs, ws), 6), round(wtd_sd(xs, ws), 6),
        round(wtd_sd(xs, ws) / sqrt(ns_disp), 6))))

      # Bootstrapping (BOOT2): bootstrap this group's own mean — SPSS's
      # documented scope for One-Way ANOVA's Group Statistics table.
      boot_df <- data.frame(x = xs)
      boot_out <- sai_bootstrap(
        boot_df,
        function(data, indices) c(mean = mean(data$x[indices])),
        params, weight = ws
      )
      if (!is.null(boot_out)) {
        for (r in boot_out) {
          boot_rows <- c(boot_rows, list(list(
            paste0(nm, " — ", lvl),
            round(r$estimate, 6), round(r$bias, 6), round(r$se, 6),
            round(r$ci_lower, 6), round(r$ci_upper, 6))))
        }
      }
    }
    n_all_disp <- if (is.null(wv)) length(x) else sum(wv)
    desc_rows <- c(desc_rows, list(list(
      "output.col.total", cnt(n_all_disp), round(wtd_mean(x, wv), 6),
      round(wtd_sd(x, wv), 6), round(wtd_sd(x, wv) / sqrt(n_all_disp), 6))))

    # One-way ANOVA decomposition. Weighted: each group's contribution to
    # SSB/SSW uses its weighted mean and Σw in place of length()/mean().
    gm <- wtd_mean(x, wv)
    if (is.null(wv)) {
      ssb <- sum(tapply(x, g, function(z) length(z) * (mean(z) - gm)^2))
      ssw <- sum(tapply(x, g, function(z) sum((z - mean(z))^2)))
    } else {
      idx_by_g <- split(seq_along(x), g)
      ssb <- sum(vapply(idx_by_g, function(idx) {
        sum(wv[idx]) * (wtd_mean(x[idx], wv[idx]) - gm)^2
      }, numeric(1)))
      ssw <- sum(vapply(idx_by_g, function(idx) {
        sum(wv[idx] * (x[idx] - wtd_mean(x[idx], wv[idx]))^2)
      }, numeric(1)))
    }
    sst  <- ssb + ssw
    dfb  <- nlevels(g) - 1
    dfw  <- n_all_disp - nlevels(g)
    dft  <- n_all_disp - 1
    msb  <- ssb / dfb; msw <- ssw / dfw
    Fv   <- msb / msw
    pv   <- pf(Fv, dfb, dfw, lower.tail = FALSE)

    dfnum <- function(x) if (is.null(wv)) as.integer(x) else round(x, 3)
    anova_rows <- list(
      list("output.col.betweenGroups", round(ssb, 6), dfnum(dfb), round(msb, 6),
           round(Fv, 6), round(pv, 6)),
      list("output.col.withinGroups", round(ssw, 6), dfnum(dfw), round(msw, 6), NULL, NULL),
      list("output.col.total", round(sst, 6), dfnum(dft), NULL, NULL, NULL))

    tables <- c(tables,
      list(list(
        titleKey    = paste0("output.anova.descTitle:", nm),
        # İlk kolon başlığı faktörün kendi görünen adı (SPSS parity; ham ad
        # i18n anahtarı değildir — translateOutputKey catch-all'u aynen basar,
        # case-summaries.R / survival-km.R ile aynı desen).
        columns     = list(fname, "output.col.n", "output.col.mean",
                           "output.col.stdDeviation", "output.col.seMean"),
        rows        = desc_rows,
        footnoteKey = NULL
      )),
      list(list(
        # titleBy: iki parametreli anahtar — {{p0}} bağımlı değişken, {{p1}}
        # faktör; hangi gruba göre kıyaslandığı tablo başlığında görünür.
        titleKey    = paste0("output.anova.titleBy:", nm, "|", fname),
        columns     = list("output.col.source", "output.col.sumSq", "output.col.df",
                           "output.col.meanSq", "output.col.f", "output.col.sig"),
        rows        = anova_rows,
        footnoteKey = NULL
      )))

    # ── ANOVA Effect Sizes (PH6, SPSS v27+ parity) ────────────────────────────
    # Textbook point estimates (Kirk 1996; Keppel 1991) — no formulaic
    # ambiguity across sources, unlike e.g. Brown-Forsythe's df2 correction
    # (left for a future pass with a reference implementation to validate
    # against — none is installed here, see CLAUDE.md §11 "her manuel formül
    # test edilmeli"). Noncentral-F confidence intervals are NOT included in
    # this pass for the same reason: the CI derivation (solving for
    # noncentrality bounds via uniroot on pf()) has more failure surface than
    # a point estimate and no local reference to check it against.
    #   eta²     = SSB / SST                          (biased upward; simplest)
    #   epsilon² = (SSB - dfb·MSW) / SST               (bias-corrected)
    #   omega²   = (SSB - dfb·MSW) / (SST + MSW)       (fixed-effect; most conservative)
    # Ordering eta² ≥ epsilon² ≥ omega² holds by construction whenever
    # SSB > dfb·MSW (verified on toy data before shipping this).
    if (isTRUE(opts$effectSize)) {
      eta2     <- ssb / sst
      epsilon2 <- (ssb - dfb * msw) / sst
      omega2   <- (ssb - dfb * msw) / (sst + msw)
      tables <- c(tables, list(list(
        titleKey = paste0("output.anova.effectSizeTitle:", nm),
        columns  = list("output.col.statistic", "output.col.value"),
        rows     = list(
          # 6 decimals like every other statistic this script emits: display
          # rounding is the Renderer's job (CLAUDE.md M2 / Variable "Decimals"),
          # and 3 here silently capped the precision the validation suite could
          # check (denetim raporu §6).
          list("output.anova.etaSquared", round(eta2, 6)),
          list("output.anova.epsilonSquared", round(epsilon2, 6)),
          list("output.anova.omegaSquared", round(omega2, 6))
        ),
        footnoteKey = NULL)))
    }

    # ── Test of Homogeneity of Variances (Levene, 4→3 variants) ───────────────
    # SPSS reports 4 variants (mean/median/median+adjusted df/trimmed mean);
    # "median with adjusted df" is omitted — its Satterthwaite-style df
    # correction formula is not reliably documented and a guessed formula
    # risks a silently wrong p-value (see spss-parity-findings, §A3). The
    # other three share one F-test structure: same SSB/SSW-on-|deviation|
    # formula as the ANOVA decomposition above, only the per-group "center"
    # differs (mean / median / 5%-trimmed mean).
    #
    # Weighted: each group's SS uses its weighted mean and Σw in place of
    # length()/mean() (same generalization as the ANOVA decomposition above).
    if (isTRUE(opts$homogeneity)) {
      levene_variant <- function(center_fn, wtd_center_fn) {
        if (is.null(wv)) {
          z  <- abs(x - ave(x, g, FUN = center_fn))
          zb <- mean(z)
          lssb <- sum(tapply(z, g, function(v) length(v) * (mean(v) - zb)^2))
          lssw <- sum(tapply(z, g, function(v) sum((v - mean(v))^2)))
        } else {
          grp_centers <- vapply(idx_by_g, function(idx) wtd_center_fn(x[idx], wv[idx]), numeric(1))
          z  <- abs(x - grp_centers[as.character(g)])
          zb <- wtd_mean(z, wv)
          lssb <- sum(vapply(idx_by_g, function(idx) {
            sum(wv[idx]) * (wtd_mean(z[idx], wv[idx]) - zb)^2
          }, numeric(1)))
          lssw <- sum(vapply(idx_by_g, function(idx) {
            sum(wv[idx] * (z[idx] - wtd_mean(z[idx], wv[idx]))^2)
          }, numeric(1)))
        }
        Lf <- (lssb / dfb) / (lssw / dfw)
        list(stat = Lf, sig = pf(Lf, dfb, dfw, lower.tail = FALSE))
      }

      lev_mean <- levene_variant(mean, wtd_mean)
      lev_med  <- levene_variant(median, wtd_median)
      # Trimmed mean has no settled weighted-frequency definition (SPSS trims
      # by case count, not cumulative weight) — same honesty stance explore.R
      # takes: computed unweighted even when a weight is active.
      # _bootstrap.R's trimmed_mean_5(): SPSS trims exactly 5% of the cases at
      # each end, weighting the boundary case by the fractional part. R's
      # mean(trim = 0.05) drops whole cases only, which put this variant at
      # .916/1.070 against SPSS's .912/1.047 (the other two variants matched).
      lev_trim <- levene_variant(trimmed_mean_5, function(v, weight) trimmed_mean_5(v))

      tables <- c(tables, list(list(
        titleKey = paste0("output.anova.homogTitle:", nm),
        columns  = list("output.col.method", "output.col.leveneStatistic",
                        "output.col.df1", "output.col.df2", "output.col.sig"),
        rows     = list(
          list("output.anova.leveneBasedOnMean",    round(lev_mean$stat, 3), dfnum(dfb), dfnum(dfw), round(lev_mean$sig, 6)),
          list("output.anova.leveneBasedOnMedian",  round(lev_med$stat, 3),  dfnum(dfb), dfnum(dfw), round(lev_med$sig, 6)),
          list("output.anova.leveneBasedOnTrimmed", round(lev_trim$stat, 3), dfnum(dfb), dfnum(dfw), round(lev_trim$sig, 6))
        ),
        footnoteKey = NULL)))
    }

    # ── Robust Tests of Equality of Means (Welch) ─────────────────────────────
    # oneway.test() hard-errors ("not enough observations") when ANY group has
    # < 2 observations — Welch needs each group's own variance. Before the
    # outer tryCatch turned that into a failed run: the whole ANOVA died with
    # an invisible error. Now the robust table is skipped and a warning is
    # emitted instead; every other table still computes.
    if (isTRUE(opts$welch)) {
      welch_res <- tryCatch({
        if (is.null(wv)) {
          wt <- suppressWarnings(oneway.test(x ~ g, var.equal = FALSE))
          list(statistic = as.numeric(wt$statistic), df1 = as.numeric(wt$parameter[1]),
               df2 = as.numeric(wt$parameter[2]), p.value = wt$p.value)
        } else {
          wt <- wtd_welch_anova(x, g, wv)
          list(statistic = wt$statistic, df1 = wt$df1, df2 = wt$df2, p.value = wt$p.value)
        }
      }, error = function(e) NULL)
      if (is.null(welch_res)) {
        warns <- c(warns, "output.warn.welchNotComputed")
      } else {
        tables <- c(tables, list(list(
          titleKey = paste0("output.anova.robustTitle:", nm),
          columns  = list("output.col.method", "output.col.statistic", "output.col.df1",
                          "output.col.df2", "output.col.sig"),
          rows     = list(list("output.col.welch", round(welch_res$statistic, 3),
                               round(welch_res$df1, 0),
                               round(welch_res$df2, 3),
                               round(welch_res$p.value, 6))),
          footnoteKey = NULL)))
      }
    }

    # ── Robust Tests of Equality of Means (Brown-Forsythe) ────────────────────
    # Brown & Forsythe (1974): same numerator (weighted between-group SS) as
    # classical ANOVA, but a Satterthwaite-style denominator built from each
    # group's own variance weighted by (1 - n_i/N) instead of pooling MSW —
    # robust to heterogeneous variances without Welch's per-pair reweighting
    # of the *group means themselves*. Reuses idx_by_g/ni/vi already computed
    # for post hoc when available; otherwise derived fresh from x/g/wv.
    if (isTRUE(opts$brownForsythe)) {
      if (is.null(wv)) {
        bf_ni <- tapply(x, g, length); bf_vi <- tapply(x, g, var)
      } else {
        bf_idx_by_g <- split(seq_along(x), g)
        bf_ni <- vapply(bf_idx_by_g, function(idx) sum(wv[idx]), numeric(1))
        bf_vi <- vapply(bf_idx_by_g, function(idx) wtd_var(x[idx], wv[idx]), numeric(1))
      }
      # Same < 2-observation guard as Welch above: a singleton group has no
      # variance (bf_vi = NA) and its Satterthwaite term divides by n_i - 1 =
      # 0 — the whole table would come out NaN. Skip + warn instead.
      if (any(bf_ni < 2)) {
        warns <- c(warns, "output.warn.brownForsytheNotComputed")
      } else {
      bf_ci   <- 1 - bf_ni / n_all_disp
      bf_den  <- sum(bf_ci * bf_vi)
      bf_stat <- ssb / bf_den
      bf_df2  <- bf_den^2 / sum((bf_ci * bf_vi)^2 / (bf_ni - 1))
      bf_sig  <- pf(bf_stat, dfb, bf_df2, lower.tail = FALSE)
      tables <- c(tables, list(list(
        titleKey = paste0("output.anova.robustTitle:", nm),
        columns  = list("output.col.method", "output.col.statistic", "output.col.df1",
                        "output.col.df2", "output.col.sig"),
        rows     = list(list("output.col.brownForsythe", round(bf_stat, 3),
                             round(dfb, 0),
                             round(bf_df2, 3),
                             round(bf_sig, 6))),
        footnoteKey = NULL)))
      }
    }

    # ── Means Plot ─────────────────────────────────────────────────────────────
    # Group means with SPSS's default line/marker style; x-axis follows the
    # factor's own level order (already `levels(g)`, same order as Descriptives).
    if (isTRUE(opts$meansPlot)) {
      plot_lvls  <- levels(g)
      plot_means <- vapply(desc_rows[seq_along(plot_lvls)], function(r) r[[3]], numeric(1))
      trace <- list(type = "scatter", mode = "lines+markers",
                    x = as.list(plot_lvls), y = as.list(plot_means))
      layout <- list(
        xaxis  = list(title = list(text = fname)),
        yaxis  = list(title = list(text = paste("Mean of", nm))),
        margin = list(t = 40, r = 20, b = 40, l = 60)
      )
      plots <- c(plots, list(list(
        titleKey = paste0("output.anova.meansPlotTitle:", nm),
        type = "plotly",
        data = list(data = list(trace), layout = layout))))
    }

    # ── Multiple Comparisons (Post Hoc) ───────────────────────────────────────
    # Weighted: per-group n/mean/variance become Σw / weighted mean / weighted
    # variance; the studentized-range/t critical values then treat weighted N
    # the same way SPSS's own weighted post-hoc tables do.
    eq_methods  <- c("tukey", "bonferroni", "lsd", "sidak", "scheffe", "hochbergGT2")
    uneq_methods <- c("gamesHowell", "tamhaneT2", "dunnettT3", "dunnettC")
    if (any(vapply(c(eq_methods, uneq_methods, "dunnett"), function(k) isTRUE(opts[[k]]), logical(1)))) {
      lvls <- levels(g)
      alpha <- suppressWarnings(as.numeric(opts$sigLevel))
      if (is.null(alpha) || length(alpha) == 0 || is.na(alpha) || alpha <= 0 || alpha >= 1) alpha <- 0.05
      ci_pct <- as.character(round((1 - alpha) * 100, 4))
      if (is.null(wv)) {
        ni <- tapply(x, g, length); mns <- tapply(x, g, mean); vi <- tapply(x, g, var)
      } else {
        ni  <- vapply(idx_by_g, function(idx) sum(wv[idx]), numeric(1))[lvls]
        mns <- vapply(idx_by_g, function(idx) wtd_mean(x[idx], wv[idx]), numeric(1))[lvls]
        vi  <- vapply(idx_by_g, function(idx) wtd_var(x[idx], wv[idx]), numeric(1))[lvls]
      }
      k <- nlevels(g); ncmp <- choose(k, 2)
      ph_rows <- list()

      # Equal-variances-assumed methods share the pooled se = sqrt(msw*(1/ni+1/nj)), dfw.
      add_method_eq <- function(method_key, stat_fn) {
        first <- TRUE
        for (i in seq_len(k)) for (j in seq_len(k)) if (i != j) {
          diff <- mns[i] - mns[j]; se <- sqrt(msw * (1 / ni[i] + 1 / ni[j]))
          r <- stat_fn(diff, se)
          ph_rows[[length(ph_rows) + 1L]] <<- list(
            if (first) method_key else "", lvls[i], lvls[j], round(diff, 4),
            round(se, 4), round(r$sig, 6), round(r$lo, 4), round(r$hi, 4))
          first <- FALSE
        }
      }
      # Equal-variances-not-assumed methods use per-pair Welch se/df (own
      # group variances, no pooling) — same generalization ttest-independent.R
      # and anova-oneway.R's Welch robust test already use.
      # stat_fn(diff, se, dfij, dfi, dfj, wi, wj) — dfi/dfj (each group's OWN
      # n-1) and wi/wj (each group's own var/n term, wi+wj = se^2) are only
      # consumed by Dunnett's C below; other methods ignore them via `...`.
      add_method_uneq <- function(method_key, stat_fn) {
        first <- TRUE
        for (i in seq_len(k)) for (j in seq_len(k)) if (i != j) {
          diff <- mns[i] - mns[j]
          wi_  <- vi[i] / ni[i]; wj_ <- vi[j] / ni[j]
          se   <- sqrt(wi_ + wj_)
          dfij <- se^4 / (wi_^2 / (ni[i] - 1) + wj_^2 / (ni[j] - 1))
          # Undefined-pair guard: a singleton group has no variance (vi = NA)
          # and a zero-variance group makes se/dfij 0/NaN — the Welch-style
          # se/df these methods are built on doesn't exist for such pairs
          # (qtukey(df=NaN) is a hard error, "missing value where TRUE/FALSE
          # needed", which used to kill the whole run). Equal-variance
          # methods above don't hit this — they pool msw instead of per-group
          # variances. Skipping the pair mirrors the robust-test guards.
          if (ni[i] < 2 || ni[j] < 2 || !is.finite(se) || se <= 0 || !is.finite(dfij)) {
            if (!("output.warn.postHocPairSkipped" %in% warns)) {
              warns <<- c(warns, "output.warn.postHocPairSkipped")
            }
            next
          }
          r <- stat_fn(diff, se, dfij, ni[i] - 1, ni[j] - 1, wi_, wj_)
          ph_rows[[length(ph_rows) + 1L]] <<- list(
            if (first) method_key else "", lvls[i], lvls[j], round(diff, 4),
            round(se, 4), round(r$sig, 6), round(r$lo, 4), round(r$hi, 4))
          first <- FALSE
        }
      }

      if (isTRUE(opts$lsd)) add_method_eq("output.col.lsd", function(diff, se) {
        crit <- qt(1 - alpha / 2, dfw)
        list(sig = 2 * pt(-abs(diff / se), dfw),
             lo = diff - crit * se, hi = diff + crit * se)
      })
      if (isTRUE(opts$sidak)) add_method_eq("output.col.sidak", function(diff, se) {
        alpha_per <- 1 - (1 - alpha)^(1 / ncmp)
        crit <- qt(1 - alpha_per / 2, dfw)
        praw <- 2 * pt(-abs(diff / se), dfw)
        list(sig = min(1, 1 - (1 - praw)^ncmp), lo = diff - crit * se, hi = diff + crit * se)
      })
      if (isTRUE(opts$scheffe)) add_method_eq("output.col.scheffe", function(diff, se) {
        critF <- qf(1 - alpha, dfb, dfw); crit <- sqrt(dfb * critF)
        F0 <- (diff / se)^2 / dfb
        list(sig = pf(F0, dfb, dfw, lower.tail = FALSE),
             lo = diff - crit * se, hi = diff + crit * se)
      })
      if (isTRUE(opts$tukey)) add_method_eq("output.col.tukeyHSD", function(diff, se) {
        q <- abs(diff) / se * sqrt(2); crit <- qtukey(1 - alpha, k, dfw)
        list(sig = ptukey(q, k, dfw, lower.tail = FALSE),
             lo = diff - crit / sqrt(2) * se, hi = diff + crit / sqrt(2) * se)
      })
      if (isTRUE(opts$bonferroni)) add_method_eq("output.col.bonferroni", function(diff, se) {
        tval <- diff / se; praw <- 2 * pt(-abs(tval), dfw)
        crit <- qt(1 - alpha / (2 * ncmp), dfw)
        list(sig = min(1, praw * ncmp), lo = diff - crit * se, hi = diff + crit * se)
      })
      # Hochberg's GT2 (B6-adjacent): "pairwise comparison test based on the
      # studentized maximum modulus, appropriate when cell sizes are unequal"
      # (SPSS Base docs) — same SMM machinery as Dunnett's T3 below, but pooled
      # se/df (equal-variance assumption) instead of per-pair Welch se/df.
      # Verified against SPSS's own published CRP numbers (spot-checked two
      # pairs to within Monte Carlo noise from mvtnorm's randomized
      # integration, same margin Dunnett's T3 already carries).
      if (isTRUE(opts$hochbergGT2)) {
        mvtnorm_ok <- requireNamespace("mvtnorm", quietly = TRUE)
        # crit depends only on df/alpha/ncmp — all equal-variance, so constant
        # across every pair — computed ONCE here rather than k*(k-1) times
        # inside the pair loop below. Each qmvt/pmvt call runs a randomized
        # Monte Carlo integration; recomputing an IDENTICAL one 12 times (k=4)
        # measured out to most of a ~3-minute run with every post hoc method
        # selected together — a real user-visible slowdown, not just waste.
        if (mvtnorm_ok) {
          hgt2_corr <- diag(ncmp)
          hgt2_df   <- max(1L, round(dfw))
          set.seed(12345L)
          hgt2_crit <- mvtnorm::qmvt(1 - alpha, tail = "both.tails", df = hgt2_df, corr = hgt2_corr)$quantile
        }
        add_method_eq("output.col.hochbergGT2", function(diff, se) {
          if (!mvtnorm_ok) return(list(sig = NA_real_, lo = NA_real_, hi = NA_real_))
          tstat <- abs(diff) / se
          sig <- 1 - as.numeric(mvtnorm::pmvt(
            lower = rep(-tstat, ncmp), upper = rep(tstat, ncmp), df = hgt2_df, corr = hgt2_corr))
          list(sig = min(max(sig, 0), 1), lo = diff - hgt2_crit * se, hi = diff + hgt2_crit * se)
        })
      }
      if (isTRUE(opts$gamesHowell)) add_method_uneq("output.col.gamesHowell",
        function(diff, se, dfij, ...) {
          q <- abs(diff) / se * sqrt(2); crit <- qtukey(1 - alpha, k, dfij)
          list(sig = ptukey(q, k, dfij, lower.tail = FALSE),
               lo = diff - crit / sqrt(2) * se, hi = diff + crit / sqrt(2) * se)
        })
      if (isTRUE(opts$tamhaneT2)) add_method_uneq("output.col.tamhaneT2",
        function(diff, se, dfij, ...) {
          alpha_per <- 1 - (1 - alpha)^(1 / ncmp)
          crit <- qt(1 - alpha_per / 2, dfij)
          praw <- 2 * pt(-abs(diff / se), dfij)
          list(sig = min(1, 1 - (1 - praw)^ncmp), lo = diff - crit * se, hi = diff + crit * se)
        })
      # Dunnett's T3 (B6, spss-parity-findings-2026-07-07): "pairwise comparison
      # test based on the Studentized Maximum Modulus" (SPSS Base docs, verified
      # via NotebookLM) — same per-pair Welch se/df as Games-Howell/Tamhane T2,
      # but the SMM critical value/p-value instead of the studentized range/t.
      # base R has no SMM distribution; mvtnorm::qmvt/pmvt with an identity
      # correlation matrix over `ncmp` independent comparisons IS the SMM
      # distribution (verified: with 1 comparison it collapses to a plain
      # two-sided t critical value, matching qt() exactly).
      if (isTRUE(opts$dunnettT3)) add_method_uneq("output.col.dunnettT3",
        function(diff, se, dfij, ...) {
          if (!requireNamespace("mvtnorm", quietly = TRUE)) {
            return(list(sig = NA_real_, lo = NA_real_, hi = NA_real_))
          }
          corr <- diag(ncmp)
          # mvtnorm::qmvt/pmvt require an INTEGER df (hard package constraint —
          # the multivariate-t algorithm doesn't support fractional df); the
          # Welch-Satterthwaite dfij is itself already an approximation, so
          # rounding to the nearest integer here is a standard, documented
          # compromise (same spirit as Satterthwaite df tables being read off
          # at integer rows), not a guessed formula.
          df_int <- max(1L, round(dfij))
          set.seed(12345L)  # mvtnorm's qmvt/pmvt use randomized QMC integration
          crit <- mvtnorm::qmvt(1 - alpha, tail = "both.tails", df = df_int, corr = corr)$quantile
          tstat <- abs(diff) / se
          sig <- 1 - as.numeric(mvtnorm::pmvt(
            lower = rep(-tstat, ncmp), upper = rep(tstat, ncmp), df = df_int, corr = corr))
          list(sig = min(max(sig, 0), 1), lo = diff - crit * se, hi = diff + crit * se)
        })
      # Dunnett's C (B6): "pairwise comparison test based on the [weighted
      # average of] Studentized range" (SPSS Base docs). Unlike Games-Howell's
      # shared per-pair df, C's critical value averages EACH group's own
      # qtukey (using that group's own df = n-1), weighted by its variance/n
      # contribution — the classic Dunnett (1980) formula, distinct from the
      # Welch-Satterthwaite df used elsewhere.
      #
      # No closed-form p-value is published for this weighted-critical-value
      # construction (only the CI is standard), so "sig" is derived by
      # self-consistent inversion: q_crit_at(a) is monotonically decreasing in
      # a, so uniroot() finds the alpha at which the *observed* studentized
      # difference exactly equals C's own weighted critical value — the sig
      # therefore always agrees with the CI (sig < alpha iff the CI excludes
      # 0), unlike naively reusing another method's p-value formula.
      if (isTRUE(opts$dunnettC)) add_method_uneq("output.col.dunnettC",
        function(diff, se, dfij, dfi, dfj, wi, wj) {
          q_crit_at <- function(a) {
            qi <- qtukey(1 - a, k, dfi); qj <- qtukey(1 - a, k, dfj)
            (wi * qi + wj * qj) / (wi + wj)
          }
          crit <- q_crit_at(alpha) / sqrt(2)
          q_obs <- abs(diff) / se * sqrt(2)
          eps <- 1e-9
          f <- function(a) q_crit_at(a) - q_obs
          sig <- tryCatch({
            if (f(eps) <= 0) eps
            else if (f(1 - eps) >= 0) 1 - eps
            else uniroot(f, c(eps, 1 - eps))$root
          }, error = function(e) NA_real_)
          list(sig = sig, lo = diff - crit * se, hi = diff + crit * se)
        })

      if (length(ph_rows) > 0) {
        tables <- c(tables, list(list(
          titleKey = paste0("output.anova.postHocTitle:", nm),
          columns  = list("output.col.method", "output.col.groupI", "output.col.groupJ",
                          "output.col.meanDiff", "output.col.stdError", "output.col.sig",
                          paste0("output.col.ciLowerPct:", ci_pct),
                          paste0("output.col.ciUpperPct:", ci_pct)),
          rows     = ph_rows, footnoteKey = NULL)))
      }

      # Dunnett's test (compare each group to a single control) — SPSS: "the
      # last category is the default control category"; option
      # opts$dunnettControl = "first" switches to the first category. This is
      # k-1 comparisons, not pairwise, so SPSS reports it as its own table
      # ("Dunnett t-tests (2-sided)"), not merged into Multiple Comparisons.
      # Uses multcomp::glht(mcp(Dunnett)) — Dunnett's own multivariate-t
      # critical value has no base-R implementation, and multcomp is the
      # standard, battle-tested package for it (not hand-rolled).
      if (isTRUE(opts$dunnett)) {
        if (requireNamespace("multcomp", quietly = TRUE) && k >= 2) {
          control_lvl <- if (identical(opts$dunnettControl, "first")) lvls[1] else lvls[length(lvls)]
          g_fac <- stats::relevel(factor(g, levels = lvls), ref = control_lvl)
          fit_d <- tryCatch(
            if (is.null(wv)) stats::aov(x ~ g_fac) else stats::aov(x ~ g_fac, weights = wv),
            error = function(e) NULL
          )
          # Frequency weights stand for sum(wv) cases: the error df is
          # sum(wv) - k and the aov covariance (RSS / (rows - k)) is rescaled
          # to match, instead of using the row count.
          glht_args <- list(fit_d, linfct = multcomp::mcp(g_fac = "Dunnett"))
          if (!is.null(wv)) {
            k_g <- nlevels(g_fac); df_w <- sum(wv) - k_g; ratio_w <- (length(x) - k_g) / df_w
            glht_args$vcov. <- function(m) stats::vcov(m) * ratio_w
            glht_args$df <- df_w
          }
          mc <- if (!is.null(fit_d)) tryCatch(
            do.call(multcomp::glht, glht_args),
            error = function(e) NULL
          ) else NULL
          if (!is.null(mc)) {
            sm  <- summary(mc)
            cfi <- suppressWarnings(stats::confint(mc, level = 1 - alpha))$confint
            cn  <- names(sm$test$coefficients)
            dunnett_rows <- lapply(seq_along(cn), function(ii) list(
              sub(" - .*$", "", cn[ii]), control_lvl,
              round(unname(sm$test$coefficients[ii]), 4),
              round(unname(sm$test$sigma[ii]), 4),
              round(unname(sm$test$pvalues[ii]), 6),
              round(unname(cfi[ii, "lwr"]), 4),
              round(unname(cfi[ii, "upr"]), 4)))
            tables <- c(tables, list(list(
              titleKey = paste0("output.anova.dunnettTitle:", nm),
              columns  = list("output.col.groupI", "output.col.controlGroup",
                              "output.col.meanDiff", "output.col.stdError", "output.col.sig",
                              paste0("output.col.ciLowerPct:", ci_pct),
                              paste0("output.col.ciUpperPct:", ci_pct)),
              rows     = dunnett_rows, footnoteKey = "output.anova.dunnettFootnote")))
          }
        }
      }
    }

    # ── Homogeneous Subsets ────────────────────────────────────────────────
    # SNK, Duncan, Ryan-Einot-Gabriel-Welsch Range and Waller-Duncan don't
    # produce a pairwise-comparison table at all in SPSS — a "subset" grouping
    # (means that group together are not significantly different) is their
    # only output. Tukey HSD and Scheffe get a subset table IN ADDITION to
    # their pairwise one above, reusing whichever is already selected.
    #
    # The grouping itself comes from agricolae (duncan.test/SNK.test/
    # HSD.test/scheffe.test/waller.test/REGW.test, all group=TRUE) rather than
    # a hand-rolled algorithm — CLAUDE.md §11's "eşleşen paket varsa paketi
    # kullan" — and was cross-checked against SPSS's own published subset
    # membership for this exact dataset shape (single-subset and two-subset
    # cases) before shipping. The per-subset "Sig." row is included only for
    # Tukey HSD/SNK/Duncan, whose formulas were independently re-derived and
    # matched SPSS's displayed values exactly (harmonic-mean-N studentized
    # range/Duncan's range test — see tests/r-validation/test-anova-oneway-
    # homogeneous-subsets.R). Scheffe/REGW Range/Waller-Duncan's own subset
    # "Sig." formula could not be reproduced with confidence from published
    # sources, so — same stance as the omitted Levene "median + adjusted df"
    # variant and the missing eta² CI — it is left out rather than guessed;
    # the subset membership itself (independently verified) is still shown.
    hs_wanted <- c('tukey', 'scheffe', 'snk', 'duncan', 'regwQ', 'wallerDuncan')
    if (any(vapply(hs_wanted, function(kk) isTRUE(opts[[kk]]), logical(1)))) {
      # Independent of the pairwise-methods block above (SNK/Duncan/REGW/
      # Waller-Duncan have no pairwise table, so that block — and its `alpha`
      # — may never have run this iteration).
      hs_alpha <- suppressWarnings(as.numeric(opts$sigLevel))
      if (is.null(hs_alpha) || length(hs_alpha) == 0 || is.na(hs_alpha) || hs_alpha <= 0 || hs_alpha >= 1) hs_alpha <- 0.05
      if (!requireNamespace('agricolae', quietly = TRUE)) {
        warns <- c(warns, 'output.warn.agricolaeNotAvailable')
      } else {
        hs_x <- x; hs_g <- g; hs_ok <- TRUE
        if (!is.null(wv)) {
          if (any(abs(wv - round(wv)) > 1e-8)) {
            warns <- c(warns, 'output.warn.homogeneousSubsetsNotComputed'); hs_ok <- FALSE
          } else {
            reps <- pmax(as.integer(round(wv)), 0L)
            idx  <- rep(seq_along(hs_x), reps)
            hs_x <- hs_x[idx]; hs_g <- hs_g[idx]
          }
        }
        if (hs_ok) {
          hs_lvls <- levels(g)
          hs_ni   <- if (is.null(wv)) as.numeric(tapply(x, g, length)) else
            vapply(idx_by_g, function(idx) sum(wv[idx]), numeric(1))
          names(hs_ni) <- hs_lvls
          hs_nh   <- length(hs_lvls) / sum(1 / hs_ni)  # SPSS's "Harmonic Mean Sample Size"
          hs_sdtdif <- sqrt(msw / hs_nh)

          to_subset_rows <- function(groups_df, sig_fn = NULL) {
            letters_by_lvl <- setNames(as.character(groups_df$groups), rownames(groups_df))[hs_lvls]
            means_by_lvl   <- setNames(groups_df[[1]], rownames(groups_df))[hs_lvls]
            all_letters <- sort(unique(unlist(strsplit(letters_by_lvl, ''))))
            subset_mean <- vapply(all_letters, function(L) {
              min(means_by_lvl[grepl(L, letters_by_lvl, fixed = TRUE)])
            }, numeric(1))
            all_letters <- all_letters[order(subset_mean)]
            rows <- lapply(hs_lvls[order(means_by_lvl)], function(lvl) {
              c(list(lvl, cnt(hs_ni[lvl])), lapply(all_letters, function(L) {
                if (grepl(L, letters_by_lvl[lvl], fixed = TRUE)) round(means_by_lvl[lvl], 6) else NULL
              }))
            })
            if (!is.null(sig_fn)) {
              sig_cells <- lapply(all_letters, function(L) {
                members <- means_by_lvl[grepl(L, letters_by_lvl, fixed = TRUE)]
                round(if (length(members) < 2) 1 else sig_fn(diff(range(members)), length(members)), 6)
              })
              rows <- c(rows, list(c(list('output.anova.sigRow', NA_real_), sig_cells)))
            }
            list(rows = rows, nSubsets = length(all_letters))
          }

          add_hs_table <- function(method_key, fit, sig_fn = NULL) {
            built <- to_subset_rows(fit$groups, sig_fn)
            cols <- c(list(fname, 'output.col.n'),
                      lapply(seq_len(built$nSubsets), function(i) paste0('output.anova.subsetN:', i)))
            tables <<- c(tables, list(list(
              titleKey    = paste0('output.anova.homogSubsetsTitle:', nm, '|', method_key),
              columns     = cols, rows = built$rows,
              footnoteKey = paste0('output.anova.harmonicMeanFootnote:', round(hs_nh, 3)))))
          }

          sig_tukey  <- function(rng, r) ptukey(rng / hs_sdtdif, length(hs_lvls), dfw, lower.tail = FALSE)
          sig_snk    <- function(rng, r) ptukey(rng / hs_sdtdif, r, dfw, lower.tail = FALSE)
          sig_duncan <- function(rng, r) 1 - ptukey(rng / hs_sdtdif, r, dfw)^(1 / (r - 1))

          # agricolae::REGW.test has an off-by-one bug in its own source for
          # EXACTLY 3 groups: its internal loop `for (i in 2:(ntr - 2))`
          # becomes `2:1` (R counts DOWN, not an empty range) when ntr==3,
          # which corrupts Tprob and then a later bounds check
          # (`Tprob[ntr - 3] > Tprob[ntr - 2]`, i.e. `Tprob[0] > Tprob[1]`)
          # throws "argument is of length zero" — silently dropping the whole
          # REGW Range table for the single most common ANOVA group count.
          # Reimplemented here from the SAME documented formula (read from
          # REGW.test's own source, not a new derivation): for ntr<=3 every
          # comparison's span already exceeds ntr-2, so the buggy branch is
          # never reachable at all — this only fixes the boundary, it doesn't
          # change the math for ntr>3 (cross-checked against agricolae's own
          # output on the CRP fixture in test-anova-homogeneous-subsets.R).
          regw_groups <- function(x, g, dfw, msw, alpha) {
            lvls <- levels(g); ntr <- length(lvls)
            mns <- tapply(x, g, mean)[lvls]
            ni  <- tapply(x, g, length)[lvls]
            nr1 <- if (length(unique(ni)) == 1) unique(ni) else 1 / mean(1 / ni)
            sdtdif <- sqrt(msw / nr1)
            Omeans <- order(mns, decreasing = TRUE); Ordindex <- order(Omeans)
            comb <- utils::combn(ntr, 2)
            Q <- matrix(1, ntr, ntr)
            for (kk in seq_len(ncol(comb))) {
              i <- comb[1, kk]; j <- comb[2, kk]
              DIFF <- abs(mns[i] - mns[j])
              odif <- abs(Ordindex[i] - Ordindex[j]) + 1
              pval <- if (odif <= ntr - 2) 1 - (ptukey(DIFF / sdtdif, odif, dfw))^(ntr / odif)
                      else 1 - ptukey(DIFF / sdtdif, odif, dfw)
              Q[i, j] <- pval; Q[j, i] <- pval
            }
            list(groups = agricolae::orderPvalue(lvls, as.vector(mns), alpha, Q, FALSE))
          }

          if (isTRUE(opts$tukey)) tryCatch(
            add_hs_table('output.col.tukeyHSD', agricolae::HSD.test(hs_x, hs_g, dfw, msw, alpha = hs_alpha, group = TRUE), sig_tukey),
            error = function(e) warns <<- c(warns, 'output.warn.homogeneousSubsetsNotComputed'))
          if (isTRUE(opts$scheffe)) tryCatch(
            add_hs_table('output.col.scheffe', agricolae::scheffe.test(hs_x, hs_g, dfw, msw, Fv, alpha = hs_alpha, group = TRUE)),
            error = function(e) warns <<- c(warns, 'output.warn.homogeneousSubsetsNotComputed'))
          if (isTRUE(opts$snk)) tryCatch(
            add_hs_table('output.anova.snk', agricolae::SNK.test(hs_x, hs_g, dfw, msw, alpha = hs_alpha, group = TRUE), sig_snk),
            error = function(e) warns <<- c(warns, 'output.warn.homogeneousSubsetsNotComputed'))
          if (isTRUE(opts$duncan)) tryCatch(
            add_hs_table('output.anova.duncan', agricolae::duncan.test(hs_x, hs_g, dfw, msw, alpha = hs_alpha, group = TRUE), sig_duncan),
            error = function(e) warns <<- c(warns, 'output.warn.homogeneousSubsetsNotComputed'))
          if (isTRUE(opts$regwQ)) tryCatch(
            add_hs_table('output.anova.regwQ', regw_groups(hs_x, hs_g, dfw, msw, hs_alpha)),
            error = function(e) warns <<- c(warns, 'output.warn.homogeneousSubsetsNotComputed'))
          if (isTRUE(opts$wallerDuncan)) tryCatch(
            add_hs_table('output.anova.wallerDuncan', agricolae::waller.test(
              hs_x, hs_g, dfw, msw, Fv, K = if (!is.null(opts$wallerK)) as.numeric(opts$wallerK) else 100, group = TRUE)),
            # waller.test's K-ratio formula can fail to resolve when the
            # observed F ratio is below ~1 (an internal (K - IN0/ID0)*(K -
            # IN1/ID1) sign check hits a missing value) — an F this small
            # already means "nothing to group" in every other method, so skip
            # + warn instead of erroring out the whole analysis.
            error = function(e) warns <<- c(warns, 'output.warn.wallerDuncanNotComputed'))
        }
      }
    }
  }

  if (length(tables) == 0) sai_error("Not enough data for ANOVA")

  if (length(boot_rows) > 0) {
    tables <- c(tables, list(list(
      titleKey    = "output.bootstrap.meanTitle",
      columns     = list("output.col.variable", "output.col.mean", "output.bootstrap.bias",
                         "output.bootstrap.stdError", "output.bootstrap.ciLower",
                         "output.bootstrap.ciUpper"),
      rows        = boot_rows,
      footnoteKey = "output.bootstrap.footnote"
    )))
  }

  progress(100L, "progress.done")
  sai_output(tables = tables, plots = plots, warnings = warns)

}, error = function(e) {
  sai_error(conditionMessage(e))
})
