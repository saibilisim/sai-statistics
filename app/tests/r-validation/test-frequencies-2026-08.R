# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-frequencies-2026-08.R — regression tests for the Frequencies fixes from
# manuel-test/NIHAI-RAPOR-2026-08-07.md:
#   (a) duplicate percentile rows in the Statistics table (Quartiles +
#       Percentiles listed 25/50/75 twice),
#   (b) frequency-table row order: the script ignored options.order and always
#       sorted by count ascending; SPSS's default is ascending by value, which
#       is what Cumulative % depends on.
#
# References are computed independently of the script under test (base R
# table()/quantile()), never from the script's internals.

# ── helpers ───────────────────────────────────────────────────────────────────

# Run frequencies.R on a single-column data.frame and return the frequency
# table (first table when showTable is on).
run_freq <- function(x, extra_options = list(), col_class = NULL) {
  df <- data.frame(col_1 = x, stringsAsFactors = FALSE)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "v"),
    options = c(list(showTable = TRUE), extra_options)
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  find_table(result, "output.frequencies.tableTitle")
}

# Category rows only (drop Valid Total / Missing / Total), as value strings.
freq_values <- function(tbl) {
  keys <- vapply(tbl$rows, function(r) as.character(r[[1]]), character(1))
  vals <- keys[!startsWith(keys, "output.")]
  # Numeric display formatting (M2) may reformat — compare as strings.
  vals
}

# ══ (b) row order ════════════════════════════════════════════════════════════
# Counts deliberately disagree with value order: value 1 is most frequent,
# value 2 least. Old behaviour (count ascending) produced 2,3,1.

.freq_x <- c(rep(1, 50), rep(2, 10), rep(3, 30))

test_that("frequencies: default order is ascending by value (SPSS parity)", {
  tbl <- run_freq(.freq_x)  # no `order` in options at all
  expect_equal(freq_values(tbl), c("1", "2", "3"), tolerance = 0,
               "rows in ascending value order without an order option")

  # Cumulative % accumulates down the VALUE order: 50/90 → 55.6, 83.3, 100.
  cums <- vapply(tbl$rows[1:3], function(r) as.numeric(r[[5]]), numeric(1))
  ref  <- cumsum(round(c(50, 10, 30) / 90 * 100, 1))
  expect_equal(cums, ref, tolerance = 1e-6, "cumulative % follows value order")
})

test_that("frequencies: explicit 'ascending' matches the default", {
  tbl <- run_freq(.freq_x, list(order = "ascending"))
  expect_equal(freq_values(tbl), c("1", "2", "3"), tolerance = 0)
})

test_that("frequencies: 'descending' orders by value descending", {
  tbl <- run_freq(.freq_x, list(order = "descending"))
  expect_equal(freq_values(tbl), c("3", "2", "1"), tolerance = 0)
})

test_that("frequencies: 'ascFreq' keeps the old count-ascending order as an option", {
  tbl <- run_freq(.freq_x, list(order = "ascFreq"))
  expect_equal(freq_values(tbl), c("2", "3", "1"), tolerance = 0)
})

test_that("frequencies: 'descFreq' orders by count descending", {
  tbl <- run_freq(.freq_x, list(order = "descFreq"))
  expect_equal(freq_values(tbl), c("1", "3", "2"), tolerance = 0)
})

test_that("frequencies: numeric value order is numeric, not lexicographic", {
  x <- c(rep(2, 5), rep(10, 5))
  tbl <- run_freq(x)
  expect_equal(freq_values(tbl), c("2", "10"), tolerance = 0,
               "'10' sorts after '2'")
})

test_that("frequencies: string categories default to alphabetical ascending", {
  x <- c(rep("banana", 5), rep("apple", 9), rep("cherry", 1))
  tbl <- run_freq(x)
  expect_equal(freq_values(tbl), c("apple", "banana", "cherry"), tolerance = 0)
})

test_that("frequencies: an unknown order value falls back to ascending values", {
  tbl <- run_freq(.freq_x, list(order = "bogus"))
  expect_equal(freq_values(tbl), c("1", "2", "3"), tolerance = 0)
})

# ══ (a) duplicate percentile rows ════════════════════════════════════════════

stat_labels <- function(x, statistics) {
  df <- data.frame(col_1 = x)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "v"),
    options = list(showTable = FALSE, statistics = statistics)
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  stats <- find_table(result, "output.frequencies.statsTitle")
  vapply(stats$rows, function(r) as.character(r[[1]]), character(1))
}

set.seed(42)
.freq_num <- rnorm(200, 100, 15)

test_that("frequencies: Quartiles + default Percentiles emit 25/50/75 only once", {
  labels <- stat_labels(.freq_num, list(quartiles = TRUE, percentiles = TRUE))
  # The quartile rows keep their SPSS labels…
  expect_true(all(c("output.stat.q1", "output.stat.q2", "output.stat.q3") %in% labels),
              "quartile rows present")
  # …and the overlapping percentile rows are NOT repeated.
  expect_true(!any(c("output.stat.pct25", "output.stat.pct50", "output.stat.pct75") %in% labels),
              "no duplicate pct25/pct50/pct75 rows")
  # The non-overlapping defaults are still emitted.
  expect_true(all(c("output.stat.pct5", "output.stat.pct10",
                    "output.stat.pct90", "output.stat.pct95") %in% labels),
              "non-overlapping default percentiles kept")
})

