// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from './DialogBase'
import { useDatasetStore } from '../../store/dataset-store'
import { cx } from '../../lib/cx'
import styles from './DataDialogs.module.css'
import { ensureCanReplaceDataset } from '../../lib/file-actions'

interface Props {
  onClose: () => void
}

type AggregateFunction = 'mean' | 'sum' | 'n' | 'sd' | 'min' | 'max' | 'median' | 'first' | 'last'

interface SummaryRow {
  colId: string
  fn: AggregateFunction
  targetName: string
}

const FUNCTIONS: AggregateFunction[] = [
  'mean',
  'sum',
  'n',
  'sd',
  'min',
  'max',
  'median',
  'first',
  'last'
]

export function AggregateDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)

  const [breakColIds, setBreakColIds] = useState<string[]>([])
  const [summaries, setSummaries] = useState<SummaryRow[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const numericVars = variables.filter(v => v.type === 'numeric' && !breakColIds.includes(v.colId))
  const availableBreakVars = variables.filter(v => !breakColIds.includes(v.colId))

  const addBreak = (colId: string) => {
    setBreakColIds(prev => [...prev, colId])
    // A variable can't be both a break variable and a summary source.
    setSummaries(prev => prev.filter(s => s.colId !== colId))
  }
  const removeBreak = (colId: string) => {
    setBreakColIds(prev => prev.filter(c => c !== colId))
  }

  const addSummaryRow = () => {
    const firstVar = numericVars[0]
    if (!firstVar) return
    const fn: AggregateFunction = 'mean'
    setSummaries(prev => [
      ...prev,
      { colId: firstVar.colId, fn, targetName: `${firstVar.name}_${fn}` }
    ])
  }
  const removeSummaryRow = (i: number) => {
    setSummaries(prev => prev.filter((_, j) => j !== i))
  }
  const updateSummaryRow = (i: number, patch: Partial<SummaryRow>) => {
    setSummaries(prev =>
      prev.map((s, j) => {
        if (j !== i) return s
        const next = { ...s, ...patch }
        // Re-derive the target name only when the user hasn't customized it
        // away from the previous auto-generated value.
        const prevAuto = `${variables.find(v => v.colId === s.colId)?.name ?? s.colId}_${s.fn}`
        if (s.targetName === prevAuto) {
          const srcName = variables.find(v => v.colId === next.colId)?.name ?? next.colId
          next.targetName = `${srcName}_${next.fn}`
        }
        return next
      })
    )
  }

  const canOk = summaries.length > 0 && summaries.every(s => s.targetName.trim() !== '') && !running

  const handleOk = async () => {
    if (!datasetId) return
    // The result replaces the active dataset — same unsaved-changes
    // prompt as New/Open/Import.
    if (!(await ensureCanReplaceDataset())) return
    setRunning(true)
    setError(null)
    try {
      const result = await window.api.data.aggregate({
        datasetId,
        breakColIds,
        aggregates: summaries.map(s => ({
          colId: s.colId,
          fn: s.fn,
          targetName: s.targetName.trim()
        }))
      })
      useDatasetStore
        .getState()
        .setDataset(
          result.dataset.id,
          result.dataset.name,
          result.dataset.filePath,
          result.variables,
          result.dataset.rowCount,
          null
        )
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <DialogBase
      titleKey="dialog.aggregate.title"
      onOk={() => void handleOk()}
      onCancel={onClose}
      okDisabled={!canOk}
    >
      <p className={styles.colLabel}>{t('dialog.aggregate.breakVars')}</p>
      <div className={styles.pickerLayout}>
        <div className={styles.pickerLeft}>
          <ul
            className={styles.varList}
            role="listbox"
            aria-label={t('dialog.aggregate.breakVars')}
          >
            {availableBreakVars.map(v => (
              <li
                key={v.colId}
                role="option"
                aria-selected={false}
                className={styles.varItem}
                onClick={() => {
                  addBreak(v.colId)
                }}
              >
                <span className={styles.varName}>{v.name}</span>
                {v.label && <span className={styles.varLabel}>{v.label}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.pickerArrow} aria-hidden="true">
          →
        </div>
        <div className={styles.pickerRight}>
          <ul
            className={styles.varList}
            role="listbox"
            aria-label={t('dialog.aggregate.breakVars')}
          >
            {breakColIds.map(colId => {
              const v = variables.find(vv => vv.colId === colId)
              return (
                <li key={colId} className={cx(styles.varItem, styles.itemSelected)}>
                  <span className={styles.varName}>{v?.name ?? colId}</span>
                  <button
                    type="button"
                    className={styles.removeRowBtn}
                    onClick={e => {
                      e.stopPropagation()
                      removeBreak(colId)
                    }}
                    aria-label={t('dialog.recode.removeRow')}
                  >
                    ×
                  </button>
                </li>
              )
            })}
            {breakColIds.length === 0 && (
              <li className={styles.emptyNote}>{t('dialog.aggregate.noBreakVars')}</li>
            )}
          </ul>
        </div>
      </div>

      <div className={cx(styles.conditionBox, 'mt-md')}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>{t('dialog.aggregate.summaryVars')}</span>
          <button
            className={styles.addRowBtn}
            onClick={addSummaryRow}
            disabled={numericVars.length === 0}
          >
            + {t('dialog.recode.addRow')}
          </button>
        </div>
        <div className={styles.aggHeader}>
          <span>{t('dialog.aggregate.variable')}</span>
          <span>{t('dialog.aggregate.function')}</span>
          <span>{t('dialog.aggregate.targetName')}</span>
          <span />
        </div>
        {summaries.map((s, i) => (
          <div key={i} className={styles.aggRow}>
            <select
              className={styles.mappingInput}
              value={s.colId}
              onChange={e => {
                updateSummaryRow(i, { colId: e.target.value })
              }}
              aria-label={`${t('dialog.aggregate.variable')} ${String(i + 1)}`}
            >
              {variables
                .filter(v => v.type === 'numeric' && !breakColIds.includes(v.colId))
                .map(v => (
                  <option key={v.colId} value={v.colId}>
                    {v.name}
                  </option>
                ))}
            </select>
            <select
              className={styles.mappingInput}
              value={s.fn}
              onChange={e => {
                updateSummaryRow(i, { fn: e.target.value as AggregateFunction })
              }}
              aria-label={`${t('dialog.aggregate.function')} ${String(i + 1)}`}
            >
              {FUNCTIONS.map(fn => (
                <option key={fn} value={fn}>
                  {t(`dialog.aggregate.fn_${fn}`)}
                </option>
              ))}
            </select>
            <input
              className={styles.mappingInput}
              value={s.targetName}
              onChange={e => {
                updateSummaryRow(i, { targetName: e.target.value })
              }}
              aria-label={`${t('dialog.aggregate.targetName')} ${String(i + 1)}`}
            />
            <button
              className={styles.removeRowBtn}
              onClick={() => {
                removeSummaryRow(i)
              }}
              aria-label={t('dialog.recode.removeRow')}
            >
              ×
            </button>
          </div>
        ))}
        {summaries.length === 0 && (
          <p className={styles.emptyNote}>{t('dialog.aggregate.noSummaryVars')}</p>
        )}
      </div>

      <p className={styles.limitationNote}>{t('dialog.aggregate.newDatasetNote')}</p>

      {error && <div className={styles.errorText}>{error}</div>}
    </DialogBase>
  )
}
