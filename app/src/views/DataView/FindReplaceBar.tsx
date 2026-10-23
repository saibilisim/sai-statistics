// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FindReplaceBar.tsx — floating Bul/Değiştir panel (aggrid-gecis-roadmap.md
 * G6). Replaces the previous grid's native find/replace dialog (gone with
 * the AG Grid migration) with a small purpose-built panel driven by the
 * pure client-side scan in find-replace.ts.
 *
 * Deliberately minimal (2026-07-24): term + match count + prev/next + ⋯ + close.
 * Every refinement (match case, whole cell, regex, scope, direction, find all)
 * lives in FindReplaceDialog behind the ⋯ button — the Google-Sheets split of
 * "quick bar for typing, dialog for power options", so the bar stays out of
 * the way of the grid it floats over.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './FindReplaceBar.module.css'

interface FindReplaceBarProps {
  showReplace: boolean
  matchCount: number
  currentMatchIndex: number
  onSearch: (term: string) => void
  onNext: () => void
  onPrevious: () => void
  onReplace: (replaceTerm: string) => void
  onReplaceAll: (replaceTerm: string) => void
  /** Opens the full Bul ve Değiştir dialog (the ⋯ button). */
  onOpenDialog: (term: string, replaceTerm: string) => void
  onClose: () => void
}

export function FindReplaceBar({
  showReplace,
  matchCount,
  currentMatchIndex,
  onSearch,
  onNext,
  onPrevious,
  onReplace,
  onReplaceAll,
  onOpenDialog,
  onClose
}: FindReplaceBarProps) {
  const { t } = useTranslation('common')
  const [term, setTerm] = useState('')
  const [replaceTerm, setReplaceTerm] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  return (
    <div className={styles.bar} role="search">
      <input
        ref={searchInputRef}
        type="text"
        className={styles.input}
        placeholder={t('findReplace.searchPlaceholder')}
        value={term}
        onChange={e => {
          setTerm(e.target.value)
          onSearch(e.target.value)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            if (e.shiftKey) onPrevious()
            else onNext()
          } else if (e.key === 'Escape') {
            onClose()
          }
        }}
      />
      <span className={styles.count}>
        {matchCount > 0
          ? t('findReplace.matchCount', { current: currentMatchIndex + 1, total: matchCount })
          : term
            ? t('findReplace.noMatches')
            : ''}
      </span>
      <button
        type="button"
        className={styles.iconButton}
        onClick={onPrevious}
        disabled={matchCount === 0}
      >
        ↑
      </button>
      <button
        type="button"
        className={styles.iconButton}
        onClick={onNext}
        disabled={matchCount === 0}
      >
        ↓
      </button>

      {showReplace && (
        <>
          <input
            type="text"
            className={styles.input}
            placeholder={t('findReplace.replacePlaceholder')}
            value={replaceTerm}
            onChange={e => {
              setReplaceTerm(e.target.value)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') onReplace(replaceTerm)
              else if (e.key === 'Escape') onClose()
            }}
          />
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              onReplace(replaceTerm)
            }}
            disabled={matchCount === 0}
          >
            {t('findReplace.replace')}
          </button>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              onReplaceAll(replaceTerm)
            }}
            disabled={matchCount === 0}
          >
            {t('findReplace.replaceAll')}
          </button>
        </>
      )}

      <button
        type="button"
        className={styles.iconButton}
        onClick={() => {
          onOpenDialog(term, replaceTerm)
        }}
        title={t('findReplace.moreOptions')}
        aria-label={t('findReplace.moreOptions')}
      >
        ⋯
      </button>
      <button
        type="button"
        className={styles.iconButton}
        onClick={onClose}
        aria-label={t('findReplace.close')}
      >
        ✕
      </button>
    </div>
  )
}
