// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from './DialogBase'
import { useDatasetStore } from '../../store/dataset-store'
import { cx } from '../../lib/cx'
import type { MeasureLevel, MissingValues, Variable } from '@shared/data-types'
import styles from './DataDialogs.module.css'

interface Props {
  onClose: () => void
}

interface DistinctValue {
  raw: string
  count: number
}

interface ScannedVariable {
  variable: Variable
  distinct: DistinctValue[]
  /** true when the distinct count exceeded the scan cap — likely continuous, no per-value editing offered. */
  tooMany: boolean
  labels: Record<string, string>
  missingSet: Set<string>
  measure: MeasureLevel
}

const SCAN_CAP = 30

function suggestMeasure(
  type: Variable['type'],
  distinctCount: number,
  tooMany: boolean
): MeasureLevel {
  if (type === 'string') return 'nominal'
  if (tooMany) return 'scale'
  return distinctCount <= 10 ? 'nominal' : 'scale'
}

export function DefineVariablePropertiesDialog({ onClose }: Props) {
  const { t } = useTranslation(['common', 'dialogs'])
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)
  const setVariables = useDatasetStore(s => s.setVariables)
  const setModified = useDatasetStore(s => s.setModified)

  const [stage, setStage] = useState<'select' | 'edit'>('select')
  const [selected, setSelected] = useState<string[]>([])
  const [scanned, setScanned] = useState<ScannedVariable[]>([])
  const [scanning, setScanning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const available = variables.filter(v => !selected.includes(v.colId))
  const addVar = (colId: string) => {
    setSelected(prev => [...prev, colId])
  }
  const removeVar = (colId: string) => {
    setSelected(prev => prev.filter(c => c !== colId))
  }

  const handleScan = async () => {
    if (!datasetId || selected.length === 0) return
    setScanning(true)
    setError(null)
    try {
      const slice = await window.api.data.getAll({ datasetId })
      const results: ScannedVariable[] = selected.map(colId => {
        const variable = variables.find(v => v.colId === colId)
        if (!variable) throw new Error(`Column not found: ${colId}`)
        const colIndex = variables.findIndex(v => v.colId === colId)
        const counts = new Map<string, number>()
        for (const row of slice.rows) {
          const cell = row[colIndex]
          if (cell === null || cell === undefined) continue
          const key = String(cell)
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        const distinct = [...counts.entries()]
          .map(([raw, count]) => ({ raw, count }))
          .sort((a, b) => a.raw.localeCompare(b.raw, undefined, { numeric: true }))
        const tooMany = distinct.length > SCAN_CAP
        const labels: Record<string, string> = {}
        for (const [k, v] of Object.entries(variable.valueLabels)) labels[k] = v
        const missingSet = new Set<string>(
          variable.missing?.type === 'discrete' || variable.missing?.type === 'range+discrete'
            ? (variable.missing.discrete ?? []).map(v => String(v))
            : []
        )
        return {
          variable,
          distinct,
          tooMany,
          labels,
          missingSet,
          measure: suggestMeasure(variable.type, distinct.length, tooMany)
        }
      })
      setScanned(results)
      setStage('edit')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }

  const updateLabel = (colId: string, raw: string, label: string) => {
    setScanned(prev =>
      prev.map(sv =>
        sv.variable.colId === colId ? { ...sv, labels: { ...sv.labels, [raw]: label } } : sv
      )
    )
  }
  const toggleMissing = (colId: string, raw: string) => {
    setScanned(prev =>
      prev.map(sv => {
        if (sv.variable.colId !== colId) return sv
        const next = new Set(sv.missingSet)
        if (next.has(raw)) next.delete(raw)
        else next.add(raw)
        return { ...sv, missingSet: next }
      })
    )
  }
  const setMeasure = (colId: string, measure: MeasureLevel) => {
    setScanned(prev => prev.map(sv => (sv.variable.colId === colId ? { ...sv, measure } : sv)))
  }

  const handleApply = async () => {
    if (!datasetId) return
    setApplying(true)
    setError(null)
    try {
      for (const sv of scanned) {
        const cleanLabels = Object.fromEntries(
          Object.entries(sv.labels).filter(([, v]) => v.trim() !== '')
        )
        // Scanned values are strings; a numeric variable's discrete missing
        // values are stored as numbers (same as Variable View's editor).
        const discrete = [...sv.missingSet].map(raw =>
          sv.variable.type === 'numeric' && raw.trim() !== '' && !Number.isNaN(Number(raw))
            ? Number(raw)
            : raw
        )
        // This dialog only edits discrete values — keep a range the variable
        // already has (Variable View) instead of silently dropping it.
        const prev = sv.variable.missing
        const hasRange = prev?.type === 'range' || prev?.type === 'range+discrete'
        const missing: MissingValues | null = hasRange
          ? {
              type: discrete.length > 0 ? 'range+discrete' : 'range',
              rangeLow: prev.rangeLow,
              rangeHigh: prev.rangeHigh,
              ...(discrete.length > 0 ? { discrete } : {})
            }
          : discrete.length > 0
            ? { type: 'discrete', discrete }
            : null
        await window.api.variable.update({
          datasetId,
          colId: sv.variable.colId,
          updates: { valueLabels: cleanLabels, missing, measure: sv.measure }
        })
      }
      const refreshed = await window.api.variable.getAll({ datasetId })
      setVariables(refreshed)
      setModified(true)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  if (stage === 'select') {
    return (
      <DialogBase
        titleKey="dialog.defineVarProps.title"
        onOk={() => void handleScan()}
        onCancel={onClose}
        okDisabled={selected.length === 0 || scanning}
      >
        <p className={styles.colLabel}>{t('dialog.defineVarProps.pickVars')}</p>
        <div className={styles.pickerLayout}>
          <div className={styles.pickerLeft}>
            <ul
              className={styles.varList}
              role="listbox"
              aria-label={t('dialog.defineVarProps.pickVars')}
            >
              {available.map(v => (
                <li
                  key={v.colId}
                  role="option"
                  aria-selected={false}
                  className={styles.varItem}
                  onClick={() => {
                    addVar(v.colId)
                  }}
                >
                  <span className={styles.varName}>{v.name}</span>
                  {v.label && <span className={styles.varLabel}>{v.label}</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.pickerArrow} aria-hidden="true">
            →
          </div>
          <div className={styles.pickerRight}>
            <ul
              className={styles.varList}
              role="listbox"
              aria-label={t('dialog.defineVarProps.pickVars')}
            >
              {selected.map(colId => {
                const v = variables.find(vv => vv.colId === colId)
                return (
                  <li key={colId} className={cx(styles.varItem, styles.itemSelected)}>
                    <span className={styles.varName}>{v?.name ?? colId}</span>
                    <button
                      type="button"
                      className={styles.removeRowBtn}
                      onClick={e => {
                        e.stopPropagation()
                        removeVar(colId)
                      }}
                      aria-label={t('dialog.recode.removeRow')}
                    >
                      ×
                    </button>
                  </li>
                )
              })}
              {selected.length === 0 && (
                <li className={styles.emptyNote}>{t('dialog.defineVarProps.noneSelected')}</li>
              )}
            </ul>
          </div>
        </div>
        <p className={styles.limitationNote}>
          {t('dialog.defineVarProps.scanNote', { cap: SCAN_CAP })}
        </p>
        {error && <div className={styles.errorText}>{error}</div>}
      </DialogBase>
    )
  }

  return (
    <DialogBase
      titleKey="dialog.defineVarProps.title"
      onOk={() => void handleApply()}
      onCancel={onClose}
      okDisabled={applying}
    >
      {scanned.map(sv => (
        <div key={sv.variable.colId} className={styles.propsBox}>
          <div className={styles.propsVarName}>
            {sv.variable.name}
            {sv.variable.label && ` — ${sv.variable.label}`}
          </div>

          <div className={styles.propsMeasureRow}>
            {(
              [
                ['nominal', 'dialogs:variableView.nominal'],
                ['ordinal', 'dialogs:variableView.ordinal'],
                ['scale', 'dialogs:variableView.scale']
              ] as const
            ).map(([m, key]) => (
              <label key={m} className={styles.radioRow}>
                <input
                  type="radio"
                  checked={sv.measure === m}
                  onChange={() => {
                    setMeasure(sv.variable.colId, m)
                  }}
                />
                {t(key)}
              </label>
            ))}
          </div>

          {sv.tooMany ? (
            <p className={styles.emptyNote}>
              {t('dialog.defineVarProps.tooMany', { count: sv.distinct.length })}
            </p>
          ) : (
            <>
              <div className={styles.propsHeader}>
                <span>{t('dialog.defineVarProps.value')}</span>
                <span>{t('dialog.defineVarProps.count')}</span>
                <span>{t('dialog.defineVarProps.label')}</span>
                <span>{t('dialog.defineVarProps.missing')}</span>
              </div>
              {sv.distinct.map(dv => (
                <div key={dv.raw} className={styles.propsRow}>
                  <span>{dv.raw}</span>
                  <span>{dv.count}</span>
                  <input
                    className={styles.mappingInput}
                    value={sv.labels[dv.raw] ?? ''}
                    onChange={e => {
                      updateLabel(sv.variable.colId, dv.raw, e.target.value)
                    }}
                    placeholder={t('dialog.recode.optional')}
                  />
                  <input
                    type="checkbox"
                    checked={sv.missingSet.has(dv.raw)}
                    onChange={() => {
                      toggleMissing(sv.variable.colId, dv.raw)
                    }}
                    aria-label={`${t('dialog.defineVarProps.missing')} ${dv.raw}`}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      ))}
      {error && <div className={styles.errorText}>{error}</div>}
    </DialogBase>
  )
}
