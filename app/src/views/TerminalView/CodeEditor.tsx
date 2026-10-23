// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CodeEditor — the Syntax tab's script editor (SPSS and R): line-number gutter
 * (with error markers), token highlight, autocomplete, selection-aware run.
 * The language is injected: a line tokenizer and an optional completer.
 *
 * Highlight technique: an aria-hidden <pre> (coloured tokens) sits behind a
 * transparent-text <textarea> (real caret + selection). Lines don't wrap, so
 * the gutter's line numbers stay aligned with the text.
 *
 * Programmatic edits (insert, accept a suggestion, auto-indent) go through
 * `document.execCommand('insertText')` so they land on the textarea's native
 * undo stack — Ctrl+Z undoes them like typed text.
 *
 * Find / replace (EditorFindBar) paints its matches on a third layer under the
 * highlight, so they stay visible while focus is in the find field (a
 * textarea shows no selection when unfocused). Replace All is one edit = one
 * undo step. `lineComment` turns on Ctrl+Shift+C / Ctrl+/ comment toggling.
 */
import {
  Fragment,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx'
import { useEditableContextMenu } from '../../lib/use-text-context-menu'
import { EditorFindBar } from './EditorFindBar'
import {
  findMatches,
  nextMatchIndex,
  replaceAll,
  toggleLineComment,
  type TextMatch
} from './editor-text-ops'
import styles from './TerminalView.module.css'

export interface EditorToken {
  text: string
  /** CSS class suffix (`tok_<kind>`); 'plain' renders as bare text. */
  kind: string
}

export interface Suggestion {
  label: string
  /** Text that replaces the typed token. */
  insert: string
  /** Put the caret this many characters before the end of `insert` (e.g. inside `()`). */
  caretBack?: number
  /** Dim secondary text (e.g. a function's arguments). */
  detail?: string
}

export interface Completer {
  /** The token being completed at `caret`. */
  tokenAt: (value: string, caret: number) => { start: number; value: string }
  /** `forced` = the user asked (Tab / Ctrl+Space) rather than just typing. */
  suggest: (
    value: string,
    caret: number,
    token: string,
    forced: boolean
  ) => Suggestion[] | Promise<Suggestion[]>
  /** Open automatically once the token has this many characters; 0 = only on request. */
  autoMinChars: number
  /** Tab (with no list open) requests completion instead of moving focus. */
  tabRequests?: boolean
}

export interface CodeEditorHandle {
  focus: () => void
  /** Replace the current selection (or insert at the caret) with `text`. */
  insertText: (text: string) => void
  /** Insert `text` as its own line(s) after the caret's line. */
  insertLine: (text: string) => void
  /** Select [start, end) and scroll it into view. */
  selectRange: (start: number, end: number) => void
  /** Open the find bar (with the replace row when `replace`). */
  openFind: (replace: boolean) => void
}

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  /** Ctrl+Enter. */
  onRun: () => void
  /** Ctrl+Shift+Enter (falls back to `onRun`). */
  onRunAll?: () => void
  /** F1 on the caret position. */
  onHelp?: (caret: number) => void
  /** Reports the current selection so the toolbar can offer "Run selection". */
  onSelectionChange: (start: number, end: number) => void
  tokenize: (line: string) => EditorToken[]
  completer?: Completer
  /** Enter keeps the line's indentation (+2 after an opening bracket). */
  autoIndent?: boolean
  /** 0-based line indexes whose statement failed on the last run. */
  errorLines?: ReadonlySet<number>
  /** Compact input (R console line): no gutter, suggestions open upwards. */
  compact?: boolean
  /** Extra textarea class (test hooks / per-use styling). */
  textareaClassName?: string
  /**
   * Gets keys the suggestion list did not take (e.g. ↑/↓ history in the
   * console); return true when handled so the editor does nothing more.
   */
  onKeyDownExtra?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean
  /** Line comment marker (`#` for R) — enables Ctrl+Shift+C / Ctrl+/. */
  lineComment?: string
  placeholder: string
  ariaLabel: string
}

