# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-survival.R — validates r-scripts/survival-cox.R and r-scripts/survival-km.R
# against independent references computed directly with the survival package
# (coxph / survfit / survdiff), not via the scripts' own code.

suppressPackageStartupMessages(library(survival))

test_that("cox regression matches coxph() reference (two covariates)", {
  set.seed(42)
  n <- 120
  df <- data.frame(
    col_1 = round(rexp(n, rate = 0.05) + 1, 2),          # time
    col_2 = ifelse(runif(n) < 0.6, "1", "0"),             # status ("1" = event)
    col_3 = round(rnorm(n, mean = 55, sd = 10), 1),       # age
    col_4 = round(rnorm(n, mean = 100, sd = 25), 1)       # dose
  )
  fixture <- write_fixture(df, list(
    timeVar = "col_1", timeName = "time",
    statusVar = "col_2", statusName = "status",
    eventValue = "1",
    covariates = list("col_3", "col_4"),
    varNames = list(col_3 = "age", col_4 = "dose")
  ))
  result <- run_analysis_script("survival-cox.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- coxph(Surv(df$col_1, as.integer(df$col_2 == "1")) ~ df$col_3 + df$col_4)
  sm <- summary(ref)

  omni <- find_table(result, "output.cox.omnibusTitle")
  # row 1: -2LL, LR chi-square, df, Sig.
  expect_equal(cell_num(omni, 1, 1), -2 * ref$loglik[2], tolerance = 1e-3, "-2 log likelihood")
  expect_equal(cell_num(omni, 1, 2), unname(sm$logtest["test"]), tolerance = 1e-3, "LR chi-square")
  expect_equal(cell_num(omni, 1, 3), unname(sm$logtest["df"]), tolerance = 1e-9, "LR df")
  expect_equal(cell_num(omni, 1, 4), unname(sm$logtest["pvalue"]), tolerance = 1e-4, "LR p-value")

  eq <- find_table(result, "output.cox.equationTitle")
  # rows: name, B, SE, Wald, df, Sig., Exp(B), lower .95, upper .95
  for (i in 1:2) {
    b <- sm$coefficients[i, "coef"]; se <- sm$coefficients[i, "se(coef)"]
    # script rounds B/SE to 6 decimals — compare against the rounded reference
    expect_equal(cell_num(eq, i, 2), round(b, 6), tolerance = 1e-6, sprintf("B[%d]", i))
    expect_equal(cell_num(eq, i, 3), round(se, 6), tolerance = 1e-6, sprintf("SE[%d]", i))
    # script rounds Wald to 3 decimals — compare against the rounded reference
    expect_equal(cell_num(eq, i, 4), round((b / se)^2, 3), tolerance = 1e-6, sprintf("Wald[%d]", i))
    expect_equal(cell_num(eq, i, 6), sm$coefficients[i, "Pr(>|z|)"], tolerance = 1e-4, sprintf("Sig[%d]", i))
    expect_equal(cell_num(eq, i, 7), sm$conf.int[i, "exp(coef)"], tolerance = 1e-3, sprintf("Exp(B)[%d]", i))
    expect_equal(cell_num(eq, i, 8), sm$conf.int[i, "lower .95"], tolerance = 1e-3, sprintf("CI lower[%d]", i))
    expect_equal(cell_num(eq, i, 9), sm$conf.int[i, "upper .95"], tolerance = 1e-3, sprintf("CI upper[%d]", i))
  }
})

test_that("cox regression: strong covariate effect is detected (sign sanity)", {
  set.seed(7)
  n <- 200
  x <- rnorm(n)
  df <- data.frame(
    col_1 = round(rexp(n, rate = exp(-1.5 * x) * 0.1) + 0.5, 2),
    col_2 = "1",
    col_3 = round(x, 3)
  )
  fixture <- write_fixture(df, list(
    timeVar = "col_1", statusVar = "col_2", eventValue = "1",
    covariates = list("col_3"), varNames = list(col_3 = "x")
  ))
  result <- run_analysis_script("survival-cox.R", fixture)
  ref <- coxph(Surv(df$col_1, rep(1L, n)) ~ df$col_3)
  eq <- find_table(result, "output.cox.equationTitle")
  expect_equal(cell_num(eq, 1, 2), unname(coef(ref)), tolerance = 1e-4, "B sanity")
  expect_lt(cell_num(eq, 1, 6), 0.05, "p < 0.05 for strong effect")
  # rate = exp(-1.5 * x): higher x means longer survival, i.e. lower hazard
  expect_true(cell_num(eq, 1, 2) < 0, "negative coefficient for hazard-decreasing x")
})

test_that("KM grouped matches survfit()/survdiff() reference", {
  set.seed(123)
  df <- data.frame(
    col_1 = round(c(rexp(40, 0.08), rexp(40, 0.04)) + 1, 2),   # time
    col_2 = c(ifelse(runif(40) < 0.7, "1", "0"),
              ifelse(runif(40) < 0.5, "1", "0")),              # status
    col_3 = rep(c("A", "B"), each = 40)                        # group
  )
  fixture <- write_fixture(df, list(
    timeVar = "col_1", timeName = "time",
    statusVar = "col_2", statusName = "status",
    eventValue = "1",
    factor = "col_3", factorName = "group"
  ))
  result <- run_analysis_script("survival-km.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  time <- df$col_1; status <- as.integer(df$col_2 == "1"); grp <- factor(df$col_3)
  ref_fit <- survfit(Surv(time, status) ~ grp)
  ref_tab <- summary(ref_fit)$table

  cps <- find_table(result, "output.survival.cpsTitle")
  # rows: A, B, total — cols: group, nTotal, nEvents, nCensored, pctCensored
  for (i in 1:2) {
    lvl <- levels(grp)[i]; idx <- grp == lvl
    expect_equal(cell_num(cps, i, 2), sum(idx), tolerance = 1e-9, sprintf("nTotal[%s]", lvl))
    expect_equal(cell_num(cps, i, 3), sum(status[idx]), tolerance = 1e-9, sprintf("nEvents[%s]", lvl))
    expect_equal(cell_num(cps, i, 4), sum(idx) - sum(status[idx]), tolerance = 1e-9, sprintf("nCensored[%s]", lvl))
    expect_equal(cell_num(cps, i, 5), 100 * (sum(idx) - sum(status[idx])) / sum(idx),
                 tolerance = 1e-2, sprintf("pctCensored[%s]", lvl))
    # Means and Medians table: group | mean, SE, CI lo, CI hi | median, CI lo, CI hi
    expect_equal(cell_num(find_table(result, "output.survival.medianTitle"), i, 6),
                 ref_tab[i, "median"], tolerance = 1e-3, sprintf("median[%s]", lvl))
    rm_ref <- summary(ref_fit, rmean = "individual")$table
    rm_col <- grep("rmean", colnames(rm_ref), fixed = TRUE)
    expect_equal(cell_num(find_table(result, "output.survival.medianTitle"), i, 2),
                 unname(rm_ref[i, rm_col[1]]), tolerance = 1e-3, sprintf("restricted mean[%s]", lvl))
  }
  expect_equal(cell_num(cps, 3, 2), length(time), tolerance = 1e-9, "total N")
  expect_equal(cell_num(cps, 3, 3), sum(status), tolerance = 1e-9, "total events")

  sd_ref <- survdiff(Surv(time, status) ~ grp)
  lr <- find_table(result, "output.survival.logrankTitle")
  # row: statistic label, chi-square, df, Sig.
  expect_equal(cell_num(lr, 1, 2), sd_ref$chisq, tolerance = 1e-3, "log-rank chi-square")
  expect_equal(cell_num(lr, 1, 3), length(sd_ref$n) - 1, tolerance = 1e-9, "log-rank df")
  expect_equal(cell_num(lr, 1, 4), pchisq(sd_ref$chisq, length(sd_ref$n) - 1, lower.tail = FALSE),
               tolerance = 1e-4, "log-rank p-value")
})

test_that("KM ungrouped: no log-rank table, median matches survfit()", {
  set.seed(99)
  n <- 60
  df <- data.frame(
    col_1 = round(rexp(n, 0.1) + 1, 2),
    col_2 = ifelse(runif(n) < 0.65, "1", "0")
  )
  fixture <- write_fixture(df, list(
    timeVar = "col_1", statusVar = "col_2", eventValue = "1"
  ))
  result <- run_analysis_script("survival-km.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  # Without a factor there is no group comparison, so only 2 tables exist.
  expect_equal(length(result$tables), 2, tolerance = 0, "table count (no log-rank)")

  status <- as.integer(df$col_2 == "1")
  ref <- survfit(Surv(df$col_1, status) ~ 1)
  ref_med <- unname(summary(ref)$table["median"])

  cps <- find_table(result, "output.survival.cpsTitle")
  expect_equal(cell_num(cps, 1, 2), n, tolerance = 1e-9, "nTotal")
  expect_equal(cell_num(cps, 1, 3), sum(status), tolerance = 1e-9, "nEvents")

  med <- find_table(result, "output.survival.medianTitle")
  expect_equal(cell_num(med, 1, 6), ref_med, tolerance = 1e-3, "overall median")

  # KM curve starts at (0, 1) and ends at the final survival probability.
  trace <- result$plots[[1]]$data$data[[1]]
  expect_equal(trace$x[[1]], 0, tolerance = 1e-9, "curve starts at t=0")
  expect_equal(trace$y[[1]], 1, tolerance = 1e-9, "curve starts at S=1")
  expect_equal(trace$y[[length(trace$y)]], tail(summary(ref)$surv, 1),
               tolerance = 1e-9, "curve final survival")
})

# ── Compare Factor: the weighted log-rank family (SPSS's three tests) ─────────

test_that("stratified log-rank matches survdiff(~ grp + strata(s))", {
  set.seed(2026)
  n <- 160
  grp <- rep(c("A", "B"), each = n / 2)
  st  <- rep(c("s1", "s2"), times = n / 2)
  base <- ifelse(st == "s1", 0.05, 0.12)
  df <- data.frame(
    col_1 = round(rexp(n, rate = base * ifelse(grp == "B", 1.8, 1)) + 0.5, 3),
    col_2 = ifelse(runif(n) < 0.75, "1", "0"),
    col_3 = grp,
    col_4 = st
  )
  fixture <- write_fixture(df, list(
    timeVar = "col_1", statusVar = "col_2", eventValue = "1",
    factor = "col_3", factorName = "grp", strata = "col_4", strataName = "site",
    options = list(compare = list(logRank = TRUE, mode = "pooled"))
  ))
  result <- run_analysis_script("survival-km.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  time <- df$col_1; status <- as.integer(df$col_2 == "1")
  ref <- survdiff(Surv(time, status) ~ df$col_3 + strata(df$col_4))
  lr <- find_table(result, "output.survival.logrankTitle")
  # The script rounds the statistic to 3 decimals for display, so the
  # reference is rounded the same way before comparing.
  expect_equal(cell_num(lr, 1, 2), round(ref$chisq, 3), tolerance = 1e-6,
               "stratified chi-square")
  expect_equal(cell_num(lr, 1, 3), 1, tolerance = 1e-9, "stratified df")
})

test_that("Breslow / Tarone-Ware are rank tests: invariant under a monotone time transform", {
  set.seed(11)
  n <- 120
  df <- data.frame(
    col_1 = round(c(rexp(n / 2, 0.10), rexp(n / 2, 0.05)) + 1, 4),
    col_2 = ifelse(runif(n) < 0.8, "1", "0"),
    col_3 = rep(c("A", "B"), each = n / 2)
  )
  run <- function(times) {
    d <- df; d$col_1 <- times
    fx <- write_fixture(d, list(
      timeVar = "col_1", statusVar = "col_2", eventValue = "1",
      factor = "col_3", factorName = "grp",
      options = list(compare = list(logRank = TRUE, breslow = TRUE, taroneWare = TRUE,
                                    mode = "pooled"))))
    find_table(run_analysis_script("survival-km.R", fx), "output.survival.logrankTitle")
  }
  a <- run(df$col_1)
  # log(1 + t) is strictly increasing, so every risk set — and therefore every
  # weight and every score — is unchanged. A statistic that moved here would be
  # reading the times themselves instead of the risk sets.
  b <- run(round(log1p(df$col_1), 6))
  for (i in 1:3) {
    expect_equal(cell_num(a, i, 2), cell_num(b, i, 2), tolerance = 1e-6,
                 sprintf("row %d chi-square invariant under log1p(t)", i))
    expect_equal(cell_num(a, i, 3), 1, tolerance = 1e-9, sprintf("row %d df", i))
  }
  # The three weightings must actually differ — an implementation that ignored
  # the weight would print the same number three times.
  expect_true(abs(cell_num(a, 1, 2) - cell_num(a, 2, 2)) > 1e-6, "log-rank != Breslow")
  expect_true(abs(cell_num(a, 2, 2) - cell_num(a, 3, 2)) > 1e-6, "Breslow != Tarone-Ware")
})

test_that("pairwise comparisons match survdiff() on each pair", {
  set.seed(5)
  n <- 150
  grp <- rep(c("A", "B", "C"), each = 50)
  hr <- c(A = 1, B = 1.6, C = 2.6)[grp]
  df <- data.frame(
    col_1 = round(rexp(n, rate = 0.05 * hr) + 0.5, 3),
    col_2 = ifelse(runif(n) < 0.8, "1", "0"),
    col_3 = grp
  )
  fixture <- write_fixture(df, list(
    timeVar = "col_1", statusVar = "col_2", eventValue = "1",
    factor = "col_3", factorName = "grp",
    options = list(compare = list(logRank = TRUE, mode = "pairwise"))
  ))
  result <- run_analysis_script("survival-km.R", fixture)
  pw <- find_table(result, "output.survival.pairwiseTitle")
  time <- df$col_1; status <- as.integer(df$col_2 == "1")
  pairs <- list(c("A", "B"), c("A", "C"), c("B", "C"))
  expect_equal(length(pw$rows), 3, tolerance = 0, "one row per pair")
  for (i in seq_along(pairs)) {
    sel <- df$col_3 %in% pairs[[i]]
    ref <- survdiff(Surv(time[sel], status[sel]) ~ droplevels(factor(df$col_3[sel])))
    expect_equal(cell_num(pw, i, 4), round(ref$chisq, 3), tolerance = 1e-6,
                 sprintf("pairwise chi-square %s-%s", pairs[[i]][1], pairs[[i]][2]))
    expect_equal(cell_num(pw, i, 5), 1, tolerance = 1e-9, "pairwise df")
  }
})

test_that("KM options: quartiles, survival table and the four plot types", {
  set.seed(77)
  n <- 80
  df <- data.frame(
    col_1 = round(rexp(n, 0.08) + 1, 3),
    col_2 = ifelse(runif(n) < 0.85, "1", "0")
  )
  fixture <- write_fixture(df, list(
    timeVar = "col_1", timeName = "time", statusVar = "col_2", eventValue = "1",
    options = list(stats = list(meanMedian = TRUE, quartiles = TRUE, survivalTable = TRUE),
                   plots = list(survival = TRUE, oneMinusSurvival = TRUE,
                                hazard = TRUE, logSurvival = TRUE))
  ))
  result <- run_analysis_script("survival-km.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  time <- df$col_1; status <- as.integer(df$col_2 == "1")
  ref <- survfit(Surv(time, status) ~ 1)
  s <- ref$surv; tt <- ref$time
  q <- function(p) tt[which(s <= 1 - p)[1]]

  perc <- find_table(result, "output.survival.percentilesTitle")
  expect_equal(cell_num(perc, 1, 2), q(0.25), tolerance = 1e-3, "25th percentile")
  expect_equal(cell_num(perc, 1, 5), q(0.50), tolerance = 1e-3, "50th percentile")
  expect_equal(cell_num(perc, 1, 8), q(0.75), tolerance = 1e-3, "75th percentile")
  # The 50% column of Percentiles and the Median column must be the same number.
  expect_equal(cell_num(perc, 1, 5),
               cell_num(find_table(result, "output.survival.medianTitle"), 1, 6),
               tolerance = 1e-9, "percentile 50 == median")

  tab <- find_table(result, "output.survival.tableTitle")
  expect_equal(length(tab$rows), n, tolerance = 0, "one survival-table row per case")
  # Last row: everyone has left the risk set and the cumulative event count is
  # the total number of events.
  expect_equal(cell_num(tab, n, 7), sum(status), tolerance = 1e-9, "cumulative events")
  expect_equal(cell_num(tab, n, 8), 0, tolerance = 1e-9, "remaining cases")

  expect_equal(length(result$plots), 4, tolerance = 0, "four plots requested")
  surv_y <- result$plots[[1]]$data$data[[1]]$y
  one_minus_y <- result$plots[[2]]$data$data[[1]]$y
  for (i in seq_along(surv_y)) {
    expect_equal(as.numeric(one_minus_y[[i]]), 1 - as.numeric(surv_y[[i]]),
                 tolerance = 1e-9, sprintf("1-S at point %d", i))
  }
})

# ── Cox: categorical covariates and contrast coding ──────────────────────────

.cox_cat_fixture <- function(seed = 314, n = 180) {
  set.seed(seed)
  g <- rep(c("low", "mid", "high"), length.out = n)
  hr <- c(low = 1, mid = 1.7, high = 3.1)[g]
  data.frame(
    col_1 = round(rexp(n, rate = 0.05 * hr) + 0.4, 3),
    col_2 = ifelse(runif(n) < 0.85, "1", "0"),
    col_3 = g,
    col_4 = round(rnorm(n, 50, 8), 2)
  )
}

test_that("cox indicator contrast matches coxph() with contr.treatment(base = last)", {
  df <- .cox_cat_fixture()
  fixture <- write_fixture(df, list(
    timeVar = "col_1", statusVar = "col_2", eventValue = "1",
    covariates = list("col_3", "col_4"),
    varNames = list(col_3 = "grade", col_4 = "age"),
    categorical = list(col_3 = list(contrast = "indicator", reference = "last"))
  ))
  result <- run_analysis_script("survival-cox.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  f <- factor(df$col_3)
  contrasts(f) <- contr.treatment(nlevels(f), base = nlevels(f))
  ref <- coxph(Surv(df$col_1, as.integer(df$col_2 == "1")) ~ f + df$col_4)
  b <- unname(coef(ref)); se <- unname(sqrt(diag(vcov(ref))))

  eq <- find_table(result, "output.cox.equationTitle")
  # rows: grade (header), grade(1), grade(2), age
  expect_equal(length(eq$rows), 4, tolerance = 0, "header + 2 contrasts + 1 scale covariate")
  for (i in 1:2) {
    expect_equal(cell_num(eq, i + 1, 2), round(b[i], 6), tolerance = 1e-6, sprintf("B grade(%d)", i))
    expect_equal(cell_num(eq, i + 1, 3), round(se[i], 6), tolerance = 1e-6, sprintf("SE grade(%d)", i))
  }
  expect_equal(cell_num(eq, 4, 2), round(b[3], 6), tolerance = 1e-6, "B age")

  # Header row carries the multi-df Wald for the whole variable.
  idx <- 1:2
  w <- as.numeric(t(b[idx]) %*% solve(vcov(ref)[idx, idx]) %*% b[idx])
  expect_equal(cell_num(eq, 1, 4), round(w, 3), tolerance = 1e-3, "overall Wald for grade")
  expect_equal(cell_num(eq, 1, 5), 2, tolerance = 1e-9, "overall Wald df")
})

test_that("cox deviation and polynomial codings match contr.sum / contr.poly", {
  df <- .cox_cat_fixture()
  y <- Surv(df$col_1, as.integer(df$col_2 == "1"))
  for (case in list(list(name = "deviation", R = contr.sum(3)),
                    list(name = "polynomial", R = contr.poly(3)))) {
    fixture <- write_fixture(df, list(
      timeVar = "col_1", statusVar = "col_2", eventValue = "1",
      covariates = list("col_3"), varNames = list(col_3 = "grade"),
      categorical = list(col_3 = list(contrast = case$name, reference = "last"))
    ))
    eq <- find_table(run_analysis_script("survival-cox.R", fixture),
                     "output.cox.equationTitle")
    f <- factor(df$col_3)
    contrasts(f) <- case$R
    ref <- coxph(y ~ f)
    b <- unname(coef(ref))
    for (i in 1:2) {
      expect_equal(cell_num(eq, i + 1, 2), round(b[i], 6), tolerance = 1e-6,
                   sprintf("%s B(%d)", case$name, i))
    }
  }
})

test_that("cox: the coding changes the coefficients but not the fitted model", {
  df <- .cox_cat_fixture()
  codings <- c("indicator", "simple", "deviation", "difference", "helmert",
               "repeated", "polynomial")
  got <- lapply(codings, function(ct) {
    fixture <- write_fixture(df, list(
      timeVar = "col_1", statusVar = "col_2", eventValue = "1",
      covariates = list("col_3"), varNames = list(col_3 = "grade"),
      categorical = list(col_3 = list(contrast = ct, reference = "last"))
    ))
    r <- run_analysis_script("survival-cox.R", fixture)
    list(omni = find_table(r, "output.cox.omnibusTitle"),
         eq = find_table(r, "output.cox.equationTitle"))
  })
  # A contrast is a reparametrisation: the partial likelihood, the LR test and
  # the variable's multi-df Wald are the SAME model seen from another angle.
  # This is the invariant that catches a coding matrix which is not full rank
  # or does not span the contrast space — the failure mode where every
  # individual coefficient still looks plausible.
  for (i in seq_along(codings)) {
    expect_equal(cell_num(got[[i]]$omni, 1, 1), cell_num(got[[1]]$omni, 1, 1),
                 tolerance = 1e-4, sprintf("-2LL invariant (%s)", codings[i]))
    expect_equal(cell_num(got[[i]]$omni, 1, 2), cell_num(got[[1]]$omni, 1, 2),
                 tolerance = 1e-4, sprintf("LR chi-square invariant (%s)", codings[i]))
    expect_equal(cell_num(got[[i]]$eq, 1, 4), cell_num(got[[1]]$eq, 1, 4),
                 tolerance = 1e-2, sprintf("overall Wald invariant (%s)", codings[i]))
  }
  # …and the codings really are different parametrisations, not aliases —
  # with ONE genuine exception. Simple coding is indicator coding shifted by a
  # constant (indicator - 1/k), and the shift only moves the intercept. A Cox
  # model has no intercept: the constant cancels inside every risk set, so
  # simple and indicator fit the same coefficients exactly. Six distinct
  # values from seven codings is the correct answer here, not a collision.
  names(got) <- codings
  b_first <- vapply(got, function(g) cell_num(g$eq, 2, 2), numeric(1))
  expect_equal(unname(b_first["simple"]), unname(b_first["indicator"]), tolerance = 1e-9,
               "simple == indicator in an intercept-free model")
  expect_equal(length(unique(round(b_first, 6))), length(codings) - 1L, tolerance = 0,
               "the other codings are all distinct")
})

test_that("cox: simple / difference / repeated / helmert express their own comparisons", {
  df <- .cox_cat_fixture()
  y <- Surv(df$col_1, as.integer(df$col_2 == "1"))
  f <- factor(df$col_3)                       # levels sort to: high, low, mid
  # Each level's linear-predictor offset from the LAST level, from a plain
  # indicator fit — the quantities every other coding is a linear map of.
  contrasts(f) <- contr.treatment(3, base = 3)
  mu <- c(unname(coef(coxph(y ~ f))), 0)      # (lv1-lv3, lv2-lv3, 0)

  run_ct <- function(ct) {
    fx <- write_fixture(df, list(
      timeVar = "col_1", statusVar = "col_2", eventValue = "1",
      covariates = list("col_3"), varNames = list(col_3 = "grade"),
      categorical = list(col_3 = list(contrast = ct, reference = "last"))))
    eq <- find_table(run_analysis_script("survival-cox.R", fx), "output.cox.equationTitle")
    c(cell_num(eq, 2, 2), cell_num(eq, 3, 2))
  }
  # Simple: b_j = mu_j - mu_reference (reference = last level).
  expect_equal(run_ct("simple"), round(mu[1:2], 6), tolerance = 1e-5,
               "simple = each level vs reference")
  # Difference (reverse Helmert): b_i = mu_{i+1} - mean(mu_1..mu_i).
  expect_equal(run_ct("difference"),
               round(c(mu[2] - mu[1], mu[3] - mean(mu[1:2])), 6),
               tolerance = 1e-5, "difference = level vs mean of previous")
  # Repeated: b_i = mu_i - mu_{i+1}.
  expect_equal(run_ct("repeated"), round(c(mu[1] - mu[2], mu[2] - mu[3]), 6),
               tolerance = 1e-5, "repeated = adjacent categories")
  # Helmert: b_i = mu_i - mean(mu_{i+1}..mu_k).
  expect_equal(run_ct("helmert"), round(c(mu[1] - mean(mu[2:3]), mu[2] - mu[3]), 6),
               tolerance = 1e-5, "helmert = level vs mean of subsequent")
})

# ── Cox: strata, options, plots and the PH assumption ────────────────────────

test_that("cox strata matches coxph(~ x + strata(s)); CI level is honoured", {
  set.seed(808)
  n <- 200
  site <- rep(c("s1", "s2"), each = n / 2)
  x <- rnorm(n)
  df <- data.frame(
    col_1 = round(rexp(n, rate = ifelse(site == "s1", 0.04, 0.11) * exp(0.7 * x)) + 0.3, 3),
    col_2 = ifelse(runif(n) < 0.85, "1", "0"),
    col_3 = round(x, 4),
    col_4 = site
  )
  fixture <- write_fixture(df, list(
    timeVar = "col_1", statusVar = "col_2", eventValue = "1",
    covariates = list("col_3"), varNames = list(col_3 = "x"),
    strata = "col_4", strataName = "site",
    options = list(ciExpB = TRUE, ciLevel = 90, phTest = TRUE, correlation = TRUE)
  ))
  result <- run_analysis_script("survival-cox.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- coxph(Surv(df$col_1, as.integer(df$col_2 == "1")) ~ df$col_3 + strata(df$col_4))
  b <- unname(coef(ref)); se <- unname(sqrt(diag(vcov(ref))))
  eq <- find_table(result, "output.cox.equationTitle")
  expect_equal(cell_num(eq, 1, 2), round(b, 6), tolerance = 1e-6, "stratified B")
  # 90% limits use z = 1.6449, not 1.96 — the wrong z would land several
  # percent out, which is exactly the kind of error nobody notices by eye.
  z <- qnorm(0.95)
  expect_equal(cell_num(eq, 1, 8), round(exp(b - z * se), 3), tolerance = 1e-3, "Exp(B) 90% lower")
  expect_equal(cell_num(eq, 1, 9), round(exp(b + z * se), 3), tolerance = 1e-3, "Exp(B) 90% upper")

  ph <- find_table(result, "output.cox.phTestTitle")
  ref_zph <- cox.zph(ref)
  expect_equal(cell_num(ph, 1, 2), round(ref_zph$table[1, "chisq"], 3), tolerance = 1e-3,
               "cox.zph chi-square")
  expect_equal(cell_num(ph, nrow(ref_zph$table), 4),
               round(ref_zph$table[nrow(ref_zph$table), "p"], 6), tolerance = 1e-4,
               "cox.zph global p")

  corr <- find_table(result, "output.cox.correlationTitle")
  expect_equal(cell_num(corr, 1, 2), 1, tolerance = 1e-9, "correlation diagonal")
})

test_that("cox baseline table matches survfit(fit) at the covariate reference point", {
  df <- .cox_cat_fixture(seed = 4242, n = 120)
  fixture <- write_fixture(df, list(
    timeVar = "col_1", statusVar = "col_2", eventValue = "1",
    covariates = list("col_4"), varNames = list(col_4 = "age"),
    options = list(baseline = TRUE)
  ))
  result <- run_analysis_script("survival-cox.R", fixture)
  base <- find_table(result, "output.cox.baselineTitle")

  d <- data.frame(x = df$col_4)
  ref_fit <- coxph(Surv(df$col_1, as.integer(df$col_2 == "1")) ~ x, data = d)
  sf <- survfit(ref_fit, newdata = data.frame(x = mean(d$x)))
  expect_equal(length(base$rows), length(sf$time), tolerance = 0, "one row per event/censor time")
  expect_equal(cell_num(base, 1, 1), sf$time[1], tolerance = 1e-6, "first time")
  expect_equal(cell_num(base, 1, 3), as.numeric(sf$surv)[1], tolerance = 1e-6, "survival at mean")
  # Cumulative hazard column is -log S, and the SE column is on the SURVIVAL
  # scale (S x se(cumhaz)), not the cumulative-hazard scale survfit stores.
  expect_equal(cell_num(base, 1, 2), -log(as.numeric(sf$surv)[1]), tolerance = 1e-6, "cum hazard")
  expect_equal(cell_num(base, 1, 4), as.numeric(sf$surv)[1] * as.numeric(sf$std.err)[1],
               tolerance = 1e-6, "SE of survival")
})

test_that("cox forward stepwise keeps only the covariate that matters", {
  set.seed(31337)
  n <- 260
  x1 <- rnorm(n); x2 <- rnorm(n); x3 <- rnorm(n)
  df <- data.frame(
    col_1 = round(rexp(n, rate = 0.05 * exp(1.1 * x1)) + 0.3, 3),
    col_2 = ifelse(runif(n) < 0.9, "1", "0"),
    col_3 = round(x1, 4), col_4 = round(x2, 4), col_5 = round(x3, 4)
  )
  fixture <- write_fixture(df, list(
    timeVar = "col_1", statusVar = "col_2", eventValue = "1",
    covariates = list("col_3", "col_4", "col_5"),
    varNames = list(col_3 = "signal", col_4 = "noise1", col_5 = "noise2"),
    method = "forwardLR",
    options = list(entry = 0.05, removal = 0.10, display = "each")
  ))
  result <- run_analysis_script("survival-cox.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  eq <- find_table(result, "output.cox.equationTitle")
  expect_equal(length(eq$rows), 1, tolerance = 0, "only one term survives selection")
  expect_true(identical(eq$rows[[1]][[1]], "signal"), "the surviving term is the real signal")

  ref <- coxph(Surv(df$col_1, as.integer(df$col_2 == "1")) ~ df$col_3)
  expect_equal(cell_num(eq, 1, 2), round(unname(coef(ref)), 6), tolerance = 1e-6,
               "final model B matches the single-covariate fit")

  steps <- find_table(result, "output.cox.stepsTitle")
  expect_equal(length(steps$rows), 1, tolerance = 0, "one entry step")
  # Entry statistic is the partial-likelihood ratio against the null model.
  expect_equal(cell_num(steps, 1, 4), round(2 * (ref$loglik[2] - ref$loglik[1]), 3),
               tolerance = 1e-3, "entry LR chi-square")

  notin <- find_table(result, "output.cox.notInEquationTitle")
  expect_equal(length(notin$rows), 2, tolerance = 0, "both noise terms listed as excluded")
})

test_that("cox plots: separate lines per category, at the covariate reference point", {
  df <- .cox_cat_fixture(seed = 91, n = 150)
  fixture <- write_fixture(df, list(
    timeVar = "col_1", timeName = "time", statusVar = "col_2", eventValue = "1",
    covariates = list("col_3", "col_4"),
    varNames = list(col_3 = "grade", col_4 = "age"),
    categorical = list(col_3 = list(contrast = "indicator", reference = "last")),
    plots = list(survival = TRUE, logMinusLog = TRUE, separateBy = "col_3")
  ))
  result <- run_analysis_script("survival-cox.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  expect_equal(length(result$plots), 2, tolerance = 0, "two plot types requested")

  surv_traces <- result$plots[[1]]$data$data
  expect_equal(length(surv_traces), 3, tolerance = 0, "one line per category of grade")

  # The log-minus-log plot is log(-log(S)) of the same curve, point for point —
  # the transform SPSS offers for eyeballing proportional hazards.
  s <- as.numeric(unlist(surv_traces[[1]]$y))
  lml <- as.numeric(unlist(result$plots[[2]]$data$data[[1]]$y))
  keep <- s > 0 & s < 1
  expect_equal(lml, log(-log(s[keep])), tolerance = 1e-9, "log-minus-log transform")

  # Curves must be ordered by hazard: the fixture's "low" group has the
  # smallest hazard, so its survival sits above the others at every time.
  named <- setNames(lapply(surv_traces, function(tr) as.numeric(unlist(tr$y))),
                    vapply(surv_traces, function(tr) tr$name, character(1)))
  expect_true(all(named[["low"]] >= named[["high"]] - 1e-12),
              "low-hazard category survives above the high-hazard one")
})

test_that("KM 'for each stratum' reports one comparison per stratum", {
  set.seed(606)
  n <- 200
  grp <- rep(c("A", "B"), each = n / 2)
  st  <- rep(c("s1", "s2"), times = n / 2)
  df <- data.frame(
    col_1 = round(rexp(n, rate = 0.06 * ifelse(grp == "B", 1.9, 1)) + 0.4, 3),
    col_2 = ifelse(runif(n) < 0.8, "1", "0"),
    col_3 = grp, col_4 = st
  )
  fixture <- write_fixture(df, list(
    timeVar = "col_1", statusVar = "col_2", eventValue = "1",
    factor = "col_3", factorName = "grp", strata = "col_4", strataName = "site",
    options = list(compare = list(logRank = TRUE, mode = "perStratum"))
  ))
  result <- run_analysis_script("survival-km.R", fixture)
  per <- find_table(result, "output.survival.logrankPerStratumTitle")
  expect_equal(length(per$rows), 2, tolerance = 0, "one row per stratum")

  time <- df$col_1; status <- as.integer(df$col_2 == "1")
  for (i in seq_along(c("s1", "s2"))) {
    sel <- df$col_4 == c("s1", "s2")[i]
    ref <- survdiff(Surv(time[sel], status[sel]) ~ droplevels(factor(df$col_3[sel])))
    # cols: stratum | statistic | chi-square | df | Sig.
    expect_equal(cell_num(per, i, 3), round(ref$chisq, 3), tolerance = 1e-6,
                 sprintf("within-stratum chi-square (%s)", c("s1", "s2")[i]))
  }
})

test_that("cox backward stepwise drops the noise, by either removal criterion", {
  set.seed(31337)
  n <- 260
  x1 <- rnorm(n); x2 <- rnorm(n); x3 <- rnorm(n)
  df <- data.frame(
    col_1 = round(rexp(n, rate = 0.05 * exp(1.1 * x1)) + 0.3, 3),
    col_2 = ifelse(runif(n) < 0.9, "1", "0"),
    col_3 = round(x1, 4), col_4 = round(x2, 4), col_5 = round(x3, 4)
  )
  for (m in c("backwardLR", "backwardWald")) {
    fixture <- write_fixture(df, list(
      timeVar = "col_1", statusVar = "col_2", eventValue = "1",
      covariates = list("col_3", "col_4", "col_5"),
      varNames = list(col_3 = "signal", col_4 = "noise1", col_5 = "noise2"),
      method = m, options = list(entry = 0.05, removal = 0.10)
    ))
    eq <- find_table(run_analysis_script("survival-cox.R", fixture),
                     "output.cox.equationTitle")
    expect_equal(length(eq$rows), 1, tolerance = 0, sprintf("%s: one term left", m))
    expect_true(identical(eq$rows[[1]][[1]], "signal"), sprintf("%s: keeps the signal", m))
  }
})

# ── New variables from an analysis (NV1, roadmap ★11) ─────────────────────────
# The class of bug these guard against is silent: the tables stay correct while
# the created column lands on the wrong cases. So the assertions are about
# ALIGNMENT first and arithmetic second.

test_that("cox new variables carry the dataset row of every value", {
  set.seed(4242)
  n <- 120
  x <- rnorm(n)
  df <- data.frame(
    col_1 = round(rexp(n, rate = 0.05 * exp(0.8 * x)) + 0.3, 3),
    col_2 = ifelse(runif(n) < 0.85, "1", "0"),
    col_3 = round(x, 4)
  )
  # Punch holes in the covariate: these rows are dropped by listwise deletion,
  # so a correct implementation must skip exactly their row indices.
  holes <- c(3L, 17L, 88L)
  df$col_3[holes] <- NA_real_
  df[["__row_idx"]] <- seq_len(n) - 1L

  fixture <- write_fixture(df, list(
    timeVar = "col_1", statusVar = "col_2", eventValue = "1",
    covariates = list("col_3"), varNames = list(col_3 = "x"),
    createVars = list(survival = "sur", hazard = "haz", lml = "lml", xbeta = "xb")
  ))
  result <- run_analysis_script("survival-cox.R", fixture)

  expect_equal(length(result$caseVars), 4, tolerance = 0, "four columns requested, four returned")
  by_name <- setNames(result$caseVars, vapply(result$caseVars, function(c) c$name, character(1)))
  expect_true(all(c("sur", "haz", "lml", "xb") %in% names(by_name)), "names are the user's")

  sur <- by_name[["sur"]]
  idx <- unlist(sur$rowIndex)
  expect_equal(length(idx), n - length(holes), tolerance = 0, "one value per COMPLETE case")
  expect_true(!any((holes - 1L) %in% idx), "rows dropped by listwise deletion get no value")
  expect_true(all(idx == setdiff(seq_len(n) - 1L, holes - 1L)), "indices are the surviving rows")
  expect_true(all(idx >= 0 & idx < n), "indices stay inside the dataset")

  # The three survival-scale columns are one quantity in three parameterisations;
  # if they ever disagree, one of them is being computed off a different fit.
  haz <- unlist(by_name[["haz"]]$values)
  expect_equal(max(abs(unlist(sur$values) - exp(-haz))), 0, tolerance = 1e-6,
               "survival == exp(-cumulative hazard)")
  expect_equal(max(abs(unlist(by_name[["lml"]]$values) - log(haz))), 0, tolerance = 1e-6,
               "log-minus-log == log(cumulative hazard)")

  # XBeta against an independent coxph fit on the same complete cases.
  keep <- !is.na(df$col_3)
  ref <- survival::coxph(survival::Surv(df$col_1[keep], as.integer(df$col_2[keep] == "1")) ~
                           df$col_3[keep])
  expect_equal(max(abs(unlist(by_name[["xb"]]$values) -
                         as.numeric(stats::predict(ref, type = "lp")))), 0,
               tolerance = 1e-6, "XBeta matches coxph's linear predictor")
})

test_that("KM new variables evaluate each case on its own group curve", {
  df <- data.frame(
    col_1 = c(4, 6, 8, 10, 3, 5, 9, 12),
    col_2 = c("1", "1", "0", "1", "1", "0", "1", "1"),
    col_3 = c("a", "a", "a", "a", "b", "b", "b", "b")
  )
  df[["__row_idx"]] <- seq_len(nrow(df)) - 1L
  fixture <- write_fixture(df, list(
    timeVar = "col_1", statusVar = "col_2", eventValue = "1",
    factor = "col_3", factorName = "grp",
    createVars = list(survival = "sur", se = "sur_se", hazard = "haz", cumEvents = "cum_ev")
  ))
  result <- run_analysis_script("survival-km.R", fixture)
  by_name <- setNames(result$caseVars, vapply(result$caseVars, function(c) c$name, character(1)))
  expect_equal(length(result$caseVars), 4, tolerance = 0, "four KM columns returned")

  sur <- by_name[["sur"]]
  expect_equal(length(unlist(sur$rowIndex)), nrow(df), tolerance = 0, "no case dropped")
  expect_true(all(unlist(sur$rowIndex) == seq_len(nrow(df)) - 1L), "indices in dataset order")

  # Reference: each case's OWN group's KM curve at its OWN time. Getting the
  # group wrong is the failure mode worth pinning — it looks plausible.
  ref_fit <- survival::survfit(
    survival::Surv(df$col_1, as.integer(df$col_2 == "1")) ~ df$col_3)
  strata_n <- ref_fit$strata
  starts <- cumsum(c(0, head(strata_n, -1)))
  want <- numeric(nrow(df))
  for (g in seq_along(levels(factor(df$col_3)))) {
    r <- starts[g] + seq_len(strata_n[g])
    ft <- ref_fit$time[r]; fs <- ref_fit$surv[r]
    in_g <- which(df$col_3 == levels(factor(df$col_3))[g])
    j <- findInterval(df$col_1[in_g], ft)
    want[in_g] <- ifelse(j == 0, 1, fs[pmax(j, 1)])
  }
  expect_equal(max(abs(unlist(sur$values) - want)), 0, tolerance = 1e-9,
               "S(t) is the case's own group at the case's own time")
  # Both groups end on an event with one case at risk, so S reaches 0 there and
  # the cumulative hazard is genuinely infinite. sai_case_var() drops values it
  # cannot represent, so the hazard column is SHORTER than the survival one —
  # the honest result, not a bug. Derived from the reference curve rather than
  # hard-coded, so the count cannot drift away from the fixture.
  haz <- by_name[["haz"]]
  haz_rows <- unlist(haz$rowIndex) + 1L
  expect_equal(length(haz_rows), sum(want > 0), tolerance = 0,
               "cases whose S(t) is 0 get no hazard value")
  expect_equal(max(abs(unlist(haz$values) + log(want[haz_rows]))), 0, tolerance = 1e-9,
               "cumulative hazard == -log(S) wherever it is finite")
  # First case of group "a" is an event at t=4 with n=4 at risk: S=0.75, one event.
  expect_equal(unlist(sur$values)[1], 0.75, tolerance = 1e-9, "hand-checked S(4) in group a")
  expect_equal(unlist(by_name[["cum_ev"]]$values)[1], 1, tolerance = 0, "one event by t=4 in a")
})

test_that("new variables are only created for the slots the dialog asked for", {
  df <- data.frame(
    col_1 = c(4, 6, 8, 10, 3, 5, 9, 12),
    col_2 = c("1", "1", "0", "1", "1", "0", "1", "1")
  )
  df[["__row_idx"]] <- seq_len(nrow(df)) - 1L
  fixture <- write_fixture(df, list(
    timeVar = "col_1", statusVar = "col_2", eventValue = "1",
    createVars = list(hazard = "only_haz")
  ))
  result <- run_analysis_script("survival-km.R", fixture)
  expect_equal(length(result$caseVars), 1, tolerance = 0, "exactly one column")
  expect_true(identical(result$caseVars[[1]]$name, "only_haz"), "the requested one, by its name")
  expect_true(!("output.warn.newVarsNotApplied" %in% unlist(result$warnings)),
              "no false 'not applied' warning when it WAS applied")
})

test_that("an analysis that cannot create variables says so instead of staying silent", {
  # The honesty rule sai_output() already applies to weight/split/missing: a
  # request that quietly evaporates is indistinguishable from one that worked.
  df <- data.frame(col_1 = c(1, 2, 3, 4, 5, 6, 7, 8))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "x"),
    createVars = list(predicted = "pred")
  ))
  result <- run_analysis_script("descriptives.R", fixture)
  expect_true("output.warn.newVarsNotApplied" %in% unlist(result$warnings),
              "descriptives warns that it produced no case-level variables")
  expect_equal(length(result$caseVars), 0, tolerance = 0, "and returns none")
})
