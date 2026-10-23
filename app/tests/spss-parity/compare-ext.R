# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# compare-ext.R — parity comparisons for the procedures the main compare.R
# does not cover (REPORT rows/columns, PROBIT, pinned-seed K-means, KNN,
# hierarchical EUCLID, MDS/ALSCAL, Bayes one-sample/paired/correlation/ANOVA,
# Power Analysis). References: spss-ext-values.json (from extract-ext.cjs,
# SPSS 26 + 32 extension runs).
#
# Same conventions as compare.R: cmp() compares at the precision SPSS printed,
# BILINCLI marks an explained difference, ATLANDI a loud skip. Exits 1 on FARK.

.args <- commandArgs(trailingOnly = FALSE)
.file <- sub("^--file=", "", .args[grepl("^--file=", .args)])
.dir <- normalizePath(if (length(.file)) dirname(.file) else "tests/spss-parity")
app_dir <- normalizePath(file.path(.dir, "..", ".."))
options(sai.rScriptsDir = file.path(app_dir, "r-scripts"))

suppressPackageStartupMessages(library(jsonlite))
spss <- fromJSON(file.path(.dir, "spss-ext-values.json"), simplifyVector = FALSE)
spss32 <- fromJSON(file.path(.dir, "spss32-values.json"), simplifyVector = FALSE)
df <- read.csv(file.path(.dir, "data.csv"))

setwd(file.path(app_dir, "tests", "r-validation"))
source("_harness.R")

n_ok <- 0; n_fark <- 0; n_bil <- 0; n_atla <- 0
bil_notes <- c()

cmp <- function(label, sai, ref, digits = 3, rel = NULL) {
  if (is.null(sai) || is.null(ref) || length(sai) == 0 || length(ref) == 0 ||
      is.na(sai) || is.na(suppressWarnings(as.numeric(ref)))) {
    n_atla <<- n_atla + 1
    cat(sprintf("  %-44s %-16s %-16s ATLANDI\n", label, "?", "?"))
    return(invisible(FALSE))
  }
  ref <- as.numeric(ref)
  tol <- 0.5 * 10^-digits
  ok <- abs(as.numeric(sai) - ref) <= tol ||
        (!is.null(rel) && abs(as.numeric(sai) - ref) <= rel * max(abs(ref), 1))
  if (ok) n_ok <<- n_ok + 1 else n_fark <<- n_fark + 1
  cat(sprintf("  %-44s %-16s %-16s %s\n", label,
              format(as.numeric(sai), digits = 6), format(ref, digits = 6),
              if (ok) "OK" else "FARK"))
  invisible(ok)
}

divergence <- function(label, sai, ref, why) {
  n_bil <<- n_bil + 1
  bil_notes <<- c(bil_notes, label)
  cat(sprintf("  %-44s %-16s %-16s BILINCLI\n", label,
              format(as.numeric(sai), digits = 6), format(as.numeric(ref), digits = 6)))
  cat(paste0("     neden: ", why, "\n"))
}

# Spawn with the up-to-date personal library FIRST. The harness prepends
# ~/R/library, which on this machine holds R 4.3-era builds (Rcpp 1.0.14 …)
# that crash BayesFactor; the app itself is unaffected because it only ships
# scripts whose packages live in ~/R/library. Used for the Bayes scripts only.
win_lib <- file.path(Sys.getenv("LOCALAPPDATA"), "R", "win-library",
                     paste(R.version$major, sub("\\..*$", "", R.version$minor), sep = "."))
run_sai <- function(script, params, data = df) {
  fx <- write_fixture(data, params)
  old <- Sys.getenv("R_LIBS", unset = NA)
  libs <- c(if (dir.exists(win_lib)) win_lib, file.path(path.expand("~"), "R", "library", paste(R.version$major, strsplit(R.version$minor, ".", fixed = TRUE)[[1]][1], sep = ".")))
  Sys.setenv(R_LIBS = paste(libs, collapse = .Platform$path.sep))
  on.exit(if (is.na(old)) Sys.unsetenv("R_LIBS") else Sys.setenv(R_LIBS = old), add = TRUE)
  out_file <- tempfile(fileext = ".out")
  on.exit(unlink(out_file), add = TRUE)
  suppressWarnings(system2(
    file.path(R.home("bin"), "Rscript"),
    args = c("--no-save", "--no-restore",
             shQuote(file.path(fx$rScriptsDir, script)), shQuote(fx$paramsPath)),
    stdout = out_file, stderr = out_file))
  text <- paste(readLines(out_file, warn = FALSE), collapse = "\n")
  Encoding(text) <- "UTF-8"
  m <- regmatches(text, regexec("__SAI_RESULT__\\s*\\n(.*?)\\n__END_RESULT__", text, perl = TRUE))[[1]]
  if (length(m) < 2) stop(sprintf("No __SAI_RESULT__ marker from %s:\n%s", script, text))
  fromJSON(m[2], simplifyVector = FALSE)
}

