# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# _r_console.R — persistent R console for SAI (Faz T2, R Terminal mode).
#
# NOT an analysis script. This is the interactive R terminal (RStudio-category:
# the user's own local code on their own machine — see CLAUDE.md §9 exception).
# It runs a REPL loop over stdin so a single R process stays alive across commands.
#
# Protocol (driven by electron/ipc/r-session.ts):
#   • stdin : command lines, then a line "__SAI_END__<id>" marking the block end.
#             Between commands only: "__SAI_COMPLETE__<id> <json string>" asks for
#             completions of that line prefix (answered at once, nothing evaluated).
#   • stdout: the command's printed output, streamed; then "__SAI_DONE__<id>".
#             Side-channel markers (anywhere in a line, path/JSON to end of line):
#             __SAI_PLOT__ · __SAI_TABLE__ · __SAI_VIEW__ · __SAI_HELP__ · __SAI_COMMIT__ ·
#             __SAI_ENV__ · __SAI_COMPLETIONS__<id>
#   • stderr: warnings / messages / errors; after each command "__SAI_EDONE__<id>"
#             (the two pipes are not ordered against each other).
#   • On startup, once ready: prints "__SAI_READY__".
#
# Started as `Rscript -` + one stdin line source()-ing this file, so R's own
# console input is stdin: browser() / debug() / debugonce() read their
# commands (n, s, f, c, expressions) from the same pipe. With echo on, R prints
# its "Browse[n]> " prompt — r-session.ts takes that as "the debugger waits".
# Leaving the debugger goes through the "sai_abort" restart, not Q: Q jumps to
# the top level, which ends a non-interactive R.
#
# The dataset is bridged READ-ONLY as `data` (a Parquet copy). `sai_data()`
# re-reads it. sai_commit() never edits it either — it offers a NEW dataset.
#
# Session helpers (sai_data, sai_show, View, sai_commit) live in an attached "sai:tools"
# environment, and internals are dot-prefixed — so the Environment pane shows
# only the user's own objects and `rm(list = ls())` can't break the console.

try(local({
  user_lib <- file.path(path.expand("~"), "R", "library", paste(R.version$major, strsplit(R.version$minor, ".", fixed = TRUE)[[1]][1], sep = "."))
  # Same per-version folder and normalized-path comparison as _bootstrap.R (raw %in% never matched
  # on Windows because path.expand("~") keeps backslashes).
  norm <- function(p) normalizePath(p, winslash = "/", mustWork = TRUE)
  if (dir.exists(user_lib) && !(norm(user_lib) %in% norm(.libPaths()))) .libPaths(c(user_lib, .libPaths()))
}), silent = TRUE) # best effort, see _bootstrap.R
suppressWarnings(suppressPackageStartupMessages({
  library(jsonlite)
  library(arrow)
}))

options(width = 10000)
# cli / crayon (tidyverse messages) see a pipe, not a terminal, and would drop
# their colours; the console renders the 8 basic ANSI colours (src/lib/ansi.ts).
options(cli.num_colors = 8L, crayon.enabled = TRUE, crayon.colors = 8L)
# Package names complete inside library()/require() too.
try(utils::rc.settings(ipck = TRUE), silent = TRUE)

# Side files (plots, tables, View() snapshots, help pages) go to the directory
# r-session.ts created for this session — it only accepts paths inside it.
.sai_plotdir <- Sys.getenv("SAI_R_SIDE_DIR")
if (!nzchar(.sai_plotdir)) .sai_plotdir <- tempfile("sai_plots_")
dir.create(.sai_plotdir, showWarnings = FALSE, recursive = TRUE)
.sai_plotseq <- 0L

.sai_next_file <- function(prefix, ext) {
  .sai_plotseq <<- .sai_plotseq + 1L
  file.path(.sai_plotdir, sprintf("%s_%d.%s", prefix, .sai_plotseq, ext))
}

.sai_emit <- function(marker, value) {
  cat(marker, value, "\n", sep = ""); flush(stdout())
}

