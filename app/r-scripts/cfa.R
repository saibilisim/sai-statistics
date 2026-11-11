# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# cfa.R — Confirmatory Factor Analysis (lavaan) with fit indices and their
# conventional cut-offs, loadings, reliability / convergent and discriminant
# validity, modification indices, measurement invariance and a path diagram.
#
# Params: variables (every item colId), varNames, factors, options:
#   factors       [{ name, items: [colId, ...] }, ...]  (an item may appear
#                 under two factors: a cross-loading)
#   ordinalItems  colIds whose measure level is ordinal (estimator "auto")
#   groupVar / groupName   optional grouping variable → invariance tests
#   options:
#     estimator      "auto" (default) | "ml" | "mlr" | "wlsmv"
#     identification "marker" (first loading = 1, default) | "std" (factor variances = 1)
#     correlated     factor covariances free (default TRUE)
#     missingMethod  "listwise" (default) | "fiml"
#     errorCov       [[colId, colId], ...] residual covariances to free
#     reliability, fornell, htmt, mi, diagram, invariance   (bool, default TRUE
#                    except mi/invariance)
#     miMin          smallest MI listed (default 3.84)   miTop  at most (20)
#
# Estimator "auto": WLSMV when every item is ordinal (measure level) or has at
# most five integer categories — Likert items, where normal-theory ML biases
# loadings and fit (Rhemtulla, Brosseau-Liard & Savalei 2012) — else ML.
# Under WLSMV integer items with ≤ 10 categories are declared ordered (lavaan
# then works on polychoric correlations); WLSMV has no FIML, so missing data
# use pairwise information there.
#
# Indices: ML prints the standard indices. MLR and WLSMV print the standard
# and the robust ones side by side (lavaan's .robust, falling back to .scaled
# where lavaan has no robust version); the assessment column judges the
# robust value. Cut-offs: Hu & Bentler (1999), Schermelleh-Engel, Moosbrugger
# & Müller (2003) — written into the table so nobody copies them by hand.
#
# Reliability from the completely standardized solution: CR (= ω for a
# congeneric model) = (Σλ)² / ((Σλ)² + Σθ), AVE = Σλ² / k (Fornell & Larcker
# 1981). HTMT (Henseler, Ringle & Sarstedt 2015) on absolute item
# correlations — polychoric when the items are ordered.
#
# Invariance: configural → metric (loadings) → scalar (intercepts, or
# thresholds for ordered items) → strict (residuals, continuous items only),
# compared with lavTestLRT (scaled difference test under MLR/WLSMV) and the
# ΔCFI ≤ .010 (Cheung & Rensvold 2002) / ΔRMSEA ≤ .015 (Chen 2007) rules.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

r3 <- function(x) if (is.null(x) || length(x) != 1 || !is.finite(x)) NULL else round(x, 3)
rp <- function(x) if (is.null(x) || length(x) != 1 || !is.finite(x)) NULL else round(x, 4)

#' Pick the first finite fit measure among `names` (robust → scaled → plain).
fm_pick <- function(fm, names) {
  for (n in names) if (n %in% names(fm) && is.finite(fm[[n]])) return(unname(fm[[n]]))
  NA_real_
}

#' One fit-index row set per estimator. `robust` adds the second value column.
fit_values <- function(fm, robust) {
  std <- list(
    chisq = fm_pick(fm, "chisq"), df = fm_pick(fm, "df"), p = fm_pick(fm, "pvalue"),
    cfi = fm_pick(fm, "cfi"), tli = fm_pick(fm, "tli"),
    rmsea = fm_pick(fm, "rmsea"), rmsea_lo = fm_pick(fm, "rmsea.ci.lower"),
    rmsea_hi = fm_pick(fm, "rmsea.ci.upper"), pclose = fm_pick(fm, "rmsea.pvalue"),
    srmr = fm_pick(fm, "srmr"), gfi = fm_pick(fm, "gfi"), agfi = fm_pick(fm, "agfi"),
    nfi = fm_pick(fm, "nfi"), ifi = fm_pick(fm, "ifi"),
    aic = fm_pick(fm, "aic"), bic = fm_pick(fm, "bic"))
  if (!robust) return(list(std = std, rob = NULL))
  rob <- list(
    chisq = fm_pick(fm, "chisq.scaled"), df = fm_pick(fm, "df.scaled"),
    p = fm_pick(fm, "pvalue.scaled"),
    cfi = fm_pick(fm, c("cfi.robust", "cfi.scaled")),
    tli = fm_pick(fm, c("tli.robust", "tli.scaled")),
    rmsea = fm_pick(fm, c("rmsea.robust", "rmsea.scaled")),
    rmsea_lo = fm_pick(fm, c("rmsea.ci.lower.robust", "rmsea.ci.lower.scaled")),
    rmsea_hi = fm_pick(fm, c("rmsea.ci.upper.robust", "rmsea.ci.upper.scaled")),
    pclose = fm_pick(fm, c("rmsea.pvalue.robust", "rmsea.pvalue.scaled")),
    srmr = fm_pick(fm, "srmr"), gfi = NA_real_, agfi = NA_real_,
    nfi = fm_pick(fm, "nfi.scaled"), ifi = fm_pick(fm, "ifi.scaled"),
    aic = NA_real_, bic = NA_real_)
  list(std = std, rob = rob)
}

