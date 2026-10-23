# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-skewness-kurtosis.R — regression test for a critical bug found while
# implementing spss-parity-findings-2026-07-07 (A4/A5): _bootstrap.R's
# wtd_skewness()/wtd_kurtosis() used (n-1)^1.5/(n-1)^2 in the numerator
# instead of n^2, which is correct only in the limit and was wildly wrong
# for any realistic n (e.g. kurtosis off by a factor of ~26x at n=12,
# diverging further as n grows). This affected every script that computes
# skewness/kurtosis: Descriptives, Frequencies, Explore, Normality.
#
# Reference: canonical adjusted Fisher-Pearson skewness (G1) and Fisher's
# excess kurtosis (G2), using BIASED population moments m2/m3/m4 (divide by
# n, not n-1) — the standard NIST/Wikipedia definitions that SPSS matches:
#   G1 = sqrt(n(n-1))/(n-2) * (m3/m2^1.5)
#   G2 = (n-1)/((n-2)(n-3)) * ((n+1)*(m4/m2^2 - 3) + 6)
#
# Unlike other test-*.R files, this one calls wtd_skewness()/wtd_kurtosis()
# directly (no parquet fixture / spawned script needed), so it sources
# _bootstrap.R once here.
source(file.path(r_scripts_dir(), "_bootstrap.R"))

test_that("wtd_skewness()/wtd_kurtosis() match the canonical G1/G2 formulas (unweighted)", {
  set.seed(11)
  x <- rgamma(50, shape = 2, rate = 1)
  n <- length(x)
  m <- mean(x); m2 <- mean((x - m)^2); m3 <- mean((x - m)^3); m4 <- mean((x - m)^4)

  ref_G1 <- sqrt(n * (n - 1)) / (n - 2) * (m3 / m2^1.5)
  g2 <- m4 / m2^2 - 3
  ref_G2 <- (n - 1) / ((n - 2) * (n - 3)) * ((n + 1) * g2 + 6)

  expect_equal(wtd_skewness(x), ref_G1, tolerance = 1e-9, "wtd_skewness matches canonical G1")
  expect_equal(wtd_kurtosis(x), ref_G2, tolerance = 1e-9, "wtd_kurtosis matches canonical G2")
})

test_that("wtd_skewness()/wtd_kurtosis() with integer weights reproduce row-expansion exactly", {
  set.seed(12)
  base_x  <- rgamma(25, shape = 2, rate = 1)
  weights <- sample(1:4, 25, replace = TRUE)
  expanded <- rep(base_x, weights)

  expect_equal(wtd_skewness(base_x, weights), wtd_skewness(expanded), tolerance = 1e-9,
               "weighted skewness == unweighted skewness on row-expanded data")
  expect_equal(wtd_kurtosis(base_x, weights), wtd_kurtosis(expanded), tolerance = 1e-9,
               "weighted kurtosis == unweighted kurtosis on row-expanded data")
})

test_that("wtd_skewness()/wtd_kurtosis() do not blow up with n (regression guard for the fixed bug)", {
  set.seed(13)
  x <- rgamma(5000, shape = 2, rate = 1)  # theoretical skew ~1.414, excess kurtosis ~3
  expect_true(abs(wtd_skewness(x) - 1.414214) < 0.2, "large-n skewness near theoretical gamma value")
  expect_true(abs(wtd_kurtosis(x) - 3) < 0.5, "large-n kurtosis near theoretical gamma value")
})
