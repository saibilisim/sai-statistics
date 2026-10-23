// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SPSS's small "value entry + Add/Change/Remove + listbox" control, as used by
 * the Frequencies Statistics dialog's "Percentile(s):" list. Kept generic
 * (numbers in, numbers out) so the other dialogs that need the same shape
 * (e.g. a user-defined cut-point list) can reuse it instead of re-inventing it.
 */

import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import styles from './ValueListEditor.module.css'

export function ValueListEditor({
  label,
  values,
  onChange,
  disabled = false,
  min,
  max
}: {
  label: string
  values: number[]
  onChange: (v: number[]) => void
  disabled?: boolean
  min?: number
  max?: number
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const inputId = useId()

  const parsed = (): number | null => {
    const n = Number(draft.trim())
    if (draft.trim() === '' || !Number.isFinite(n)) return null
    if (min !== undefined && n <= min) return null
    if (max !== undefined && n >= max) return null
    return n
  }

  const commit = (next: number[]) => {
    onChange([...new Set(next)].sort((a, b) => a - b))
  }

  const handleAdd = () => {
    const n = parsed()
    if (n === null) return
    commit([...values, n])
    setDraft('')
    setSelected(null)
  }

  const handleChangeSelected = () => {
    const n = parsed()
    if (n === null || selected === null) return
    commit(values.map((v, i) => (i === selected ? n : v)))
    setDraft('')
    setSelected(null)
  }

  const handleRemove = () => {
    if (selected === null) return
    commit(values.filter((_, i) => i !== selected))
    setSelected(null)
  }

  return (
    <div className={styles.editor}>
      <div className={styles.left}>
        <div className={styles.inputRow}>
          <label htmlFor={inputId} className={shellStyles.checkRow}>
            {label}
          </label>
          <input
            id={inputId}
            type="number"
            className="numField--sm"
            value={draft}
            disabled={disabled}
            min={min}
            max={max}
            onChange={e => {
              setDraft(e.target.value)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
          />
        </div>
        <div className={styles.list} role="listbox" aria-label={label}>
          {values.length === 0 ? (
            <div className={styles.empty}>{t('analysis:common.valueList.empty')}</div>
          ) : (
            values.map((v, i) => (
              <button
                key={v}
                type="button"
                role="option"
                aria-selected={selected === i}
                className={cx(styles.item, selected === i && styles.selected)}
                disabled={disabled}
                onClick={() => {
                  setSelected(i)
                  setDraft(String(v))
                }}
              >
                {v}
              </button>
            ))
          )}
        </div>
      </div>
      <div className={styles.buttons}>
        <button
          type="button"
          className={shellStyles.btn}
          disabled={disabled || parsed() === null}
          onClick={handleAdd}
        >
          {t('analysis:common.valueList.add')}
        </button>
        <button
          type="button"
          className={shellStyles.btn}
          disabled={disabled || selected === null || parsed() === null}
          onClick={handleChangeSelected}
        >
          {t('analysis:common.valueList.change')}
        </button>
        <button
          type="button"
          className={shellStyles.btn}
          disabled={disabled || selected === null}
          onClick={handleRemove}
        >
          {t('analysis:common.valueList.remove')}
        </button>
      </div>
    </div>
  )
}
