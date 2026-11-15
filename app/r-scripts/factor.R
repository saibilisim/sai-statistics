# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# factor.R — Factor Analysis (SPSS-style): principal components or a common
# factor extraction, with rotation, descriptives, factor scores and
# factor-number aids.
#
# Params: variables (colIds), varNames, options:
#   extraction    "pc" (default) | "paf" | "ml" | "uls" | "gls" | "alpha" | "image"
#   matrix        "correlation" (default) | "polychoric" (ordinal / Likert items)
#                 | "covariance" (pc / paf / image only, as in SPSS)
#   missing       "listwise" (default) | "pairwise" | "mean" (replace with mean)
#   criterion     "eigen" (default, minEigen) | "fixed" (nFactors) | "parallel"
#   minEigen      default 1 (for a covariance matrix: times the mean eigenvalue)
#   nFactors      integer
#   maxIter       iterations for the iterative extractions (default 100)
#   rotation      "none" | "varimax" | "quartimax" | "equamax" | "oblimin" | "promax"
#   delta         direct oblimin parameter (default 0, at most 0.8)
#   kappa         promax power (default 4)
#   rotationMaxIter   iterations for the rotation (default 1000)
#   initialSolution, unrotated, rotatedSolution   display (bool, default TRUE)
#   univariate, correlation, sigLevels, determinant, inverse, reproduced,
#   kmoBartlett, antiImage                          descriptives (bool)
#   scree, parallel, loadingPlot                    plots / tables (bool)
#   sortBySize          sort loading rows by size (bool)
#   suppressBelow       blank loadings with |value| below this (number, optional)
#   scoreMethod         "regression" (default) | "bartlett" | "anderson"
#   scoreCoef           factor score coefficient + covariance matrices (bool)
#
# Defaults reproduce the original PCA-only output exactly (same tables, keys
# and order): Communalities (Initial = 1), Total Variance Explained, Component
# Matrix for components with eigenvalue > 1.
#
# Common factor extraction ("paf"/"ml"/"uls"/"gls"/"alpha") is psych::fa()
# with rotate = "none", min.err = 1e-6: psych's default stopping rule (min.err
# = .001) halts PAF before the communalities settle — the third decimal still
# moved against a fully iterated hand PAF. ML is checked against
# stats::factanal (loadings and the Bartlett-corrected chi-square match).
# Initial communalities are then squared multiple correlations, the table
# headings say "Factor" rather than "Component", and ML adds SPSS's
# Goodness-of-fit Test.
#
# Image factoring (Kaiser's image analysis, not in psych) is non-iterative:
# with S^2 = diag(M^-1)^-1 and the eigen-decomposition S^-1 M S^-1 = W G W',
# the loadings are S W (G - I) G^-1/2. Their cross-product is exactly the
# image covariance matrix M + S^2 M^-1 S^2 - 2 S^2 when every factor is kept.
#
# Covariance matrix: the extraction runs on the covariance matrix (raw
# metric); every loading table shows the raw loadings and the rescaled ones
# (raw / standard deviation, i.e. correlations with the factor), as SPSS does.
# Rotation, diagnostics and plots use the rescaled loadings: with Kaiser
# normalization the rotation is the same either way (rows are normalized
# first), and the rescaled values are the ones a reader interprets.
#
# Number of factors: Kaiser (eigenvalues of the analysed matrix above minEigen
# — SPSS uses those eigenvalues for every extraction), a fixed number, or
# Horn's parallel analysis. Parallel analysis compares the observed
# eigenvalues of the correlation matrix with the 95th percentile of
# eigenvalues of random normal data of the same n and p. The random
# correlation matrices are drawn as Wishart matrices (stats::rWishart, n - 1
# df, identity scale) and rescaled with cov2cor: exactly the distribution of
# the correlation matrix of n normal rows, at a cost that does not grow with n.
#
# Rotations, all with Kaiser normalization as in SPSS: varimax, quartimax and
# equamax (GPArotation; equamax = Crawford-Ferguson with kappa = m / 2p, i.e.
# orthomax gamma = m / 2) are orthogonal and get Rotation Sums of Squared
# Loadings + Transformation Matrix. Direct oblimin (GPArotation::oblimin, gam
# = SPSS's delta) and promax (stats::promax: normalized varimax, then the
# power-kappa target) are oblique: Pattern, Structure and Factor Correlation
# matrices, and no rotation sums table — with correlated factors no clean
# variance split exists (SPSS omits it too).
#
# Factor scores (SPSS's three methods), with P the final pattern, Phi the
# factor correlations and U^2 the uniquenesses:
#   regression      W = M^-1 P Phi
#   Bartlett        W = U^-2 P (P' U^-2 P)^-1
#   Anderson-Rubin  W = U^-2 P (P' U^-2 M U^-2 P)^-1/2   (uncorrelated scores)
# For principal components U^2 is taken as I: the three then coincide for
# orthogonal solutions (component scores are exact), as in SPSS.

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
#' with coefficients below the suppression threshold left blank. Order and
#' blanking follow the (rescaled) matrix L; with `raw` (covariance analysis)
#' the raw loadings come first, blanked where their rescaled value is.
loading_rows <- function(L, nm, sort_rows, suppress, raw = NULL) {
  ord <- if (sort_rows) loading_order(L) else seq_len(nrow(L))
  cell <- function(X, i, j) if (!is.null(suppress) && abs(L[i, j]) < suppress) NULL else round(X[i, j], 3)
  lapply(ord, function(i) c(
    list(nm[i]),
    if (!is.null(raw)) lapply(seq_len(ncol(L)), function(j) cell(raw, i, j)),
    lapply(seq_len(ncol(L)), function(j) cell(L, i, j))))
}

