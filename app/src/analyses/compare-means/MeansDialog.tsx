// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Means (group breakdown) dialog — SPSS-style.
 * Analyze → Compare Means → Means
 */

import { useState } from 'react'
import {
  AnalysisDialogShell,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { SummaryStatisticsContent } from '../_shared/SummaryStatisticsContent'
import { DEFAULT_SUMMARY_STATS, type SummaryStats } from '../_shared/summary-stats'
import { type MissingStrategy } from '../_shared/MissingValuesSection'
import { MissingValuesOptionsContent } from '../_shared/MissingValuesOptionsContent'
import {
  BootstrapSection,
  buildBootstrapParams,
  defaultBootstrapOptions,
  type BootstrapOptions
} from '../_shared/BootstrapSection'
import { buildSyntax } from '../../lib/spss-syntax'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'

export function MeansDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [missing, setMissing] = useState<MissingStrategy>('analysis')
  const [bootstrap, setBootstrap] = useState<BootstrapOptions>(defaultBootstrapOptions)
  // SPSS's Cells sub-dialog. The menu is the same one the Reports procedures
  // offer, so it comes from the same shared list rather than a second copy
  // that would drift in wording and order — see _shared/summary-stats.ts.
  // Defaults to Mean / N / Std. Deviation, which is what MEANS printed before
  // the sub-dialog existed.
  const [cells, setCells] = useState<SummaryStats>(DEFAULT_SUMMARY_STATS)
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'dependent',
      labelKey: 'analysis:means.dependentField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric',
      sortMeasure: 'scale' as const,
      roleHint: 'target' as const
    },
    {
      key: 'factor',
      labelKey: 'analysis:means.independentField',
      single: true
    }
  ]
  const sideButtons: SideButtonDef[] = [
    {
      key: 'cells',
      labelKey: 'analysis:means.btnCells',
      titleKey: 'analysis:means.cellsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <SummaryStatisticsContent stats={cells} onChange={setCells} onClose={closeSub} />
      )
    },
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:means.optionsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <MissingValuesOptionsContent value={missing} onChange={setMissing} onClose={closeSub} />
      )
    },
    {
      key: 'bootstrap',
      labelKey: 'analysis:shell.btnBootstrap',
      titleKey: 'analysis:shell.btnBootstrap',
      renderContent: ({ onClose: closeSub }) => (
        <BootstrapSection value={bootstrap} onChange={setBootstrap} onClose={closeSub} />
      )
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['dependent'] ?? []).length > 0 && (a['factor'] ?? []).length === 1 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const deps = a['dependent'] ?? []
    const f = (a['factor'] ?? [])[0]
    if (!f) return
    const bootstrapParams = buildBootstrapParams(bootstrap)
    await run(
      {
        analysisId: 'means',
        datasetId,
        scriptFile: 'means.R',
        params: {
          variables: deps.map(v => v.colId),
          varNames: Object.fromEntries(deps.map(v => [v.colId, v.name])),
          factor: f.colId,
          factorName: f.name,
          factorValueLabels: f.valueLabels,
          options: {
            missing,
            cells,
            ...(bootstrapParams ? { bootstrap: bootstrapParams } : {})
          }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:means.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'means'}
      titleKey="analysis:means.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      generateSyntax={a =>
        buildSyntax.means(a['dependent'] ?? [], a['factor'] ?? [], missing, cells)
      }
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
    />
  )
}
