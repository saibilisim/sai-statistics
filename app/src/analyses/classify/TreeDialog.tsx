// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Decision Tree dialog — SPSS-style (CRT growing method via rpart).
 * Analyze → Classify → Tree
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

/* Keys match requested_new_vars() in tree.R. The terminal node id is the one
   people actually re-use: it turns the tree into a segmentation you can group
   by, which no table can do. */
const TREE_NEW_VARS: NewVarSlot[] = [
  { key: 'predictedGroup', labelKey: 'analysis:tree.newVar.predictedGroup', defaultName: 'pgr' },
  { key: 'probability', labelKey: 'analysis:tree.newVar.probability', defaultName: 'pre' },
  { key: 'node', labelKey: 'analysis:tree.newVar.node', defaultName: 'nod' }
]
import { buildSyntax } from '../../lib/spss-syntax'

export function TreeDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [minCases, setMinCases] = useState('20')
  const [maxDepth, setMaxDepth] = useState('5')
  const [newVars, setNewVars] = useState<NewVarSelection>({})
  const existingNames = useDatasetStore(s => s.variables).map(v => v.name)

  const sideButtons: SideButtonDef[] = [
    {
      key: 'newVars',
      labelKey: 'analysis:shell.btnNewVars',
      titleKey: 'analysis:newVars.title',
      renderContent: ({ onClose: closeSub }) => (
        <NewVariablesPanel
          slots={TREE_NEW_VARS}
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
    { key: 'group', labelKey: 'analysis:tree.groupField', single: true },
    {
      key: 'independents',
      labelKey: 'analysis:tree.independentsField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['group'] ?? []).length === 1 &&
    (a['independents'] ?? []).length > 0 &&
    Number(minCases) >= 2 &&
    Number(maxDepth) >= 1 &&
    !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const g = (a['group'] ?? [])[0]
    const indeps = a['independents'] ?? []
    if (!g) return
    await run(
      {
        analysisId: 'tree',
        datasetId,
        scriptFile: 'tree.R',
        params: {
          groupVar: g.colId,
          groupName: g.label || g.name,
          groupValueLabels: g.valueLabels,
          independents: indeps.map(v => v.colId),
          // NOTE: predictor names stay v.name (not label) — tree.R uses
          // these as literal data.frame column names / rpart formula terms
          // (backtick-quoted), which requires the app's guaranteed-unique,
          // guaranteed-valid-identifier variable Name, not the free-text
          // Label (which can collide or contain characters that read oddly
          // in a split-rule string).
          varNames: Object.fromEntries(indeps.map(v => [v.colId, v.name])),
          createVars: cleanNewVarSelection(newVars, existingNames),
          options: { minCases: Number(minCases) || 20, maxDepth: Number(maxDepth) || 5 }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:tree.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'tree'}
      titleKey="analysis:tree.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.tree(a['group'] ?? [], a['independents'] ?? [], {
          minCases: Number(minCases) || 20,
          maxDepth: Number(maxDepth) || 5
        })
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {t('analysis:tree.minCasesLabel')}
            <input
              type="number"
              min="2"
              value={minCases}
              onChange={e => {
                setMinCases(e.target.value)
              }}
              className="numField--sm"
            />
          </label>
          <label className={shellStyles.checkRow}>
            {t('analysis:tree.maxDepthLabel')}
            <input
              type="number"
              min="1"
              value={maxDepth}
              onChange={e => {
                setMaxDepth(e.target.value)
              }}
              className="numField--sm"
            />
          </label>
        </div>
      }
    />
  )
}
