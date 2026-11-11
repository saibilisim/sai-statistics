// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Item Analysis dialog — Analyze → Scale → Item Analysis.
 * Item-total statistics, upper/lower group (27%) comparison, and difficulty /
 * discrimination for 0/1-scored items (item-analysis.R).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnalysisDialogShell } from '../../components/Dialogs/AnalysisDialogShell'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'

export function ItemAnalysisDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { running, run } = useRunAnalysis()
  const [pct, setPct] = useState('27')

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:itemAnalysis.itemsField',
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const pctNum = Number(pct)
  const pctOk = Number.isFinite(pctNum) && pctNum > 0 && pctNum <= 50

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    await run(
      {
        analysisId: 'itemAnalysis',
        datasetId,
        scriptFile: 'item-analysis.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          options: { groupPercent: pctNum }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:itemAnalysis.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId="itemAnalysis"
      titleKey="analysis:itemAnalysis.title"
      fieldDefs={fieldDefs}
      canSubmit={a => (a['variables'] ?? []).length >= 2 && pctOk && !running}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setPct('27')
      }}
      extraContent={
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {t('analysis:itemAnalysis.groupPercent')}
            <input
              type="number"
              min="5"
              max="50"
              step="1"
              className="numField"
              value={pct}
              onChange={e => {
                setPct(e.target.value)
              }}
            />
          </label>
          <div className={shellStyles.optionHint}>{t('analysis:itemAnalysis.groupHint')}</div>
        </div>
      }
    />
  )
}