#' Message/warning/error text, sent through stdout so it stays in order with
#' printed output: stdout and stderr are separate pipes and reach the console
#' in no fixed order (cat("a"); message("b"); cat("c") came out a, c, b).
#' Under a sink() it goes to real stderr — R does not sink messages — and so
#' does it when the user diverted messages (sink(type = "message")).
.sai_stderr <- function(txt) {
  if (sink.number() > 0 || sink.number(type = "message") != 2L) {
    cat(txt, file = stderr())
    return(invisible())
  }
  .sai_emit("__SAI_STDERR__", jsonlite::toJSON(txt, auto_unbox = TRUE))
}

# ── Plot capture (Faz T2.2) ───────────────────────────────────────────────────
# Draw into an off-screen PNG device with display-list recording on. After each
# command we replay any recorded plot into a real PNG file and emit its path via
# "__SAI_PLOT__<path>" so r-session.ts can stream it to the terminal plot pane.
.sai_open_capture <- function() {
  try({
    grDevices::png(tempfile(fileext = ".png"), width = 900, height = 600, res = 110)
    grDevices::dev.control("enable")
  }, silent = TRUE)
}

# The recorded plots behind the plot pane, by the number in their file name
# (plot_<n>.png) — kept so "Export" can redraw one at any size/format. Same cap
# as the pane (terminal-store MAX_PLOTS).
.sai_plots <- list()
.SAI_MAX_PLOTS <- 20L

.sai_capture <- function() {
  dl <- tryCatch(grDevices::recordPlot(), error = function(e) NULL)
  if (is.null(dl) || length(dl[[1]]) == 0) return(invisible())
  f <- .sai_next_file("plot", "png")
  .sai_plots[[as.character(.sai_plotseq)]] <<- dl
  if (length(.sai_plots) > .SAI_MAX_PLOTS) .sai_plots <<- utils::tail(.sai_plots, .SAI_MAX_PLOTS)
  try({
    grDevices::png(f, width = 900, height = 600, res = 110)
    grDevices::replayPlot(dl)
    grDevices::dev.off()
    .sai_emit("__SAI_PLOT__", f)
  }, silent = TRUE)
  # Reset the capture device so the next command starts with an empty display list.
  try(grDevices::dev.off(), silent = TRUE)
  .sai_open_capture()
}

#' Redraw recorded plot `id` into `path` (Export from the plot pane). Sizes in
#' cm; `dpi` applies to PNG only (SVG/PDF are vector). The capture device stays
#' current afterwards so the next command's plot is still recorded.
.sai_export_plot <- function(req_id, id, path, format, width_cm, height_cm, dpi) {
  dl <- .sai_plots[[as.character(id)]]
  before <- grDevices::dev.cur()
  res <- tryCatch({
    if (is.null(dl)) stop("plot_gone")
    w <- width_cm / 2.54
    h <- height_cm / 2.54
    switch(format,
      # Pixels rounded here (units = "in" would truncate) — the dialog shows the same numbers.
      png = grDevices::png(path, width = round(w * dpi), height = round(h * dpi), res = dpi),
      svg = grDevices::svg(path, width = w, height = h),
      pdf = grDevices::pdf(path, width = w, height = h),
      stop("unknown format")
    )
    grDevices::replayPlot(dl)
    list(ok = TRUE)
  }, error = function(e) list(ok = FALSE, error = conditionMessage(e)))
  if (grDevices::dev.cur() != before) try(grDevices::dev.off(), silent = TRUE)
  if (before %in% grDevices::dev.list()) grDevices::dev.set(before)
  .sai_emit(paste0("__SAI_PLOTEXPORT__", req_id, " "), jsonlite::toJSON(res, auto_unbox = TRUE))
  invisible()
}

.sai_parquet <- ""
local({
  a <- commandArgs(trailingOnly = TRUE)
  if (length(a) >= 1 && nzchar(a[1])) .sai_parquet <<- a[1]
})

# ── Help pages → the Help pane ────────────────────────────────────────────────
# `?topic` / help(topic) render as text and go through the pager; ours writes a
# clean copy (overstrike bold/underline stripped) and hands it to the app.
options(
  help_type = "text",
  pager = function(files, header = "", title = "", delete.file = FALSE) {
    txt <- unlist(lapply(files, function(f) readLines(f, warn = FALSE, encoding = "UTF-8")))
    txt <- gsub(".\b", "", txt, useBytes = TRUE)
    out <- .sai_next_file("help", "txt")
    writeLines(enc2utf8(txt), out, useBytes = TRUE)
    if (isTRUE(delete.file)) unlink(files)
    .sai_emit("__SAI_HELP__", jsonlite::toJSON(list(path = out, title = as.character(title)[1]), auto_unbox = TRUE))
    invisible()
  }
)

