// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import type { TFunction } from 'i18next'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable, MissingValues } from '@shared/data-types'
import styles from './VariableView.module.css'

interface MissingValuesModalProps {
  variable: Variable
  variableIndex: number
  datasetId: string
  t: TFunction<['dialogs']>
  onClose: () => void
}

export function MissingValuesModal({
  variable,
  variableIndex,
  datasetId,
  t,
  onClose
}: MissingValuesModalProps) {
  const [missingType, setMissingType] = useState<MissingValues['type'] | 'none'>(
    variable.missing ? variable.missing.type : 'none'
  )

  const [d1, setD1] = useState(variable.missing?.discrete?.[0]?.toString() ?? '')
  const [d2, setD2] = useState(variable.missing?.discrete?.[1]?.toString() ?? '')
  const [d3, setD3] = useState(variable.missing?.discrete?.[2]?.toString() ?? '')

  const [low, setLow] = useState(variable.missing?.rangeLow?.toString() ?? '')
  const [high, setHigh] = useState(variable.missing?.rangeHigh?.toString() ?? '')

  const handleSave = async () => {
    let missing: MissingValues | null = null

    if (missingType === 'discrete') {
      const arr = [d1.trim(), d2.trim(), d3.trim()].filter(Boolean)
      if (arr.length > 0) {
        const parsed = arr.map(v => (variable.type === 'numeric' ? Number(v) : v))
        missing = { type: 'discrete', discrete: parsed }
      }
    } else if (missingType === 'range') {
      const lVal = low.trim() ? Number(low) : undefined
      const hVal = high.trim() ? Number(high) : undefined
      if (lVal !== undefined || hVal !== undefined) {
        missing = { type: 'range', rangeLow: lVal, rangeHigh: hVal }
      }
    } else if (missingType === 'range+discrete') {
      const lVal = low.trim() ? Number(low) : undefined
      const hVal = high.trim() ? Number(high) : undefined
      const arr = [d1.trim()].filter(Boolean)
      const parsedDiscrete = arr.map(v => (variable.type === 'numeric' ? Number(v) : v))
      if (lVal !== undefined || hVal !== undefined || parsedDiscrete.length > 0) {
        missing = {
          type: 'range+discrete',
          rangeLow: lVal,
          rangeHigh: hVal,
          discrete: parsedDiscrete.length > 0 ? parsedDiscrete : undefined
        }
      }
    }

    try {
      await window.api.variable.update({
        datasetId,
        colId: variable.colId,
        updates: { missing }
      })
      useDatasetStore.getState().updateVariable(variableIndex, { missing })
      onClose()
    } catch (err) {
      alert(err instanceof Error ? err.message : t('dialogs:variableView.errorSaveMissingValues'))
    }
  }

  return (
    <div className="sa-dialog-overlay">
      <div className="sa-dialog">
        <div className="sa-dialog-header">
          <h3 className="sa-dialog-title">
            {t('dialogs:variableView.missingValuesTitle')}: {variable.name}
          </h3>
          <button
            onClick={onClose}
            className="sa-dialog-close"
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
            aria-label={t('common:close' as never)}
          >
            &times;
          </button>
        </div>
        <div className="sa-dialog-body">
          <div className="sa-radio-group">
            <div
              className={`sa-radio-card ${missingType === 'none' ? 'active' : ''}`}
              onClick={() => {
                setMissingType('none')
              }}
            >
              <div className="sa-radio-header">
                <input
                  type="radio"
                  name="missingType"
                  checked={missingType === 'none'}
                  onChange={() => {
                    setMissingType('none')
                  }}
                />
                <span>{t('dialogs:variableView.noMissing')}</span>
              </div>
            </div>

            <div
              className={`sa-radio-card ${missingType === 'discrete' ? 'active' : ''}`}
              onClick={() => {
                setMissingType('discrete')
              }}
            >
              <div className="sa-radio-header">
                <input
                  type="radio"
                  name="missingType"
                  checked={missingType === 'discrete'}
                  onChange={() => {
                    setMissingType('discrete')
                  }}
                />
                <span>{t('dialogs:variableView.discreteMissing')}</span>
              </div>
              {missingType === 'discrete' && (
                <div
                  className="sa-radio-content sa-radio-content--row"
                  onClick={e => {
                    e.stopPropagation()
                  }}
                >
                  <input
                    type="text"
                    value={d1}
                    onChange={e => {
                      setD1(e.target.value)
                    }}
                    placeholder="99"
                    className="sa-form-input sa-form-input--xs"
                  />
                  <input
                    type="text"
                    value={d2}
                    onChange={e => {
                      setD2(e.target.value)
                    }}
                    placeholder="999"
                    className="sa-form-input sa-form-input--xs"
                  />
                  <input
                    type="text"
                    value={d3}
                    onChange={e => {
                      setD3(e.target.value)
                    }}
                    placeholder="9999"
                    className="sa-form-input sa-form-input--xs"
                  />
                </div>
              )}
            </div>

            <div
              className={`sa-radio-card ${missingType === 'range' ? 'active' : ''}`}
              onClick={() => {
                setMissingType('range')
              }}
            >
              <div className="sa-radio-header">
                <input
                  type="radio"
                  name="missingType"
                  checked={missingType === 'range'}
                  onChange={() => {
                    setMissingType('range')
                  }}
                />
                <span>{t('dialogs:variableView.rangeMissing').split(' plus ')[0]}</span>
              </div>
              {missingType === 'range' && (
                <div
                  className="sa-radio-content sa-radio-content--row-md"
                  onClick={e => {
                    e.stopPropagation()
                  }}
                >
                  <div className="sa-form-group sa-form-group--flush">
                    <span className={styles.fieldHint}>{t('dialogs:variableView.low')}</span>
                    <input
                      type="text"
                      value={low}
                      onChange={e => {
                        setLow(e.target.value)
                      }}
                      placeholder="-inf"
                      className="sa-form-input sa-form-input--sm"
                    />
                  </div>
                  <div className="sa-form-group sa-form-group--flush">
                    <span className={styles.fieldHint}>{t('dialogs:variableView.high')}</span>
                    <input
                      type="text"
                      value={high}
                      onChange={e => {
                        setHigh(e.target.value)
                      }}
                      placeholder="inf"
                      className="sa-form-input sa-form-input--sm"
                    />
                  </div>
                </div>
              )}
            </div>

            <div
              className={`sa-radio-card ${missingType === 'range+discrete' ? 'active' : ''}`}
              onClick={() => {
                setMissingType('range+discrete')
              }}
            >
              <div className="sa-radio-header">
                <input
                  type="radio"
                  name="missingType"
                  checked={missingType === 'range+discrete'}
                  onChange={() => {
                    setMissingType('range+discrete')
                  }}
                />
                <span>{t('dialogs:variableView.rangeMissing')}</span>
              </div>
              {missingType === 'range+discrete' && (
                <div
                  className="sa-radio-content sa-radio-content--stack"
                  onClick={e => {
                    e.stopPropagation()
                  }}
                >
                  <div className="row-md">
                    <div className="sa-form-group sa-form-group--flush">
                      <span className={styles.fieldHint}>{t('dialogs:variableView.low')}</span>
                      <input
                        type="text"
                        value={low}
                        onChange={e => {
                          setLow(e.target.value)
                        }}
                        placeholder="-inf"
                        className="sa-form-input sa-form-input--sm"
                      />
                    </div>
                    <div className="sa-form-group sa-form-group--flush">
                      <span className={styles.fieldHint}>{t('dialogs:variableView.high')}</span>
                      <input
                        type="text"
                        value={high}
                        onChange={e => {
                          setHigh(e.target.value)
                        }}
                        placeholder="inf"
                        className="sa-form-input sa-form-input--sm"
                      />
                    </div>
                  </div>
                  <div className="sa-form-group sa-form-group--flush">
                    <span className={styles.fieldHint}>
                      {t('dialogs:variableView.discreteValue')}
                    </span>
                    <input
                      type="text"
                      value={d1}
                      onChange={e => {
                        setD1(e.target.value)
                      }}
                      placeholder="99"
                      className="sa-form-input sa-form-input--sm"
                    />
                  </div>
                </div>
              )}
            </div>
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
