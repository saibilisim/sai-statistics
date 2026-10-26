// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * r-session.ts — the persistent R console (Faz T2).
 *
 * A single long-lived Rscript process running `_r_console.R`, driven over stdin
 * with a sentinel protocol. This is a SEPARATE execution lane from the one-shot
 * analysis job-manager — they never share R memory and don't block each other
 * (terminal.md §12). The dataset is bridged READ-ONLY as a Parquet copy.
 *
 * Security (CLAUDE.md §9 R-console exception): spawn(shell:false), no auto-run
 * (the renderer only writes on explicit user action), senderFrame-validated at
 * the IPC boundary. Arbitrary user R is allowed by design here — this is the
 * user's own machine, RStudio-category — but the data bridge is read-only so the
 * DuckDB master can't be corrupted.
 */

import { app, BrowserWindow, dialog } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { join, resolve, sep, dirname, basename } from 'path'
import { tmpdir } from 'os'
import { randomBytes, randomUUID } from 'crypto'
import { rmSync } from 'fs'
import { unlink, readFile, mkdtemp, rm, stat } from 'fs/promises'
import log from 'electron-log'
import { IPC } from '../../shared/ipc-contracts'
import type {
  FileOpenResult,
  RSessionStatus,
  TerminalRCompleteResult,
  TerminalRPkgInstallResult,
  TerminalRViewRowsResult
} from '../../shared/ipc-contracts'
import {
  TerminalRWriteRequestSchema,
  TerminalRRunRequestSchema,
  TerminalRStartRequestSchema,
  TerminalRReloadRequestSchema,
  TerminalRCompleteRequestSchema,
  TerminalRViewRowsRequestSchema,
  TerminalRViewCloseRequestSchema,
  TerminalRCommitResolveRequestSchema,
  TerminalRPlotExportRequestSchema,
  TerminalRPkgInstallRequestSchema,
  TerminalROpenFileRequestSchema,
  RConsoleWdMarkerSchema,
  SYNTAX_FILE_MAX_CHARS,
  RConsolePackagesMarkerSchema,
  RConsoleWidgetMarkerSchema,
  RConsoleTracebackMarkerSchema,
  RConsolePlotExportMarkerSchema,
  type TerminalRPlotExportRequest,
  RConsoleCommitMarkerSchema,
  RConsoleViewMarkerSchema,
  RConsoleHelpMarkerSchema,
  RConsoleEnvMarkerSchema,
  RConsoleCompleteMarkerSchema
} from '../../shared/ipc-schemas'
import { handleValidated } from './security'
import { getRscriptPath, rChildEnv, installRPackage, userRLibDir } from './r-bridge'
import { exportDatasetForConsole } from './db-handler'
import { loadRView, readRViewRows, dropRView, dropAllRViews } from './db-handler/rview-tables'
import { getSettings } from './settings-handler'
import { dialogText } from './file-handler/shared'
import { addWidget, clearWidgets } from './r-widgets'
import { sendConsoleCtrlC } from './win-console-interrupt'
import { approveSyntaxPath } from './file-handler/output-io'
import { importParquetAsDataset } from './file-handler/import-export'
import {
  StatVariablesSchema,
  toStatMetaMap,
  type StatFileVariableMeta
} from './file-handler/stat-metadata'

// ─── State ──────────────────────────────────────────────────────────────────

let win: BrowserWindow | null = null
let proc: ChildProcess | null = null
let status: RSessionStatus = 'dead'
let ready = false
let pendingId: string | null = null
let stdoutResidual = ''
// stderr is its own pipe: a command's last messages can arrive after its
// __SAI_DONE__ on stdout. R ends each command on stderr too
// (__SAI_EDONE__<id>); terminal:r:run answers once both ends were seen.
const EDONE = '__SAI_EDONE__'
const EDONE_LINE = /__SAI_EDONE__([0-9a-f]+)\r?\n/g
const EDONE_WAIT_MS = 2000
let stderrResidual = ''
const stderrDone = new Set<string>()
let stderrWait: { id: string; go: () => void; timer: NodeJS.Timeout } | null = null
let parquetPath: string | null = null
// True while kill() is tearing the process down on purpose — its 'exit' is
// then expected and must not be reported as a crash.
let killing = false
// Commands waiting for the session; `done` (terminal:r:run) hears when one
// finished — true at its __SAI_DONE__, false if the session went away first.
interface QueuedCommand {
  code: string
  done?: (ok: boolean) => void
}
const queue: QueuedCommand[] = []
let pendingDone: ((ok: boolean) => void) | null = null
// Per-session directory for R's side files (plots, tables, View() snapshots,
// help pages). Marker paths are only honoured inside it.
let sideDir: string | null = null
// Completion requests in flight (answered by __SAI_COMPLETIONS__<id>).
const completions = new Map<string, (r: TerminalRCompleteResult) => void>()
const COMPLETE_TIMEOUT_MS = 2000
const EMPTY_COMPLETION: TerminalRCompleteResult = { token: '', items: [] }
// sai_commit() snapshots waiting for the user's go-ahead (renderer guard).
interface PendingCommit {
  path: string
  name: string
  meta: Record<string, StatFileVariableMeta>
}
const pendingCommits = new Map<string, PendingCommit>()
let commitSeq = 0
// Plot exports in flight (answered by __SAI_PLOTEXPORT__<id>).
const plotExports = new Map<string, (r: { ok: boolean; error?: string }) => void>()
const PLOT_EXPORT_TIMEOUT_MS = 60_000
// Help pages larger than this are cut (a few package index pages are huge).
const HELP_MAX_CHARS = 400_000

