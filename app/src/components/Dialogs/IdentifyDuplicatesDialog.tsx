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

export function IdentifyDuplicatesDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)
  const commitMutation = useDatasetStore(s => s.commitMutation)

  const [matchColIds, setMatchColIds] = useState<string[]>([])
  const [primaryName, setPrimaryName] = useState('PrimaryFirst')
  const [sequenceName, setSequenceName] = useState('MatchSequence')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (colId: string) => {
    setMatchColIds(prev =>
      prev.includes(colId) ? prev.filter(c => c !== colId) : [...prev, colId]
    )
  }

  const canOk =
    matchColIds.length > 0 && primaryName.trim() !== '' && sequenceName.trim() !== '' && !running

  const handleOk = async () => {
    if (!datasetId) return
    setRunning(true)
    setError(null)
    try {
      const result = await window.api.data.identifyDuplicates({
        datasetId,
        matchColIds,
        primaryName: primaryName.trim(),
        sequenceName: sequenceName.trim()
      })
      commitMutation(result.variables)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <DialogBase
      titleKey="dialog.identifyDuplicates.title"
      onOk={() => void handleOk()}
      onCancel={onClose}
      okDisabled={!canOk}
    >
      <div className={styles.selectRoot}>
        <p className={styles.colLabel}>{t('dialog.identifyDuplicates.matchVars')}</p>
        <ul
          className={styles.varList}
          role="listbox"
          aria-label={t('dialog.identifyDuplicates.matchVars')}
        >
          {variables.map(v => (
            <li
              key={v.colId}
              role="option"
              aria-selected={matchColIds.includes(v.colId)}
              className={cx(styles.varItem, matchColIds.includes(v.colId) && styles.itemSelected)}
              onClick={() => {
                toggle(v.colId)
              }}
            >
              <span className={styles.varName}>{v.name}</span>
              {v.label && <span className={styles.varLabel}>{v.label}</span>}
            </li>
          ))}
        </ul>

        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.identifyDuplicates.primaryName')}</span>
          <input
            className={styles.condInput}
            value={primaryName}
            onChange={e => {
              setPrimaryName(e.target.value)
            }}
            aria-label={t('dialog.identifyDuplicates.primaryName')}
          />
        </div>
        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.identifyDuplicates.sequenceName')}</span>
          <input
            className={styles.condInput}
            value={sequenceName}
            onChange={e => {
              setSequenceName(e.target.value)
            }}
            aria-label={t('dialog.identifyDuplicates.sequenceName')}
          />
        </div>
        <p className={styles.limitationNote}>{t('dialog.identifyDuplicates.note')}</p>

        {error && <div className={styles.errorText}>{error}</div>}
      </div>
    </DialogBase>
  )
}
