# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# tree.R — Classification Tree (SPSS Classify > Tree, "CRT" growing method,
# via rpart — R's own CART implementation).
#
# Params: groupVar, groupName, groupValueLabels (raw code -> value label,
#   optional), independents (colIds), varNames,
#   options$minCases — minimum cases in a node before it may split
#     (rpart's minsplit; SPSS's "Minimum Cases: Parent Node"), default 20.
#   options$maxDepth — maximum tree depth (rpart's maxdepth), default 5
#     (SPSS's own Tree default is also 5, deeper than rpart's default 30 —
#     kept shallow so the printed node table stays readable).
#
# Scope note: this is CRT/CART only (SPSS also offers CHAID/Exhaustive
# CHAID/QUEST — different splitting criteria, no equivalent base/recommended
# R implementation available; `partykit`/`CHAID` aren't installed here).
# No rendered tree diagram (SPSS's headline visual) — a "Tree Structure"
# table (root-to-node split path via rpart's own path.rpart(), not
# hand-parsed) gives the same information as text, which every node in the
# diagram would show anyway. Risk/Classification use resubstitution
# (predicting the training data with the fitted tree) — this matches SPSS's
# own Tree default (unlike knn.R's leave-one-out choice: KNN is pure
# memorization so resubstitution is trivially perfect for k=1 and always
# optimistic, but CRT's recursive partitioning + minCases/maxDepth stopping
# rules bound its ability to memorize, so resubstitution here is the
# SPSS-documented convention, not a correctness compromise).

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  if (!requireNamespace("rpart", quietly = TRUE)) {
    sai_output(tables = list(), warnings = list("output.tree.needsPackage")); quit(save = "no")
  }

  gvar <- params$groupVar
  indeps <- unlist(params$independents); var_names <- params$varNames
  opts <- if (is.null(params$options)) list() else params$options
  min_cases <- if (!is.null(opts$minCases)) as.integer(opts$minCases) else 20L
  max_depth <- if (!is.null(opts$maxDepth)) as.integer(opts$maxDepth) else 5L

  if (is.null(gvar) || !gvar %in% names(df)) sai_error("Grouping variable not found")
  if (length(indeps) == 0) sai_error("No independent variables specified")
  if (is.na(min_cases) || min_cases < 2) sai_error("Minimum cases per node must be at least 2")
  if (is.na(max_depth) || max_depth < 1) sai_error("Maximum tree depth must be at least 1")

  # Predictor columns are named after their SAI display names (already
  # guaranteed valid R identifiers + unique within a dataset by the app's
  # own variable-name constraints) rather than generic x1/x2/... — so
  # path.rpart()'s split-rule text below reads naturally (e.g.
  # "PetalLength< 2.45") instead of an opaque internal name.
  pred_names <- resolve_var_names(indeps, var_names)
  # Names are pasted into a model formula below: allow plain identifiers only.
  if (!all(grepl("^[A-Za-z_][A-Za-z0-9_]*$", pred_names))) sai_error("Invalid predictor variable name")
  dat <- data.frame(.g = factor(as.character(df[[gvar]])))
  for (i in seq_along(indeps)) dat[[pred_names[i]]] <- suppressWarnings(as.numeric(df[[indeps[i]]]))
  # Carried through the listwise deletion for NV1 (roadmap ★11). The rpart
  # formula below names its predictors EXPLICITLY as a result: `.g ~ .` would
  # hand the row number to the tree as a splitting variable, which it would
  # happily use (see row_index_of()'s warning).
  dat[["__row_idx"]] <- row_index_of(df)
  dat <- dat[stats::complete.cases(dat), , drop = FALSE]
  dat$.g <- droplevels(dat$.g)
  n <- nrow(dat)
  if (nlevels(dat$.g) < 2) sai_error("Need at least 2 categories in the target variable")

  fit <- rpart::rpart(
    stats::as.formula(paste(".g ~", paste(sprintf("`%s`", pred_names), collapse = " + "))),
    data = dat, method = "class",
    control = rpart::rpart.control(minsplit = min_cases, maxdepth = max_depth, cp = 0.01)
  )

  frame <- fit$frame
  node_ids <- as.integer(row.names(frame))
  ylevels <- attr(fit, "ylevels")
  pred_class <- ylevels[frame$yval]
  pred_class_disp <- resolve_var_names(pred_class, params$groupValueLabels)
  paths <- rpart::path.rpart(fit, nodes = node_ids, print.it = FALSE)

  node_rows <- lapply(seq_along(node_ids), function(i) {
    nid <- node_ids[i]
    parent <- if (nid == 1L) NULL else as.integer(nid %/% 2L)
    rule <- paths[[as.character(nid)]]
    rule_text <- if (length(rule) > 1) rule[length(rule)] else "output.tree.root"
    is_terminal <- identical(frame$var[i], "<leaf>")
    list(as.integer(nid), parent, rule_text, as.integer(frame$n[i]), pred_class_disp[i],
         if (is_terminal) "output.tree.terminal" else "output.tree.split")
  })

  pred <- predict(fit, type = "class")
  actual <- dat$.g
  # `lvls` indexes the raw factor levels (table() needs the actual codes);
  # `lvls_disp` is the same order resolved through groupValueLabels for
  # display (Classification table header + row labels).
  lvls <- levels(actual)
  lvls_disp <- resolve_var_names(lvls, params$groupValueLabels)
  tab <- table(actual = actual, predicted = pred)[lvls, lvls, drop = FALSE]
  acc <- sum(diag(tab)) / sum(tab)
  risk <- 1 - acc
  risk_se <- sqrt(risk * (1 - risk) / n)

  class_rows <- lapply(seq_along(lvls), function(i) {
    lv <- lvls[i]
    row_counts <- as.integer(tab[lv, ])
    row_total <- sum(row_counts)
    pct_correct <- if (row_total > 0) round(tab[lv, lv] / row_total * 100, 1) else 0
    c(list(lvls_disp[i]), as.list(row_counts), list(pct_correct))
  })
  overall_row <- c(list("output.knn.overallRow"), lapply(seq_along(lvls), function(i) NULL),
                    list(round(acc * 100, 1)))
  class_rows <- c(class_rows, list(overall_row))

  n_terminal <- sum(frame$var == "<leaf>")

  progress(100L, "progress.done")
  # ── New variables (NV1) ────────────────────────────────────────────────────
  # The terminal node id is the one people actually re-use: it turns the tree
  # into a segmentation you can group by, which no table can do.
  case_vars <- list()
  want <- requested_new_vars(params)
  if (length(want) > 0) {
    if (!is.null(want[["predictedGroup"]])) {
      case_vars[[length(case_vars) + 1L]] <- sai_case_var(
        want[["predictedGroup"]], as.character(stats::predict(fit, type = "class")), dat,
        labelKey = "output.tree.newVar.predictedGroup", type = "string", measure = "nominal")
    }
    if (!is.null(want[["probability"]])) {
      pp <- stats::predict(fit, type = "prob")
      case_vars[[length(case_vars) + 1L]] <- sai_case_var(
        want[["probability"]], pp[cbind(seq_len(nrow(pp)), max.col(pp, ties.method = "first"))],
        dat, labelKey = "output.tree.newVar.probability")
    }
    if (!is.null(want[["node"]])) {
      case_vars[[length(case_vars) + 1L]] <- sai_case_var(
        # fit$where is rpart's own row index into fit$frame for each training
        # case; its row names ARE the node ids the table above prints, so the
        # column joins straight onto the reported tree. (Public object field —
        # rpart:::pred.rpart would be the internal way to recompute it.)
        want[["node"]], as.integer(row.names(fit$frame)[fit$where]), dat,
        labelKey = "output.tree.newVar.node", measure = "nominal", decimals = 0)
    }
  }

  sai_output(caseVars = case_vars, tables = list(
    list(titleKey = "output.tree.modelSummaryTitle",
         columns = list("output.col.statistic", "output.col.value"),
         rows = list(
           list("output.col.n", as.integer(n)),
           list("output.tree.nNodes", as.integer(nrow(frame))),
           list("output.tree.nTerminal", as.integer(n_terminal))
         ),
         footnoteKey = NULL),
    list(titleKey = "output.tree.riskTitle",
         columns = list("output.col.statistic", "output.col.value"),
         rows = list(
           list("output.tree.estimate", round(risk, 3)),
           list("output.col.stdError", round(risk_se, 3))
         ),
         footnoteKey = "output.tree.riskFootnote"),
    list(titleKey = "output.knn.classTitle",
         columns = c(list("output.col.observed"), as.list(lvls_disp), list("output.knn.percentCorrect")),
         rows = class_rows,
         footnoteKey = "output.tree.classFootnote"),
    list(titleKey = "output.tree.structureTitle",
         columns = list("output.tree.node", "output.tree.parent", "output.tree.rule",
                        "output.col.n", "output.tree.predicted", "output.tree.nodeType"),
         rows = node_rows,
         footnoteKey = NULL)))
}, error = function(e) sai_error(conditionMessage(e)))
