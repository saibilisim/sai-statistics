# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-export-sav-names.R — export-sav.R (File > Export Data > SPSS) with
# variable names SPSS rejects. haven::write_sav refused the WHOLE file when one
# name broke SPSS's rules (a real dataset with 70+-character Turkish names hit
# "Variables in `data` must have valid SPSS variable names"). The script now
# makes every name valid, keeps the original as the variable label and leaves
# valid names untouched. Reference: haven's own reader on the written file.

suppressPackageStartupMessages({
  library(arrow)
  library(jsonlite)
  library(haven)
})

run_export_sav <- function(df, variables) {
  parquet <- tempfile(fileext = ".parquet")
  out <- tempfile(fileext = ".sav")
  write_parquet(df, parquet)
  params_path <- tempfile(fileext = ".json")
  writeLines(
    toJSON(list(parquet = parquet, out = out, variables = variables), auto_unbox = TRUE, null = "null"),
    params_path,
    useBytes = TRUE
  )
  res <- run_analysis_script("export-sav.R", list(rScriptsDir = r_scripts_dir(), paramsPath = params_path))
  list(res = res, out = out)
}

long_tr <- "semptomlar_1_halsizlik_2_istahsizlik_3_bulanti_4_kusma_5_karin_agrisi_6_sarilik_7_koyu_idrar"
long_tr2 <- "semptomlar_1_halsizlik_2_istahsizlik_3_bulanti_4_kusma_5_karin_agrisi_6_sarilik_8_baska"
names_in <- c("yas", long_tr, long_tr2, "Ağrı şiddeti (VAS)", "2. ölçüm", "AND", "son.", "YAS")
df <- data.frame(c1 = 1:3, c2 = c(1, 0, 1), c3 = c(0, 0, 1), c4 = c(3, 5, 7),
                 c5 = c(10, 20, 30), c6 = 4:6, c7 = 7:9, c8 = c(1.5, 2.5, 3.5))
variables <- lapply(seq_along(names_in), function(i) {
  list(colId = paste0("c", i), name = names_in[i], label = if (i == 4) "Ağrı (0-10)" else "",
       type = "numeric", width = 8, decimals = 0, columns = 8,
       valueLabels = structure(list(), names = character(0)), missing = NULL)
})

test_that("export-sav: names SPSS rejects are made valid instead of failing the export", {
  r <- run_export_sav(df, variables)
  expect_true(isTRUE(r$res$ok), label = paste("export ok:", r$res$detail))
  expect_equal(r$res$cols, 8, label = "all 8 columns written")
  expect_equal(r$res$renamed, 7, label = "every name except 'yas' renamed")

  back <- read_sav(r$out)
  nm <- names(back)
  expect_true(identical(nm[1], "yas"), label = "a valid name is left untouched")
  expect_true(all(nchar(nm, type = "bytes") <= 64), label = "every name fits SPSS's 64 bytes")
  expect_true(!any(duplicated(tolower(nm))), label = "names stay unique ignoring case (YAS vs yas)")
  expect_true(!(toupper(nm[6]) %in% "AND"), label = "reserved word AND is not used as a name")
  expect_true(!grepl("\\.$", nm[7]), label = "no name ends in a period")
  expect_true(grepl("^[[:alpha:]@]", nm[5]), label = "a name starting with a digit gets a letter first")
  expect_true(nm[2] != nm[3], label = "two long names cut to the same prefix stay distinct")

  # The full original name survives as the label; an existing label wins.
  expect_true(identical(attr(back[[2]], "label"), long_tr), label = "long name kept as the variable label")
  expect_true(identical(attr(back[[4]], "label"), "Ağrı (0-10)"), label = "an existing label is not overwritten")
  expect_equal(as.numeric(back[[8]]), c(1.5, 2.5, 3.5), label = "values unchanged")
})
