// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Curve Estimation dialog — SPSS-style.
 * Mirrors SPSS: Analyze → Regression → Curve Estimation
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  CheckOption,
  OptionSection,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'
import { NewVariablesPanel, type NewVarSlot } from '../../components/Dialogs/NewVariablesPanel'
import { cleanNewVarSelection, type NewVarSelection } from '@/lib/new-var-names'

export interface CurveModels {
  linear: boolean
  logarithmic: boolean
  inverse: boolean
  quadratic: boolean
  cubic: boolean
  power: boolean
  s: boolean
  growth: boolean
  exponential: boolean
  compound: boolean
  logistic: boolean
}

const DEFAULT_MODELS: CurveModels = {
  linear: true,
  logarithmic: false,
  inverse: false,
  quadratic: false,
  cubic: false,
  power: false,
  s: false,
  growth: false,
  exponential: false,
  compound: false,
  logistic: false
}

/* Keys match requested_new_vars() in regression-curve.R. One (dependent x
   model) combination produces one numbered column per stem — the same
   per-coefficient stem mechanism DfBeta already uses, repurposed here for
   "per curve fit" instead of "per coefficient". */
const CURVE_NEW_VARS: NewVarSlot[] = [
  {
    key: 'predicted',
    labelKey: 'analysis:curve.newVar.predicted',
    defaultName: 'fit',
    perCoefficient: true
  },
  {
    key: 'residual',
    labelKey: 'analysis:curve.newVar.residual',
    defaultName: 'err',
    perCoefficient: true
  },
  {
    key: 'lower',
    labelKey: 'analysis:curve.newVar.lower',
    defaultName: 'lcl',
    perCoefficient: true
  },
  {
    key: 'upper',
    labelKey: 'analysis:curve.newVar.upper',
    defaultName: 'ucl',
    perCoefficient: true
  }
]
const CURVE_STEMS = CURVE_NEW_VARS.map(s => s.key)

interface Props {
  onClose: () => void
}

