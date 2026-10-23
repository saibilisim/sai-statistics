# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-chart.R — validates chart.R's Plotly trace *data* (not rendering) for
# each of the 7 legacy chart types against independently-computed
# references. No tables are produced by this script, so assertions read
# result$plots[[1]]$data$data directly instead of using find_table/cell_num.

num_list <- function(lst) vapply(lst, as.numeric, numeric(1))
chr_list <- function(lst) vapply(lst, as.character, character(1))

test_that("chart: scatter trace carries the raw (x,y) pairs after NA-pairwise removal", {
  df <- data.frame(col_x = c(1, 2, NA, 4, 5), col_y = c(10, NA, 30, 40, 50))
  fixture <- write_fixture(df, list(chartType = "scatter", xVar = "col_x", xVarName = "X",
                                     yVar = "col_y", yVarName = "Y"))
  result <- run_analysis_script("chart.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  tr <- result$plots[[1]]$data$data[[1]]
  # Rows with an NA in x or y are dropped -> only (1,10),(4,40),(5,50) survive.
  expect_equal(num_list(tr$x), c(1, 4, 5), tolerance = 1e-9, "scatter x after pairwise NA removal")
  expect_equal(num_list(tr$y), c(10, 40, 50), tolerance = 1e-9, "scatter y after pairwise NA removal")
})

test_that("chart: bar trace counts match table() sorted descending", {
  df <- data.frame(col_x = c("A", "B", "A", "C", "A", "B"))
  fixture <- write_fixture(df, list(chartType = "bar", xVar = "col_x", xVarName = "X"))
  result <- run_analysis_script("chart.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  tr <- result$plots[[1]]$data$data[[1]]
  ref <- sort(table(df$col_x), decreasing = TRUE)
  expect_equal(chr_list(tr$x), names(ref), label = "bar categories in count-descending order")
  expect_equal(num_list(tr$y), as.numeric(ref), tolerance = 1e-9, "bar counts")
})

test_that("chart: line-with-group trace is the per-group mean, sorted by group name", {
  df <- data.frame(col_y = c(10, 20, 30, 40, 50, 60), col_g = c("B", "B", "A", "A", "C", "A"))
  fixture <- write_fixture(df, list(chartType = "line", xVar = "col_y", xVarName = "Y",
                                     groupVar = "col_g", groupVarName = "G"))
  result <- run_analysis_script("chart.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  tr <- result$plots[[1]]$data$data[[1]]
  ref <- tapply(df$col_y, df$col_g, mean)
  ord <- order(names(ref))
  expect_equal(chr_list(tr$x), names(ref)[ord], label = "line groups sorted alphabetically")
  # tapply() returns a 1-d "array"; as.numeric() strips class/dim so
  # all.equal() compares plain numerics instead of failing on attributes.
  expect_equal(num_list(tr$y), as.numeric(ref)[ord], tolerance = 1e-9, "line group means")
})

test_that("chart: line-without-group trace is the raw case sequence", {
  df <- data.frame(col_y = c(5, 8, NA, 3, 9))
  fixture <- write_fixture(df, list(chartType = "line", xVar = "col_y", xVarName = "Y"))
  result <- run_analysis_script("chart.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  tr <- result$plots[[1]]$data$data[[1]]
  expect_equal(num_list(tr$y), c(5, 8, 3, 9), tolerance = 1e-9, "line values with NA dropped, order preserved")
})

test_that("chart: histogram binwidth/range match nclass.Sturges on the same data", {
  set.seed(81)
  nv <- rnorm(200, 50, 10)
  df <- data.frame(col_x = nv)
  fixture <- write_fixture(df, list(chartType = "histogram", xVar = "col_x", xVarName = "X"))
  result <- run_analysis_script("chart.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  tr <- result$plots[[1]]$data$data[[1]]
  rng <- range(nv)
  nbins <- max(1L, nclass.Sturges(nv))
  binwidth <- (rng[2] - rng[1]) / nbins
  expect_equal(tr$xbins$start, rng[1], tolerance = 1e-9, "histogram bin start == min(x)")
  expect_equal(tr$xbins$size, binwidth, tolerance = 1e-6, "histogram binwidth == range/nclass.Sturges")
  expect_equal(length(tr$x), length(nv), label = "histogram trace carries every non-NA observation")
})

test_that("chart: boxplot-with-group emits one trace per group carrying that group's raw values", {
  df <- data.frame(col_y = c(1, 2, 3, 10, 11, 12), col_g = c("A", "A", "A", "B", "B", "B"))
  fixture <- write_fixture(df, list(chartType = "boxplot", xVar = "col_y", xVarName = "Y",
                                     groupVar = "col_g", groupVarName = "G"))
  result <- run_analysis_script("chart.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  traces <- result$plots[[1]]$data$data
  expect_equal(length(traces), 2L, label = "one boxplot trace per group")
  expect_equal(chr_list(list(traces[[1]]$name)), "A", label = "first trace is group A (sorted)")
  expect_equal(num_list(traces[[1]]$y), c(1, 2, 3), tolerance = 1e-9, "group A raw values")
  expect_equal(num_list(traces[[2]]$y), c(10, 11, 12), tolerance = 1e-9, "group B raw values")
})

test_that("chart: boxplot resolves group value labels", {
  df <- data.frame(col_y = c(1, 2, 3, 10, 11, 12), col_g = c(1, 1, 1, 2, 2, 2))
  fixture <- write_fixture(df, list(
    chartType = "boxplot", xVar = "col_y", xVarName = "Y",
    groupVar = "col_g", groupVarName = "G",
    groupValueLabels = list("1" = "Male", "2" = "Female")
  ))
  result <- run_analysis_script("chart.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  traces <- result$plots[[1]]$data$data
  expect_equal(chr_list(list(traces[[1]]$name)), "Male")
  expect_equal(chr_list(list(traces[[2]]$name)), "Female")
})

test_that("chart: boxplot title, axes and legend are all present and named", {
  df <- data.frame(col_y = c(1, 2, 3, 10, 11, 12), col_g = c("A", "A", "A", "B", "B", "B"))
  fixture <- write_fixture(df, list(chartType = "boxplot", xVar = "col_y", xVarName = "Score",
                                     groupVar = "col_g", groupVarName = "Group"))
  result <- run_analysis_script("chart.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  plot <- result$plots[[1]]
  expect_equal(plot$titleKey, "output.chart.boxplotTitle:Score", "title names the measured variable")
  expect_equal(plot$data$layout$yaxis$title$text, "Score", "y-axis names the measured variable")
  expect_equal(plot$data$layout$xaxis$title$text, "Group", "x-axis names the grouping variable")
  expect_true(isTRUE(plot$data$layout$showlegend), "legend is on by default")
})

test_that("chart: bar chart resolves category value labels", {
  df <- data.frame(col_x = c(1, 2, 1, 2, 1))
  fixture <- write_fixture(df, list(
    chartType = "bar", xVar = "col_x", xVarName = "Gender",
    xValueLabels = list("1" = "Male", "2" = "Female")
  ))
  result <- run_analysis_script("chart.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  tr <- result$plots[[1]]$data$data[[1]]
  expect_equal(chr_list(tr$x), c("Male", "Female"))
  expect_equal(num_list(tr$y), c(3, 2))
})

test_that("chart: P-P plot observed/expected cumulative probabilities match the normal-CDF formula", {
  set.seed(82)
  nv <- rnorm(50, 20, 5)
  df <- data.frame(col_x = nv)
  fixture <- write_fixture(df, list(chartType = "pp", xVar = "col_x", xVarName = "X"))
  result <- run_analysis_script("chart.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  tr <- result$plots[[1]]$data$data[[1]]
  ordv <- sort(nv); n <- length(nv)
  ref_observed <- (seq_len(n) - 0.5) / n
  ref_expected <- pnorm(ordv, mean = mean(nv), sd = sd(nv))
  expect_equal(num_list(tr$y), ref_observed, tolerance = 1e-9, "P-P observed cumulative probability")
  expect_equal(num_list(tr$x), ref_expected, tolerance = 1e-9, "P-P expected cumulative probability (normal CDF)")
})

test_that("chart: Q-Q plot theoretical quantiles match the normal-quantile formula", {
  set.seed(83)
  nv <- rnorm(50, 20, 5)
  df <- data.frame(col_x = nv)
  fixture <- write_fixture(df, list(chartType = "qq", xVar = "col_x", xVarName = "X"))
  result <- run_analysis_script("chart.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  tr <- result$plots[[1]]$data$data[[1]]
  ordv <- sort(nv); n <- length(nv)
  pp <- (seq_len(n) - 0.5) / n
  ref_theo <- qnorm(pp, mean = mean(nv), sd = sd(nv))
  expect_equal(num_list(tr$x), ref_theo, tolerance = 1e-9, "Q-Q theoretical quantiles")
  expect_equal(num_list(tr$y), ordv, tolerance = 1e-9, "Q-Q observed values (sorted)")
})

# ── Options sub-dialogs (each was sent by the dialog but ignored until 2026-10-19) ──

chart_run <- function(df, params) {
  result <- run_analysis_script("chart.R", write_fixture(df, params))
  expect_true(isTRUE(result$success), "result$success")
  result$plots[[1]]$data
}

test_that("chart options: scatter linear fit line is lm()'s line over the x range, R² in its name", {
  set.seed(11); df <- data.frame(col_x = rnorm(40)); df$col_y <- 2 + 3 * df$col_x + rnorm(40)
  fig <- chart_run(df, list(chartType = "scatter", xVar = "col_x", yVar = "col_y",
                            options = list(fitLine = "linear")))
  expect_equal(length(fig$data), 2L, label = "points + fit line")
  fit <- lm(col_y ~ col_x, df); xr <- range(df$col_x)
  expect_equal(num_list(fig$data[[2]]$x), xr, tolerance = 1e-9, "fit line spans the x range")
  expect_equal(num_list(fig$data[[2]]$y), unname(coef(fit)[1] + coef(fit)[2] * xr), tolerance = 1e-9, "fit line = lm")
  expect_true(grepl(sprintf("%.3f", summary(fit)$r.squared), fig$data[[2]]$name, fixed = TRUE), "R² in the legend")
  none <- chart_run(df, list(chartType = "scatter", xVar = "col_x", yVar = "col_y"))
  expect_equal(length(none$data), 1L, label = "no fit line by default")
})

test_that("chart options: bar percent, sort orders and value labels", {
  df <- data.frame(col_x = c("2", "10", "2", "1", "2", "10"))
  pct <- chart_run(df, list(chartType = "bar", xVar = "col_x",
                            options = list(represent = "percent", sortBy = "countAsc", showValues = TRUE)))
  tr <- pct$data[[1]]
  expect_equal(chr_list(tr$x), c("1", "10", "2"), label = "count ascending")
  expect_equal(num_list(tr$y), 100 * c(1, 2, 3) / 6, tolerance = 1e-9, "percent heights")
  expect_equal(chr_list(tr$text), c("16.7%", "33.3%", "50.0%"), label = "value labels")
  expect_equal(pct$layout$yaxis$title$text, "Percent")
  alpha <- chart_run(df, list(chartType = "bar", xVar = "col_x", options = list(sortBy = "alphabetical")))
  expect_equal(chr_list(alpha$data[[1]]$x), c("1", "2", "10"), label = "numeric codes in numeric order")
  expect_true(is.null(alpha$data[[1]]$text), "no value labels by default")
})

test_that("chart options: grouped line style and value sort", {
  df <- data.frame(col_y = c(10, 20, 30, 40, 50, 60), col_g = c("B", "B", "A", "A", "C", "A"))
  fig <- chart_run(df, list(chartType = "line", xVar = "col_y", groupVar = "col_g",
                            options = list(style = "markerOnly", sortBy = "valueDesc")))
  tr <- fig$data[[1]]
  ref <- sort(tapply(df$col_y, df$col_g, mean), decreasing = TRUE)
  expect_equal(chr_list(tr$x), names(ref), label = "groups by mean, descending")
  expect_equal(num_list(tr$y), as.numeric(ref), tolerance = 1e-9, "group means")
  expect_equal(tr$mode, "markers")
  only <- chart_run(df, list(chartType = "line", xVar = "col_y", options = list(style = "lineOnly")))
  expect_equal(only$data[[1]]$mode, "lines")
})

test_that("chart options: histogram custom bins and a count-scaled normal curve", {
  set.seed(5); v <- rnorm(80, 50, 10); df <- data.frame(col_x = v)
  fig <- chart_run(df, list(chartType = "histogram", xVar = "col_x",
                            options = list(binsMode = "custom", customBins = 7, normalCurve = TRUE)))
  bw <- diff(range(v)) / 7
  expect_equal(as.numeric(fig$data[[1]]$xbins$size), bw, tolerance = 1e-9, "7 equal bins over the range")
  curve <- fig$data[[2]]
  x <- num_list(curve$x); y <- num_list(curve$y)
  expect_equal(y, 80 * bw * dnorm(x, mean(v), sd(v)), tolerance = 1e-9, "n · width · density")
  auto <- chart_run(df, list(chartType = "histogram", xVar = "col_x", options = list(binsMode = "auto", customBins = 7)))
  expect_equal(as.numeric(auto$data[[1]]$xbins$size), diff(range(v)) / nclass.Sturges(v), tolerance = 1e-9, "auto ignores customBins")
  expect_equal(length(auto$data), 1L, label = "no curve by default")
})

test_that("chart options: detrended P-P and Q-Q are deviations from the normal reference", {
  set.seed(9); v <- rexp(30); df <- data.frame(col_x = v)
  n <- 30; o <- sort(v); p <- (seq_len(n) - 0.5) / n
  pp <- chart_run(df, list(chartType = "pp", xVar = "col_x", options = list(detrend = TRUE)))
  expect_equal(num_list(pp$data[[1]]$x), p, tolerance = 1e-9, "observed cum prob")
  expect_equal(num_list(pp$data[[1]]$y), p - pnorm(o, mean(v), sd(v)), tolerance = 1e-9, "P-P deviation")
  expect_equal(num_list(pp$data[[2]]$y), c(0, 0), label = "zero reference line")
  qq <- chart_run(df, list(chartType = "qq", xVar = "col_x", options = list(detrend = TRUE)))
  expect_equal(num_list(qq$data[[1]]$x), o, tolerance = 1e-9, "observed values")
  expect_equal(num_list(qq$data[[1]]$y), (o - mean(v)) / sd(v) - qnorm(p), tolerance = 1e-9, "Q-Q deviation")
})
