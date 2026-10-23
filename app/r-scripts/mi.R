# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# mi.R — Multiple Imputation (SPSS Analyze → Multiple Imputation → Impute).
#
# Params: variables (colIds, numeric with missing), m (imputations, default 5),
#         seed (default 123), varNames.
# Output: "Imputation Specifications" (per variable: missing count, method) and
#         "Pooled Univariate Statistics" (per variable: pooled mean, Std. Error,
#         95% CI via Rubin's rules across the m imputations). Requires `mice`.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  if (!requireNamespace("mice", quietly = TRUE)) {
    sai_output(tables = list(), warnings = "output.mi.needsPackage"); quit(save = "no")
  }
  cols <- unlist(params$variables); var_names <- params$varNames
  m    <- if (is.null(params$m)) 5L else as.integer(params$m)
  seed <- if (is.null(params$seed)) 123L else as.integer(params$seed)
  if (length(cols) < 2) sai_error("Multiple Imputation needs at least 2 variables")
  labels <- vapply(cols, function(c)
    if (!is.null(var_names[[c]])) var_names[[c]] else c, character(1))

  dat <- as.data.frame(lapply(cols, function(c) suppressWarnings(as.numeric(df[[c]]))))
  names(dat) <- paste0("v", seq_along(cols))
  if (sum(is.na(dat)) == 0) sai_error("No missing values to impute")

  progress(40L, "progress.computing")
  imp <- mice::mice(dat, m = m, seed = seed, printFlag = FALSE)
  miss <- colSums(is.na(dat))
  meth <- imp$method

  spec_rows <- lapply(seq_along(cols), function(j) list(
    labels[j], as.integer(miss[j]),
    if (nzchar(meth[j])) meth[j] else "output.mi.none"))

  # Rubin's rules for the mean of each variable across the m completed datasets.
  pooled_rows <- lapply(seq_along(cols), function(j) {
    qi <- numeric(m); ui <- numeric(m)
    for (i in seq_len(m)) {
      ci <- mice::complete(imp, i)[[paste0("v", j)]]
      qi[i] <- mean(ci); ui[i] <- var(ci) / length(ci)
    }
    qbar <- mean(qi); ubar <- mean(ui)
    b <- if (m > 1) var(qi) else 0
    tt <- ubar + (1 + 1 / m) * b
    se <- sqrt(tt)
    # Rubin (1987): the pooled estimate is t-distributed, not normal, with
    #   nu = (m - 1) * (1 + ubar / ((1 + 1/m) * B))^2
    # degrees of freedom. This used a flat 1.96, which is the normal quantile —
    # harmless when little information is missing (0.1% too narrow at 5%) but
    # 8% too narrow at 50% missing information, which is exactly where multiple
    # imputation is being used in the first place. With m = 5 the df can fall
    # into the teens, where t is visibly wider than z.
    #
    # B = 0 (every imputation gave the same mean, or m = 1) makes nu infinite
    # and t collapses to z, which is the right limit rather than a special case.
    nu <- if (b > 0) (m - 1) * (1 + ubar / ((1 + 1 / m) * b))^2 else Inf
    tcrit <- stats::qt(0.975, df = nu)
    list(labels[j], round(qbar, 4), round(se, 4),
         round(qbar - tcrit * se, 4), round(qbar + tcrit * se, 4),
         if (is.finite(nu)) round(nu, 3) else "")
  })

  progress(100L, "progress.done")
  sai_output(tables = list(
    list(titleKey = "output.mi.specTitle",
         columns = list("output.mi.variable", "output.missing.count", "output.mi.method"),
         rows = spec_rows, footnoteKey = paste0("output.mi.imputationsFootnote:", m)),
    list(titleKey = "output.mi.pooledTitle",
         columns = list("output.mi.variable", "output.col.mean", "output.col.stdError",
                        "output.col.ciLower95", "output.col.ciUpper95", "output.col.df"),
         rows = pooled_rows, footnoteKey = "output.mi.pooledFootnote")))
}, error = function(e) sai_error(conditionMessage(e)))
