// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Analyze Design dialog — Analyze → Design of Experiments → Analyze Design.
 * The variable boxes follow the chosen design (doe-analysis.R decides the
 * model and error terms from it).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnalysisDialogShell, type FieldDef } from '../../components/Dialogs/AnalysisDialogShell'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import type { DoeDesignType } from './doe-designs'
import { DOE_ROLES, doeAnalysisParams } from './doe-params'

const DESIGNS: DoeDesignType[] = ['crd', 'rcbd', 'latin', 'factorial', 'splitplot', 'twok']
const COMPARISONS = ['lsd', 'tukey', 'duncan', 'snk', 'none'] as const
type Comparison = (typeof COMPARISONS)[number]

export function DoeAnalysisDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { running, run } = useRunAnalysis()
  const [design, setDesign] = useState<DoeDesignType>('rcbd')
  const [comparison, setComparison] = useState<Comparison>('lsd')
  const [alpha, setAlpha] = useState('0.05')

  const fieldDefs: FieldDef[] = [
    {
      key: 'response',
      labelKey: 'analysis:doe.responseField',
      single: true,
      filter: (v: Variable) => v.type === 'numeric'
    },
    ...DOE_ROLES[design].map(r => ({
      key: r.key,
      labelKey: `analysis:doe.field_${r.key}${design === 'twok' && r.key === 'factors' ? 'Coded' : ''}`,
      single: r.single
    }))
  ]
  const alphaNum = Number(alpha)
  const alphaOk = Number.isFinite(alphaNum) && alphaNum > 0 && alphaNum < 0.5

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    const p = doeAnalysisParams(design, a)
    if (!datasetId || !p) return
    const vars = fieldDefs.flatMap(f => a[f.key] ?? [])
    await run(
      {
        analysisId: 'doe',
        datasetId,
        scriptFile: 'doe-analysis.R',
        params: {
          ...p,
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          valueLabels: Object.fromEntries(vars.map(v => [v.colId, v.valueLabels])),
          options: { comparison, alpha: alphaNum }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:doe.analyzeTitle', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      titleKey="analysis:doe.analyzeTitle"
      fieldDefs={fieldDefs}
      canSubmit={a => doeAnalysisParams(design, a) !== null && alphaOk && !running}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setDesign('rcbd')
        setComparison('lsd')
        setAlpha('0.05')
      }}
      extraContent={
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {t('analysis:doe.designLabel')}
            <select
              className="numField numField--select"
              value={design}
              onChange={e => {
                setDesign(e.target.value as DoeDesignType)
              }}
            >
              {DESIGNS.map(d => (
                <option key={d} value={d}>
                  {t(`analysis:doe.design_${d}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={shellStyles.checkRow}>
            {t('analysis:doe.comparisonLabel')}
            <select
              className="numField numField--select"
              value={comparison}
              disabled={design === 'twok'}
              onChange={e => {
                setComparison(e.target.value as Comparison)
              }}
            >
              {COMPARISONS.map(c => (
                <option key={c} value={c}>
                  {t(`analysis:doe.comparison_${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={shellStyles.checkRow}>
            {t('analysis:doe.alphaLabel')}
            <input
              type="number"
              step="0.01"
              min="0.001"
              max="0.2"
              className="numField"
              value={alpha}
              onChange={e => {
                setAlpha(e.target.value)
              }}
            />
          </label>
          <div className={shellStyles.optionHint}>{t(`analysis:doe.hint_${design}`)}</div>
        </div>
      }
    />
  )
}
