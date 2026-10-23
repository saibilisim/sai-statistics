# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# Multinomial maximum likelihood with explicit Newton/step-halving controls.
# Parameter vector is column-major: all design coefficients for category 2,
# then category 3, etc. Category 1 has coefficients fixed at zero.
mn_inverse <- function(a, tol) {
  if (!nrow(a)) return(a)
  eig <- eigen(a, symmetric = TRUE)
  keep <- eig$values > max(abs(eig$values)) * tol
  if (!any(keep)) return(matrix(0, nrow(a), ncol(a)))
  v <- eig$vectors[, keep, drop = FALSE]
  tcrossprod(sweep(v, 2, sqrt(eig$values[keep]), '/'))
}

# Full (non-truncated) inverse, used ONLY for the covariance matrix reported to
# the user (SE/Wald/CI), never for the Newton step above. mn_inverse() drops
# near-zero information eigenvalues to a zero contribution, which is the right
# guard for a solver step but the wrong answer for a standard error: under
# quasi/complete separation the true asymptotic variance in that direction
# diverges rather than vanishing, so truncating it produces a deceptively
# tiny SE and a spuriously huge, "highly significant" Wald statistic — the
# opposite of the Hauck-Donner behaviour a correct MLE shows there. Inverting
# every eigenvalue lets an identifiable-but-large SE come through unchanged;
# a genuinely singular direction now surfaces as a non-finite entry, which
# callers must report as missing rather than as a number that looks precise.
mn_report_inverse <- function(a) {
  if (!nrow(a)) return(a)
  eig <- eigen(a, symmetric = TRUE)
  w <- 1 / eig$values
  m <- matrix(0, nrow(a), nrow(a))
  for (j in seq_along(w)) {
    outer_vv <- outer(eig$vectors[, j], eig$vectors[, j])
    # An eigenvector with an exactly-zero component along some coordinate
    # cannot make that coordinate's variance diverge no matter how large this
    # direction's weight (1/eigenvalue) is — 0 * Inf belongs to 0 here, not to
    # the NaN plain arithmetic would produce.
    m <- m + ifelse(outer_vv == 0, 0, outer_vv * w[j])
  }
  m[!is.finite(m)] <- NA_real_
  m
}

mn_state <- function(x, y, beta, derivatives = TRUE) {
  k <- ncol(y); p <- ncol(x); n <- rowSums(y)
  eta <- cbind(0, x %*% matrix(beta, p, k - 1L))
  shift <- apply(eta, 1, max)
  logp <- eta - (shift + log(rowSums(exp(eta - shift))))
  prob <- exp(logp)
  ans <- list(ll = sum(y * logp), prob = prob)
  if (!derivatives || p == 0L) return(ans)
  ans$score <- as.vector(crossprod(x, y[, -1, drop = FALSE] - n * prob[, -1, drop = FALSE]))
  h <- matrix(0, p * (k - 1), p * (k - 1))
  for (a in seq_len(k - 1L)) for (b in seq_len(k - 1L)) {
    ia <- (a - 1L) * p + seq_len(p); ib <- (b - 1L) * p + seq_len(p)
    h[ia, ib] <- crossprod(x, x * (n * prob[, a + 1L] * ((a == b) - prob[, b + 1L])))
  }
  ans$information <- h
  ans
}

