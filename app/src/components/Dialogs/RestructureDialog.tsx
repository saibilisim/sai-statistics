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

/**
 * SPSS Data > Restructure — Variables to Cases (wide→long). Single variable
 * group v1: the picked value columns stack into one long value variable +
 * an index variable recording source-column order. Id columns are kept as
 * plain replicated columns. Multi-group restructuring (SPSS's fuller wizard)
 * is not implemented — talep gelirse eklenir.
 */
export function RestructureDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)

  const [idColIds, setIdColIds] = useState<string[]>([])
  const [valueColIds, setValueColIds] = useState<string[]>([])
  const [indexName, setIndexName] = useState('index')
  const [valueName, setValueName] = useState('value')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosen = new Set([...idColIds, ...valueColIds])
  const available = variables.filter(v => !chosen.has(v.colId))

  const addId = (colId: string) => {
    setIdColIds(prev => [...prev, colId])
  }
  const removeId = (colId: string) => {
    setIdColIds(prev => prev.filter(c => c !== colId))
  }
  const addValue = (colId: string) => {
    setValueColIds(prev => [...prev, colId])
  }
  const removeValue = (colId: string) => {
    setValueColIds(prev => prev.filter(c => c !== colId))
  }

  const canOk =
    valueColIds.length >= 2 && indexName.trim() !== '' && valueName.trim() !== '' && !running

  const handleOk = async () => {
    if (!datasetId) return
    // The result replaces the active dataset — same unsaved-changes
    // prompt as New/Open/Import.
    if (!(await ensureCanReplaceDataset())) return
    setRunning(true)
    setError(null)
    try {
      const result = await window.api.data.restructureWideToLong({
        datasetId,
        idColIds,
        valueColIds,
        indexName: indexName.trim(),
        valueName: valueName.trim()
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
      titleKey="dialog.restructure.title"
      onOk={() => void handleOk()}
      onCancel={onClose}
      okDisabled={!canOk}
    >
      <p className={styles.colLabel}>{t('dialog.restructure.available')}</p>
      <ul className={styles.varList} role="listbox" aria-label={t('dialog.restructure.available')}>
        {available.map(v => (
          <li key={v.colId} role="option" aria-selected={false} className={styles.varItem}>
            <span className={styles.varName}>{v.name}</span>
            <button
              type="button"
              className={styles.addRowBtn}
              onClick={() => {
                addId(v.colId)
              }}
            >
              {t('dialog.restructure.addAsId')}
            </button>
            <button
              type="button"
              className={styles.addRowBtn}
              onClick={() => {
                addValue(v.colId)
              }}
            >
              {t('dialog.restructure.addAsValue')}
            </button>
          </li>
        ))}
        {available.length === 0 && (
          <li className={styles.emptyNote}>{t('dialog.restructure.noneLeft')}</li>
        )}
      </ul>

      <p className={cx(styles.colLabel, 'mt-md')}>{t('dialog.restructure.idVars')}</p>
      <ul className={styles.varList} role="listbox" aria-label={t('dialog.restructure.idVars')}>
        {idColIds.map(colId => {
          const v = variables.find(vv => vv.colId === colId)
          return (
            <li key={colId} className={cx(styles.varItem, styles.itemSelected)}>
              <span className={styles.varName}>{v?.name ?? colId}</span>
              <button
                type="button"
                className={styles.removeRowBtn}
                onClick={() => {
                  removeId(colId)
                }}
                aria-label={t('dialog.recode.removeRow')}
              >
                ×
              </button>
            </li>
          )
        })}
        {idColIds.length === 0 && (
          <li className={styles.emptyNote}>{t('dialog.restructure.noIdVars')}</li>
        )}
      </ul>

      <p className={cx(styles.colLabel, 'mt-md')}>{t('dialog.restructure.valueVars')}</p>
      <ul className={styles.varList} role="listbox" aria-label={t('dialog.restructure.valueVars')}>
        {valueColIds.map((colId, i) => {
          const v = variables.find(vv => vv.colId === colId)
          return (
            <li key={colId} className={cx(styles.varItem, styles.itemSelected)}>
              <span className={styles.orderIndex}>{i + 1}.</span>
              <span className={styles.varName}>{v?.name ?? colId}</span>
              <button
                type="button"
                className={styles.removeRowBtn}
                onClick={() => {
                  removeValue(colId)
                }}
                aria-label={t('dialog.recode.removeRow')}
              >
                ×
              </button>
            </li>
          )
        })}
        {valueColIds.length === 0 && (
          <li className={styles.emptyNote}>{t('dialog.restructure.noValueVars')}</li>
        )}
      </ul>

      <div className={cx(styles.conditionRow, 'mt-md')}>
        <span className={styles.condLabel}>{t('dialog.restructure.indexName')}</span>
        <input
          className={styles.condInput}
          value={indexName}
          onChange={e => {
            setIndexName(e.target.value)
          }}
        />
      </div>
      <div className={styles.conditionRow}>
        <span className={styles.condLabel}>{t('dialog.restructure.valueName')}</span>
        <input
          className={styles.condInput}
          value={valueName}
          onChange={e => {
            setValueName(e.target.value)
          }}
        />
      </div>

      <p className={styles.limitationNote}>{t('dialog.restructure.newDatasetNote')}</p>

      {error && <div className={styles.errorText}>{error}</div>}
    </DialogBase>
  )
}
