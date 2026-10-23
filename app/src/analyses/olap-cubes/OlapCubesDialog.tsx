// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reports > OLAP Cubes (SPSS OLAP). Summary statistics of one or more scale
 * variables broken down by nested grouping variables, with the selectable
 * cell statistics of SPSS's OLAP Statistics sub-dialog.
 */

import { useState } from 'react'
import {
  AnalysisDialogShell,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { type MissingStrategy } from '../_shared/MissingValuesSection'
import { MissingValuesOptionsContent } from '../_shared/MissingValuesOptionsContent'
import { SummaryStatisticsContent } from '../_shared/SummaryStatisticsContent'
import { DEFAULT_OLAP_STATS, OLAP_STAT_GROUPS, type OlapStats } from '../_shared/summary-stats'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

export function OlapCubesDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  // The full SPSS cell menu (the shared Reports registry) plus OLAP's four
  // percentage cells. This dialog used to carry a hand-written list of nine; a
  // comparison against SPSS's own OLAP output, which prints twenty-three, found
  // Grouped Median, Std. Error of Mean, Range, First, Last, Variance, Kurtosis,
  // Skewness, their standard errors and the Harmonic/Geometric means all
  // missing here while the same statistics were already implemented one
  // directory away for Case Summaries.
  const [stats, setStats] = useState<OlapStats>(DEFAULT_OLAP_STATS)
  const [missing, setMissing] = useState<MissingStrategy>('analysis')
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:olapCubes.summaryVariablesField',
      single: false,
      // Every OLAP cell statistic is arithmetic, so a string variable has
      // nothing to contribute — SPSS refuses to accept one here at all. We used
      // to take it and print a row of N=0 / Sum=0 with the rest blank, which
      // reads as a real result rather than a rejected input. (Case Summaries is
      // different and still allows strings: SPSS reports their Minimum/Maximum/
      // First/Last there.)
      filter: (v: Variable) => v.type === 'numeric'
    },
    { key: 'groupVars', labelKey: 'analysis:olapCubes.groupingVariablesField', single: false }
  ]

  // A cube with nothing to break the cases down by is not an OLAP cube — it is
  // Descriptives with extra steps, and SPSS says so by keeping OK, Statistics
  // and Options all disabled until a grouping variable is transferred (its
  // OLAP CUBES syntax requires the BY clause outright). We used to allow it and
  // printed a single ungrouped row, which is the one shape of this output that
  // another SPSS procedure already covers better.
  const hasGroups = (a: Record<string, Variable[]>) => (a['groupVars'] ?? []).length > 0

  const sideButtons: SideButtonDef[] = [
    {
      key: 'statistics',
      labelKey: 'analysis:shell.btnStatistics',
      titleKey: 'analysis:olapCubes.statisticsTitle',
      disabled: a => !hasGroups(a),
      renderContent: ({ onClose: closeSub }) => (
        <SummaryStatisticsContent
          stats={stats}
          onChange={setStats}
          onClose={closeSub}
          groups={OLAP_STAT_GROUPS}
        />
      )
    },
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:olapCubes.optionsTitle',
      disabled: a => !hasGroups(a),
      renderContent: ({ onClose: closeSub }) => (
        <MissingValuesOptionsContent value={missing} onChange={setMissing} onClose={closeSub} />
      )
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length > 0 && hasGroups(a) && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    const groups = a['groupVars'] ?? []

    const groupValueLabels: Record<string, Record<string, string>> = {}
    for (const g of groups) {
      if (Object.keys(g.valueLabels).length > 0) {
        groupValueLabels[g.colId] = g.valueLabels
      }
    }

    await run(
      {
        analysisId: 'olapCubes',
        datasetId,
        scriptFile: 'olap-cubes.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          groupVars: groups.map(v => v.colId),
          groupVarNames: Object.fromEntries(groups.map(v => [v.colId, v.name])),
          ...(groups.length > 0 ? { groupValueLabels } : {}),
          options: { missing, stats }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:olapCubes.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'olapCubes'}
      titleKey="analysis:olapCubes.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        // SPSS's OLAP CUBES has no /MISSING keyword, so the dialog's listwise
        // option cannot travel through Paste (documented in the parity README).
        buildSyntax.olapCubes(a['variables'] ?? [], a['groupVars'] ?? [], { stats })
      }
    />
  )
}
