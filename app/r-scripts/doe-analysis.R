# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# doe-analysis.R — Design of Experiments › Analyze Design: the ANOVA each
# classical design calls for, the coefficient of variation, and mean
# comparisons with letter groups (agricolae), or effect estimates with a
# Pareto chart for a 2^k factorial.
#
# Params: response (colId), design, varNames, valueLabels (colId -> code ->
#   label, for level names), and per design:
#     crd        treatment
#     rcbd       treatment, block
#     latin      treatment, row, column
#     factorial  factors [A, B (, C)], block (optional)
#     splitplot  mainFactor, subFactor, block
#     twok       factors [k columns coded -1 / +1]
#   options: comparison "lsd" (default) | "tukey" | "duncan" | "snk" | "none";
#            alpha (default .05)
#
# Models (sequential sums of squares; balanced designs give the textbook
# table, and an unbalanced layout is flagged):
#   crd y ~ T;  rcbd y ~ Block + T;  latin y ~ Row + Column + T;
#   factorial y ~ [Block +] A * B [* C];
#   splitplot y ~ Block + A + Block:A + B + A:B — Block and A are tested
#     against Error (a) = Block:A, B and A:B against Error (b) = residual;
#     CV(a) and CV(b) are reported. Same table as agricolae::sp.plot except the
#     block F: block is a whole-plot effect, so Error (a) is its error term
#     (Gomez & Gomez 1984), where sp.plot divides by Error (b);
#   twok  y ~ full factorial on the -1/+1 codes: effect = 2 x coefficient.
#     With replicates the effects get t tests; an unreplicated design has no
#     error degrees of freedom, so Lenth's (1989) pseudo standard error, margin
#     of error (ME) and simultaneous margin of error (SME) judge them instead.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

r2 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 2) else NULL
r3 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 3) else NULL
r4 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 4) else NULL

#' Level labels of a coded factor column: value labels when defined, else the code.
level_factor <- function(colId) {
  x <- apply_user_missing(df[[colId]], colId, params)
  lab <- params$valueLabels[[colId]]
  codes <- sai_sorted_levels(x)
  shown <- vapply(codes, function(c) resolve_var_name(c, lab), "")
  factor(as.character(x), levels = codes, labels = make.unique(shown))
}

#' ANOVA rows from an aov/lm fit: SS, df, MS, F, p, with the F of each term
#' against `err_of[term]` (default: the residual).
anova_rows <- function(tab, disp, err_of = list(), err_rows = character(0)) {
  terms <- rownames(tab); terms <- trimws(terms)
  ms <- tab[, "Sum Sq"] / tab[, "Df"]; names(ms) <- terms
  out <- list()
  for (i in seq_along(terms)) {
    tm <- terms[i]
    if (tm == "Residuals") next
    e <- if (!is.null(err_of[[tm]])) err_of[[tm]] else "Residuals"
    is_err <- tm %in% err_rows
    F <- if (is_err) NA else ms[[tm]] / ms[[e]]
    dfe <- tab[terms == e, "Df"]
    out[[length(out) + 1]] <- list(disp(tm), r4(tab[i, "Sum Sq"]), as.integer(tab[i, "Df"]), r4(ms[[tm]]),
      if (is_err) NULL else r3(F), if (is_err) NULL else r4(stats::pf(F, tab[i, "Df"], dfe, lower.tail = FALSE)))
  }
  if ("Residuals" %in% terms) {
    i <- which(terms == "Residuals")
    out[[length(out) + 1]] <- list(disp("Residuals"), r4(tab[i, "Sum Sq"]), as.integer(tab[i, "Df"]), r4(ms[["Residuals"]]), NULL, NULL)
  }
  out
}

#' Mean comparison with letter groups.
compare_means <- function(y, trt, dfe, mse, method, alpha) {
  f <- switch(method, tukey = agricolae::HSD.test, duncan = agricolae::duncan.test,
              snk = agricolae::SNK.test, agricolae::LSD.test)
  o <- f(y, trt, DFerror = dfe, MSerror = mse, alpha = alpha, group = TRUE, console = FALSE)
  g <- o$groups; mn <- o$means
  rows <- lapply(rownames(g), function(lv) list(lv, as.integer(mn[lv, "r"]), r3(g[lv, 1]),
                                               r3(mn[lv, "std"]), as.character(g[lv, "groups"])))
  crit <- switch(method, tukey = o$statistics$MSD, duncan = NULL, snk = NULL, o$statistics$LSD)
  list(rows = rows, crit = if (is.null(crit)) NA else crit)
}

