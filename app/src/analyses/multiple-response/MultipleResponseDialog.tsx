// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Multiple Response Frequencies dialog (multiple-dichotomy set).
 * Analyze → Multiple Response
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnalysisDialogShell } from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

export function MultipleResponseDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [counted, setCounted] = useState('1')
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:mr.variablesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length >= 2 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    const cv = parseFloat(counted)
    await run(
      {
        analysisId: 'mr',
        datasetId,
        scriptFile: 'multiple-response.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          countedValue: Number.isFinite(cv) ? cv : 1
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:mr.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'mr'}
      titleKey="analysis:mr.title"
      fieldDefs={fieldDefs}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a => buildSyntax.multipleResponse(a['variables'] ?? [], Number(counted) || 1)}
      extraContent={
        <div className={shellStyles.optionSection}>
          <div className={shellStyles.optionSectionTitle}>{t('analysis:mr.countedValue')}</div>
          <label className={shellStyles.checkRow}>
            <input
              type="number"
              step="any"
              value={counted}
              onChange={e => {
                setCounted(e.target.value)
              }}
              className="numField"
            />
          </label>
        </div>
      }
    />
  )
}
