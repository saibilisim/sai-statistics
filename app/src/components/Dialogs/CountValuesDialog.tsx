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

export function CountValuesDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)
  const commitMutation = useDatasetStore(s => s.commitMutation)

  const [selectedColIds, setSelectedColIds] = useState<string[]>([])
  const [targetName, setTargetName] = useState<string>('')
  const [targetLabel, setTargetLabel] = useState<string>('')
  const [matchValue, setMatchValue] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleCol = (colId: string) => {
    setSelectedColIds(prev =>
      prev.includes(colId) ? prev.filter(c => c !== colId) : [...prev, colId]
    )
  }

  const canOk =
    selectedColIds.length > 0 && targetName.trim() !== '' && matchValue !== '' && !running

  const handleOk = async () => {
    if (!datasetId) return
    setRunning(true)
    setError(null)
    try {
      const result = await window.api.transform.countValues({
        datasetId,
        sourceColIds: selectedColIds,
        targetName: targetName.trim(),
        targetLabel: targetLabel.trim() || undefined,
        matchValue
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
      titleKey="dialog.countValues.title"
      onOk={() => void handleOk()}
      onCancel={onClose}
      okDisabled={!canOk}
    >
      <div className={styles.pickerLayout}>
        <div className={styles.pickerLeft}>
          <p className={styles.colLabel}>{t('dialog.countValues.selectVars')}</p>
          <ul
            className={styles.varList}
            role="listbox"
            aria-multiselectable="true"
            aria-label={t('dialog.countValues.selectVars')}
          >
            {variables.map(v => (
              <li
                key={v.colId}
                role="option"
                aria-selected={selectedColIds.includes(v.colId)}
                className={cx(
                  styles.varItem,
                  selectedColIds.includes(v.colId) && styles.itemSelected
                )}
                onClick={() => {
                  toggleCol(v.colId)
                }}
              >
                <span className={styles.varName}>{v.name}</span>
                {v.label && <span className={styles.varLabel}>{v.label}</span>}
              </li>
            ))}
          </ul>
          <p className={styles.hintTextXs}>
            {t('dialog.countValues.selectedCount', { count: selectedColIds.length })}
          </p>
        </div>

        <div className={styles.pickerRight}>
          <div className={styles.selectRoot}>
            <div className={styles.conditionRowStacked}>
              <span className={styles.condLabel}>{t('dialog.countValues.matchValue')}</span>
              <input
                className={styles.condInput}
                value={matchValue}
                onChange={e => {
                  setMatchValue(e.target.value)
                }}
                placeholder={t('dialog.countValues.matchValuePH')}
                aria-label={t('dialog.countValues.matchValue')}
              />
            </div>

            <div className={styles.conditionRowStacked}>
              <span className={styles.condLabel}>{t('dialog.countValues.targetName')}</span>
              <input
                className={styles.condInput}
                value={targetName}
                onChange={e => {
                  setTargetName(e.target.value)
                }}
                placeholder={t('dialog.countValues.targetNamePH')}
                aria-label={t('dialog.countValues.targetName')}
              />
            </div>

            <div className={styles.conditionRowStacked}>
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

            <div className={styles.noteText}>{t('dialog.countValues.note')}</div>

            {error && <div className={styles.errorTextFlush}>{error}</div>}
          </div>
        </div>
      </div>
    </DialogBase>
  )
}
