# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-anova-homogeneous-subsets.R — validates two additions to
# anova-oneway.R made after a SPSS parity review found them missing from a
# real thesis ONEWAY /POSTHOC run:
#
#   1. Hochberg's GT2 (equal-variance pairwise post hoc, same Studentized
#      Maximum Modulus machinery as the existing Dunnett's T3, pooled se/df
#      instead of per-pair Welch se/df).
#   2. Homogeneous Subsets (Tukey HSD/Scheffe/SNK/Duncan/Ryan-Einot-Gabriel-
#      Welsch Range/Waller-Duncan): the grouping itself is agricolae's
#      duncan.test/SNK.test/HSD.test/scheffe.test/waller.test/REGW.test
#      (group=TRUE) — not a hand-rolled algorithm — but the per-subset "Sig."
#      row for Tukey HSD/SNK/Duncan is this script's own harmonic-mean-N
#      formula, independently re-derived to match SPSS's displayed numbers
#      exactly (see below). Scheffe/REGW Range/Waller-Duncan's own "Sig."
#      formula could not be reproduced with confidence and is intentionally
#      left out — same stance as the already-documented Levene "median with
#      adjusted df" omission.
#
# The CRP reference numbers below are copied verbatim from a real SPSS 29
# ONEWAY run (not re-derived from this script or from agricolae) —
# etiyoloji_dörtlü BY CRP, 4 groups: Viral N=48, Diğer N=56,
# Toksik-Metabolik N=101, Otoimmun N=44; Within Groups MS=2072.772, df=245.
#
# The synthetic fixture must reproduce N, mean AND within-group variance per
# group — unlike a pairwise-test fixture, anova-oneway.R computes its own
# MSW/dfw straight from this data (it isn't just handed to agricolae as
# fixed numbers the way a unit test could), so a degenerate zero-variance
# fixture (every case = the group mean) makes the script's own MSW collapse
# to 0 and silently breaks every post hoc SE. `scale()` on a fixed sequence
# gives an exact sample mean of 0 and sample variance of 1 per group, so
# `mean + sqrt(target_msw) * scale(seq_len(n))` reproduces the group's mean
# AND its share of the target MSW exactly (ssw per group = (n-1)*target_msw,
# so pooled dfw = sum(n-1) = N-k and msw_recomputed = target_msw exactly).
make_msw_fixture <- function(ns, means, target_msw) {
  make_group <- function(n, m) m + sqrt(target_msw) * as.vector(scale(seq_len(n)))
  y   <- unlist(Map(make_group, ns, means))
  trt <- unlist(Map(function(n, lvl) rep(lvl, n), ns, names(ns)))
  data.frame(col_1 = y, col_2 = trt)
}

crp_like_fixture <- function() {
  make_msw_fixture(
    c(Viral = 48, Diger = 56, ToksikMetabolik = 101, Otoimmun = 44),
    c(Viral = 16.167, Diger = 47.911, ToksikMetabolik = 19.882, Otoimmun = 10.480),
    2072.772)
}

test_that("Homogeneous Subsets: REGW Range does not silently disappear for exactly 3 groups", {
  # Real bug found via e2e testing: agricolae::REGW.test has an off-by-one in
  # its own source — `for (i in 2:(ntr - 2))` becomes the DESCENDING sequence
  # `2:1` when ntr==3 (R counts down, not an empty range), corrupting Tprob
  # and then crashing on a later out-of-bounds comparison
  # (`Tprob[ntr - 3] > Tprob[ntr - 2]`, i.e. `Tprob[0] > Tprob[1]`, "argument
  # is of length zero"). anova-oneway.R's own tryCatch turned that into a
  # silently-missing table + a generic warning — exactly what a real user
  # reported (checked every post hoc box, got no Homogeneous Subsets at all).
  # regw_groups() reimplements the same documented formula without the buggy
  # branch (see anova-oneway.R); PlantGrowth (k=3) is the smallest case that
  # exercises it, and is the exact group count that used to fail.
  skip_needs <- !requireNamespace("agricolae", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: agricolae not installed)\n")
    return(invisible())
  }
  data(PlantGrowth)
  df <- data.frame(col_1 = PlantGrowth$weight, col_2 = as.character(PlantGrowth$group))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "weight"),
    factor = "col_2", factorName = "group",
    options = list(regwQ = TRUE, sigLevel = "0.05")
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  expect_true(!("output.warn.homogeneousSubsetsNotComputed" %in% unlist(result$warnings)),
              "no silent-failure warning for k=3")
  regw <- Filter(function(t) grepl("output.anova.homogSubsetsTitle:", t$titleKey, fixed = TRUE) &&
    grepl("regwQ", t$titleKey, fixed = TRUE), result$tables)
  expect_equal(length(regw), 1L, label = "REGW Range table present for k=3")
  expect_equal(length(regw[[1]]$rows), 3L, label = "one row per PlantGrowth group, no Sig. row")
})

