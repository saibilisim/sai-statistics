// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from './DialogBase'
import { useDatasetStore } from '../../store/dataset-store'
import styles from './DataDialogs.module.css'

interface Props {
  onClose: () => void
}

export function ShiftValuesDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const uid = useId()
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)
  const commitMutation = useDatasetStore(s => s.commitMutation)

  const [sourceColId, setSourceColId] = useState<string>(variables[0]?.colId ?? '')
  const [targetName, setTargetName] = useState('')
  const [targetLabel, setTargetLabel] = useState('')
  const [direction, setDirection] = useState<'lag' | 'lead'>('lag')
  const [n, setN] = useState('1')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canOk = !!sourceColId && targetName.trim() !== '' && Number(n) >= 1 && !running

  const handleOk = async () => {
    if (!datasetId) return
    setRunning(true)
    setError(null)
    try {
      const result = await window.api.transform.shiftValues({
        datasetId,
        sourceColId,
        targetName: targetName.trim(),
        targetLabel: targetLabel.trim() || undefined,
        direction,
        n: Math.max(1, Number(n) || 1)
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
      titleKey="dialog.shiftValues.title"
      onOk={() => void handleOk()}
      onCancel={onClose}
      okDisabled={!canOk}
    >
      <div className={styles.selectRoot}>
        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.shiftValues.sourceVar')}</span>
          <select
            className={styles.condSelect}
            value={sourceColId}
            onChange={e => {
              setSourceColId(e.target.value)
            }}
            aria-label={t('dialog.shiftValues.sourceVar')}
          >
            {variables.map(v => (
              <option key={v.colId} value={v.colId}>
                {v.name}
                {v.label ? ` — ${v.label}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.shiftValues.targetName')}</span>
          <input
            className={styles.condInput}
            value={targetName}
            onChange={e => {
              setTargetName(e.target.value)
            }}
            aria-label={t('dialog.shiftValues.targetName')}
          />
        </div>

        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('common.targetLabel')}</span>
          <input
            className={styles.condInput}
            value={targetLabel}
            onChange={e => {
              setTargetLabel(e.target.value)
            }}
            placeholder={t('dialog.recode.optional')}
            aria-label={t('common.targetLabel')}
          />
        </div>

        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.shiftValues.direction')}</span>
          <div className="row-md">
            {(['lag', 'lead'] as const).map(d => (
              <label key={d} className={styles.radioRow}>
                <input
                  type="radio"
                  name={`${uid}-direction`}
                  checked={direction === d}
                  onChange={() => {
                    setDirection(d)
                  }}
                />
                {t(`dialog.shiftValues.direction_${d}`)}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.shiftValues.n')}</span>
          <input
            className={styles.condInput}
            type="number"
            min={1}
            value={n}
            onChange={e => {
              setN(e.target.value)
            }}
            aria-label={t('dialog.shiftValues.n')}
          />
        </div>

        {error && <div className={styles.errorText}>{error}</div>}
      </div>
    </DialogBase>
  )
}
