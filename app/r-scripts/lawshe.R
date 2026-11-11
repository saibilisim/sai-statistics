# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# lawshe.R — Content validity ratio / index (Lawshe 1975).
#
# Data layout: one row per expert, one column per item; each cell is the
# expert's rating code. Params: variables (item colIds), varNames, options:
#   essential   the code meaning "essential" (default 1)
#   criterion   "exact" (default; Ayre & Scally 2014) | "lawshe" (Lawshe 1975 table)
#
# CVR = (ne - N/2) / (N/2), ne = experts rating the item essential, N =
# experts who rated it. Critical CVR, one-tailed alpha = .05:
#   exact  — the smallest ne with P(X >= ne) < .05 for X ~ Binomial(N, .5),
#            CVRcrit = (2 ne - N) / N (Ayre & Scally's correction of the table);
#   lawshe — Lawshe's original table (N = 5…40); an N between its rows takes
#            the value of the next smaller tabled N (the more demanding one).
# An item is retained when CVR >= CVRcrit. CVI = mean CVR of retained items.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

r3 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 3) else NULL

LAWSHE_TABLE <- c(`5` = .99, `6` = .99, `7` = .99, `8` = .75, `9` = .78, `10` = .62, `11` = .59,
                  `12` = .56, `13` = .54, `14` = .51, `15` = .49, `20` = .42, `25` = .37,
                  `30` = .33, `35` = .31, `40` = .29)

cvr_critical <- function(N, criterion) {
  if (criterion == "lawshe") {
    tn <- as.integer(names(LAWSHE_TABLE))
    if (N < 5) return(NA_real_)
    return(unname(LAWSHE_TABLE[as.character(max(tn[tn <= N]))]))
  }
  ne <- which(stats::pbinom(seq_len(N) - 1, N, 0.5, lower.tail = FALSE) < 0.05)
  if (!length(ne)) return(NA_real_)
  (2 * min(ne) - N) / N
}

tryCatch({
  progress(10L, "progress.loading")
  vars <- unlist(params$variables)
  if (!length(vars)) sai_error("Select the item columns")
  opts <- if (is.null(params$options)) list() else params$options
  ess <- suppressWarnings(as.numeric(opts$essential)); if (!length(ess) || is.na(ess)) ess <- 1
  criterion <- if (identical(opts$criterion, "lawshe")) "lawshe" else "exact"
  nm <- resolve_var_names(vars, params$varNames)
  warns <- character(0)
  res <- lapply(seq_along(vars), function(i) {
    x <- suppressWarnings(as.numeric(apply_user_missing(df[[vars[i]]], vars[i], params)))
    x <- x[!is.na(x)]; N <- length(x); ne <- sum(x == ess)
    cvr <- if (N > 0) (ne - N / 2) / (N / 2) else NA
    crit <- if (N > 0) cvr_critical(N, criterion) else NA
    list(name = nm[i], N = N, ne = ne, cvr = cvr, crit = crit,
         keep = is.finite(cvr) && is.finite(crit) && cvr >= crit - 1e-12)
  })
  Ns <- vapply(res, function(r) r$N, 0)
  if (any(Ns < 5)) warns <- c(warns, "output.lawshe.fewExperts")
  if (all(vapply(res, function(r) r$ne, 0) == 0)) warns <- c(warns, "output.lawshe.noEssential")
  kept <- Filter(function(r) r$keep, res)
  cvi <- if (length(kept)) mean(vapply(kept, function(r) r$cvr, 0)) else NA
  tables <- list(
    list(titleKey = "output.lawshe.itemTitle",
         columns = list("output.col.variable", "output.lawshe.nExperts", "output.lawshe.nEssential",
                        "output.lawshe.cvr", "output.lawshe.critical", "output.lawshe.decision"),
         rows = lapply(res, function(r) list(r$name, as.integer(r$N), as.integer(r$ne), r3(r$cvr), r3(r$crit),
                                             if (r$keep) "output.lawshe.retain" else "output.lawshe.remove")),
         footnoteKey = paste0(if (criterion == "lawshe") "output.lawshe.footLawshe" else "output.lawshe.footExact",
                              ":", format(ess))),
    list(titleKey = "output.lawshe.scaleTitle",
         columns = list("output.col.statistic", "output.col.value"),
         rows = list(list("output.lawshe.nItems", as.integer(length(res))),
                     list("output.lawshe.nRetained", as.integer(length(kept))),
                     list("output.lawshe.cvi", r3(cvi)),
                     list("output.lawshe.cviAll", r3(mean(vapply(res, function(r) r$cvr, 0), na.rm = TRUE)))),
         footnoteKey = "output.lawshe.cviFootnote"))
  sai_output(tables = tables, warnings = warns)
}, error = function(e) sai_error(conditionMessage(e)))
