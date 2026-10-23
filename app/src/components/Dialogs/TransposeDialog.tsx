// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from './DialogBase'
import { useDatasetStore } from '../../store/dataset-store'
import styles from './DataDialogs.module.css'
import { ensureCanReplaceDataset } from '../../lib/file-actions'

interface Props {
  onClose: () => void
}

export function TransposeDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)

  const [nameColId, setNameColId] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleOk = async () => {
    if (!datasetId) return
    // The result replaces the active dataset — same unsaved-changes
    // prompt as New/Open/Import.
    if (!(await ensureCanReplaceDataset())) return
    setRunning(true)
    setError(null)
    try {
      const result = await window.api.data.transpose({
        datasetId,
        nameColId: nameColId || null
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
      titleKey="dialog.transpose.title"
      onOk={() => void handleOk()}
      onCancel={onClose}
      okDisabled={running}
    >
      <div className={styles.conditionRow}>
        <span className={styles.condLabel}>{t('dialog.transpose.nameVar')}</span>
        <select
          className={styles.condSelect}
          value={nameColId}
          onChange={e => {
            setNameColId(e.target.value)
          }}
          aria-label={t('dialog.transpose.nameVar')}
        >
          <option value="">{t('dialog.transpose.nameVarNone')}</option>
          {variables.map(v => (
            <option key={v.colId} value={v.colId}>
              {v.name}
              {v.label ? ` — ${v.label}` : ''}
            </option>
          ))}
        </select>
      </div>

      <p className={styles.limitationNote}>{t('dialog.transpose.newDatasetNote')}</p>

      {error && <div className={styles.errorText}>{error}</div>}
    </DialogBase>
  )
}
