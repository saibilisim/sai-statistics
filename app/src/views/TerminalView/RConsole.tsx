// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RConsole — the Syntax tab's R mode (Faz T2 console + Faz T3 IDE panes).
 *
 *   ┌ toolbar ──────────────────────────────────────────────────────────────┐
 *   │ vars │ [script.R] [View: df ×]   (editor / View() grid)   │ Env      │
 *   │      │ ── console ─────────────────────────────────────── │ Plots    │
 *   │      │ streamed output                                     │ Help     │
 *   │      │ [ input ]                                           │          │
 *
 * A persistent R process; the dataset is bridged READ-ONLY as `data`.
 * CLAUDE.md §9 exception: the user's own local code — nothing auto-runs; the
 * script only reaches R on an explicit Run / Ctrl+Enter.
 */
import { useStatusNoticeStore } from '../../store/status-notice-store'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Variable } from '@shared/data-types'
import { useTerminalStore, isScriptDirty, type ROutputChunk } from '../../store/terminal-store'
import { ConfirmDialog } from '../../components/Dialogs/ConfirmDialog'
import { useDatasetStore } from '../../store/dataset-store'
import { useUIStore } from '../../store/ui-store'
import { useOutputStore } from '../../store/output-store'
import { cx } from '../../lib/cx'
import { ensureCanReplaceDataset } from '../../lib/file-actions'
import { highlightCode } from '../../lib/code-highlight'
import { useSelectionCopy } from '../../lib/use-text-context-menu'
import { parseAnsi, stripAnsi } from '../../lib/ansi'
import {
  PlayIcon,
  PlayAllIcon,
  StopIcon,
  TrashIcon,
  RefreshIcon,
  RestartIcon,
  CopyIcon,
  AlertIcon,
  HelpIcon,
  FolderOpenIcon,
  SaveIcon,
  CodeIcon,
  TableIcon,
  CloseIcon,
  PanelRightIcon,
  ReportIcon,
  ImageIcon,
  PlusIcon
} from './terminal-icons'
import { CodeEditor, type CodeEditorHandle, type Completer, type Suggestion } from './CodeEditor'
import { VariablePanel, VarsToggle } from './VariablePanel'
import { RSidePanel, type RSideTab } from './RSidePanel'
import { RViewGrid } from './RViewGrid'
import { ConsoleFind } from './ConsoleFind'
import { RDebugBar, type RDebugCommand } from './RDebugBar'
import { RReportView } from './RReportView'
import {
  buildReportHtml,
  isRMarkdown,
  parseRmd,
  parseRReport,
  rmdRunnableText,
  type ReportItem,
  type ReportTable,
  type RReport
} from '../../lib/r-report'
import { useSplitter } from './use-splitter'
import {
  getRToken,
  lineStartOffset,
  nextCodeLine,
  statementRangeAt,
  statementStarts,
  wordAt
} from './r-editor-helpers'
import styles from './TerminalView.module.css'

/** Promote a data.frame from sai_show() into the Output tab as a table block. */
function promoteTableToOutput(payload: {
  columns: string[]
  rows: (string | number | null)[][]
  title?: string
}): void {
  const titleKey =
    payload.title && payload.title.trim() !== ''
      ? payload.title.trim()
      : 'output.rconsole.tableTitle'
  useOutputStore.getState().addBlock({
    id: `rtable-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
    analysisId: 'rconsole',
    titleKey,
    timestamp: new Date().toISOString(),
    datasetName: useDatasetStore.getState().datasetName,
    result: {
      success: true,
      tables: [{ titleKey, columns: payload.columns, rows: payload.rows, footnoteKey: null }],
      plots: [],
      caseVars: [],
      warnings: [],
      notes: []
    }
  })
}

/** Promote an R plot (base64 PNG) into the Output tab as a png plot block. */
function promotePlotToOutput(png: string): void {
  useOutputStore.getState().addBlock({
    id: `rplot-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
    analysisId: 'rconsole',
    titleKey: 'output.rconsole.plotTitle',
    timestamp: new Date().toISOString(),
    datasetName: useDatasetStore.getState().datasetName,
    result: {
      success: true,
      tables: [],
      plots: [{ titleKey: 'output.rconsole.plotTitle', type: 'png', data: png }],
      caseVars: [],
      warnings: [],
      notes: []
    }
  })
}

/** Which dataset (and which edit of it) the R session's `data` reflects. */
function currentDataKey(s: { datasetId: string | null; dataVersion: number }): string {
  return `${s.datasetId ?? ''}:${String(s.dataVersion)}`
}

/** An R name as code — back-quoted when it isn't syntactic. */
function rName(name: string): string {
  return /^(?:[A-Za-z]|\.(?![0-9]))[A-Za-z0-9._]*$/.test(name)
    ? name
    : `\`${name.replace(/`/g, '\\`')}\``
}

/** `data$name` for a dataset column. */
function rColumnRef(name: string): string {
  return `data$${rName(name)}`
}

const tokenizeR = (line: string) => highlightCode(line, 'r')

/**
 * R's own completion engine, asked through the live session. The editor's
 * token and R's may differ (R completes only the tail, e.g. `na` in
 * `mean(x, na`), so R's completion replaces just that tail.
 */
const rCompleter: Completer = {
  tokenAt: getRToken,
  autoMinChars: 3,
  tabRequests: true,
  suggest: async (value, caret, token): Promise<Suggestion[]> => {
    const lineStart = value.lastIndexOf('\n', caret - 1) + 1
    const res = await window.api.terminal.rComplete({ line: value.slice(lineStart, caret) })
    if (!token.endsWith(res.token)) return []
    const prefix = token.slice(0, token.length - res.token.length)
    return res.items
      .filter(i => i.text !== res.token)
      .map(i => {
        const isArg = i.text.endsWith('=')
        const body = isArg ? `${i.text.slice(0, -1)} = ` : i.fn ? `${i.text}()` : i.text
        return {
          label: i.text,
          insert: `${prefix}${body}`,
          caretBack: i.fn && !isArg ? 1 : 0,
          detail: i.fn ? i.args : undefined
        }
      })
  }
}

