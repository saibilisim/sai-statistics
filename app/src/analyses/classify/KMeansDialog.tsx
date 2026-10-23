// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K-Means Cluster dialog — SPSS-style.
 * Analyze → Classify → K-Means Cluster
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
import { buildSyntax } from '../../lib/spss-syntax'
import { NewVariablesPanel, type NewVarSlot } from '../../components/Dialogs/NewVariablesPanel'
import { cleanNewVarSelection, type NewVarSelection } from '@/lib/new-var-names'

/* Cluster membership exists to become the grouping variable of the NEXT
   analysis, which is why it is written back as a nominal column rather than
   left in the output table. Keys match requested_new_vars() in kmeans.R. */
const KMEANS_NEW_VARS: NewVarSlot[] = [
  { key: 'cluster', labelKey: 'analysis:kmeans.newVar.cluster', defaultName: 'qcl' },
  { key: 'distance', labelKey: 'analysis:kmeans.newVar.distance', defaultName: 'qcl_dist' }
]

export function KMeansDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [clusters, setClusters] = useState('2')
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
          slots={KMEANS_NEW_VARS}
          value={newVars}
          onChange={setNewVars}
          existingNames={existingNames}
          onClose={closeSub}
        />
      )
    }
  ]

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:kmeans.variablesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length >= 1 && Number(clusters) >= 2 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    await run(
      {
        analysisId: 'kmeans',
        datasetId,
        scriptFile: 'kmeans.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          clusters: Number(clusters) || 2,
          createVars: cleanNewVarSelection(newVars, existingNames)
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:kmeans.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'kmeans'}
      titleKey="analysis:kmeans.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a => buildSyntax.kmeans(a['variables'] ?? [], Number(clusters) || 2)}
      extraContent={
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {t('analysis:kmeans.clustersLabel')}
            <input
              type="number"
              min="2"
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