mn_fit <- function(x, y, criteria, start = NULL) {
  p <- ncol(x); k <- ncol(y)
  if (p * (k - 1) > 1500) stop('output.multinom.extra.parameterLimit')
  scales <- if (p) pmax(1, apply(abs(x), 2, max)) else numeric()
  xs <- if (p) sweep(x, 2, scales, '/') else x
  q <- qr(xs, tol = criteria$singularity)
  keep <- if (q$rank) sort(q$pivot[seq_len(q$rank)]) else integer()
  xs <- xs[, keep, drop = FALSE]
  d <- ncol(xs) * (k - 1L)
  beta <- rep(0, d)
  if (!is.null(start) && length(start) == d) beta <- start * rep(scales[keep], k - 1L)
  s <- mn_state(xs, y, beta)
  history <- list(); converged <- d == 0; separated <- FALSE; halvingFailed <- FALSE
  for (iteration in seq_len(criteria$maxIterations)) {
    if (d == 0L) break
    inv <- mn_inverse(s$information, criteria$singularity)
    step <- as.vector(inv %*% s$score)
    alpha <- 1; next_state <- NULL
    for (half in 0:criteria$maxStepHalving) {
      next_state <- mn_state(xs, y, beta + alpha * step)
      if (is.finite(next_state$ll) && next_state$ll >= s$ll - 1e-10) break
      alpha <- alpha / 2
    }
    if (!is.finite(next_state$ll) || next_state$ll < s$ll - 1e-10) { halvingFailed <- TRUE; break }
    change <- max(abs(alpha * step / rep(scales[keep], k - 1L)))
    ll_change <- abs(next_state$ll - s$ll)
    beta <- beta + alpha * step
    s <- next_state
    history[[length(history) + 1L]] <- list(iteration, -2 * s$ll, change, half)
    if (isTRUE(criteria$checkSeparation) && iteration >= criteria$separationStart) {
      # Diagnostic only: near-degenerate fitted probabilities plus unbounded
      # coefficients. Never report this as a proof of complete separation.
      separated <- separated || (max(abs(beta)) > 25 && any(s$prob < 1e-10))
    }
    if ((criteria$parameter > 0 && change < criteria$parameter) ||
        (criteria$logLikelihood > 0 && ll_change < criteria$logLikelihood)) { converged <- TRUE; break }
  }
  rescale <- if (d) outer(rep(scales[keep], k - 1L), rep(scales[keep], k - 1L)) else NULL
  cov <- if (d) mn_inverse(s$information, criteria$singularity) / rescale else matrix(numeric(), 0, 0)
  # Separate from `cov` above (used internally for the solver step and the
  # backward-elimination Wald test, where truncating ill-conditioned
  # directions is the desired guard): this is the covariance actually shown
  # to the user, so it must not silently understate a diverging variance.
  report_cov <- if (d) mn_report_inverse(s$information) / rescale else matrix(numeric(), 0, 0)
  co <- if (d) matrix(beta / rep(scales[keep], k - 1L), ncol(xs), k - 1L) else matrix(numeric(), 0, k - 1L)
  list(coef = co, covariance = cov, reportCovariance = report_cov, ll = s$ll, prob = s$prob, df = d,
       keep = keep, x = x[, keep, drop = FALSE], history = history,
       converged = converged, separated = separated, halvingFailed = halvingFailed,
       aliased = length(keep) < p)
}

mn_terms <- function(model, factors, covariates) {
  all <- c(factors, covariates)
  canonical <- function(term) paste(sort(unique(unlist(term))), collapse = ':')
  if (model$mode == 'main') return(list(forced = all, stepped = character()))
  if (model$mode == 'factorial') {
    if (length(factors) > 8) stop('output.multinom.extra.factorLimit')
    terms <- covariates
    for (n in seq_along(factors)) terms <- c(terms, combn(factors, n, FUN = function(v) paste(v, collapse = ':')))
    return(list(forced = terms, stepped = character()))
  }
  forced <- unique(vapply(model$forced, canonical, character(1)))
  stepped <- setdiff(unique(vapply(model$stepped, canonical, character(1))), forced)
  members <- unique(unlist(strsplit(c(forced, stepped), ':', fixed = TRUE)))
  if (any(!members %in% all) || any(!nzchar(c(forced, stepped)))) stop('output.multinom.extra.missingTerm')
  list(forced = forced, stepped = stepped)
}

mn_design <- function(terms, dat, intercept) {
  if (!length(terms)) {
    x <- matrix(if (intercept) 1 else numeric(), nrow(dat), if (intercept) 1 else 0)
    if (intercept) colnames(x) <- '(Intercept)'
    attr(x, 'assign') <- if (intercept) 0L else integer()
    return(x)
  }
  formula <- reformulate(terms, intercept = intercept)
  x <- model.matrix(formula, dat)
  attr(x, 'term.labels') <- attr(stats::terms(formula), 'term.labels')
  x
}

