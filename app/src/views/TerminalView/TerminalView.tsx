// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TerminalView — 5th tab: Syntax / Terminal.
 *
 * Two modes via a segmented control (rendered inside each mode's toolbar so
 * the tab has a single toolbar row):
 *   • SPSS  — a script editor on top, the run log below (SPSS Syntax Editor
 *             model). Commands go to the existing analysis/transform/variable
 *             pipeline (Faz T1, `runSpssSyntax`). Results open in Output.
 *   • R     — RConsole.tsx: R script editor + persistent R console (Faz T2/T3)
 *             with Environment / Plots / Help panes and the View() grid.
 * Both modes share the variable side panel (click a name to insert it).
 *
 * No hardcoded colours/strings — tokens (§7) + i18n (§6) only.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Variable } from '@shared/data-types'
import { runSpssSyntax, type SyntaxLogEntry } from '../../lib/spss-syntax'
import { useTerminalStore, type TerminalMode } from '../../store/terminal-store'
import { useUIStore } from '../../store/ui-store'
import { cx } from '../../lib/cx'
import { useSelectionCopy } from '../../lib/use-text-context-menu'
import { PlayIcon, TrashIcon, CopyIcon, FolderOpenIcon, SaveIcon } from './terminal-icons'
import { CodeEditor, type CodeEditorHandle, type Completer } from './CodeEditor'
import { tokenizeSpssLine, getCurrentToken, getCommandSuggestions } from './spss-editor-helpers'
import { VariablePanel, VarsToggle } from './VariablePanel'
import { CommandsMenu } from './CommandsMenu'
import { RConsole } from './RConsole'
import { useSplitter } from './use-splitter'
import styles from './TerminalView.module.css'

/** SPSS command-name completion (sync, from the dispatcher's own command list). */
const spssCompleter: Completer = {
  tokenAt: getCurrentToken,
  suggest: (_value, _caret, token) =>
    getCommandSuggestions(token).map(cmd => ({ label: cmd, insert: `${cmd} ` })),
  autoMinChars: 1
}

let logSeq = 0
interface ConsoleLine extends SyntaxLogEntry {
  id: number
  /** 0-based editor line where this entry's statement starts (null = unknown). */
  srcLine: number | null
}

export function TerminalView() {
  const mode = useTerminalStore(s => s.mode)
  const setMode = useTerminalStore(s => s.setMode)
  // Rendered only in the visible pane's toolbar — one tablist, not two.
  const modeSwitch = <ModeSwitch mode={mode} onChange={setMode} />

  return (
    <div className={styles.root}>
      {/* Both panes stay mounted so their state/subscriptions survive switching. */}
      <div className={cx(styles.pane, mode !== 'spss' && styles.paneHidden)}>
        <SpssConsole modeSwitch={mode === 'spss' ? modeSwitch : null} />
      </div>
      <div className={cx(styles.pane, mode !== 'r' && styles.paneHidden)}>
        <RConsole modeSwitch={mode === 'r' ? modeSwitch : null} active={mode === 'r'} />
      </div>
    </div>
  )
}

function ModeSwitch({
  mode,
  onChange
}: {
  mode: TerminalMode
  onChange: (m: TerminalMode) => void
}) {
  const { t } = useTranslation(['analysis'])
  return (
    <div className={styles.modeSwitch} role="tablist" aria-label={t('terminal.title')}>
      {(['spss', 'r'] as const).map(m => (
        <button
          key={m}
          role="tab"
          aria-selected={mode === m}
          className={cx(styles.modeBtn, mode === m && styles.modeActive)}
          onClick={() => {
            onChange(m)
          }}
        >
          {t(`terminal.mode.${m}`)}
        </button>
      ))}
    </div>
  )
}

/**
 * For each statement echo in `entries`, find the editor line where that
 * statement starts — searched in order from `fromLine`, so repeated
 * statements map to successive occurrences. Every entry inherits the line of
 * the echo it follows.
 */
function attachSourceLines(
  entries: SyntaxLogEntry[],
  source: string,
  fromLine: number
): ConsoleLine[] {
  const lines = source.split('\n').map(l => l.trim())
  let cursor = fromLine
  let current: number | null = null
  return entries.map(e => {
    if (e.key === 'terminal.log.echo') {
      const first = String(e.params?.['line'] ?? '')
        .split('\n')[0]
        ?.trim()
      current = null
      if (first) {
        for (let i = cursor; i < lines.length; i++) {
          if ((lines[i] ?? '').startsWith(first)) {
            current = i
            cursor = i + 1
            break
          }
        }
      }
    }
    return { ...e, id: logSeq++, srcLine: current }
  })
}

// ── SPSS mode (Faz T1) ────────────────────────────────────────────────────────

