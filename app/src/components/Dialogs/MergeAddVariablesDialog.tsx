// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from './DialogBase'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import styles from './DataDialogs.module.css'
import { ensureCanReplaceDataset } from '../../lib/file-actions'

/** The second file exists only to feed the merge (the merge handler drops
 *  it itself) — one that's replaced or cancelled must be freed here. */
function releaseFileB(datasetId: string): void {
  window.api.data.releaseDataset({ datasetId }).catch((err: unknown) => {
    console.error('releaseDataset failed:', err)
  })
}

interface Props {
  onClose: () => void
}

/**
 * SPSS Data > Merge Files > Add Variables: LEFT JOINs a second, user-picked
 * file onto the active dataset by a key variable (every case in the active
 * dataset is kept; unmatched rows get NULLs for B's columns). Same transient
 * second-dataset loading approach as MergeAddCasesDialog.
 */
export function MergeAddVariablesDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)

  const [fileB, setFileB] = useState<{ id: string; name: string; variables: Variable[] } | null>(
    null
  )
  const [keyColIdA, setKeyColIdA] = useState<string>(() => variables[0]?.colId ?? '')
  const [keyColIdB, setKeyColIdB] = useState<string>('')
  const [browsing, setBrowsing] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleBrowse = async () => {
    setBrowsing(true)
    setError(null)
    try {
      const result = await window.api.file.import()
      if (!result) return
      if (fileB) releaseFileB(fileB.id)
      setFileB({ id: result.dataset.id, name: result.dataset.name, variables: result.variables })
      setKeyColIdB(result.variables[0]?.colId ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBrowsing(false)
    }
  }

  const handleOk = async () => {
    if (!datasetId || !fileB || !keyColIdA || !keyColIdB) return
    // The result replaces the active dataset — same unsaved-changes
    // prompt as New/Open/Import.
    if (!(await ensureCanReplaceDataset())) return
    setRunning(true)
    setError(null)
    try {
      const result = await window.api.data.mergeAddVariables({
        datasetIdA: datasetId,
        datasetIdB: fileB.id,
        keyColIdA,
        keyColIdB
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
      titleKey="dialog.mergeAddVariables.title"
      onOk={() => void handleOk()}
      onCancel={() => {
        if (fileB) releaseFileB(fileB.id)
        onClose()
      }}
      okDisabled={!fileB || !keyColIdA || !keyColIdB || running}
    >
      <div className={styles.conditionRow}>
        <span className={styles.condLabel}>{t('dialog.mergeAddVariables.secondFile')}</span>
        <div className={styles.fileRow}>
          <span className="flex-1">
            {fileB ? fileB.name : t('dialog.mergeAddCases.noFileChosen')}
          </span>
          <button
            type="button"
            className={styles.addRowBtn}
            onClick={() => void handleBrowse()}
            disabled={browsing}
          >
            {t('dialog.mergeAddCases.browse')}
          </button>
        </div>
      </div>

      <div className={styles.conditionRow}>
        <span className={styles.condLabel}>{t('dialog.mergeAddVariables.keyA')}</span>
        <select
          className={styles.condSelect}
          value={keyColIdA}
          onChange={e => {
            setKeyColIdA(e.target.value)
          }}
          aria-label={t('dialog.mergeAddVariables.keyA')}
        >
          {variables.map(v => (
            <option key={v.colId} value={v.colId}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

      {fileB && (
        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.mergeAddVariables.keyB')}</span>
          <select
            className={styles.condSelect}
            value={keyColIdB}
            onChange={e => {
              setKeyColIdB(e.target.value)
            }}
            aria-label={t('dialog.mergeAddVariables.keyB')}
          >
            {fileB.variables.map(v => (
              <option key={v.colId} value={v.colId}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className={styles.limitationNote}>{t('dialog.mergeAddVariables.newDatasetNote')}</p>

      {error && <div className={styles.errorText}>{error}</div>}
    </DialogBase>
  )
}
