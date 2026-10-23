# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-power.R — validates power.R (previously untested; an earlier
# hand-computation audit flagged it high-risk because noncentrality
# parameters are an easy place to get subtly wrong). Oracle: independently
# re-derived noncentral-distribution formulas (not calling the script's own
# power_at()), cross-checked against the well-known Cohen (1988) textbook
# benchmarks already cited in roadmap.md SA (d=0.5 n=64 -> power .80,
# r=0.3 n=84 -> .80, f=0.25 k=4 n=45 -> .80, w=0.3 df=4 N=133 -> .80).

test_that("power: two-sample t-test achieved power matches an independent noncentral-t formula", {
  fixture <- write_fixture(data.frame(x = 1), list(
    test = "tTwo", effectSize = 0.5, alpha = 0.05, n = 64
  ))
  result <- run_analysis_script("power.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  n <- 64; es <- 0.5; alpha <- 0.05
  df <- 2 * n - 2; ncp <- es * sqrt(n / 2)
  crit <- qt(1 - alpha / 2, df)
  ref_power <- pt(crit, df, ncp, lower.tail = FALSE) + pt(-crit, df, ncp)

  tbl <- find_table(result, "output.power.title")
  achieved_row <- NULL
  for (r in tbl$rows) if (identical(r[[1]], "output.power.achieved")) achieved_row <- r
  expect_true(!is.null(achieved_row), "achieved power row found")
  expect_equal(as.numeric(achieved_row[[2]]), ref_power, tolerance = 1e-4, "achieved power matches noncentral-t formula")
  # Cohen (1988) textbook benchmark: d=0.5, n=64/group -> power ~ .80.
  expect_true(abs(ref_power - 0.80) < 0.01, "matches Cohen's published d=0.5,n=64 -> power~.80 benchmark")
})

test_that("power: correlation achieved power matches an independent Fisher-z formula (Cohen r=0.3,n=84->~.80)", {
  fixture <- write_fixture(data.frame(x = 1), list(
    test = "correlation", effectSize = 0.3, alpha = 0.05, n = 84
  ))
  result <- run_analysis_script("power.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  n <- 84; es <- 0.3; alpha <- 0.05
  z <- atanh(es); se <- 1 / sqrt(n - 3); zc <- qnorm(1 - alpha / 2)
  ref_power <- pnorm(z / se - zc) + pnorm(-z / se - zc)

  tbl <- find_table(result, "output.power.title")
  achieved_row <- NULL
  for (r in tbl$rows) if (identical(r[[1]], "output.power.achieved")) achieved_row <- r
  expect_equal(as.numeric(achieved_row[[2]]), ref_power, tolerance = 1e-4, "achieved power matches Fisher-z formula")
  expect_true(abs(ref_power - 0.80) < 0.01, "matches Cohen's published r=0.3,n=84 -> power~.80 benchmark")
})

test_that("power: one-way ANOVA achieved power matches an independent noncentral-F formula (Cohen f=0.25,k=4,n=45->~.80)", {
  fixture <- write_fixture(data.frame(x = 1), list(
    test = "anova", effectSize = 0.25, alpha = 0.05, n = 45, groups = 4
  ))
  result <- run_analysis_script("power.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  n <- 45; es <- 0.25; alpha <- 0.05; groups <- 4
  N <- groups * n; df1 <- groups - 1; df2 <- N - groups; ncp <- es^2 * N
  ref_power <- pf(qf(1 - alpha, df1, df2), df1, df2, ncp, lower.tail = FALSE)

  tbl <- find_table(result, "output.power.title")
  achieved_row <- NULL
  for (r in tbl$rows) if (identical(r[[1]], "output.power.achieved")) achieved_row <- r
  expect_equal(as.numeric(achieved_row[[2]]), ref_power, tolerance = 1e-4, "achieved power matches noncentral-F formula")
  expect_true(abs(ref_power - 0.80) < 0.01, "matches Cohen's published f=0.25,k=4,n=45 -> power~.80 benchmark")
})

test_that("power: required sample size search finds the smallest N achieving target power", {
  fixture <- write_fixture(data.frame(x = 1), list(
    test = "tTwo", effectSize = 0.5, alpha = 0.05, n = 20, power = 0.80
  ))
  result <- run_analysis_script("power.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  tbl <- find_table(result, "output.power.title")
  req_row <- NULL
  for (r in tbl$rows) if (identical(r[[1]], "output.power.reqNPerGroup")) req_row <- r
  expect_true(!is.null(req_row), "required N row found")
  req_n <- as.numeric(req_row[[2]])

  # The required N must itself achieve >= target power, and N-1 must not.
  power_at_tTwo <- function(n) {
    df <- 2 * n - 2; ncp <- 0.5 * sqrt(n / 2)
    crit <- qt(1 - 0.05 / 2, df)
    pt(crit, df, ncp, lower.tail = FALSE) + pt(-crit, df, ncp)
  }
  expect_true(power_at_tTwo(req_n) >= 0.80, "required N achieves target power")
  expect_true(power_at_tTwo(req_n - 1) < 0.80, "required N is the SMALLEST N achieving target power")
  # Cohen's published value for d=0.5 targeting power=.80 is n=64/group.
  expect_equal(req_n, 64, tolerance = 1e-9, "matches Cohen's published required N=64")
})
