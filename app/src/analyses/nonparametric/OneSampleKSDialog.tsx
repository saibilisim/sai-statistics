// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One-Sample Kolmogorov-Smirnov dialog — SPSS-style.
 * Analyze → Nonparametric Tests → 1-Sample K-S
 */

import { useState } from 'react'
import {
  AnalysisDialogShell,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { NparOneSampleOptionsContent } from './NparOneSampleOptionsContent'
import { defaultNparOneSampleOptions, type NparOneSampleOptions } from './npar-options'
import { buildSyntax } from '../../lib/spss-syntax'

export function OneSampleKSDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [nparOpts, setNparOpts] = useState<NparOneSampleOptions>(defaultNparOneSampleOptions)
  const { running, run } = useRunAnalysis()

  const sideButtons: SideButtonDef[] = [
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:nparKS.optionsTitleDlg',
      renderContent: ({ onClose: closeSub }) => (
        <NparOneSampleOptionsContent value={nparOpts} onChange={setNparOpts} onClose={closeSub} />
      )
    }
  ]

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:nparKS.testField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) => (a['variables'] ?? []).length > 0 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    await run(
      {
        analysisId: 'nparKS',
        datasetId,
        scriptFile: 'npar-ks.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          dist: 'normal',
          options: nparOpts
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:nparKS.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'nparKS'}
      titleKey="analysis:nparKS.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      // The dialog offers no distribution choice yet; the payload is fixed to
      // normal, so the pasted command says so explicitly.
      generateSyntax={a => buildSyntax.nparKs(a['variables'] ?? [], 'normal')}
    />
  )
}
