// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from './DialogBase'
import { useDatasetStore } from '../../store/dataset-store'
import styles from './DataDialogs.module.css'

interface RecodeMapping {
  oldValue: string
  newValue: string
}

interface Props {
  mode: 'same' | 'different'
  onClose: () => void
}

export function RecodeDialog({ mode, onClose }: Props) {
  const { t } = useTranslation()
  const uid = useId()
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)
  const commitMutation = useDatasetStore(s => s.commitMutation)

  const [sourceColId, setSourceColId] = useState<string>(variables[0]?.colId ?? '')
  const [targetName, setTargetName] = useState<string>('')
  const [targetLabel, setTargetLabel] = useState<string>('')
  const [outputType, setOutputType] = useState<'string' | 'numeric'>('string')
  const [mappings, setMappings] = useState<RecodeMapping[]>([{ oldValue: '', newValue: '' }])
  const [elseValue, setElseValue] = useState<string>('')
  const [elseMode, setElseMode] = useState<'keep' | 'set'>('keep')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const derivedTargetName =
    mode === 'same' ? (variables.find(v => v.colId === sourceColId)?.name ?? '') : targetName

  const canOk =
    !!sourceColId &&
    (mode === 'same' || targetName.trim() !== '') &&
    mappings.every(m => m.oldValue !== '' && m.newValue !== '') &&
    mappings.length > 0 &&
    !running

  const addRow = () => {
    setMappings(prev => [...prev, { oldValue: '', newValue: '' }])
  }
  const removeRow = (i: number) => {
    setMappings(prev => prev.filter((_, j) => j !== i))
  }
  const updateRow = (i: number, field: 'oldValue' | 'newValue', val: string) => {
    setMappings(prev => prev.map((m, j) => (j === i ? { ...m, [field]: val } : m)))
  }

  const handleOk = async () => {
    if (!datasetId) return
    setRunning(true)
    setError(null)
    try {
      const result = await window.api.transform.recode({
        datasetId,
        sourceColId,
        targetColId: mode === 'same' ? sourceColId : null,
        targetName: mode === 'different' ? targetName.trim() : undefined,
        targetLabel: targetLabel.trim() || undefined,
        mappings: mappings.filter(m => m.oldValue !== '' && m.newValue !== ''),
        elseValue: elseMode === 'set' ? elseValue : null,
        outputType
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
      titleKey={mode === 'same' ? 'dialog.recode.titleSame' : 'dialog.recode.titleDifferent'}
      onOk={() => void handleOk()}
      onCancel={onClose}
      okDisabled={!canOk}
    >
      <div className={styles.selectRoot}>
        {/* Source variable */}
        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.recode.sourceVar')}</span>
          <select
            className={styles.condSelect}
            value={sourceColId}
            onChange={e => {
              setSourceColId(e.target.value)
            }}
            aria-label={t('dialog.recode.sourceVar')}
          >
            {variables.map(v => (
              <option key={v.colId} value={v.colId}>
                {v.name}
                {v.label ? ` — ${v.label}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Target name (only for "into different") */}
        {mode === 'different' && (
          <>
            <div className={styles.conditionRow}>
              <span className={styles.condLabel}>{t('dialog.recode.targetName')}</span>
              <input
                className={styles.condInput}
                value={targetName}
                onChange={e => {
                  setTargetName(e.target.value)
                }}
                placeholder={t('dialog.recode.targetNamePlaceholder')}
                aria-label={t('dialog.recode.targetName')}
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
          </>
        )}

        {/* Output type */}
        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.recode.outputType')}</span>
          <div className="row-md">
            {(['string', 'numeric'] as const).map(ot => (
              <label key={ot} className={styles.radioRow}>
                <input
                  type="radio"
                  name={`${uid}-ot`}
                  checked={outputType === ot}
                  onChange={() => {
                    setOutputType(ot)
                  }}
                />
                {t(`dialog.recode.outputType_${ot}`)}
              </label>
            ))}
          </div>
        </div>

        {/* Mapping table */}
        <div className={styles.conditionBox}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>{t('dialog.recode.mappings')}</span>
            <button className={styles.addRowBtn} onClick={addRow}>
              + {t('dialog.recode.addRow')}
            </button>
          </div>
          <div className={styles.mappingHeader}>
            <span>{t('dialog.recode.oldValue')}</span>
            <span>{t('dialog.recode.newValue')}</span>
            <span />
          </div>
          {mappings.map((m, i) => (
            <div key={i} className={styles.mappingRow}>
              <input
                className={styles.mappingInput}
                value={m.oldValue}
                onChange={e => {
                  updateRow(i, 'oldValue', e.target.value)
                }}
                placeholder={t('dialog.recode.oldValuePH')}
                aria-label={`${t('dialog.recode.oldValue')} ${String(i + 1)}`}
              />
              <input
                className={styles.mappingInput}
                value={m.newValue}
                onChange={e => {
                  updateRow(i, 'newValue', e.target.value)
                }}
                placeholder={t('dialog.recode.newValuePH')}
                aria-label={`${t('dialog.recode.newValue')} ${String(i + 1)}`}
              />
              <button
                className={styles.removeRowBtn}
                onClick={() => {
                  removeRow(i)
                }}
                aria-label={t('dialog.recode.removeRow')}
                disabled={mappings.length === 1}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Else clause */}
        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('dialog.recode.else')}</span>
          <div className={styles.inlineOptions}>
            <label className={styles.radioRow}>
              <input
                type="radio"
                name={`${uid}-else`}
                checked={elseMode === 'keep'}
                onChange={() => {
                  setElseMode('keep')
                }}
              />
              {t('dialog.recode.elseKeep')}
            </label>
            <label className={styles.radioRow}>
              <input
                type="radio"
                name={`${uid}-else`}
                checked={elseMode === 'set'}
                onChange={() => {
                  setElseMode('set')
                }}
              />
              {t('dialog.recode.elseSet')}
            </label>
            {elseMode === 'set' && (
              <input
                className={styles.condInput}
                value={elseValue}
                onChange={e => {
                  setElseValue(e.target.value)
                }}
                placeholder={t('dialog.recode.elseValuePH')}
              />
            )}
          </div>
        </div>

        {error && <div className={styles.errorText}>{error}</div>}

        {mode === 'same' && (
          <div className={styles.hintText}>
            {t('dialog.recode.inSameNote', { name: derivedTargetName })}
          </div>
        )}
      </div>
    </DialogBase>
  )
}