test_that("Hochberg's GT2: sig matches an independent mvtnorm-based reference (PlantGrowth)", {
  skip_needs <- !requireNamespace("mvtnorm", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: mvtnorm not installed)\n")
    return(invisible())
  }
  data(PlantGrowth)
  df <- data.frame(col_1 = PlantGrowth$weight, col_2 = as.character(PlantGrowth$group))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "weight"),
    factor = "col_2", factorName = "group",
    options = list(hochbergGT2 = TRUE, sigLevel = "0.05")
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  x <- PlantGrowth$weight; g <- factor(PlantGrowth$group); lvls <- levels(g)
  ni <- tapply(x, g, length); mns <- tapply(x, g, mean)
  fit <- aov(x ~ g); dfw <- df.residual(fit); msw <- deviance(fit) / dfw
  k <- length(lvls); ncmp <- choose(k, 2)
  i <- 2; j <- 1  # trt1, ctrl -> row 3 in the 6-row table (i != j order)
  diff <- mns[i] - mns[j]
  se <- sqrt(msw * (1 / ni[i] + 1 / ni[j]))
  df_int <- max(1L, round(dfw))
  corr <- diag(ncmp)
  set.seed(12345L)
  crit <- mvtnorm::qmvt(0.95, tail = "both.tails", df = df_int, corr = corr)$quantile
  tstat <- abs(diff) / se
  sig_ref <- 1 - as.numeric(mvtnorm::pmvt(lower = rep(-tstat, ncmp), upper = rep(tstat, ncmp),
                                           df = df_int, corr = corr))

  ph <- find_table(result, "output.anova.postHocTitle")
  expect_equal(ph$rows[[3]][[2]], "trt1", label = "GT2 row3 groupI")
  expect_equal(ph$rows[[3]][[3]], "ctrl", label = "GT2 row3 groupJ")
  expect_equal(cell_num(ph, 3, 6), sig_ref, tolerance = 2e-3, label = "GT2 sig")
  expect_equal(cell_num(ph, 3, 4), unname(diff), tolerance = 1e-4, label = "GT2 mean diff")
})

