// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from './DialogBase'
import { useDatasetStore } from '../../store/dataset-store'
import { cx } from '../../lib/cx'
import styles from './DataDialogs.module.css'

interface Props {
  onClose: () => void
}

interface SortKey {
  colId: string
  direction: 'asc' | 'desc'
}

export function SortCasesDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)
  const bumpDataVersion = useDatasetStore(s => s.bumpDataVersion)
  const setModified = useDatasetStore(s => s.setModified)
  const setColumnSort = useDatasetStore(s => s.setColumnSort)

  const [keys, setKeys] = useState<SortKey[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const availableVars = variables.filter(v => !keys.some(k => k.colId === v.colId))

  const addKey = (colId: string) => {
    setKeys(prev => [...prev, { colId, direction: 'asc' }])
  }
  const removeKey = (colId: string) => {
    setKeys(prev => prev.filter(k => k.colId !== colId))
  }
  const toggleDirection = (colId: string) => {
    setKeys(prev =>
      prev.map(k =>
        k.colId === colId ? { ...k, direction: k.direction === 'asc' ? 'desc' : 'asc' } : k
      )
    )
  }

  const canOk = keys.length > 0 && !running

  const handleOk = async () => {
    if (!datasetId) return
    setRunning(true)
    setError(null)
    try {
      await window.api.data.sortMulti({ datasetId, keys })
      // Clear any leftover cosmetic column-sort state (see ColumnFilterPopup's
      // handleSort) — the grid must reflect DuckDB's real row order, not a
      // second, possibly-inconsistent in-memory re-sort on top of it.
      setColumnSort('', null)
      bumpDataVersion()
      setModified(true)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <DialogBase
      titleKey="dialog.sortCases.title"
      onOk={() => void handleOk()}
      onCancel={onClose}
      okDisabled={!canOk}
    >
      <div className={styles.pickerLayout}>
        <div className={styles.pickerLeft}>
          <p className={styles.colLabel}>{t('dialog.sortCases.available')}</p>
          <ul
            className={styles.varList}
            role="listbox"
            aria-label={t('dialog.sortCases.available')}
          >
            {availableVars.map(v => (
              <li
                key={v.colId}
                role="option"
                aria-selected={false}
                className={styles.varItem}
                onClick={() => {
                  addKey(v.colId)
                }}
              >
                <span className={styles.varName}>{v.name}</span>
                {v.label && <span className={styles.varLabel}>{v.label}</span>}
              </li>
            ))}
            {availableVars.length === 0 && (
              <li className={styles.emptyNote}>{t('dialog.sortCases.noneLeft')}</li>
            )}
          </ul>
        </div>

        <div className={styles.pickerArrow} aria-hidden="true">
          →
        </div>

        <div className={styles.pickerRight}>
          <p className={styles.colLabel}>{t('dialog.sortCases.sortBy')}</p>
          <ul className={styles.varList} role="listbox" aria-label={t('dialog.sortCases.sortBy')}>
            {keys.map(k => {
              const v = variables.find(vv => vv.colId === k.colId)
              return (
                <li key={k.colId} className={cx(styles.varItem, styles.itemSelected)}>
                  <span className={styles.varName}>{v?.name ?? k.colId}</span>
                  <button
                    type="button"
                    className={styles.addRowBtn}
                    onClick={e => {
                      e.stopPropagation()
                      toggleDirection(k.colId)
                    }}
                  >
                    {k.direction === 'asc'
                      ? t('dialog.sortCases.ascending')
                      : t('dialog.sortCases.descending')}
                  </button>
                  <button
                    type="button"
                    className={styles.removeRowBtn}
                    onClick={e => {
                      e.stopPropagation()
                      removeKey(k.colId)
                    }}
                    aria-label={t('dialog.recode.removeRow')}
                  >
                    ×
                  </button>
                </li>
              )
            })}
            {keys.length === 0 && (
              <li className={styles.emptyNote}>{t('dialog.sortCases.noKeys')}</li>
            )}
          </ul>
        </div>
      </div>

      {error && <div className={styles.errorText}>{error}</div>}
    </DialogBase>
  )
}