test_that("frequencies: Quartiles + a custom percentile overlapping 50 emits it once", {
  labels <- stat_labels(.freq_num, list(
    quartiles = TRUE, percentiles = TRUE, customPercentiles = list(33, 50)
  ))
  expect_true("output.stat.q2" %in% labels, "median row present")
  expect_true(!("output.stat.pct50" %in% labels), "percentile 50 not duplicated")
  expect_true("output.stat.pct33" %in% labels, "non-overlapping custom percentile kept")
})

test_that("frequencies: cut points overlapping Quartiles/Percentiles emit once", {
  labels <- stat_labels(.freq_num, list(
    quartiles = TRUE, percentiles = TRUE, cutPoints = 4L
  ))
  # 4 equal groups → 25/50/75, all already covered by Quartiles.
  expect_true(!any(c("output.stat.pct25", "output.stat.pct50", "output.stat.pct75") %in% labels),
              "cut points 25/50/75 not duplicated")

  # Without Quartiles, cut points emit their own rows exactly once.
  labels2 <- stat_labels(.freq_num, list(percentiles = TRUE, cutPoints = 4L))
  expect_equal(sum(labels2 == "output.stat.pct25"), 1L, tolerance = 0,
               "pct25 appears exactly once")
  expect_equal(sum(labels2 == "output.stat.pct50"), 1L, tolerance = 0,
               "pct50 appears exactly once")
})

test_that("frequencies: deduped percentile rows keep their values", {
  df <- data.frame(col_1 = .freq_num)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "v"),
    options = list(showTable = FALSE,
                   statistics = list(quartiles = TRUE, percentiles = TRUE))
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  stats <- find_table(result, "output.frequencies.statsTitle")
  labels <- vapply(stats$rows, function(r) as.character(r[[1]]), character(1))
  # type 6 = SPSS's HAVERAGE; see _bootstrap.R's wtd_quantile().
  ref <- unname(quantile(.freq_num, probs = c(0.25, 0.5, 0.75), type = 6))
  for (i in seq_along(ref)) {
    key <- c("output.stat.q1", "output.stat.q2", "output.stat.q3")[i]
    expect_equal(as.numeric(stats$rows[[which(labels == key)]][[2]]),
                 ref[i], tolerance = 1e-5, paste(key, "value matches stats::quantile"))
  }
})

test_that("frequencies: percentiles 0 and 100 are honoured, not silently dropped", {
  # The dialog's percentile input accepts min=0 max=100, but the script used to
  # filter with `> 0 & < 100` — so asking for percentile 0 or 100 produced no
  # row and no warning. Both are valid (the minimum and the maximum) and
  # wtd_quantile computes them correctly.
  df <- data.frame(col_1 = .freq_num)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "v"),
    options = list(showTable = FALSE,
                   statistics = list(percentiles = TRUE,
                                     customPercentiles = list(0, 50, 100)))
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  stats <- find_table(result, "output.frequencies.statsTitle")
  labels <- vapply(stats$rows, function(r) as.character(r[[1]]), character(1))

  for (p in c("0", "50", "100")) {
    expect_equal(sum(labels == paste0("output.stat.pct", p)), 1L, tolerance = 0,
                 paste0("percentile ", p, " emits exactly one row"))
  }
  val <- function(p) as.numeric(stats$rows[[which(labels == paste0("output.stat.pct", p))]][[2]])
  # sai_output rounds to 6 decimals, so compare at the precision it emits.
  expect_equal(val("0"), min(.freq_num), tolerance = 1e-5, "percentile 0 is the minimum")
  expect_equal(val("100"), max(.freq_num), tolerance = 1e-5, "percentile 100 is the maximum")
  expect_equal(val("50"), unname(quantile(.freq_num, 0.5, type = 6)), tolerance = 1e-5,
               "percentile 50")
})

# ══ (c) coefficient of variation ═════════════════════════════════════════════
# SPSS's FREQUENCIES /STATISTICS=CV: 100 * SD / Mean. Reference computed
# independently of the script under test (base R sd()/mean()).

test_that("frequencies: CV matches 100 * sd(x) / mean(x)", {
  df <- data.frame(col_1 = .freq_num)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "v"),
    options = list(showTable = FALSE, statistics = list(cv = TRUE))
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  stats <- find_table(result, "output.frequencies.statsTitle")
  labels <- vapply(stats$rows, function(r) as.character(r[[1]]), character(1))
  expect_true("output.stat.cv" %in% labels, "CV row present")
  val <- as.numeric(stats$rows[[which(labels == "output.stat.cv")]][[2]])
  ref <- 100 * sd(.freq_num) / mean(.freq_num)
  expect_equal(val, ref, tolerance = 1e-5, "CV = 100 * SD / Mean")
})

test_that("frequencies: CV is omitted (not NaN/Inf) when the mean is zero", {
  x <- c(-5, -2, 0, 2, 5)  # mean = 0 → CV undefined
  df <- data.frame(col_1 = x)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "v"),
    options = list(showTable = FALSE, statistics = list(cv = TRUE))
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  stats <- find_table(result, "output.frequencies.statsTitle")
  labels <- vapply(stats$rows, function(r) as.character(r[[1]]), character(1))
  expect_true("output.stat.cv" %in% labels, "CV row present even when undefined")
  val <- stats$rows[[which(labels == "output.stat.cv")]][[2]]
  expect_true(is.null(val), "CV value is null (undefined), not NaN/Inf, when mean is 0")
})
