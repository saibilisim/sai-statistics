# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# make-case-summaries.R — writes the fully synthetic fixture behind
# test-case-summaries-spss-2026-08.R and test-grouped-median-2026-08.R.
#
#   Rscript make-case-summaries.R [out_dir]
#
# Writes ../fixtures-spss-case-summaries-100.csv (the test fixture) and, into
# out_dir (default: tempdir()), case-summaries-309.csv — the 309-case file the
# "limit before grouping" test rebuilds in R, which SPSS needs as a real file.
# case-summaries.sps runs both through SPSS (see README.md).
#
# The shape is deliberate, not random noise:
#   * 100 cases, cinsiyet 1/2 interleaved, 48 + 52 — so a case limit applied
#     after sorting by group (the defect the test pins) visibly changes counts;
#   * tani_yili takes few distinct years, so the Grouped Median differs from
#     the Median and the tie structure matters;
#   * ad_soyad mixes lower and UPPER case and Turkish letters: "ahmet arı" is
#     the case-insensitive minimum while "HALİL KARA" would win a byte sort, and
#     group 1 holds both "şule han" and "zerrin yazgan", which only Turkish
#     collation orders as ş < z;
#   * kayit_no is all-distinct, so its Grouped Median degenerates to the Median.

set.seed(20261024)

n1 <- 48
n2 <- 52
cinsiyet <- c(rep(1L, n1), rep(2L, n2))
cinsiyet <- cinsiyet[sample.int(length(cinsiyet))]
cinsiyet[1] <- 1L # the filler in the limit test copies the first group-1 row
# keep the 48/52 split after forcing row 1
if (sum(cinsiyet == 1L) != n1) {
  extra <- which(cinsiyet == 1L)[-1][1]
  cinsiyet[extra] <- 2L
}
stopifnot(sum(cinsiyet == 1L) == n1, sum(cinsiyet == 2L) == n2)

tani_yili <- sample(2015:2018, 100, replace = TRUE, prob = c(0.22, 0.28, 0.27, 0.23))

first <- c("burak", "kerem", "mert", "fatih", "elif", "deniz", "ceren", "onur",
           "selin", "yusuf", "emre", "gizem", "can", "irem", "tolga", "pelin")
last <- c("kaya", "doğan", "güneş", "tuna", "önal", "çelik", "yıldız", "aydın",
          "bayrak", "kurt", "öztürk", "polat", "erdem", "bulut")
ad_soyad <- paste(sample(first, 100, replace = TRUE), sample(last, 100, replace = TRUE))

g1 <- which(cinsiyet == 1L)
g2 <- which(cinsiyet == 2L)
# Fixed anchors for the string-ordering assertions (see header).
ad_soyad[g1[5]] <- "ahmet arı"
ad_soyad[g1[9]] <- "HALİL KARA"
ad_soyad[g1[17]] <- "şule han"
ad_soyad[g1[30]] <- "zerrin yazgan"
ad_soyad[g2[11]] <- "NAZLI ÖZER"
ad_soyad[g2[23]] <- "ümit şahin"

kayit_no <- sample(1000000:1999999, 100)

d <- data.frame(cinsiyet, tani_yili, ad_soyad, kayit_no, stringsAsFactors = FALSE)

here <- local({
  a <- commandArgs(trailingOnly = FALSE)
  f <- sub("^--file=", "", a[grep("^--file=", a)])
  if (length(f)) dirname(normalizePath(f)) else getwd()
})
args <- commandArgs(trailingOnly = TRUE)
out_dir <- if (length(args) >= 1) args[1] else tempdir()

con <- file(file.path(here, "..", "fixtures-spss-case-summaries-100.csv"), "w", encoding = "UTF-8")
write.csv(d, con, row.names = FALSE, quote = c(3L))
close(con)

# 309 cases: the 100 above plus 209 copies of the first group-1 row, exactly
# what the test builds with rbind().
big <- rbind(d, d[d$cinsiyet == 1L, ][rep(1, 209), ])
con <- file(file.path(out_dir, "case-summaries-309.csv"), "w", encoding = "UTF-8")
write.csv(big, con, row.names = FALSE, quote = c(3L))
close(con)
message("309-case file: ", normalizePath(file.path(out_dir, "case-summaries-309.csv")))
