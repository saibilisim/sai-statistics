// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Multinomial Logistic Regression dialog — SPSS-style.
 * Analyze → Regression → Multinomial Logistic
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
import { MultinomialPanel, type MultinomialPanelKind } from './MultinomialPanels'
import { defaultMultinomialSettings } from '@shared/multinomial-types'
import { validMultinomialSettings, validMultinomialTerms } from '@/lib/multinomial-settings'
import { cleanNewVarSelection, type NewVarSelection } from '@/lib/new-var-names'

export function MultinomialDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [newVars, setNewVars] = useState<NewVarSelection>({})
  const variables = useDatasetStore(s => s.variables)
  const existingNames = variables.map(v => v.name)
  const [settings, setSettings] = useState(() => structuredClone(defaultMultinomialSettings))
  const { running, run } = useRunAnalysis()

  const sideButtons: SideButtonDef[] = (
    ['reference', 'save', 'model', 'options', 'criteria', 'statistics'] as MultinomialPanelKind[]
  ).map(kind => ({
    key: kind,
    labelKey: `analysis:multinom.extra.${kind}`,
    titleKey: `analysis:multinom.extra.${kind}`,
    width: 'calc(var(--space-xl) * 27)',
    renderContent: ({ onClose: closeSub, assignments }) => (
      <MultinomialPanel
        kind={kind}
        value={settings}
        onChange={setSettings}
        onClose={closeSub}
        assignments={assignments}
        variables={variables}
        newVars={newVars}
        onNewVars={setNewVars}
      />
    )
  }))

  const fieldDefs = [
    { key: 'dependent', labelKey: 'analysis:multinom.dependentField', single: true },
    { key: 'factors', labelKey: 'analysis:multinom.extra.factorsField', single: false },
    {
      key: 'covariates',
      labelKey: 'analysis:multinom.covariatesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['dependent'] ?? []).length === 1 &&
    !running &&
    validMultinomialSettings(settings) &&
    validMultinomialTerms(
      settings.model,
      [...(a.factors ?? []), ...(a.covariates ?? [])].map(v => v.colId)
    )

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const dep = (a['dependent'] ?? [])[0]
    const covs = a['covariates'] ?? []
    const factors = a.factors ?? []
    if (!dep) return
    await run(
      {
        analysisId: 'multinom',
        datasetId,
        scriptFile: 'regression-multinomial.R',
        params: {
          ...settings,
          dependent: dep.colId,
          factors: factors.map(v => v.colId),
          sourceNames: Object.fromEntries([dep, ...factors, ...covs].map(v => [v.colId, v.name])),
          dependentName: dep.label || dep.name,
          dependentValueLabels: dep.valueLabels,
          covariates: covs.map(v => v.colId),
          varNames: Object.fromEntries(
            [...factors, ...covs].map(v => [v.colId, v.label || v.name])
          ),
          createVars: cleanNewVarSelection(newVars, existingNames, ['estimatedProbabilities'])
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:multinom.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'multinom'}
      titleKey="analysis:multinom.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setSettings(structuredClone(defaultMultinomialSettings))
        setNewVars({})
      }}
      generateSyntax={a =>
        buildSyntax.multinomial(
          a['dependent'] ?? [],
          a['covariates'] ?? [],
          a.factors ?? [],
          settings,
          newVars,
          variables
        )
      }
    />
  )
}
