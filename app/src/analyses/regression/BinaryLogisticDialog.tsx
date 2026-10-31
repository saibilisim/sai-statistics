// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Binary Logistic Regression dialog — SPSS-style.
 * Mirrors SPSS: Analyze → Regression → Binary Logistic
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
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'
import { NewVariablesPanel, type NewVarSlot } from '../../components/Dialogs/NewVariablesPanel'
import { cleanNewVarSelection, type NewVarSelection } from '@/lib/new-var-names'
import type { LogisticOptions } from '@shared/logistic-types'
import { defaultLogisticOptions } from '@shared/logistic-types'

/* Keys match requested_new_vars() in regression-logistic.R. The predicted
   group comes back as the ORIGINAL category label rather than 0/1, so it can
   be crosstabbed against the real outcome without decoding. */
const LOGISTIC_NEW_VARS: NewVarSlot[] = [
  { key: 'probability', labelKey: 'analysis:logistic.newVar.probability', defaultName: 'pre' },
  {
    key: 'predictedGroup',
    labelKey: 'analysis:logistic.newVar.predictedGroup',
    defaultName: 'pgr'
  },
  { key: 'residual', labelKey: 'analysis:logistic.newVar.residual', defaultName: 'res' },
  { key: 'logit', labelKey: 'analysis:logistic.newVar.logit', defaultName: 'lres' },
  {
    key: 'standardized',
    labelKey: 'analysis:logistic.newVar.standardized',
    defaultName: 'zre'
  },
  {
    key: 'studentized',
    labelKey: 'analysis:logistic.newVar.studentized',
    defaultName: 'sre'
  },
  { key: 'deviance', labelKey: 'analysis:logistic.newVar.deviance', defaultName: 'dev' },
  { key: 'leverage', labelKey: 'analysis:logistic.newVar.leverage', defaultName: 'lev' },
  { key: 'cooks', labelKey: 'analysis:logistic.newVar.cooks', defaultName: 'coo' },
  {
    key: 'dfbeta',
    labelKey: 'analysis:logistic.newVar.dfbeta',
    defaultName: 'dfb',
    perCoefficient: true
  }
]
const LOGISTIC_STEMS = LOGISTIC_NEW_VARS.filter(s => s.perCoefficient === true).map(s => s.key)

function OptionsContent({
  opts,
  onChange,
  onClose
}: {
  opts: LogisticOptions
  onChange: (o: LogisticOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(opts)

  return (
    <>
      <OptionSection titleKey="analysis:logistic.statisticsAndPlots">
        <CheckOption
          checked={local.classificationPlots}
          onChange={v => {
            setLocal(o => ({ ...o, classificationPlots: v }))
          }}
        >
          {t('analysis:logistic.classificationPlotsOption')}
        </CheckOption>
        <CheckOption
          checked={local.hosmerLemeshow}
          onChange={v => {
            setLocal(o => ({ ...o, hosmerLemeshow: v }))
          }}
        >
          {t('analysis:logistic.hosmerLemeshowOption')}
        </CheckOption>
        <CheckOption
          checked={local.correlation}
          onChange={v => {
            setLocal(o => ({ ...o, correlation: v }))
          }}
        >
          {t('analysis:logistic.correlationOfEstimates')}
        </CheckOption>
        <CheckOption
          checked={local.iterationHistory}
          onChange={v => {
            setLocal(o => ({ ...o, iterationHistory: v }))
          }}
        >
          {t('analysis:logistic.iterationHistoryOption')}
        </CheckOption>
        <label className={shellStyles.checkRow}>
          <input
            type="checkbox"
            checked={local.ciExpB}
            onChange={e => {
              setLocal(o => ({ ...o, ciExpB: e.target.checked }))
            }}
          />
          {t('analysis:logistic.ciForExpB')}
          <input
            type="number"
            step="1"
            value={local.ciLevel}
            onChange={e => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) setLocal(o => ({ ...o, ciLevel: n }))
            }}
            className="numField"
          />
          %
        </label>
      </OptionSection>

      <OptionSection titleKey="analysis:logistic.casewiseListingOption" grid={false}>
        <CheckOption
          checked={local.casewiseListing}
          onChange={v => {
            setLocal(o => ({ ...o, casewiseListing: v }))
          }}
        >
          {t('analysis:logistic.casewiseListingOption')}
        </CheckOption>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="logistic-casewise"
            checked={local.casewiseOutliersOnly}
            disabled={!local.casewiseListing}
            onChange={() => {
              setLocal(o => ({ ...o, casewiseOutliersOnly: true }))
            }}
          />
          {t('analysis:logistic.casewiseOutliers')}
          <input
            type="number"
            step="1"
            min="0"
            value={local.casewiseThreshold}
            disabled={!local.casewiseListing || !local.casewiseOutliersOnly}
            onChange={e => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) setLocal(o => ({ ...o, casewiseThreshold: n }))
            }}
            className="numField"
          />
          {t('analysis:logistic.casewiseStdDev')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="logistic-casewise"
            checked={!local.casewiseOutliersOnly}
            disabled={!local.casewiseListing}
            onChange={() => {
              setLocal(o => ({ ...o, casewiseOutliersOnly: false }))
            }}
          />
          {t('analysis:logistic.casewiseAllCases')}
        </label>
      </OptionSection>

      <OptionSection grid={false}>
        <label className={shellStyles.checkRow}>
          {t('analysis:logistic.classificationCutoff')}
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={local.classificationCutoff}
            onChange={e => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) setLocal(o => ({ ...o, classificationCutoff: n }))
            }}
            className="numField"
          />
        </label>
        <label className={shellStyles.checkRow}>
          {t('analysis:logistic.maxIterations')}
          <input
            type="number"
            step="1"
            min="1"
            value={local.maxIterations}
            onChange={e => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) setLocal(o => ({ ...o, maxIterations: n }))
            }}
            className="numField"
          />
        </label>
        <CheckOption
          checked={local.includeConstant}
          onChange={v => {
            setLocal(o => ({ ...o, includeConstant: v }))
          }}
        >
          {t('analysis:logistic.includeConstantOption')}
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