# ── User-facing helpers (attached as "sai:tools") ─────────────────────────────
.sai_tools <- new.env()

#' Re-read the bridged dataset (read-only snapshot exported by the app).
.sai_tools$sai_data <- function() {
  if (!nzchar(.sai_parquet) || !file.exists(.sai_parquet)) {
    stop("No dataset is bridged into this session.")
  }
  as.data.frame(arrow::read_parquet(.sai_parquet))
}

.sai_as_df <- function(x) {
  df <- tryCatch(as.data.frame(x, stringsAsFactors = FALSE), error = function(e) NULL)
  if (is.null(df) || ncol(df) == 0) return(NULL)
  df
}

#' Promote a data.frame-like object to the app's Output tab as a table.
#' Explicit, opt-in ("send this to Output"); capped at 500 rows.
.sai_tools$sai_show <- function(x, title = NULL) {
  df <- .sai_as_df(x)
  if (is.null(df)) {
    message("sai_show: expects a data.frame-like object.")
    return(invisible())
  }
  if (nrow(df) > 500) df <- df[seq_len(500), , drop = FALSE]
  rows <- lapply(seq_len(nrow(df)), function(i) unname(as.list(df[i, , drop = FALSE])))
  obj <- list(columns = as.list(names(df)), rows = rows)
  if (!is.null(title)) obj$title <- as.character(title)[1]
  f <- .sai_next_file("table", "json")
  # digits = NA — see _bootstrap.R for why the jsonlite default (4 decimal
  # places, not significant figures) is unsafe for statistical output.
  writeLines(jsonlite::toJSON(obj, auto_unbox = TRUE, na = "null", null = "null", digits = NA), f)
  .sai_emit("__SAI_TABLE__", f)
  invisible()
}

#' Open a data.frame-like object in the app's data viewer (read-only grid,
#' all rows, sortable). Replaces utils::View for this session.
.sai_tools$View <- function(x, title) {
  if (missing(title)) title <- paste(deparse(substitute(x)), collapse = "")
  df <- .sai_as_df(x)
  if (is.null(df)) {
    message("View: expects a data.frame-like object.")
    return(invisible())
  }
  # Meaningful row names (matrices, aggregates) become a leading column.
  if (.row_names_info(df) > 0) df <- cbind(`(row)` = rownames(df), df, stringsAsFactors = FALSE)
  # Parquet can't hold list/complex columns — show them as text.
  df[] <- lapply(df, function(col) {
    if (is.list(col) || is.complex(col)) vapply(col, function(v) paste(format(v), collapse = ", "), "")
    else if (inherits(col, "POSIXlt")) as.POSIXct(col)
    else col
  })
  names(df) <- make.unique(ifelse(nzchar(names(df)), names(df), "V"))
  f <- .sai_next_file("view", "parquet")
  ok <- tryCatch({ arrow::write_parquet(df, f); TRUE }, error = function(e) {
    message("View: ", conditionMessage(e)); FALSE
  })
  if (ok) .sai_emit("__SAI_VIEW__", jsonlite::toJSON(list(path = f, title = substr(title, 1, 80)), auto_unbox = TRUE))
  invisible()
}

#' Showing an htmlwidget (plotly, DT, leaflet …) opens it in the app's Viewer
#' tab. Rscript is non-interactive, so htmlwidgets' own print method would do
#' nothing. Written as index.html + lib/ (self-contained output needs pandoc).
.sai_show_widget <- function(x) {
  .sai_plotseq <<- .sai_plotseq + 1L
  d <- file.path(.sai_plotdir, sprintf("widget_%d", .sai_plotseq))
  dir.create(d, showWarnings = FALSE)
  ok <- tryCatch({
    htmlwidgets::saveWidget(x, file.path(d, "index.html"), selfcontained = FALSE, libdir = "lib")
    TRUE
  }, error = function(e) { message("Viewer: ", conditionMessage(e)); FALSE })
  if (ok) {
    .sai_emit("__SAI_WIDGET__", jsonlite::toJSON(
      list(dir = d, title = sprintf("%s %d", class(x)[1], .sai_plotseq)), auto_unbox = TRUE
    ))
  }
  invisible(x)
}

