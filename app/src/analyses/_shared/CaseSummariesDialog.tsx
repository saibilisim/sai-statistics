// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reports > Case Summaries (SPSS SUMMARIZE). Lists selected variables per
 * case (optionally broken by a group), plus a summary table of the statistics
 * picked in the Statistics sub-dialog. See spss-parity-analysis.md §3.8.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  CheckOption,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { type MissingStrategy } from './MissingValuesSection'
import { MissingValuesOptionsContent } from './MissingValuesOptionsContent'
import { SummaryStatisticsContent } from './SummaryStatisticsContent'
import { DEFAULT_SUMMARY_STATS, type SummaryStats } from './summary-stats'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from './useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

// ─────────────────────────────────────────────────────────────
//  Main dialog
// ─────────────────────────────────────────────────────────────

export function CaseSummariesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [displayCases, setDisplayCases] = useState(true)
  const [limitEnabled, setLimitEnabled] = useState(true)
  const [limitCases, setLimitCases] = useState('100')
  const [stats, setStats] = useState<SummaryStats>(DEFAULT_SUMMARY_STATS)
  const [missing, setMissing] = useState<MissingStrategy>('analysis')
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    { key: 'variables', labelKey: 'analysis:caseSummaries.variablesField', single: false },
    { key: 'groupVar', labelKey: 'analysis:caseSummaries.groupField', single: true }
  ]

  const sideButtons: SideButtonDef[] = [
    {
      key: 'statistics',
      labelKey: 'analysis:shell.btnStatistics',
      titleKey: 'analysis:caseSummaries.statisticsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <SummaryStatisticsContent stats={stats} onChange={setStats} onClose={closeSub} />
      )
    },
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:caseSummaries.optionsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <MissingValuesOptionsContent value={missing} onChange={setMissing} onClose={closeSub} />
      )
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) => (a['variables'] ?? []).length > 0 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    const g = a['groupVar']?.[0]
    await run(
      {
        analysisId: 'caseSummaries',
        datasetId,
        scriptFile: 'case-summaries.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          ...(g
            ? { groupVar: g.colId, groupVarName: g.name, groupValueLabels: g.valueLabels }
            : {}),
          displayCases,
          // SPSS /FORMAT=TOTAL: group subtotal rows + grand Total in the listing.
          subtotals: true,
          // Omitted entirely when the checkbox is off — R reads "no limit".
          ...(limitEnabled ? { limitCases: Math.max(1, Number(limitCases) || 100) } : {}),
          options: { missing, stats }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:caseSummaries.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'caseSummaries'}
      titleKey="analysis:caseSummaries.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.caseSummaries(a['variables'] ?? [], a['groupVar'] ?? [], {
          displayCases,
          subtotals: true,
          limitCases: limitEnabled ? Math.max(1, Number(limitCases) || 100) : null,
          missing,
          stats
        })
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <CheckOption checked={displayCases} onChange={setDisplayCases}>
            {t('analysis:caseSummaries.displayCases')}
          </CheckOption>
          <label className={shellStyles.checkRow}>
            <input
              type="checkbox"
              checked={limitEnabled}
              onChange={e => {
                setLimitEnabled(e.target.checked)
              }}
            />
            {t('analysis:caseSummaries.limitCases')}
            <input
              type="number"
              min={1}
              value={limitCases}
              disabled={!limitEnabled}
              onChange={e => {
                setLimitCases(e.target.value)
              }}
              className="numField"
            />
          </label>
        </div>
      }
    />
  )
}