// ─── Debugger (browser()) ─────────────────────────────────────────────────
// R's own browser reads the console = this process's stdin (see the header of
// _r_console.R). It waits when its "Browse[n]> " prompt is the unterminated
// tail of stdout; R then echoes each line it reads, which we drop (the
// renderer echoes what the user sent). Lines are fed one per prompt.
const BROWSE_PROMPT = /Browse\[(\d+)\]> $/
// R's continuation prompt — an incomplete expression typed at Browse.
const CONTINUE_PROMPT = '+ '
// Set from the first Browse prompt until the command's __SAI_DONE__.
let debugLevel: number | null = null
// User lines waiting for the next prompt.
const debugLines: string[] = []
// The line just written to the browser: its echo is dropped, and until a
// prompt comes back R is running it.
let debugEcho: string | null = null
let debugAwaiting = false
// The Environment pane already shows the frame at this prompt.
let frameFresh = false
const FRAME_PROBE = '.sai_emit_frame(environment(), sys.call())'
// Leaves the debugger without ending R (Q would: it jumps to the top level).
const DEBUG_ABORT = 'invokeRestart("sai_abort")'

// ─── Helpers ────────────────────────────────────────────────────────────────

function getRScriptsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'r-scripts')
    : join(app.getAppPath(), 'r-scripts')
}

function rEnv(): NodeJS.ProcessEnv {
  // Same environment as analysis runs (library order, DLL dirs, collation —
  // see rChildEnv in r-bridge.ts).
  return rChildEnv()
}

function emitOutput(chunk: string, stream: 'stdout' | 'stderr'): void {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.TERMINAL_R_OUTPUT, { chunk, stream })
}

/** A message from SAI itself (not R): sent as an i18n key, translated in the renderer. */
function emitNotice(key: string, params?: Record<string, string>): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.TERMINAL_R_OUTPUT, { chunk: key, stream: 'notice', params })
  }
}

/** Read a captured plot PNG, stream it as base64, then delete the temp file. */
async function sendPlot(filePath: string): Promise<void> {
  try {
    const buf = await readFile(filePath)
    // plot_<n>.png — n is the id R keeps the recorded plot under (Export).
    const id = /plot_(\d+)\.png$/.exec(filePath)?.[1]
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.TERMINAL_R_PLOT, {
        png: buf.toString('base64'),
        plotId: id ? Number(id) : undefined
      })
    }
  } catch (err) {
    log.warn(`[r-session] failed to read plot ${filePath}: ${String(err)}`)
  } finally {
    await unlink(filePath).catch(() => undefined)
  }
}

/** Read a sai_show() table JSON, forward it to Output, then delete the file. */
async function sendTable(filePath: string): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    if (win && !win.isDestroyed()) win.webContents.send(IPC.TERMINAL_R_TABLE, parsed)
  } catch (err) {
    log.warn(`[r-session] failed to read table ${filePath}: ${String(err)}`)
  } finally {
    await unlink(filePath).catch(() => undefined)
  }
}

/** True if `p` is a file directly inside this session's side directory. */
function inSideDir(p: string): boolean {
  if (!sideDir) return false
  const abs = resolve(p)
  return dirname(abs) === resolve(sideDir) && !abs.includes("'")
}

/** Parse a marker's JSON tail; null (and a log line) when R sent garbage. */
function parseMarker(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    log.warn(`[r-session] malformed ${what} marker`)
    return null
  }
}

/** View(df): load the snapshot into a DuckDB temp table, open it in the grid. */
async function sendView(json: string): Promise<void> {
  const parsed = RConsoleViewMarkerSchema.safeParse(parseMarker(json, 'view'))
  if (!parsed.success || !inSideDir(parsed.data.path)) return
  try {
    const payload = await loadRView(parsed.data.path, parsed.data.title)
    if (win && !win.isDestroyed()) win.webContents.send(IPC.TERMINAL_R_VIEW, payload)
  } catch (err) {
    log.warn(`[r-session] View() load failed: ${String(err)}`)
    emitNotice('terminal.r.notice.viewFailed', { detail: String(err) })
  }
}

/**
 * sai_commit(df): park the snapshot and ask the renderer — it runs the same
 * unsaved-changes guard as File ▸ Import before the open dataset is replaced.
 */
function offerCommit(json: string): void {
  const parsed = RConsoleCommitMarkerSchema.safeParse(parseMarker(json, 'commit'))
  if (!parsed.success || !inSideDir(parsed.data.path)) return
  const vars = StatVariablesSchema.safeParse(parsed.data.variables)
  const commitId = `commit_${String(++commitSeq)}`
  pendingCommits.set(commitId, {
    path: parsed.data.path,
    name: parsed.data.name.trim() || 'R',
    // Labels the user put on the data frame are always kept (no setting gate).
    meta: vars.success ? toStatMetaMap(vars.data, true) : {}
  })
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.TERMINAL_R_COMMIT, {
      commitId,
      name: parsed.data.name,
      rows: parsed.data.rows,
      cols: parsed.data.cols
    })
  }
}

