// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Chi-Square goodness-of-fit dialog — SPSS-style.
 * Analyze → Nonparametric Tests → Chi-Square
 */

import { useState } from 'react'
import {
  AnalysisDialogShell,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import {
  PMethodSection,
  buildPMethodParams,
  defaultPMethodOptions,
  type PMethodOptions
} from '../_shared/PMethodSection'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

export function ChiSquareTestDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { running, run } = useRunAnalysis()
  const [pMethod, setPMethod] = useState<PMethodOptions>(defaultPMethodOptions)

  const fieldDefs = [{ key: 'variables', labelKey: 'analysis:nparChiSq.testField', single: false }]
  const canSubmit = (a: Record<string, Variable[]>) => (a['variables'] ?? []).length > 0 && !running

  // Science-over-SPSS (CLAUDE.md §11): offer a Monte Carlo p-value for the
  // goodness-of-fit χ² — the asymptotic p is unreliable with small expected
  // counts. Same shared "Exact..." panel as Crosstabs.
  const sideButtons: SideButtonDef[] = [
    {
      key: 'exact',
      labelKey: 'analysis:shell.btnExact',
      titleKey: 'analysis:common.pMethod.dialogTitle',
      renderContent: ({ onClose: closeSub }) => (
        <PMethodSection value={pMethod} onChange={setPMethod} onClose={closeSub} />
      )
    }
  ]

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    const pMethodParams = buildPMethodParams(pMethod)
    await run(
      {
        analysisId: 'nparChiSq',
        datasetId,
        scriptFile: 'npar-chisquare.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          ...(pMethodParams ? { options: { pMethod: pMethodParams } } : {})
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:nparChiSq.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'nparChiSq'}
      titleKey="analysis:nparChiSq.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.nparChiSquare(a['variables'] ?? [], buildPMethodParams(pMethod))
      }
    />
  )
}
