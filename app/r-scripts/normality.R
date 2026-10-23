# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# normality.R — Normality View (kalıcı sekme) için toplu normallik profili.
#
# Params (from JSON):
#   parquetPath  — path to the exported Parquet dataset
#   rScriptsDir  — directory containing _bootstrap.R
#   variables    — character vector of scale colIds
#   varNames     — named list colId → display name (label)
#
# Output:
#   tables[0] — satır = değişken; sütunlar zengin istatistik seti.
#               Son iki sütun teknik: "__colId" (eşleştirme) ve
#               "__spark" (mini histogram bin sayımları, JSON dizi string'i).
#   plots[]   — değişken başına 4 plot; titleKey = "<colId>|<kind>" formatında,
#               kind ∈ { histogram, qq, detrended, boxplot }. Renderer parse eder.
#
# Notlar:
#   - Kolmogorov-Smirnov: SPSS uyumu için Lilliefors düzeltmeli (nortest::lillie.test).
#     nortest yoksa düz ks.test'e düşülür ve bir uyarı eklenir.
#   - Shapiro-Wilk yalnız 3 ≤ n ≤ 5000 için geçerli; dışında hücreler NULL.

suppressPackageStartupMessages(library(jsonlite))

.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(
  paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
  simplifyVector = FALSE
)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))

params <- read_params()
df     <- load_data(params)

# Tablo sütun anahtarları (renderer i18n çevirir). Son iki sütun teknik:
# "__colId" satır↔plot eşleşmesi, "__spark" mini histogram bin sayımları.
NORMALITY_COLUMNS <- list(
  "output.normality.col.variable",   "output.normality.col.n",
  "output.normality.col.missing",    "output.normality.col.mean",
  "output.normality.col.median",     "output.normality.col.sd",
  "output.normality.col.min",        "output.normality.col.max",
  "output.normality.col.range",      "output.normality.col.skewness",
  "output.normality.col.seSkewness", "output.normality.col.zSkewness",
  "output.normality.col.kurtosis",   "output.normality.col.seKurtosis",
  "output.normality.col.zKurtosis",  "output.normality.col.ksStat",
  "output.normality.col.ksDf",       "output.normality.col.ksSig",
  "output.normality.col.swStat",     "output.normality.col.swDf",
  "output.normality.col.swSig",      "output.normality.col.decision",
  "__colId", "__spark"
)

