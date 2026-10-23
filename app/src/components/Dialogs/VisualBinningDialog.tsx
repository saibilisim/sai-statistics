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

export function VisualBinningDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const uid = useId()
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)
  const commitMutation = useDatasetStore(s => s.commitMutation)

  const numericVars = variables.filter(v => v.type === 'numeric')
  const [sourceColId, setSourceColId] = useState<string>(numericVars[0]?.colId ?? '')
  const [targetName, setTargetName] = useState('')
  const [targetLabel, setTargetLabel] = useState('')
  const [method, setMethod] = useState<'equalWidth' | 'equalCount' | 'manual'>('equalWidth')
  const [bins, setBins] = useState('4')
  const [cutPointsText, setCutPointsText] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canOk =
    !!sourceColId &&
    targetName.trim() !== '' &&
    (method !== 'manual' || cutPointsText.trim() !== '') &&
    !running

  const handleOk = async () => {
    if (!datasetId) return
    setRunning(true)
    setError(null)
    try {
      const result = await window.api.transform.visualBinning({
        datasetId,
        sourceColId,
        targetName: targetName.trim(),
        targetLabel: targetLabel.trim() || undefined,
        method,
        ...(method === 'manual'
          ? {
              cutPoints: cutPointsText
                .split(',')
                .map(s => Number(s.trim()))
                .filter(n => !isNaN(n))
            }
          : { bins: Math.max(2, Number(bins) || 4) })
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
      titleKey="dialog.visualBinning.title"
      onOk={() => void handleOk()}
      onCancel={onClose}
      okDisabled={!canOk}
    >
      <div className={styles.selectRoot}>
        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.visualBinning.sourceVar')}</span>
          <select
            className={styles.condSelect}
            value={sourceColId}
            onChange={e => {
              setSourceColId(e.target.value)
            }}
            aria-label={t('dialog.visualBinning.sourceVar')}
          >
            {numericVars.map(v => (
              <option key={v.colId} value={v.colId}>
                {v.name}
                {v.label ? ` — ${v.label}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.visualBinning.targetName')}</span>
          <input
            className={styles.condInput}
            value={targetName}
            onChange={e => {
              setTargetName(e.target.value)
            }}
            aria-label={t('dialog.visualBinning.targetName')}
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
          <span className={styles.condLabel}>{t('dialog.visualBinning.method')}</span>
          <div className={styles.inlineOptionsWrap}>
            {(['equalWidth', 'equalCount', 'manual'] as const).map(m => (
              <label key={m} className={styles.radioRow}>
                <input
                  type="radio"
                  name={`${uid}-method`}
                  checked={method === m}
                  onChange={() => {
                    setMethod(m)
                  }}
                />
                {t(`dialog.visualBinning.method_${m}`)}
              </label>
            ))}
          </div>
        </div>

        {method !== 'manual' ? (
          <div className={styles.conditionRow}>
            <span className={styles.condLabel}>{t('dialog.visualBinning.bins')}</span>
            <input
              className={styles.condInput}
              type="number"
              min={2}
              max={50}
              value={bins}
              onChange={e => {
                setBins(e.target.value)
              }}
              aria-label={t('dialog.visualBinning.bins')}
            />
          </div>
        ) : (
          <div className={styles.conditionRow}>
            <span className={styles.condLabel}>{t('dialog.visualBinning.cutPoints')}</span>
            <input
              className={styles.condInput}
              value={cutPointsText}
              onChange={e => {
                setCutPointsText(e.target.value)
              }}
              placeholder={t('dialog.visualBinning.cutPointsPH')}
              aria-label={t('dialog.visualBinning.cutPoints')}
            />
          </div>
        )}

        {error && <div className={styles.errorText}>{error}</div>}
      </div>
    </DialogBase>
  )
}
