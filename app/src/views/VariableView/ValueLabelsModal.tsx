// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useRef } from 'react'
import type { TFunction } from 'i18next'
import { useDatasetStore } from '../../store/dataset-store'
import { cx } from '../../lib/cx'
import type { Variable } from '@shared/data-types'
import styles from './VariableView.module.css'

interface ValueLabelsModalProps {
  variable: Variable
  variableIndex: number
  datasetId: string
  t: TFunction<['dialogs']>
  onClose: () => void
}

export function ValueLabelsModal({
  variable,
  variableIndex,
  datasetId,
  t,
  onClose
}: ValueLabelsModalProps) {
  const valueInputRef = useRef<HTMLInputElement>(null)
  const [labels, setLabels] = useState<Record<string, string>>({ ...variable.valueLabels })
  const [val, setVal] = useState('')
  const [lbl, setLbl] = useState('')

  const handleAdd = () => {
    const key = val.trim()
    const value = lbl.trim()
    if (!key || !value) return
    setLabels(prev => ({ ...prev, [key]: value }))
    setVal('')
    setLbl('')
    valueInputRef.current?.focus()
  }

  const handleRemove = (key: string) => {
    setLabels(Object.fromEntries(Object.entries(labels).filter(([k]) => k !== key)))
  }

  const handleSave = async () => {
    try {
      await window.api.variable.update({
        datasetId,
        colId: variable.colId,
        updates: { valueLabels: labels }
      })
      useDatasetStore.getState().updateVariable(variableIndex, { valueLabels: labels })
      onClose()
    } catch (err) {
      alert(err instanceof Error ? err.message : t('dialogs:variableView.errorSaveValueLabels'))
    }
  }
  return (
    <div className="sa-dialog-overlay">
      <div className="sa-dialog">
        <div className="sa-dialog-header">
          <h3 className="sa-dialog-title">
            {t('dialogs:variableView.valueLabelsTitle')}: {variable.name}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="sa-dialog-close"
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
            aria-label={t('common:close' as never)}
          >
            &times;
          </button>
        </div>
        <div className="sa-dialog-body">
          <div className={styles.rowInputs}>
            <div className="sa-form-group">
              <label className="sa-form-label">{t('dialogs:variableView.value')}</label>
              <input
                ref={valueInputRef}
                autoFocus={true}
                type="text"
                value={val}
                onChange={e => {
                  setVal(e.target.value)
                }}
                className="sa-form-input"
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAdd()
                }}
              />
            </div>
            <div className="sa-form-group">
              <label className="sa-form-label">{t('dialogs:variableView.lbl')}</label>
              <input
                type="text"
                value={lbl}
                onChange={e => {
                  setLbl(e.target.value)
                }}
                className="sa-form-input"
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAdd()
                }}
              />
            </div>
            <button type="button" onClick={handleAdd} className={cx('sa-btn', styles.addBtn)}>
              {t('dialogs:variableView.addLabel')}
            </button>
          </div>

          <div className="sa-value-list">
            {Object.keys(labels).length === 0 ? (
              <span className="sa-value-list-empty">{t('dialogs:variableView.none')}</span>
            ) : (
              Object.entries(labels).map(([k, v]) => (
                <div key={k} className="sa-value-item">
                  <span className="sa-value-item-text">
                    <strong>{k}</strong> = "{v}"
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      handleRemove(k)
                    }}
                    className="sa-value-item-remove"
                  >
                    &times;
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="sa-dialog-footer">
          <button type="button" onClick={onClose} className="sa-btn">
            {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion */}
            {t('common:common.cancel' as never)}
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSave()
            }}
            className="sa-btn sa-btn-primary"
          >
            {t('dialogs:variableView.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