# Explicit print(w) too. S3 lookup skips attached environments (R >= 4), so the
# method goes into htmlwidgets' own registry once it loads — after its own
# registration, which it then replaces.
local({
  reg <- function(...) {
    registerS3method("print", "htmlwidget", function(x, ...) .sai_show_widget(x),
                     envir = asNamespace("htmlwidgets"))
  }
  if ("htmlwidgets" %in% loadedNamespaces()) reg()
  else setHook(packageEvent("htmlwidgets", "onLoad"), reg)
})

# Column/label helpers shared with import-stat.R, kept out of the user's workspace.
.sai_stat <- new.env()
local({
  self <- Sys.getenv("SAI_R_CONSOLE_SCRIPT")
  if (nzchar(self)) sys.source(file.path(dirname(self), "_stat_columns.R"), envir = .sai_stat)
})

#' Hand a data frame to the app as a NEW dataset (Faz T3 / T2.4). Goes through
#' the same importer as .sav files: factors arrive as codes + value labels, a
#' `label` attribute as the variable label. The app asks before replacing the
#' open dataset when it has unsaved changes; nothing here touches the current one.
.sai_tools$sai_commit <- function(x, name) {
  if (missing(name)) name <- paste(deparse(substitute(x)), collapse = "")
  df <- .sai_as_df(x)
  if (is.null(df) || nrow(df) == 0) {
    message("sai_commit: expects a data.frame-like object with at least one row.")
    return(invisible())
  }
  if (is.null(.sai_stat$as_stat_column)) {
    message("sai_commit: helper script _stat_columns.R was not found.")
    return(invisible())
  }
  names(df) <- make.unique(ifelse(nzchar(names(df)), names(df), "V"))
  cols <- lapply(df, .sai_stat$as_stat_column)
  meta <- lapply(names(cols), function(nm) .sai_stat$column_meta(cols[[nm]], nm))
  plain <- as.data.frame(lapply(cols, .sai_stat$plain_column), stringsAsFactors = FALSE,
                         check.names = FALSE, optional = TRUE)
  names(plain) <- names(df)
  f <- .sai_next_file("commit", "parquet")
  ok <- tryCatch({ arrow::write_parquet(plain, f); TRUE }, error = function(e) {
    message("sai_commit: ", conditionMessage(e)); FALSE
  })
  if (ok) {
    .sai_emit("__SAI_COMMIT__", jsonlite::toJSON(
      list(path = f, name = substr(as.character(name)[1], 1, 80), rows = nrow(plain),
           cols = ncol(plain), variables = meta),
      auto_unbox = TRUE, null = "null", digits = NA
    ))
  }
  invisible()
}

# ── sink() across commands ────────────────────────────────────────────────────
# The end-of-command markers go to stdout, so a sink left open after a command
# swallowed them and the console waited forever. This sink() remembers what it
# opened; between commands the loop lifts the sinks, writes the markers and
# puts them back (appending), so `sink("log.txt")` … `sink()` works across runs.
.sai_sinks <- new.env()
.sai_sinks$stack <- list()
.sai_tools$sink <- function(file = NULL, append = FALSE, type = c("output", "message"),
                            split = FALSE) {
  type <- match.arg(type)
  base::sink(file, append = append, type = type, split = split)
  if (type == "output") {
    st <- .sai_sinks$stack
    if (is.null(file)) {
      if (length(st) > 0) .sai_sinks$stack <- st[-length(st)]
    } else .sai_sinks$stack <- c(st, list(list(file = file, split = split)))
  }
  invisible()
}