#' Good / acceptable cut-offs: list(good, acceptable, higher_is_better).
FIT_CUTS <- list(
  cmin  = list(2, 3, FALSE),     # χ²/df
  cfi   = list(0.95, 0.90, TRUE), tli = list(0.95, 0.90, TRUE),
  rmsea = list(0.05, 0.08, FALSE), srmr = list(0.05, 0.08, FALSE),
  gfi   = list(0.95, 0.90, TRUE), agfi = list(0.90, 0.85, TRUE),
  nfi   = list(0.95, 0.90, TRUE), ifi = list(0.95, 0.90, TRUE))

fit_assess <- function(index, v) {
  cut <- FIT_CUTS[[index]]
  if (is.null(cut) || !is.finite(v)) return(NULL)
  ok <- function(th) if (cut[[3]]) v >= th else v <= th
  if (ok(cut[[1]])) "output.cfa.fitGood" else if (ok(cut[[2]])) "output.cfa.fitAcceptable"
  else "output.cfa.fitPoor"
}

fit_cut_text <- function(index, which) {
  cut <- FIT_CUTS[[index]]
  if (is.null(cut)) return(NULL)
  paste0(if (cut[[3]]) "≥ " else "≤ ", format(cut[[which]], nsmall = 2))
}

#' Fit Indices table (one or two value columns, cut-offs, assessment).
fit_table <- function(fv) {
  robust <- !is.null(fv$rob)
  judge <- if (robust) fv$rob else fv$std
  row <- function(label, key, index = NULL, digits = 3) {
    s <- fv$std[[key]]; r <- if (robust) fv$rob[[key]] else NULL
    if (!is.finite(s) && (!robust || !is.finite(r))) return(NULL)
    fmt <- function(v) if (!is.finite(v)) NULL else round(v, digits)
    c(list(label, fmt(s)), if (robust) list(fmt(r)) else list(),
      list(if (is.null(index)) NULL else fit_cut_text(index, 1),
           if (is.null(index)) NULL else fit_cut_text(index, 2),
           if (is.null(index)) NULL else fit_assess(index, judge[[key]])))
  }
  cmin <- function(v) if (is.finite(v$chisq) && is.finite(v$df) && v$df > 0) v$chisq / v$df else NA
  fv$std$cmin <- cmin(fv$std); if (robust) fv$rob$cmin <- cmin(fv$rob)
  judge <- if (robust) fv$rob else fv$std
  rows <- Filter(Negate(is.null), list(
    row("χ²", "chisq"), row("df", "df", digits = 0), row("p", "p", digits = 4),
    row("χ²/df", "cmin", "cmin"),
    row("CFI", "cfi", "cfi"), row("TLI", "tli", "tli"),
    row("RMSEA", "rmsea", "rmsea"),
    row("output.cfa.rmseaLo", "rmsea_lo"), row("output.cfa.rmseaHi", "rmsea_hi"),
    row("PCLOSE", "pclose", digits = 4),
    row("SRMR", "srmr", "srmr"), row("GFI", "gfi", "gfi"), row("AGFI", "agfi", "agfi"),
    row("NFI", "nfi", "nfi"), row("IFI", "ifi", "ifi"),
    row("AIC", "aic", digits = 2), row("BIC", "bic", digits = 2)))
  cols <- c("output.cfa.index", if (robust) c("output.cfa.standard", "output.cfa.robust")
            else "output.col.value",
            "output.cfa.cutGood", "output.cfa.cutAcceptable", "output.cfa.assessment")
  list(titleKey = "output.cfa.fitTitle", columns = as.list(cols), rows = rows,
       footnoteKey = if (robust) "output.cfa.fitFootnoteRobust" else "output.cfa.fitFootnote")
}

#' Absolute-correlation HTMT matrix (NULL entries where a factor has < 2 items).
htmt_matrix <- function(R, fac_items) {
  k <- length(fac_items); A <- abs(R)
  mono <- vapply(fac_items, function(ix) {
    if (length(ix) < 2) return(NA_real_)
    s <- A[ix, ix]; mean(s[upper.tri(s)])
  }, numeric(1))
  H <- matrix(NA_real_, k, k)
  for (i in seq_len(k)) for (j in seq_len(k)) if (i != j) {
    H[i, j] <- mean(A[fac_items[[i]], fac_items[[j]]]) / sqrt(mono[i] * mono[j])
  }
  H
}