interface FindState {
  showReplace: boolean
  query: string
  replacement: string
  matchCase: boolean
  current: number
  focusSeq: number
}

/** The text split into plain runs and <mark>s for the find layer. */
function markedText(value: string, matches: TextMatch[], current: number): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  matches.forEach((m, i) => {
    out.push(value.slice(last, m.start))
    out.push(
      <mark key={m.start} className={i === current ? styles.findCurrent : styles.findMatch}>
        {value.slice(m.start, m.end)}
      </mark>
    )
    last = m.end
  })
  out.push(value.slice(last))
  return out
}

const NO_ERRORS: ReadonlySet<number> = new Set()
const AUTO_DEBOUNCE_MS = 150

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  {
    value,
    onChange,
    onRun,
    onRunAll,
    onHelp,
    onSelectionChange,
    tokenize,
    completer,
    autoIndent = false,
    errorLines = NO_ERRORS,
    compact = false,
    textareaClassName,
    onKeyDownExtra,
    lineComment,
    placeholder,
    ariaLabel
  },
  ref
) {
  const { t } = useTranslation(['analysis'])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const findLayerRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const [find, setFind] = useState<FindState | null>(null)
  const matches = useMemo(
    () => (find ? findMatches(value, find.query, find.matchCase) : []),
    [find, value]
  )
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  // Bumped by Tab / Ctrl+Space to ask for completion explicitly.
  const [forcedAt, setForcedAt] = useState(0)
  const reqSeq = useRef(0)
  const editMenu = useEditableContextMenu()

  const lines = useMemo(() => value.split('\n'), [value])
  const token = useMemo(
    () => completer?.tokenAt(value, caret) ?? { start: caret, value: '' },
    [completer, value, caret]
  )

  // Ask the completer whenever the typed token changes (debounced for the
  // automatic case) or the user forces it. Late answers for an older token
  // are dropped via the sequence number.
  useEffect(() => {
    const seq = ++reqSeq.current
    const forced = forcedAt > 0
    if (!completer || !focused) {
      setSuggestions([])
      return
    }
    if (!forced && token.value.trim().length < Math.max(1, completer.autoMinChars)) {
      setSuggestions([])
      return
    }
    if (!forced && completer.autoMinChars === 0) {
      setSuggestions([])
      return
    }
    const deliver = (items: Suggestion[]) => {
      if (seq !== reqSeq.current) return
      setSuggestions(items)
      setActiveIdx(0)
    }
    const ask = () => {
      const res = completer.suggest(value, caret, token.value, forced)
      if (res instanceof Promise) {
        void res.then(deliver, () => {
          deliver([])
        })
      } else deliver(res)
    }
    if (forced) {
      ask()
      return
    }
    const timer = setTimeout(ask, AUTO_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
    }
    // `value`/`caret` are read only for the request; the token drives re-asking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completer, token.value, token.start, forcedAt, focused])

  // A forced request applies to the token it was made on only.
  useEffect(() => {
    setForcedAt(0)
  }, [token.value])

  const syncCaret = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart)
    onSelectionChange(el.selectionStart, el.selectionEnd)
  }

  /**
   * Replace [start, end) with `text` through the native editing pipeline (so
   * Ctrl+Z works), then place the selection. Falls back to a controlled
   * update if execCommand is unavailable.
   */
  const replaceRange = (start: number, end: number, text: string, selStart?: number) => {
    const el = textareaRef.current
    const caretAfter = selStart ?? start + text.length
    if (el) {
      el.focus()
      el.setSelectionRange(start, end)
      // Deprecated but still the only API that edits a textarea through the
      // browser's own undo stack; the fallback below covers its absence.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const ok = document.execCommand('insertText', false, text)
      if (ok) {
        el.setSelectionRange(caretAfter, caretAfter)
        syncCaret(el)
        return
      }
    }
    onChange(`${value.slice(0, start)}${text}${value.slice(end)}`)
    setCaret(caretAfter)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(caretAfter, caretAfter)
      onSelectionChange(caretAfter, caretAfter)
    })
  }

  // ── Find / replace ──────────────────────────────────────────────────────

  /** Bring the line of `pos` into view, without taking focus. */
  const scrollToPos = (text: string, pos: number) => {
    const el = textareaRef.current
    if (!el) return
    const lineIdx = text.slice(0, pos).split('\n').length - 1
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 0
    const top = lineIdx * lineHeight
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 2 * lineHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 3)
    }
  }

  /** Make match `idx` of `list` (over `text`) current: selected + in view. */
  const showMatch = (text: string, list: TextMatch[], idx: number) => {
    setFind(f => (f ? { ...f, current: idx } : f))
    const m = list[idx]
    const el = textareaRef.current
    if (!m || !el) return
    el.setSelectionRange(m.start, m.end)
    onSelectionChange(m.start, m.end)
    scrollToPos(text, m.start)
  }

  /** New query / case setting: jump to the first match from the caret. */
  const updateQuery = (query: string, matchCase: boolean) => {
    setFind(f => (f ? { ...f, query, matchCase } : f))
    const list = findMatches(value, query, matchCase)
    const from = textareaRef.current?.selectionStart ?? 0
    showMatch(value, list, nextMatchIndex(list, from, false))
  }

  const openFind = (replace: boolean) => {
    const el = textareaRef.current
    const selected = el ? value.slice(el.selectionStart, el.selectionEnd) : ''
    const prefill = selected !== '' && !selected.includes('\n') ? selected : null
    const prev = find
    const query = prefill ?? prev?.query ?? ''
    const matchCase = prev?.matchCase ?? false
    setFind({
      showReplace: replace || (prev?.showReplace ?? false),
      query,
      replacement: prev?.replacement ?? '',
      matchCase,
      current: -1,
      focusSeq: (prev?.focusSeq ?? 0) + 1
    })
    if (query !== '') {
      const list = findMatches(value, query, matchCase)
      showMatch(value, list, nextMatchIndex(list, el?.selectionStart ?? 0, false))
    }
  }

  const findStep = (backwards: boolean) => {
    if (!find) return
    const cur = matches[find.current]
    const from = cur
      ? backwards
        ? cur.start
        : cur.end
      : (textareaRef.current?.selectionStart ?? 0)
    showMatch(value, matches, nextMatchIndex(matches, from, backwards))
  }

  const replaceCurrent = () => {
    if (!find) return
    const m = matches[find.current]
    if (!m) {
      findStep(false)
      return
    }
    const next = `${value.slice(0, m.start)}${find.replacement}${value.slice(m.end)}`
    replaceRange(m.start, m.end, find.replacement)
    const list = findMatches(next, find.query, find.matchCase)
    showMatch(next, list, nextMatchIndex(list, m.start + find.replacement.length, false))
    setFind(f => (f ? { ...f, focusSeq: f.focusSeq + 1 } : f))
  }

  const replaceEvery = () => {
    if (!find || matches.length === 0) return
    const next = replaceAll(value, matches, find.replacement)
    replaceRange(0, value.length, next, 0)
    setFind(f => (f ? { ...f, current: -1, focusSeq: f.focusSeq + 1 } : f))
  }

  const closeFind = () => {
    setFind(null)
    textareaRef.current?.focus()
  }

  /** Ctrl+Shift+C / Ctrl+/: comment or uncomment the selected lines. */
  const toggleComment = (el: HTMLTextAreaElement) => {
    if (!lineComment) return
    const r = toggleLineComment(value, el.selectionStart, el.selectionEnd, lineComment)
    replaceRange(r.from, r.to, r.text)
    el.setSelectionRange(r.selStart, r.selEnd)
    syncCaret(el)
  }

  useImperativeHandle(ref, () => ({
    focus: () => {
      textareaRef.current?.focus()
    },
    openFind,
    insertText: (text: string) => {
      const el = textareaRef.current
      const start = el?.selectionStart ?? value.length
      const end = el?.selectionEnd ?? value.length
      replaceRange(start, end, text)
    },
    insertLine: (text: string) => {
      const el = textareaRef.current
      const pos = el?.selectionEnd ?? value.length
      const lineEnd = value.indexOf('\n', pos)
      const at = lineEnd === -1 ? value.length : lineEnd
      const before = value.slice(0, at)
      const sep = before.trim() === '' ? '' : '\n'
      replaceRange(at, at, `${sep}${text}`)
      // Select the inserted line(s) so the user sees what arrived.
      requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (!ta) return
        const start = before.length + sep.length
        ta.setSelectionRange(start, start + text.length)
        onSelectionChange(start, start + text.length)
      })
    },
    selectRange: (start: number, end: number) => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(start, end)
      setCaret(end)
      onSelectionChange(start, end)
      // Scroll so the selection's first line is visible (lines don't wrap).
      const lineIdx = value.slice(0, start).split('\n').length - 1
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 0
      el.scrollTop = Math.max(0, lineIdx * lineHeight - el.clientHeight / 3)
    }
  }))

  const acceptSuggestion = (s: Suggestion) => {
    const caretAfter = token.start + s.insert.length - (s.caretBack ?? 0)
    setSuggestions([])
    replaceRange(token.start, caret, s.insert, caretAfter)
  }

  const visible = focused ? suggestions : []

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (visible.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(i => (i + 1) % visible.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(i => (i - 1 + visible.length) % visible.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault()
        const chosen = visible[activeIdx] ?? visible[0]
        if (chosen) acceptSuggestion(chosen)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        reqSeq.current++
        setSuggestions([])
        return
      }
    }
    if (onKeyDownExtra?.(e)) return
    const mod = e.ctrlKey || e.metaKey
    // The Edit menu's accelerators usually take Ctrl+F / Ctrl+H first (the
    // Terminal answers those menu commands); these cover the other paths.
    if (mod && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'h')) {
      e.preventDefault()
      openFind(e.key === 'h')
      return
    }
    if (find && e.key === 'Escape') {
      e.preventDefault()
      closeFind()
      return
    }
    if (find && e.key === 'F3') {
      e.preventDefault()
      findStep(e.shiftKey)
      return
    }
    if (lineComment && mod && ((e.shiftKey && e.key.toLowerCase() === 'c') || e.key === '/')) {
      e.preventDefault()
      toggleComment(e.currentTarget)
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey && onRunAll) onRunAll()
      else onRun()
      return
    }
    if (completer && e.ctrlKey && e.key === ' ') {
      e.preventDefault()
      setForcedAt(Date.now())
      return
    }
    if (
      completer?.tabRequests &&
      e.key === 'Tab' &&
      !e.shiftKey &&
      token.value !== '' &&
      e.currentTarget.selectionStart === e.currentTarget.selectionEnd
    ) {
      e.preventDefault()
      setForcedAt(Date.now())
      return
    }
    if (e.key === 'F1' && onHelp) {
      e.preventDefault()
      onHelp(e.currentTarget.selectionStart)
      return
    }
    if (autoIndent && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const el = e.currentTarget
      const start = el.selectionStart
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      const before = value.slice(lineStart, start)
      const indent = /^[ \t]*/.exec(before)?.[0] ?? ''
      const extra = /[{([]\s*$/.test(before) ? '  ' : ''
      e.preventDefault()
      replaceRange(start, el.selectionEnd, `\n${indent}${extra}`)
    }
  }

  return (
    <div className={cx(styles.editorSurface, compact && styles.editorSurfaceCompact)}>
      {!compact && (
        <div className={styles.gutter} ref={gutterRef} aria-hidden="true">
          {lines.map((_, i) => (
            <div
              key={i}
              className={cx(styles.gutterNum, errorLines.has(i) && styles.gutterError)}
              title={errorLines.has(i) ? t('terminal.console.errorMarker') : undefined}
            >
              {i + 1}
            </div>
          ))}
        </div>
      )}
      <div className={styles.editorText}>
        {find && find.query !== '' && (
          <pre
            className={cx(styles.editorHighlight, styles.findLayer)}
            ref={el => {
              findLayerRef.current = el
              const ta = textareaRef.current
              if (el && ta) {
                el.scrollTop = ta.scrollTop
                el.scrollLeft = ta.scrollLeft
              }
            }}
            aria-hidden="true"
          >
            {markedText(value, matches, find.current)}
          </pre>
        )}
        <pre className={styles.editorHighlight} ref={highlightRef} aria-hidden="true">
          {lines.map((line, i) => (
            <Fragment key={i}>
              {tokenize(line).map((tok, j) =>
                tok.kind === 'plain' ? (
                  tok.text
                ) : (
                  <span key={j} className={styles[`tok_${tok.kind}`]}>
                    {tok.text}
                  </span>
                )
              )}
              {i < lines.length - 1 ? '\n' : null}
            </Fragment>
          ))}
        </pre>
        <textarea
          ref={textareaRef}
          className={cx(styles.editor, textareaClassName)}
          value={value}
          wrap="off"
          onChange={e => {
            onChange(e.target.value)
            syncCaret(e.target)
          }}
          onClick={e => {
            syncCaret(e.currentTarget)
          }}
          onKeyUp={e => {
            syncCaret(e.currentTarget)
          }}
          onSelect={e => {
            syncCaret(e.currentTarget)
          }}
          onFocus={() => {
            setFocused(true)
          }}
          onBlur={() => {
            setFocused(false)
          }}
          onScroll={e => {
            const { scrollTop, scrollLeft } = e.currentTarget
            for (const layer of [highlightRef.current, findLayerRef.current]) {
              if (!layer) continue
              layer.scrollTop = scrollTop
              layer.scrollLeft = scrollLeft
            }
            if (gutterRef.current) gutterRef.current.scrollTop = scrollTop
          }}
          onKeyDown={onKeyDown}
          onContextMenu={editMenu.onContextMenu}
          spellCheck={false}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-autocomplete={completer ? 'list' : undefined}
        />
      </div>
      {visible.length > 0 && (
        <div className={styles.suggestBox} role="listbox">
          {visible.map((s, i) => (
            <button
              key={`${s.label}-${String(i)}`}
              type="button"
              role="option"
              aria-selected={i === activeIdx}
              className={cx(styles.suggestItem, i === activeIdx && styles.suggestItemActive)}
              onMouseDown={e => {
                e.preventDefault()
                acceptSuggestion(s)
              }}
              onMouseEnter={() => {
                setActiveIdx(i)
              }}
            >
              {s.label}
              {s.detail && <span className={styles.suggestDetail}>{s.detail}</span>}
            </button>
          ))}
        </div>
      )}
      {find && (
        <EditorFindBar
          showReplace={find.showReplace}
          query={find.query}
          replacement={find.replacement}
          matchCase={find.matchCase}
          current={find.current}
          total={matches.length}
          focusSeq={find.focusSeq}
          onQuery={q => {
            updateQuery(q, find.matchCase)
          }}
          onReplacement={r => {
            setFind(f => (f ? { ...f, replacement: r } : f))
          }}
          onMatchCase={v => {
            updateQuery(find.query, v)
          }}
          onToggleReplace={() => {
            setFind(f => (f ? { ...f, showReplace: !f.showReplace } : f))
          }}
          onNext={() => {
            findStep(false)
          }}
          onPrev={() => {
            findStep(true)
          }}
          onReplace={replaceCurrent}
          onReplaceAll={replaceEvery}
          onClose={closeFind}
        />
      )}
      {editMenu.menu}
    </div>
  )
})