async function resolveCommit(commitId: string, accept: boolean): Promise<FileOpenResult | null> {
  const pending = pendingCommits.get(commitId)
  if (!pending) return null
  pendingCommits.delete(commitId)
  try {
    if (!accept || !inSideDir(pending.path)) return null
    return await importParquetAsDataset(pending.path, pending.name, pending.meta)
  } finally {
    await unlink(pending.path).catch(() => undefined)
  }
}

/** ?topic: read the text help page the R pager wrote, forward it. */
async function sendHelp(json: string): Promise<void> {
  const parsed = RConsoleHelpMarkerSchema.safeParse(parseMarker(json, 'help'))
  if (!parsed.success || !inSideDir(parsed.data.path)) return
  try {
    const text = (await readFile(parsed.data.path, 'utf8')).slice(0, HELP_MAX_CHARS)
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.TERMINAL_R_HELP, { title: parsed.data.title ?? '', text })
    }
  } catch (err) {
    log.warn(`[r-session] failed to read help page: ${String(err)}`)
  } finally {
    await unlink(parsed.data.path).catch(() => undefined)
  }
}

/** The error's call stack (innermost last) → a collapsible traceback line. */
function sendTraceback(json: string): void {
  const parsed = RConsoleTracebackMarkerSchema.safeParse(parseMarker(json, 'traceback'))
  if (!parsed.success || parsed.data.length === 0) return
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.TERMINAL_R_OUTPUT, {
      chunk: parsed.data.join('\n'),
      stream: 'traceback'
    })
  }
}

/** print(<htmlwidget>): register its folder with the sai-widget:// server. */
function sendWidget(json: string): void {
  const parsed = RConsoleWidgetMarkerSchema.safeParse(parseMarker(json, 'widget'))
  if (!parsed.success || !inSideDir(parsed.data.dir)) return
  const m = /^widget_(\d+)$/.exec(basename(parsed.data.dir))
  if (!m) return
  const widgetId = `w${m[1] ?? ''}`
  const url = addWidget(widgetId, parsed.data.dir)
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.TERMINAL_R_WIDGET, { widgetId, title: parsed.data.title, url })
  }
}

// The working directory R last reported (Files pane). Opening a listed
// script is only allowed inside it.
let currentWd: string | null = null

function sendWd(json: string): void {
  const parsed = RConsoleWdMarkerSchema.safeParse(parseMarker(json, 'wd'))
  if (!parsed.success) return
  currentWd = parsed.data.wd === '' ? null : resolve(parsed.data.wd)
  if (win && !win.isDestroyed()) win.webContents.send(IPC.TERMINAL_R_WD, parsed.data)
}

const SCRIPT_FILE_RE = /\.(r|rmd|qmd)$/i

/**
 * A script the Files pane lists, opened in the editor. Only a bare file name
 * inside the working directory R reported, with a script extension and under
 * the editor's size cap — the renderer never hands over a path. (The console
 * can read any file itself — CLAUDE.md §9 console exception — so this is no
 * new capability, just the editor's way in.)
 */
async function openWdFile(name: string): Promise<{ filePath: string; content: string } | null> {
  if (!currentWd || !SCRIPT_FILE_RE.test(name) || /[\\/]|^\.\.?$/.test(name)) return null
  const full = resolve(currentWd, name)
  if (dirname(full) !== currentWd) return null
  try {
    const { size } = await stat(full)
    if (size > SYNTAX_FILE_MAX_CHARS) return null
    const content = (await readFile(full, 'utf8')).replace(/^\uFEFF/, '')
    approveSyntaxPath(full)
    return { filePath: full, content }
  } catch (err) {
    log.warn('[r-session] open from Files pane failed:', err)
    return null
  }
}

/** Where a new R session starts: Documents (as RStudio), else the temp dir. */
function sessionCwd(): string {
  try {
    return app.getPath('documents')
  } catch {
    return tmpdir()
  }
}

function sendEnv(json: string): void {
  const parsed = RConsoleEnvMarkerSchema.safeParse(parseMarker(json, 'env'))
  if (!parsed.success) return
  const { items: raw, frame } = Array.isArray(parsed.data)
    ? { items: parsed.data, frame: undefined }
    : parsed.data
  const items = raw.map(i => ({ ...i, dims: i.dims ?? null }))
  if (win && !win.isDestroyed()) win.webContents.send(IPC.TERMINAL_R_ENV, { items, frame })
}

function resolveCompletion(rest: string): void {
  const space = rest.indexOf(' ')
  if (space < 0) return
  const id = rest.slice(0, space)
  const done = completions.get(id)
  if (!done) return
  completions.delete(id)
  const parsed = RConsoleCompleteMarkerSchema.safeParse(
    parseMarker(rest.slice(space + 1), 'completion')
  )
  done(parsed.success ? parsed.data : EMPTY_COMPLETION)
}

/**
 * Ask R to complete `line`. Only while idle — a running command has R busy
 * in eval and the request would wait behind it; the editor would rather show
 * nothing than a list for text typed seconds ago.
 */
function complete(line: string): Promise<TerminalRCompleteResult> {
  const stdin = proc?.stdin
  if (!ready || pendingId || queue.length > 0 || !stdin || stdin.destroyed) {
    return Promise.resolve(EMPTY_COMPLETION)
  }
  const id = randomUUID().replace(/-/g, '')
  return new Promise(resolvePromise => {
    const timer = setTimeout(() => {
      completions.delete(id)
      resolvePromise(EMPTY_COMPLETION)
    }, COMPLETE_TIMEOUT_MS)
    completions.set(id, r => {
      clearTimeout(timer)
      resolvePromise(r)
    })
    try {
      // JSON keeps the line on one physical line whatever it contains.
      stdin.write(`__SAI_COMPLETE__${id} ${JSON.stringify(line)}\n`, err => {
        if (err) handleWriteFailure(err)
      })
    } catch (err) {
      handleWriteFailure(err)
    }
  })
}