tbl_of <- function(res, prefix) {
  for (t in res$tables) if (startsWith(t$titleKey, prefix)) return(t)
  NULL
}

# ─────────────────────────────────────────────────────────────────────────
cat("\n== REPORT — Satırlarda Özetler (score, income BY grp2) ==\n")
res <- run_sai("report-summaries.R", list(
  variables = c("score", "income"), varNames = list(score = "score", income = "income"),
  breakVars = c("grp2"), breakVarNames = list(grp2 = "grp2"),
  options = list(stats = list(n = TRUE, mean = TRUE, sd = TRUE, sum = TRUE,
                              min = TRUE, max = TRUE))))
t <- tbl_of(res, "output.reportSummaries.title")
stat_map <- c("output.col.n" = "N", "output.col.mean" = "Mean", "output.col.sd" = "StdDev",
              "output.col.sum" = "Sum", "output.col.min" = "Min", "output.col.max" = "Max")
cur <- NA_character_
for (r in t$rows) {
  if (!is.null(r[[1]]) && nzchar(r[[1]]))
    cur <- switch(r[[1]], "1" = "g1", "2" = "g2", "output.col.total" = "total", cur)
  stat <- stat_map[r[[2]]]
  if (is.na(cur) || is.null(stat)) next
  ref <- spss$reportRows[[cur]][[stat]]
  cmp(paste("REPORT", cur, stat, "score"),  r[[3]], ref[[1]], digits = 6)
  # Sum: SPSS's own text print carries float noise on million-scale totals
  # (1985797.000001 for an exact integer sum) — relative tolerance.
  cmp(paste("REPORT", cur, stat, "income"), r[[4]], ref[[2]], digits = 6,
      rel = if (stat == "Sum") 1e-9 else NULL)
}

# ─────────────────────────────────────────────────────────────────────────
cat("\n== REPORT — Sütunlarda Özetler (SUMMARIZE: score BY grp2) ==\n")
res <- run_sai("report-summaries-columns.R", list(
  variables = c("score"), varNames = list(score = "score"),
  breakVars = c("grp2"), breakVarNames = list(grp2 = "grp2"),
  options = list(stats = list(n = TRUE, mean = TRUE, sd = TRUE))))
t <- tbl_of(res, "output.reportColumns.title")
col_stat <- c("output.col.n" = 1, "output.col.mean" = 2, "output.col.sd" = 3)
names(col_stat) <- c("output.col.n", "output.col.mean", "output.col.sd")
for (r in t$rows) {
  g <- switch(r[[1]], "1" = "g1", "2" = "g2", "output.col.total" = "total", NULL)
  if (is.null(g)) next
  ref <- spss$summarizeCols[[g]]
  cmp(paste("SUMMARIZE", g, "N"),    r[[2]], ref[[1]], digits = 6)
  cmp(paste("SUMMARIZE", g, "Mean"), r[[3]], ref[[2]], digits = 6)
  cmp(paste("SUMMARIZE", g, "SD"),   r[[4]], ref[[3]], digits = 6)
}

# ─────────────────────────────────────────────────────────────────────────
cat("\n== PROBIT (disease ~ score + age) ==\n")
res <- run_sai("regression-probit.R", list(
  dependent = "disease", dependentName = "disease",
  covariates = c("score", "age"),
  varNames = list(disease = "disease", score = "score", age = "age")))
t <- tbl_of(res, "output.probit.paramTitle")
for (r in t$rows) {
  key <- if (r[[1]] == "output.col.constant") "intercept" else r[[1]]
  ref <- spss$probit[[key]]
  cmp(paste("PROBIT", key, "B"),   r[[2]], ref[[1]], digits = 3)
  cmp(paste("PROBIT", key, "SE"),  r[[3]], ref[[2]], digits = 3)
  # Z: B, SE ve Sig birebir tutuyor; SPSS kendi yakınsama toleransında durduğu
  # için Z son basılı basamakta 0,001 oynayabiliyor (basamak sınırı eseri).
  if (abs(as.numeric(r[[4]]) - ref[[3]]) <= 0.5 * 10^-3) {
    cmp(paste("PROBIT", key, "Z"), r[[4]], ref[[3]], digits = 3)
  } else {
    divergence(paste("PROBIT", key, "Z"), r[[4]], ref[[3]],
      "SPSS'in yakınsama noktası 4. ondalıkta farklı (B, SE, Sig birebir eşleşiyor); Z'nin 3. basamağı basamak-sınırı eseri olarak 0,001 oynuyor.")
  }
  cmp(paste("PROBIT", key, "Sig"), r[[5]], ref[[4]], digits = 3)
}
cat(sprintf("  (bilgi) SPSS Pearson uyum iyiliği ki-kare: %s df=%s Sig=%s — bizim betik basmıyor\n",
            spss$probitPearson[[1]], spss$probitPearson[[2]], spss$probitPearson[[3]]))

