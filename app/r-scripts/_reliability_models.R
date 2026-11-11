# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# _reliability_models.R — reliability models and statistics beyond alpha,
# shared by reliability.R and the scale scripts (item analysis, test-retest).
# All functions take a listwise-complete n x k numeric matrix; covariances use
# the n - 1 divisor unless stated otherwise.

#' Cronbach's alpha.
rel_alpha <- function(m) {
  k <- ncol(m)
  k / (k - 1) * (1 - sum(apply(m, 2, stats::var)) / stats::var(rowSums(m)))
}

#' Guttman's six lower bounds (Guttman 1945; SPSS RELIABILITY /MODEL=GUTTMAN).
#' L4 splits the items as the split-half model does (first ceiling(k/2) items).
rel_guttman <- function(mat) {
  k <- ncol(mat); C <- stats::cov(mat); vt <- sum(C); s2 <- diag(C)
  off <- C; diag(off) <- 0
  l1 <- 1 - sum(s2) / vt
  l2 <- l1 + sqrt(k / (k - 1) * sum(off^2)) / vt
  l3 <- k / (k - 1) * l1
  n1 <- ceiling(k / 2)
  a <- rowSums(mat[, seq_len(n1), drop = FALSE]); b <- rowSums(mat[, (n1 + 1):k, drop = FALSE])
  l4 <- 2 * (1 - (stats::var(a) + stats::var(b)) / vt)
  l5 <- l1 + 2 * sqrt(max(colSums(off^2))) / vt
  # Error variance of item i = its residual variance regressed on the others,
  # 1 / (C^-1)_ii.
  l6 <- 1 - sum(1 / diag(solve(C))) / vt
  c(l1, l2, l3, l4, l5, l6)
}

#' Parallel / strictly parallel model by maximum likelihood. Covariance
#' structure: a common variance on the diagonal and a common covariance off it
#' (compound symmetry); the strict model also equates the item means. For this
#' structure the ML estimates are the averages of the ML (divisor n) sample
#' covariance's diagonal and off-diagonal — of S + d d' under the strict model,
#' d being the item means' deviations from their grand mean — and the
#' likelihood-ratio statistic is n (ln|Sigma| - ln|S| + tr(Sigma^-1 S) - k),
#' the statistic lavaan reports for the same constrained one-factor model.
rel_parallel <- function(mat, strict) {
  n <- nrow(mat); k <- ncol(mat)
  m <- colMeans(mat); S <- stats::cov(mat) * (n - 1) / n
  gm <- mean(m)
  St <- if (strict) S + tcrossprod(m - gm) else S
  v <- mean(diag(St)); cv <- mean(St[upper.tri(St)])
  Sig <- matrix(cv, k, k); diag(Sig) <- v
  ld_s <- as.numeric(determinant(S)$modulus); ld_c <- as.numeric(determinant(Sig)$modulus)
  chi <- n * (ld_c - ld_s + sum(diag(solve(Sig, St))) - k)
  df <- k * (k + 1) / 2 - 2 + if (strict) k - 1 else 0
  list(mean = gm, v = v, true = cv, error = v - cv, r = cv / v,
       rel = k * cv / (v + (k - 1) * cv), chi = chi, df = df,
       p = stats::pchisq(chi, df, lower.tail = FALSE), ld_s = ld_s, ld_c = ld_c)
}

#' McDonald's omega (total) from a one-factor model fitted by ML (lavaan,
#' standardized latent): (sum lambda)^2 / ((sum lambda)^2 + sum theta).
rel_omega <- function(mat) {
  if (!requireNamespace("lavaan", quietly = TRUE)) return(NULL)
  d <- as.data.frame(mat); names(d) <- paste0("x", seq_len(ncol(mat)))
  fit <- tryCatch(suppressWarnings(lavaan::cfa(paste("F =~", paste(names(d), collapse = " + ")),
                                               data = d, std.lv = TRUE)), error = function(e) NULL)
  if (is.null(fit) || !isTRUE(lavaan::lavInspect(fit, "converged"))) return(NULL)
  pe <- lavaan::parameterEstimates(fit)
  lam <- pe$est[pe$op == "=~"]
  th <- pe$est[pe$op == "~~" & pe$lhs == pe$rhs & pe$lhs != "F"]
  list(omega = sum(lam)^2 / (sum(lam)^2 + sum(th)), loadings = lam, residuals = th)
}

#' Two-way (cases x items) ANOVA pieces shared by the ICC, Tukey's test and
#' the ANOVA table.
rel_twoway <- function(mat) {
  n <- nrow(mat); k <- ncol(mat); g <- mean(mat)
  rm <- rowMeans(mat); cm <- colMeans(mat)
  ss_r <- k * sum((rm - g)^2); ss_c <- n * sum((cm - g)^2)
  ss_t <- sum((mat - g)^2); ss_w <- ss_t - ss_r; ss_e <- ss_w - ss_c
  list(n = n, k = k, g = g, rm = rm, cm = cm,
       ss_r = ss_r, ss_c = ss_c, ss_e = ss_e, ss_w = ss_w, ss_t = ss_t,
       ms_r = ss_r / (n - 1), ms_c = ss_c / (k - 1), ms_e = ss_e / ((n - 1) * (k - 1)),
       ms_w = ss_w / (n * (k - 1)))
}

