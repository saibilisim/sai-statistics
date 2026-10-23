// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import type {
  RSessionStatus,
  TerminalREnvItem,
  TerminalRHelpPayload,
  TerminalRPackage,
  TerminalRViewPayload,
  TerminalRWdPayload,
  TerminalRWidgetPayload
} from '@shared/ipc-contracts'
import type { RReport } from '../lib/r-report'

export type TerminalMode = 'spss' | 'r'

export type RStream = 'stdout' | 'stderr' | 'input' | 'notice' | 'traceback'

/** One streamed chunk of R console output. */
export interface ROutputChunk {
  id: number
  /** R text — or, for stream 'notice', an i18n key (analysis namespace). */
  text: string
  stream: RStream
  /** Interpolation params for a 'notice' key. */
  params?: Record<string, string>
}

/** A captured R plot (base64 PNG). */
export interface RPlot {
  id: number
  png: string
  /** The R session's id for the recorded plot (Export redraws it). */
  rid?: number
}

/** One R script editor tab. */
export interface RScriptTab {
  id: string
  /** File name shown on the tab. */
  name: string
  /** The text — stale for the ACTIVE tab, whose live text is `rSource`. */
  source: string
  /** Text as last opened/saved; differs from the live text = unsaved. */
  saved: string
  /** Where Save writes without asking (Main only honours paths the user
   *  picked in a file dialog this session); null = never saved. */
  filePath: string | null
}

/**
 * Terminal tab state that must survive tab switches:
 *   • `source` — SPSS-syntax editor buffer (also appended to by dialogs' "Paste").
 *   • `rSource` — the ACTIVE R script's text (dialogs' "Paste R" → "Send to R
 *     script"); `rScripts` holds every R script tab. Keeping the active text in
 *     its own field means everything that already read/wrote `rSource` (AI
 *     proposals, dialogs, tests) keeps working on the tab the user sees.
 *   • R console output/status — the persistent R session (Faz T2) and its
 *     IDE panes (Faz T3): environment, help page, View() grids.
 */
interface TerminalState {
  mode: TerminalMode
  setMode: (m: TerminalMode) => void
  rSource: string
  setRSource: (s: string) => void
  /** Append R code to the script (blank line between blocks); opens R mode. */
  appendRCode: (code: string) => void
  rScripts: RScriptTab[]
  activeScriptId: string
  /** A new, empty untitled script tab, made active. */
  newRScript: () => void
  /** Show a file: switches to its tab if already open, reuses an untouched
   *  empty untitled tab, otherwise opens a new one. */
  openRScript: (name: string, content: string, filePath: string | null) => void
  switchRScript: (id: string) => void
  /** Closes a tab (no prompt — the caller confirms unsaved text); the last
   *  tab is replaced by an empty one rather than leaving no editor. */
  closeRScript: (id: string) => void
  /** The active tab's current text was written to `filePath`. */
  markRScriptSaved: (name: string, filePath: string) => void
  /** Files pane: the session's working directory + entries; null before R reports it. */
  rWd: TerminalRWdPayload | null
  setRWd: (wd: TerminalRWdPayload | null) => void
  rEnv: TerminalREnvItem[]
  /** While debugging: the call whose frame `rEnv` lists; null = the global environment. */
  rFrame: string | null
  setREnv: (items: TerminalREnvItem[], frame?: string) => void
  rHelp: TerminalRHelpPayload | null
  setRHelp: (help: TerminalRHelpPayload | null) => void
  /** Installed packages; null until the Packages pane first asks. */
  rPackages: TerminalRPackage[] | null
  setRPackages: (items: TerminalRPackage[] | null) => void
  /** htmlwidgets printed in R (Viewer tabs). */
  rWidgets: TerminalRWidgetPayload[]
  addRWidget: (w: TerminalRWidgetPayload) => void
  removeRWidget: (widgetId: string) => void
  /** The last report built from the R script (editor-area tab); kept across restarts. */
  rReport: RReport | null
  setRReport: (report: RReport | null) => void
  rViews: TerminalRViewPayload[]
  addRView: (view: TerminalRViewPayload) => void
  removeRView: (viewId: string) => void
  /** Restart: everything tied to the old R process goes. */
  resetRSession: () => void

  source: string
  setSource: (s: string) => void
  /** Append a syntax line (adds a separating newline if the buffer is non-empty). */
  appendSyntax: (line: string) => void

