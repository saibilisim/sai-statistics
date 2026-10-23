// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Ordinal Regression dialog — SPSS-style (PLUM).
 * Analyze → Regression → Ordinal
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
import { defaultOrdinalSettings, validOrdinalSettings } from '@shared/ordinal-schema'
import { OrdinalPanel, type OrdinalPanelKind } from './OrdinalPanels'
import { ORDINAL_SAVE_SLOTS } from './ordinal-save-slots'

/* Keys match requested_new_vars() in regression-ordinal.R. The predicted
   category comes back as its own label and keeps the ORDINAL measure — it is
   ordered, and a later dialog filtering by measure should know that. */
const ORDINAL_NEW_VARS: NewVarSlot[] = ORDINAL_SAVE_SLOTS

export function OrdinalDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [newVars, setNewVars] = useState<NewVarSelection>({})
  const [settings, setSettings] = useState(() => structuredClone(defaultOrdinalSettings))
  const existingNames = useDatasetStore(s => s.variables).map(v => v.name)
  const { running, run } = useRunAnalysis()

  const sideButtons: SideButtonDef[] = [
    ...(['scale', 'output', 'options', 'location'] as OrdinalPanelKind[]).map(kind => ({
      key: kind,
      labelKey: `analysis:ordinal.extra.${kind}`,
      titleKey: `analysis:ordinal.extra.${kind}Title`,
      renderContent: ({
        onClose: closeSub,
        assignments
      }: {
        onClose: () => void
        assignments: Record<string, Variable[]>
      }) => (
        <OrdinalPanel
          kind={kind}
          value={settings}
          onChange={setSettings}
          onClose={closeSub}
          assignments={assignments}
          existingNames={existingNames}
          newVars={newVars}
          onNewVars={setNewVars}
        />
      )
    })),
    {
      key: 'newVars',
      labelKey: 'analysis:shell.btnNewVars',
      titleKey: 'analysis:newVars.title',
      renderContent: ({ onClose: closeSub }) => (
        <NewVariablesPanel
          slots={ORDINAL_NEW_VARS}
          value={newVars}
          onChange={setNewVars}
          existingNames={existingNames}
          onClose={closeSub}
        />
      )
    }
  ]

  const fieldDefs = [
    { key: 'dependent', labelKey: 'analysis:ordinal.dependentField', single: true },
    { key: 'factors', labelKey: 'analysis:ordinal.extra.factors', single: false },
    {
      key: 'covariates',
      labelKey: 'analysis:ordinal.covariatesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['dependent'] ?? []).length === 1 &&
    !running &&
    validOrdinalSettings(
      settings,
      [...(a.factors ?? []), ...(a.covariates ?? [])].map(v => v.colId)
    )

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const dep = (a['dependent'] ?? [])[0]
    const covs = a['covariates'] ?? []
    const factors = a['factors'] ?? []
    if (!dep) return
    await run(
      {
        analysisId: 'ordinal',
        datasetId,
        scriptFile: 'regression-ordinal.R',
        params: {
          dependent: dep.colId,
          dependentName: dep.label || dep.name,
          dependentValueLabels: dep.valueLabels,
          covariates: covs.map(v => v.colId),
          factors: factors.map(v => v.colId),
          settings,
          varNames: Object.fromEntries(
            [...factors, ...covs].map(v => [v.colId, v.label || v.name])
          ),
          createVars: cleanNewVarSelection(newVars, existingNames, ['estimatedProbabilities'])
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:ordinal.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'ordinal'}
      titleKey="analysis:ordinal.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.ordinal(
          a['dependent'] ?? [],
          a['covariates'] ?? [],
          a['factors'] ?? [],
          settings,
          cleanNewVarSelection(newVars, existingNames, ['estimatedProbabilities'])
        )
      }
    />
  )
}
