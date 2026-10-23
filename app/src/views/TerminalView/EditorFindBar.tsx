// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EditorFindBar — find / replace over CodeEditor's text (Edit ▸ Find /
 * Find & Replace while the Terminal tab is open, or Ctrl+F / Ctrl+H in the
 * editor). Presentational: CodeEditor owns the query state and the edits, so
 * replacing goes through its undo-preserving edit path.
 */
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx'
import { ChevronDownIcon, CloseIcon } from './terminal-icons'
import styles from './TerminalView.module.css'

interface EditorFindBarProps {
  showReplace: boolean
  query: string
  replacement: string
  matchCase: boolean
  /** 0-based index of the current match, -1 for none. */
  current: number
  total: number
  /** Bumped by the editor to pull focus back to the find field. */
  focusSeq: number
  onQuery: (q: string) => void
  onReplacement: (r: string) => void
  onMatchCase: (v: boolean) => void
  onToggleReplace: () => void
  onNext: () => void
  onPrev: () => void
  onReplace: () => void
  onReplaceAll: () => void
  onClose: () => void
}

export function EditorFindBar(p: EditorFindBarProps) {
  const { t } = useTranslation(['analysis'])
  const findRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    findRef.current?.focus()
    findRef.current?.select()
  }, [p.focusSeq])

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, onEnter: () => void) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      p.onClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) p.onPrev()
      else onEnter()
    }
  }

  const count =
    p.query === ''
      ? ''
      : p.total === 0
        ? t('terminal.editorFind.noResults')
        : t('terminal.editorFind.count', { current: p.current + 1, total: p.total })

  return (
    <div className={styles.editorFind} role="search">
      <div className={styles.editorFindRow}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={p.onToggleReplace}
          aria-expanded={p.showReplace}
          title={t('terminal.editorFind.toggleReplace')}
          aria-label={t('terminal.editorFind.toggleReplace')}
        >
          <ChevronDownIcon size={12} />
        </button>
        <input
          ref={findRef}
          className={styles.consoleFindInput}
          value={p.query}
          onChange={e => {
            p.onQuery(e.target.value)
          }}
          onKeyDown={e => {
            onKey(e, p.onNext)
          }}
          placeholder={t('terminal.editorFind.find')}
          aria-label={t('terminal.editorFind.find')}
        />
        <span className={styles.consoleFindCount} aria-live="polite">
          {count}
        </span>
        <button
          type="button"
          className={cx(styles.iconBtn, p.matchCase && styles.editorFindToggleOn)}
          onClick={() => {
            p.onMatchCase(!p.matchCase)
          }}
          aria-pressed={p.matchCase}
          title={t('terminal.editorFind.matchCase')}
          aria-label={t('terminal.editorFind.matchCase')}
        >
          {t('terminal.editorFind.matchCaseShort')}
        </button>
        <button
          type="button"
          className={cx(styles.iconBtn, styles.editorFindUp)}
          onClick={p.onPrev}
          disabled={p.total === 0}
          title={t('terminal.editorFind.prev')}
          aria-label={t('terminal.editorFind.prev')}
        >
          <ChevronDownIcon size={12} />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={p.onNext}
          disabled={p.total === 0}
          title={t('terminal.editorFind.next')}
          aria-label={t('terminal.editorFind.next')}
        >
          <ChevronDownIcon size={12} />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={p.onClose}
          title={t('terminal.editorFind.close')}
          aria-label={t('terminal.editorFind.close')}
        >
          <CloseIcon size={12} />
        </button>
      </div>
      {p.showReplace && (
        <div className={styles.editorFindRow}>
          <span className={styles.editorFindIndent} />
          <input
            className={styles.consoleFindInput}
            value={p.replacement}
            onChange={e => {
              p.onReplacement(e.target.value)
            }}
            onKeyDown={e => {
              onKey(e, p.onReplace)
            }}
            placeholder={t('terminal.editorFind.replace')}
            aria-label={t('terminal.editorFind.replace')}
          />
          <button
            type="button"
            className={styles.button}
            onClick={p.onReplace}
            disabled={p.total === 0}
          >
            {t('terminal.editorFind.replaceOne')}
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={p.onReplaceAll}
            disabled={p.total === 0}
          >
            {t('terminal.editorFind.replaceAll')}
          </button>
        </div>
      )}
    </div>
  )
}
