# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# PLUM iteration policy; all likelihoods, analytic derivatives, design
# matrices, predictions and covariance estimates come from ordinal.
# clm(doFit=FALSE) is its documented model-environment interface. A driver is
# needed because clm's gradient/relative-parameter criteria differ from PLUM.
sai_ordinal_fit <- function(formula, scale, data, options, nominal = ~1) {
  args <- list(formula = formula, scale = scale, data = data,
               weights = data$.w, link = options$link)
  # Supplying even nominal=~1 changes threshold labels in clm. Only the
  # unrestricted comparison needs nominal effects.
  if (length(attr(terms(nominal), "term.labels"))) args$nominal <- nominal
  env <- do.call(ordinal::clm, c(args, list(doFit = FALSE)))
  par <- env$par
  evaluate <- function(p) env$clm.nll(env, p)
  loss <- evaluate(par)
  if (!is.finite(loss)) stop("output.ordinal.extra.invalidStart")
  history <- list(list(0L, -loss, NA_real_))
  converged <- FALSE
  if (options$maxIterations > 0) for (iter in seq_len(options$maxIterations)) {
    evaluate(par)
    gradient <- env$clm.grad(env)
    hessian <- env$clm.hess(env)
    if (any(!is.finite(gradient)) || any(!is.finite(hessian))) break
    # Modified Newton descent; unmodified observed information supplies SEs.
    eig <- eigen(hessian, symmetric = TRUE)
    floor <- max(options$singularity, sqrt(.Machine$double.eps))
    direction <- drop(eig$vectors %*% (crossprod(eig$vectors, gradient) / pmax(eig$values, floor)))
    accepted <- FALSE
    for (half in 0:options$maxStepHalving) {
      candidate <- par - direction / 2^half
      next_loss <- evaluate(candidate)
      if (is.finite(next_loss) && next_loss <= loss + .Machine$double.eps * max(1, abs(loss))) {
        accepted <- TRUE; break
      }
    }
    if (!accepted) break
    change <- max(abs(candidate - par))
    ll_change <- abs(next_loss - loss)
    ll_converged <- options$logLikelihood > 0 &&
      (ll_change < options$logLikelihood || ll_change / max(1, abs(loss)) < options$logLikelihood)
    par_converged <- options$parameter > 0 && change < options$parameter
    par <- candidate; loss <- next_loss
    history[[length(history) + 1L]] <- list(as.integer(iter), -loss, change)
    if (ll_converged || par_converged) { converged <- TRUE; break }
  }
  # Finalize exactly these estimates without another optimizer iteration.
  fit <- suppressWarnings(do.call(ordinal::clm, c(args, list(start = par,
    control = ordinal::clm.control(maxIter = 0, tol = options$singularity,
                                   convergence = "silent")))))
  list(fit = fit, history = history, converged = converged)
}