.sai_lift_sinks <- function() {
  n <- sink.number()
  if (n == 0) return(NULL)
  st <- .sai_sinks$stack
  for (i in seq_len(n)) base::sink()
  .sai_sinks$stack <- list()
  # Opened with base::sink() — nothing to reopen; closing beats hanging.
  if (length(st) != n) {
    message("Note: the open sink() was closed; use sink() without base:: to keep one across commands.")
    return(NULL)
  }
  st
}

.sai_restore_sinks <- function(st) {
  for (s in st) {
    base::sink(s$file, append = TRUE, split = s$split)
    .sai_sinks$stack <- c(.sai_sinks$stack, list(s))
  }
}

# scan() from the console would wait for input this console can't send (stdin
# carries the commands), until Stop restarted the session.
.sai_tools$scan <- function(file = "", ...) {
  if (identical(file, "") && is.null(list(...)$text)) {
    stop("scan() cannot read from the console here; use scan(text = ...) or a file.", call. = FALSE)
  }
  base::scan(file = file, ...)
}

attach(.sai_tools, name = "sai:tools", warn.conflicts = FALSE)

if (nzchar(.sai_parquet) && file.exists(.sai_parquet)) {
  try(assign("data", sai_data(), envir = globalenv()), silent = TRUE)
}

# ── Environment pane ──────────────────────────────────────────────────────────
.sai_env_item <- function(n, envir = globalenv()) {
  x <- get(n, envir = envir)
  kind <- if (is.data.frame(x) || is.matrix(x)) "data" else if (is.function(x)) "function" else "value"
  dims <- if (kind == "data") as.integer(dim(x)) else NULL
  desc <- tryCatch({
    if (kind == "data") ""
    else if (is.function(x)) paste0("function(", paste(names(formals(args(x))), collapse = ", "), ")")
    else paste(trimws(utils::capture.output(
      utils::str(x, max.level = 0, give.attr = FALSE, vec.len = 2, nchar.max = 60, width = 80)
    )), collapse = " ")
  }, error = function(e) "")
  list(name = n, cls = class(x)[1], kind = kind, dims = dims,
       desc = substr(desc, 1, 160), size = as.numeric(utils::object.size(x)))
}

.sai_emit_env <- function() {
  items <- tryCatch(
    lapply(utils::head(sort(ls(globalenv())), 300), .sai_env_item),
    error = function(e) list()
  )
  .sai_emit("__SAI_ENV__", jsonlite::toJSON(items, auto_unbox = TRUE, null = "null", digits = NA))
}

#' While the debugger waits: the browsed function's own variables and its
#' call (r-session.ts sends `.sai_emit_frame(environment(), sys.call())` at
#' the Browse prompt). Reading an unevaluated argument forces it, as ls.str()
#' does; one that is missing or fails shows as an empty value.
.sai_emit_frame <- function(envir, call) {
  if (identical(envir, globalenv())) return(.sai_emit_env())
  item <- function(n) tryCatch(.sai_env_item(n, envir), error = function(e) {
    list(name = n, cls = "", kind = "value", dims = NULL, desc = "", size = 0)
  })
  items <- tryCatch(lapply(utils::head(sort(ls(envir)), 300), item), error = function(e) list())
  frame <- if (is.null(call)) "" else paste(deparse(call, nlines = 1L), collapse = "")
  .sai_emit("__SAI_ENV__", jsonlite::toJSON(
    list(frame = substr(frame, 1, 120), items = items), auto_unbox = TRUE, null = "null", digits = NA
  ))
}

# ── Packages pane ─────────────────────────────────────────────────────────────
#' Installed packages (all libraries on the path) + whether each is attached.
#' `user_lib`: the folder the app installs into, put on the path first — it may
#' not have existed when this session started (R drops missing R_LIBS dirs).
.sai_emit_pkgs <- function(user_lib = NULL) {
  if (!is.null(user_lib) && dir.exists(user_lib)) .libPaths(unique(c(user_lib, .libPaths())))
  ip <- tryCatch(utils::installed.packages(fields = character(0)), error = function(e) NULL)
  items <- if (is.null(ip)) list() else {
    ip <- ip[!duplicated(ip[, "Package"]), , drop = FALSE]
    lapply(seq_len(nrow(ip)), function(i) list(
      name = unname(ip[i, "Package"]),
      version = unname(ip[i, "Version"]),
      lib = normalizePath(unname(ip[i, "LibPath"]), winslash = "/", mustWork = FALSE),
      attached = paste0("package:", ip[i, "Package"]) %in% search()
    ))
  }
  .sai_emit("__SAI_PKGS__", jsonlite::toJSON(items, auto_unbox = TRUE))
  .sai_last_search <<- search()
  invisible()
}

