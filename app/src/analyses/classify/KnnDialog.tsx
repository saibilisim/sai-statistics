// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Nearest Neighbor dialog — SPSS-style.
 * Analyze → Classify → Nearest Neighbor
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnalysisDialogShell } from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

export function KnnDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [k, setK] = useState('5')
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    { key: 'group', labelKey: 'analysis:knn.groupField', single: true },
    {
      key: 'independents',
      labelKey: 'analysis:knn.independentsField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['group'] ?? []).length === 1 &&
    (a['independents'] ?? []).length > 0 &&
    Number(k) >= 1 &&
    !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const g = (a['group'] ?? [])[0]
    const indeps = a['independents'] ?? []
    if (!g) return
    await run(
      {
        analysisId: 'knn',
        datasetId,
        scriptFile: 'knn.R',
        params: {
          groupVar: g.colId,
          groupName: g.label || g.name,
          groupValueLabels: g.valueLabels,
          independents: indeps.map(v => v.colId),
          varNames: Object.fromEntries(indeps.map(v => [v.colId, v.label || v.name])),
          options: { k: Number(k) || 5 }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:knn.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'knn'}
      titleKey="analysis:knn.title"
      fieldDefs={fieldDefs}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.knn(a['group'] ?? [], a['independents'] ?? [], Number(k) || 5)
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {t('analysis:knn.kLabel')}
            <input
              type="number"
              min="1"
              value={k}
              onChange={e => {
                setK(e.target.value)
              }}
              className="numField--sm"
            />
          </label>
        </div>
      }
    />
  )
}