function resolvePlotExport(rest: string): void {
  const space = rest.indexOf(' ')
  if (space < 0) return
  const done = plotExports.get(rest.slice(0, space))
  if (!done) return
  plotExports.delete(rest.slice(0, space))
  const parsed = RConsolePlotExportMarkerSchema.safeParse(
    parseMarker(rest.slice(space + 1), 'plot export')
  )
  done(parsed.success ? parsed.data : { ok: false, error: 'malformed reply' })
}

const PLOT_FILTERS = {
  png: 'pngFilter',
  svg: 'svgFilter',
  pdf: 'pdfFilter'
} as const

/**
 * Export: the user picks the file (Main's native dialog — the path never
 * comes from the renderer), then R redraws the recorded plot into it. Queued
 * like any command, so it waits for a running one. Returns the saved path,
 * or null when the dialog was cancelled.
 */
async function exportPlot(req: TerminalRPlotExportRequest): Promise<string | null> {
  if (!proc) throw new Error('R session is not running')
  const dlg = dialogText()
  const result = await dialog.showSaveDialog({
    title: dlg.exportPlot,
    defaultPath: `plot_${String(req.plotId)}.${req.format}`,
    filters: [{ name: dlg[PLOT_FILTERS[req.format]], extensions: [req.format] }]
  })
  if (result.canceled || !result.filePath) return null
  const path = result.filePath
  const id = randomUUID().replace(/-/g, '')
  const reply = new Promise<{ ok: boolean; error?: string }>(resolvePromise => {
    const timer = setTimeout(() => {
      plotExports.delete(id)
      resolvePromise({ ok: false, error: 'timeout' })
    }, PLOT_EXPORT_TIMEOUT_MS)
    plotExports.set(id, r => {
      clearTimeout(timer)
      resolvePromise(r)
    })
  })
  // JSON string literals are valid R string literals (same escapes); the
  // numbers were range-checked by zod.
  enqueue(
    `.sai_export_plot(${JSON.stringify(id)}, ${String(req.plotId)}, ${JSON.stringify(path.replace(/\\/g, '/'))}, ` +
      `${JSON.stringify(req.format)}, ${String(req.widthCm)}, ${String(req.heightCm)}, ${String(req.dpi)})`
  )
  const r = await reply
  if (!r.ok) throw new Error(r.error ?? 'export failed')
  return path
}

/** Comparable form of a library path (R reports forward slashes). */
function libKey(p: string): string {
  const k = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? k.toLowerCase() : k
}

