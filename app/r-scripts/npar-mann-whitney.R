# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# npar-mann-whitney.R — Mann-Whitney U (2 Independent Samples, SPSS-style).
#
# Params: variables (colIds), varNames, groupVar, groupName, group1, group2,
#         options$descriptives, options$quartiles, options$effectSize,
#         options$boxplot, options$continuityCorrection (default FALSE).
# Output: "Ranks" (N, Mean Rank, Sum of Ranks per group) + "Test Statistics"
#         (Mann-Whitney U, Wilcoxon W, Z, Asymp. Sig. 2-tailed, Exact Sig.),
#         plus three optional blocks (all on by default in the dialog):
#         "Descriptive Statistics", "Effect Size" and a grouped box plot.
#
# Science-over-SPSS policy (CLAUDE.md §11): the asymptotic tie-corrected Z is
# kept as an SPSS-comparable reference, but the scientifically correct answer
# for small samples is the EXACT p-value — computed here by base R's own
# stats::wilcox.test(exact=TRUE) whenever it is valid (no ties in the pooled
# ranking and both groups < 50). This is exactly how SPSS's own Exact Tests
# module presents it (Asymp. Sig. + Exact Sig. side by side). The asymptotic Z
# is SPSS's tie-corrected Z with NO continuity term (SPSS NPAR TESTS
# algorithms; confirmed by tests/spss-parity, -2.481 vs -2.478 corrected); the
# ±0.5 correction R's wilcox.test(correct=TRUE) uses is offered as an opt-in.
#
# The same policy drives the three optional blocks:
#   * SPSS's /STATISTICS=DESCRIPTIVES QUARTILES pools ALL cases into one row per
#     variable — the grouping variable's own mean lands in the table and the two
#     groups being compared are nowhere to be seen, which is useless next to a
#     two-sample test. Here the summary is split BY GROUP (plus a Total row for
#     the SPSS-comparable pooled figure), because "Median (IQR) per group" is
#     the reporting format a rank test actually calls for.
#   * A rank test's p-value carries no magnitude, and APA-style reporting wants
#     one, so Effect Size adds r = |Z|/sqrt(N) (Rosenthal), the rank-biserial
#     correlation, and the Hodges-Lehmann median difference with its CI — the
#     only one of the four that is in the data's own units.
#   * The box plot is drawn from the SAME five numbers as the table
#     (precomputed q1/median/q3/fences, not raw points): a nonparametric
#     comparison is about distribution shape, and shipping the raw vector to
#     the renderer would put a 100k-point payload in the output document.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  vars  <- unlist(params$variables); var_names <- params$varNames
  gvar  <- params$groupVar
  gname <- if (is.null(params$groupName)) gvar else params$groupName
  g1 <- as.character(params$group1); g2 <- as.character(params$group2)
  if (length(vars) == 0) sai_error("No test variables")
  if (is.null(gvar) || !gvar %in% names(df)) sai_error("Grouping variable not found")

  # Missing Values (MV): "Exclude cases test by test" (default — per-variable
  # `keep` mask below) vs "Exclude cases listwise" (drop a case if ANY test
  # variable or the grouping variable is missing) — same contract as
  # npar-kruskal-wallis.R / anova-oneway.R.
  df <- apply_listwise(df, c(vars, gvar), params)
  gall <- as.character(df[[gvar]])
  rank_rows <- list(); test_rows <- list(); desc_rows <- list(); eff_rows <- list()
  plots <- list()

  want_desc  <- isTRUE(params$options$descriptives)
  want_quart <- isTRUE(params$options$quartiles)
  want_eff   <- isTRUE(params$options$effectSize)
  want_box   <- isTRUE(params$options$boxplot)
  # Science-over-SPSS (CLAUDE.md §11): base R's own wilcox.test(exact=TRUE)
  # already covers the common case (no ties, both groups < 50) via pExact
  # below; the Exact button's real value is the cases that gate leaves blank —
  # larger samples or tied data, where only the `coin` package's network
  # algorithm can still produce one. "exact" fills the SAME Exact Sig. column
  # (it is the same quantity, just computed a different way — see the pExact
  # block below); "montecarlo" is a genuinely different, approximate quantity
  # and gets its own column, same pattern as npar-kruskal-wallis.R.
  want_pmethod <- !is.null(params$options$pMethod) &&
    identical(params$options$pMethod$method, "montecarlo")
  # The asymptotic Z column is the SPSS-comparable figure (the exact p sits
  # beside it), and SPSS's Z carries no continuity correction — an earlier
  # version assumed it did and was off in the third decimal on every
  # comparison. Off by default; the ±0.5 correction (R's wilcox.test default)
  # stays available as an option.
  want_cc    <- isTRUE(params$options$continuityCorrection)
  g1lab <- resolve_var_name(g1, params$groupValueLabels)
  g2lab <- resolve_var_name(g2, params$groupValueLabels)
  box_colors <- c("#3b6ea5", "#e07b39")

  # One group's summary: N + the descriptive half + the quartile half, in the
  # column order assembled below. Both halves are optional and independent, so
  # the row is built with the same `if (want_*)` sequence as the header — the
  # two must stay in lockstep.
  summary_cells <- function(xs) {
    q <- wtd_quantile(xs, probs = c(0.25, 0.5, 0.75))
    c(list(length(xs)),
      if (want_desc) list(round_half_up(mean(xs), 3),
                          round_half_up(if (length(xs) > 1) sd(xs) else NA_real_, 3),
                          round_half_up(min(xs), 3)),
      if (want_quart) list(round_half_up(q[1], 3), round_half_up(q[2], 3),
                           round_half_up(q[3], 3)),
      if (want_desc) list(round_half_up(max(xs), 3)),
      if (want_quart) list(round_half_up(q[3] - q[1], 3)))
  }

  for (v in vars) {
    nm <- if (!is.null(var_names[[v]])) var_names[[v]] else v
    xv <- suppressWarnings(as.numeric(df[[v]]))
    keep <- !is.na(xv) & !is.na(gall) & gall != "NA" & (gall == g1 | gall == g2)
    x <- xv[keep]; g <- gall[keep]
    n1 <- sum(g == g1); n2 <- sum(g == g2)
    if (n1 < 1 || n2 < 1) next
    r  <- rank(x)
    R1 <- sum(r[g == g1]); R2 <- sum(r[g == g2]); N <- n1 + n2
    rank_rows <- c(rank_rows,
      list(list(nm, resolve_var_name(g1, params$groupValueLabels), n1, round_half_up(R1 / n1, 2), round_half_up(R1, 2))),
      list(list("", resolve_var_name(g2, params$groupValueLabels), n2, round_half_up(R2 / n2, 2), round_half_up(R2, 2))),
      list(list("", "output.col.total", N, "", "")))
    U1 <- R1 - n1 * (n1 + 1) / 2; U2 <- n1 * n2 - U1; U <- min(U1, U2)
    W  <- min(R1, R2)
    tct <- table(r); tie <- sum(tct^3 - tct)
    sigma <- sqrt((n1 * n2 / 12) * ((N + 1) - tie / (N * (N - 1))))
    z_num <- U - n1 * n2 / 2
    if (want_cc && z_num != 0) z_num <- z_num - sign(z_num) * 0.5
    Z <- z_num / sigma
    p <- 2 * pnorm(-abs(Z))

    # Exact p (science-over-SPSS): base R computes the exact Mann-Whitney
    # distribution only when there are no ties in the pooled sample and both
    # groups are < 50 (its own `exact=TRUE` preconditions). Outside that,
    # wilcox.test() silently falls back to the normal approximation, so we
    # gate on the same conditions and leave Exact Sig. blank otherwise —
    # rather than mislabel an approximation as "exact".
    exact_ok <- n1 < 50 && n2 < 50 && !any(duplicated(x))
    pExact <- if (exact_ok) {
      tryCatch(
        suppressWarnings(wilcox.test(x[g == g1], x[g == g2], exact = TRUE)$p.value),
        error = function(e) NA_real_
      )
    } else NA_real_

    # The Exact button's `coin` path (network algorithm) computes the SAME
    # quantity as pExact above, just for the cases base R's exact_ok gate
    # excludes (ties, or either group >= 50) — it fills the same "Exact Sig."
    # column rather than adding a second one, and is only attempted when
    # pExact is still missing (no point re-deriving what R already has).
    # Monte Carlo is a genuinely different (approximate) quantity, so it gets
    # its own column, same as npar-kruskal-wallis.R.
    want_exact <- !is.null(params$options$pMethod) &&
      identical(params$options$pMethod$method, "exact")
    if (want_exact && is.na(pExact)) {
      mc <- sai_coin_pvalue(function(dist) {
        coin::wilcox_test(x ~ factor(g), data = data.frame(x = x, g = g), distribution = dist)
      }, params)
      if (!is.null(mc)) pExact <- mc$p.value
    }

    ts_row <- list(nm, round(U, 3), round(W, 3), round(Z, 3), round(p, 6),
      if (is.na(pExact)) NULL else round(pExact, 6))
    if (want_pmethod) {
      mc <- sai_coin_pvalue(function(dist) {
        coin::wilcox_test(x ~ factor(g), data = data.frame(x = x, g = g), distribution = dist)
      }, params)
      ts_row <- c(ts_row, list(if (is.null(mc)) NULL else round(mc$p.value, 6)))
    }
    test_rows <- c(test_rows, list(ts_row))

    x1 <- x[g == g1]; x2 <- x[g == g2]

    # Descriptive Statistics — per group, then the pooled Total row (the figure
    # SPSS's own DESCRIPTIVES/QUARTILES would print).
    if (want_desc || want_quart) {
      desc_rows <- c(desc_rows,
        list(c(list(nm, g1lab), summary_cells(x1))),
        list(c(list("", g2lab), summary_cells(x2))),
        list(c(list("", "output.col.total"), summary_cells(x))))
    }

    # Effect size. r = |Z|/sqrt(N) uses the tie-corrected Z above, so it
    # inherits the same tie handling as the reported p-value. The rank-biserial
    # correlation is U1's own rescaling: +1 when every group-1 case outranks
    # every group-2 case, -1 for the reverse, 0 at complete overlap.
    # Hodges-Lehmann is the median of all pairwise differences (group 1 - group
    # 2) with the CI that inverts the same test — the only figure here in the
    # variable's own units, which is what a reader can actually interpret.
    if (want_eff) {
      r_eff <- abs(Z) / sqrt(N)
      rrb <- 2 * U1 / (n1 * n2) - 1
      hl <- tryCatch(
        suppressWarnings(wilcox.test(x1, x2, conf.int = TRUE, exact = exact_ok)),
        error = function(e) NULL
      )
      hl_est <- if (is.null(hl)) NA_real_ else unname(hl$estimate)
      hl_lo  <- if (is.null(hl)) NA_real_ else hl$conf.int[1]
      hl_hi  <- if (is.null(hl)) NA_real_ else hl$conf.int[2]
      eff_rows <- c(eff_rows, list(list(nm, round(r_eff, 3), round(rrb, 3),
        round_half_up(hl_est, 3), round_half_up(hl_lo, 3), round_half_up(hl_hi, 3))))
    }

    # Box plot from precomputed five-number summaries (Tukey fences pulled back
    # to the last observation inside 1.5 x IQR, the standard construction).
    if (want_box) {
      traces <- list()
      for (i in 1:2) {
        xs <- if (i == 1) x1 else x2
        q <- wtd_quantile(xs, probs = c(0.25, 0.5, 0.75))
        iqr <- q[3] - q[1]
        inner_lo <- xs[xs >= q[1] - 1.5 * iqr]; inner_hi <- xs[xs <= q[3] + 1.5 * iqr]
        lab <- if (i == 1) g1lab else g2lab
        # `x` puts each box in its own category. Without it Plotly stacks both
        # traces at position 0 (boxmode defaults to "overlay"), which draws the
        # two groups on top of each other instead of side by side.
        traces[[i]] <- list(
          type = "box", name = lab, x = list(lab),
          q1 = list(q[1]), median = list(q[2]), q3 = list(q[3]),
          lowerfence = list(if (length(inner_lo)) min(inner_lo) else min(xs)),
          upperfence = list(if (length(inner_hi)) max(inner_hi) else max(xs)),
          mean = list(mean(xs)), boxmean = TRUE,
          marker = list(color = box_colors[i]), showlegend = FALSE)
      }
      plots[[length(plots) + 1L]] <- list(
        titleKey = paste0("output.npar.boxTitle:", nm),
        type = "plotly",
        data = list(data = traces,
                    layout = list(yaxis = list(title = list(text = nm)),
                                  xaxis = list(title = list(text = gname)),
                                  margin = list(t = 40, r = 20, b = 40, l = 60))))
    }
  }
  if (length(test_rows) == 0) sai_error("Not enough data in the two groups")

  # Column header assembled with the same `if (want_*)` sequence as
  # summary_cells() above — edit the two together or the header slides off its
  # values.
  desc_cols <- c(list("output.col.variable", gname, "output.col.n"),
    if (want_desc) list("output.col.mean", "output.col.sd", "output.col.min"),
    if (want_quart) list("output.col.p25", "output.col.median", "output.col.p75"),
    if (want_desc) list("output.col.max"),
    if (want_quart) list("output.col.iqr"))

  desc_table <- if (length(desc_rows)) {
    list(list(titleKey = "output.npar.descriptivesTitle", columns = desc_cols,
              rows = desc_rows, footnoteKey = paste0("output.npar.groupingFootnote:", gname)))
  } else list()
  eff_table <- if (length(eff_rows)) {
    list(list(titleKey = "output.npar.effectSizeTitle",
              columns = list("output.col.variable", "output.npar.effectR",
                             "output.npar.rankBiserial", "output.npar.hodgesLehmann",
                             "output.col.ciLower95", "output.col.ciUpper95"),
              rows = eff_rows,
              footnoteKey = paste0("output.npar.effectSizeFootnote:", g1lab, "|", g2lab)))
  } else list()

  progress(100L, "progress.done")
  sai_output(tables = c(list(
    list(titleKey = "output.npar.ranksTitle",
         columns = list("output.col.variable", gname, "output.col.n",
                        "output.col.meanRank", "output.col.sumRanks"),
         rows = rank_rows, footnoteKey = NULL),
    list(titleKey = "output.npar.testStatsTitle",
         columns = c(list("output.col.variable", "output.col.mannWhitneyU",
                          "output.col.wilcoxonW", "output.col.z", "output.col.asympSig",
                          "output.col.exactSig"),
                    if (want_pmethod) list("output.col.monteCarloSig") else list()),
         rows = test_rows, footnoteKey = paste0("output.npar.groupingFootnote:", gname))
  ), desc_table, eff_table), plots = plots)
}, error = function(e) sai_error(conditionMessage(e)))
