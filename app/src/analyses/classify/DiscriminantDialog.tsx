// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Discriminant Analysis dialog — SPSS-style.
 * Analyze → Classify → Discriminant
 */

import { useState } from 'react'
import {
  AnalysisDialogShell,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'
import { NewVariablesPanel, type NewVarSlot } from '../../components/Dialogs/NewVariablesPanel'
import { cleanNewVarSelection, type NewVarSelection } from '@/lib/new-var-names'

/* Two discriminant functions are offered because that covers three groups —
   past that the analysis reports more functions than the panel names, and a
   variable-length slot list needs its own naming scheme (same reason Cox's
   DfBeta is still out). Keys match requested_new_vars() in discriminant.R. */
const DISCRIMINANT_NEW_VARS: NewVarSlot[] = [
  {
    key: 'predictedGroup',
    labelKey: 'analysis:discriminant.newVar.predictedGroup',
    defaultName: 'dis_pred'
  },
  { key: 'score1', labelKey: 'analysis:discriminant.newVar.score1', defaultName: 'dis1' },
  { key: 'score2', labelKey: 'analysis:discriminant.newVar.score2', defaultName: 'dis2' }
]

export function DiscriminantDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [newVars, setNewVars] = useState<NewVarSelection>({})
  const existingNames = useDatasetStore(s => s.variables).map(v => v.name)
  const { running, run } = useRunAnalysis()

  const sideButtons: SideButtonDef[] = [
    {
      key: 'newVars',
      labelKey: 'analysis:shell.btnNewVars',
      titleKey: 'analysis:newVars.title',
      renderContent: ({ onClose: closeSub }: { onClose: () => void }) => (
        <NewVariablesPanel
          slots={DISCRIMINANT_NEW_VARS}
          value={newVars}
          onChange={setNewVars}
          existingNames={existingNames}
          onClose={closeSub}
        />
      )
    }
  ]

  const fieldDefs = [
    { key: 'group', labelKey: 'analysis:discriminant.groupField', single: true },
    {
      key: 'independents',
      labelKey: 'analysis:discriminant.independentsField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['group'] ?? []).length === 1 && (a['independents'] ?? []).length > 0 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const g = (a['group'] ?? [])[0]
    const indeps = a['independents'] ?? []
    if (!g) return
    await run(
      {
        analysisId: 'discriminant',
        datasetId,
        scriptFile: 'discriminant.R',
        params: {
          groupVar: g.colId,
          groupName: g.name,
          independents: indeps.map(v => v.colId),
          varNames: Object.fromEntries(indeps.map(v => [v.colId, v.name])),
          createVars: cleanNewVarSelection(newVars, existingNames)
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:discriminant.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'discriminant'}
      titleKey="analysis:discriminant.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a => buildSyntax.discriminant(a['group'] ?? [], a['independents'] ?? [])}
    />
  )
}
