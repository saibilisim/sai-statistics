// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Factor Analysis dialog — SPSS-style (PCA extraction).
 * Analyze → Dimension Reduction → Factor
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  CheckOption,
  OptionSection,
  SubDialogFooter,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { NewVariablesPanel, type NewVarSlot } from '../../components/Dialogs/NewVariablesPanel'
import { cleanNewVarSelection, type NewVarSelection } from '@/lib/new-var-names'

/* Regression-method factor scores, one column per retained component. Three
   slots because the Kaiser criterion rarely retains more on the kind of data
   this dialog is used on; a run that retains fewer simply produces fewer
   columns (factor.R only fills the slots that exist). Keys match
   requested_new_vars() in factor.R. */
const FACTOR_NEW_VARS: NewVarSlot[] = [
  { key: 'score1', labelKey: 'analysis:factor.newVar.score1', defaultName: 'fac1' },
  { key: 'score2', labelKey: 'analysis:factor.newVar.score2', defaultName: 'fac2' },
  { key: 'score3', labelKey: 'analysis:factor.newVar.score3', defaultName: 'fac3' }
]
import { buildSyntax } from '../../lib/spss-syntax'

type Rotation = 'none' | 'varimax' | 'oblimin' | 'promax'

// ─────────────────────────────────────────────────────────────
//  Descriptives sub-dialog
// ─────────────────────────────────────────────────────────────

function DescriptivesContent({
  kmoBartlett,
  onChange,
  onClose
}: {
  kmoBartlett: boolean
  onChange: (v: boolean) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(kmoBartlett)

  return (
    <>
      <OptionSection>
        <CheckOption checked={local} onChange={setLocal}>
          {t('analysis:factor.kmoBartlett')}
        </CheckOption>
      </OptionSection>

      <SubDialogFooter
        onContinue={() => {
          onChange(local)
          onClose()
        }}
        onCancel={onClose}
      />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
//  Rotation sub-dialog
// ─────────────────────────────────────────────────────────────

function RotationContent({
  rotation,
  onChange,
  onClose
}: {
  rotation: Rotation
  onChange: (v: Rotation) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(rotation)

  const radio = (value: Rotation, labelKey: string) => (
    <label className={shellStyles.checkRow}>
      <input
        type="radio"
        checked={local === value}
        onChange={() => {
          setLocal(value)
        }}
      />
      {t(labelKey as never)}
    </label>
  )

  return (
    <>
      <OptionSection titleKey="analysis:factor.rotationTitle">
        {radio('none', 'analysis:factor.rotationNone')}
        {radio('varimax', 'analysis:factor.varimaxRotation')}
        {radio('oblimin', 'analysis:factor.oblimin')}
        {radio('promax', 'analysis:factor.promax')}
      </OptionSection>

      <SubDialogFooter
        onContinue={() => {
          onChange(local)
          onClose()
        }}
        onCancel={onClose}
      />
    </>
  )
}

export function FactorDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { running, run } = useRunAnalysis()
  const [rotation, setRotation] = useState<Rotation>('none')
  const [kmoBartlett, setKmoBartlett] = useState(false)
  const [newVars, setNewVars] = useState<NewVarSelection>({})
  const existingNames = useDatasetStore(s => s.variables).map(v => v.name)

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:factor.variablesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const sideButtons: SideButtonDef[] = [
    {
      key: 'descriptives',
      labelKey: 'analysis:shell.btnDescriptives',
      titleKey: 'analysis:factor.descriptivesTitle',
      renderContent: ({ onClose: closeSub }) => (
        <DescriptivesContent
          kmoBartlett={kmoBartlett}
          onChange={setKmoBartlett}
          onClose={closeSub}
        />
      )
    },
    {
      key: 'rotation',
      labelKey: 'analysis:shell.btnRotation',
      titleKey: 'analysis:factor.rotationTitle',
      renderContent: ({ onClose: closeSub }) => (
        <RotationContent rotation={rotation} onChange={setRotation} onClose={closeSub} />
      )
    },
    {
      key: 'newVars',
      labelKey: 'analysis:shell.btnNewVars',
      titleKey: 'analysis:newVars.title',
      renderContent: ({ onClose: closeSub }) => (
        <NewVariablesPanel
          slots={FACTOR_NEW_VARS}
          value={newVars}
          onChange={setNewVars}
          existingNames={existingNames}
          onClose={closeSub}
        />
      )
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length >= 2 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    await run(
      {
        analysisId: 'factor',
        datasetId,
        scriptFile: 'factor.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          options: { rotation, kmoBartlett },
          createVars: cleanNewVarSelection(newVars, existingNames)
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:factor.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'factor'}
      titleKey="analysis:factor.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.factorAnalysis(a['variables'] ?? [], { rotation, kmoBartlett })
      }
    />
  )
}