function sendPackages(json: string): void {
  const parsed = RConsolePackagesMarkerSchema.safeParse(parseMarker(json, 'packages'))
  if (!parsed.success) return
  const user = libKey(userRLibDir())
  const items = parsed.data
    .map(p => ({
      name: p.name,
      version: p.version,
      user: libKey(p.lib) === user,
      attached: p.attached
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (win && !win.isDestroyed()) win.webContents.send(IPC.TERMINAL_R_PKGS, { items })
}

/** Ask the session for its package list (answer: __SAI_PKGS__ → terminal:r:pkgs). */
function refreshPackages(): void {
  if (!proc) return
  enqueue(`.sai_emit_pkgs(${JSON.stringify(userRLibDir().replace(/\\/g, '/'))})`)
}

/**
 * Packages pane install: the app's own installer (dated snapshot repo, the
 * whole dependency tree, one install at a time), into the user library —
 * then the session picks the library up and re-lists. Respects the same
 * r.consoleEnabled switch as the console itself.
 */
async function installPackage(name: string): Promise<TerminalRPkgInstallResult> {
  if (!getSettings().r.consoleEnabled) return { success: false, detail: 'console disabled' }
  const res = await installRPackage(name)
  refreshPackages()
  return res
}

/** Plot/table paths from R are only read inside the side dir. */
function sideFile(p: string, send: (path: string) => Promise<void>): void {
  if (inSideDir(p)) track(send(p))
  else log.warn(`[r-session] ignored side file outside the session dir: ${p}`)
}

// Side outputs still being read/forwarded (plots, tables, View() loads) — a
// command counts as finished for terminal:r:run only once they are sent.
const inflight = new Set<Promise<void>>()
function track(work: Promise<void>): void {
  inflight.add(work)
  void work.finally(() => inflight.delete(work))
}

// Marker → handler. Matched anywhere in a line; the rest of the line is its value.
const MARKERS: [string, (rest: string) => void][] = [
  ['__SAI_COMPLETIONS__', resolveCompletion],
  ['__SAI_PLOTEXPORT__', resolvePlotExport],
  [
    '__SAI_PLOT__',
    rest => {
      sideFile(rest, sendPlot)
    }
  ],
  [
    '__SAI_TABLE__',
    rest => {
      sideFile(rest, sendTable)
    }
  ],
  [
    '__SAI_VIEW__',
    rest => {
      track(sendView(rest))
    }
  ],
  ['__SAI_HELP__', rest => void sendHelp(rest)],
  ['__SAI_COMMIT__', offerCommit],
  ['__SAI_ENV__', sendEnv],
  ['__SAI_WD__', sendWd],
  ['__SAI_PKGS__', sendPackages],
  ['__SAI_WIDGET__', sendWidget],
  ['__SAI_TRACEBACK__', sendTraceback],
  // Messages/warnings/errors R sends through stdout to keep them in order
  // with printed output (_r_console.R .sai_stderr).
  [
    '__SAI_STDERR__',
    rest => {
      try {
        const text: unknown = JSON.parse(rest)
        if (typeof text === 'string') emitOutput(text, 'stderr')
      } catch {
        emitOutput(`${rest}\n`, 'stderr')
      }
    }
  ]
]

// Per-session secret baked into every side-channel marker (see .sai_emit in
// _r_console.R): output printed by user data cannot forge a control line.
let markerNonce = ''

function markerText(name: string): string {
  return markerNonce ? name.replace('__SAI_', `__SAI${markerNonce}_`) : name
}

function setStatus(s: RSessionStatus): void {
  status = s
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.TERMINAL_R_STATUS, {
      status: s,
      debugLevel: s === 'debug' ? (debugLevel ?? undefined) : undefined
    })
  }
}

function resetDebug(): void {
  debugLevel = null
  debugLines.length = 0
  debugEcho = null
  debugAwaiting = false
  frameFresh = false
}

/** One line to the waiting browser (its echo is expected back). */
function writeDebugLine(line: string, probe = false): void {
  const stdin = proc?.stdin
  if (!stdin || stdin.destroyed || stdin.writableEnded) {
    handleWriteFailure(new Error('stdin closed'))
    return
  }
  if (!probe) {
    frameFresh = false
    setStatus('busy')
  }
  debugEcho = line
  debugAwaiting = true
  try {
    stdin.write(`${line}\n`, err => {
      if (err) handleWriteFailure(err)
    })
  } catch (err) {
    handleWriteFailure(err)
  }
}

/**
 * The browser waits (Browse prompt, or "+ " inside an expression typed there):
 * feed the next user line, else refresh the frame's variables once, else
 * hand the prompt to the user.
 */
function onDebugPrompt(level: number | null): void {
  debugAwaiting = false
  if (level !== null) debugLevel = level
  const next = debugLines.shift()
  if (next !== undefined) {
    writeDebugLine(next)
    return
  }
  if (level !== null && !frameFresh) {
    frameFresh = true
    writeDebugLine(FRAME_PROBE, true)
    return
  }
  setStatus('debug')
}

/** Console input while debugging: browser commands (n, s, f, c, Q) or R code. */
function writeDebug(code: string): void {
  // Q would end R (non-interactive); Stop goes through the sai_abort restart.
  const lines = code.split('\n').map(l => (l.trim() === 'Q' ? DEBUG_ABORT : l))
  debugLines.push(...lines)
  if (status === 'debug') onDebugPrompt(null)
}

/**
 * R süreci ölmüşse (kullanıcı `q()` yazdı, R çöktü, dışarıdan kapatıldı)
 * stdin'e yazmak EPIPE üretir; hata akışta dinleyicisi olmadığı için
 * uncaughtException'a çıkar ve "Unexpected Error" modalını açardı. Oturumu
 * ölü işaretle ve terminalde açıklayıcı bir satır göster.
 */
function handleWriteFailure(err: unknown): void {
  log.error(`[r-session] stdin write failed: ${String(err)}`)
  emitNotice('terminal.r.notice.noLongerRunning')
  pendingId = null
  ready = false
  dropQueue()
  resetDebug()
  setStatus('dead')
}

function enqueue(code: string, done?: (ok: boolean) => void): void {
  queue.push({ code, done })
  pump()
}

/** The session is gone: nothing queued (or running) will finish. */
function dropQueue(): void {
  const waiting = [...queue.map(q => q.done), pendingDone]
  queue.length = 0
  pendingDone = null
  for (const done of waiting) done?.(false)
}

/** Send the next queued command if the session is ready and idle. */
function pump(): void {
  if (!ready || pendingId || !proc?.stdin || queue.length === 0) return
  const stdin = proc.stdin
  if (stdin.destroyed || stdin.writableEnded) {
    handleWriteFailure(new Error('stdin closed'))
    return
  }
  const { code, done } = queue.shift() as QueuedCommand
  pendingDone = done ?? null
  const id = randomUUID().replace(/-/g, '')
  pendingId = id
  setStatus('busy')
  try {
    stdin.write(`${code}\n__SAI_END__${id}\n`, err => {
      if (err) handleWriteFailure(err)
    })
  } catch (err) {
    handleWriteFailure(err)
  }
}

function handleStdout(text: string): void {
  stdoutResidual += text
  const lines = stdoutResidual.split('\n')
  stdoutResidual = lines.pop() ?? ''
  const out: string[] = []
  const flush = (): void => {
    if (out.length) {
      emitOutput(out.join('\n') + '\n', 'stdout')
      out.length = 0
    }
  }
  // Markers may be concatenated onto un-newlined command output (e.g. cat()
  // without a trailing "\n"), so match them ANYWHERE in the line and emit any
  // text before them first — never rely on the marker being a whole line.
  for (const rawLine of lines) {
    // R's stdout is a text-mode stream, so on Windows every "\n" it writes
    // arrives as "\r\n". Splitting on "\n" alone leaves a trailing "\r" on
    // each line — harmless for the markers matched with indexOf(), but fatal
    // for the two that take the REST of the line as a value: the plot and
    // table paths came through as "C:\...\sai_1.png\r", readFile() failed with
    // ENOENT, and R-console plots and sai_show() tables silently never
    // appeared on Windows.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    // R echoing the line the browser just read (the prompt before it was cut off).
    if (debugEcho !== null && line === debugEcho) {
      debugEcho = null
      continue
    }
    if (!ready && line.includes('__SAI_READY__')) {
      ready = true
      setStatus('idle')
      pump()
      continue
    }
    const marker = MARKERS.find(([m]) => line.includes(markerText(m)))
    if (marker) {
      const [name, handle] = marker
      const m = markerText(name)
      const idx = line.indexOf(m)
      if (idx > 0) out.push(line.slice(0, idx))
      flush() // preserve ordering: text before the side output it produced
      handle(line.slice(idx + m.length))
      continue
    }
    if (pendingId) {
      const done = `__SAI_DONE__${pendingId}`
      const dIdx = line.indexOf(done)
      if (dIdx >= 0) {
        if (dIdx > 0) out.push(line.slice(0, dIdx))
        flush()
        const doneId = pendingId
        pendingId = null
        // Typed while the debugged code ran on (after "c") — an ordinary command now.
        const leftover = debugLines.filter(l => l !== DEBUG_ABORT).join('\n')
        resetDebug()
        if (leftover.trim() !== '') queue.unshift({ code: leftover })
        const finished = pendingDone
        pendingDone = null
        if (finished) {
          afterStderr(doneId, () => {
            void Promise.allSettled([...inflight]).then(() => {
              finished(true)
            })
          })
        }
        setStatus('idle')
        pump()
        continue
      }
    }
    out.push(line)
  }
  flush()
  if (!pendingId) return
  const prompt = BROWSE_PROMPT.exec(stdoutResidual)
  if (prompt || (debugAwaiting && stdoutResidual.endsWith(CONTINUE_PROMPT))) {
    // Text printed without a newline before the prompt is still output.
    const cut = prompt ? prompt.index : stdoutResidual.length - CONTINUE_PROMPT.length
    if (cut > 0) emitOutput(stdoutResidual.slice(0, cut), 'stdout')
    stdoutResidual = ''
    onDebugPrompt(prompt ? Number(prompt[1]) : null)
  }
}

/** stderr text to the console, minus the end-of-command markers. */
function handleStderr(text: string): void {
  let s = stderrResidual + text
  stderrResidual = ''
  // An unfinished last line that could still become a marker waits for the rest.
  const tail = s.slice(s.lastIndexOf('\n') + 1)
  if (tail !== '' && (EDONE.startsWith(tail) || tail.startsWith(EDONE))) {
    stderrResidual = tail
    s = s.slice(0, s.length - tail.length)
  }
  const ids: string[] = []
  s = s.replace(EDONE_LINE, (_m, id: string) => {
    ids.push(id)
    return ''
  })
  if (s !== '') emitOutput(s, 'stderr')
  for (const id of ids) {
    if (stderrWait?.id === id) {
      clearTimeout(stderrWait.timer)
      const { go } = stderrWait
      stderrWait = null
      go()
    } else {
      if (stderrDone.size > 50) stderrDone.clear()
      stderrDone.add(id)
    }
  }
}

/** Run `go` once command `id`'s stderr is through (or after a short grace). */
function afterStderr(id: string, go: () => void): void {
  if (stderrDone.delete(id)) {
    go()
    return
  }
  if (stderrWait) {
    clearTimeout(stderrWait.timer)
    stderrWait.go()
  }
  const timer = setTimeout(() => {
    if (stderrWait?.id !== id) return
    stderrWait = null
    go()
  }, EDONE_WAIT_MS)
  stderrWait = { id, go, timer }
}

function wire(child: ChildProcess): void {
  // Boru hataları (EPIPE / kapanmış akış) dinleyicisiz kalırsa Node bunları
  // uncaughtException'a yükseltir — main.ts'teki modal açılır. Burada yutulur;
  // gerçek sonuç zaten 'exit' üzerinden 'dead' durumuna dönüşür.
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream?.on('error', (err: Error) => {
      log.warn(`[r-session] stdio error: ${err.message}`)
    })
  }
  // A replaced (killed, not yet dead) process must not feed the new session.
  child.stdout?.on('data', (b: Buffer) => {
    if (child === proc) handleStdout(b.toString('utf8'))
  })
  child.stderr?.on('data', (b: Buffer) => {
    if (child === proc) handleStderr(b.toString('utf8'))
  })
  child.on('exit', code => {
    log.info(`[r-session] R console exited (code=${String(code)})`)
    if (child !== proc) {
      // kill() already reset the state; a newer session may be running — its
      // status must not be flipped to "dead" by this late exit.
      killing = false
      return
    }
    // An exit nobody asked for (crash, q(), killed from outside) — say so,
    // otherwise the console just flips to "stopped" with no explanation.
    if (!killing && code !== 0) emitNotice('terminal.r.notice.exited', { code: String(code) })
    killing = false
    proc = null
    ready = false
    pendingId = null
    stdoutResidual = ''
    dropQueue()
    resetDebug()
    setStatus('dead')
  })
  child.on('error', err => {
    if (child !== proc) return
    log.error(`[r-session] spawn error: ${err.message}`)
    emitNotice('terminal.r.notice.startFailed', { detail: err.message })
    setStatus('dead')
  })
}