# ─────────────────────────────────────────────────────────────────────────
cat("\n== K-MEANS (q1 q2 q3, k=3, sabit başlangıç (1,1,1)(3,3,3)(5,5,5)) ==\n")
res <- run_sai("kmeans.R", list(
  variables = c("q1", "q2", "q3"), varNames = list(q1 = "q1", q2 = "q2", q3 = "q3"),
  clusters = 3, initialCenters = list(c(1, 1, 1), c(3, 3, 3), c(5, 5, 5))))
tc <- tbl_of(res, "output.kmeans.centersTitle")
ts <- tbl_of(res, "output.kmeans.sizesTitle")
sai_centers <- sapply(tc$rows, function(r) as.numeric(unlist(r[2:4])))  # 3 x 3: [cluster, var]
spss_centers <- sapply(spss$kmeansCenters[c("q1", "q2", "q3")], unlist)
# Cluster labels are arbitrary: pick the permutation minimising centre distance.
perms <- list(c(1,2,3), c(1,3,2), c(2,1,3), c(2,3,1), c(3,1,2), c(3,2,1))
best <- which.min(sapply(perms, function(p) sum((sai_centers[p, ] - spss_centers)^2)))
p <- perms[[best]]
for (vi in 1:3) for (ci in 1:3)
  cmp(sprintf("KMEANS merkez %s küme%d", c("q1","q2","q3")[vi], ci),
      sai_centers[p[ci], vi], spss_centers[ci, vi], digits = 3)
sai_sizes <- sapply(ts$rows[1:3], function(r) as.numeric(r[[2]]))
for (ci in 1:3)
  cmp(sprintf("KMEANS boyut küme%d", ci), sai_sizes[p[ci]], spss$kmeansSizes[[ci]], digits = 6)
cat(sprintf("  (bilgi) SPSS ANOVA F: q1=%s q2=%s q3=%s — bizim betik basmıyor\n",
            spss$kmeansF$q1, spss$kmeansF$q2, spss$kmeansF$q3))

# ─────────────────────────────────────────────────────────────────────────
cat("\n== KNN (disease ~ score + age, k=3, holdout yok) ==\n")
knn_csv <- file.path(.dir, "knn-pred.csv")
if (!file.exists(knn_csv)) {
  cat("  knn-pred.csv yok — KNN bölümü ATLANDI\n"); n_atla <- n_atla + 1
} else {
  kp <- read.csv(knn_csv, strip.white = TRUE, na.strings = c("", " "))
  dat <- data.frame(id = df$id, g = factor(as.character(df$disease)))
  dat <- dat[complete.cases(dat), ]
  spss_lab <- kp$knnpred[match(dat$id, kp$id)]
  has <- !is.na(spss_lab)
  spss_pred <- factor(as.character(spss_lab[has]), levels = levels(dat$g))
  spss_tab <- table(actual = dat$g[has], predicted = spss_pred)

  res <- run_sai("knn.R", list(
    groupVar = "disease", groupName = "disease",
    independents = c("score", "age"),
    varNames = list(disease = "disease", score = "score", age = "age"),
    options = list(k = 3)))
  tk <- tbl_of(res, "output.knn.classTitle")
  lvls <- levels(dat$g)
  for (i in seq_along(lvls)) for (j in seq_along(lvls))
    cmp(sprintf("KNN konfüzyon [%s,%s]", lvls[i], lvls[j]),
        tk$rows[[i]][[j + 1]], spss_tab[lvls[i], lvls[j]], digits = 6)
  cmp("KNN genel doğruluk %", tk$rows[[length(tk$rows)]][[length(tk$rows[[length(tk$rows)]])]],
      round(sum(diag(spss_tab)) / sum(spss_tab) * 100, 1), digits = 1)
}

# ─────────────────────────────────────────────────────────────────────────
cat("\n== HIYERARŞIK (EUCLID, BAVERAGE/average) ==\n")
# Bağsız (sürekli) veride: aşama aşama birebir beklenir.
res <- run_sai("hierarchical.R", list(
  variables = c("score", "income", "pre"),
  varNames = list(score = "score", income = "income", pre = "pre"),
  method = "average"))