const SCRIPT_TAB = 'script'
const REPORT_TAB = 'report'
// A chunk's console text in the report is cut beyond this (a printed
// 100k-row data frame would otherwise swamp the document).
const REPORT_OUTPUT_MAX = 50_000

/**
 * The R-console echo of code about to run: `>` where a statement starts, `+`
 * on continuations — or the debugger's own prompt while browser() waits.
 */
function echoCode(code: string): void {
  const store = useTerminalStore.getState()
  const starts = statementStarts(code)
  const first = store.rStatus === 'debug' ? `Browse[${String(store.rDebugLevel)}]>` : '>'
  const echo = code
    .split('\n')
    .map((l, i) => `${i === 0 ? first : starts[i] ? '>' : '+'} ${l}`)
    .join('\n')
  store.appendROutput(`${echo}\n`, 'input')
}

// terminal:r:run commands waiting for their run-done push, by runId.
const runWaiters = new Map<string, (ok: boolean) => void>()

/**
 * Run `code` and resolve when it finished (false: the session stopped first).
 * The answer is a push behind the command's own output, so everything it
 * printed or plotted has reached the store by then.
 */
function runAndWait(code: string): Promise<boolean> {
  const runId = crypto.randomUUID()
  return new Promise(resolve => {
    runWaiters.set(runId, resolve)
    window.api.terminal.rRun({ code, runId }).catch(() => {
      runWaiters.delete(runId)
      resolve(false)
    })
  })
}

/** The id of the newest console chunk (-1 when empty). */
function lastOutputId(): number {
  const out = useTerminalStore.getState().rOutput
  return out[out.length - 1]?.id ?? -1
}

