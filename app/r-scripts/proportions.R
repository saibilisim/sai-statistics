# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# proportions.R — Compare Means and Proportions: One-/Independent-/Paired-
# Sample Proportions (SPSS 27+, see spss-parity-analysis.md §3.5).
#
# Params (from JSON):
#   design       — "one" | "independent" | "paired"
#   successValue — the value counted as "success" (coerced to character compare)
#   ciLevel      — confidence level in percent (default 95)
#   one:         variable, varName, testValue (p0, default 0.5)
#   independent: variable, varName, groupVar, groupVarName
#   paired:      variable1, varName1, variable2, varName2
#
# Output: one table with N/Proportion + Wald/Wilson/Clopper-Pearson (exact)
#         CIs (one-sample), or Wald/Newcombe CI + z-test (independent), or
#         paired Wald CI + exact McNemar test (paired).

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

#' Wilson score confidence interval for a single proportion.
wilson_ci <- function(x, n, conf = 0.95) {
  z <- qnorm(1 - (1 - conf) / 2)
  phat <- x / n
  denom <- 1 + z^2 / n
  center <- (phat + z^2 / (2 * n)) / denom
  half <- z * sqrt(phat * (1 - phat) / n + z^2 / (4 * n^2)) / denom
  c(center - half, center + half)
}

