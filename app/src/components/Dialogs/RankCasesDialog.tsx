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

export function RankCasesDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const uid = useId()
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)
  const commitMutation = useDatasetStore(s => s.commitMutation)

  const numericVars = variables.filter(v => v.type === 'numeric')
  const [sourceColId, setSourceColId] = useState<string>(
    numericVars[0]?.colId ?? variables[0]?.colId ?? ''
  )
  const [targetName, setTargetName] = useState<string>('')
  const [targetLabel, setTargetLabel] = useState<string>('')
  const [order, setOrder] = useState<'ascending' | 'descending'>('ascending')
  const [method, setMethod] = useState<'rank' | 'dense_rank' | 'percent_rank'>('rank')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canOk = !!sourceColId && targetName.trim() !== '' && !running

  const handleOk = async () => {
    if (!datasetId) return
    setRunning(true)
    setError(null)
    try {
      const result = await window.api.transform.rankCases({
        datasetId,
        sourceColId,
        targetName: targetName.trim(),
        targetLabel: targetLabel.trim() || undefined,
        order,
        method
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
      titleKey="dialog.rankCases.title"
      onOk={() => void handleOk()}
      onCancel={onClose}
      okDisabled={!canOk}
    >
      <div className={styles.selectRoot}>
        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.rankCases.sourceVar')}</span>
          <select
            className={styles.condSelect}
            value={sourceColId}
            onChange={e => {
              setSourceColId(e.target.value)
            }}
            aria-label={t('dialog.rankCases.sourceVar')}
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
          <span className={styles.condLabel}>{t('dialog.rankCases.targetName')}</span>
          <input
            className={styles.condInput}
            value={targetName}
            onChange={e => {
              setTargetName(e.target.value)
            }}
            placeholder={t('dialog.rankCases.targetNamePH')}
            aria-label={t('dialog.rankCases.targetName')}
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
          <span className={styles.condLabel}>{t('dialog.rankCases.order')}</span>
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
                {t(`dialog.rankCases.order_${o}`)}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.rankCases.method')}</span>
          <select
            className={styles.condSelect}
            value={method}
            onChange={e => {
              setMethod(e.target.value as typeof method)
            }}
            aria-label={t('dialog.rankCases.method')}
          >
            <option value="rank">{t('dialog.rankCases.method_rank')}</option>
            <option value="dense_rank">{t('dialog.rankCases.method_dense')}</option>
            <option value="percent_rank">{t('dialog.rankCases.method_percent')}</option>
          </select>
        </div>

        {error && <div className={styles.errorText}>{error}</div>}
      </div>
    </DialogBase>
  )
}