export function RConsole({ modeSwitch, active }: { modeSwitch: React.ReactNode; active: boolean }) {
  const { t } = useTranslation(['analysis', 'common'])
  const rStatus = useTerminalStore(s => s.rStatus)
  const rDebugLevel = useTerminalStore(s => s.rDebugLevel)
  const rOutput = useTerminalStore(s => s.rOutput)
  const showInOutput = useTerminalStore(s => s.showInOutput)
  const rSource = useTerminalStore(s => s.rSource)
  const setRSource = useTerminalStore(s => s.setRSource)
  const rViews = useTerminalStore(s => s.rViews)
  const rWidgets = useTerminalStore(s => s.rWidgets)
  const rReport = useTerminalStore(s => s.rReport)
  const [reportRunning, setReportRunning] = useState(false)
  // While a report chunk runs, its plots and sai_show() tables go to the
  // report instead of Output.
  const captureRef = useRef<{ plots: string[]; tables: ReportTable[] } | null>(null)
  const [input, setInput] = useState('')
  const [showGuide, setShowGuide] = useState(false)
  const [varsOpen, setVarsOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(true)
  const [editorTab, setEditorTab] = useState<string>(SCRIPT_TAB)
  const [sideOpen, setSideOpen] = useState(true)
  const [sideTab, setSideTab] = useState<RSideTab>('env')
  const rScripts = useTerminalStore(s => s.rScripts)
  const activeScriptId = useTerminalStore(s => s.activeScriptId)
  const activeScript = useTerminalStore(s => s.rScripts.find(x => x.id === s.activeScriptId))
  const scriptName = useTerminalStore(
    s => s.rScripts.find(x => x.id === s.activeScriptId)?.name ?? 'script.R'
  )
  // A tab whose unsaved text the user is asked about before it closes.
  const [closingScriptId, setClosingScriptId] = useState<string | null>(null)
  // R Markdown / Quarto: Run line / Run all see only the evaluated R chunks
  // (everything else blanked, offsets intact); the report reads the document.
  const rmd = isRMarkdown(scriptName, rSource)
  const runText = useMemo(() => (rmd ? rmdRunnableText(rSource) : rSource), [rmd, rSource])
  /** Drops the blanked-out lines a selection or Run all over R Markdown carries. */
  const runnable = useCallback(
    (code: string) =>
      rmd
        ? code
            .split('\n')
            .filter(l => l.trim() !== '')
            .join('\n')
        : code,
    [rmd]
  )
  const [editorSel, setEditorSel] = useState<[number, number]>([0, 0])
  const [attempted, setAttempted] = useState(false)
  const outRef = useRef<HTMLDivElement>(null)
  const inputEdRef = useRef<CodeEditorHandle>(null)
  const editorRef = useRef<CodeEditorHandle>(null)
  // Where a clicked variable / object name goes: the last focused input.
  const lastFocusRef = useRef<'editor' | 'console'>('editor')
  const outCopy = useSelectionCopy(outRef)
  const {
    editorWrapRef,
    bodyRef,
    editorStyle,
    onPointerDown: onSplitterPointerDown,
    onKeyDown: onSplitterKeyDown
  } = useSplitter()
  const startedRef = useRef(false)
  // History cursor: null = editing a fresh line; number = index into rHistory.
  const histIdxRef = useRef<number | null>(null)
  // terminal.md §12.2: warn when the dataset the session bridged has since
  // changed — edited, or another dataset opened (File ▸ Open, sai_commit) —
  // the read-only `data` snapshot in R is otherwise silently stale.
  const bridgedKeyRef = useRef<string | null>(null)
  const dataKey = useDatasetStore(s => currentDataKey(s))
  const [stale, setStale] = useState(false)

  useEffect(() => {
    if (bridgedKeyRef.current !== null && dataKey !== bridgedKeyRef.current) {
      setStale(true)
    }
  }, [dataKey])

  // Subscribe to the streamed session output/status/side outputs (stays mounted).
  useEffect(() => {
    const store = useTerminalStore.getState()
    const unsubOut = window.api.on.terminalROutput(({ chunk, stream, params }) => {
      store.appendROutput(chunk, stream, params)
    })
    const unsubStatus = window.api.on.terminalRStatus(({ status, debugLevel }) => {
      useTerminalStore.getState().setRStatus(status, debugLevel)
    })
    const unsubPlot = window.api.on.terminalRPlot(({ png, plotId }) => {
      useTerminalStore.getState().appendRPlot(png, plotId)
      if (captureRef.current) {
        captureRef.current.plots.push(png)
        return
      }
      // A new plot brings the Plots tab forward (RStudio does the same).
      setSideOpen(true)
      setSideTab('plots')
      // Promote plots to Output only when the toolbar toggle is on.
      if (useTerminalStore.getState().showInOutput) promotePlotToOutput(png)
    })
    // sai_show() is an explicit "send to Output" — always promotes.
    const unsubRunDone = window.api.on.terminalRRunDone(({ runId, ok }) => {
      const done = runWaiters.get(runId)
      runWaiters.delete(runId)
      done?.(ok)
    })
    const unsubTable = window.api.on.terminalRTable(payload => {
      if (captureRef.current) captureRef.current.tables.push(payload)
      else promoteTableToOutput(payload)
    })
    const unsubEnv = window.api.on.terminalREnv(({ items, frame }) => {
      useTerminalStore.getState().setREnv(items, frame)
    })
    const unsubWd = window.api.on.terminalRWd(payload => {
      useTerminalStore.getState().setRWd(payload)
    })
    const unsubPkgs = window.api.on.terminalRPackages(({ items }) => {
      useTerminalStore.getState().setRPackages(items)
    })
    const unsubWidget = window.api.on.terminalRWidget(w => {
      useTerminalStore.getState().addRWidget(w)
      setEditorOpen(true)
      setEditorTab(w.widgetId)
    })
    const unsubHelp = window.api.on.terminalRHelp(help => {
      useTerminalStore.getState().setRHelp(help)
      setSideOpen(true)
      setSideTab('help')
    })
    const unsubView = window.api.on.terminalRView(view => {
      // Viewing the same object again replaces its tab — free the old table.
      const s = useTerminalStore.getState()
      for (const old of s.rViews) {
        if (old.title === view.title) void window.api.terminal.rViewClose({ viewId: old.viewId })
      }
      s.addRView(view)
      setEditorOpen(true)
      setEditorTab(view.viewId)
    })
    // sai_commit(df): same guard as File ▸ Import (Save / Discard / Cancel when
    // the open dataset has unsaved edits), then the data frame becomes the new
    // dataset — marked modified, since it exists nowhere on disk yet.
    const unsubCommit = window.api.on.terminalRCommit(commit => {
      void (async () => {
        const out = useTerminalStore.getState()
        const accept = await ensureCanReplaceDataset()
        try {
          const res = await window.api.terminal.rCommitResolve({
            commitId: commit.commitId,
            accept
          })
          if (!res) {
            out.appendROutput('terminal.r.notice.commitCancelled', 'notice')
            return
          }
          const ds = useDatasetStore.getState()
          ds.setDataset(
            res.dataset.id,
            res.dataset.name,
            res.dataset.filePath,
            res.variables,
            res.dataset.rowCount,
            res.styles
          )
          ds.setModified(true)
          out.appendROutput('terminal.r.notice.committed', 'notice', {
            name: res.dataset.name,
            rows: res.dataset.rowCount.toLocaleString(),
            cols: String(res.variables.length)
          })
        } catch (err) {
          out.appendROutput('terminal.r.notice.commitFailed', 'notice', { detail: String(err) })
        }
      })()
    })
    return () => {
      unsubRunDone()
      unsubCommit()
      unsubOut()
      unsubStatus()
      unsubPlot()
      unsubTable()
      unsubEnv()
      unsubWd()
      unsubPkgs()
      unsubWidget()
      unsubHelp()
      unsubView()
    }
  }, [])

  const startSession = useCallback(() => {
    setAttempted(true)
    bridgedKeyRef.current = currentDataKey(useDatasetStore.getState())
    setStale(false)
    const datasetId = useDatasetStore.getState().datasetId ?? undefined
    void window.api.terminal.rStart({ datasetId }).catch((err: unknown) => {
      useTerminalStore
        .getState()
        .appendROutput('terminal.r.notice.startFailed', 'notice', { detail: String(err) })
    })
  }, [])

  // Start the session the first time the user opens R mode.
  useEffect(() => {
    if (!active || startedRef.current) return
    startedRef.current = true
    startSession()
  }, [active, startSession])

  // Auto-scroll to newest output.
  useEffect(() => {
    const el = outRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [rOutput])

  const busy = rStatus === 'busy' || rStatus === 'starting'
  const dead = rStatus === 'dead'
  const debugging = rStatus === 'debug'

  /** Echo `code` into the console (R-style `>`/`+` prompts) and send it to R. */
  const sendCode = useCallback(
    (code: string) => {
      if (code.trim() === '' || dead) return
      echoCode(code)
      useTerminalStore.getState().pushHistory(code)
      void window.api.terminal.rWrite({ code }).catch((err: unknown) => {
        useTerminalStore.getState().appendROutput(`${String(err)}\n`, 'stderr')
      })
    },
    [dead]
  )

  /**
   * Build the report: run the script chunk by chunk in the live session and
   * collect each chunk's console text, plots and sai_show() tables. Stops at
   * the first chunk the session could not finish (stopped / restarted).
   */
  const runReport = useCallback(async () => {
    if (reportRunning || dead) return
    const doc = rmd ? parseRmd(rSource) : { title: null, parts: parseRReport(rSource) }
    const parts = doc.parts
    const report: RReport = {
      title: doc.title ?? scriptName,
      createdAt: new Date().toISOString(),
      datasetName: useDatasetStore.getState().datasetName,
      items: [],
      incomplete: false
    }
    const items: ReportItem[] = []
    const publish = (incomplete = false) => {
      useTerminalStore.getState().setRReport({ ...report, items: [...items], incomplete })
    }
    publish()
    setReportRunning(true)
    setEditorOpen(true)
    setEditorTab(REPORT_TAB)
    let chunks = 0
    try {
      for (const part of parts) {
        if (part.kind !== 'code') {
          items.push(part)
          publish()
          continue
        }
        const opts = part.opts
        if (opts && !opts.eval) {
          // R Markdown eval = FALSE: shown, not run.
          if (opts.include && opts.echo) {
            items.push({
              kind: 'code',
              code: part.code,
              output: '',
              error: false,
              plots: [],
              tables: []
            })
            publish()
          }
          continue
        }
        const before = lastOutputId()
        captureRef.current = { plots: [], tables: [] }
        echoCode(part.code)
        const ok = await runAndWait(part.code)
        const cap = captureRef.current
        captureRef.current = null
        const printed = useTerminalStore
          .getState()
          .rOutput.filter(c => c.id > before && (c.stream === 'stdout' || c.stream === 'stderr'))
        let output = stripAnsi(printed.map(c => c.text).join('')).replace(/\s+$/, '')
        if (output.length > REPORT_OUTPUT_MAX) output = `${output.slice(0, REPORT_OUTPUT_MAX)}\n…`
        // R Markdown include = FALSE: it ran (setup chunks), but shows nothing.
        if (!opts || opts.include) {
          items.push({
            kind: 'code',
            code: part.code,
            ...(opts && !opts.echo ? { hideCode: true } : {}),
            output,
            // .sai_run words errors itself ("Error in f(x) : …" / "Error: …").
            error: printed.some(c => c.stream === 'stderr' && /^Error\b/m.test(c.text)),
            plots: cap.plots,
            tables: cap.tables
          })
        }
        chunks++
        if (!ok) {
          publish(true)
          useTerminalStore.getState().appendROutput('terminal.r.notice.reportStopped', 'notice')
          return
        }
        publish()
      }
      useTerminalStore.getState().appendROutput('terminal.r.notice.reportDone', 'notice', {
        name: scriptName,
        chunks: String(chunks)
      })
    } finally {
      captureRef.current = null
      setReportRunning(false)
    }
  }, [reportRunning, dead, rmd, rSource, scriptName])

  const saveReport = useCallback(
    async (format: 'html' | 'pdf') => {
      const report = useTerminalStore.getState().rReport
      if (!report) return
      const html = buildReportHtml(report, {
        generated: t('terminal.r.report.generated', {
          when: new Date(report.createdAt).toLocaleString()
        }),
        incomplete: t('terminal.r.report.incomplete')
      })
      const base = report.title.replace(/\.r$/i, '') || 'report'
      const path =
        format === 'html'
          ? await window.api.file.saveOutputHtml({ html, defaultName: `${base}.html` })
          : await window.api.file.exportOutputPdf({ html, defaultName: `${base}.pdf` })
      if (path) {
        useTerminalStore
          .getState()
          .appendROutput('terminal.r.notice.reportSaved', 'notice', { path })
      }
    },
    [t]
  )

  const closeReport = () => {
    useTerminalStore.getState().setRReport(null)
    if (editorTab === REPORT_TAB) setEditorTab(SCRIPT_TAB)
  }

  const run = useCallback(() => {
    if (input.trim() === '' || dead) return
    sendCode(input)
    histIdxRef.current = null
    setInput('')
  }, [input, dead, sendCode])

  const hasEditorSelection = editorSel[1] > editorSel[0]

  /**
   * Ctrl+Enter (RStudio): run the selection, or the whole statement under the
   * caret (multi-line calls included), then move to the next statement.
   */
  const runCurrent = useCallback(() => {
    const [s, e] = editorSel
    if (e > s) {
      const code = runnable(runText.slice(s, e))
      if (code.trim() !== '') sendCode(code)
      return
    }
    const lines = runText.split('\n')
    let line = runText.slice(0, s).split('\n').length - 1
    const cur = (lines[line] ?? '').trim()
    if (cur === '' || cur.startsWith('#')) {
      line = nextCodeLine(runText, line)
      if (line < 0) return
    }
    const [first, last] = statementRangeAt(runText, line)
    sendCode(lines.slice(first, last + 1).join('\n'))
    const next = nextCodeLine(runText, last)
    const pos =
      next >= 0
        ? lineStartOffset(runText, next)
        : lineStartOffset(runText, last) + (lines[last] ?? '').length
    editorRef.current?.selectRange(pos, pos)
  }, [editorSel, runText, runnable, sendCode])

  const runAll = useCallback(() => {
    const code = runnable(runText)
    if (code.trim() !== '') sendCode(code)
  }, [runText, runnable, sendCode])

  /** F1: open the help page for the word under the caret (no console echo). */
  const helpFor = useCallback(
    (text: string, caret: number) => {
      const word = wordAt(text, caret)
      if (word === '' || dead) return
      void window.api.terminal.rWrite({ code: `help(${JSON.stringify(word)})` })
    },
    [dead]
  )

  // Edit ▸ Find / Find & Replace (Ctrl+F / Ctrl+H) search the R script while
  // R mode is on screen; the Data View answers them on its own tab.
  useEffect(
    () =>
      window.api.on.menuCommand(channel => {
        if (channel !== 'menu:edit:find' && channel !== 'menu:edit:find-replace') return
        if (!active || useUIStore.getState().activeTab !== 'terminal') return
        setEditorOpen(true)
        setEditorTab(SCRIPT_TAB)
        // The editor may only now be shown — open once it has rendered.
        requestAnimationFrame(() => {
          editorRef.current?.openFind(channel === 'menu:edit:find-replace')
        })
      }),
    [active]
  )

  const stop = useCallback(() => {
    const ds = useDatasetStore.getState()
    // The dataset goes along in case Stop has to restart R (Windows fallback
    // when Ctrl+C cannot interrupt) — the new session then bridges it afresh.
    void window.api.terminal
      .rInterrupt({ datasetId: ds.datasetId ?? undefined })
      .then(({ restarted }) => {
        if (!restarted) return
        bridgedKeyRef.current = currentDataKey(ds)
        setStale(false)
      })
  }, [])

  /** A browser command from the debugger bar: echoed, not kept in history. */
  const debugCommand = useCallback((cmd: RDebugCommand) => {
    const store = useTerminalStore.getState()
    if (store.rStatus !== 'debug') return
    store.appendROutput(`Browse[${String(store.rDebugLevel)}]> ${cmd}\n`, 'input')
    void window.api.terminal.rWrite({ code: cmd })
  }, [])

  // ↑/↓ recall previous commands when the input is a single line (REPL-style).
  const recallHistory = (dir: -1 | 1): void => {
    const hist = useTerminalStore.getState().rHistory
    if (hist.length === 0) return
    const cur = histIdxRef.current
    let next: number | null
    if (dir === -1) {
      next = cur === null ? hist.length - 1 : Math.max(0, cur - 1)
    } else {
      if (cur === null) return
      next = cur + 1 >= hist.length ? null : cur + 1
    }
    histIdxRef.current = next
    setInput(next === null ? '' : (hist[next] ?? ''))
  }

  // Console input keys the editor's suggestion list did not take. Only hijack
  // ↑/↓ for single-line input, so multi-line editing still works.
  const consoleKeys = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !input.includes('\n')) {
      e.preventDefault()
      recallHistory(e.key === 'ArrowUp' ? -1 : 1)
      return true
    }
    return false
  }

  const restart = () => {
    const datasetId = useDatasetStore.getState().datasetId ?? undefined
    useTerminalStore.getState().resetRSession()
    setEditorTab(SCRIPT_TAB)
    bridgedKeyRef.current = currentDataKey(useDatasetStore.getState())
    setStale(false)
    setAttempted(true)
    void window.api.terminal.rRestart({ datasetId })
  }

  const reload = () => {
    const datasetId = useDatasetStore.getState().datasetId ?? undefined
    if (!datasetId) return
    bridgedKeyRef.current = currentDataKey(useDatasetStore.getState())
    setStale(false)
    void window.api.terminal.rReloadData({ datasetId })
  }

  const openScript = async () => {
    const res = await window.api.file.openSyntax({ kind: 'r' })
    if (!res) return
    useTerminalStore
      .getState()
      .openRScript(res.filePath.split(/[\\/]/).pop() ?? 'script.R', res.content, res.filePath)
    setEditorOpen(true)
    setEditorTab(SCRIPT_TAB)
  }

  /** Writes in place to a file chosen this session; otherwise asks where. */
  const saveScript = async () => {
    const saved = await window.api.file.saveSyntax({
      content: rSource,
      defaultName: scriptName,
      kind: 'r',
      ...(activeScript?.filePath ? { filePath: activeScript.filePath } : {})
    })
    if (!saved) return
    useTerminalStore.getState().markRScriptSaved(saved.split(/[\\/]/).pop() ?? scriptName, saved)
  }

  const showScriptTab = (id: string) => {
    useTerminalStore.getState().switchRScript(id)
    setEditorTab(SCRIPT_TAB)
  }

  /** Close a script tab, asking first when it holds unsaved text. */
  const requestCloseScript = (id: string) => {
    const tab = rScripts.find(s => s.id === id)
    if (!tab) return
    const text = id === activeScriptId ? rSource : tab.source
    if (isScriptDirty(tab, text)) setClosingScriptId(id)
    else useTerminalStore.getState().closeRScript(id)
  }

  const closeWidget = (widgetId: string) => {
    useTerminalStore.getState().removeRWidget(widgetId)
    if (editorTab === widgetId) setEditorTab(SCRIPT_TAB)
  }

  const closeView = (viewId: string) => {
    useTerminalStore.getState().removeRView(viewId)
    void window.api.terminal.rViewClose({ viewId })
    if (editorTab === viewId) setEditorTab(SCRIPT_TAB)
  }

  /** A chunk as plain text (copy): notices translated, colour codes removed. */
  const chunkText = useCallback(
    (c: ROutputChunk) =>
      c.stream === 'notice'
        ? `${String(t(c.text as never, c.params))}\n`
        : c.stream === 'traceback'
          ? `${t('terminal.r.traceback', { count: c.text.split('\n').length })}\n${c.text}\n`
          : stripAnsi(c.text),
    [t]
  )

  const copyOutput = useCallback(() => {
    void navigator.clipboard.writeText(rOutput.map(chunkText).join(''))
  }, [rOutput, chunkText])

  /** Insert code where the user was last typing (script editor or console input). */
  const insertCode = (code: string) => {
    if (lastFocusRef.current === 'editor' && editorOpen && editorTab === SCRIPT_TAB) {
      editorRef.current?.insertText(code)
      return
    }
    inputEdRef.current?.insertText(code)
  }

  const renderedOutput = useMemo(
    () =>
      rOutput.map(chunk =>
        chunk.stream === 'traceback' ? (
          <TracebackChunk key={chunk.id} text={chunk.text} />
        ) : (
          <span
            key={chunk.id}
            className={cx(
              styles.rChunk,
              chunk.stream === 'stderr' && styles.error,
              chunk.stream === 'notice' && styles.rNotice,
              chunk.stream === 'input' && styles.rInput
            )}
          >
            {chunk.stream === 'stdout' || chunk.stream === 'stderr'
              ? renderAnsi(chunk.text)
              : chunkText(chunk)}
          </span>
        )
      ),
    [rOutput, chunkText]
  )

  const activeView = rViews.find(v => v.viewId === editorTab) ?? null
  const activeWidget = rWidgets.find(w => w.widgetId === editorTab) ?? null
  const showReport = editorTab === REPORT_TAB && rReport !== null
  const showScript = activeView === null && activeWidget === null && !showReport
  const dirty = activeScript ? isScriptDirty(activeScript, rSource) : false

  return (
    <div className={styles.body}>
      <div className={styles.subToolbar}>
        {modeSwitch}
        <span className={styles.toolbarDivider} />
        <span className={cx(styles.statusBadge, styles[`status_${rStatus}`])}>
          <span className={styles.statusDot} />
          {t(`terminal.r.status.${rStatus}`)}
        </span>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={showInOutput}
            onChange={e => {
              useTerminalStore.getState().setShowInOutput(e.target.checked)
            }}
          />
          {t('terminal.r.showInOutput')}
        </label>
        {stale && (
          <button
            className={cx(styles.button, styles.staleBadge)}
            onClick={reload}
            disabled={dead}
            title={t('terminal.r.staleHint')}
          >
            <AlertIcon size={12} />
            {t('terminal.r.stale')}
          </button>
        )}
        <span className={styles.spacer} />
        <VarsToggle
          open={varsOpen}
          onToggle={() => {
            setVarsOpen(o => !o)
          }}
        />
        <button
          type="button"
          className={cx(styles.iconBtn, editorOpen && styles.iconBtnActive)}
          onClick={() => {
            setEditorOpen(o => !o)
          }}
          aria-pressed={editorOpen}
          title={t('terminal.r.editor.toggle')}
          aria-label={t('terminal.r.editor.toggle')}
        >
          <CodeIcon size={14} />
        </button>
        <button
          type="button"
          className={cx(styles.iconBtn, sideOpen && styles.iconBtnActive)}
          onClick={() => {
            setSideOpen(o => !o)
          }}
          aria-pressed={sideOpen}
          title={t('terminal.r.side.toggle')}
          aria-label={t('terminal.r.side.toggle')}
        >
          <PanelRightIcon size={14} />
        </button>
        <button
          type="button"
          className={cx(styles.iconBtn, showGuide && styles.iconBtnActive)}
          onClick={() => {
            setShowGuide(v => !v)
          }}
          aria-pressed={showGuide}
          title={t('terminal.r.guide.toggle')}
          aria-label={t('terminal.r.guide.toggle')}
        >
          <HelpIcon size={14} />
        </button>
        <span className={styles.toolbarDivider} />
        <button
          type="button"
          className={styles.iconBtn}
          onClick={reload}
          disabled={dead}
          title={t('terminal.r.reloadData')}
          aria-label={t('terminal.r.reloadData')}
        >
          <RefreshIcon size={14} />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={restart}
          title={t('terminal.r.restart')}
          aria-label={t('terminal.r.restart')}
        >
          <RestartIcon size={14} />
        </button>
      </div>

      {showGuide && <RGuide />}

      <div className={styles.workRow}>
        {varsOpen && (
          <VariablePanel
            onInsert={(v: Variable) => {
              insertCode(rColumnRef(v.name))
            }}
          />
        )}
        <div className={styles.workCol} ref={bodyRef}>
          {editorOpen && (
            <>
              <div className={styles.editorTabs}>
                <div
                  className={styles.editorTabList}
                  role="tablist"
                  aria-label={t('terminal.r.editor.toggle')}
                >
                  {rScripts.map(s => {
                    const selected = showScript && s.id === activeScriptId
                    const tabDirty = s.id === activeScriptId ? dirty : isScriptDirty(s, s.source)
                    return (
                      <span
                        key={s.id}
                        className={cx(styles.editorTab, selected && styles.editorTabActive)}
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          className={styles.editorTabBtn}
                          onClick={() => {
                            showScriptTab(s.id)
                          }}
                          title={tabDirty ? t('terminal.r.editor.unsaved') : undefined}
                        >
                          <CodeIcon size={12} />
                          {s.name}
                          {tabDirty && <span className={styles.dirtyDot} aria-hidden="true" />}
                        </button>
                        <button
                          type="button"
                          className={styles.editorTabClose}
                          onClick={() => {
                            requestCloseScript(s.id)
                          }}
                          title={t('terminal.r.editor.closeScript')}
                          aria-label={`${t('terminal.r.editor.closeScript')}: ${s.name}`}
                        >
                          <CloseIcon size={11} />
                        </button>
                      </span>
                    )
                  })}
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => {
                      useTerminalStore.getState().newRScript()
                      setEditorTab(SCRIPT_TAB)
                    }}
                    title={t('terminal.r.editor.newScript')}
                    aria-label={t('terminal.r.editor.newScript')}
                  >
                    <PlusIcon size={13} />
                  </button>
                  {rViews.map(v => (
                    <span
                      key={v.viewId}
                      className={cx(
                        styles.editorTab,
                        editorTab === v.viewId && styles.editorTabActive
                      )}
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={editorTab === v.viewId}
                        className={styles.editorTabBtn}
                        onClick={() => {
                          setEditorTab(v.viewId)
                        }}
                      >
                        <TableIcon size={12} />
                        {v.title}
                      </button>
                      <button
                        type="button"
                        className={styles.editorTabClose}
                        onClick={() => {
                          closeView(v.viewId)
                        }}
                        title={t('terminal.r.view.close')}
                        aria-label={`${t('terminal.r.view.close')}: ${v.title}`}
                      >
                        <CloseIcon size={11} />
                      </button>
                    </span>
                  ))}
                  {rReport && (
                    <span className={cx(styles.editorTab, showReport && styles.editorTabActive)}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={showReport}
                        className={styles.editorTabBtn}
                        onClick={() => {
                          setEditorTab(REPORT_TAB)
                        }}
                      >
                        <ReportIcon size={12} />
                        {t('terminal.r.report.tab')}
                      </button>
                      <button
                        type="button"
                        className={styles.editorTabClose}
                        onClick={closeReport}
                        disabled={reportRunning}
                        title={t('terminal.r.report.close')}
                        aria-label={t('terminal.r.report.close')}
                      >
                        <CloseIcon size={11} />
                      </button>
                    </span>
                  )}
                  {rWidgets.map(w => (
                    <span
                      key={w.widgetId}
                      className={cx(
                        styles.editorTab,
                        editorTab === w.widgetId && styles.editorTabActive
                      )}
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={editorTab === w.widgetId}
                        className={styles.editorTabBtn}
                        onClick={() => {
                          setEditorTab(w.widgetId)
                        }}
                      >
                        <ImageIcon size={12} />
                        {w.title}
                      </button>
                      <button
                        type="button"
                        className={styles.editorTabClose}
                        onClick={() => {
                          closeWidget(w.widgetId)
                        }}
                        title={t('terminal.r.viewer.close')}
                        aria-label={`${t('terminal.r.viewer.close')}: ${w.title}`}
                      >
                        <CloseIcon size={11} />
                      </button>
                    </span>
                  ))}
                </div>
                <span className={styles.spacer} />
                {showScript && (
                  <>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => void openScript()}
                      title={t('terminal.r.editor.open')}
                      aria-label={t('terminal.r.editor.open')}
                    >
                      <FolderOpenIcon size={14} />
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => void saveScript()}
                      disabled={rSource.trim() === ''}
                      title={t('terminal.r.editor.save')}
                      aria-label={t('terminal.r.editor.save')}
                    >
                      <SaveIcon size={14} />
                    </button>
                    <button
                      type="button"
                      className={styles.button}
                      onClick={runCurrent}
                      disabled={dead || rSource.trim() === ''}
                      title={t('terminal.r.editor.runLineHint')}
                    >
                      <PlayIcon size={12} />
                      {hasEditorSelection
                        ? t('terminal.runSelection')
                        : t('terminal.r.editor.runLine')}
                    </button>
                    <button
                      type="button"
                      className={styles.button}
                      onClick={() => void runReport()}
                      disabled={dead || reportRunning || rSource.trim() === ''}
                      title={t('terminal.r.report.buildHint')}
                    >
                      <ReportIcon size={12} />
                      {reportRunning
                        ? t('terminal.r.report.running')
                        : t('terminal.r.report.build')}
                    </button>
                    <button
                      type="button"
                      className={styles.button}
                      onClick={runAll}
                      disabled={dead || rSource.trim() === ''}
                      title={t('terminal.r.editor.runAllHint')}
                    >
                      <PlayAllIcon size={12} />
                      {t('terminal.r.editor.runAll')}
                    </button>
                  </>
                )}
              </div>
              <div
                className={cx(styles.editorWrap, styles.rEditorWrap)}
                ref={editorWrapRef}
                style={editorStyle}
              >
                {/* Kept mounted while a View() tab is shown so caret + undo survive. */}
                <div
                  className={cx(styles.editorLayer, !showScript && styles.paneHidden)}
                  onFocusCapture={() => {
                    lastFocusRef.current = 'editor'
                  }}
                >
                  <CodeEditor
                    // One editor per tab: switching scripts must not carry the
                    // previous script's undo history or caret over.
                    key={activeScriptId}
                    ref={editorRef}
                    value={rSource}
                    onChange={setRSource}
                    onRun={runCurrent}
                    onRunAll={runAll}
                    onHelp={caret => {
                      helpFor(rSource, caret)
                    }}
                    onSelectionChange={(s, e) => {
                      setEditorSel(prev => (prev[0] === s && prev[1] === e ? prev : [s, e]))
                    }}
                    tokenize={tokenizeR}
                    completer={rCompleter}
                    autoIndent
                    lineComment="#"
                    placeholder={t('terminal.r.editor.placeholder')}
                    ariaLabel={t('terminal.r.editor.label')}
                  />
                </div>
                {activeView && <RViewGrid key={activeView.viewId} view={activeView} />}
                {showReport && (
                  <RReportView
                    report={rReport}
                    running={reportRunning}
                    onRerun={() => void runReport()}
                    onSave={format =>
                      void saveReport(format).catch((err: unknown) => {
                        console.error('Failed to save report:', err)
                        useStatusNoticeStore.getState().show('status.exportFailed', 'error', 5000)
                      })
                    }
                  />
                )}
                {activeWidget && (
                  // Opaque origin (no allow-same-origin): the widget's scripts run
                  // but cannot reach this page, the preload API or IPC.
                  <iframe
                    key={activeWidget.widgetId}
                    className={styles.widgetFrame}
                    src={activeWidget.url}
                    sandbox="allow-scripts"
                    title={activeWidget.title}
                  />
                )}
              </div>
            </>
          )}

          <div
            className={cx(styles.splitter, !editorOpen && styles.splitterStatic)}
            role={editorOpen ? 'separator' : undefined}
            aria-orientation={editorOpen ? 'horizontal' : undefined}
            aria-label={editorOpen ? t('terminal.resize') : undefined}
            tabIndex={editorOpen ? 0 : undefined}
            onPointerDown={editorOpen ? onSplitterPointerDown : undefined}
            onKeyDown={editorOpen ? onSplitterKeyDown : undefined}
          >
            <span className={styles.splitterTitle}>{t('terminal.console.title')}</span>
            <span className={styles.spacer} />
            <ConsoleFind containerRef={outRef} version={rOutput} />
            <button
              type="button"
              className={styles.iconBtn}
              onClick={copyOutput}
              disabled={rOutput.length === 0}
              title={t('common:common.copy')}
              aria-label={t('common:common.copy')}
            >
              <CopyIcon size={13} />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => {
                useTerminalStore.getState().clearROutput()
              }}
              disabled={rOutput.length === 0}
              title={t('terminal.clear')}
              aria-label={t('terminal.clear')}
            >
              <TrashIcon size={13} />
            </button>
          </div>

          <div
            className={styles.rConsole}
            ref={outRef}
            aria-live="polite"
            onCopy={outCopy.onCopy}
            onContextMenu={outCopy.onContextMenu}
          >
            {outCopy.menu}
            {rOutput.length === 0 ? (
              <div className={styles.consoleEmpty}>
                <span className={styles.consoleEmptyIcon}>
                  <PlayIcon size={16} />
                </span>
                <span className={styles.consoleEmptyHint}>{t('terminal.r.console.empty')}</span>
              </div>
            ) : (
              renderedOutput
            )}
          </div>

          {dead && attempted && (
            <div className={styles.deadBanner} role="status">
              <AlertIcon size={14} />
              <span>{t('terminal.r.deadBanner')}</span>
              <button
                type="button"
                className={cx(styles.button, styles.primary)}
                onClick={startSession}
              >
                <PlayIcon size={12} />
                {t('terminal.r.start')}
              </button>
            </div>
          )}

          {debugging && <RDebugBar level={rDebugLevel} onCommand={debugCommand} onStop={stop} />}

          <div
            className={styles.rInputWrap}
            onFocusCapture={() => {
              lastFocusRef.current = 'console'
            }}
          >
            <div className={styles.rInputEditor}>
              <CodeEditor
                ref={inputEdRef}
                value={input}
                onChange={v => {
                  setInput(v)
                }}
                onRun={run}
                onHelp={caret => {
                  helpFor(input, caret)
                }}
                onSelectionChange={() => undefined}
                tokenize={tokenizeR}
                completer={rCompleter}
                autoIndent
                compact
                textareaClassName={styles.rInputArea}
                onKeyDownExtra={consoleKeys}
                placeholder={
                  debugging
                    ? t('terminal.r.debug.placeholder')
                    : t('terminal.r.console.placeholder')
                }
                ariaLabel={t('terminal.mode.r')}
              />
            </div>
            <div className={styles.rInputActions}>
              <button
                className={cx(styles.button, styles.primary)}
                onClick={run}
                disabled={busy || dead || input.trim() === ''}
              >
                <PlayIcon size={12} />
                {busy ? t('terminal.running') : t('terminal.run')}
              </button>
              {rStatus === 'busy' && (
                <button className={styles.button} onClick={stop} data-r-stop>
                  <StopIcon size={12} />
                  {t('terminal.r.stop')}
                </button>
              )}
            </div>
          </div>
        </div>
        {sideOpen && (
          <RSidePanel
            tab={sideTab}
            onTabChange={setSideTab}
            onHide={() => {
              setSideOpen(false)
            }}
            onSendPlotToOutput={promotePlotToOutput}
            onInsertName={name => {
              insertCode(rName(name))
            }}
            onView={name => {
              sendCode(`View(${rName(name)})`)
            }}
            onTogglePackage={(name, attach) => {
              // Echoed like typed code — the user sees (and can reuse) the call.
              sendCode(attach ? `library(${name})` : `detach("package:${name}", unload = TRUE)`)
            }}
            onRunCode={sendCode}
            onWriteToConsole={code => {
              setInput(code)
              inputEdRef.current?.focus()
            }}
            onOpenScript={name => {
              void window.api.terminal.rOpenFile({ name }).then(res => {
                if (!res) return
                useTerminalStore.getState().openRScript(name, res.content, res.filePath)
                setEditorOpen(true)
                setEditorTab(SCRIPT_TAB)
              })
            }}
            scriptDir={
              activeScript?.filePath ? activeScript.filePath.replace(/[\\/][^\\/]*$/, '') : null
            }
          />
        )}
      </div>
      {closingScriptId !== null && (
        <ConfirmDialog
          titleKey="terminalScript.closeUnsavedTitle"
          messageKey="terminalScript.closeUnsavedMessage"
          danger
          onConfirm={() => {
            useTerminalStore.getState().closeRScript(closingScriptId)
            setClosingScriptId(null)
          }}
          onCancel={() => {
            setClosingScriptId(null)
          }}
        />
      )}
    </div>
  )
}