export function CurveEstimationDialog({ onClose }: Props) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)

  const [models, setModels] = useState<CurveModels>(DEFAULT_MODELS)
  const [independentMode, setIndependentMode] = useState<'variable' | 'time'>('variable')
  const [includeConstant, setIncludeConstant] = useState(true)
  const [plotModels, setPlotModels] = useState(true)
  const [displayAnova, setDisplayAnova] = useState(false)
  const [upperBound, setUpperBound] = useState('')
  const [newVars, setNewVars] = useState<NewVarSelection>({})
  const existingNames = useDatasetStore(s => s.variables).map(v => v.name)
  const { running, run } = useRunAnalysis()

  const set = (key: keyof CurveModels, val: boolean) => {
    setModels(prev => ({ ...prev, [key]: val }))
  }

  const sideButtons: SideButtonDef[] = [
    {
      key: 'newVars',
      labelKey: 'analysis:shell.btnNewVars',
      titleKey: 'analysis:newVars.title',
      renderContent: ({ onClose: closeSub }) => (
        <NewVariablesPanel
          slots={CURVE_NEW_VARS}
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
      key: 'dependent',
      labelKey: 'analysis:curve.dependentField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    },
    {
      key: 'independent',
      labelKey: 'analysis:curve.independentField',
      single: true,
      filter: (v: Variable) => v.type === 'numeric'
    },
    { key: 'caseLabels', labelKey: 'analysis:curve.caseLabelsField', single: true }
  ]

  const anyModel = Object.values(models).some(Boolean)
  const upperBoundNum = Number(upperBound)
  const upperBoundOk =
    !models.logistic || (upperBound.trim() !== '' && Number.isFinite(upperBoundNum))

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['dependent'] ?? []).length > 0 &&
    (independentMode === 'time' || (a['independent'] ?? []).length === 1) &&
    anyModel &&
    upperBoundOk &&
    !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const deps = a['dependent'] ?? []
    const ind = (a['independent'] ?? [])[0]
    const caseLabels = (a['caseLabels'] ?? [])[0]
    if (deps.length === 0) return
    if (independentMode === 'variable' && !ind) return
    await run(
      {
        analysisId: 'curve',
        datasetId,
        scriptFile: 'regression-curve.R',
        params: {
          dependents: deps.map(v => v.colId),
          dependentNames: Object.fromEntries(deps.map(v => [v.colId, v.name])),
          independentMode,
          independent: independentMode === 'variable' ? (ind?.colId ?? null) : null,
          independentName: independentMode === 'variable' ? (ind?.name ?? null) : null,
          caseLabels: caseLabels?.colId ?? null,
          includeConstant,
          plotModels,
          displayAnova,
          models,
          logisticUpperBound: models.logistic ? upperBoundNum : null,
          createVars: cleanNewVarSelection(newVars, existingNames, CURVE_STEMS)
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:curve.title', assignments: a }
    )
  }

  const checkbox = (key: keyof CurveModels, labelKey: string) => (
    <CheckOption
      checked={models[key]}
      onChange={v => {
        set(key, v)
      }}
    >
      {t(labelKey as never)}
    </CheckOption>
  )

  return (
    <AnalysisDialogShell
      analysisId={'curve'}
      titleKey="analysis:curve.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.curveEstimation(a['dependent'] ?? [], a['independent'] ?? [], models, {
          independentMode,
          caseLabels: a['caseLabels'] ?? [],
          includeConstant,
          plotModels,
          displayAnova,
          logisticUpperBound: models.logistic ? upperBoundNum : undefined
        })
      }
      extraContent={
        <>
          <OptionSection titleKey="analysis:curve.independentField" grid={false}>
            <label className={shellStyles.checkRow}>
              <input
                type="radio"
                name="curve-indep-mode"
                checked={independentMode === 'variable'}
                onChange={() => {
                  setIndependentMode('variable')
                }}
              />
              {t('analysis:curve.independentVariable')}
            </label>
            <label className={shellStyles.checkRow}>
              <input
                type="radio"
                name="curve-indep-mode"
                checked={independentMode === 'time'}
                onChange={() => {
                  setIndependentMode('time')
                }}
              />
              {t('analysis:curve.independentTime')}
            </label>
          </OptionSection>

          <OptionSection titleKey="analysis:curve.models">
            {checkbox('linear', 'analysis:curve.linear')}
            {checkbox('logarithmic', 'analysis:curve.logarithmic')}
            {checkbox('inverse', 'analysis:curve.inverse')}
            {checkbox('quadratic', 'analysis:curve.quadratic')}
            {checkbox('cubic', 'analysis:curve.cubic')}
            {checkbox('power', 'analysis:curve.power')}
            {checkbox('compound', 'analysis:curve.compound')}
            {checkbox('s', 'analysis:curve.s')}
            {checkbox('growth', 'analysis:curve.growth')}
            <div className={shellStyles.checkRow}>
              {checkbox('logistic', 'analysis:curve.logistic')}
              <input
                type="number"
                placeholder={t('analysis:curve.upperBound')}
                disabled={!models.logistic}
                value={upperBound}
                onChange={e => {
                  setUpperBound(e.target.value)
                }}
                className="numField"
              />
            </div>
            {checkbox('exponential', 'analysis:curve.exponential')}
          </OptionSection>

          <OptionSection grid={false}>
            <CheckOption
              checked={includeConstant}
              onChange={v => {
                setIncludeConstant(v)
              }}
            >
              {t('analysis:curve.includeConstantOption')}
            </CheckOption>
            <CheckOption
              checked={plotModels}
              onChange={v => {
                setPlotModels(v)
              }}
            >
              {t('analysis:curve.plotModelsOption')}
            </CheckOption>
            <CheckOption
              checked={displayAnova}
              onChange={v => {
                setDisplayAnova(v)
              }}
            >
              {t('analysis:curve.displayAnovaOption')}
            </CheckOption>
          </OptionSection>
        </>
      }
    />
  )
}