async function removeSideDir(): Promise<void> {
  if (!sideDir) return
  const d = sideDir
  sideDir = null
  // Never anything but our own mkdtemp() folder.
  if (!resolve(d).startsWith(resolve(tmpdir()) + sep)) return
  await rm(d, { recursive: true, force: true }).catch(() => undefined)
}

async function killParquet(): Promise<void> {
  if (parquetPath) {
    const p = parquetPath
    parquetPath = null
    await unlink(p).catch(() => undefined)
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

// start() awaits several things before it spawns; a second call (double-click on
// Restart) must join the first instead of spawning a second Rscript.
let starting: Promise<RSessionStatus> | null = null

function start(datasetId?: string): Promise<RSessionStatus> {
  starting ??= startSession(datasetId).finally(() => {
    starting = null
  })
  return starting
}

async function startSession(datasetId?: string): Promise<RSessionStatus> {
  if (proc) return status
  // CLAUDE.md §9 R-console exception rule 1: opt-out via settings.json
  // (r.consoleEnabled) for restricted/enterprise deployments.
  if (!getSettings().r.consoleEnabled) {
    emitNotice('terminal.r.notice.disabled')
    setStatus('dead')
    return status
  }
  const rscript = getRscriptPath()
  if (!rscript) {
    emitNotice('terminal.r.notice.rMissing')
    setStatus('dead')
    return status
  }
  setStatus('starting')
  ready = false
  pendingId = null
  stdoutResidual = ''

  await killParquet()
  if (datasetId) {
    parquetPath = await exportDatasetForConsole(datasetId)
  }
  await removeSideDir()
  sideDir = await mkdtemp(join(tmpdir(), 'sai-rside-'))

  const scriptPath = join(getRScriptsDir(), '_r_console.R')
  // `Rscript -`: R's console input is stdin, so browser() can read from it
  // (with --file=<script> it would read the script file and never stop).
  const args = parquetPath ? ['-', parquetPath] : ['-']
  log.info(`[r-session] spawn: ${rscript} ${args.join(' ')} (${scriptPath})`)
  markerNonce = randomBytes(8).toString('hex')
  proc = spawn(rscript, args, {
    shell: false,
    cwd: sessionCwd(),
    env: {
      ...rEnv(),
      SAI_R_SIDE_DIR: sideDir,
      SAI_R_CONSOLE_SCRIPT: scriptPath,
      SAI_R_MARKER_NONCE: markerNonce
    }
  })
  wire(proc)
  resetDebug()
  stderrResidual = ''
  stderrDone.clear()
  // The one line R's own REPL reads; the script's loop takes over stdin after it.
  try {
    proc.stdin?.write('source(Sys.getenv("SAI_R_CONSOLE_SCRIPT"), encoding = "UTF-8")\n')
  } catch (err) {
    handleWriteFailure(err)
  }
  return status
}

function kill(): void {
  if (proc) {
    killing = true
    try {
      proc.stdin?.end() // süreç zaten öldüyse EPIPE fırlatabilir
    } catch {
      /* pipe already gone */
    }
    proc.kill('SIGTERM')
    const dying = proc
    setTimeout(() => {
      try {
        dying.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, 2000)
  }
  proc = null
  ready = false
  pendingId = null
  currentWd = null
  dropQueue()
  resetDebug()
  for (const done of completions.values()) done(EMPTY_COMPLETION)
  completions.clear()
  pendingCommits.clear() // their files go with the side dir
  for (const done of plotExports.values()) done({ ok: false, error: 'session stopped' })
  plotExports.clear()
  void killParquet()
  void dropAllRViews()
  clearWidgets()
  // The dying process may still hold files open for a moment (Windows).
  const dir = sideDir
  setTimeout(() => {
    if (sideDir === dir) void removeSideDir()
  }, 2500)
  setStatus('dead')
}

/** Stop: commands still waiting behind the running one are dropped too. */
function dropWaiting(): void {
  const waiting = queue.map(q => q.done)
  queue.length = 0
  for (const done of waiting) done?.(false)
}

// How long an interrupted command gets to return to the prompt before Stop
// falls back to restarting R (C code that never checks for interrupts).
const INTERRUPT_GRACE_MS = 5000

async function becameIdle(timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (status === 'idle' || status === 'debug') return true
    if (status === 'dead' || !proc) return false
    await new Promise(r => setTimeout(r, 100))
  }
  return false
}

/**
 * Stop the running command and keep the session (objects, loaded packages).
 * Resolves `restarted: true` when that was not possible and R was restarted.
 *
 * POSIX: SIGINT. Windows has no signals — `proc.kill('SIGINT')` terminates
 * the process — so a real Ctrl+C is raised in R's console instead
 * (win-console-interrupt.ts). Until 2026-10-21 Stop on Windows always
 * restarted R, losing the whole session. If the helper cannot run, or R does
 * not get back to its prompt in time, Stop still restarts (old behaviour) so
 * the user is never left with a hung console.
 */
async function interrupt(datasetId?: string): Promise<{ restarted: boolean }> {
  if (!proc) return { restarted: false }
  // At the Browse prompt: leave the debugger, keep the session.
  if (status === 'debug') {
    debugLines.length = 0
    writeDebugLine(DEBUG_ABORT)
    emitNotice('terminal.r.notice.debugStopped')
    return { restarted: false }
  }
  dropWaiting()
  if (status !== 'busy') return { restarted: false }
  if (process.platform === 'win32') {
    const pid = proc.pid
    if (
      pid !== undefined &&
      (await sendConsoleCtrlC(pid)) &&
      (await becameIdle(INTERRUPT_GRACE_MS))
    ) {
      return { restarted: false }
    }
    emitNotice('terminal.r.notice.winInterrupt')
    kill()
    await new Promise(r => setTimeout(r, 150))
    await start(datasetId)
    return { restarted: true }
  }
  proc.kill('SIGINT')
  return { restarted: false }
}

/** Kill on app shutdown. */
export function killRSession(): void {
  kill()
  // kill() defers removing the side dir (the process may still hold files);
  // at shutdown there is no later, so remove it now.
  const dir = sideDir
  if (dir && resolve(dir).startsWith(resolve(tmpdir()) + sep)) {
    sideDir = null
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best effort — a locked file on Windows is cleaned by the OS temp sweep
    }
  }
}

// ─── IPC ────────────────────────────────────────────────────────────────────

export function setRSessionWindow(browserWin: BrowserWindow): void {
  win = browserWin
}

export function registerRSessionHandlers(): void {
  handleValidated(
    IPC.TERMINAL_R_START,
    TerminalRStartRequestSchema,
    (req): Promise<RSessionStatus> => start(req.datasetId)
  )

  handleValidated(IPC.TERMINAL_R_WRITE, TerminalRWriteRequestSchema, (req): void => {
    if (!proc) {
      emitNotice('terminal.r.notice.notRunning')
      return
    }
    if (debugLevel !== null) {
      writeDebug(req.code)
      return
    }
    enqueue(req.code)
  })

  // Like write, but tells the renderer when the command has finished (the
  // report runner goes chunk by chunk) — ok false if the session stopped first.
  handleValidated(IPC.TERMINAL_R_RUN, TerminalRRunRequestSchema, (req): void => {
    const done = (ok: boolean): void => {
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.TERMINAL_R_RUN_DONE, { runId: req.runId, ok })
      }
    }
    if (!proc) done(false)
    else enqueue(req.code, done)
  })

  handleValidated(
    IPC.TERMINAL_R_RESTART,
    TerminalRStartRequestSchema,
    async (req): Promise<RSessionStatus> => {
      kill()
      // Small delay so the previous process releases stdio before respawn.
      await new Promise(r => setTimeout(r, 150))
      return start(req.datasetId)
    }
  )

  handleValidated(IPC.TERMINAL_R_KILL, TerminalRStartRequestSchema, (): void => {
    kill()
  })

  handleValidated(
    IPC.TERMINAL_R_INTERRUPT,
    TerminalRStartRequestSchema,
    (req): Promise<{ restarted: boolean }> => interrupt(req.datasetId)
  )

  handleValidated(
    IPC.TERMINAL_R_COMPLETE,
    TerminalRCompleteRequestSchema,
    (req): Promise<TerminalRCompleteResult> => complete(req.line)
  )

  handleValidated(
    IPC.TERMINAL_R_VIEW_ROWS,
    TerminalRViewRowsRequestSchema,
    async (req): Promise<TerminalRViewRowsResult> => ({ rows: await readRViewRows(req) })
  )

  handleValidated(IPC.TERMINAL_R_PKGS_REFRESH, TerminalRStartRequestSchema, (): void => {
    refreshPackages()
  })

  handleValidated(
    IPC.TERMINAL_R_OPEN_FILE,
    TerminalROpenFileRequestSchema,
    (req): Promise<{ filePath: string; content: string } | null> => openWdFile(req.name)
  )

  // A folder for setwd(): the path goes back to the renderer, which sends the
  // setwd() call through the console (echoed, in the history) like typed code.
  handleValidated(
    IPC.TERMINAL_R_CHOOSE_DIR,
    TerminalRStartRequestSchema,
    async (): Promise<string | null> => {
      const opts: Electron.OpenDialogOptions = {
        properties: ['openDirectory'],
        ...(currentWd ? { defaultPath: currentWd } : {})
      }
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
  )

  handleValidated(
    IPC.TERMINAL_R_PKG_INSTALL,
    TerminalRPkgInstallRequestSchema,
    (req): Promise<TerminalRPkgInstallResult> => installPackage(req.name)
  )

  handleValidated(
    IPC.TERMINAL_R_PLOT_EXPORT,
    TerminalRPlotExportRequestSchema,
    (req): Promise<string | null> => exportPlot(req)
  )

  handleValidated(
    IPC.TERMINAL_R_COMMIT_RESOLVE,
    TerminalRCommitResolveRequestSchema,
    (req): Promise<FileOpenResult | null> => resolveCommit(req.commitId, req.accept)
  )

  handleValidated(
    IPC.TERMINAL_R_VIEW_CLOSE,
    TerminalRViewCloseRequestSchema,
    (req): Promise<void> => dropRView(req.viewId)
  )

  handleValidated(
    IPC.TERMINAL_R_RELOAD_DATA,
    TerminalRReloadRequestSchema,
    async (req): Promise<void> => {
      if (!proc || !req.datasetId) return
      await killParquet()
      parquetPath = await exportDatasetForConsole(req.datasetId)
      // Point the session at the fresh export and reload `data` (silent).
      const literal = JSON.stringify(parquetPath)
      enqueue(`.sai_parquet <- ${literal}; data <- sai_data(); invisible(NULL)`)
    }
  )
}
