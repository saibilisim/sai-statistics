# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# factor.R — Factor Analysis / PCA extraction (SPSS-style).
#
# Params: variables (colIds), varNames,
#   options$rotation ("none"|"varimax"|"oblimin"|"promax").
# Output: "Communalities" (Initial=1, Extraction), "Total Variance Explained"
#         (Eigenvalue, % of Variance, Cumulative %) and "Component Matrix"
#         (loadings for components with eigenvalue > 1, Kaiser criterion).
#
# rotation="varimax" (B4, spss-parity-findings-2026-07-07), orthogonal, 2+
#   components: "Rotated Component Matrix", "Rotation Sums of Squared
#   Loadings", "Component Transformation Matrix" — base R stats::varimax(),
#   no package required.
#
# rotation="oblimin"|"promax" (B4 extension), OBLIQUE, 2+ components: factors
#   are allowed to correlate, so SPSS reports three tables instead of one —
#   "Pattern Matrix" (unique contribution per factor), "Structure Matrix"
#   (pattern %*% Phi — simple correlations, includes overlap between
#   correlated factors) and "Factor Correlation Matrix" (Phi). No "Rotation
#   Sums of Squared Loadings" table here: with correlated factors a clean
#   variance-percentage decomposition doesn't exist (SPSS's own oblique
#   output omits it too) — showing one anyway would be misleading (CLAUDE.md
#   §11). Oblimin via GPArotation::oblimin() (already installed — a `psych`
#   dependency); Promax via psych::Promax() (extends base stats::promax()
#   with the Phi factor-correlation matrix base R's own promax() omits).
#   Communality preservation verified: comm_i = Σ_j pattern_ij * structure_ij
#   reproduces the pre-rotation communalities exactly (see
#   tests/r-validation/test-factor.R).

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

#' Build the Pattern/Structure/Factor Correlation Matrix tables shared by the
#' two oblique rotation modes (oblimin/promax) — see header comment for why
#' no "Rotation Sums of Squared Loadings" table accompanies these.
#' @param pattern p x m matrix of pattern (unique) coefficients
#' @param phi     m x m factor correlation matrix
oblique_rotation_tables <- function(pattern, phi, nm, p, retain, comp_cols) {
  structure_mat <- pattern %*% phi
  pat_rows <- lapply(seq_len(p), function(i)
    c(list(nm[i]), lapply(seq_along(retain), function(j) round(pattern[i, j], 3))))
  struct_rows <- lapply(seq_len(p), function(i)
    c(list(nm[i]), lapply(seq_along(retain), function(j) round(structure_mat[i, j], 3))))
  phi_cols <- c("output.col.component", paste0("output.factor.compHdr:", seq_along(retain)))
  phi_rows <- lapply(seq_along(retain), function(i)
    c(list(as.integer(i)), lapply(seq_along(retain), function(j) round(phi[i, j], 3))))
  list(
    list(titleKey = "output.factor.patternMatrixTitle",
         columns = as.list(comp_cols), rows = pat_rows,
         footnoteKey = "output.factor.obliqueMatrixFootnote"),
    list(titleKey = "output.factor.structureMatrixTitle",
         columns = as.list(comp_cols), rows = struct_rows,
         footnoteKey = "output.factor.obliqueMatrixFootnote"),
    list(titleKey = "output.factor.factorCorrTitle",
         columns = as.list(phi_cols), rows = phi_rows, footnoteKey = NULL))
}