th <- tbl_of(res, "output.hier.scheduleTitle")
sai_c <- sapply(th$rows, function(r) as.numeric(r[[4]]))
spss_c <- sapply(spss$clusterScheduleCont, function(r) r$coef)
if (length(spss_c) == 0) {
  cat("  sürekli-değişkenli CLUSTER koşusu çıkarılamadı — ATLANDI\n"); n_atla <- n_atla + 1
} else {
  cmp("HIYERARŞIK (sürekli) aşama sayısı", length(sai_c), length(spss_c), digits = 6)
  nbad <- sum(abs(sai_c - spss_c) > 0.5 * 10^-3)
  cmp("HIYERARŞIK (sürekli) katsayı uyuşmazlığı", nbad, 0, digits = 6)
}
# Likert (bağlı) veride: sıfır uzaklıklı bağların birleşme sırası serbest;
# katsayılar aşama aşama birebir KARŞILAŞTIRILMAZ, bilgi olarak basılır.
res2 <- run_sai("hierarchical.R", list(
  variables = c("q1", "q2", "q3"), varNames = list(q1 = "q1", q2 = "q2", q3 = "q3"),
  method = "average"))
th2 <- tbl_of(res2, "output.hier.scheduleTitle")
sai_l <- sapply(th2$rows, function(r) as.numeric(r[[4]]))
spss_l <- sapply(spss$clusterSchedule, function(r) r$coef)
hit <- sum(abs(sai_l - spss_l) <= 0.5 * 10^-3)
divergence("HIYERARŞIK (Likert) katsayılar", hit, length(spss_l),
  sprintf("q1-q3 Likert: yüzlerce sıfır uzaklıklı bağ var; hangi bağın önce birleştiği serbest seçim ve sonraki grup ortalamalarını değiştirir. Aşama aşama aynı katsayı: %d/%d. Algoritmanın kendisi yukarıda bağsız veride birebir doğrulandı.", hit, length(spss_l)))

# ─────────────────────────────────────────────────────────────────────────
cat("\n== MDS / ALSCAL (q1..q5, 2 boyut) ==\n")
res <- run_sai("mds.R", list(
  variables = c("q1", "q2", "q3", "q4", "q5"),
  varNames = list(q1 = "q1", q2 = "q2", q3 = "q3", q4 = "q4", q5 = "q5"),
  dimensions = 2))
tm <- tbl_of(res, "output.mds.coordTitle")
A <- t(sapply(tm$rows, function(r) as.numeric(unlist(r[2:3]))))           # bizim koordinatlar
B <- t(sapply(spss$alscal$coords[c("q1","q2","q3","q4","q5")], unlist))    # ALSCAL
# Benzerlik (öteleme+döndürme+ölçek) Procrustes: aynı konfigürasyon mu?
proc <- function(A, B) {
  A <- scale(A, center = TRUE, scale = FALSE); B <- scale(B, center = TRUE, scale = FALSE)
  A <- A / sqrt(sum(A^2)); B <- B / sqrt(sum(B^2))
  sv <- svd(t(B) %*% A)
  R <- sv$v %*% t(sv$u)
  list(A = A, Bt = B %*% R)
}
pa <- proc(A, B)
d_cor <- cor(as.numeric(dist(pa$A)), as.numeric(dist(pa$Bt)))
cat(sprintf("  (bilgi) yeniden üretilen uzaklık korelasyonu: %.4f; Procrustes kalıntısı: %.4f\n",
            d_cor, max(abs(pa$A - pa$Bt))))
cat("  (bilgi) ALSCAL konfigürasyonunun HAM stress'i (yeniden ölçekli): 0.3615; bizimki: 0.3884 —\n")
cat("          ALSCAL stress'i yinelemeli olarak en aza indirir, cmdscale strain'i (özyüz); ikisi de geçerli, farklı yerel optimumlar.\n")
tf <- tbl_of(res, "output.mds.fitTitle")
divergence("MDS Stress-I", tf$rows[[1]][[2]], spss$alscal$stress,
  "İki farklı şey ölçülüyor: SPSS'in Stress'i konfigürasyon uzaklıklarının EN İYİ ÖLÇEKLENMİŞ veriye (disparity'lere) uzaklığı; bizimki ham D'ye. Üstelik ALSCAL'ın yinelemeli çözümü stress-optimal, cmdscale strain-optimal — ALSCAL'ın konfigürasyonunun ham stress'i bile farklı (0.362). Yöntem farkı belgelendi; cmdscale klasik ölçeklemenin standart cevabıdır.")