  rStatus: RSessionStatus
  /** "Browse[n]" level while rStatus is 'debug'. */
  rDebugLevel: number
  rOutput: ROutputChunk[]
  rPlots: RPlot[]
  /** Executed R commands, oldest→newest (for ↑/↓ recall). */
  rHistory: string[]
  /** When true, R plots are ALSO promoted to the Output tab (radio toggle). */
  showInOutput: boolean
  setRStatus: (status: RSessionStatus, debugLevel?: number) => void
  appendROutput: (text: string, stream: RStream, params?: Record<string, string>) => void
  appendRPlot: (png: string, rid?: number) => number
  clearRPlots: () => void
  pushHistory: (code: string) => void
  clearROutput: () => void
  setShowInOutput: (v: boolean) => void
}

let rSeq = 0
let rPlotSeq = 0
let scriptSeq = 0

const newScriptId = (): string => `script-${String(Date.now())}-${String(scriptSeq++)}`

/** script.R, script2.R, … — the first name not already on a tab. */
function untitledName(tabs: RScriptTab[]): string {
  const taken = new Set(tabs.map(t => t.name.toLowerCase()))
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'script.R' : `script${String(n)}.R`
    if (!taken.has(name.toLowerCase())) return name
  }
}

const FIRST_SCRIPT_ID = newScriptId()

/** Tabs with the active one's live text written back into its `source`. */
export function scriptsWithLiveText(s: {
  rScripts: RScriptTab[]
  activeScriptId: string
  rSource: string
}): RScriptTab[] {
  return s.rScripts.map(t => (t.id === s.activeScriptId ? { ...t, source: s.rSource } : t))
}

export function isScriptDirty(tab: RScriptTab, liveText: string): boolean {
  return liveText !== tab.saved && liveText.trim() !== ''
}

// Long R sessions (e.g. printing a large data frame) can generate unbounded
// output; without a cap the renderer state — and every re-render of the
// console — grows without limit. Trim from the front once either threshold
// is crossed and leave a one-line marker so the truncation is visible.
const MAX_OUTPUT_CHUNKS = 5000
const MAX_OUTPUT_CHARS = 2_000_000
const MAX_PLOTS = 20
const MAX_WIDGETS = 8

function trimOutput(chunks: ROutputChunk[]): ROutputChunk[] {
  let totalChars = 0
  for (const c of chunks) totalChars += c.text.length
  if (chunks.length <= MAX_OUTPUT_CHUNKS && totalChars <= MAX_OUTPUT_CHARS) return chunks

  let start = Math.max(0, chunks.length - MAX_OUTPUT_CHUNKS)
  let kept = chunks.slice(start)
  let keptChars = kept.reduce((sum, c) => sum + c.text.length, 0)
  while (keptChars > MAX_OUTPUT_CHARS && kept.length > 1) {
    keptChars -= kept[0]?.text.length ?? 0
    kept = kept.slice(1)
    start++
  }
  if (start === 0) return chunks
  return [{ id: rSeq++, text: 'terminal.r.notice.truncated', stream: 'notice' as const }, ...kept]
}