#' Intraclass correlation (McGraw & Wong 1996): single and average measures,
#' each c(estimate, lower, upper, F, df1, df2, p) with the F test against
#' `test_value`. `model` "oneway" | "random" | "mixed"; `type`
#' "consistency" | "absolute" (ignored for one-way). The two-way random and
#' mixed models share their estimates (only the interpretation differs), as
#' in SPSS.
rel_icc <- function(a, model, type, ci = 0.95, test_value = 0) {
  n <- a$n; k <- a$k; q <- 1 - (1 - ci) / 2; r0 <- test_value
  out <- function(e1, c1, F1, d11, d21, ek, ck, Fk, d1k, d2k) list(
    single = c(e1, c1, F1, d11, d21, stats::pf(F1, d11, d21, lower.tail = FALSE)),
    average = c(ek, ck, Fk, d1k, d2k, stats::pf(Fk, d1k, d2k, lower.tail = FALSE)))
  if (model == "oneway" || type == "consistency") {
    ms_err <- if (model == "oneway") a$ms_w else a$ms_e
    df1 <- n - 1; df2 <- if (model == "oneway") n * (k - 1) else (n - 1) * (k - 1)
    Fo <- a$ms_r / ms_err
    FL <- Fo / stats::qf(q, df1, df2); FU <- Fo * stats::qf(q, df2, df1)
    return(out((a$ms_r - ms_err) / (a$ms_r + (k - 1) * ms_err),
               c((FL - 1) / (FL + k - 1), (FU - 1) / (FU + k - 1)),
               Fo * (1 - r0) / (1 + (k - 1) * r0), df1, df2,
               (a$ms_r - ms_err) / a$ms_r, c(1 - 1 / FL, 1 - 1 / FU),
               Fo * (1 - r0), df1, df2))
  }
  # Absolute agreement, two-way.
  icc1 <- (a$ms_r - a$ms_e) / (a$ms_r + (k - 1) * a$ms_e + k * (a$ms_c - a$ms_e) / n)
  icck <- (a$ms_r - a$ms_e) / (a$ms_r + (a$ms_c - a$ms_e) / n)
  A <- k * icc1 / (n * (1 - icc1)); B <- 1 + k * icc1 * (n - 1) / (n * (1 - icc1))
  v <- (A * a$ms_c + B * a$ms_e)^2 /
    ((A * a$ms_c)^2 / (k - 1) + (B * a$ms_e)^2 / ((n - 1) * (k - 1)))
  FsL <- stats::qf(q, n - 1, v); FsU <- stats::qf(q, v, n - 1)
  lo <- n * (a$ms_r - FsL * a$ms_e) /
    (FsL * (k * a$ms_c + (k * n - k - n) * a$ms_e) + n * a$ms_r)
  hi <- n * (FsU * a$ms_r - a$ms_e) /
    (k * a$ms_c + (k * n - k - n) * a$ms_e + n * FsU * a$ms_r)
  # F tests against r0 (McGraw & Wong 1996, Table 8, cases A,1 and A,k).
  a1 <- k * r0 / (n * (1 - r0)); b1 <- 1 + k * r0 * (n - 1) / (n * (1 - r0))
  ak <- r0 / (n * (1 - r0)); bk <- 1 + r0 * (n - 1) / (n * (1 - r0))
  dfv <- function(aa, bb) if (r0 == 0) (n - 1) * (k - 1) else (aa * a$ms_c + bb * a$ms_e)^2 /
    ((aa * a$ms_c)^2 / (k - 1) + (bb * a$ms_e)^2 / ((n - 1) * (k - 1)))
  out(icc1, c(lo, hi), a$ms_r / (a1 * a$ms_c + b1 * a$ms_e), n - 1, dfv(a1, b1),
      icck, c(lo * k / (1 + lo * (k - 1)), hi * k / (1 + hi * (k - 1))),
      a$ms_r / (ak * a$ms_c + bk * a$ms_e), n - 1, dfv(ak, bk))
}

#' Hotelling's T-squared test that all item means are equal:
#' c(T2, F, df1, df2, p).
rel_hotelling <- function(mat) {
  n <- nrow(mat); k <- ncol(mat)
  D <- mat[, -1, drop = FALSE] - mat[, 1]
  d <- colMeans(D); S <- stats::cov(D)
  t2 <- n * as.numeric(crossprod(d, solve(S, d)))
  f <- (n - k + 1) / ((n - 1) * (k - 1)) * t2
  c(t2, f, k - 1, n - k + 1, stats::pf(f, k - 1, n - k + 1, lower.tail = FALSE))
}

#' Tukey's one-degree-of-freedom test for nonadditivity, and his estimate of
#' the power the observations must be raised to for additivity.
rel_tukey <- function(a, mat) {
  ri <- a$rm - a$g; cj <- a$cm - a$g
  D <- sum(mat * outer(ri, cj)); den <- sum(ri^2) * sum(cj^2)
  ss_n <- D^2 / den; ss_b <- a$ss_e - ss_n
  df_b <- (a$n - 1) * (a$k - 1) - 1
  list(ss_n = ss_n, ss_b = ss_b, df_b = df_b, F = ss_n / (ss_b / df_b),
       p = stats::pf(ss_n / (ss_b / df_b), 1, df_b, lower.tail = FALSE),
       power = 1 - a$g * D / den)
}

#' Cochran's Q for dichotomous (0/1) items: c(Q, df, p).
rel_cochran <- function(mat) {
  k <- ncol(mat); Cj <- colSums(mat); Ri <- rowSums(mat); T <- sum(mat)
  q <- (k - 1) * (k * sum(Cj^2) - T^2) / (k * T - sum(Ri^2))
  c(q, k - 1, stats::pchisq(q, k - 1, lower.tail = FALSE))
}