mn_select <- function(dat, y, model, options, criteria, terms, factors) {
  forced <- terms$forced; pool <- terms$stepped
  backward <- model$method %in% c('backward', 'backwardStepwise')
  both <- model$method %in% c('forwardStepwise', 'backwardStepwise')
  selected <- if (backward) pool else character()
  universe <- unique(c(forced, pool))
  cache <- new.env(parent = emptyenv())
  fit_terms <- function(ts) {
    ts <- sort(ts); key <- paste(c('fit', ts), collapse = '|')
    if (!exists(key, cache, inherits = FALSE)) {
      x <- mn_design(ts, dat, model$intercept)
      fit <- mn_fit(x, y, criteria)
      fit$terms <- if (length(ts)) attr(x, 'term.labels') else character()
      fit$assign <- attr(x, 'assign')[fit$keep]
      assign(key, fit, cache)
    }
    get(key, cache, inherits = FALSE)
  }
  lower <- function(a, b) {
    aa <- strsplit(a, ':', fixed = TRUE)[[1]]; bb <- strsplit(b, ':', fixed = TRUE)[[1]]
    if (length(aa) >= length(bb) || !all(aa %in% bb)) return(FALSE)
    if (options$hierarchy == 'none') return(FALSE)
    if (options$hierarchy == 'factors') return(all(c(aa, bb) %in% factors))
    if (options$hierarchy == 'containment') return(setequal(setdiff(aa, factors), setdiff(bb, factors)))
    TRUE
  }
  valid <- function(ts) all(vapply(ts, function(b) all(universe[vapply(universe, lower, logical(1), b = b)] %in% ts), logical(1)))
  current <- fit_terms(c(forced, selected)); history <- list(); seen <- character()
  test <- function(reduced, full, term, entering) {
    df <- full$df - reduced$df
    if (df <= 0) return(1)
    stat <- max(0, 2 * (full$ll - reduced$ll))
    if (entering && options$entryTest == 'score') {
      b <- matrix(0, ncol(full$x), ncol(y) - 1L)
      idx <- match(colnames(reduced$x), colnames(full$x))
      if (length(idx)) b[idx, ] <- reduced$coef
      state <- mn_state(full$x, y, as.vector(b))
      stat <- as.numeric(crossprod(state$score, mn_inverse(state$information, criteria$singularity) %*% state$score))
    } else if (!entering && options$removalTest == 'wald') {
      cols <- which(full$assign == match(term, full$terms))
      ids <- unlist(lapply(seq_len(ncol(y) - 1L), function(k) cols + (k - 1L) * ncol(full$x)))
      b <- as.vector(full$coef)[ids]; v <- full$covariance[ids, ids, drop = FALSE]
      stat <- as.numeric(crossprod(b, mn_inverse(v, criteria$singularity) %*% b))
      df <- length(ids)
    }
    pchisq(max(0, stat), df, lower.tail = FALSE)
  }
  max_effects <- if (is.null(options$maxEffects)) length(pool) else options$maxEffects
  if (options$minEffects > length(pool)) stop('output.multinom.extra.minEffectsError')
  # First run the selected directional method to completion; bidirectional
  # variants then alternate the opposite pass until neither pass changes it.
  direction <- if (backward) 'remove' else 'add'
  no_change <- 0L
  for (step in seq_len(max(100L, 10L * length(pool)))) {
    state_key <- paste(direction, paste(sort(selected), collapse = '|'))
    if (state_key %in% seen) break
    seen <- c(seen, state_key)
    candidates <- if (direction == 'add') setdiff(pool, selected) else selected
    if ((direction == 'add' && length(selected) >= max_effects) ||
        (direction == 'remove' && length(selected) <= options$minEffects)) candidates <- character()
    trials <- list(); ps <- numeric(); names_ps <- character()
    for (term in candidates) {
      next_selected <- if (direction == 'add') c(selected, term) else setdiff(selected, term)
      if (!valid(c(forced, next_selected))) next
      fit <- fit_terms(c(forced, next_selected))
      if (!fit$converged || !current$converged) next
      pv <- if (direction == 'add') test(current, fit, term, TRUE) else test(fit, current, term, FALSE)
      if (!is.finite(pv)) next
      trials[[term]] <- fit; names_ps <- c(names_ps, term); ps <- c(ps, pv)
    }
    best <- if (!length(ps)) NA_integer_ else if (direction == 'add') which.min(ps) else which.max(ps)
    changed <- !is.na(best) && if (direction == 'add') ps[best] < options$entryProbability else ps[best] > options$removalProbability
    if (changed) {
      term <- names_ps[best]
      selected <- if (direction == 'add') c(selected, term) else setdiff(selected, term)
      current <- trials[[term]]
      history[[length(history) + 1L]] <- list(length(history) + 1L, direction, term, -2 * current$ll, ps[best])
      no_change <- 0L
    } else {
      no_change <- no_change + 1L
      if (!both || no_change >= 2L) break
      direction <- if (direction == 'add') 'remove' else 'add'
    }
  }
  list(fit = current, history = history, fit_terms = fit_terms)
}
