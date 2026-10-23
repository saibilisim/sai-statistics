# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-life-tables.R — validates life-tables.R's actuarial (Cutler-Ederer)
# life table arithmetic. There is no CRAN package implementing the classic
# actuarial method (survival::survfit is Kaplan-Meier, a different
# estimator), so the oracle here is an independently-coded, non-looping
# vectorized recomputation of the same well-documented actuarial formula
# (entering N, withdrawn, effective N = entering - withdrawn/2, terminal
# events, q = d/effective N, p = 1-q, cumulative survival at the END of the
# interval = prod(p) up to and including it) — this
# catches arithmetic/indexing bugs in the script's loop even though both
# implementations target the same textbook method.

reference_life_table <- function(tv, sv, width, maxt) {
  status1 <- as.integer(sv != 0)
  # SPSS's THRU maxt BY width gives the closed intervals up to maxt PLUS a
  # final open one starting at maxt; the reference builds the same shape.
  breaks <- c(seq(0, ceiling(maxt / width) * width, by = width), Inf)
  k <- length(breaks) - 1
  entering <- numeric(k); withdrawn <- numeric(k); exposed <- numeric(k)
  terminal <- numeric(k); q <- numeric(k); p <- numeric(k); cum_surv <- numeric(k)
  n_start <- length(tv); S <- 1
  for (i in seq_len(k)) {
    lo <- breaks[i]; hi <- breaks[i + 1]
    in_int <- tv >= lo & tv < hi
    d <- sum(in_int & status1 == 1)
    w <- sum(in_int & status1 == 0)
    neff <- n_start - w / 2
    qi <- if (neff > 0) d / neff else 0
    entering[i] <- n_start; withdrawn[i] <- w; exposed[i] <- neff
    terminal[i] <- d; q[i] <- qi; p[i] <- 1 - qi
    S <- S * (1 - qi)
    cum_surv[i] <- S
    n_start <- n_start - d - w
    if (n_start <= 0) { k <- i; break }
  }
  list(entering = entering[1:k], withdrawn = withdrawn[1:k], exposed = exposed[1:k],
       terminal = terminal[1:k], q = q[1:k], p = p[1:k], cumSurv = cum_surv[1:k])
}

test_that("life-tables: actuarial table matches an independently-coded reference implementation", {
  set.seed(51)
  n <- 100
  tv <- round(rexp(n, rate = 0.4), 2)
  sv <- rbinom(n, 1, 0.7)
  df <- data.frame(col_t = tv, col_s = sv)

  fixture <- write_fixture(df, list(
    time = "col_t", status = "col_s", interval = 1, maxTime = 6,
    varNames = list(col_t = "Time", col_s = "Status")
  ))
  result <- run_analysis_script("life-tables.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- reference_life_table(tv, sv, width = 1, maxt = 6)
  tbl <- find_table(result, "output.lifetab.title")
  expect_equal(length(tbl$rows), length(ref$entering), label = "row count matches reference interval count")

  for (i in seq_along(ref$entering)) {
    expect_equal(cell_num(tbl, i, 2), ref$entering[i], tolerance = 1e-9, sprintf("row %d entering N", i))
    expect_equal(cell_num(tbl, i, 3), ref$withdrawn[i], tolerance = 1e-9, sprintf("row %d withdrawn", i))
    expect_equal(cell_num(tbl, i, 4), ref$exposed[i], tolerance = 1e-3, sprintf("row %d exposed (effective N)", i))
    expect_equal(cell_num(tbl, i, 5), ref$terminal[i], tolerance = 1e-9, sprintf("row %d terminal events", i))
    expect_equal(cell_num(tbl, i, 6), ref$q[i], tolerance = 1e-3, sprintf("row %d proportion terminating", i))
    expect_equal(cell_num(tbl, i, 7), ref$p[i], tolerance = 1e-3, sprintf("row %d proportion surviving", i))
    # 1e-2 relative: the script rounds to 4 decimals, and in the tail the
    # cumulative proportion is ~0.023, where that rounding is a 0.2% move.
    expect_equal(cell_num(tbl, i, 8), ref$cumSurv[i], tolerance = 1e-2, sprintf("row %d cumulative survival", i))
  }
})

test_that("life-tables: all-censored interval has zero terminal events and q=0", {
  df <- data.frame(
    col_t = c(0.5, 0.7, 1.2, 1.8, 2.5, 2.9),
    col_s = c(0,   0,   1,   1,   0,   1)
  )
  fixture <- write_fixture(df, list(
    time = "col_t", status = "col_s", interval = 1, maxTime = 3,
    varNames = list(col_t = "Time", col_s = "Status")
  ))
  result <- run_analysis_script("life-tables.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  tbl <- find_table(result, "output.lifetab.title")
  # Interval [0,1): 2 censored, 0 events -> terminal=0, q=0, p=1, cumSurv starts at 1.
  expect_equal(cell_num(tbl, 1, 2), 6, tolerance = 1e-9, "entering N at interval 0")
  expect_equal(cell_num(tbl, 1, 3), 2, tolerance = 1e-9, "withdrawn in interval 0")
  expect_equal(cell_num(tbl, 1, 5), 0, tolerance = 1e-9, "no terminal events in interval 0")
  expect_equal(cell_num(tbl, 1, 6), 0, tolerance = 1e-9, "q=0 when no events")
  # No events in [0,1), so the cumulative proportion surviving AT ITS END is
  # still 1 — the column is an end-of-interval value, as its label says.
  expect_equal(cell_num(tbl, 1, 8), 1, tolerance = 1e-9, "cumulative survival after a no-event interval")
})

test_that("life tables: median survival time and the Options plots (2026-10)", {
  # 10 cases, all events, width 2: S at end of [0,2) = .8, [2,4) = .5, [4,6) = .3
  d <- data.frame(col_t = c(1, 1, 3, 3, 3, 5, 5, 7, 7, 9), col_s = rep(1, 10))
  res <- run_analysis_script("life-tables.R", write_fixture(d, list(
    time = "col_t", status = "col_s", interval = 2,
    varNames = list(col_t = "t", col_s = "s"),
    options = list(plots = list("survival", "hazard", "density")))))
  expect_true(isTRUE(res$success), "success")
  md <- find_table(res, "output.lifetab.medianTitle")
  # crosses .5 exactly at the end of [2,4): 2 + 2 * (.8 - .5) / (.8 - .5) = 4
  expect_equal(cell_num(md, 1, 1), 4, tolerance = 1e-9, "median by interpolation")
  expect_true(length(res$plots) == 3, "three plots")
  lt <- find_table(res, "output.lifetab.title")
  # density of [0,2) = (1 - .8) / 2; hazard = 2q / (h(1 + p)) with q = .2
  expect_equal(cell_num(lt, 1, 10), 0.1, tolerance = 1e-9, "probability density")
  expect_equal(cell_num(lt, 1, 12), round(2 * 0.2 / (2 * 1.8), 4), tolerance = 1e-9, "hazard rate")
})