function SpssConsole({ modeSwitch }: { modeSwitch: React.ReactNode }) {
  const { t } = useTranslation(['analysis', 'common'])
  const source = useTerminalStore(s => s.source)
  const setSource = useTerminalStore(s => s.setSource)
  const [lines, setLines] = useState<ConsoleLine[]>([])
  const [running, setRunning] = useState(false)
  const [selection, setSelection] = useState<[number, number]>([0, 0])
  const [errorLines, setErrorLines] = useState<ReadonlySet<number>>(new Set())
  const [varsOpen, setVarsOpen] = useState(true)
  const [fileName, setFileName] = useState('syntax.sps')
  const consoleRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<CodeEditorHandle>(null)
  const {
    editorWrapRef,
    bodyRef,
    editorStyle,
    onPointerDown: onSplitterPointerDown,
    onKeyDown: onSplitterKeyDown
  } = useSplitter()
  const consoleCopy = useSelectionCopy(consoleRef)

  // Edit ▸ Find / Find & Replace (Ctrl+F / Ctrl+H) search the syntax editor
  // while this mode is on screen; the Data View answers them on its own tab.
  useEffect(
    () =>
      window.api.on.menuCommand(channel => {
        if (channel !== 'menu:edit:find' && channel !== 'menu:edit:find-replace') return
        if (useUIStore.getState().activeTab !== 'terminal') return
        if (useTerminalStore.getState().mode !== 'spss') return
        editorRef.current?.openFind(channel === 'menu:edit:find-replace')
      }),
    []
  )

  const hasSelection = selection[1] > selection[0]

  const setSourceAndClearMarks = useCallback(
    (s: string) => {
      setSource(s)
      // Line numbers shift as the text changes — stale markers would lie.
      setErrorLines(prev => (prev.size === 0 ? prev : new Set()))
    },
    [setSource]
  )

  const appendLines = useCallback((entries: ConsoleLine[]) => {
    setLines(prev => [...prev, ...entries])
    setTimeout(() => {
      const el = consoleRef.current
      if (el) el.scrollTop = el.scrollHeight
    }, 0)
  }, [])

  const run = useCallback(() => {
    const [selStart, selEnd] = selection
    const code = selEnd > selStart ? source.slice(selStart, selEnd) : source
    if (running || code.trim() === '') return
    const fromLine = selEnd > selStart ? source.slice(0, selStart).split('\n').length - 1 : 0
    const ranSource = source
    setRunning(true)
    void runSpssSyntax(code)
      .then(entries => {
        const withLines = attachSourceLines(entries, ranSource, fromLine)
        const failed = new Set<number>()
        for (const l of withLines)
          if (l.level === 'error' && l.srcLine !== null) failed.add(l.srcLine)
        setErrorLines(failed)
        appendLines(withLines)
      })
      .catch((err: unknown) => {
        appendLines([
          {
            level: 'error',
            key: 'terminal.log.runFailed',
            params: { detail: String(err) },
            id: logSeq++,
            srcLine: null
          }
        ])
      })
      .finally(() => {
        setRunning(false)
      })
  }, [running, source, selection, appendLines])

  /** Jump to a logged statement in the editor; re-add it if it's gone. */
  const showInEditor = useCallback(
    (line: ConsoleLine, echoText: string | null) => {
      const srcLines = source.split('\n')
      if (line.srcLine !== null && line.srcLine < srcLines.length) {
        const start = srcLines.slice(0, line.srcLine).join('\n').length + (line.srcLine > 0 ? 1 : 0)
        const end = start + (srcLines[line.srcLine] ?? '').length
        editorRef.current?.selectRange(start, end)
        return
      }
      if (echoText !== null) {
        const statement = echoText.trim().endsWith('.') ? echoText.trim() : `${echoText.trim()}.`
        editorRef.current?.insertLine(statement)
      }
    },
    [source]
  )

  const copyOutput = useCallback(() => {
    const text = lines
      .map(line =>
        line.key === 'terminal.log.echo'
          ? `> ${String(line.params?.['line'] ?? '')}`
          : t(line.key as never, line.params)
      )
      .join('\n')
    void navigator.clipboard.writeText(text)
  }, [lines, t])

  const openFile = async () => {
    const res = await window.api.file.openSyntax()
    if (!res) return
    setSourceAndClearMarks(res.content)
    setFileName(res.filePath.split(/[\\/]/).pop() ?? 'syntax.sps')
  }

  const saveFile = async () => {
    const saved = await window.api.file.saveSyntax({ content: source, defaultName: fileName })
    if (saved) setFileName(saved.split(/[\\/]/).pop() ?? fileName)
  }

  const insertVariable = (v: Variable) => {
    const before = source.slice(0, selection[0])
    const needsSpace = before !== '' && !/[\s=(/]$/.test(before)
    editorRef.current?.insertText(`${needsSpace ? ' ' : ''}${v.name}`)
  }

  return (
    <div className={styles.body}>
      <div className={styles.subToolbar}>
        {modeSwitch}
        <span className={styles.toolbarDivider} />
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => void openFile()}
          title={t('terminal.open')}
          aria-label={t('terminal.open')}
        >
          <FolderOpenIcon size={14} />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => void saveFile()}
          disabled={source.trim() === ''}
          title={t('terminal.save')}
          aria-label={t('terminal.save')}
        >
          <SaveIcon size={14} />
        </button>
        <CommandsMenu
          onInsertStatement={code => editorRef.current?.insertLine(code)}
          onInsertCommand={cmd => editorRef.current?.insertLine(`${cmd} `)}
        />
        <span className={styles.spacer} />
        <VarsToggle
          open={varsOpen}
          onToggle={() => {
            setVarsOpen(o => !o)
          }}
        />
        <button
          className={cx(styles.button, styles.primary)}
          onClick={run}
          disabled={running || source.trim() === ''}
        >
          <PlayIcon size={12} />
          {running
            ? t('terminal.running')
            : hasSelection
              ? t('terminal.runSelection')
              : t('terminal.run')}
        </button>
      </div>

      <div className={styles.workRow}>
        {varsOpen && <VariablePanel onInsert={insertVariable} />}
        <div className={styles.workCol} ref={bodyRef}>
          <div className={styles.editorWrap} ref={editorWrapRef} style={editorStyle}>
            <CodeEditor
              ref={editorRef}
              value={source}
              onChange={setSourceAndClearMarks}
              onRun={run}
              onSelectionChange={(s, e) => {
                setSelection(prev => (prev[0] === s && prev[1] === e ? prev : [s, e]))
              }}
              errorLines={errorLines}
              tokenize={tokenizeSpssLine}
              completer={spssCompleter}
              placeholder={t('terminal.placeholder.spss')}
              ariaLabel={t('terminal.mode.spss')}
            />
          </div>

          <div
            className={styles.splitter}
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('terminal.resize')}
            tabIndex={0}
            onPointerDown={onSplitterPointerDown}
            onKeyDown={onSplitterKeyDown}
          >
            <span className={styles.splitterTitle}>{t('terminal.console.title')}</span>
            <span className={styles.spacer} />
            <button
              type="button"
              className={styles.iconBtn}
              onClick={copyOutput}
              disabled={lines.length === 0}
              title={t('common:common.copy')}
              aria-label={t('common:common.copy')}
            >
              <CopyIcon size={13} />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => {
                setLines([])
                setErrorLines(new Set())
              }}
              disabled={lines.length === 0}
              title={t('terminal.clear')}
              aria-label={t('terminal.clear')}
            >
              <TrashIcon size={13} />
            </button>
          </div>

          <div
            className={styles.console}
            ref={consoleRef}
            aria-live="polite"
            onCopy={consoleCopy.onCopy}
            onContextMenu={consoleCopy.onContextMenu}
          >
            {consoleCopy.menu}
            {lines.length === 0 ? (
              <div className={styles.consoleEmpty}>
                <span className={styles.consoleEmptyIcon}>
                  <PlayIcon size={16} />
                </span>
                <span className={styles.consoleEmptyHint}>{t('terminal.console.empty')}</span>
              </div>
            ) : (
              lines.map(line => {
                const echoText =
                  line.key === 'terminal.log.echo' ? String(line.params?.['line'] ?? '') : null
                const dispatched = line.key === 'terminal.log.dispatched'
                const isError = line.level === 'error'
                const clickable =
                  echoText !== null || dispatched || (isError && line.srcLine !== null)
                return (
                  <div
                    key={line.id}
                    className={cx(
                      styles.line,
                      styles[line.level],
                      echoText !== null && styles.echoLine,
                      dispatched && styles.linkLine,
                      isError && line.srcLine !== null && styles.echoLine
                    )}
                    onClick={
                      clickable
                        ? () => {
                            // A drag-select inside this line also ends in a
                            // click — copying it must not move the caret.
                            if (window.getSelection()?.isCollapsed === false) return
                            if (dispatched) useUIStore.getState().setActiveTab('output')
                            else showInEditor(line, echoText)
                          }
                        : undefined
                    }
                    title={
                      dispatched
                        ? t('terminal.console.goToOutput')
                        : clickable
                          ? t('terminal.console.showInEditor')
                          : undefined
                    }
                  >
                    {echoText !== null ? `> ${echoText}` : t(line.key as never, line.params)}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
