// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Distances dialog — SPSS-style.
 * Analyze → Correlate → Distances (proximities between variables)
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnalysisDialogShell } from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

type Measure = 'euclidean' | 'sqeuclidean' | 'manhattan' | 'chebyshev' | 'cosine' | 'pearson'

export function DistancesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [measure, setMeasure] = useState<Measure>('euclidean')
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:distances.variablesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length >= 2 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    await run(
      {
        analysisId: 'distances',
        datasetId,
        scriptFile: 'distances.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          measure
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:distances.title', assignments: a }
    )
  }

  const radio = (val: Measure, labelKey: string) => (
    <label className={shellStyles.checkRow}>
      <input
        type="radio"
        checked={measure === val}
        onChange={() => {
          setMeasure(val)
        }}
      />
      {t(labelKey as never)}
    </label>
  )

  return (
    <AnalysisDialogShell
      analysisId={'distances'}
      titleKey="analysis:distances.title"
      fieldDefs={fieldDefs}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a => buildSyntax.distances(a['variables'] ?? [], measure)}
      extraContent={
        <div className={shellStyles.optionSection}>
          <div className={shellStyles.optionSectionTitle}>{t('analysis:distances.measure')}</div>
          <div className={shellStyles.optionGrid}>
            {radio('euclidean', 'analysis:distances.euclidean')}
            {radio('sqeuclidean', 'analysis:distances.sqeuclidean')}
            {radio('manhattan', 'analysis:distances.manhattan')}
            {radio('chebyshev', 'analysis:distances.chebyshev')}
            {radio('cosine', 'analysis:distances.cosine')}
            {radio('pearson', 'analysis:distances.pearson')}
          </div>
        </div>
      }
    />
  )
}
