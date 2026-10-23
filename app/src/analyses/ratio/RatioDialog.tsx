// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Ratio Statistics dialog — SPSS Descriptive Statistics → Ratio.
 * Analyze → Descriptive Statistics → Ratio
 */

import { AnalysisDialogShell } from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

export function RatioDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'numerator',
      labelKey: 'analysis:ratio.numeratorField',
      single: true,
      filter: (v: Variable) => v.type === 'numeric'
    },
    {
      key: 'denominator',
      labelKey: 'analysis:ratio.denominatorField',
      single: true,
      filter: (v: Variable) => v.type === 'numeric'
    },
    {
      key: 'group',
      labelKey: 'analysis:ratio.groupField',
      single: true
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['numerator'] ?? []).length === 1 && (a['denominator'] ?? []).length === 1 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const num = (a['numerator'] ?? [])[0]
    const den = (a['denominator'] ?? [])[0]
    const grp = (a['group'] ?? [])[0]
    if (!num || !den) return
    await run(
      {
        analysisId: 'ratio',
        datasetId,
        scriptFile: 'ratio.R',
        params: {
          numerator: num.colId,
          denominator: den.colId,
          group: grp ? grp.colId : null
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:ratio.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'ratio'}
      titleKey="analysis:ratio.title"
      fieldDefs={fieldDefs}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.ratio(a['numerator'] ?? [], a['denominator'] ?? [], a['group'] ?? [])
      }
    />
  )
}
