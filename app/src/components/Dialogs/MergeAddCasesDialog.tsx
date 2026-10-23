// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from './DialogBase'
import { cx } from '../../lib/cx'
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
 * SPSS Data > Merge Files > Add Cases: stacks a second, user-picked file's
 * rows onto the active dataset (variables matched by name). The second file
 * is loaded through the ordinary file.import() flow (own native dialog) —
 * it becomes a real, but transient, dataset in the main process, dropped
 * once the merge completes (or left as a harmless in-memory orphan if the
 * user cancels this dialog after picking it, cleared on app restart).
 */
export function MergeAddCasesDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)

  const [fileB, setFileB] = useState<{ id: string; name: string; variables: Variable[] } | null>(
    null
  )
  const [browsing, setBrowsing] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matchedCount = fileB
    ? variables.filter(va =>
        fileB.variables.some(vb => vb.name.toLowerCase() === va.name.toLowerCase())
      ).length
    : 0
  const unmatchedA = fileB
    ? variables.filter(
        va => !fileB.variables.some(vb => vb.name.toLowerCase() === va.name.toLowerCase())
      )
    : []
  const unmatchedB = fileB
    ? fileB.variables.filter(
        vb => !variables.some(va => va.name.toLowerCase() === vb.name.toLowerCase())
      )
    : []

  const handleBrowse = async () => {
    setBrowsing(true)
    setError(null)
    try {
      const result = await window.api.file.import()
      if (!result) return
      if (fileB) releaseFileB(fileB.id)
      setFileB({ id: result.dataset.id, name: result.dataset.name, variables: result.variables })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBrowsing(false)
    }
  }

  const handleOk = async () => {
    if (!datasetId || !fileB) return
    // The result replaces the active dataset — same unsaved-changes
    // prompt as New/Open/Import.
    if (!(await ensureCanReplaceDataset())) return
    setRunning(true)
    setError(null)
    try {
      const result = await window.api.data.mergeAddCases({
        datasetIdA: datasetId,
        datasetIdB: fileB.id
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
      titleKey="dialog.mergeAddCases.title"
      onOk={() => void handleOk()}
      onCancel={() => {
        if (fileB) releaseFileB(fileB.id)
        onClose()
      }}
      okDisabled={!fileB || running}
    >
      <div className={styles.conditionRow}>
        <span className={styles.condLabel}>{t('dialog.mergeAddCases.secondFile')}</span>
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

      {fileB && (
        <div className={cx(styles.conditionBox, 'mt-md')}>
          <p className={styles.plainText}>
            {t('dialog.mergeAddCases.matched', { count: matchedCount })}
          </p>
          {unmatchedA.length > 0 && (
            <p className={styles.hintTextFlush}>
              {t('dialog.mergeAddCases.unmatchedA', {
                names: unmatchedA.map(v => v.name).join(', ')
              })}
            </p>
          )}
          {unmatchedB.length > 0 && (
            <p className={styles.hintTextFlush}>
              {t('dialog.mergeAddCases.unmatchedB', {
                names: unmatchedB.map(v => v.name).join(', ')
              })}
            </p>
          )}
        </div>
      )}

      <p className={styles.limitationNote}>{t('dialog.mergeAddCases.newDatasetNote')}</p>

      {error && <div className={styles.errorText}>{error}</div>}
    </DialogBase>
  )
}