# Once the pane has asked for the list, a library()/detach() typed anywhere
# re-sends it (search path changed) — no installed.packages() scan otherwise.
.sai_last_search <- NULL
.sai_pkgs_if_changed <- function() {
  if (!is.null(.sai_last_search) && !identical(search(), .sai_last_search)) .sai_emit_pkgs()
}

# ── Files pane ────────────────────────────────────────────────────────────────
#' The working directory and its entries (at most 500), sent after a command
#' only when the folder or its contents changed — a large folder is not
#' re-listed on every keystroke-sized command. `force` re-sends regardless
#' (the pane's Refresh button).
.sai_last_wd <- NULL
.sai_emit_wd <- function(force = FALSE) {
  wd <- tryCatch(normalizePath(getwd(), winslash = "/"), error = function(e) "")
  all <- tryCatch(list.files(wd, all.files = FALSE, no.. = TRUE), error = function(e) character(0))
  shown <- utils::head(all, 500)
  info <- if (length(shown)) file.info(file.path(wd, shown), extra_cols = FALSE) else NULL
  sig <- c(wd, shown, if (is.null(info)) character(0) else as.character(info$mtime))
  if (!force && identical(sig, .sai_last_wd)) return(invisible())
  .sai_last_wd <<- sig
  files <- if (is.null(info)) list() else lapply(seq_along(shown), function(i) {
    dir <- isTRUE(info$isdir[i])
    list(name = shown[i], dir = dir,
         size = if (dir || is.na(info$size[i])) 0 else as.numeric(info$size[i]))
  })
  .sai_emit("__SAI_WD__", jsonlite::toJSON(
    list(wd = wd, total = length(all), files = files), auto_unbox = TRUE
  ))
}

# ── Completion ────────────────────────────────────────────────────────────────
# R's own completion engine (the one the plain R console uses for Tab).
.sai_complete <- function(id, line) {
  res <- tryCatch({
    utils:::.assignLinebuffer(line)
    utils:::.assignEnd(nchar(line))
    token <- utils:::.guessTokenFromLine()
    utils:::.completeToken()
    comps <- utils::head(utils:::.retrieveCompletions(), 200)
    items <- lapply(comps, function(cm) {
      fn <- !grepl("[=$@:]", cm) && exists(cm, envir = globalenv()) &&
        is.function(get(cm, envir = globalenv()))
      args <- if (fn) tryCatch(paste(names(formals(args(get(cm, envir = globalenv())))), collapse = ", "),
                               error = function(e) "") else ""
      list(text = cm, fn = fn, args = args)
    })
    list(token = token, items = items)
  }, error = function(e) list(token = "", items = list()))
  .sai_emit(paste0("__SAI_COMPLETIONS__", id, " "), jsonlite::toJSON(res, auto_unbox = TRUE))
}

#' A condition's message as UTF-8. Some of R's own translated messages (e.g. the
#' Turkish "infinite recursion" error) come back in the Windows code page.
.sai_msg <- function(cond) {
  m <- conditionMessage(cond)
  if (.Platform$OS.type == "windows" && !all(validUTF8(m))) m <- iconv(m, "CP1254", "UTF-8", sub = "?")
  m
}

