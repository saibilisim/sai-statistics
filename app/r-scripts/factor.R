# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# factor.R — Factor Analysis (SPSS-style): principal components or a common
# factor extraction, with rotation, descriptives and factor-number aids.
#
# Params: variables (colIds), varNames, options:
#   extraction    "pc" (default) | "paf" | "ml" | "uls" | "gls"
#   matrix        "correlation" (default) | "polychoric" (ordinal / Likert items)
#   criterion     "eigen" (default, minEigen) | "fixed" (nFactors) | "parallel"
#   minEigen      default 1          nFactors   integer
#   maxIter       iterations for the common-factor extractions (default 100)
#   rotation      "none" | "varimax" | "quartimax" | "equamax" | "oblimin" | "promax"
#   kmoBartlett, univariate, correlation, antiImage   descriptives (bool)
#   scree, parallel     scree plot / parallel analysis table (bool)
#   sortBySize          sort loading rows by size (bool)
#   suppressBelow       blank loadings with |value| below this (number, optional)
#
# Defaults reproduce the original PCA-only output exactly (same tables, keys
# and order): Communalities (Initial = 1), Total Variance Explained, Component
# Matrix for components with eigenvalue > 1.
#
# Common factor extraction ("paf"/"ml"/"uls"/"gls") is psych::fa() with
# rotate = "none", min.err = 1e-6: psych's default stopping rule (min.err =
# .001) halts PAF before the communalities settle — the third decimal still
# moved against a fully iterated hand PAF. ML is checked against
# stats::factanal (loadings and the Bartlett-corrected chi-square match).
# Initial communalities are then squared multiple correlations, the table
# headings say "Factor" rather than "Component", and ML adds SPSS's
# Goodness-of-fit Test.
#
# Number of factors: Kaiser (eigenvalues of the analysed correlation matrix
# above minEigen — SPSS uses those eigenvalues for every extraction), a fixed
# number, or Horn's parallel analysis. Parallel analysis compares the observed
# eigenvalues with the 95th percentile of eigenvalues of random normal data of
# the same n and p. The random correlation matrices are drawn as Wishart
# matrices (stats::rWishart, n - 1 df, identity scale) and rescaled with
# cov2cor: exactly the distribution of the correlation matrix of n normal
# rows, at a cost that does not grow with n.
#
# Rotations: varimax (stats::varimax, Kaiser normalization), quartimax and
# equamax (GPArotation, normalize = TRUE; equamax = Crawford-Ferguson with
# kappa = m / 2p, i.e. orthomax gamma = m / 2 as in SPSS) are orthogonal and
# get Rotation Sums of Squared Loadings + Transformation Matrix. Oblimin
# (GPArotation::oblimin) and promax (psych::Promax) are oblique: Pattern,
# Structure and Factor Correlation matrices, and no rotation sums table — with
# correlated factors no clean variance split exists (SPSS omits it too).

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

#' Order of loading rows for SPSS's "Sorted by size": variables grouped by the
#' factor they load highest on (factor 1 first), descending within a group.
loading_order <- function(L) {
  a <- apply(abs(L), 1, which.max); m <- apply(abs(L), 1, max)
  order(a, -m)
}

#' Rows of a loading matrix as output cells: optionally sorted by size and
#' with coefficients below the suppression threshold left blank.
loading_rows <- function(L, nm, sort_rows, suppress) {
  ord <- if (sort_rows) loading_order(L) else seq_len(nrow(L))
  lapply(ord, function(i) c(list(nm[i]), lapply(seq_len(ncol(L)), function(j) {
    v <- L[i, j]
    if (!is.null(suppress) && abs(v) < suppress) NULL else round(v, 3)
  })))
}

#' Horn's parallel analysis (see header): mean and 95th percentile of the
#' eigenvalues of `iter` random correlation matrices of n normal rows.
parallel_eigen <- function(n, p, iter = 1000L, seed = 20261111L) {
  set.seed(seed)
  W <- stats::rWishart(iter, n - 1, diag(p))
  ev <- vapply(seq_len(iter), function(s)
    eigen(stats::cov2cor(W[, , s]), symmetric = TRUE, only.values = TRUE)$values,
    numeric(p))
  ev <- matrix(ev, nrow = p)
  list(mean = rowMeans(ev), p95 = apply(ev, 1, stats::quantile, 0.95, names = FALSE),
       iter = iter)
}

