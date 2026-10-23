// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Multidimensional Scaling dialog — SPSS Scale → Multidimensional Scaling.
 * Analyze → Scale → Multidimensional Scaling
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnalysisDialogShell } from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

export function MdsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [dimensions, setDimensions] = useState(2)
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:mds.variablesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length >= 3 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    await run(
      {
        analysisId: 'mds',
        datasetId,
        scriptFile: 'mds.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          dimensions
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:mds.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'mds'}
      titleKey="analysis:mds.title"
      fieldDefs={fieldDefs}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a => buildSyntax.mds(a['variables'] ?? [], dimensions)}
      extraContent={
        <div className={shellStyles.optionSection}>
          <div className={shellStyles.optionSectionTitle}>{t('analysis:mds.dimensions')}</div>
          <div className={shellStyles.optionGrid}>
            <label className={shellStyles.checkRow}>
              <input
                type="radio"
                checked={dimensions === 2}
                onChange={() => {
                  setDimensions(2)
                }}
              />
              {t('analysis:mds.dim2')}
            </label>
            <label className={shellStyles.checkRow}>
              <input
                type="radio"
                checked={dimensions === 3}
                onChange={() => {
                  setDimensions(3)
                }}
              />
              {t('analysis:mds.dim3')}
            </label>
          </div>
        </div>
      }
    />
  )
}