#' A variables x variables matrix as an output table.
square_table <- function(title, X, nm, foot = NULL, blank_diag = FALSE) {
  list(titleKey = title, columns = as.list(c("output.col.variable", nm)),
       rows = lapply(seq_len(nrow(X)), function(i) c(list(nm[i]), lapply(seq_len(ncol(X)), function(j)
         if (blank_diag && i == j) NULL else round(X[i, j], 3)))),
       footnoteKey = foot)
}

#' A factors x factors matrix (factor correlations, score covariances).
factor_square_rows <- function(X) {
  lapply(seq_len(nrow(X)), function(i)
    c(list(as.integer(i)), lapply(seq_len(ncol(X)), function(j) round(X[i, j], 3))))
}

#' Inverse symmetric square root, for Anderson-Rubin scores.
inv_sqrt_sym <- function(A) {
  e <- eigen(A, symmetric = TRUE)
  if (any(e$values <= 0)) stop("not positive definite")
  e$vectors %*% diag(1 / sqrt(e$values), length(e$values)) %*% t(e$vectors)
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
#' no "Rotation Sums of Squared Loadings" table accompanies these. `sds`
#' (covariance analysis) adds the raw loadings next to the rescaled ones.
oblique_rotation_tables <- function(pattern, phi, nm, m, comp_cols, comp_col, hdr_key,
                                    footnote, sort_rows, suppress, sds = NULL) {
  structure_mat <- pattern %*% phi
  raw <- function(L) if (is.null(sds)) NULL else L * sds
  phi_cols <- c(comp_col, paste0(hdr_key, seq_len(m)))
  list(
    list(titleKey = "output.factor.patternMatrixTitle",
         columns = as.list(comp_cols),
         rows = loading_rows(pattern, nm, sort_rows, suppress, raw(pattern)),
         footnoteKey = footnote),
    list(titleKey = "output.factor.structureMatrixTitle",
         columns = as.list(comp_cols),
         rows = loading_rows(structure_mat, nm, sort_rows, suppress, raw(structure_mat)),
         footnoteKey = footnote),
    list(titleKey = "output.factor.factorCorrTitle",
         columns = as.list(phi_cols), rows = factor_square_rows(phi), footnoteKey = NULL))
}

tryCatch({
  progress(10L, "progress.loading")
  vars <- unlist(params$variables); var_names <- params$varNames
  opts <- if (is.null(params$options)) list() else params$options
  pick <- function(v, allowed) if (!is.null(v) && v %in% allowed) v else allowed[1]
  num_opt <- function(v, default) {
    x <- suppressWarnings(as.numeric(v))
    if (length(x) != 1 || is.na(x)) default else x
  }
  flag <- function(v, default = FALSE) if (is.null(v)) default else isTRUE(v)
  tables <- list(); warns <- character(0); notes <- character(0); plots <- list()

  rotation     <- pick(opts$rotation, c("none", "varimax", "quartimax", "equamax", "oblimin", "promax"))
  extraction   <- pick(opts$extraction, c("pc", "paf", "ml", "uls", "gls", "alpha", "image"))
  mat_type     <- pick(opts$matrix, c("correlation", "polychoric", "covariance"))
  criterion    <- pick(opts$criterion, c("eigen", "fixed", "parallel"))
  missing_mode <- pick(opts$missing, c("listwise", "pairwise", "mean"))
  score_method <- pick(opts$scoreMethod, c("regression", "bartlett", "anderson"))
  min_eigen <- num_opt(opts$minEigen, 1)
  max_iter  <- max(1L, as.integer(num_opt(opts$maxIter, 100)))
  rot_iter  <- max(1L, as.integer(num_opt(opts$rotationMaxIter, 1000)))
  # SPSS caps delta at 0.8: above it the oblimin criterion has no minimum and
  # the factors collapse onto each other.
  delta <- num_opt(opts$delta, 0)
  if (delta > 0.8) { warns <- c(warns, "output.factor.deltaTooLarge"); delta <- 0.8 }
  kappa <- num_opt(opts$kappa, 4)
  if (kappa < 1) { warns <- c(warns, "output.factor.kappaInvalid"); kappa <- 4 }
  suppress  <- if (is.null(opts$suppressBelow)) NULL else {
    s <- num_opt(opts$suppressBelow, NA_real_); if (is.na(s) || s <= 0) NULL else s
  }
  sort_rows    <- isTRUE(opts$sortBySize)
  show_initial <- flag(opts$initialSolution, TRUE)
  show_unrot   <- flag(opts$unrotated, TRUE)
  show_rot     <- flag(opts$rotatedSolution, TRUE)
  if (mat_type == "covariance" && !extraction %in% c("pc", "paf", "image")) {
    warns <- c(warns, "output.factor.covarianceMethod"); mat_type <- "correlation"
  }
  is_pc <- extraction == "pc"; is_cov <- mat_type == "covariance"
  if (length(vars) < 2) sai_error("Factor analysis needs at least two variables")
  nm <- resolve_var_names(vars, var_names)

  mat <- sapply(vars, function(c) suppressWarnings(as.numeric(apply_user_missing(df[[c]], c, params))))
  # Which dataset rows take part, kept for NV1 (roadmap ★11). `mat` is a
  # matrix, so it cannot carry __row_idx as a column the way the data-frame
  # scripts do — the mask is recorded instead. Listwise keeps complete rows;
  # pairwise and mean substitution keep every row with any value.
  keep_rows <- if (missing_mode == "listwise") stats::complete.cases(mat) else rowSums(!is.na(mat)) > 0
  mat <- mat[keep_rows, , drop = FALSE]
  if (missing_mode == "mean" && anyNA(mat)) {
    for (j in seq_len(ncol(mat))) {
      miss <- is.na(mat[, j]); if (any(miss)) mat[miss, j] <- mean(mat[!miss, j])
    }
    notes <- c(notes, "output.factor.meanSubNote")
  }
  p <- ncol(mat)
  has_na <- anyNA(mat)
  # Cases behind each correlation; under pairwise deletion the smallest of
  # them is the N used for the chi-square tests (Bartlett, ML fit, parallel
  # analysis) — the conservative choice.
  pair_n <- crossprod(!is.na(mat))
  n <- if (has_na) as.integer(min(pair_n)) else nrow(mat)
  if (n < 3) sai_error("Not enough complete cases")
  use <- if (has_na) "pairwise.complete.obs" else "everything"
  R <- suppressWarnings(stats::cor(mat, use = use))
  if (anyNA(R)) sai_error("Correlations could not be computed: a variable is constant or two variables share too few cases")
  if (has_na) notes <- c(notes, paste0("output.factor.pairwiseNote:", n))
  R_pearson <- R

  # ── Matrix to analyse ───────────────────────────────────────────────────────
  # Polychoric correlations treat each item as a coarsened normal variable —
  # the right matrix for Likert items. psych::polychoric needs a handful of
  # integer categories; anything else falls back to Pearson, with a warning.
  if (mat_type == "polychoric") {
    ok <- all(abs(mat - round(mat)) < 1e-9, na.rm = TRUE) &&
      all(apply(mat, 2, function(v) length(unique(v[!is.na(v)]))) <= 10)
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
  C <- if (is_cov) stats::cov(mat, use = use) else NULL
  M <- if (is_cov) C else R                       # the matrix the extraction factors
  sds <- if (is_cov) sqrt(diag(C)) else rep(1, p)
  if (is_cov) notes <- c(notes, "output.factor.covarianceNote")
  Rinv <- tryCatch(solve(R), error = function(e) NULL)

  # ── Descriptives ────────────────────────────────────────────────────────────
  if (isTRUE(opts$univariate)) {
    tables <- c(tables, list(list(
      titleKey = "output.factor.descTitle",
      columns = list("output.col.variable", "output.col.mean", "output.col.stdDev",
                     "output.factor.analysisN"),
      rows = lapply(seq_len(p), function(i) {
        v <- mat[, i]
        list(nm[i], round(mean(v, na.rm = TRUE), 3), round(stats::sd(v, na.rm = TRUE), 3),
             as.integer(sum(!is.na(v))))
      }),
      footnoteKey = NULL)))
  }
  det_text <- function(d) format(signif(d, 3), scientific = abs(d) < 1e-3)
  if (isTRUE(opts$correlation)) {
    tables <- c(tables, list(square_table(
      "output.factor.corrTitle", R, nm,
      foot = paste0("output.factor.determinantFootnote:", det_text(det(R))))))
  }
  # One-tailed significance of each correlation, as SPSS prints under the
  # correlation matrix. A polychoric coefficient has no such simple test, so
  # the levels then refer to the Pearson correlations (footnote says so).
  if (isTRUE(opts$sigLevels)) {
    df_r <- pair_n - 2
    tt <- R_pearson * sqrt(df_r / pmax(1 - R_pearson^2, .Machine$double.eps))
    tables <- c(tables, list(square_table(
      "output.factor.sigTitle", stats::pt(-abs(tt), df_r), nm, blank_diag = TRUE,
      foot = if (mat_type == "polychoric") "output.factor.sigPearsonFootnote" else NULL)))
  }
  if (isTRUE(opts$determinant) && !isTRUE(opts$correlation)) {
    tables <- c(tables, list(list(
      titleKey = "output.factor.determinantTitle",
      columns = list("output.col.statistic", "output.col.value"),
      rows = list(list("output.factor.determinantLabel", det_text(det(R)))),
      footnoteKey = NULL)))
  }
  if (isTRUE(opts$inverse)) {
    if (is.null(Rinv)) warns <- c(warns, "output.factor.inverseSingular")
    else tables <- c(tables, list(square_table("output.factor.inverseTitle", Rinv, nm)))
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
  # Anti-image matrices (SPSS prints both): the covariance D R^-1 D with
  # D = diag(R^-1)^-1 (its diagonal is 1 - SMC), and the correlation —
  # negative partial correlations off the diagonal, each variable's Measure
  # of Sampling Adequacy on it. An item with MSA below .50 is a candidate for
  # removal before extraction.
  if (isTRUE(opts$antiImage)) {
    if (is.null(Rinv) || is.null(kmo_res)) {
      warns <- c(warns, "output.factor.antiImageSingular")
    } else {
      aic <- Rinv / outer(diag(Rinv), diag(Rinv))
      # Partial correlation is -Rinv_ij / sqrt(Rinv_ii Rinv_jj); the
      # anti-image correlation is its negative.
      ai <- Rinv / sqrt(outer(diag(Rinv), diag(Rinv)))
      diag(ai) <- kmo_res$MSAi
      tables <- c(tables, list(
        square_table("output.factor.antiImageCovTitle", aic, nm),
        square_table("output.factor.antiImageTitle", ai, nm, foot = "output.factor.antiImageFootnote")))
      low <- nm[kmo_res$MSAi < 0.5]
      if (length(low) > 0) notes <- c(notes, paste0("output.factor.lowMsaNote:", paste(low, collapse = ", ")))
    }
  }

  # ── Number of factors ───────────────────────────────────────────────────────
  e <- eigen(M, symmetric = TRUE)
  eval <- e$values; evec <- e$vectors
  eval_R <- if (is_cov) eigen(R, symmetric = TRUE, only.values = TRUE)$values else eval
  # SPSS's covariance rule: eigenvalues above minEigen times the mean one.
  thr <- if (is_cov) min_eigen * mean(eval) else min_eigen
  pa <- if (criterion == "parallel" || isTRUE(opts$parallel)) parallel_eigen(n, p) else NULL
  max_k <- if (is_pc) p else p - 1L
  k <- switch(criterion,
    eigen = sum(eval > thr),
    fixed = as.integer(num_opt(opts$nFactors, 1)),
    parallel = { above <- eval_R > pa$p95; if (all(above)) p else which(!above)[1] - 1L })
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
    init_comm <- diag(M)
  } else if (extraction == "image") {
    Minv <- if (is_cov) tryCatch(solve(M), error = function(e) NULL) else Rinv
    if (is.null(Minv)) stop("output.factor.imageSingular", call. = FALSE)
    s <- 1 / sqrt(diag(Minv))
    ei <- eigen(M / outer(s, s), symmetric = TRUE)
    g <- ei$values[retain]
    load <- (s * ei$vectors[, retain, drop = FALSE]) %*% diag((g - 1) / sqrt(g), k)
    init_comm <- diag(M) - s^2
  } else {
    fm <- c(paf = "pa", ml = "ml", uls = "uls", gls = "gls", alpha = "alpha")[[extraction]]
    fa_warn <- character(0)
    # Too many factors for the data drive the iteration into negative
    # eigenvalues and psych stops with a bare numerical error; say what it
    # means instead.
    printed <- utils::capture.output(fa_res <- tryCatch(withCallingHandlers(
      psych::fa(M, nfactors = k, n.obs = n, fm = fm, rotate = "none", covar = is_cov,
                max.iter = max_iter, min.err = 1e-6, warnings = TRUE),
      warning = function(w) {
        fa_warn <<- c(fa_warn, conditionMessage(w)); invokeRestart("muffleWarning")
      },
      # psych reports "maximum iteration exceeded" with message(), not as a
      # warning or printed output — catching only those two let a run stopped
      # at the limit pass as converged.
      message = function(m) {
        fa_warn <<- c(fa_warn, conditionMessage(m)); invokeRestart("muffleMessage")
      }), error = function(e) stop("output.factor.extractionFailed", call. = FALSE)),
      type = "output")
    if (any(grepl("maximum iteration", c(printed, fa_warn), ignore.case = TRUE)) ||
        length(fa_res$communality.iterations) >= max_iter) {
      warns <- c(warns, paste0("output.factor.notConverged:", max_iter))
    }
    load <- unclass(fa_res$loadings)[, seq_len(k), drop = FALSE]
    # Factors in order of the variance they extract, like SPSS.
    load <- load[, order(-colSums(load^2)), drop = FALSE]
    init_comm <- psych::smc(M, covar = is_cov)
    if (extraction == "ml" && !is.null(fa_res$STATISTIC) && is.finite(fa_res$STATISTIC)) {
      gof <- list(chi = fa_res$STATISTIC, df = fa_res$dof, p = fa_res$PVAL)
    }
  }
  # Rescaled loadings (correlations with the factors). For a correlation
  # matrix sds = 1 and they are the loadings themselves.
  Ls <- unname(load) / sds
  # An eigenvector's sign is arbitrary — v and -v span the same component — so
  # LAPACK's choice is as good as any mathematically, and useless to a reader.
  # SPSS reflects each column so its dominant loading is positive; without that
  # our whole Component Matrix came out negated (-.800 against SPSS's .800),
  # which reads as "these items load negatively" and inverts the
  # interpretation of every component. Communalities (squares) are unaffected.
  for (j in seq_len(ncol(Ls))) {
    if (Ls[which.max(abs(Ls[, j])), j] < 0) Ls[, j] <- -Ls[, j]
  }
  load <- Ls * sds
  comm <- rowSums(Ls^2); comm_raw <- rowSums(load^2)
  init_s <- init_comm / sds^2
  if (!is_pc && any(comm >= 0.999)) {
    warns <- c(warns, paste0("output.factor.heywood:", paste(nm[comm >= 0.999], collapse = ", ")))
  }

  # Labels: SPSS says "Component" for PCA and "Factor" for everything else.
  comp_col <- if (is_pc) "output.col.component" else "output.col.factor"
  hdr_key  <- if (is_pc) "output.factor.compHdr:" else "output.factor.factorHdr:"
  comp_cols <- c("output.col.variable",
                 if (is_cov) c(paste0(if (is_pc) "output.factor.rawCompHdr:" else "output.factor.rawFactorHdr:", retain),
                               paste0(if (is_pc) "output.factor.rescCompHdr:" else "output.factor.rescFactorHdr:", retain))
                 else paste0(hdr_key, retain))
  raw_of <- function(L) if (is_cov) L * sds else NULL
  method_key <- paste0("output.factor.method.", extraction)
  rot_key <- paste0("output.factor.rot.", rotation)
  classic_pc <- is_pc && !is_cov && criterion == "eigen" && min_eigen == 1

  r3 <- function(x) round(x, 3)
  comm_cols <- c("output.col.variable",
                 if (is_cov) c(if (show_initial) "output.factor.rawInitial", "output.factor.rawExtraction",
                               if (show_initial) "output.factor.rescInitial", "output.factor.rescExtraction")
                 else c(if (show_initial) "output.col.initial", "output.col.extraction"))
  comm_rows <- lapply(seq_len(p), function(i) c(
    list(nm[i]),
    if (is_cov) c(if (show_initial) list(r3(init_comm[i])), list(r3(comm_raw[i])),
                  if (show_initial) list(r3(init_s[i])), list(r3(comm[i])))
    else c(if (show_initial) list(r3(init_comm[i])), list(r3(comm[i])))))

  # Total Variance Explained: initial eigenvalues (all rows) and, for the
  # common factor methods, the extraction sums of the retained factors. With
  # the initial solution off only the retained rows remain, and PCA shows its
  # extraction sums (= the eigenvalues) instead. Percentages are of the total
  # variance, the trace of the analysed matrix (p for a correlation matrix);
  # a covariance analysis adds the rescaled sums (percent of p).
  tot <- sum(diag(M))
  ss_raw <- colSums(load^2); ss_s <- colSums(Ls^2)
  show_extr <- !is_pc || !show_initial
  cum_e <- cumsum(eval) / tot * 100
  blk <- function(i, v, denom) {
    if (i > k) return(list(NULL, NULL, NULL))
    list(r3(v[i]), r3(v[i] / denom * 100), r3(sum(v[seq_len(i)]) / denom * 100))
  }
  tve_rows <- lapply(if (show_initial) seq_len(p) else retain, function(i) c(
    list(as.integer(i)),
    if (show_initial) list(r3(eval[i]), r3(eval[i] / tot * 100), r3(cum_e[i])),
    if (show_extr) blk(i, ss_raw, tot),
    if (is_cov) blk(i, ss_s, p)))
  tve_cols <- c(list(comp_col),
                if (show_initial) list("output.col.eigenvalue", "output.col.pctVariance", "output.col.cumulativePct"),
                if (show_extr) list("output.factor.extrSSTotal", "output.factor.extrSSPct", "output.factor.extrSSCum"),
                if (is_cov) list("output.factor.rescSSTotal", "output.factor.rescSSPct", "output.factor.rescSSCum"))

  tables <- c(tables, list(
    list(titleKey = "output.factor.commTitle",
         columns = as.list(comm_cols), rows = comm_rows,
         footnoteKey = if (is_pc) NULL else paste0("output.factor.commFootnote:", method_key)),
    list(titleKey = "output.factor.tveTitle",
         columns = tve_cols, rows = tve_rows,
         footnoteKey = if (is_cov) "output.factor.covTveFootnote" else NULL)))

  # ── Parallel analysis table + scree plot ────────────────────────────────────
  if (!is.null(pa)) {
    pa_rows <- lapply(seq_len(p), function(i) list(
      as.integer(i), r3(eval_R[i]), r3(pa$mean[i]), r3(pa$p95[i]),
      if (eval_R[i] > pa$p95[i] && all(eval_R[seq_len(i)] > pa$p95[seq_len(i)]))
        "output.factor.paRetain" else "output.factor.paDrop"))
    n_pa <- { above <- eval_R > pa$p95; if (all(above)) p else which(!above)[1] - 1L }
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
    # Random-data eigenvalues are on the correlation scale: drawn only when
    # the scree shows correlation eigenvalues too.
    if (!is.null(pa) && !is_cov) traces <- c(traces, list(list(
      type = "scatter", mode = "lines", name = "output.factor.screeParallel",
      x = as.list(seq_len(p)), y = as.list(round(pa$p95, 4)),
      line = list(color = "#c94040", dash = "dash"))))
    plots <- c(plots, list(list(
      titleKey = "output.factor.screeTitle", type = "plotly",
      data = list(data = traces, layout = list(
        xaxis = list(title = list(text = if (is_pc) "output.factor.screeXComp" else "output.factor.screeXFactor"),
                     dtick = 1),
        yaxis = list(title = list(text = "output.col.eigenvalue"), rangemode = "tozero"),
        showlegend = length(traces) > 1,
        shapes = if (criterion == "eigen") list(list(
          type = "line", xref = "paper", x0 = 0, x1 = 1, y0 = thr, y1 = thr,
          line = list(color = "#888", dash = "dot"))) else list(),
        margin = list(t = 40, r = 20, b = 50, l = 60))))))
  }

  if (show_unrot) {
    tables <- c(tables, list(
      list(titleKey = if (is_pc) "output.factor.matrixTitle" else "output.factor.factorMatrixTitle",
           columns = as.list(comp_cols), rows = loading_rows(Ls, nm, sort_rows, suppress, raw_of(Ls)),
           footnoteKey = if (classic_pc) "output.factor.matrixFootnote"
                         else paste0("output.factor.extractFootnote:", method_key, "|", k))))
  }
  if (!is.null(gof)) {
    tables <- c(tables, list(list(
      titleKey = "output.factor.gofTitle",
      columns = list("output.col.chiSquare", "output.col.df", "output.col.sig"),
      rows = list(list(r3(gof$chi), as.integer(gof$df), round(gof$p, 6))),
      footnoteKey = NULL)))
  }

  # ── Rotation ────────────────────────────────────────────────────────────────
  # Orthogonal rotation redistributes variance across the retained factors
  # without changing communalities or total variance; every rotation needs 2+
  # factors (a single one has nothing to rotate against). GPArotation reports
  # non-convergence both as a warning and as a flag; both become one warning.
  rot_nc <- FALSE
  gpa <- function(expr) {
    q <- withCallingHandlers(expr, warning = function(w) {
      if (grepl("converge", conditionMessage(w), ignore.case = TRUE)) {
        rot_nc <<- TRUE; invokeRestart("muffleWarning")
      }
    })
    if (identical(q$convergence, FALSE)) rot_nc <<- TRUE
    q
  }
  rot_load <- NULL; obl <- NULL
  if (k >= 2 && rotation %in% c("varimax", "quartimax", "equamax")) {
    q <- tryCatch(gpa(switch(rotation,
      varimax   = GPArotation::Varimax(Ls, normalize = TRUE, maxit = rot_iter),
      quartimax = GPArotation::quartimax(Ls, normalize = TRUE, maxit = rot_iter),
      equamax   = GPArotation::cfT(Ls, kappa = k / (2 * p), normalize = TRUE, maxit = rot_iter))),
      error = function(e) NULL)
    if (is.null(q)) {
      warns <- c(warns, "output.factor.rotationFailed")
    } else {
      rot_load <- unname(unclass(q$loadings)); rotmat <- q$Th
    }
  } else if (k >= 2 && rotation %in% c("oblimin", "promax")) {
    obl <- tryCatch(if (rotation == "oblimin") {
      q <- gpa(GPArotation::oblimin(Ls, gam = delta, normalize = TRUE, maxit = rot_iter))
      list(loadings = unname(unclass(q$loadings)), Phi = q$Phi)
    } else {
      pm <- stats::promax(Ls, m = kappa)
      ui <- solve(pm$rotmat)
      list(loadings = unname(unclass(pm$loadings)), Phi = ui %*% t(ui))
    }, error = function(e) NULL)
    if (is.null(obl)) warns <- c(warns, "output.factor.rotationFailed")
  }
  if (rot_nc) warns <- c(warns, paste0("output.factor.rotNotConverged:", rot_iter))

  rot_foot <- if (is_pc && rotation == "varimax") "output.factor.rotatedMatrixFootnote"
              else paste0("output.factor.rotFootnote:", method_key, "|", rot_key)
  if (show_rot && !is.null(rot_load)) {
    rot_ss <- colSums(rot_load^2)
    rot_ss_raw <- colSums((rot_load * sds)^2)
    rot_ss_rows <- lapply(retain, function(i) c(
      list(as.integer(i)),
      if (is_cov) blk(i, rot_ss_raw, tot),
      blk(i, rot_ss, p)))
    transform_cols <- c(comp_col, paste0(hdr_key, retain))
    tables <- c(tables, list(
      list(titleKey = if (is_pc) "output.factor.rotatedMatrixTitle" else "output.factor.rotatedFactorMatrixTitle",
           columns = as.list(comp_cols),
           rows = loading_rows(rot_load, nm, sort_rows, suppress, raw_of(rot_load)),
           footnoteKey = if (is_cov) paste0("output.factor.rotFootnote:", method_key, "|", rot_key) else rot_foot),
      list(titleKey = "output.factor.rotationSSTitle",
           columns = c(list(comp_col),
                       if (is_cov) list("output.factor.rawSSTotal", "output.factor.rawSSPct", "output.factor.rawSSCum"),
                       list("output.col.eigenvalue", "output.col.pctVariance", "output.col.cumulativePct")),
           rows = rot_ss_rows, footnoteKey = NULL),
      list(titleKey = if (is_pc) "output.factor.transformMatrixTitle" else "output.factor.factorTransformMatrixTitle",
           columns = as.list(transform_cols), rows = factor_square_rows(rotmat), footnoteKey = NULL)))
  }
  if (show_rot && !is.null(obl)) {
    foot <- if (is_pc && !is_cov) "output.factor.obliqueMatrixFootnote"
            else paste0("output.factor.rotFootnote:", method_key, "|", rot_key)
    tables <- c(tables, oblique_rotation_tables(obl$loadings, obl$Phi, nm, k, comp_cols, comp_col,
                                                hdr_key, foot, sort_rows, suppress,
                                                if (is_cov) sds else NULL))
  }
  if (!is.null(suppress)) notes <- c(notes, paste0("output.factor.suppressNote:", format(suppress)))

  # ── Item diagnostics on the matrix the user interprets ─────────────────────
  # Final loadings: rotated (orthogonal), pattern (oblique) or unrotated. An
  # item with no loading of .30 or more measures none of the factors; one
  # loading .30+ on two factors less than .10 apart is a cross-loading item —
  # the two checks scale-development reports ask for before dropping items.
  final <- if (!is.null(rot_load)) rot_load else if (!is.null(obl)) obl$loadings else Ls
  phi_final <- if (!is.null(obl)) obl$Phi else diag(k)
  absf <- abs(final)
  low_items <- nm[apply(absf, 1, max) < 0.30]
  if (length(low_items) > 0) notes <- c(notes, paste0("output.factor.lowLoadingNote:", paste(low_items, collapse = ", ")))
  if (k >= 2) {
    cross <- nm[apply(absf, 1, function(r) {
      s <- sort(r, decreasing = TRUE); s[2] >= 0.30 && (s[1] - s[2]) < 0.10
    })]
    if (length(cross) > 0) notes <- c(notes, paste0("output.factor.crossLoadingNote:", paste(cross, collapse = ", ")))
  }

  # ── Reproduced correlations and residuals ──────────────────────────────────
  # L Phi L' is the same for every rotation of a solution, so the unrotated
  # loadings give it; the diagonal holds the communalities. SPSS's footnote
  # counts the nonredundant residuals above .05 in absolute value.
  if (isTRUE(opts$reproduced)) {
    Rhat <- Ls %*% t(Ls)
    diag(Rhat) <- comm
    res <- R - Rhat
    off <- upper.tri(res)
    big <- sum(abs(res[off]) > 0.05)
    tables <- c(tables, list(
      square_table("output.factor.reproducedTitle", Rhat, nm, foot = "output.factor.reproducedFootnote"),
      square_table("output.factor.residualTitle", res, nm, blank_diag = TRUE,
                   foot = paste0("output.factor.residualFootnote:", big, "|", round(100 * big / sum(off))))))
  }

  # ── Factor scores (coefficients, covariance, NV1 new variables) ─────────────
  # Methods in the header. The final solution is used — rotated whenever a
  # rotation was applied — so the scores belong to the structure the user is
  # reading. Coefficients apply to the standardized variables (to the centred
  # raw variables for a covariance analysis).
  case_vars <- list()
  want <- requested_new_vars(params)
  if (length(want) > 0 || isTRUE(opts$scoreCoef)) {
    P_raw <- final * sds
    W <- tryCatch({
      if (score_method == "regression") {
        solve(M, P_raw %*% phi_final)
      } else {
        u2 <- if (is_pc) rep(1, p) else diag(M) - rowSums((P_raw %*% phi_final) * P_raw)
        if (any(u2 <= 1e-8 * diag(M))) stop("heywood")
        A <- P_raw / u2
        if (score_method == "bartlett") A %*% solve(crossprod(P_raw, A))
        else A %*% inv_sqrt_sym(t(A) %*% M %*% A)
      }
    }, error = function(e) if (identical(conditionMessage(e), "heywood")) "heywood" else NULL)
    if (identical(W, "heywood")) {
      # A uniqueness of zero (Heywood case) leaves Bartlett / Anderson-Rubin
      # weights undefined: U^-2 divides by it.
      warns <- c(warns, "output.factor.scoresHeywood"); W <- NULL
    } else if (is.null(W)) {
      # A singular correlation matrix (perfectly collinear variables) has no
      # regression scores. Say so instead of writing a column of nothing.
      warns <- c(warns, "output.factor.scoresSingular")
    }
    if (!is.null(W) && isTRUE(opts$scoreCoef)) {
      score_foot <- paste0("output.factor.scoreCoefFootnote:", method_key, "|",
                           "output.factor.scoreMethod.", score_method)
      tables <- c(tables, list(
        list(titleKey = if (is_pc) "output.factor.compScoreCoefTitle" else "output.factor.factorScoreCoefTitle",
             columns = as.list(c("output.col.variable", paste0(hdr_key, retain))),
             rows = lapply(seq_len(p), function(i) c(list(nm[i]), lapply(retain, function(j) r3(W[i, j])))),
             footnoteKey = score_foot),
        list(titleKey = if (is_pc) "output.factor.compScoreCovTitle" else "output.factor.factorScoreCovTitle",
             columns = as.list(c(comp_col, paste0(hdr_key, retain))),
             rows = factor_square_rows(t(W) %*% M %*% W), footnoteKey = score_foot)))
    }
    if (!is.null(W) && length(want) > 0) {
      D <- if (is_cov) scale(mat, scale = FALSE) else scale(mat)
      scores <- D %*% W
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
      if (has_na) notes <- c(notes, "output.factor.scoresPairwiseNote")
    }
  }

  # ── Loading plot ───────────────────────────────────────────────────────────
  # SPSS's factor plot: each variable placed by its loadings on the first two
  # (2D) or three (3D) factors of the final solution.
  if (isTRUE(opts$loadingPlot)) {
    if (k < 2) {
      warns <- c(warns, "output.factor.loadingPlotOne")
    } else {
      rotated <- !is.null(rot_load) || !is.null(obl)
      title <- paste0("output.factor.", if (is_pc) "comp" else "factor", if (rotated) "PlotRot" else "Plot", "Title")
      axis <- function(j) list(title = list(text = paste0(hdr_key, j)), range = c(-1.1, 1.1),
                               zeroline = TRUE)
      xyz <- function(j) as.list(round(final[, j], 4))
      if (k == 2) {
        trace <- list(type = "scatter", mode = "markers+text", x = xyz(1), y = xyz(2),
                      text = as.list(nm), textposition = "top center",
                      marker = list(color = "#3b6ea5", size = 8))
        layout <- list(xaxis = axis(1), yaxis = axis(2), showlegend = FALSE,
                       margin = list(t = 40, r = 20, b = 50, l = 60))
      } else {
        trace <- list(type = "scatter3d", mode = "markers+text", x = xyz(1), y = xyz(2), z = xyz(3),
                      text = as.list(nm), marker = list(color = "#3b6ea5", size = 4))
        layout <- list(scene = list(xaxis = axis(1), yaxis = axis(2), zaxis = axis(3)),
                       showlegend = FALSE, margin = list(t = 40, r = 20, b = 20, l = 20))
      }
      plots <- c(plots, list(list(titleKey = title, type = "plotly",
                                  data = list(data = list(trace), layout = layout))))
    }
  }

  progress(100L, "progress.done")
  sai_output(tables = tables, plots = plots, caseVars = case_vars, warnings = warns, notes = notes)
}, error = function(e) sai_error(conditionMessage(e)))
