# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-proportions.R — validates Compare Means and Proportions (SPSS 27+;
# see spss-parity-analysis.md §3.5): One-/Independent-/Paired-Sample
# Proportions in proportions.R, against base R's own prop.test/binom.test.

test_that("one-sample proportions: matches binom.test/prop.test(wilson) exactly", {
  set.seed(1)
  x <- c(rep("1", 42), rep("0", 58))
  df <- data.frame(flag = sample(x))
  fixture <- write_fixture(df, list(
    design = "one", variable = "flag", varName = "Flag",
    successValue = "1", testValue = 0.5, ciLevel = 95
  ))
  result <- run_analysis_script("proportions.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  tab <- find_table(result, "output.proportions.oneTitle")
  ref_exact <- binom.test(42, 100, p = 0.5)
  ref_wilson <- prop.test(42, 100, correct = FALSE)$conf.int

  expect_equal(cell_num(tab, 1, 3), 0.42, tolerance = 1e-9, "observed proportion")
  expect_equal(cell_num(tab, 1, 7), ref_wilson[1], tolerance = 1e-6, "wilson lower")
  expect_equal(cell_num(tab, 1, 8), ref_wilson[2], tolerance = 1e-6, "wilson upper")
  expect_equal(cell_num(tab, 1, 9), ref_exact$conf.int[1], tolerance = 1e-4, "exact (CP) lower")
  expect_equal(cell_num(tab, 1, 10), ref_exact$conf.int[2], tolerance = 1e-6, "exact (CP) upper")
  expect_equal(cell_num(tab, 1, 11), ref_exact$p.value, tolerance = 1e-4, "exact binomial sig")
})

test_that("independent-samples proportions: z/p match prop.test(2-sample, correct=FALSE)", {
  set.seed(2)
  df <- data.frame(
    flag = c(rep("1", 30), rep("0", 20), rep("1", 20), rep("0", 30)),
    grp  = c(rep("A", 50), rep("B", 50))
  )
  fixture <- write_fixture(df, list(
    design = "independent", variable = "flag", varName = "Flag",
    groupVar = "grp", groupVarName = "Group", successValue = "1", ciLevel = 95
  ))
  result <- run_analysis_script("proportions.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  tab <- find_table(result, "output.proportions.indepTitle")
  ref <- prop.test(c(30, 20), c(50, 50), correct = FALSE)

  expect_equal(cell_num(tab, 1, 3), 0.6, tolerance = 1e-9, "group A proportion")
  expect_equal(cell_num(tab, 2, 3), 0.4, tolerance = 1e-9, "group B proportion")
  expect_equal(cell_num(tab, 2, 4), 0.2, tolerance = 1e-9, "difference")
  expect_equal(cell_num(tab, 2, 10), ref$p.value, tolerance = 1e-4, "pooled z-test sig matches prop.test")
})

test_that("paired-samples proportions: McNemar exact sig matches direct binom formula", {
  set.seed(3)
  x1 <- sample(c("1", "0"), 80, replace = TRUE, prob = c(0.6, 0.4))
  x2 <- sample(c("1", "0"), 80, replace = TRUE, prob = c(0.45, 0.55))
  df <- data.frame(before = x1, after = x2)
  fixture <- write_fixture(df, list(
    design = "paired", variable1 = "before", varName1 = "Before",
    variable2 = "after", varName2 = "After", successValue = "1", ciLevel = 95
  ))
  result <- run_analysis_script("proportions.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  tab <- find_table(result, "output.proportions.pairedTitle")
  b <- sum(x1 == "1" & x2 == "0"); cc <- sum(x1 == "0" & x2 == "1")
  ref_sig <- min(1, 2 * pbinom(min(b, cc), b + cc, 0.5))
  nd <- b + cc
  ref_z <- (b - cc) / sqrt(nd)

  # By column KEY, not position. This assertion used to read column 8 and broke
  # silently-in-the-wrong-direction the moment Z and Asymp. Sig. were inserted
  # before it: it started comparing the exact p against Z (2.714) and failed
  # with a number that looks nothing like a p-value. A positional read is a
  # future failure waiting for the next column.
  col <- function(key) which(unlist(tab$columns) == key)

  expect_equal(cell_num(tab, 1, col("output.proportions.observed")), mean(x1 == "1"),
               tolerance = 1e-9, "before proportion")
  expect_equal(cell_num(tab, 2, col("output.proportions.observed")), mean(x2 == "1"),
               tolerance = 1e-9, "after proportion")
  expect_equal(cell_num(tab, 2, col("output.col.exactSig")), ref_sig,
               tolerance = 1e-4, "McNemar exact sig")

  # Both McNemar variants are reported now (CLAUDE.md §11), so both are pinned.
  expect_equal(cell_num(tab, 2, col("output.col.z")), ref_z, tolerance = 1e-3,
               "McNemar z = (b - c)/sqrt(b + c)")
  expect_equal(cell_num(tab, 2, col("output.col.asympSig")), 2 * pnorm(-abs(ref_z)),
               tolerance = 1e-4, "McNemar asymptotic sig")
  # And they must actually differ here, or reporting both would be pointless
  # and the two assertions above would not distinguish anything.
  expect_true(abs(ref_sig - 2 * pnorm(-abs(ref_z))) > 1e-3,
              "the fixture separates the exact and asymptotic p-values")
})

test_that("independent-samples proportions: group variable's user-missing values are excluded", {
  # Before the fix, only the outcome variable went through apply_user_missing()
  # — the group variable did not, so a "9 = unknown" code stayed in as a third
  # group and this fixture failed with "Group variable must have exactly 2
  # levels" instead of silently dropping those 5 cases like crosstabs.R does.
  df <- data.frame(
    flag = c(rep("1", 30), rep("0", 20), rep("1", 20), rep("0", 30), rep("1", 5)),
    grp  = c(rep("A", 50), rep("B", 50), rep("9", 5))
  )
  fixture <- write_fixture(df, list(
    design = "independent", variable = "flag", varName = "Flag",
    groupVar = "grp", groupVarName = "Group", successValue = "1", ciLevel = 95,
    missingValues = list(grp = list(type = "discrete", discrete = list("9")))
  ))
  result <- run_analysis_script("proportions.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  tab <- find_table(result, "output.proportions.indepTitle")
  expect_equal(cell_num(tab, 1, 2), 50, tolerance = 1e-9, "group A N excludes user-missing group")
  expect_equal(cell_num(tab, 2, 2), 50, tolerance = 1e-9, "group B N excludes user-missing group")
})

test_that("one-sample proportions: warns when the success value never occurs", {
  set.seed(4)
  df <- data.frame(cinsiyet = sample(c("1", "2"), 100, replace = TRUE))
  fixture <- write_fixture(df, list(
    design = "one", variable = "cinsiyet", varName = "Cinsiyet",
    successValue = "9", testValue = 0.5, ciLevel = 95
  ))
  result <- run_analysis_script("proportions.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  warns <- unlist(result$warnings)
  expect_true("output.proportions.successNotFoundWarning:Cinsiyet|9" %in% warns,
              "warns instead of silently reporting a 0 proportion")
})

test_that("proportions tests: warn when a variable carries more than 2 categories", {
  set.seed(5)
  df <- data.frame(k = sample(c("1", "2", "3"), 60, replace = TRUE))
  fixture <- write_fixture(df, list(
    design = "one", variable = "k", varName = "K",
    successValue = "1", testValue = 0.5, ciLevel = 95
  ))
  result <- run_analysis_script("proportions.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  warns <- unlist(result$warnings)
  expect_true("output.proportions.notDichotomousWarning:K|3" %in% warns,
              "warns that a 3-category variable is not a valid success/failure split")
})
