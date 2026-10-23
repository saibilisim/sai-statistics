// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Partial Correlations dialog — SPSS-style.
 * Mirrors SPSS: Analyze → Correlate → Partial
 */

import { useState } from 'react'
import {
  AnalysisDialogShell,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import {
  BootstrapSection,
  buildBootstrapParams,
  defaultBootstrapOptions,
  type BootstrapOptions
} from '../_shared/BootstrapSection'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

interface Props {
  onClose: () => void
}

export function PartialCorrelationDialog({ onClose }: Props) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)

  const [bootstrap, setBootstrap] = useState<BootstrapOptions>(defaultBootstrapOptions)

  const sideButtons: SideButtonDef[] = [
    {
      key: 'bootstrap',
      labelKey: 'analysis:shell.btnBootstrap',
      titleKey: 'analysis:shell.btnBootstrap',
      renderContent: ({ onClose: closeSub }) => (
        <BootstrapSection value={bootstrap} onChange={setBootstrap} onClose={closeSub} />
      )
    }
  ]
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:partialCorr.variablesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric',
      sortMeasure: 'scale' as const
    },
    {
      key: 'controls',
      labelKey: 'analysis:partialCorr.controlsField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length >= 2 && (a['controls'] ?? []).length > 0 && !running

  const generateRCode = (a: Record<string, Variable[]>) => {
    const vars = (a['variables'] ?? []).map(v => v.name)
    const ctrls = (a['controls'] ?? []).map(v => v.name)
    if (vars.length < 2 || ctrls.length === 0) return null
    return [
      '# SAI Statistics — Partial Correlations',
      `# variables: ${vars.join(', ')}`,
      `# controlling for: ${ctrls.join(', ')}`,
      '# (residualize each variable on the controls, then correlate residuals)'
    ].join('\n')
  }

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    const ctrls = a['controls'] ?? []
    const bootstrapParams = buildBootstrapParams(bootstrap)
    await run(
      {
        analysisId: 'partialCorr',
        datasetId,
        scriptFile: 'correlation-partial.R',
        params: {
          variables: vars.map(v => v.colId),
          controls: ctrls.map(v => v.colId),
          varNames: Object.fromEntries([...vars, ...ctrls].map(v => [v.colId, v.name])),
          ...(bootstrapParams ? { options: { bootstrap: bootstrapParams } } : {})
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:partialCorr.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'partialCorr'}
      titleKey="analysis:partialCorr.title"
      fieldDefs={fieldDefs}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a => buildSyntax.partialCorr(a['variables'] ?? [], a['controls'] ?? [])}
      generateRCode={generateRCode}
      sideButtons={sideButtons}
    />
  )
}
