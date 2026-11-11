# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# _scale_common.R — helpers shared by the survey / scale scripts
# (likert-items.R, scale-report.R).

#' Response options of a Likert scale: scale_min..scale_max (whole numbers),
#' from the options when given, else from the data.
scale_range <- function(mat, opts) {
  num <- function(v) { x <- suppressWarnings(as.numeric(v)); if (length(x) == 1 && is.finite(x)) x else NA }
  lo <- num(opts$scaleMin); hi <- num(opts$scaleMax)
  if (is.na(lo)) lo <- floor(min(mat, na.rm = TRUE))
  if (is.na(hi)) hi <- ceiling(max(mat, na.rm = TRUE))
  if (hi <= lo) stop("The scale needs at least two response options")
  c(lo, hi)
}

#' Reverse-score: min + max - x.
reverse_score <- function(x, lo, hi) lo + hi - x

#' Score-interval interpretation (e.g. 1.00–1.80, 1.81–2.60 … for a 5-point
#' scale): the range is cut into as many equal intervals as there are
#' options, width (max - min) / options. A mean on a boundary belongs to the
#' lower interval, the convention the published tables use.
score_intervals <- function(lo, hi) {
  k <- hi - lo + 1; w <- (hi - lo) / k
  list(k = k, width = w, lower = lo + (seq_len(k) - 1) * w, upper = lo + seq_len(k) * w)
}
interval_of <- function(m, iv, lo) {
  if (!is.finite(m)) return(NA_integer_)
  i <- ceiling(round((m - lo) / iv$width, 10))
  as.integer(min(iv$k, max(1, i)))
}

#' Label of option `value` from a value -> label map (names are the values as
#' strings, "1" or "1.0"), falling back to the number itself.
option_label <- function(value, labels) {
  if (!is.null(labels) && length(labels)) {
    keys <- names(labels)
    hit <- which(suppressWarnings(as.numeric(keys)) == value)
    if (length(hit)) return(as.character(labels[[hit[1]]]))
  }
  format(value)
}

#' Interval table rows: "1.00 – 1.80", label.
interval_rows <- function(iv, lo, labels) {
  lapply(seq_len(iv$k), function(i) {
    a <- if (i == 1) iv$lower[i] else iv$lower[i] + 0.01
    list(as.integer(i), sprintf("%.2f – %.2f", a, iv$upper[i]), option_label(lo + i - 1, labels))
  })
}

#' Normality decision for skewness / kurtosis against a |value| <= cut rule.
normal_by <- function(sk, ku, cut) {
  if (!is.finite(sk) || !is.finite(ku)) return(NULL)
  if (abs(sk) <= cut && abs(ku) <= cut) "output.scale.normalYes" else "output.scale.normalNo"
}
