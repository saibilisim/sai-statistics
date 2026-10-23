// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Hierarchical Cluster dialog — SPSS-style.
 * Analyze → Classify → Hierarchical Cluster
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { NewVariablesPanel, type NewVarSlot } from '../../components/Dialogs/NewVariablesPanel'
import { cleanNewVarSelection, type NewVarSelection } from '@/lib/new-var-names'

/* Keys match requested_new_vars() in hierarchical.R. Membership only exists
   once a cut has been chosen ("Number of clusters" >= 2); without one the run
   reports honestly that it produced no columns rather than picking a k. */
const HIERARCHICAL_NEW_VARS: NewVarSlot[] = [
  { key: 'cluster', labelKey: 'analysis:hier.newVar.cluster', defaultName: 'clu' }
]
import { buildSyntax } from '../../lib/spss-syntax'

type Method = 'ward.D2' | 'average' | 'complete' | 'single'

export function HierarchicalDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [method, setMethod] = useState<Method>('ward.D2')
  const [clusters, setClusters] = useState('0')
  const [newVars, setNewVars] = useState<NewVarSelection>({})
  const existingNames = useDatasetStore(s => s.variables).map(v => v.name)

  const sideButtons: SideButtonDef[] = [
    {
      key: 'newVars',
      labelKey: 'analysis:shell.btnNewVars',
      titleKey: 'analysis:newVars.title',
      renderContent: ({ onClose: closeSub }) => (
        <NewVariablesPanel
          slots={HIERARCHICAL_NEW_VARS}
          value={newVars}
          onChange={setNewVars}
          existingNames={existingNames}
          onClose={closeSub}
        />
      )
    }
  ]
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:hier.variablesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length >= 1 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    await run(
      {
        analysisId: 'hier',
        datasetId,
        scriptFile: 'hierarchical.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          createVars: cleanNewVarSelection(newVars, existingNames),
          method,
          clusters: Number(clusters) || 0
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:hier.title', assignments: a }
    )
  }

  const radio = (val: Method, labelKey: string) => (
    <label className={shellStyles.checkRow}>
      <input
        type="radio"
        checked={method === val}
        onChange={() => {
          setMethod(val)
        }}
      />
      {t(labelKey as never)}
    </label>
  )

  return (
    <AnalysisDialogShell
      analysisId={'hier'}
      titleKey="analysis:hier.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a => buildSyntax.hierarchical(a['variables'] ?? [], method)}
      extraContent={
        <div className={shellStyles.optionSection}>
          <div className={shellStyles.optionSectionTitle}>{t('analysis:hier.method')}</div>
          <div className={shellStyles.optionGrid}>
            {radio('ward.D2', 'analysis:hier.ward')}
            {radio('average', 'analysis:hier.average')}
            {radio('complete', 'analysis:hier.complete')}
            {radio('single', 'analysis:hier.single')}
          </div>
          <label className={shellStyles.checkRow}>
            {t('analysis:hier.clustersLabel')}
            <input
              type="number"
              min="0"
              value={clusters}
              onChange={e => {
                setClusters(e.target.value)
              }}
              className="numField--sm"
            />
          </label>
        </div>
      }
    />
  )
}