tryCatch({
  progress(10L, "progress.loading")
  vars <- unlist(params$variables); var_names <- params$varNames
  opts <- if (is.null(params$options)) list() else params$options
  rotation <- if (!is.null(opts$rotation)) opts$rotation else "none"
  if (length(vars) < 2) sai_error("Factor analysis needs at least two variables")
  nm <- resolve_var_names(vars, var_names)

  mat <- sapply(vars, function(c) suppressWarnings(as.numeric(df[[c]])))
  # Which dataset rows survive the listwise deletion, kept for NV1 (roadmap
  # ★11). `mat` is a matrix, so it cannot carry __row_idx as a column the way
  # the data-frame scripts do — the mask is recorded instead.
  keep_rows <- stats::complete.cases(mat)
  mat <- mat[keep_rows, , drop = FALSE]
  if (nrow(mat) < 3) sai_error("Not enough complete cases")
  p <- ncol(mat)

  R <- cor(mat)

  tables <- list()

  # ── KMO and Bartlett's Test (Descriptives panel option) ─────────────────────
  # psych is a required package (setup.R) — no package gate needed. KMO() takes
  # either raw data or a correlation matrix (auto-detects square input);
  # cortest.bartlett() needs the correlation matrix + case count explicitly.
  if (isTRUE(opts$kmoBartlett)) {
    kmo_res <- tryCatch(psych::KMO(R), error = function(e) NULL)
    bartlett_res <- tryCatch(psych::cortest.bartlett(R, n = nrow(mat)), error = function(e) NULL)
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

  e <- eigen(R, symmetric = TRUE)
  eval <- e$values; evec <- e$vectors
  retain <- which(eval > 1); if (length(retain) == 0) retain <- 1
  load <- evec[, retain, drop = FALSE] %*% diag(sqrt(eval[retain]), length(retain))
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

  comm_rows <- lapply(seq_len(p), function(i)
    list(nm[i], 1, round(comm[i], 3)))
  cum <- cumsum(eval) / p * 100
  tve_rows <- lapply(seq_len(p), function(i)
    list(as.integer(i), round(eval[i], 3), round(eval[i] / p * 100, 3), round(cum[i], 3)))
  comp_cols <- c("output.col.variable", paste0("output.factor.compHdr:", seq_along(retain)))
  cm_rows <- lapply(seq_len(p), function(i)
    c(list(nm[i]), lapply(seq_along(retain), function(j) round(load[i, j], 3))))

  tables <- c(tables, list(
    list(titleKey = "output.factor.commTitle",
         columns = list("output.col.variable", "output.col.initial", "output.col.extraction"),
         rows = comm_rows, footnoteKey = NULL),
    list(titleKey = "output.factor.tveTitle",
         columns = list("output.col.component", "output.col.eigenvalue",
                        "output.col.pctVariance", "output.col.cumulativePct"),
         rows = tve_rows, footnoteKey = NULL),
    list(titleKey = "output.factor.matrixTitle",
         columns = as.list(comp_cols), rows = cm_rows,
         footnoteKey = "output.factor.matrixFootnote")))

  # ── Varimax rotation (B4) ────────────────────────────────────────────────────
  # Orthogonal rotation redistributes variance across the retained components
  # without changing communalities or total variance; needs 2+ components
  # (a single component has nothing to rotate against).
  if (identical(rotation, "varimax") && length(retain) >= 2) {
    vm        <- stats::varimax(load)
    rot_load  <- unclass(vm$loadings)
    rotmat    <- unclass(vm$rotmat)
    rot_ss    <- colSums(rot_load^2)
    rot_cum   <- cumsum(rot_ss) / p * 100

    rot_cm_rows <- lapply(seq_len(p), function(i)
      c(list(nm[i]), lapply(seq_along(retain), function(j) round(rot_load[i, j], 3))))
    rot_ss_rows <- lapply(seq_along(retain), function(i)
      list(as.integer(i), round(rot_ss[i], 3), round(rot_ss[i] / p * 100, 3), round(rot_cum[i], 3)))
    transform_cols <- c("output.col.component", paste0("output.factor.compHdr:", seq_along(retain)))
    transform_rows <- lapply(seq_along(retain), function(i)
      c(list(as.integer(i)), lapply(seq_along(retain), function(j) round(rotmat[i, j], 3))))

    tables <- c(tables, list(
      list(titleKey = "output.factor.rotatedMatrixTitle",
           columns = as.list(comp_cols), rows = rot_cm_rows,
           footnoteKey = "output.factor.rotatedMatrixFootnote"),
      list(titleKey = "output.factor.rotationSSTitle",
           columns = list("output.col.component", "output.col.eigenvalue",
                          "output.col.pctVariance", "output.col.cumulativePct"),
           rows = rot_ss_rows, footnoteKey = NULL),
      list(titleKey = "output.factor.transformMatrixTitle",
           columns = as.list(transform_cols), rows = transform_rows, footnoteKey = NULL)))
  } else if (identical(rotation, "oblimin") && length(retain) >= 2) {
    ob <- tryCatch(GPArotation::oblimin(load), error = function(e) NULL)
    if (!is.null(ob)) {
      tables <- c(tables, oblique_rotation_tables(unclass(ob$loadings), ob$Phi, nm, p, retain, comp_cols))
    }
  } else if (identical(rotation, "promax") && length(retain) >= 2) {
    pm <- tryCatch(psych::Promax(load), error = function(e) NULL)
    if (!is.null(pm)) {
      tables <- c(tables, oblique_rotation_tables(unclass(pm$loadings), pm$Phi, nm, p, retain, comp_cols))
    }
  }

  # ── New variables (NV1) ────────────────────────────────────────────────────
  # Factor scores by the regression method (SPSS's default): F = Z R^-1 A,
  # where Z is the standardised data, R the correlation matrix and A the
  # loading matrix. The ROTATED loadings are used whenever a rotation was
  # applied, so the scores belong to the component structure the user is
  # actually reading in the output rather than to an unrotated one they never
  # saw. Scores come out standardised, which is what makes them usable as
  # inputs to a following analysis.
  case_vars <- list()
  fs_warnings <- character(0)
  want <- requested_new_vars(params)
  if (length(want) > 0) {
    # exists() as well as is.null(): the rotation objects are created inside
    # their own `if` branches, so on any other rotation the names do not exist
    # at all and a bare is.null() would raise rather than fall through.
    rot_env <- environment()
    rotated <- function(nm) if (exists(nm, envir = rot_env, inherits = FALSE))
      get(nm, envir = rot_env) else NULL
    score_load <- load
    if (length(retain) >= 2) {
      if (identical(rotation, "varimax") && !is.null(rotated("rot_load"))) {
        score_load <- rotated("rot_load")
      } else if (identical(rotation, "oblimin") && !is.null(rotated("ob"))) {
        score_load <- unclass(rotated("ob")$loadings) %*% rotated("ob")$Phi
      } else if (identical(rotation, "promax") && !is.null(rotated("pm"))) {
        score_load <- unclass(rotated("pm")$loadings) %*% rotated("pm")$Phi
      }
    }
    Z <- scale(mat)
    coefs <- tryCatch(solve(R, score_load), error = function(e) NULL)
    if (is.null(coefs)) {
      # A singular correlation matrix (perfectly collinear variables) has no
      # regression scores. Say so instead of writing a column of nothing.
      fs_warnings <- "output.factor.scoresSingular"
    } else {
      scores <- Z %*% coefs
      case_df <- data.frame(.i = seq_len(nrow(mat)))
      case_df[["__row_idx"]] <- row_index_of(df)[keep_rows]
      for (j in seq_along(retain)) {
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
  sai_output(tables = tables, caseVars = case_vars, warnings = fs_warnings)
}, error = function(e) sai_error(conditionMessage(e)))