#' Cronbach's alpha of the item columns `X` (complete cases).
cronbach <- function(X) {
  X <- X[stats::complete.cases(X), , drop = FALSE]
  k <- ncol(X); if (k < 2 || nrow(X) < 2) return(NA_real_)
  k / (k - 1) * (1 - sum(apply(X, 2, stats::var)) / stats::var(rowSums(X)))
}

xml_esc <- function(s) {
  s <- gsub("&", "&amp;", s, fixed = TRUE); s <- gsub("<", "&lt;", s, fixed = TRUE)
  s <- gsub(">", "&gt;", s, fixed = TRUE); gsub("\"", "&quot;", s, fixed = TRUE)
}
trunc_label <- function(s, n = 18) if (nchar(s) > n) paste0(substr(s, 1, n - 1), "…") else s
num_lbl <- function(v) sub("^(-?)0\\.", "\\1.", formatC(v, format = "f", digits = 2))

#' Path diagram as a standalone SVG: residuals → items ← factors, standardized
#' loadings on the arrows, factor correlations on arcs at the right.
path_diagram_svg <- function(fac_names, fac_items, item_names, std_load, std_resid, phi) {
  k <- length(fac_names)
  # Each item is drawn once, under the first factor it belongs to.
  order_items <- unique(unlist(fac_items))
  n <- length(order_items)
  row_h <- 40; top <- 30
  y_of <- setNames(top + (seq_len(n) - 1) * row_h + row_h / 2, order_items)
  box_x <- 90; box_w <- 140; box_h <- 28
  err_cx <- 40; err_r <- 16
  fx <- 430; frx <- 64; fry <- 26
  fy <- vapply(fac_items, function(ix) mean(y_of[ix]), numeric(1))
  arc_w <- if (k > 1) 60 + 22 * (k - 1) else 0
  width <- fx + frx + arc_w + 50
  height <- top * 2 + n * row_h
  out <- c(
    sprintf('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" font-family="Arial, Helvetica, sans-serif">',
            width, height, width, height),
    '<defs><marker id="ah" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#333"/></marker></defs>',
    sprintf('<rect width="%d" height="%d" fill="#ffffff"/>', width, height))
  label_at <- function(x, y, txt, size = 11) c(
    sprintf('<rect x="%.1f" y="%.1f" width="%d" height="14" fill="#ffffff" opacity="0.9"/>',
            x - 15, y - 10, 30),
    sprintf('<text x="%.1f" y="%.1f" font-size="%d" text-anchor="middle" fill="#111">%s</text>',
            x, y + 1, size, txt))
  # Items and residuals.
  for (it in order_items) {
    y <- y_of[[it]]
    out <- c(out,
      sprintf('<rect x="%d" y="%.1f" width="%d" height="%d" fill="#f4f6fa" stroke="#333"/>',
              box_x, y - box_h / 2, box_w, box_h),
      sprintf('<text x="%.1f" y="%.1f" font-size="12" text-anchor="middle" fill="#111">%s</text>',
              box_x + box_w / 2, y + 4, xml_esc(trunc_label(item_names[[it]]))),
      sprintf('<circle cx="%d" cy="%.1f" r="%d" fill="#ffffff" stroke="#333"/>', err_cx, y, err_r),
      sprintf('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="#333" marker-end="url(#ah)"/>',
              err_cx + err_r, y, box_x, y),
      sprintf('<text x="%d" y="%.1f" font-size="10" text-anchor="middle" fill="#111">%s</text>',
              err_cx, y + 3.5, if (is.finite(std_resid[[it]])) num_lbl(std_resid[[it]]) else ""))
  }
  # Loadings.
  for (f in seq_len(k)) for (it in fac_items[[f]]) {
    x1 <- fx - frx; y1 <- fy[f]; x2 <- box_x + box_w; y2 <- y_of[[it]]
    v <- std_load[[paste(f, it)]]
    out <- c(out,
      sprintf('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#333" marker-end="url(#ah)"/>',
              x1, y1, x2, y2),
      label_at(x2 + 0.35 * (x1 - x2), y2 + 0.35 * (y1 - y2), if (is.finite(v)) num_lbl(v) else ""))
  }
  # Factors.
  for (f in seq_len(k)) out <- c(out,
    sprintf('<ellipse cx="%d" cy="%.1f" rx="%d" ry="%d" fill="#e8eef9" stroke="#333"/>',
            fx, fy[f], frx, fry),
    sprintf('<text x="%d" y="%.1f" font-size="12" font-weight="bold" text-anchor="middle" fill="#111">%s</text>',
            fx, fy[f] + 4, xml_esc(trunc_label(fac_names[f], 14))))
  # Factor correlations.
  if (!is.null(phi) && k > 1) for (i in seq_len(k - 1)) for (j in (i + 1):k) {
    if (!is.finite(phi[i, j])) next
    x0 <- fx + frx * 0.6; cx <- fx + frx + 30 + 22 * (j - i)
    ya <- fy[i] + 8; yb <- fy[j] - 8
    out <- c(out,
      sprintf('<path d="M%.1f,%.1f Q%.1f,%.1f %.1f,%.1f" fill="none" stroke="#555" marker-start="url(#ah)" marker-end="url(#ah)"/>',
              x0, ya, cx, (ya + yb) / 2, x0, yb),
      label_at(0.5 * x0 + 0.5 * cx, (ya + yb) / 2, num_lbl(phi[i, j]), 10))
  }
  paste(c(out, "</svg>"), collapse = "\n")
}