tryCatch({
  progress(10L, "progress.loading")

  variables <- unlist(params$variables)
  var_names <- params$varNames

  if (length(variables) == 0) {
    # Hiç scale değişken yok — boş tablo döndür (hata değil).
    sai_output(tables = list(list(
      titleKey    = "output.normality.title",
      columns     = NORMALITY_COLUMNS,
      rows        = list(),
      footnoteKey = NULL
    )))
    quit(save = "no", status = 0)
  }

  BAR_COLOR  <- "#3b6ea5"
  CURVE_COLOR <- "#d9534f"

  # Large-n plot sampling (chunked-load-roadmap.md follow-up, 2026-07-19):
  # histogram/boxplot are aggregations already (bin counts / quartiles) and
  # are computed from the FULL vals below, so they never need sampling. The
  # QQ/detrended-QQ scatter plots genuinely need one point per case, which is
  # what makes them (not the statistical tests) the actual cost driver at
  # 500K-row scale — as.list()'ing a 500K-length vector into the Plotly JSON
  # blows past the 120s R timeout. Above the threshold, sample down to
  # PLOT_SAMPLE_POINTS points systematically (in sorted order, endpoints kept)
  # so the tails — the diagnostically important part of a QQ plot — are never
  # dropped. Threshold matches shapiro.test()'s own n<=5000 cutoff, already a
  # familiar number in this script. Every stat in the table (mean/median/sd/
  # skewness/kurtosis/KS/Shapiro-Wilk) still runs on the full, unsampled vals.
  PLOT_SAMPLE_POINTS <- 5000L
  any_plot_sampled <- FALSE

  #' Indices (into a length-`n` sorted sequence) to keep for plotting: all of
  #' them if n <= PLOT_SAMPLE_POINTS, else an evenly spaced subset that always
  #' includes position 1 and position n.
  sample_plot_idx <- function(n) {
    if (n <= PLOT_SAMPLE_POINTS) return(seq_len(n))
    unique(as.integer(round(seq(1, n, length.out = PLOT_SAMPLE_POINTS))))
  }

  # calc_skewness()/calc_kurtosis() are _bootstrap.R's wtd_skewness()/
  # wtd_kurtosis() (w = NULL reproduces this exactly); se_skewness()/
  # se_kurtosis() are _bootstrap.R shared helpers too.
  calc_skewness <- function(x) wtd_skewness(x, NULL)
  calc_kurtosis <- function(x) wtd_kurtosis(x, NULL)

  has_nortest <- requireNamespace("nortest", quietly = TRUE)
  warnings_out <- character(0)
  if (!has_nortest) {
    warnings_out <- c(warnings_out, "output.normality.warning.noLilliefors")
  }

  rnd <- function(x, d = 6) if (is.null(x) || is.na(x)) NULL else round(x, d)

  all_rows  <- list()
  all_plots <- list()
  n_vars    <- length(variables)

  for (vi in seq_along(variables)) {
    col_id   <- variables[vi]
    var_name <- if (!is.null(var_names[[col_id]])) var_names[[col_id]] else col_id
    progress(as.integer(10 + 80 * (vi - 1) / n_vars), "progress.computing")

    if (!col_id %in% names(df)) next

    raw   <- suppressWarnings(as.numeric(df[[col_id]]))
    n_tot <- length(raw)
    vals  <- raw[!is.na(raw)]
    n     <- length(vals)
    missing <- n_tot - n

    if (n == 0) {
      all_rows <- c(all_rows, list(list(
        var_name, n, missing,
        NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL,
        "na", col_id, "[]"
      )))
      next
    }

    m    <- mean(vals)
    medv <- median(vals)
    sdv  <- if (n > 1) sd(vals) else NA_real_
    mn   <- min(vals)
    mx   <- max(vals)
    rng  <- mx - mn

    skew  <- if (n > 2) calc_skewness(vals) else NA_real_
    seSk  <- if (n > 2) se_skewness(n) else NA_real_
    zSk   <- if (!is.na(skew) && !is.na(seSk) && seSk != 0) skew / seSk else NA_real_
    kurt  <- if (n > 3) calc_kurtosis(vals) else NA_real_
    seKu  <- if (n > 3) se_kurtosis(n) else NA_real_
    zKu   <- if (!is.na(kurt) && !is.na(seKu) && seKu != 0) kurt / seKu else NA_real_

    # ── Kolmogorov-Smirnov (Lilliefors düzeltmeli) ──────────────────────────────
    ks_stat <- NA_real_; ks_p <- NA_real_; ks_df <- n
    if (n >= 4 && sdv > 0) {
      if (has_nortest) {
        kt <- tryCatch(nortest::lillie.test(vals), error = function(e) NULL)
        if (!is.null(kt)) { ks_stat <- unname(kt$statistic); ks_p <- kt$p.value }
      } else {
        kt <- tryCatch(
          suppressWarnings(ks.test(vals, "pnorm", mean = m, sd = sdv)),
          error = function(e) NULL
        )
        if (!is.null(kt)) { ks_stat <- unname(kt$statistic); ks_p <- kt$p.value }
      }
    }

    # ── Shapiro-Wilk (3 ≤ n ≤ 5000) ─────────────────────────────────────────────
    sw_stat <- NA_real_; sw_p <- NA_real_; sw_df <- if (n >= 3 && n <= 5000) n else NA_integer_
    if (n >= 3 && n <= 5000 && sdv > 0) {
      sw <- tryCatch(shapiro.test(vals), error = function(e) NULL)
      if (!is.null(sw)) { sw_stat <- unname(sw$statistic); sw_p <- sw$p.value }
    }

    # ── Karar (α = .05): birincil ölçüt Shapiro-Wilk, yoksa K-S ─────────────────
    decision <- "na"
    primary_p <- if (!is.na(sw_p)) sw_p else ks_p
    if (!is.na(primary_p)) decision <- if (primary_p >= 0.05) "normal" else "notNormal"

    # ── Mini histogram bin sayımları (sparkline) ────────────────────────────────
    spark <- "[]"
    if (n >= 2 && rng > 0) {
      brks  <- seq(mn, mx, length.out = 25) # 24 bin
      counts <- hist(vals, breaks = brks, include.lowest = TRUE, plot = FALSE)$counts
      spark <- toJSON(as.integer(counts), auto_unbox = FALSE)
    }

    all_rows <- c(all_rows, list(list(
      var_name, n, missing,
      rnd(m), rnd(medv), rnd(sdv), rnd(mn), rnd(mx), rnd(rng),
      rnd(skew), rnd(seSk), rnd(zSk), rnd(kurt), rnd(seKu), rnd(zKu),
      rnd(ks_stat), ks_df, rnd(ks_p),
      rnd(sw_stat), sw_df, rnd(sw_p),
      decision, col_id, spark
    )))

    # ── Detay plotları (yalnız anlamlı dağılım için) ────────────────────────────
    if (n >= 3 && !is.na(sdv) && sdv > 0) {
      # 1) Histogram + normal eğri — R'ın hist() ile FULL veriden bin sayımı
      # önceden hesaplanır (SPSS de histogramı böyle üretir); Plotly'ye ham
      # nokta yerine sabit boyutlu (nbins) bar verisi gider — n'den bağımsız,
      # örnekleme gerektirmez, doğruluk kaybı yok.
      nbins    <- max(1L, nclass.Sturges(vals))
      binwidth <- rng / nbins
      if (!is.finite(binwidth) || binwidth <= 0) binwidth <- 1
      brks_h    <- seq(mn, mx + binwidth, by = binwidth)
      hist_counts <- hist(vals, breaks = brks_h, include.lowest = TRUE, plot = FALSE)
      bar_x <- hist_counts$mids
      bar_y <- hist_counts$counts
      xs   <- seq(mn, mx, length.out = 128)
      dens <- dnorm(xs, mean = m, sd = sdv)
      # Yoğunluğu frekans ölçeğine getir (n * binwidth).
      ys   <- dens * n * binwidth
      hist_plot <- list(
        data = list(
          list(type = "bar", x = as.list(bar_x), y = as.list(bar_y),
               marker = list(color = BAR_COLOR), opacity = 0.85,
               width = binwidth * 0.98, name = "Frequency"),
          list(type = "scatter", mode = "lines",
               x = as.list(xs), y = as.list(ys),
               line = list(color = CURVE_COLOR, width = 2), name = "Normal")
        ),
        layout = list(
          xaxis = list(title = list(text = var_name)),
          yaxis = list(title = list(text = "Frequency")),
          bargap = 0.02, showlegend = FALSE,
          margin = list(t = 20, r = 20, b = 40, l = 50)
        )
      )
      all_plots <- c(all_plots, list(list(
        titleKey = paste0(col_id, "|histogram"), type = "plotly", data = hist_plot
      )))

      # 2) Normal Q-Q — istatistikler (ref doğrusu çeyrekleri) FULL samp/theo
      # üzerinden hesaplanır; yalnız çizilecek nokta dizisi büyük n'de
      # örneklenir (sıralı sırada, uçlar korunarak — kuyruklar QQ'nun asıl
      # teşhis değeri taşıyan kısmıdır).
      qq    <- qqnorm(vals, plot.it = FALSE)
      theo  <- qq$x; samp <- qq$y
      lim   <- range(c(theo))
      # Referans doğrusu: SPSS gibi 1. ve 3. çeyrek üzerinden.
      q_y <- quantile(samp, c(0.25, 0.75)); q_x <- qnorm(c(0.25, 0.75))
      slope <- diff(q_y) / diff(q_x); intercept <- q_y[1] - slope * q_x[1]
      ref_x <- lim; ref_y <- intercept + slope * lim

      qq_ord      <- order(samp)
      qq_plot_idx <- qq_ord[sample_plot_idx(length(qq_ord))]
      if (length(qq_plot_idx) < n) any_plot_sampled <- TRUE
      theo_s <- theo[qq_plot_idx]; samp_s <- samp[qq_plot_idx]

      qq_plot <- list(
        data = list(
          list(type = "scatter", mode = "markers",
               x = as.list(theo_s), y = as.list(samp_s),
               marker = list(color = BAR_COLOR, size = 5), name = "Observed"),
          list(type = "scatter", mode = "lines",
               x = as.list(ref_x), y = as.list(ref_y),
               line = list(color = CURVE_COLOR, width = 2), name = "Reference")
        ),
        layout = list(
          xaxis = list(title = list(text = "Theoretical Quantiles")),
          yaxis = list(title = list(text = "Observed Value")),
          showlegend = FALSE, margin = list(t = 20, r = 20, b = 40, l = 50)
        )
      )
      all_plots <- c(all_plots, list(list(
        titleKey = paste0(col_id, "|qq"), type = "plotly", data = qq_plot
      )))

      # 3) Detrended Q-Q: (gözlenen − beklenen) vs teorik — aynı örneklenmiş
      # index seti (qq_plot_idx) yeniden kullanılır, dev_y FULL samp/expected
      # üzerinden hesaplanır, yalnız çizim noktaları örneklenir.
      expected <- intercept + slope * theo
      dev_y    <- samp - expected
      dev_y_s  <- dev_y[qq_plot_idx]
      det_plot <- list(
        data = list(
          list(type = "scatter", mode = "markers",
               x = as.list(theo_s), y = as.list(dev_y_s),
               marker = list(color = BAR_COLOR, size = 5), name = "Deviation"),
          list(type = "scatter", mode = "lines",
               x = as.list(lim), y = as.list(c(0, 0)),
               line = list(color = CURVE_COLOR, width = 2, dash = "dash"),
               name = "Zero")
        ),
        layout = list(
          xaxis = list(title = list(text = "Theoretical Quantiles")),
          yaxis = list(title = list(text = "Deviation from Normal")),
          showlegend = FALSE, margin = list(t = 20, r = 20, b = 40, l = 50)
        )
      )
      all_plots <- c(all_plots, list(list(
        titleKey = paste0(col_id, "|detrended"), type = "plotly", data = det_plot
      )))

      # 4) Boxplot — quartile/whisker'lar Plotly'nin kendisi hesaplıyor, bu
      # yüzden büyük n'de FULL vals yerine sıralı-örneklenmiş bir alt küme
      # veriliyor (uçlar korunur). n=5000 örneklemden hesaplanan çeyrekliklerin
      # örnekleme hatası, IQR'a kıyasla ihmal edilebilir düzeyde küçüktür —
      # görsel amaçlı bu plot için tablo istatistikleri (mean/median/sd, hepsi
      # FULL vals'tan) etkilenmez.
      box_ord      <- order(vals)
      box_plot_idx <- box_ord[sample_plot_idx(length(box_ord))]
      if (length(box_plot_idx) < n) any_plot_sampled <- TRUE
      vals_box <- vals[box_plot_idx]
      box_plot <- list(
        data = list(list(type = "box", y = as.list(vals_box), name = var_name,
                         boxpoints = "outliers", marker = list(color = BAR_COLOR))),
        layout = list(
          yaxis = list(title = list(text = var_name)),
          showlegend = FALSE, margin = list(t = 20, r = 20, b = 30, l = 50)
        )
      )
      all_plots <- c(all_plots, list(list(
        titleKey = paste0(col_id, "|boxplot"), type = "plotly", data = box_plot
      )))
    }
  }

  notes_out <- character(0)
  if (any_plot_sampled) {
    notes_out <- c(notes_out, "output.normality.note.plotsSampled")
  }

  progress(100L, "progress.done")
  sai_output(
    tables = list(list(
      titleKey    = "output.normality.title",
      columns     = NORMALITY_COLUMNS,
      rows        = all_rows,
      footnoteKey = NULL
    )),
    plots    = all_plots,
    warnings = warnings_out,
    notes    = notes_out
  )

}, error = function(e) {
  sai_error(conditionMessage(e))
})
