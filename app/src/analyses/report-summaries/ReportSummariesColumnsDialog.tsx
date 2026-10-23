// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reports > Report Summaries in Columns (SPSS REPORT with the summary
 * functions in columns).
 *
 * The mirror of ReportSummariesDialog: same fields, same statistic menu, but
 * the report puts each break group on ONE row with the statistics running
 * across as columns. There is no "Display cases" option — a per-case listing
 * has nowhere to go in a one-row-per-group layout, and SPSS does not offer it
 * for this procedure either.
 *
 * The statistic menu comes from _shared/summary-stats.ts, whose R counterpart
 * is `sai_summary_stat_defs()` — one definition serving all three Reports
 * procedures.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  CheckOption,
  OptionSection,
  SubDialogFooter,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { MissingValuesSection, type MissingStrategy } from '../_shared/MissingValuesSection'
import { SummaryStatisticsContent } from '../_shared/SummaryStatisticsContent'
import { DEFAULT_SUMMARY_STATS, type SummaryStats } from '../_shared/summary-stats'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

function OptionsContent({
  grandTotal,
  onGrandTotalChange,
  missing,
  onMissingChange,
  onClose
}: {
  grandTotal: boolean
  onGrandTotalChange: (v: boolean) => void
  missing: MissingStrategy
  onMissingChange: (m: MissingStrategy) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [localTotal, setLocalTotal] = useState(grandTotal)
  const [localMissing, setLocalMissing] = useState(missing)

  return (
    <>
      <OptionSection>
        <CheckOption checked={localTotal} onChange={setLocalTotal}>
          {t('analysis:reportSummaries.grandTotal')}
        </CheckOption>
      </OptionSection>

      <MissingValuesSection value={localMissing} onChange={setLocalMissing} />

      <SubDialogFooter
        onContinue={() => {
          onGrandTotalChange(localTotal)
          onMissingChange(localMissing)
          onClose()
        }}
        onCancel={onClose}
      />
    </>
  )
}

export function ReportSummariesColumnsDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [stats, setStats] = useState<SummaryStats>(DEFAULT_SUMMARY_STATS)
  const [grandTotal, setGrandTotal] = useState(true)
  const [missing, setMissing] = useState<MissingStrategy>('analysis')
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:reportSummaries.dataColumnsField',
      single: false,
      sortMeasure: 'scale' as const
    },
    { key: 'breakVars', labelKey: 'analysis:reportSummaries.breakColumnsField', single: false }
  ]

  const sideButtons: SideButtonDef[] = [
    {
      key: 'statistics',
      labelKey: 'analysis:shell.btnStatistics',
      titleKey: 'analysis:reportColumns.statisticsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <SummaryStatisticsContent stats={stats} onChange={setStats} onClose={closeSub} />
      )
    },
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:reportColumns.optionsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <OptionsContent
          grandTotal={grandTotal}
          onGrandTotalChange={setGrandTotal}
          missing={missing}
          onMissingChange={setMissing}
          onClose={closeSub}
        />
      )
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) => (a['variables'] ?? []).length > 0 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    const breaks = a['breakVars'] ?? []

    const breakValueLabels: Record<string, Record<string, string>> = {}
    for (const b of breaks) {
      if (Object.keys(b.valueLabels).length > 0) {
        breakValueLabels[b.colId] = b.valueLabels
      }
    }

    await run(
      {
        analysisId: 'reportColumns',
        datasetId,
        scriptFile: 'report-summaries-columns.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          breakVars: breaks.map(v => v.colId),
          breakVarNames: Object.fromEntries(breaks.map(v => [v.colId, v.name])),
          ...(breaks.length > 0 ? { breakValueLabels } : {}),
          grandTotal,
          options: { missing, stats }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:reportColumns.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'reportColumns'}
      titleKey="analysis:reportColumns.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.reportColumns(a['variables'] ?? [], a['breakVars'] ?? [], {
          grandTotal,
          stats,
          missing
        })
      }
    />
  )
}