tryCatch({
  progress(10L, "progress.loading")

  design <- params$design
  if (is.null(design)) sai_error("No design specified")
  success <- if (is.null(params$successValue)) "1" else as.character(params$successValue)
  conf <- if (is.null(params$ciLevel)) 0.95 else as.numeric(params$ciLevel) / 100
  z <- qnorm(1 - (1 - conf) / 2)
  warns <- character(0)

  # If the chosen success value never occurs (or the variable carries more
  # than the two categories a proportions test compares), every row silently
  # collapses to a 0/0 proportion with an undefined Sig. — mathematically
  # consistent but almost always a wrong success-value/variable pick. Flag it
  # instead of returning a table that looks broken with no explanation.
  check_dichotomy <- function(xv, success, varLabel) {
    cats <- unique(xv)
    if (!success %in% cats) {
      return(paste0("output.proportions.successNotFoundWarning:", varLabel, "|", success))
    }
    if (length(cats) > 2) {
      return(paste0("output.proportions.notDichotomousWarning:", varLabel, "|", length(cats)))
    }
    character(0)
  }

  progress(40L, "progress.computing")

  if (design == "one") {
    v <- params$variable
    nm <- if (is.null(params$varName)) v else params$varName
    p0 <- if (is.null(params$testValue)) 0.5 else as.numeric(params$testValue)
    if (is.null(v) || !v %in% names(df)) sai_error("Variable not found")

    xv <- as.character(apply_user_missing(df[[v]], v, params))
    xv <- xv[!is.na(xv)]
    n <- length(xv)
    if (n < 1) sai_error("No valid cases")
    warns <- c(warns, check_dichotomy(xv, success, nm))
    x <- sum(xv == success)
    phat <- x / n
    se <- sqrt(phat * (1 - phat) / n)

    wald <- c(phat - z * se, phat + z * se)
    wilson <- wilson_ci(x, n, conf)
    exact <- binom.test(x, n, p = p0, conf.level = conf)$conf.int
    sig <- binom.test(x, n, p = p0)$p.value

    tables <- list(list(
      titleKey = "output.proportions.oneTitle",
      columns = list(
        "output.col.variable", "output.col.n", "output.proportions.observed",
        "output.proportions.stdError", "output.proportions.waldLower",
        "output.proportions.waldUpper", "output.proportions.wilsonLower",
        "output.proportions.wilsonUpper", "output.proportions.exactLower",
        "output.proportions.exactUpper", "output.col.sig"
      ),
      rows = list(list(
        nm, n, round(phat, 6), round(se, 6),
        round(wald[1], 6), round(wald[2], 6),
        round(wilson[1], 6), round(wilson[2], 6),
        round(exact[1], 6), round(exact[2], 6),
        round(sig, 6)
      )),
      footnoteKey = paste0("output.proportions.testValueFootnote:", p0)
    ))
  } else if (design == "independent") {
    v <- params$variable
    nm <- if (is.null(params$varName)) v else params$varName
    g <- params$groupVar
    gname <- if (is.null(params$groupVarName)) g else params$groupVarName
    if (is.null(v) || !v %in% names(df)) sai_error("Variable not found")
    if (is.null(g) || !g %in% names(df)) sai_error("Group variable not found")

    xv <- as.character(apply_user_missing(df[[v]], v, params))
    gv <- as.character(apply_user_missing(df[[g]], g, params))
    keep <- !is.na(xv) & !is.na(gv)
    xv <- xv[keep]; gv <- gv[keep]
    levs <- unique(gv)
    if (length(levs) != 2) sai_error("Group variable must have exactly 2 levels")
    warns <- c(warns, check_dichotomy(xv, success, nm))

    n1 <- sum(gv == levs[1]); x1 <- sum(gv == levs[1] & xv == success)
    n2 <- sum(gv == levs[2]); x2 <- sum(gv == levs[2] & xv == success)
    p1 <- x1 / n1; p2 <- x2 / n2
    diff <- p1 - p2

    pooled <- (x1 + x2) / (n1 + n2)
    se_pooled <- sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))
    zval <- diff / se_pooled
    sig <- 2 * pnorm(-abs(zval))

    se_wald <- sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
    wald <- c(diff - z * se_wald, diff + z * se_wald)

    w1 <- wilson_ci(x1, n1, conf); w2 <- wilson_ci(x2, n2, conf)
    newcombe <- c(
      diff - sqrt((p1 - w1[1])^2 + (w2[2] - p2)^2),
      diff + sqrt((w1[2] - p1)^2 + (p2 - w2[1])^2)
    )

    tables <- list(list(
      titleKey = paste0("output.proportions.indepTitle:", gname),
      columns = list(
        gname, "output.col.n", "output.proportions.observed",
        "output.proportions.difference", "output.proportions.stdError",
        "output.proportions.waldLower", "output.proportions.waldUpper",
        "output.proportions.newcombeLower", "output.proportions.newcombeUpper",
        "output.col.sig"
      ),
      rows = list(
        list(resolve_var_name(levs[1], params$groupValueLabels), n1, round(p1, 6), "", "", "", "", "", "", ""),
        list(resolve_var_name(levs[2], params$groupValueLabels), n2, round(p2, 6),
             round(diff, 6), round(se_wald, 6),
             round(wald[1], 6), round(wald[2], 6),
             round(newcombe[1], 6), round(newcombe[2], 6),
             round(sig, 6))
      ),
      footnoteKey = paste0("output.proportions.successFootnote:", success)
    ))
  } else if (design == "paired") {
    v1 <- params$variable1; v2 <- params$variable2
    nm1 <- if (is.null(params$varName1)) v1 else params$varName1
    nm2 <- if (is.null(params$varName2)) v2 else params$varName2
    if (is.null(v1) || !v1 %in% names(df)) sai_error("First variable not found")
    if (is.null(v2) || !v2 %in% names(df)) sai_error("Second variable not found")

    x1 <- as.character(apply_user_missing(df[[v1]], v1, params))
    x2 <- as.character(apply_user_missing(df[[v2]], v2, params))
    keep <- !is.na(x1) & !is.na(x2)
    x1 <- x1[keep]; x2 <- x2[keep]
    n <- length(x1)
    if (n < 1) sai_error("No valid cases")
    warns <- c(warns, check_dichotomy(x1, success, nm1), check_dichotomy(x2, success, nm2))

    s1 <- as.integer(x1 == success); s2 <- as.integer(x2 == success)
    p1 <- mean(s1); p2 <- mean(s2)
    p11 <- mean(s1 == 1 & s2 == 1)
    diff <- p1 - p2
    var_diff <- (p1 * (1 - p1) + p2 * (1 - p2) - 2 * (p11 - p1 * p2)) / n
    se <- if (var_diff > 0) sqrt(var_diff) else 0
    ci <- c(diff - z * se, diff + z * se)

    # McNemar on the discordant pairs, both ways round.
    #
    # `sig` is the EXACT test: the number of b-type discordances against
    # Binomial(b + cc, 1/2). `sig_asymp` is the classic normal approximation,
    # z = (b - cc)/sqrt(b + cc). CLAUDE.md §11 asks for exactly this pairing —
    # keep the SPSS-style asymptotic column, add the exact one beside it — so a
    # user can read the value their reference reports AND the one that is right
    # when the discordant count is small. Reporting only the exact left a
    # difference on the table that looked like an error and was not.
    b <- sum(s1 == 1 & s2 == 0); cc <- sum(s1 == 0 & s2 == 1)
    sig <- min(1, 2 * pbinom(min(b, cc), b + cc, 0.5))
    nd <- b + cc
    z_mcnemar <- if (nd > 0) (b - cc) / sqrt(nd) else NA_real_
    sig_asymp <- if (nd > 0) 2 * pnorm(-abs(z_mcnemar)) else NA_real_

    tables <- list(list(
      titleKey = "output.proportions.pairedTitle",
      columns = list(
        "output.col.variable", "output.col.n", "output.proportions.observed",
        "output.proportions.difference", "output.proportions.stdError",
        "output.proportions.waldLower", "output.proportions.waldUpper",
        "output.col.z", "output.col.asympSig", "output.col.exactSig"
      ),
      rows = list(
        list(nm1, n, round(p1, 6), "", "", "", "", "", "", ""),
        list(nm2, n, round(p2, 6), round(diff, 6), round(se, 6),
             round(ci[1], 6), round(ci[2], 6),
             if (is.na(z_mcnemar)) "" else round(z_mcnemar, 3),
             if (is.na(sig_asymp)) "" else round(sig_asymp, 6),
             round(sig, 6))
      ),
      footnoteKey = paste0("output.proportions.successFootnote:", success)
    ))
  } else {
    sai_error(paste("Unknown design:", design))
  }

  # ── Confidence Intervals / Tests sub-dialogs (SPSS 27+) ────────────────────
  # One row per requested method, computed exactly as the SPSS Statistics
  # Algorithms manual (PROPORTIONS) defines it. Two misprints in that manual
  # are NOT copied: the paired Wald interval is centred on the observed
  # difference (n10 - n01)/n, not (n10 - n01)/(n + 2), and the pooled
  # proportion for independent samples is (r1 + r2)/(n1 + n2), not /2n.
  ci_methods   <- unlist(params$ciMethods)
  test_methods <- unlist(params$testMethods)
  clamp <- function(v, lo, hi) pmin(pmax(v, lo), hi)
  ci_rows <- list(); test_rows <- list()
  add_ci <- function(key, lohi, lo = 0, hi = 1) {
    lohi <- clamp(lohi, lo, hi)
    cell <- function(v) if (is.na(v)) NULL else round_half_up(v, 6)
    ci_rows[[length(ci_rows) + 1L]] <<- list(paste0("output.proportions.ci.", key),
                                             cell(lohi[1]), cell(lohi[2]))
  }
  # Two-sided p for a Z statistic: 2 * min(Phi(Z), 1 - Phi(Z)).
  p_z <- function(zv) if (is.na(zv)) NA_real_ else 2 * min(pnorm(zv), 1 - pnorm(zv))
  add_test <- function(key, zv, pv) {
    test_rows[[length(test_rows) + 1L]] <<- list(paste0("output.proportions.test.", key),
      if (is.na(zv)) NULL else round_half_up(zv, 3), if (is.na(pv)) NULL else round(min(1, pv), 6))
  }
  # Continuity correction of size `cc` towards zero; 0 when it overshoots.
  cc_toward <- function(d, cc) if (abs(d) <= cc) 0 else d - sign(d) * cc
  wilson_cc <- function(r, nn) {
    ph <- r / nn
    rad_lo <- z^2 - 2 - 1 / nn + 4 * ph * (nn * (1 - ph) + 1)
    rad_hi <- z^2 + 2 - 1 / nn + 4 * ph * (nn * (1 - ph) - 1)
    lo <- if (r == 0) 0 else (2 * nn * ph + z^2 - 1 - z * sqrt(max(rad_lo, 0))) / (2 * (nn + z^2))
    hi <- if (r == nn) 1 else (2 * nn * ph + z^2 + 1 + z * sqrt(max(rad_hi, 0))) / (2 * (nn + z^2))
    c(max(0, lo), min(1, hi))
  }
  alpha_ci <- 1 - conf

  if (design == "one" && (length(ci_methods) || length(test_methods))) {
    r <- x; ph <- phat
    for (m in ci_methods) switch(m,
      agrestiCoull = { nt <- n + z^2; pt <- (r + z^2 / 2) / nt
                       add_ci(m, pt + c(-1, 1) * z * sqrt(pt * (1 - pt) / nt)) },
      anscombe = { cen <- log((r + .5) / (n - r + .5)); hw <- z * sqrt((n + 1) * (n + 2) / (n * (r + 1) * (n - r + 1)))
                   add_ci(m, 1 / (1 + exp(-(cen + c(-1, 1) * hw)))) },
      clopperPearson = add_ci(m, c(if (r == 0) 0 else qbeta(alpha_ci / 2, r, n - r + 1),
                                   if (r == n) 1 else qbeta(1 - alpha_ci / 2, r + 1, n - r))),
      jeffreys = add_ci(m, c(qbeta(alpha_ci / 2, r + .5, n - r + .5), qbeta(1 - alpha_ci / 2, r + .5, n - r + .5))),
      logit = if (r > 0 && r < n) {
                cen <- log(r / (n - r)); hw <- z * sqrt(n / (r * (n - r)))
                add_ci(m, 1 / (1 + exp(-(cen + c(-1, 1) * hw))))
              } else add_ci(m, c(NA, NA)),
      wald = add_ci(m, ph + c(-1, 1) * z * sqrt(ph * (1 - ph) / n)),
      waldCC = add_ci(m, ph + c(-1, 1) * (z * sqrt(ph * (1 - ph) / n) + 1 / (2 * n))),
      wilson = add_ci(m, wilson_ci(r, n, conf)),
      wilsonCC = add_ci(m, wilson_cc(r, n)))
    d <- ph - p0
    se0 <- sqrt(p0 * (1 - p0) / n); se1 <- sqrt(ph * (1 - ph) / n)
    p_lower <- pbinom(r, n, p0); p_upper <- 1 - pbinom(r - 1, n, p0)
    p1_exact <- min(p_lower, p_upper)
    for (m in test_methods) switch(m,
      exact = add_test(m, NA, 2 * p1_exact),
      midP = add_test(m, NA, 2 * (p1_exact - 0.5 * dbinom(r, n, p0))),
      score = { zv <- d / se0; add_test(m, zv, p_z(zv)) },
      scoreCC = { zv <- cc_toward(d, 1 / (2 * n)) / se0; add_test(m, zv, p_z(zv)) },
      wald = { zv <- if (se1 > 0) d / se1 else NA_real_; add_test(m, zv, p_z(zv)) },
      waldCC = { zv <- if (se1 > 0) cc_toward(d, 1 / (2 * n)) / se1 else NA_real_; add_test(m, zv, p_z(zv)) })
  }

  if (design == "independent" && (length(ci_methods) || length(test_methods))) {
    d <- p1 - p2
    se1 <- sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
    se_ha <- sqrt(p1 * (1 - p1) / (n1 - 1) + p2 * (1 - p2) / (n2 - 1))
    pp <- (x1 + x2) / (n1 + n2); se0 <- sqrt(pp * (1 - pp) / n1 + pp * (1 - pp) / n2)
    cc_w <- (1 / n1 + 1 / n2) / 2; cc_ha <- 1 / (2 * min(n1, n2))
    for (m in ci_methods) switch(m,
      agrestiCaffo = { a1 <- (x1 + 1) / (n1 + 2); a2 <- (x2 + 1) / (n2 + 2)
                       add_ci(m, a1 - a2 + c(-1, 1) * z * sqrt(a1 * (1 - a1) / (n1 + 2) + a2 * (1 - a2) / (n2 + 2)), -1, 1) },
      brownLi = { b1 <- (x1 + .5) / (n1 + 1); b2 <- (x2 + .5) / (n2 + 1)
                  add_ci(m, b1 - b2 + c(-1, 1) * z * sqrt(b1 * (1 - b1) / n1 + b2 * (1 - b2) / n2), -1, 1) },
      hauckAnderson = add_ci(m, d + c(-1, 1) * (cc_ha + z * se_ha), -1, 1),
      newcombe = { w1 <- wilson_ci(x1, n1, conf); w2 <- wilson_ci(x2, n2, conf)
                   add_ci(m, c(d - sqrt((p1 - w1[1])^2 + (w2[2] - p2)^2),
                               d + sqrt((w1[2] - p1)^2 + (p2 - w2[1])^2)), -1, 1) },
      newcombeCC = { w1 <- wilson_cc(x1, n1); w2 <- wilson_cc(x2, n2)
                     add_ci(m, c(d - sqrt((p1 - w1[1])^2 + (w2[2] - p2)^2),
                                 d + sqrt((w1[2] - p1)^2 + (p2 - w2[1])^2)), -1, 1) },
      wald = add_ci(m, d + c(-1, 1) * z * se1, -1, 1),
      waldCC = add_ci(m, d + c(-1, 1) * (cc_w + z * se1), -1, 1))
    for (m in test_methods) switch(m,
      hauckAnderson = { zv <- if (se_ha > 0) cc_toward(d, cc_ha) / se_ha else NA_real_; add_test(m, zv, p_z(zv)) },
      wald = { zv <- if (se1 > 0) d / se1 else NA_real_; add_test(m, zv, p_z(zv)) },
      waldCC = { zv <- if (se1 > 0) cc_toward(d, cc_w) / se1 else NA_real_; add_test(m, zv, p_z(zv)) },
      waldH0 = { zv <- if (se0 > 0) d / se0 else NA_real_; add_test(m, zv, p_z(zv)) },
      waldH0CC = { zv <- if (se0 > 0) cc_toward(d, cc_w) / se0 else NA_real_; add_test(m, zv, p_z(zv)) })
  }

  if (design == "paired" && (length(ci_methods) || length(test_methods))) {
    n10 <- b; n01 <- cc
    n11 <- sum(s1 == 1 & s2 == 1); n00 <- sum(s1 == 0 & s2 == 0)
    dd <- (n10 - n01) / n
    rad <- function(add, den) (n10 + add) / den + (n01 + add) / den - ((n10 - n01) / den)^2
    for (m in ci_methods) switch(m,
      agrestiMin = add_ci(m, (n10 - n01) / (n + 2) + c(-1, 1) * z * sqrt(max(rad(.5, n + 2), 0) / (n + 2)), -1, 1),
      bonettPrice = add_ci(m, (n10 - n01) / (n + 2) + c(-1, 1) * z * sqrt(max(rad(1, n + 2), 0) / (n + 2)), -1, 1),
      wald = add_ci(m, dd + c(-1, 1) * z * sqrt(max(rad(0, n), 0) / n), -1, 1),
      waldCC = add_ci(m, dd + c(-1, 1) * (z * sqrt(max(rad(0, n), 0) / n) + 1 / n), -1, 1),
      newcombe = {
        q1 <- n11 + n10; q2 <- n11 + n01
        w1 <- wilson_ci(q1, n, conf); w2 <- wilson_ci(q2, n, conf)
        m1 <- c(q1, n - q1, q2, n - q2)
        A <- n11 * n00 - n10 * n01
        psi <- if (any(m1 == 0)) 0 else if (A > n / 2) (A - n / 2) / sqrt(prod(m1))
               else if (A >= 0) 0 else A / sqrt(prod(m1))
        pa <- q1 / n; pb <- q2 / n
        add_ci(m, c(pa - pb - sqrt(max((pa - w1[1])^2 + (w2[2] - pb)^2 - 2 * psi * (pa - w1[1]) * (w2[2] - pb), 0)),
                    pa - pb + sqrt(max((w1[2] - pa)^2 + (pb - w2[1])^2 - 2 * psi * (w1[2] - pa) * (pb - w2[1]), 0))), -1, 1)
      })
    nd <- n10 + n01
    p1_exact <- if (nd > 0) sum(dbinom(0:min(n10, n01), nd, .5)) else 1
    se_w <- sqrt(max(n10 + n01 - (n10 - n01)^2 / n, 0))
    for (m in test_methods) switch(m,
      exact = add_test(m, NA, 2 * p1_exact),
      midP = add_test(m, NA, if (nd > 0) 2 * (p1_exact - 0.5 * dbinom(min(n10, n01), nd, .5)) else 1),
      mcnemar = { zv <- if (nd > 0) (n10 - n01) / sqrt(nd) else NA_real_; add_test(m, zv, p_z(zv)) },
      mcnemarCC = { zv <- if (nd > 0) cc_toward(n10 - n01, 1) / sqrt(nd) else NA_real_; add_test(m, zv, p_z(zv)) },
      wald = { zv <- if (se_w > 0) (n10 - n01) / se_w else NA_real_; add_test(m, zv, p_z(zv)) },
      waldCC = { zv <- if (se_w > 0) cc_toward(n10 - n01, 1) / se_w else NA_real_; add_test(m, zv, p_z(zv)) })
  }

  conf_pct <- as.character(round_half_up(conf * 100, 4))
  if (length(ci_rows)) tables[[length(tables) + 1L]] <- list(
    titleKey = paste0("output.proportions.ciTitle:", conf_pct),
    columns = list("output.proportions.intervalType",
                   paste0("output.col.ciLowerPct:", conf_pct), paste0("output.col.ciUpperPct:", conf_pct)),
    rows = ci_rows, footnoteKey = NULL)
  if (length(test_rows)) tables[[length(tables) + 1L]] <- list(
    titleKey = "output.proportions.testsTitle",
    columns = list("output.proportions.testType", "output.col.z", "output.proportions.twoSidedP"),
    rows = test_rows,
    footnoteKey = if (design == "one") paste0("output.proportions.testValueFootnote:", p0) else NULL)

  progress(100L, "progress.done")
  sai_output(tables = tables, warnings = warns)

}, error = function(e) {
  sai_error(conditionMessage(e))
})