tryCatch({
  progress(10L, "progress.loading")
  sai_weight_unsupported("output.cfa.title")
  if (!requireNamespace("lavaan", quietly = TRUE)) sai_error("The lavaan R package is not installed")
  opts <- if (is.null(params$options)) list() else params$options
  pick <- function(v, allowed) if (!is.null(v) && v %in% allowed) v else allowed[1]
  estimator_opt <- pick(opts$estimator, c("auto", "ml", "mlr", "wlsmv"))
  ident <- pick(opts$identification, c("marker", "std"))
  miss_method <- pick(opts$missingMethod, c("listwise", "fiml"))
  correlated <- !identical(opts$correlated, FALSE)
  flag <- function(v, default) if (is.null(v)) default else isTRUE(v)

  facs <- params$factors
  facs <- Filter(function(f) length(unlist(f$items)) > 0, facs)
  if (length(facs) < 1) sai_error("Assign items to at least one factor")
  fac_names <- vapply(facs, function(f) as.character(f$name), "")
  fac_items_col <- lapply(facs, function(f) unique(unlist(f$items)))
  items <- unique(unlist(fac_items_col))
  var_names <- params$varNames
  item_names <- setNames(as.list(resolve_var_names(items, var_names)), items)
  if (!all(items %in% names(df))) sai_error("An item variable was not found in the dataset")
  if (length(items) < 3) sai_error("A confirmatory factor model needs at least three items")

  # Internal syntactic names: x1..xp for items, F1..Fk for factors — user
  # names never reach lavaan's model parser.
  ix <- setNames(paste0("x", seq_along(items)), items)
  fx <- paste0("F", seq_along(facs))
  dat <- as.data.frame(lapply(items, function(c)
    suppressWarnings(as.numeric(apply_user_missing(df[[c]], c, params)))))
  names(dat) <- unname(ix)

  group_col <- params$groupVar
  has_group <- !is.null(group_col) && nzchar(group_col) && group_col %in% names(df)
  if (has_group) {
    g <- apply_user_missing(df[[group_col]], group_col, params)
    dat$.grp <- as.character(g)
  }
  keep <- if (miss_method == "listwise") stats::complete.cases(dat) else
    rowSums(!is.na(dat[unname(ix)])) > 0
  if (has_group) keep <- keep & !is.na(dat$.grp)
  dat <- dat[keep, , drop = FALSE]
  if (nrow(dat) < 10) sai_error("Not enough cases for a confirmatory factor analysis")

  # Estimator.
  ncat <- vapply(unname(ix), function(v) {
    x <- dat[[v]][!is.na(dat[[v]])]
    if (all(abs(x - round(x)) < 1e-9)) length(unique(x)) else Inf
  }, numeric(1))
  ordinal_meas <- items %in% unlist(params$ordinalItems)
  warns <- character(0); notes <- character(0)
  estimator <- if (estimator_opt == "auto") {
    e <- if (all(ordinal_meas | ncat <= 5)) "wlsmv" else "ml"
    notes <- c(notes, paste0("output.cfa.estimatorAuto:", toupper(e)))
    e
  } else estimator_opt
  ordered_vars <- if (estimator == "wlsmv") unname(ix)[ncat <= 10] else character(0)
  if (estimator == "wlsmv" && length(ordered_vars) < length(ix))
    notes <- c(notes, "output.cfa.someContinuous")
  lav_missing <- if (miss_method == "fiml") {
    if (estimator == "wlsmv") { notes <- c(notes, "output.cfa.wlsmvPairwise"); "pairwise" } else "ml"
  } else "listwise"
  robust <- estimator != "ml"

  # Model.
  lines <- vapply(seq_along(facs), function(f)
    paste0(fx[f], " =~ ", paste(ix[fac_items_col[[f]]], collapse = " + ")), "")
  ec <- params$options$errorCov
  ec_lines <- character(0)
  for (pr in ec) {
    pr <- unlist(pr)
    if (length(pr) == 2 && all(pr %in% items) && pr[1] != pr[2])
      ec_lines <- c(ec_lines, paste0(ix[[pr[1]]], " ~~ ", ix[[pr[2]]]))
  }
  if (!correlated && length(facs) > 1) {
    for (i in seq_len(length(facs) - 1)) for (j in (i + 1):length(facs))
      ec_lines <- c(ec_lines, paste0(fx[i], " ~~ 0*", fx[j]))
  }
  model <- paste(c(lines, ec_lines), collapse = "\n")
  if (any(table(unlist(fac_items_col)) > 1)) notes <- c(notes, "output.cfa.crossLoadingNote")

  progress(30L, "progress.computing")
  lav_warn <- character(0)
  fit_cfa <- function(...) withCallingHandlers(
    lavaan::cfa(model, data = dat, estimator = toupper(estimator),
                ordered = if (length(ordered_vars)) ordered_vars else NULL,
                std.lv = ident == "std", missing = lav_missing, ...),
    warning = function(w) {
      lav_warn <<- c(lav_warn, conditionMessage(w)); invokeRestart("muffleWarning")
    })
  fit <- tryCatch(fit_cfa(), error = function(e) sai_error(conditionMessage(e)))

  disp_item <- setNames(vapply(items, function(c) item_names[[c]], ""), unname(ix))
  disp_fac <- setNames(fac_names, fx)
  disp <- function(v) {
    out <- unname(disp_item[v]); f <- is.na(out); out[f] <- unname(disp_fac[v[f]]); out
  }
  tables <- list(); plots <- list()

  # ── Model specification and summary ────────────────────────────────────────
  tables <- c(tables, list(list(
    titleKey = "output.cfa.specTitle",
    columns = list("output.col.factor", "output.cfa.indicators"),
    rows = c(lapply(seq_along(facs), function(f)
      list(fac_names[f], paste(unlist(item_names[fac_items_col[[f]]]), collapse = ", "))),
      lapply(ec_lines[grepl("^x", ec_lines)], function(l) {
        p <- strsplit(l, " ~~ ", fixed = TRUE)[[1]]
        list("output.cfa.errorCovRow", paste(disp(p), collapse = " ↔ "))
      })),
    footnoteKey = if (ident == "marker") "output.cfa.identMarker" else "output.cfa.identStd")))

  converged <- isTRUE(lavaan::lavInspect(fit, "converged"))
  n_used <- sum(lavaan::lavInspect(fit, "nobs"))
  tables <- c(tables, list(list(
    titleKey = "output.cfa.summaryTitle",
    columns = list("output.col.statistic", "output.col.value"),
    rows = list(
      list("output.cfa.nUsed", as.integer(n_used)),
      list("output.cfa.nExcluded", as.integer(sum(!keep))),
      list("output.cfa.estimator", toupper(estimator)),
      list("output.cfa.nOrdered", as.integer(length(ordered_vars))),
      list("output.cfa.missingHandling", switch(lav_missing,
        listwise = "output.cfa.missListwise", ml = "output.cfa.missFiml",
        pairwise = "output.cfa.missPairwise")),
      list("output.cfa.nParams", as.integer(lavaan::lavInspect(fit, "npar"))),
      list("output.cfa.iterations", as.integer(lavaan::lavInspect(fit, "iterations"))),
      list("output.cfa.converged", if (converged) "output.cfa.yes" else "output.cfa.no")),
    footnoteKey = NULL)))
  if (length(lav_warn)) warns <- c(warns, paste0("output.cfa.lavaanWarning:",
                                                 paste(unique(lav_warn), collapse = " | ")))
  if (!converged) {
    warns <- c(warns, "output.cfa.notConverged")
    sai_output(tables = tables, warnings = warns, notes = notes)
    quit(save = "no", status = 0)
  }

  progress(55L, "progress.computing")
  # ── Fit indices ────────────────────────────────────────────────────────────
  fm <- lavaan::fitMeasures(fit)
  fv <- fit_values(fm, robust)
  tables <- c(tables, list(fit_table(fv)))

  # ── Parameters ─────────────────────────────────────────────────────────────
  pe <- lavaan::parameterEstimates(fit, standardized = TRUE)
  r2 <- lavaan::lavInspect(fit, "rsquare")
  free_cell <- function(row, v) if (row$se == 0 || !is.finite(row$se)) NULL else r3(v)
  free_p <- function(row) if (row$se == 0 || !is.finite(row$se)) NULL else rp(row$pvalue)
  ld <- pe[pe$op == "=~", ]
  low <- character(0)
  load_rows <- lapply(seq_len(nrow(ld)), function(i) {
    r <- ld[i, ]
    if (is.finite(r$std.all) && abs(r$std.all) < 0.5) low <<- c(low, disp(r$rhs))
    list(disp(r$lhs), disp(r$rhs), r3(r$est), free_cell(r, r$se), free_cell(r, r$z),
         free_p(r), r3(r$std.all), r3(unname(r2[r$rhs])))
  })
  tables <- c(tables, list(list(
    titleKey = "output.cfa.loadingsTitle",
    columns = list("output.col.factor", "output.cfa.indicator", "output.col.estimate",
                   "output.col.stdError", "output.col.z", "output.col.sig",
                   "output.cfa.stdEstimate", "output.col.rSquare"),
    rows = load_rows,
    footnoteKey = if (ident == "marker") "output.cfa.loadingsFootnoteMarker" else NULL)))
  if (length(low)) notes <- c(notes, paste0("output.cfa.lowLoadings:",
                                            paste(unique(low), collapse = ", ")))

  fc <- pe[pe$op == "~~" & pe$lhs %in% fx & pe$rhs %in% fx & pe$lhs != pe$rhs, ]
  if (nrow(fc)) tables <- c(tables, list(list(
    titleKey = "output.cfa.factorCovTitle",
    columns = list("output.cfa.pair", "output.cfa.covariance", "output.col.stdError",
                   "output.col.z", "output.col.sig", "output.cfa.correlation"),
    rows = lapply(seq_len(nrow(fc)), function(i) { r <- fc[i, ]
      list(paste(disp(r$lhs), disp(r$rhs), sep = " ↔ "), r3(r$est), free_cell(r, r$se),
           free_cell(r, r$z), free_p(r), r3(r$std.all)) }),
    footnoteKey = NULL)))

  rv <- pe[pe$op == "~~" & pe$lhs == pe$rhs & pe$lhs %in% c(unname(ix), fx), ]
  tables <- c(tables, list(list(
    titleKey = "output.cfa.varianceTitle",
    columns = list("output.cfa.parameterCol", "output.col.estimate", "output.col.stdError",
                   "output.col.z", "output.col.sig", "output.cfa.stdEstimate"),
    rows = lapply(seq_len(nrow(rv)), function(i) { r <- rv[i, ]
      list(disp(r$lhs), r3(r$est), free_cell(r, r$se), free_cell(r, r$z), free_p(r),
           r3(r$std.all)) }),
    footnoteKey = if (length(ordered_vars)) "output.cfa.deltaFootnote" else NULL)))

  ec_pe <- pe[pe$op == "~~" & pe$lhs %in% unname(ix) & pe$rhs %in% unname(ix) & pe$lhs != pe$rhs, ]
  if (nrow(ec_pe)) tables <- c(tables, list(list(
    titleKey = "output.cfa.errorCovTitle",
    columns = list("output.cfa.pair", "output.cfa.covariance", "output.col.stdError",
                   "output.col.z", "output.col.sig", "output.cfa.correlation"),
    rows = lapply(seq_len(nrow(ec_pe)), function(i) { r <- ec_pe[i, ]
      list(paste(disp(r$lhs), disp(r$rhs), sep = " ↔ "), r3(r$est), free_cell(r, r$se),
           free_cell(r, r$z), free_p(r), r3(r$std.all)) }),
    footnoteKey = NULL)))

  # Heywood cases: negative residual variance or |standardized loading| > 1.
  hey <- unique(c(disp(rv$lhs[rv$est < 0 & rv$lhs %in% unname(ix)]),
                  disp(ld$rhs[is.finite(ld$std.all) & abs(ld$std.all) > 1])))
  if (length(hey)) warns <- c(warns, paste0("output.cfa.heywood:", paste(hey, collapse = ", ")))

  # ── Reliability and validity ──────────────────────────────────────────────
  std_item_resid <- setNames(rv$std.all[match(unname(ix), rv$lhs)], unname(ix))
  k <- length(facs)
  rel <- lapply(seq_len(k), function(f) {
    l <- ld[ld$lhs == fx[f], ]
    lam <- l$std.all; th <- std_item_resid[l$rhs]
    cr <- sum(lam)^2 / (sum(lam)^2 + sum(th)); ave <- mean(lam^2)
    list(cr = cr, ave = ave, alpha = cronbach(as.matrix(dat[l$rhs])), k = nrow(l))
  })
  phi <- if (k > 1) {
    P <- diag(k)
    for (i in seq_len(nrow(fc))) {
      a <- match(fc$lhs[i], fx); b <- match(fc$rhs[i], fx)
      P[a, b] <- P[b, a] <- fc$std.all[i]
    }
    if (!correlated) P[upper.tri(P) | lower.tri(P)] <- 0
    P
  } else NULL
  if (flag(opts$reliability, TRUE)) {
    tables <- c(tables, list(list(
      titleKey = "output.cfa.reliabilityTitle",
      columns = list("output.col.factor", "output.col.nItems", "output.col.cronbachAlpha",
                     "output.cfa.cr", "output.cfa.ave", "output.cfa.sqrtAve", "output.cfa.msv"),
      rows = lapply(seq_len(k), function(f) {
        msv <- if (!is.null(phi)) max(phi[f, -f]^2) else NA
        list(fac_names[f], as.integer(rel[[f]]$k), r3(rel[[f]]$alpha), r3(rel[[f]]$cr),
             r3(rel[[f]]$ave), r3(sqrt(rel[[f]]$ave)), r3(msv))
      }),
      footnoteKey = "output.cfa.reliabilityFootnote")))
    weak <- fac_names[vapply(rel, function(r) is.finite(r$ave) && r$ave < 0.5, TRUE)]
    if (length(weak)) notes <- c(notes, paste0("output.cfa.lowAve:", paste(weak, collapse = ", ")))
  }

  if (k > 1 && correlated && flag(opts$fornell, TRUE)) {
    fl_bad <- character(0)
    rows <- lapply(seq_len(k), function(i) c(list(fac_names[i]), lapply(seq_len(k), function(j) {
      if (j > i) return(NULL)
      if (i == j) return(r3(sqrt(rel[[i]]$ave)))
      if (abs(phi[i, j]) > sqrt(rel[[i]]$ave) || abs(phi[i, j]) > sqrt(rel[[j]]$ave))
        fl_bad <<- c(fl_bad, paste(fac_names[j], fac_names[i], sep = " ↔ "))
      r3(phi[i, j])
    })))
    tables <- c(tables, list(list(
      titleKey = "output.cfa.fornellTitle",
      columns = as.list(c("output.col.factor", fac_names)), rows = rows,
      footnoteKey = "output.cfa.fornellFootnote")))
    if (length(fl_bad)) notes <- c(notes, paste0("output.cfa.fornellFail:",
                                                 paste(fl_bad, collapse = ", ")))
  }

  if (k > 1 && flag(opts$htmt, TRUE)) {
    Rm <- if (length(ordered_vars)) tryCatch(
      suppressWarnings(lavaan::lavCor(dat[unname(ix)], ordered = ordered_vars,
                                      missing = if (lav_missing == "listwise") "listwise" else "pairwise")),
      error = function(e) NULL) else NULL
    if (is.null(Rm)) Rm <- stats::cor(dat[unname(ix)], use = "pairwise.complete.obs")
    Rm <- unclass(Rm)[unname(ix), unname(ix)]
    H <- htmt_matrix(Rm, lapply(fac_items_col, function(c) unname(ix[c])))
    hi <- character(0)
    rows <- lapply(seq_len(k), function(i) c(list(fac_names[i]), lapply(seq_len(k), function(j) {
      if (j >= i) return(NULL)
      if (is.finite(H[i, j]) && H[i, j] >= 0.85) hi <<- c(hi, paste(fac_names[j], fac_names[i], sep = " ↔ "))
      r3(H[i, j])
    })))
    tables <- c(tables, list(list(
      titleKey = "output.cfa.htmtTitle",
      columns = as.list(c("output.col.factor", fac_names)), rows = rows,
      footnoteKey = "output.cfa.htmtFootnote")))
    if (length(hi)) notes <- c(notes, paste0("output.cfa.htmtHigh:", paste(hi, collapse = ", ")))
  }

  # ── Modification indices ───────────────────────────────────────────────────
  if (flag(opts$mi, FALSE)) {
    mi_min <- suppressWarnings(as.numeric(opts$miMin)); if (!length(mi_min) || is.na(mi_min)) mi_min <- 3.84
    mi_top <- suppressWarnings(as.integer(opts$miTop)); if (!length(mi_top) || is.na(mi_top)) mi_top <- 20L
    mi <- tryCatch(lavaan::modindices(fit, sort. = TRUE, minimum.value = mi_min),
                   error = function(e) NULL)
    if (!is.null(mi)) {
      mi <- mi[mi$op %in% c("=~", "~~"), , drop = FALSE]
      mi <- utils::head(mi, mi_top)
      fac_of <- lapply(unname(ix), function(v) which(vapply(fac_items_col, function(c) v %in% ix[c], TRUE)))
      names(fac_of) <- unname(ix)
      same <- function(a, b) a %in% names(fac_of) && b %in% names(fac_of) &&
        length(intersect(fac_of[[a]], fac_of[[b]])) > 0
      tables <- c(tables, list(list(
        titleKey = "output.cfa.miTitle",
        columns = list("output.cfa.parameterCol", "output.cfa.miCol", "output.cfa.epc",
                       "output.cfa.sepc", "output.cfa.sameFactor"),
        rows = lapply(seq_len(nrow(mi)), function(i) { r <- mi[i, ]
          op <- if (r$op == "=~") " → " else " ↔ "
          lbl <- if (r$op == "=~") paste0(disp(r$lhs), op, disp(r$rhs)) else
            paste0(disp(r$lhs), op, disp(r$rhs))
          list(lbl, round(r$mi, 2), r3(r$epc), r3(r$sepc.all),
               if (r$op == "~~" && same(r$lhs, r$rhs)) "output.cfa.yes" else NULL) }),
        footnoteKey = paste0("output.cfa.miFootnote:", format(mi_min)))))
    }
  }

  # ── Measurement invariance ─────────────────────────────────────────────────
  if (has_group && flag(opts$invariance, TRUE)) {
    progress(75L, "progress.computing")
    steps <- list(
      list(key = "output.cfa.invConfigural", eq = character(0)),
      list(key = "output.cfa.invMetric", eq = "loadings"),
      list(key = "output.cfa.invScalar",
           eq = c("loadings", if (length(ordered_vars)) "thresholds" else "intercepts")))
    if (!length(ordered_vars)) steps <- c(steps, list(list(key = "output.cfa.invStrict",
      eq = c("loadings", "intercepts", "residuals"))))
    fits <- lapply(steps, function(s) tryCatch(
      suppressWarnings(fit_cfa(group = ".grp", group.equal = s$eq)),
      error = function(e) { warns <<- c(warns, paste0("output.cfa.invFailed:", conditionMessage(e))); NULL }))
    ok <- !vapply(fits, is.null, TRUE)
    if (any(ok)) {
      idx <- function(f) { v <- fit_values(lavaan::fitMeasures(f), robust); if (robust) v$rob else v$std }
      vals <- lapply(fits, function(f) if (is.null(f)) NULL else idx(f))
      rows <- list()
      for (s in seq_along(steps)) {
        if (!ok[s]) next
        v <- vals[[s]]
        prev <- if (s > 1 && ok[s - 1]) s - 1 else NA
        d <- if (!is.na(prev)) tryCatch(lavaan::lavTestLRT(fits[[s]], fits[[prev]]),
                                         error = function(e) NULL) else NULL
        dchi <- if (!is.null(d)) d[2, "Chisq diff"] else NA
        ddf <- if (!is.null(d)) d[2, "Df diff"] else NA
        dp <- if (!is.null(d)) d[2, "Pr(>Chisq)"] else NA
        dcfi <- if (!is.na(prev)) v$cfi - vals[[prev]]$cfi else NA
        drmsea <- if (!is.na(prev)) v$rmsea - vals[[prev]]$rmsea else NA
        verdict <- if (is.na(prev)) NULL else if (is.finite(dcfi) && is.finite(drmsea) &&
          dcfi >= -0.010 && drmsea <= 0.015) "output.cfa.invHolds" else "output.cfa.invFails"
        rows[[length(rows) + 1L]] <- list(steps[[s]]$key, r3(v$chisq), as.integer(round(v$df)),
          r3(v$cfi), r3(v$tli), r3(v$rmsea), r3(v$srmr), r3(dchi),
          if (is.finite(ddf)) as.integer(round(ddf)) else NULL, rp(dp), r3(dcfi), r3(drmsea), verdict)
      }
      tables <- c(tables, list(list(
        titleKey = paste0("output.cfa.invTitle:", params$groupName %||% group_col),
        columns = list("output.col.model", "output.col.chiSquare", "output.col.df", "CFI", "TLI",
                       "RMSEA", "SRMR", "output.cfa.dChi", "output.cfa.dDf", "output.col.sig",
                       "output.cfa.dCfi", "output.cfa.dRmsea", "output.cfa.decision"),
        rows = rows,
        footnoteKey = if (length(ordered_vars)) "output.cfa.invFootnoteOrdinal" else "output.cfa.invFootnote")))
    }
  }

  # ── Path diagram ───────────────────────────────────────────────────────────
  if (flag(opts$diagram, TRUE)) {
    std_load <- list()
    for (i in seq_len(nrow(ld))) std_load[[paste(match(ld$lhs[i], fx), ld$rhs[i])]] <- ld$std.all[i]
    svg <- path_diagram_svg(fac_names, lapply(fac_items_col, function(c) unname(ix[c])),
                            as.list(disp_item), std_load, as.list(std_item_resid),
                            if (correlated) phi else NULL)
    plots <- c(plots, list(list(titleKey = "output.cfa.diagramTitle", type = "svg",
                                data = jsonlite::base64_enc(charToRaw(enc2utf8(svg))))))
  }

  progress(95L, "progress.finishing")
  sai_output(tables = tables, plots = plots, warnings = warns, notes = notes)
}, error = function(e) sai_error(conditionMessage(e)))