#' Evaluate one command block in the global env, auto-printing visible values.
.sai_run <- function(code) {
  exprs <- tryCatch(parse(text = code), error = function(e) {
    .sai_stderr(paste0("Error: ", .sai_msg(e), "\n")); NULL
  })
  if (is.null(exprs)) return(invisible())
  for (e in exprs) {
    tb <- NULL
    stopped <- FALSE
    # The debugger's Stop: browser() resets the condition handlers but keeps
    # restarts, so this is the one way back here from inside it.
    withRestarts(tryCatch(
      withCallingHandlers(
        {
          res <- withVisible(eval(e, envir = globalenv()))
          if (res$visible) {
            if (inherits(res$value, "htmlwidget")) .sai_show_widget(res$value)
            else print(res$value)
          }
        },
        # options(warn=): 2+ lets R turn it into an error, below 0 hides it.
        warning = function(w) {
          warn <- getOption("warn", 0)
          if (warn >= 2) return()
          if (warn >= 0) .sai_stderr(paste0("Warning: ", .sai_msg(w), "\n"))
          invokeRestart("muffleWarning")
        },
        message = function(m) {
          .sai_stderr(conditionMessage(m))
          invokeRestart("muffleMessage")
        },
        # Still inside the failing call: the stack is intact here, not in tryCatch.
        error = function(err) tb <<- .sai_traceback(sys.calls())
      ),
      interrupt = function(i) .sai_stderr("Interrupted.\n"),
      error = function(err) {
        call <- conditionCall(err)
        # A top-level stop() reports our own eval() as its call; R says "Error: msg".
        if (identical(call, quote(eval(e, envir = globalenv())))) call <- NULL
        # R's own wording: "Error in f(x) : msg" when the call is known.
        .sai_stderr(if (is.null(call)) paste0("Error: ", .sai_msg(err), "\n")
                    else paste0("Error in ", paste(deparse(call, nlines = 1L), collapse = ""), " : ",
                                .sai_msg(err), "\n"))
        if (length(tb) > 0) .sai_emit("__SAI_TRACEBACK__", jsonlite::toJSON(tb))
      }
    ), sai_abort = function() stopped <<- TRUE)
    # The rest of the block is not run after a Stop.
    if (stopped) break
  }
  invisible()
}

#' The user's part of the call stack at an error, innermost last: everything
#' after our eval(e, …) frame, minus R's condition-handling frames.
.sai_traceback <- function(calls) {
  txt <- vapply(calls, function(cl) paste(deparse(cl, nlines = 1L), collapse = ""), "")
  start <- utils::tail(which(txt == "eval(e, envir = globalenv())"), 1)
  if (length(start) == 0) return(character(0))
  user <- txt[-seq_len(start)]
  # An error from a primitive (data$x on a function) calls our handler directly.
  user <- user[!grepl("^(\\.handleSimpleError|h\\(simpleError|withCallingHandlers|\\.sai_traceback|\\(function \\(err\\))", user)]
  utils::head(user, 50)
}

.sai_open_capture()
# Prompts + echo for R's own console reads (the debugger's) — see the header.
# Error calls off: an error typed at the Browse prompt would print R's
# internal stack ("Calls: source ... tryCatchList ...").
options(echo = TRUE, showErrorCalls = FALSE)
cat("__SAI_READY__\n"); flush(stdout())
.sai_emit_env()
.sai_emit_wd()

# The loop's own variables live in a local scope, not the user's workspace.
local({
  con <- file("stdin")
  open(con, blocking = TRUE)
  buf <- character(0)
  repeat {
    line <- readLines(con, n = 1, warn = FALSE)
    if (length(line) == 0) break  # EOF — stdin closed, exit loop
    m <- regmatches(line, regexec("^__SAI_END__(.+)$", line))[[1]]
    if (length(m) == 2) {
      .sai_run(paste(buf, collapse = "\n"))
      sinks <- .sai_lift_sinks()
      .sai_capture()
      .sai_emit_env()
      .sai_emit_wd()
      .sai_pkgs_if_changed()
      buf <- character(0)
      # stderr is a separate pipe and can arrive after stdout's DONE; this
      # tells r-session.ts the command's messages/errors are all through.
      cat("__SAI_EDONE__", m[2], "\n", sep = "", file = stderr())
      flush(stderr())
      cat("__SAI_DONE__", m[2], "\n", sep = "")
      flush(stdout())
      .sai_restore_sinks(sinks)
      next
    }
    cm <- regmatches(line, regexec("^__SAI_COMPLETE__([0-9a-f]+) (.*)$", line))[[1]]
    if (length(cm) == 3 && length(buf) == 0) {
      .sai_complete(cm[2], tryCatch(jsonlite::fromJSON(cm[3]), error = function(e) ""))
      next
    }
    buf <- c(buf, line)
  }
})