/** stdout/stderr text with cli/crayon colours as token-coloured spans. */
function renderAnsi(text: string): React.ReactNode {
  const segs = parseAnsi(text)
  if (segs.length === 1 && !segs[0]?.color && !segs[0]?.bold) return segs[0]?.text ?? ''
  return segs.map((seg, i) =>
    seg.color || seg.bold ? (
      <span
        key={i}
        className={cx(seg.color && styles[`ansi_${seg.color}`], seg.bold && styles.ansiBold)}
      >
        {seg.text}
      </span>
    ) : (
      seg.text
    )
  )
}

/** An error's call stack, collapsed under one line (innermost call first, like R). */
function TracebackChunk({ text }: { text: string }) {
  const { t } = useTranslation(['analysis'])
  const calls = text.split('\n')
  return (
    <details className={styles.traceback}>
      <summary>{t('terminal.r.traceback', { count: calls.length })}</summary>
      <ol className={styles.tracebackList} reversed>
        {[...calls].reverse().map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ol>
    </details>
  )
}

/** Read-only session guidance (terminal.md §12.3). */
function RGuide() {
  const { t } = useTranslation(['analysis'])
  const sees = ['sees1', 'sees2', 'sees3'] as const
  const cautions = ['caution1', 'caution2', 'caution3', 'caution4'] as const
  const tips = ['tip1', 'tip2'] as const
  return (
    <div className={styles.rGuide}>
      <p className={styles.rIntro}>{t('terminal.r.intro')}</p>
      <div className={styles.rGuideCols}>
        <div className={styles.rGuideCol}>
          <h4 className={styles.rGuideTitle}>{t('terminal.r.seesTitle')}</h4>
          <ul className={styles.rList}>
            {sees.map(k => (
              <li key={k}>{t(`terminal.r.${k}`)}</li>
            ))}
          </ul>
        </div>
        <div className={styles.rGuideCol}>
          <h4 className={styles.rGuideTitle}>{t('terminal.r.cautionsTitle')}</h4>
          <ul className={styles.rList}>
            {cautions.map(k => (
              <li key={k}>{t(`terminal.r.${k}`)}</li>
            ))}
          </ul>
        </div>
        <div className={styles.rGuideCol}>
          <h4 className={styles.rGuideTitle}>{t('terminal.r.tipsTitle')}</h4>
          <ul className={styles.rList}>
            {tips.map(k => (
              <li key={k}>{t(`terminal.r.${k}`)}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
