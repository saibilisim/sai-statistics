// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FindReplaceDialog.tsx — the full "Bul ve Değiştir" dialog, opened from the
 * ⋯ button on FindReplaceBar (the Google-Sheets model: a quick inline bar for
 * typing, a full dialog for the power options).
 *
 * Deliberately NOT built on DialogBase: that shell is an OK/Cancel form, while
 * a find dialog needs a row of peer actions (Find All / Previous / Next /
 * Replace / Replace All) and must stay open across them. Layout follows
 * LibreOffice Calc's Find & Replace, which is the most complete of the ones
 * users compared it against.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx'
import type { SearchOptions } from './find-replace'
import styles from './FindReplaceDialog.module.css'

export interface FindReplaceDialogProps {
  /** Search term shared with the inline bar, so opening the dialog keeps it. */
  term: string
  replaceTerm: string
  options: SearchOptions
  matchCount: number
  currentMatchIndex: number
  /** False when there's no multi-cell selection to scope to. */
  canScopeToSelection: boolean
  onTermChange: (term: string) => void
  onReplaceTermChange: (term: string) => void
  onOptionsChange: (options: SearchOptions) => void
  onFindAll: () => void
  onNext: () => void
  onPrevious: () => void
  onReplace: () => void
  onReplaceAll: () => void
  onClose: () => void
}

export function FindReplaceDialog({
  term,
  replaceTerm,
  options,
  matchCount,
  currentMatchIndex,
  canScopeToSelection,
  onTermChange,
  onReplaceTermChange,
  onOptionsChange,
  onFindAll,
  onNext,
  onPrevious,
  onReplace,
  onReplaceAll,
  onClose
}: FindReplaceDialogProps) {
  const { t } = useTranslation('common')
  const findInputRef = useRef<HTMLInputElement>(null)
  const [scopeToSelection, setScopeToSelection] = useState(!!options.scope)

  useEffect(() => {
    findInputRef.current?.focus()
    findInputRef.current?.select()
  }, [])

  const setOption = (
    key: 'regex' | 'caseSensitive' | 'wholeCell' | 'emptyCells',
    value: boolean
  ) => {
    onOptionsChange({ ...options, [key]: value })
  }

  const checkbox = (
    key: 'regex' | 'caseSensitive' | 'wholeCell' | 'emptyCells',
    labelKey: string
  ) => (
    <label className={styles.checkLabel}>
      <input
        type="checkbox"
        checked={!!options[key]}
        onChange={e => {
          setOption(key, e.target.checked)
        }}
      />
      {t(labelKey as 'findReplace.matchCase')}
    </label>
  )

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('findReplace.dialogTitle')}
        onMouseDown={e => {
          e.stopPropagation()
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose()
        }}
      >
        <div className={styles.header}>
          <span className={styles.title}>{t('findReplace.dialogTitle')}</span>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t('findReplace.close')}
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('findReplace.findWhat')}</span>
            <input
              ref={findInputRef}
              type="text"
              className={styles.input}
              value={term}
              disabled={!!options.emptyCells}
              placeholder={options.emptyCells ? t('findReplace.termIgnored') : undefined}
              onChange={e => {
                onTermChange(e.target.value)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (e.shiftKey) onPrevious()
                  else onNext()
                }
              }}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('findReplace.replaceWith')}</span>
            <input
              type="text"
              className={styles.input}
              value={replaceTerm}
              onChange={e => {
                onReplaceTermChange(e.target.value)
              }}
            />
          </label>

          <div className={styles.status} role="status">
            {term === '' && !options.emptyCells
              ? ''
              : matchCount > 0
                ? t('findReplace.matchCount', {
                    current: currentMatchIndex + 1,
                    total: matchCount
                  })
                : t('findReplace.noMatches')}
          </div>

          <fieldset className={styles.options}>
            <legend className={styles.legend}>{t('findReplace.options')}</legend>
            {checkbox('caseSensitive', 'findReplace.matchCase')}
            {checkbox('wholeCell', 'findReplace.wholeCell')}
            {checkbox('regex', 'findReplace.useRegex')}
            {checkbox('emptyCells', 'findReplace.findEmptyCells')}
            <label className={cx(styles.checkLabel, !canScopeToSelection && styles.disabledLabel)}>
              <input
                type="checkbox"
                checked={scopeToSelection}
                disabled={!canScopeToSelection}
                onChange={e => {
                  setScopeToSelection(e.target.checked)
                  // The actual rectangle is resolved by DataView (it owns the
                  // selection); `true` just requests "scope to selection".
                  onOptionsChange({ ...options, scope: e.target.checked ? undefined : null })
                }}
              />
              {t('findReplace.currentSelectionOnly')}
            </label>
          </fieldset>

          <div className={styles.directionRow}>
            <span className={styles.fieldLabel}>{t('findReplace.direction')}</span>
            <label className={styles.checkLabel}>
              <input
                type="radio"
                name="fr-direction"
                checked={(options.direction ?? 'rows') === 'rows'}
                onChange={() => {
                  onOptionsChange({ ...options, direction: 'rows' })
                }}
              />
              {t('findReplace.directionRows')}
            </label>
            <label className={styles.checkLabel}>
              <input
                type="radio"
                name="fr-direction"
                checked={options.direction === 'columns'}
                onChange={() => {
                  onOptionsChange({ ...options, direction: 'columns' })
                }}
              />
              {t('findReplace.directionColumns')}
            </label>
          </div>
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.btn}
            onClick={onFindAll}
            disabled={matchCount === 0}
          >
            {t('findReplace.findAll')}
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={onPrevious}
            disabled={matchCount === 0}
          >
            {t('findReplace.previous')}
          </button>
          <button
            type="button"
            className={cx(styles.btn, styles.primary)}
            onClick={onNext}
            disabled={matchCount === 0}
          >
            {t('findReplace.next')}
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={onReplace}
            disabled={matchCount === 0}
          >
            {t('findReplace.replace')}
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={onReplaceAll}
            disabled={matchCount === 0}
          >
            {t('findReplace.replaceAll')}
          </button>
          <button type="button" className={styles.btn} onClick={onClose}>
            {t('findReplace.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
