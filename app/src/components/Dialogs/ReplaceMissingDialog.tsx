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

type Method = 'mean' | 'median' | 'mode' | 'value'

export function ReplaceMissingDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const uid = useId()
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)
  const commitMutation = useDatasetStore(s => s.commitMutation)

  const [colId, setColId] = useState<string>(variables[0]?.colId ?? '')
  const [method, setMethod] = useState<Method>('mean')
  const [fixedValue, setFixedValue] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const canOk = !!colId && (method !== 'value' || fixedValue.trim() !== '') && !running

  const handleOk = async () => {
    if (!datasetId) return
    setRunning(true)
    setError(null)
    try {
      await window.api.transform.replaceMissing({
        datasetId,
        colId,
        method,
        value: method === 'value' ? fixedValue.trim() : undefined
      })
      commitMutation()
      setDone(true)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const methods: Method[] = ['mean', 'median', 'mode', 'value']

  return (
    <DialogBase
      titleKey="dialog.replaceMissing.title"
      onOk={() => void handleOk()}
      onCancel={onClose}
      okDisabled={!canOk}
    >
      <div className={styles.selectRoot}>
        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.replaceMissing.variable')}</span>
          <select
            className={styles.condSelect}
            value={colId}
            onChange={e => {
              setColId(e.target.value)
            }}
            aria-label={t('dialog.replaceMissing.variable')}
          >
            {variables.map(v => (
              <option key={v.colId} value={v.colId}>
                {v.name}
                {v.label ? ` — ${v.label}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.radioGroup}>
          <span className={styles.sectionTitle}>{t('dialog.replaceMissing.method')}</span>
          {methods.map(m => (
            <label key={m} className={styles.radioRow}>
              <input
                type="radio"
                name={`${uid}-method`}
                checked={method === m}
                onChange={() => {
                  setMethod(m)
                }}
              />
              {t(`dialog.replaceMissing.method_${m}`)}
            </label>
          ))}
        </div>

        {method === 'value' && (
          <div className={styles.conditionRowSpaced}>
            <span className={styles.condLabel}>{t('dialog.replaceMissing.fixedValue')}</span>
            <input
              className={styles.condInput}
              value={fixedValue}
              onChange={e => {
                setFixedValue(e.target.value)
              }}
              placeholder={t('dialog.replaceMissing.fixedValuePH')}
              aria-label={t('dialog.replaceMissing.fixedValue')}
            />
          </div>
        )}

        {done && <div className={styles.successText}>{t('dialog.replaceMissing.done')}</div>}

        {error && <div className={styles.errorText}>{error}</div>}
      </div>
    </DialogBase>
  )
}