export const useTerminalStore = create<TerminalState>()(set => ({
  mode: 'spss',
  setMode: mode => {
    set({ mode })
  },
  rSource: '',
  setRSource: rSource => {
    set({ rSource })
  },
  appendRCode: code => {
    set(s => {
      const base = s.rSource.replace(/\s*$/, '')
      return { rSource: base === '' ? code : `${base}\n\n${code}`, mode: 'r' }
    })
  },
  rScripts: [{ id: FIRST_SCRIPT_ID, name: 'script.R', source: '', saved: '', filePath: null }],
  activeScriptId: FIRST_SCRIPT_ID,
  newRScript: () => {
    set(s => {
      const tab: RScriptTab = {
        id: newScriptId(),
        name: untitledName(s.rScripts),
        source: '',
        saved: '',
        filePath: null
      }
      return { rScripts: [...scriptsWithLiveText(s), tab], activeScriptId: tab.id, rSource: '' }
    })
  },
  openRScript: (name, content, filePath) => {
    set(s => {
      const tabs = scriptsWithLiveText(s)
      const already = filePath
        ? tabs.find(t => t.filePath?.toLowerCase() === filePath.toLowerCase())
        : undefined
      if (already) return { rScripts: tabs, activeScriptId: already.id, rSource: already.source }
      const active = tabs.find(t => t.id === s.activeScriptId)
      const opened = { name, source: content, saved: content, filePath }
      if (active && active.filePath === null && active.source.trim() === '') {
        return {
          rScripts: tabs.map(t => (t.id === active.id ? { ...t, ...opened } : t)),
          rSource: content
        }
      }
      const tab: RScriptTab = { id: newScriptId(), ...opened }
      return { rScripts: [...tabs, tab], activeScriptId: tab.id, rSource: content }
    })
  },
  switchRScript: id => {
    set(s => {
      const tabs = scriptsWithLiveText(s)
      const next = tabs.find(t => t.id === id)
      if (!next || id === s.activeScriptId) return s
      return { rScripts: tabs, activeScriptId: id, rSource: next.source }
    })
  },
  closeRScript: id => {
    set(s => {
      const tabs = scriptsWithLiveText(s)
      const idx = tabs.findIndex(t => t.id === id)
      if (idx < 0) return s
      const rest = tabs.filter(t => t.id !== id)
      if (rest.length === 0) {
        const tab: RScriptTab = {
          id: newScriptId(),
          name: 'script.R',
          source: '',
          saved: '',
          filePath: null
        }
        return { rScripts: [tab], activeScriptId: tab.id, rSource: '' }
      }
      if (id !== s.activeScriptId) return { rScripts: rest }
      const next = rest[Math.min(idx, rest.length - 1)] as RScriptTab
      return { rScripts: rest, activeScriptId: next.id, rSource: next.source }
    })
  },
  markRScriptSaved: (name, filePath) => {
    set(s => ({
      rScripts: s.rScripts.map(t =>
        t.id === s.activeScriptId
          ? { ...t, name, filePath, source: s.rSource, saved: s.rSource }
          : t
      )
    }))
  },
  rWd: null,
  setRWd: rWd => {
    set({ rWd })
  },
  rEnv: [],
  rFrame: null,
  setREnv: (rEnv, frame) => {
    set({ rEnv, rFrame: frame ?? null })
  },
  rHelp: null,
  setRHelp: rHelp => {
    set({ rHelp })
  },
  rPackages: null,
  setRPackages: rPackages => {
    set({ rPackages })
  },
  rWidgets: [],
  addRWidget: w => {
    // A long plotting session would stack tabs without end — keep the newest.
    set(s => ({ rWidgets: [...s.rWidgets, w].slice(-MAX_WIDGETS) }))
  },
  removeRWidget: widgetId => {
    set(s => ({ rWidgets: s.rWidgets.filter(w => w.widgetId !== widgetId) }))
  },
  rReport: null,
  setRReport: rReport => {
    set({ rReport })
  },
  rViews: [],
  addRView: view => {
    // Same object viewed again replaces its tab instead of stacking a copy.
    set(s => ({ rViews: [...s.rViews.filter(v => v.title !== view.title), view] }))
  },
  removeRView: viewId => {
    set(s => ({ rViews: s.rViews.filter(v => v.viewId !== viewId) }))
  },
  resetRSession: () => {
    set({
      rOutput: [],
      rPlots: [],
      rEnv: [],
      rFrame: null,
      rWd: null,
      rViews: [],
      rWidgets: [],
      rPackages: null
    })
  },

  source: '',
  setSource: source => {
    set({ source })
  },
  appendSyntax: line => {
    set(s => {
      const base = s.source.replace(/\s*$/, '')
      return { source: base === '' ? line : `${base}\n${line}` }
    })
  },

  rStatus: 'dead',
  rDebugLevel: 1,
  rOutput: [],
  rPlots: [],
  rHistory: [],
  showInOutput: false,
  setRStatus: (rStatus, debugLevel) => {
    set(debugLevel === undefined ? { rStatus } : { rStatus, rDebugLevel: debugLevel })
  },
  appendROutput: (text, stream, params) => {
    set(s => ({ rOutput: trimOutput([...s.rOutput, { id: rSeq++, text, stream, params }]) }))
  },
  appendRPlot: (png, rid) => {
    const id = rPlotSeq++
    set(s => ({ rPlots: [...s.rPlots, { id, png, rid }].slice(-MAX_PLOTS) }))
    return id
  },
  clearRPlots: () => {
    set({ rPlots: [] })
  },
  pushHistory: code => {
    set(s => {
      const trimmed = code.trim()
      if (trimmed === '' || s.rHistory[s.rHistory.length - 1] === trimmed) return s
      return { rHistory: [...s.rHistory, trimmed].slice(-200) }
    })
  },
  clearROutput: () => {
    set({ rOutput: [], rPlots: [] })
  },
  setShowInOutput: v => {
    set({ showInOutput: v })
  }
}))