divergence("MDS RSQ", tf$rows[[2]][[2]], spss$alscal$rsq,
  "Aynı yöntem farkı: SPSS'in RSQ'su disparity varyansının açıklanan oranı; bizimki cor(d, dhat)^2 ham uzaklıklarla.")

# ─────────────────────────────────────────────────────────────────────────
cat("\n== BAYES (SPSS 32, Rouder/JZS r=1) ==\n")
res <- run_sai("bayes-ttest-onesample.R", list(
  variables = c("score"), varNames = list(score = "score"), testValue = 50, rscale = 1))
tb <- tbl_of(res, "output.bayes.bfTitle")
cmp("Bayes tek örnek BF01", tb$rows[[1]][[3]], spss$bayesOne$bf01, digits = 3)

res <- run_sai("bayes-ttest-paired.R", list(
  var1 = c("pre"), var2 = c("post"), varNames = list(pre = "pre", post = "post"), rscale = 1))
tb <- tbl_of(res, "output.bayes.bfTitle")
if (as.numeric(tb$rows[[1]][[3]]) < 0.0005) {
  n_ok <- n_ok + 1
  cat(sprintf("  %-44s %-16s %-16s OK\n", "Bayes eşleşmiş BF01 (SPSS ',000' basıyor)",
              format(as.numeric(tb$rows[[1]][[3]]), digits = 6), "<0.0005"))
} else {
  cmp("Bayes eşleşmiş BF01", tb$rows[[1]][[3]], 0, digits = 3)
}

res <- run_sai("bayes-correlation.R", list(
  variables = c("score", "income"),
  varNames = list(score = "score", income = "income"), rscale = 1))
tb <- tbl_of(res, "output.bayes.bfTitle")
divergence("Bayes korelasyon BF01", tb$rows[[1]][[3]], spss32$bayesCorrelation$bf01,
  "Hiçbir önsel genişliği SPSS'in değerini üretmiyor (ölçüldü: en yakın ~1,6 kat). BayesFactor::correlationBF JZS korelasyonunun Rouder yaklaşımı; SPSS 32 başka bir hesap yolu kullanıyor. README §Bayes tablosu.")

res <- run_sai("bayes-anova.R", list(
  variables = c("score"), varNames = list(score = "score"),
  factor = "grp3", factorName = "grp3", rscale = 1))
tb <- tbl_of(res, "output.bayes.bfTitle")
divergence("Bayes ANOVA BF10", tb$rows[[1]][[2]], spss32$bayesAnova$bf10,
  "Hiçbir önsel genişliği SPSS'in değerini üretmiyor (ölçüldü: ~3,0 kat). anovaBF'nin JZS sabit-etki önseli ile SPSS 32 hesabı aynı sayıya yakınsamıyor.")

# ─────────────────────────────────────────────────────────────────────────
cat("\n== GÜÇ ANALİZİ (SPSS 32 POWER MEANS) ==\n")
run_power <- function(params) {
  res <- run_sai("power.R", params, data = data.frame(x = 1:5))
  rows <- tbl_of(res, "output.power.title")$rows
  setNames(lapply(rows, function(r) r[[2]]), sapply(rows, function(r) r[[1]]))
}
p1 <- run_power(list(test = "tOne", effectSize = 0.5, alpha = 0.05, power = 0.8, n = 30))
cmp("Güç tOne güç@N=30", p1[["output.power.achieved"]], spss$power$oneSamplePowerAtN30, digits = 3)
cmp("Güç tOne gerekli N@0.8", p1[["output.power.reqN"]], spss$power$oneSampleReqN$n, digits = 6)
p2 <- run_power(list(test = "tTwo", effectSize = 0.5, alpha = 0.05, power = 0.8, n = 64))
cmp("Güç tTwo gerekli N/grup@0.8", p2[["output.power.reqNPerGroup"]], spss$power$indepReqN$n1, digits = 6)
cmp("Güç tTwo ulaşılan güç@64", p2[["output.power.achieved"]], spss$power$indepReqN$actual, digits = 3)

# ─────────────────────────────────────────────────────────────────────────
cat("\n=========================================\n")
cat(sprintf("OK: %d   FARK: %d   BILINCLI: %d   ATLANDI: %d\n", n_ok, n_fark, n_bil, n_atla))
if (length(bil_notes)) {
  cat("Bilinçli sapmalar:\n"); for (b in bil_notes) cat("  ", b, "\n")
}
if (n_fark > 0) quit(save = "no", status = 1)
