// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reports > Report Summaries in Rows (SPSS REPORT with /SUMMARY lines).
 *
 * Data Columns are the report's columns; Break Columns split it into groups,
 * and each group's summary statistics are printed one per ROW beneath it —
 * the layout that distinguishes this procedure from Case Summaries and OLAP
 * Cubes, which both put statistics in columns.
 *
 * SPSS's Format/Layout sub-dialogs (page length, column widths, page
 * numbering, titles/footers) are deliberately not offered: they configure a
 * printed page, and this report renders into the same scrollable HTML table as
 * every other analysis, where none of them mean anything.
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

// ─────────────────────────────────────────────────────────────
//  Options sub-dialog
// ─────────────────────────────────────────────────────────────

interface ReportOptions {
  displayCases: boolean
  grandTotal: boolean
  limitCases: boolean
  /** Kept as text, like CaseSummariesDialog: a number-typed state cannot hold
   *  the empty string a user passes through while retyping the value. */
  limitCasesN: string
}

const defaultOptions: ReportOptions = {
  displayCases: false,
  grandTotal: true,
  limitCases: true,
  limitCasesN: '100'
}

function OptionsContent({
  options,
  onChange,
  missing,
  onMissingChange,
  onClose
}: {
  options: ReportOptions
  onChange: (o: ReportOptions) => void
  missing: MissingStrategy
  onMissingChange: (m: MissingStrategy) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(options)
  const [localMissing, setLocalMissing] = useState(missing)

  return (
    <>
      <OptionSection>
        <CheckOption
          checked={local.displayCases}
          onChange={v => {
            setLocal(prev => ({ ...prev, displayCases: v }))
          }}
        >
          {t('analysis:reportSummaries.displayCases')}
        </CheckOption>
        <CheckOption
          checked={local.limitCases}
          disabled={!local.displayCases}
          onChange={v => {
            setLocal(prev => ({ ...prev, limitCases: v }))
          }}
        >
          {t('analysis:reportSummaries.limitCases')}
        </CheckOption>
        <input
          type="number"
          min={1}
          className="numField"
          value={local.limitCasesN}
          disabled={!local.displayCases || !local.limitCases}
          onChange={e => {
            setLocal(prev => ({ ...prev, limitCasesN: e.target.value }))
          }}
          aria-label={t('analysis:reportSummaries.limitCases')}
        />
        <CheckOption
          checked={local.grandTotal}
          onChange={v => {
            setLocal(prev => ({ ...prev, grandTotal: v }))
          }}
        >
          {t('analysis:reportSummaries.grandTotal')}
        </CheckOption>
      </OptionSection>

      <MissingValuesSection value={localMissing} onChange={setLocalMissing} />

      <SubDialogFooter
        onContinue={() => {
          onChange(local)
          onMissingChange(localMissing)
          onClose()
        }}
        onCancel={onClose}
      />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
//  Main dialog
// ─────────────────────────────────────────────────────────────

export function ReportSummariesDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [stats, setStats] = useState<SummaryStats>(DEFAULT_SUMMARY_STATS)
  const [options, setOptions] = useState<ReportOptions>(defaultOptions)
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
      titleKey: 'analysis:reportSummaries.statisticsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <SummaryStatisticsContent stats={stats} onChange={setStats} onClose={closeSub} />
      )
    },
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:reportSummaries.optionsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <OptionsContent
          options={options}
          onChange={setOptions}
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
        analysisId: 'reportSummaries',
        datasetId,
        scriptFile: 'report-summaries.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          breakVars: breaks.map(v => v.colId),
          breakVarNames: Object.fromEntries(breaks.map(v => [v.colId, v.name])),
          ...(breaks.length > 0 ? { breakValueLabels } : {}),
          displayCases: options.displayCases,
          grandTotal: options.grandTotal,
          // null means "no limit" to the R script; the input is only reachable
          // when cases are being listed at all.
          limitCases:
            options.displayCases && options.limitCases
              ? Math.max(1, Number(options.limitCasesN) || 100)
              : null,
          options: { missing, stats }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:reportSummaries.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'reportSummaries'}
      titleKey="analysis:reportSummaries.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.reportRows(a['variables'] ?? [], a['breakVars'] ?? [], {
          grandTotal: options.grandTotal,
          limitCases:
            options.displayCases && options.limitCases
              ? Math.max(1, Number(options.limitCasesN) || 100)
              : null,
          displayCases: options.displayCases,
          stats,
          missing
        })
      }
    />
  )
}