interface Props {
  onClose: () => void
}

export function BinaryLogisticDialog({ onClose }: Props) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)

  const [newVars, setNewVars] = useState<NewVarSelection>({})
  const [opts, setOpts] = useState<LogisticOptions>(defaultLogisticOptions)
  const existingNames = useDatasetStore(s => s.variables).map(v => v.name)
  const { running, run } = useRunAnalysis()

  const sideButtons: SideButtonDef[] = [
    {
      key: 'newVars',
      labelKey: 'analysis:shell.btnNewVars',
      titleKey: 'analysis:newVars.title',
      renderContent: ({ onClose: closeSub }) => (
        <NewVariablesPanel
          slots={LOGISTIC_NEW_VARS}
          value={newVars}
          onChange={setNewVars}
          existingNames={existingNames}
          onClose={closeSub}
        />
      )
    },
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:logistic.optionsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <OptionsContent opts={opts} onChange={setOpts} onClose={closeSub} />
      )
    }
  ]

  const fieldDefs = [
    { key: 'dependent', labelKey: 'analysis:logistic.dependentField', single: true },
    {
      key: 'covariates',
      labelKey: 'analysis:logistic.covariatesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['dependent'] ?? []).length === 1 && (a['covariates'] ?? []).length > 0 && !running

  const generateRCode = (a: Record<string, Variable[]>) => {
    const dep = (a['dependent'] ?? [])[0]?.name
    const covs = (a['covariates'] ?? []).map(v => v.name)
    if (!dep || covs.length === 0) return null
    const rhs = covs.map(c => `\`${c}\``).join(' + ')
    return [
      `fit <- glm(\`${dep}\` ~ ${opts.includeConstant ? rhs : `0 + ${rhs}`}, data = data, family = binomial(), control = glm.control(maxit = ${String(opts.maxIterations)}))`,
      'print(summary(fit))'
    ].join('\n')
  }

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const dep = (a['dependent'] ?? [])[0]
    const covs = a['covariates'] ?? []
    if (!dep) return
    await run(
      {
        analysisId: 'logistic',
        datasetId,
        scriptFile: 'regression-logistic.R',
        params: {
          dependent: dep.colId,
          dependentName: dep.name,
          covariates: covs.map(v => v.colId),
          varNames: Object.fromEntries([dep, ...covs].map(v => [v.colId, v.name])),
          options: opts,
          createVars: cleanNewVarSelection(newVars, existingNames, LOGISTIC_STEMS)
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:logistic.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'logistic'}
      titleKey="analysis:logistic.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.binaryLogistic(a['dependent'] ?? [], a['covariates'] ?? [], opts)
      }
      generateRCode={generateRCode}
    />
  )
}