#' Build the Pattern/Structure/Factor Correlation Matrix tables shared by the
#' two oblique rotation modes (oblimin/promax) — see header comment for why
#' no "Rotation Sums of Squared Loadings" table accompanies these.
oblique_rotation_tables <- function(pattern, phi, nm, m, comp_cols, comp_col, hdr_key,
                                    footnote, sort_rows, suppress) {
  structure_mat <- pattern %*% phi
  phi_cols <- c(comp_col, paste0(hdr_key, seq_len(m)))
  phi_rows <- lapply(seq_len(m), function(i)
    c(list(as.integer(i)), lapply(seq_len(m), function(j) round(phi[i, j], 3))))
  list(
    list(titleKey = "output.factor.patternMatrixTitle",
         columns = as.list(comp_cols), rows = loading_rows(pattern, nm, sort_rows, suppress),
         footnoteKey = footnote),
    list(titleKey = "output.factor.structureMatrixTitle",
         columns = as.list(comp_cols), rows = loading_rows(structure_mat, nm, sort_rows, suppress),
         footnoteKey = footnote),
    list(titleKey = "output.factor.factorCorrTitle",
         columns = as.list(phi_cols), rows = phi_rows, footnoteKey = NULL))
}

tryCatch({
  progress(10L, "progress.loading")
  vars <- unlist(params$variables); var_names <- params$varNames
  opts <- if (is.null(params$options)) list() else params$options
  pick <- function(v, allowed) if (!is.null(v) && v %in% allowed) v else allowed[1]
  rotation   <- pick(opts$rotation, c("none", "varimax", "quartimax", "equamax", "oblimin", "promax"))
  extraction <- pick(opts$extraction, c("pc", "paf", "ml", "uls", "gls"))
  mat_type   <- pick(opts$matrix, c("correlation", "polychoric"))
  criterion  <- pick(opts$criterion, c("eigen", "fixed", "parallel"))
  num_opt <- function(v, default) {
    x <- suppressWarnings(as.numeric(v))
    if (length(x) != 1 || is.na(x)) default else x
  }
  min_eigen <- num_opt(opts$minEigen, 1)
  max_iter  <- max(1L, as.integer(num_opt(opts$maxIter, 100)))
  suppress  <- if (is.null(opts$suppressBelow)) NULL else {
    s <- num_opt(opts$suppressBelow, NA_real_); if (is.na(s) || s <= 0) NULL else s
  }
  sort_rows <- isTRUE(opts$sortBySize)
  is_pc <- extraction == "pc"
  if (length(vars) < 2) sai_error("Factor analysis needs at least two variables")
  nm <- resolve_var_names(vars, var_names)

  mat <- sapply(vars, function(c) suppressWarnings(as.numeric(apply_user_missing(df[[c]], c, params))))
  # Which dataset rows survive the listwise deletion, kept for NV1 (roadmap
  # ★11). `mat` is a matrix, so it cannot carry __row_idx as a column the way
  # the data-frame scripts do — the mask is recorded instead.
  keep_rows <- stats::complete.cases(mat)
  mat <- mat[keep_rows, , drop = FALSE]
  if (nrow(mat) < 3) sai_error("Not enough complete cases")
  p <- ncol(mat); n <- nrow(mat)

  tables <- list(); warns <- character(0); notes <- character(0); plots <- list()

  # ── Matrix to analyse ───────────────────────────────────────────────────────
  # Polychoric correlations treat each item as a coarsened normal variable —
  # the right matrix for Likert items. psych::polychoric needs a handful of
  # integer categories; anything else falls back to Pearson, with a warning.
  R <- cor(mat)
  if (mat_type == "polychoric") {
    ok <- all(abs(mat - round(mat)) < 1e-9) &&
      all(apply(mat, 2, function(v) length(unique(v))) <= 10)
    pc <- if (ok) tryCatch(suppressWarnings(psych::polychoric(mat)$rho),
                           error = function(e) NULL) else NULL
    if (is.null(pc)) {
      warns <- c(warns, "output.factor.polychoricFallback")
      mat_type <- "correlation"
    } else {
      R <- unname(pc)
      notes <- c(notes, "output.factor.polychoricNote")
    }
  }

  # ── Descriptives ────────────────────────────────────────────────────────────
  if (isTRUE(opts$univariate)) {
    tables <- c(tables, list(list(
      titleKey = "output.factor.descTitle",
      columns = list("output.col.variable", "output.col.mean", "output.col.stdDev",
                     "output.factor.analysisN"),
      rows = lapply(seq_len(p), function(i)
        list(nm[i], round(mean(mat[, i]), 3), round(stats::sd(mat[, i]), 3), as.integer(n))),
      footnoteKey = NULL)))
  }
  if (isTRUE(opts$correlation)) {
    tables <- c(tables, list(list(
      titleKey = "output.factor.corrTitle",
      columns = as.list(c("output.col.variable", nm)),
      rows = lapply(seq_len(p), function(i)
        c(list(nm[i]), lapply(seq_len(p), function(j) round(R[i, j], 3)))),
      footnoteKey = paste0("output.factor.determinantFootnote:",
                           format(signif(det(R), 3), scientific = det(R) < 1e-3)))))
  }

  # ── KMO and Bartlett's Test (Descriptives panel option) ─────────────────────
  # psych is a required package (setup.R) — no package gate needed. KMO() takes
  # either raw data or a correlation matrix (auto-detects square input);
  # cortest.bartlett() needs the correlation matrix + case count explicitly.
  kmo_res <- if (isTRUE(opts$kmoBartlett) || isTRUE(opts$antiImage))
    tryCatch(suppressWarnings(psych::KMO(R)), error = function(e) NULL) else NULL
  if (isTRUE(opts$kmoBartlett)) {
    bartlett_res <- tryCatch(psych::cortest.bartlett(R, n = n), error = function(e) NULL)
    if (!is.null(kmo_res) && !is.null(bartlett_res)) {
      tables <- c(tables, list(list(
        titleKey = "output.factor.kmoBartlettTitle",
        columns = list("output.col.statistic", "output.col.value"),
        rows = list(
          list("output.factor.kmoLabel", round(kmo_res$MSA, 3)),
          list("output.factor.bartlettChiLabel", round(bartlett_res$chisq, 3)),
          list("output.factor.bartlettDfLabel", as.integer(bartlett_res$df)),
          list("output.factor.bartlettSigLabel", round(bartlett_res$p.value, 6))
        ),
        footnoteKey = NULL
      )))
    }
  }
  # Anti-image correlation: negative partial correlations off the diagonal,
  # each variable's Measure of Sampling Adequacy on it (SPSS's layout). An item
  # with MSA below .50 is a candidate for removal before extraction.
  if (isTRUE(opts$antiImage)) {
    Rinv <- tryCatch(solve(R), error = function(e) NULL)
    if (is.null(Rinv) || is.null(kmo_res)) {
      warns <- c(warns, "output.factor.antiImageSingular")
    } else {
      # Partial correlation is -Rinv_ij / sqrt(Rinv_ii Rinv_jj); the
      # anti-image correlation is its negative.
      ai <- Rinv / sqrt(outer(diag(Rinv), diag(Rinv)))
      diag(ai) <- kmo_res$MSAi
      tables <- c(tables, list(list(
        titleKey = "output.factor.antiImageTitle",
        columns = as.list(c("output.col.variable", nm)),
        rows = lapply(seq_len(p), function(i)
          c(list(nm[i]), lapply(seq_len(p), function(j) round(ai[i, j], 3)))),
        footnoteKey = "output.factor.antiImageFootnote")))
      low <- nm[kmo_res$MSAi < 0.5]
      if (length(low) > 0) notes <- c(notes, paste0("output.factor.lowMsaNote:", paste(low, collapse = ", ")))
    }
  }

  # ── Number of factors ───────────────────────────────────────────────────────
  e <- eigen(R, symmetric = TRUE)
  eval <- e$values; evec <- e$vectors
  pa <- if (criterion == "parallel" || isTRUE(opts$parallel)) parallel_eigen(n, p) else NULL
  max_k <- if (is_pc) p else p - 1L
  k <- switch(criterion,
    eigen = sum(eval > min_eigen),
    fixed = as.integer(num_opt(opts$nFactors, 1)),
    parallel = { above <- eval > pa$p95; if (all(above)) p else which(!above)[1] - 1L })
  if (criterion == "parallel" && k < 1) warns <- c(warns, "output.factor.parallelNone")
  if (k > max_k) {
    warns <- c(warns, paste0("output.factor.tooManyFactors:", max_k))
    k <- max_k
  }
  k <- max(1L, k)
  retain <- seq_len(k)

  # ── Extraction ──────────────────────────────────────────────────────────────
  gof <- NULL
  if (is_pc) {
    load <- evec[, retain, drop = FALSE] %*% diag(sqrt(eval[retain]), k)
    init_comm <- rep(1, p)
  } else {
    fm <- c(paf = "pa", ml = "ml", uls = "uls", gls = "gls")[[extraction]]
    fa_warn <- character(0)
    printed <- utils::capture.output(fa_res <- withCallingHandlers(
      psych::fa(R, nfactors = k, n.obs = n, fm = fm, rotate = "none",
                max.iter = max_iter, min.err = 1e-6, warnings = TRUE),
      warning = function(w) {
        fa_warn <<- c(fa_warn, conditionMessage(w)); invokeRestart("muffleWarning")
      }), type = "output")
    if (any(grepl("maximum iteration", c(printed, fa_warn), ignore.case = TRUE))) {
      warns <- c(warns, paste0("output.factor.notConverged:", max_iter))
    }
    load <- unclass(fa_res$loadings)[, seq_len(k), drop = FALSE]
    # Factors in order of the variance they extract, like SPSS.
    load <- load[, order(-colSums(load^2)), drop = FALSE]
    init_comm <- psych::smc(R)
    if (extraction == "ml" && !is.null(fa_res$STATISTIC) && is.finite(fa_res$STATISTIC)) {
      gof <- list(chi = fa_res$STATISTIC, df = fa_res$dof, p = fa_res$PVAL)
    }
  }
  load <- unname(load)
  # An eigenvector's sign is arbitrary — v and -v span the same component — so
  # LAPACK's choice is as good as any mathematically, and useless to a reader.
  # SPSS reflects each column so its dominant loading is positive; without that
  # our whole Component Matrix came out negated (-.800 against SPSS's .800),
  # which reads as "these items load negatively" and inverts the
  # interpretation of every component. Communalities (squares) are unaffected.
  for (j in seq_len(ncol(load))) {
    if (load[which.max(abs(load[, j])), j] < 0) load[, j] <- -load[, j]
  }
  comm <- rowSums(load^2)
  if (!is_pc && any(comm >= 0.999)) {
    warns <- c(warns, paste0("output.factor.heywood:", paste(nm[comm >= 0.999], collapse = ", ")))
  }

  # Labels: SPSS says "Component" for PCA and "Factor" for everything else.
  comp_col <- if (is_pc) "output.col.component" else "output.col.factor"
  hdr_key  <- if (is_pc) "output.factor.compHdr:" else "output.factor.factorHdr:"
  comp_cols <- c("output.col.variable", paste0(hdr_key, retain))
  method_key <- paste0("output.factor.method.", extraction)
  rot_key <- paste0("output.factor.rot.", rotation)
  classic_pc <- is_pc && criterion == "eigen" && min_eigen == 1

  comm_rows <- lapply(seq_len(p), function(i) list(nm[i], round(init_comm[i], 3), round(comm[i], 3)))
  cum <- cumsum(eval) / p * 100
  tve_rows <- if (is_pc) {
    lapply(seq_len(p), function(i)
      list(as.integer(i), round(eval[i], 3), round(eval[i] / p * 100, 3), round(cum[i], 3)))
  } else {
    ss <- colSums(load^2); ss_cum <- cumsum(ss) / p * 100
    lapply(seq_len(p), function(i) c(
      list(as.integer(i), round(eval[i], 3), round(eval[i] / p * 100, 3), round(cum[i], 3)),
      if (i <= k) list(round(ss[i], 3), round(ss[i] / p * 100, 3), round(ss_cum[i], 3))
      else list(NULL, NULL, NULL)))
  }
  tve_cols <- c(list(comp_col, "output.col.eigenvalue", "output.col.pctVariance",
                     "output.col.cumulativePct"),
                if (is_pc) list() else list("output.factor.extrSSTotal", "output.factor.extrSSPct",
                                            "output.factor.extrSSCum"))

  tables <- c(tables, list(
    list(titleKey = "output.factor.commTitle",
         columns = list("output.col.variable", "output.col.initial", "output.col.extraction"),
         rows = comm_rows,
         footnoteKey = if (is_pc) NULL else paste0("output.factor.commFootnote:", method_key)),
    list(titleKey = "output.factor.tveTitle",
         columns = tve_cols, rows = tve_rows, footnoteKey = NULL)))

  # ── Parallel analysis table + scree plot ────────────────────────────────────
  if (!is.null(pa)) {
    pa_rows <- lapply(seq_len(p), function(i) list(
      as.integer(i), round(eval[i], 3), round(pa$mean[i], 3), round(pa$p95[i], 3),
      if (eval[i] > pa$p95[i] && all(eval[seq_len(i)] > pa$p95[seq_len(i)]))
        "output.factor.paRetain" else "output.factor.paDrop"))
    n_pa <- { above <- eval > pa$p95; if (all(above)) p else which(!above)[1] - 1L }
    tables <- c(tables, list(list(
      titleKey = "output.factor.parallelTitle",
      columns = list(comp_col, "output.factor.paObserved", "output.factor.paMean",
                     "output.factor.paP95", "output.factor.paDecision"),
      rows = pa_rows,
      footnoteKey = paste0("output.factor.parallelFootnote:", pa$iter, "|", n_pa))))
  }
  if (isTRUE(opts$scree)) {
    traces <- list(list(type = "scatter", mode = "lines+markers", name = "output.factor.screeObserved",
                        x = as.list(seq_len(p)), y = as.list(round(eval, 4)),
                        line = list(color = "#3b6ea5")))
    if (!is.null(pa)) traces <- c(traces, list(list(
      type = "scatter", mode = "lines", name = "output.factor.screeParallel",
      x = as.list(seq_len(p)), y = as.list(round(pa$p95, 4)),
      line = list(color = "#c94040", dash = "dash"))))
    plots <- c(plots, list(list(
      titleKey = "output.factor.screeTitle", type = "plotly",
      data = list(data = traces, layout = list(
        xaxis = list(title = list(text = if (is_pc) "output.factor.screeXComp" else "output.factor.screeXFactor"),
                     dtick = 1),
        yaxis = list(title = list(text = "output.col.eigenvalue"), rangemode = "tozero"),
        showlegend = !is.null(pa),
        shapes = if (criterion == "eigen") list(list(
          type = "line", xref = "paper", x0 = 0, x1 = 1, y0 = min_eigen, y1 = min_eigen,
          line = list(color = "#888", dash = "dot"))) else list(),
        margin = list(t = 40, r = 20, b = 50, l = 60))))))
  }

  tables <- c(tables, list(
    list(titleKey = if (is_pc) "output.factor.matrixTitle" else "output.factor.factorMatrixTitle",
         columns = as.list(comp_cols), rows = loading_rows(load, nm, sort_rows, suppress),
         footnoteKey = if (classic_pc) "output.factor.matrixFootnote"
                       else paste0("output.factor.extractFootnote:", method_key, "|", k))))
  if (!is.null(gof)) {
    tables <- c(tables, list(list(
      titleKey = "output.factor.gofTitle",
      columns = list("output.col.chiSquare", "output.col.df", "output.col.sig"),
      rows = list(list(round(gof$chi, 3), as.integer(gof$df), round(gof$p, 6))),
      footnoteKey = NULL)))
  }

  # ── Rotation ────────────────────────────────────────────────────────────────
  # Orthogonal rotation redistributes variance across the retained factors
  # without changing communalities or total variance; every rotation needs 2+
  # factors (a single one has nothing to rotate against).
  rot_load <- NULL; obl <- NULL
  if (k >= 2 && rotation %in% c("varimax", "quartimax", "equamax")) {
    rr <- switch(rotation,
      varimax = { vm <- stats::varimax(load); list(L = unclass(vm$loadings), T = unclass(vm$rotmat)) },
      quartimax = { q <- GPArotation::quartimax(load, normalize = TRUE); list(L = unclass(q$loadings), T = q$Th) },
      equamax = { q <- GPArotation::cfT(load, kappa = k / (2 * p), normalize = TRUE)
                  list(L = unclass(q$loadings), T = q$Th) })
    rot_load <- unname(rr$L); rotmat <- rr$T
    rot_ss    <- colSums(rot_load^2)
    rot_cum   <- cumsum(rot_ss) / p * 100
    rot_ss_rows <- lapply(retain, function(i)
      list(as.integer(i), round(rot_ss[i], 3), round(rot_ss[i] / p * 100, 3), round(rot_cum[i], 3)))
    transform_cols <- c(comp_col, paste0(hdr_key, retain))
    transform_rows <- lapply(retain, function(i)
      c(list(as.integer(i)), lapply(retain, function(j) round(rotmat[i, j], 3))))
    rot_foot <- if (is_pc && rotation == "varimax") "output.factor.rotatedMatrixFootnote"
                else paste0("output.factor.rotFootnote:", method_key, "|", rot_key)
    tables <- c(tables, list(
      list(titleKey = if (is_pc) "output.factor.rotatedMatrixTitle" else "output.factor.rotatedFactorMatrixTitle",
           columns = as.list(comp_cols), rows = loading_rows(rot_load, nm, sort_rows, suppress),
           footnoteKey = rot_foot),
      list(titleKey = "output.factor.rotationSSTitle",
           columns = list(comp_col, "output.col.eigenvalue",
                          "output.col.pctVariance", "output.col.cumulativePct"),
           rows = rot_ss_rows, footnoteKey = NULL),
      list(titleKey = if (is_pc) "output.factor.transformMatrixTitle" else "output.factor.factorTransformMatrixTitle",
           columns = as.list(transform_cols), rows = transform_rows, footnoteKey = NULL)))
  } else if (k >= 2 && rotation %in% c("oblimin", "promax")) {
    obl <- if (rotation == "oblimin") tryCatch(GPArotation::oblimin(load), error = function(e) NULL)
           else tryCatch(psych::Promax(load), error = function(e) NULL)
    if (!is.null(obl)) {
      foot <- if (is_pc) "output.factor.obliqueMatrixFootnote"
              else paste0("output.factor.rotFootnote:", method_key, "|", rot_key)
      tables <- c(tables, oblique_rotation_tables(unname(unclass(obl$loadings)), obl$Phi, nm, k,
                                                  comp_cols, comp_col, hdr_key, foot, sort_rows, suppress))
    }
  }
  if (!is.null(suppress)) notes <- c(notes, paste0("output.factor.suppressNote:", format(suppress)))

  # ── Item diagnostics on the matrix the user interprets ─────────────────────
  # Final loadings: rotated (orthogonal), pattern (oblique) or unrotated. An
  # item with no loading of .30 or more measures none of the factors; one
  # loading .30+ on two factors less than .10 apart is a cross-loading item —
  # the two checks scale-development reports ask for before dropping items.
  final <- if (!is.null(rot_load)) rot_load else if (!is.null(obl)) unclass(obl$loadings) else load
  absf <- abs(final)
  low_items <- nm[apply(absf, 1, max) < 0.30]
  if (length(low_items) > 0) notes <- c(notes, paste0("output.factor.lowLoadingNote:", paste(low_items, collapse = ", ")))
  if (k >= 2) {
    cross <- nm[apply(absf, 1, function(r) {
      s <- sort(r, decreasing = TRUE); s[2] >= 0.30 && (s[1] - s[2]) < 0.10
    })]
    if (length(cross) > 0) notes <- c(notes, paste0("output.factor.crossLoadingNote:", paste(cross, collapse = ", ")))
  }

  # ── New variables (NV1) ────────────────────────────────────────────────────
  # Factor scores by the regression method (SPSS's default): F = Z R^-1 S,
  # where Z is the standardised data, R the analysed correlation matrix and S
  # the structure loadings (for orthogonal solutions the loadings themselves).
  # The ROTATED solution is used whenever a rotation was applied, so the scores
  # belong to the structure the user is actually reading in the output rather
  # than to an unrotated one they never saw. Scores come out standardised,
  # which is what makes them usable as inputs to a following analysis.
  case_vars <- list()
  want <- requested_new_vars(params)
  if (length(want) > 0) {
    score_load <- if (!is.null(rot_load)) rot_load
                  else if (!is.null(obl)) unclass(obl$loadings) %*% obl$Phi
                  else load
    Z <- scale(mat)
    coefs <- tryCatch(solve(R, score_load), error = function(e) NULL)
    if (is.null(coefs)) {
      # A singular correlation matrix (perfectly collinear variables) has no
      # regression scores. Say so instead of writing a column of nothing.
      warns <- c(warns, "output.factor.scoresSingular")
    } else {
      scores <- Z %*% coefs
      case_df <- data.frame(.i = seq_len(nrow(mat)))
      case_df[["__row_idx"]] <- row_index_of(df)[keep_rows]
      for (j in retain) {
        key <- paste0("score", j)
        if (!is.null(want[[key]])) {
          case_vars[[length(case_vars) + 1L]] <-
            sai_case_var(want[[key]], scores[, j], case_df,
                         labelKey = paste0("output.factor.newVar.score:", j), decimals = 5)
        }
      }
    }
  }

  progress(100L, "progress.done")
  sai_output(tables = tables, plots = plots, caseVars = case_vars, warnings = warns, notes = notes)
}, error = function(e) sai_error(conditionMessage(e)))