tryCatch({
  progress(10L, "progress.loading")
  sai_weight_unsupported("output.doe.title")
  design <- params$design
  if (!design %in% c("crd", "rcbd", "latin", "factorial", "splitplot", "twok")) sai_error("Unknown design")
  opts <- if (is.null(params$options)) list() else params$options
  method <- if (!is.null(opts$comparison) && opts$comparison %in% c("lsd", "tukey", "duncan", "snk", "none")) opts$comparison else "lsd"
  alpha <- suppressWarnings(as.numeric(opts$alpha)); if (!length(alpha) || is.na(alpha)) alpha <- 0.05
  vn <- params$varNames
  name_of <- function(c) resolve_var_names(c, vn)
  y <- suppressWarnings(as.numeric(apply_user_missing(df[[params$response]], params$response, params)))

  role_cols <- switch(design,
    crd = list(T = params$treatment),
    rcbd = list(Block = params$block, T = params$treatment),
    latin = list(Row = params$row, Column = params$column, T = params$treatment),
    factorial = c(if (!is.null(params$block) && nzchar(params$block)) list(Block = params$block),
                  setNames(as.list(unlist(params$factors)), LETTERS[seq_along(unlist(params$factors))])),
    splitplot = list(Block = params$block, A = params$mainFactor, B = params$subFactor),
    twok = setNames(as.list(unlist(params$factors)), LETTERS[seq_along(unlist(params$factors))]))
  if (any(vapply(role_cols, function(c) is.null(c) || !nzchar(c) || !c %in% names(df), TRUE)))
    sai_error("Assign every variable the design needs")
  d <- data.frame(y = y)
  for (r in names(role_cols)) {
    d[[r]] <- if (design == "twok") suppressWarnings(as.numeric(df[[role_cols[[r]]]])) else level_factor(role_cols[[r]])
  }
  n_all <- nrow(d); d <- d[stats::complete.cases(d), , drop = FALSE]
  if (nrow(d) < 3) sai_error("Not enough complete cases")
  notes <- character(0); warns <- character(0)
  if (nrow(d) < n_all) notes <- c(notes, paste0("output.doe.excluded:", n_all - nrow(d)))
  role_name <- vapply(names(role_cols), function(r) name_of(role_cols[[r]]), "")
  disp <- function(tm) {
    if (tm == "Residuals") return("output.doe.error")
    parts <- strsplit(tm, ":", fixed = TRUE)[[1]]
    paste(vapply(parts, function(p) if (p %in% names(role_name)) role_name[[p]] else p, ""), collapse = " × ")
  }
  tables <- list(); plots <- list()
  resp_name <- name_of(params$response)

  # ── 2^k factorial ──────────────────────────────────────────────────────────
  if (design == "twok") {
    fx <- names(role_cols)
    if (!all(unlist(d[fx]) %in% c(-1, 1))) sai_error("2^k factors must be coded -1 / +1")
    fit <- stats::lm(stats::as.formula(paste("y ~ (", paste(fx, collapse = " + "), ")^", length(fx))), d)
    cf <- stats::coef(fit)[-1]
    if (anyNA(cf)) sai_error("The 2^k design is incomplete: some effects cannot be estimated")
    eff <- 2 * cf
    dfe <- stats::df.residual(fit)
    if (dfe > 0) {
      sm <- summary(fit)$coefficients[-1, , drop = FALSE]
      tv <- sm[, 3]; pv <- sm[, 4]
      rows <- lapply(seq_along(eff), function(i) list(disp(names(eff)[i]), r4(eff[i]), r4(cf[i]), r4(sm[i, 2]),
                                                      r3(tv[i]), r4(pv[i])))
      tables <- c(tables, list(list(titleKey = "output.doe.effectsTitle",
        columns = list("output.doe.term", "output.doe.effect", "output.doe.coef", "output.col.stdError",
                       "output.col.t", "output.col.sig"),
        rows = rows, footnoteKey = paste0("output.doe.effectsFootnote:", dfe))))
      crit <- stats::qt(1 - alpha / 2, dfe); stat <- abs(tv); crit_key <- "output.doe.paretoCritT"
      av <- stats::anova(fit)
      tables <- c(tables, list(list(titleKey = paste0("output.doe.anovaTitle:", resp_name),
        columns = list("output.col.source", "output.col.sumSq", "output.col.df", "output.col.mS", "output.col.f", "output.col.sig"),
        rows = c(anova_rows(av, disp), list(list("output.col.total", r4(sum(av[, "Sum Sq"])), as.integer(sum(av[, "Df"])), NULL, NULL, NULL))),
        footnoteKey = NULL)))
    } else {
      m <- length(eff); a <- abs(eff)
      s0 <- 1.5 * stats::median(a); pse <- 1.5 * stats::median(a[a < 2.5 * s0])
      me <- stats::qt(0.975, m / 3) * pse
      sme <- stats::qt((1 + 0.95^(1 / m)) / 2, m / 3) * pse
      rows <- lapply(seq_along(eff), function(i) list(disp(names(eff)[i]), r4(eff[i]), r4(cf[i]), r3(eff[i] / pse),
        if (a[i] > sme) "output.doe.lenthActiveSme" else if (a[i] > me) "output.doe.lenthActiveMe" else NULL))
      tables <- c(tables, list(list(titleKey = "output.doe.effectsTitle",
        columns = list("output.doe.term", "output.doe.effect", "output.doe.coef", "output.doe.pseudoT", "output.doe.lenthActive"),
        rows = rows,
        footnoteKey = paste0("output.doe.lenthFootnote:", format(round(pse, 4)), "|", format(round(me, 4)), "|", format(round(sme, 4))))))
      stat <- a; crit <- me; crit_key <- "output.doe.paretoCritMe"
    }
    # Main-effect means at the low / high level.
    tables <- c(tables, list(list(titleKey = "output.doe.mainMeansTitle",
      columns = list("output.col.factor", "output.doe.low", "output.doe.high", "output.doe.effect"),
      rows = lapply(fx, function(f) list(role_name[[f]], r4(mean(d$y[d[[f]] == -1])), r4(mean(d$y[d[[f]] == 1])),
                                         r4(mean(d$y[d[[f]] == 1]) - mean(d$y[d[[f]] == -1])))),
      footnoteKey = NULL)))
    ord <- order(stat)
    lbl <- vapply(names(eff), disp, "")[ord]
    plots <- list(list(titleKey = "output.doe.paretoTitle", type = "plotly", data = list(
      data = list(list(type = "bar", orientation = "h", x = as.list(unname(stat[ord])), y = as.list(unname(lbl)),
                       marker = list(color = ifelse(stat[ord] > crit, "#2166ac", "#9ecae1")), showlegend = FALSE)),
      layout = list(
        xaxis = list(title = list(text = if (dfe > 0) "|t|" else "|effect|")),
        yaxis = list(automargin = TRUE, type = "category"),
        shapes = list(list(type = "line", x0 = crit, x1 = crit, y0 = 0, y1 = 1, yref = "paper",
                           line = list(color = "#b2182b", dash = "dash"))),
        annotations = list(list(x = crit, y = 1, yref = "paper", text = format(round(crit, 3)),
                                showarrow = FALSE, yanchor = "bottom", font = list(color = "#b2182b"))),
        height = max(320, 60 + 26 * length(eff)), margin = list(t = 30, r = 20, b = 50, l = 10)))))
    notes <- c(notes, crit_key)
    sai_output(tables = tables, plots = plots, notes = notes, warnings = warns)
    quit(save = "no", status = 0)
  }

  # ── Classical designs ─────────────────────────────────────────────────────
  rhs <- switch(design,
    crd = "T", rcbd = "Block + T", latin = "Row + Column + T",
    factorial = paste(c(if ("Block" %in% names(role_cols)) "Block",
                        paste(setdiff(names(role_cols), "Block"), collapse = " * ")), collapse = " + "),
    splitplot = "Block + A + Block:A + B + A:B")
  fit <- stats::aov(stats::as.formula(paste("y ~", rhs)), d)
  tab <- stats::anova(fit)
  rownames(tab) <- trimws(rownames(tab))
  fac_cols <- setdiff(names(role_cols), c("Block", "Row", "Column"))
  cell_n <- table(d[fac_cols])
  balanced <- length(unique(as.vector(cell_n))) == 1 && all(cell_n > 0)
  if (design %in% c("rcbd", "splitplot", "latin")) {
    bl <- table(d[c(intersect(c("Block", "Row"), names(role_cols)), fac_cols)])
    balanced <- balanced && all(bl == bl[1])
  }
  if (!balanced) notes <- c(notes, "output.doe.unbalanced")
  if (design == "splitplot") {
    rownames(tab)[rownames(tab) == "Block:A"] <- "Ea"
    disp2 <- function(tm) if (tm == "Ea") "output.doe.errorA" else if (tm == "Residuals") "output.doe.errorB" else disp(tm)
    rows <- anova_rows(tab, disp2, err_of = list(Block = "Ea", A = "Ea"), err_rows = "Ea")
  } else rows <- anova_rows(tab, disp)
  ss_tot <- sum((d$y - mean(d$y))^2)
  rows <- c(rows, list(list("output.col.total", r4(ss_tot), as.integer(nrow(d) - 1), NULL, NULL, NULL)))
  mse <- tab["Residuals", "Sum Sq"] / tab["Residuals", "Df"]; dfe <- tab["Residuals", "Df"]
  cv <- 100 * sqrt(mse) / mean(d$y)
  cv_note <- if (design == "splitplot") {
    msa <- tab["Ea", "Sum Sq"] / tab["Ea", "Df"]
    paste0("output.doe.cvSplit:", format(round(100 * sqrt(msa) / mean(d$y), 2), nsmall = 2), "|",
           format(round(cv, 2), nsmall = 2), "|", format(round(mean(d$y), 4)))
  } else paste0("output.doe.cv:", format(round(cv, 2), nsmall = 2), "|", format(round(mean(d$y), 4)))
  tables <- c(tables, list(list(titleKey = paste0("output.doe.anovaTitle:", resp_name),
    columns = list("output.col.source", "output.col.sumSq", "output.col.df", "output.col.mS", "output.col.f", "output.col.sig"),
    rows = rows, footnoteKey = cv_note)))

  # ── Mean comparisons ──────────────────────────────────────────────────────
  if (method != "none") {
    add_cmp <- function(trt, label, dfe_, mse_, err_key) {
      cm <- compare_means(d$y, trt, dfe_, mse_, method, alpha)
      tables <<- c(tables, list(list(
        titleKey = paste0("output.doe.meansTitle:", label),
        columns = list("output.doe.level", "output.col.n", "output.col.mean", "output.col.stdDeviation", "output.doe.group"),
        rows = cm$rows,
        footnoteKey = paste0("output.doe.meansFootnote:", paste0("output.doe.method_", method), "|", format(alpha), "|",
                             format(round(mse_, 4)), "|", as.integer(dfe_), "|",
                             if (is.finite(cm$crit)) format(round(cm$crit, 4)) else "—", "|", err_key))))
    }
    if (design %in% c("crd", "rcbd", "latin")) add_cmp(d$T, role_name[["T"]], dfe, mse, "output.doe.error")
    if (design == "factorial") {
      for (f in fac_cols) add_cmp(d[[f]], role_name[[f]], dfe, mse, "output.doe.error")
      if (length(fac_cols) >= 2) {
        combo <- interaction(d[fac_cols], sep = " × ", drop = TRUE)
        add_cmp(combo, paste(role_name[fac_cols], collapse = " × "), dfe, mse, "output.doe.error")
      }
    }
    if (design == "splitplot") {
      msa <- tab["Ea", "Sum Sq"] / tab["Ea", "Df"]
      add_cmp(d$A, role_name[["A"]], tab["Ea", "Df"], msa, "output.doe.errorA")
      add_cmp(d$B, role_name[["B"]], dfe, mse, "output.doe.errorB")
      add_cmp(interaction(d$A, d$B, sep = " × ", drop = TRUE),
              paste(role_name[["A"]], role_name[["B"]], sep = " × "), dfe, mse, "output.doe.errorB")
      notes <- c(notes, "output.doe.splitCompareNote")
    }
  }

  progress(95L, "progress.finishing")
  sai_output(tables = tables, plots = plots, notes = notes, warnings = warns)
}, error = function(e) sai_error(conditionMessage(e)))