test_that("Homogeneous Subsets: Tukey HSD reproduces SPSS's published CRP grouping and Sig.", {
  skip_needs <- !requireNamespace("agricolae", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: agricolae not installed)\n")
    return(invisible())
  }
  fixture <- write_fixture(crp_like_fixture(), list(
    variables = list("col_1"), varNames = list(col_1 = "CRP"),
    factor = "col_2", factorName = "etiyoloji",
    options = list(tukey = TRUE, sigLevel = "0.05")
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  hs <- Filter(function(t) grepl("output.anova.homogSubsetsTitle:", t$titleKey, fixed = TRUE) &&
    grepl("tukeyHSD", t$titleKey, fixed = TRUE), result$tables)
  expect_equal(length(hs), 1L, label = "one Tukey HSD homogeneous-subsets table")
  tab <- hs[[1]]

  # SPSS: 2 subsets — {Otoimmun, Viral, Toksik-Metabolik} then {Diger} alone —
  # rows sorted ascending by mean, Sig. row last.
  expect_equal(length(tab$columns), 4L, label = "Group, N, Subset 1, Subset 2")
  expect_equal(length(tab$rows), 5L, label = "4 groups + Sig. row")
  row_lvls <- vapply(tab$rows[1:4], function(r) r[[1]], character(1))
  expect_equal(row_lvls, c("Otoimmun", "Viral", "ToksikMetabolik", "Diger"))

  # Diger is alone in subset 2 (column 4); the other three share subset 1.
  expect_true(is.null(tab$rows[[1]][[4]]) && !is.null(tab$rows[[1]][[3]]), "Otoimmun in subset 1 only")
  expect_true(is.null(tab$rows[[3]][[4]]) && !is.null(tab$rows[[3]][[3]]), "ToksikMetabolik in subset 1 only")
  expect_true(!is.null(tab$rows[[4]][[4]]) && is.null(tab$rows[[4]][[3]]), "Diger in subset 2 only")
  expect_equal(tab$rows[[4]][[4]], 47.911, tolerance = 1e-6, "Diger's own mean in its subset cell")

  sig_row <- tab$rows[[5]]
  expect_equal(sig_row[[1]], "output.anova.sigRow")
  expect_equal(sig_row[[3]], 0.694, tolerance = 1e-3, "Tukey HSD subset-1 Sig. matches SPSS")
  expect_equal(sig_row[[4]], 1, label = "single-member subset Sig. is trivially 1")

  # SPSS's own footnote: "Uses Harmonic Mean Sample Size = 56,086".
  expect_true(grepl("56.086", tab$footnoteKey, fixed = TRUE), "harmonic mean footnote value")
})

test_that("Homogeneous Subsets: SNK and Duncan Sig. also match SPSS's published values", {
  skip_needs <- !requireNamespace("agricolae", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: agricolae not installed)\n")
    return(invisible())
  }
  fixture <- write_fixture(crp_like_fixture(), list(
    variables = list("col_1"), varNames = list(col_1 = "CRP"),
    factor = "col_2", factorName = "etiyoloji",
    options = list(snk = TRUE, duncan = TRUE, sigLevel = "0.05")
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  snk <- Filter(function(t) grepl("snk", t$titleKey, fixed = TRUE), result$tables)[[1]]
  duncan <- Filter(function(t) grepl("duncan", t$titleKey, fixed = TRUE), result$tables)[[1]]
  expect_equal(snk$rows[[5]][[3]], 0.519, tolerance = 1e-3, "SNK subset-1 Sig. matches SPSS")
  # SPSS prints .306 to 3 decimals; all.equal's tolerance is relative, and the
  # true value (.306418) is close enough to the 3-decimal boundary that 1e-3
  # relative tolerance is too tight — compare the rounded value instead.
  expect_equal(round(duncan$rows[[5]][[3]], 3), 0.306, label = "Duncan subset-1 Sig. matches SPSS")
})

test_that("Homogeneous Subsets: Scheffe/REGW Range/Waller-Duncan reproduce SPSS's grouping (no guessed Sig.)", {
  skip_needs <- !requireNamespace("agricolae", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: agricolae not installed)\n")
    return(invisible())
  }
  fixture <- write_fixture(crp_like_fixture(), list(
    variables = list("col_1"), varNames = list(col_1 = "CRP"),
    factor = "col_2", factorName = "etiyoloji",
    options = list(scheffe = TRUE, regwQ = TRUE, wallerDuncan = TRUE, sigLevel = "0.05")
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  for (needle in c("scheffe", "regwQ", "wallerDuncan")) {
    tab <- Filter(function(t) grepl(needle, t$titleKey, fixed = TRUE), result$tables)[[1]]
    expect_equal(length(tab$rows), 4L, label = sprintf("%s: 4 groups, no Sig. row", needle))
    row_lvls <- vapply(tab$rows, function(r) r[[1]], character(1))
    diger_row <- tab$rows[[which(row_lvls == "Diger")]]
    expect_true(!is.null(diger_row[[4]]) && is.null(diger_row[[3]]),
                sprintf("%s: Diger alone in subset 2", needle))
  }
})

test_that("Homogeneous Subsets: a non-significant ANOVA puts every group in one subset", {
  skip_needs <- !requireNamespace("agricolae", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: agricolae not installed)\n")
    return(invisible())
  }
  # PLT1000-like: SPSS's real F=.239, p=.869 collapses every method to a
  # single homogeneous subset. Same reconstruction technique as
  # crp_like_fixture, target MSW=6738.031 (SPSS's real PLT1000 Within Groups MS).
  plt1000 <- make_msw_fixture(
    c(Viral = 53, Diger = 69, ToksikMetabolik = 131, Otoimmun = 51),
    c(Viral = 216.038, Diger = 225.551, ToksikMetabolik = 220.748, Otoimmun = 228.078),
    6738.031)
  fixture <- write_fixture(plt1000, list(
    variables = list("col_1"), varNames = list(col_1 = "PLT1000"),
    factor = "col_2", factorName = "etiyoloji",
    options = list(tukey = TRUE, duncan = TRUE, sigLevel = "0.05")
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  tukey <- Filter(function(t) grepl("tukeyHSD", t$titleKey, fixed = TRUE), result$tables)[[1]]
  expect_equal(length(tukey$columns), 3L, label = "Group, N, single Subset column")
  for (r in tukey$rows[1:4]) expect_true(!is.null(r[[3]]), "every group falls in the single subset")
})
