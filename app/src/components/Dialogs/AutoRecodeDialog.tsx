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

export function AutoRecodeDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const uid = useId()
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)
  const commitMutation = useDatasetStore(s => s.commitMutation)

  const [sourceColId, setSourceColId] = useState<string>(variables[0]?.colId ?? '')
  const [targetName, setTargetName] = useState<string>('')
  const [targetLabel, setTargetLabel] = useState<string>('')
  const [order, setOrder] = useState<'ascending' | 'descending'>('ascending')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canOk = !!sourceColId && targetName.trim() !== '' && !running

  const handleOk = async () => {
    if (!datasetId) return
    setRunning(true)
    setError(null)
    try {
      const result = await window.api.transform.autoRecode({
        datasetId,
        sourceColId,
        targetName: targetName.trim(),
        targetLabel: targetLabel.trim() || undefined,
        order
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
      titleKey="dialog.autoRecode.title"
      onOk={() => void handleOk()}
      onCancel={onClose}
      okDisabled={!canOk}
    >
      <div className={styles.selectRoot}>
        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.autoRecode.sourceVar')}</span>
          <select
            className={styles.condSelect}
            value={sourceColId}
            onChange={e => {
              setSourceColId(e.target.value)
            }}
            aria-label={t('dialog.autoRecode.sourceVar')}
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
          <span className={styles.condLabel}>{t('dialog.autoRecode.targetName')}</span>
          <input
            className={styles.condInput}
            value={targetName}
            onChange={e => {
              setTargetName(e.target.value)
            }}
            placeholder={t('dialog.autoRecode.targetNamePH')}
            aria-label={t('dialog.autoRecode.targetName')}
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
          <span className={styles.condLabel}>{t('dialog.autoRecode.order')}</span>
          <div className="row-md">
            {(['ascending', 'descending'] as const).map(o => (
              <label key={o} className={styles.radioRow}>
                <input
                  type="radio"
                  name={`${uid}-order`}
                  checked={order === o}
                  onChange={() => {
                    setOrder(o)
                  }}
                />
                {t(`dialog.autoRecode.order_${o}`)}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.hintText}>{t('dialog.autoRecode.note')}</div>

        {error && <div className={styles.errorText}>{error}</div>}
      </div>
    </DialogBase>
  )
}
