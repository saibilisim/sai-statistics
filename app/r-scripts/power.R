# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# power.R — Power Analysis (SPSS 27+ Analyze → Power Analysis).
#
# Pure base-R implementation via non-central distributions (no pwr package).
# Params: test ("tOne"|"tTwo"|"anova"|"correlation"|"chisquare"|"regression"),
#         effectSize, alpha, power (target), n (sample size; per group for
#         tTwo/anova), groups (anova k), df (chi-square df), predictors (u).
# Output: "Power Analysis" — Test, Effect Size, Alpha, Sample Size, Achieved
#         Power (at entered N) and Required Sample Size (for target power).

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params()

power_at <- function(test, es, alpha, n, groups, dfree, u) {
  switch(test,
    tOne = { df <- n - 1; if (df < 1) return(NA); ncp <- es * sqrt(n)
             crit <- qt(1 - alpha / 2, df)
             pt(crit, df, ncp, lower.tail = FALSE) + pt(-crit, df, ncp) },
    tTwo = { df <- 2 * n - 2; if (df < 1) return(NA); ncp <- es * sqrt(n / 2)
             crit <- qt(1 - alpha / 2, df)
             pt(crit, df, ncp, lower.tail = FALSE) + pt(-crit, df, ncp) },
    anova = { N <- groups * n; df1 <- groups - 1; df2 <- N - groups
              if (df2 < 1) return(NA); ncp <- es^2 * N
              pf(qf(1 - alpha, df1, df2), df1, df2, ncp, lower.tail = FALSE) },
    correlation = { if (n < 4) return(NA); z <- atanh(es); se <- 1 / sqrt(n - 3)
                    zc <- qnorm(1 - alpha / 2)
                    pnorm(z / se - zc) + pnorm(-z / se - zc) },
    chisquare = { ncp <- es^2 * n
                  pchisq(qchisq(1 - alpha, dfree), dfree, ncp, lower.tail = FALSE) },
    regression = { v <- n - u - 1; if (v < 1) return(NA); ncp <- es^2 * (u + v + 1)
                   pf(qf(1 - alpha, u, v), u, v, ncp, lower.tail = FALSE) },
    NA)
}

tryCatch({
  progress(20L, "progress.computing")
  test  <- if (is.null(params$test)) "tTwo" else params$test
  es    <- as.numeric(params$effectSize)
  alpha <- if (is.null(params$alpha)) 0.05 else as.numeric(params$alpha)
  target <- if (is.null(params$power)) 0.80 else as.numeric(params$power)
  n     <- if (is.null(params$n)) 30 else as.numeric(params$n)
  groups <- if (is.null(params$groups)) 3 else as.numeric(params$groups)
  dfree  <- if (is.null(params$df)) 1 else as.numeric(params$df)
  u      <- if (is.null(params$predictors)) 1 else as.numeric(params$predictors)
  if (!is.finite(es) || es <= 0) sai_error("Effect size must be positive")

  achieved <- power_at(test, es, alpha, n, groups, dfree, u)

  # Required sample size for target power (search upward).
  req_n <- NA
  for (nn in 2:100000) {
    pw <- power_at(test, es, alpha, nn, groups, dfree, u)
    if (is.finite(pw) && pw >= target) { req_n <- nn; break }
  }

  per_group <- test %in% c("tTwo", "anova")
  rows <- list(
    list("output.power.lblTest", paste0("output.power.test.", test)),
    list("output.power.effectSize", round(es, 4)),
    list("output.power.alpha", round(alpha, 4)),
    list(if (per_group) "output.power.nPerGroup" else "output.power.n", as.integer(n)),
    list("output.power.achieved", round(achieved, 4)),
    list("output.power.target", round(target, 4)),
    list(if (per_group) "output.power.reqNPerGroup" else "output.power.reqN",
         if (is.na(req_n)) NULL else as.integer(req_n)))

  progress(100L, "progress.done")
  sai_output(tables = list(list(
    titleKey = "output.power.title",
    columns = list("output.power.parameter", "output.col.value"),
    rows = rows,
    footnoteKey = if (per_group) "output.power.perGroupFootnote" else NULL)))
}, error = function(e) sai_error(conditionMessage(e)))
