// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Linear Regression dialog — SPSS-style (OLS).
 * Mirrors SPSS: Analyze → Regression → Linear
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
import { PackageNeededDialog } from '../../components/Dialogs/PackageNeededDialog'
import { usePackageGate } from '../../lib/use-package-gate'
import { cx } from '../../lib/cx'
import { bayesRscale, defaultBayesPrior, type BayesPrior } from '../_bayes/BayesPriorSection'
import { BayesPriorOptionsContent } from '../_bayes/BayesPriorOptions'
import {
  BootstrapSection,
  buildBootstrapParams,
  defaultBootstrapOptions,
  type BootstrapOptions
} from '../_shared/BootstrapSection'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { buildSyntax } from '../../lib/spss-syntax'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { NewVariablesPanel, type NewVarSlot } from '../../components/Dialogs/NewVariablesPanel'
import { cleanNewVarSelection, type NewVarSelection } from '@/lib/new-var-names'
import {
  REGRESSION_PLOT_TOKENS,
  defaultRegressionOptions,
  type RegressionMethod,
  type RegressionOptions,
  type RegressionPlotToken
} from '@shared/regression-types'

const REGRESSION_METHODS: RegressionMethod[] = ['enter', 'forward', 'backward', 'stepwise']

/* Per-case regression output. Keys match requested_new_vars() in
   regression-linear.R. The three residual scalings are kept distinct because
   they answer different questions: standardized rescales by the model's own s,
   studentized also divides out the case's leverage, and deleted refits without
   the case — which is the one that actually exposes an outlier that is holding
   the line in place. */
const REGRESSION_NEW_VARS: NewVarSlot[] = [
  { key: 'predicted', labelKey: 'analysis:regression.newVar.predicted', defaultName: 'pre' },
  { key: 'residual', labelKey: 'analysis:regression.newVar.residual', defaultName: 'res' },
  { key: 'standardized', labelKey: 'analysis:regression.newVar.standardized', defaultName: 'zre' },
  { key: 'studentized', labelKey: 'analysis:regression.newVar.studentized', defaultName: 'sre' },
  { key: 'deleted', labelKey: 'analysis:regression.newVar.deleted', defaultName: 'sdr' },
  { key: 'leverage', labelKey: 'analysis:regression.newVar.leverage', defaultName: 'lev' },
  { key: 'cooks', labelKey: 'analysis:regression.newVar.cooks', defaultName: 'coo' },
  { key: 'mahalanobis', labelKey: 'analysis:regression.newVar.mahalanobis', defaultName: 'mah' },
  // One column per coefficient — the name is a stem, suffixed 1, 2, 3…
  {
    key: 'dfbeta',
    labelKey: 'analysis:regression.newVar.dfbeta',
    defaultName: 'dfb',
    perCoefficient: true
  },
  {
    key: 'partial',
    labelKey: 'analysis:regression.newVar.partial',
    defaultName: 'par',
    perCoefficient: true
  }
]
const REGRESSION_STEMS = REGRESSION_NEW_VARS.filter(s => s.perCoefficient === true).map(s => s.key)

interface Props {
  onClose: () => void
  bayesian?: boolean
}

function StatisticsContent({
  opts,
  onChange,
  onClose
}: {
  opts: RegressionOptions
  onChange: (o: RegressionOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(opts)

  return (
    <>
      <OptionSection grid={false}>
        <label className={shellStyles.checkRow}>
          <input
            type="checkbox"
            checked={local.confidenceIntervals}
            onChange={e => {
              setLocal(o => ({ ...o, confidenceIntervals: e.target.checked }))
            }}
          />
          {t('analysis:regression.confidenceIntervals')}
          <input
            type="number"
            step="1"
            min="1"
            max="99"
            value={local.ciLevel}
            onChange={e => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) setLocal(o => ({ ...o, ciLevel: n }))
            }}
            className="numField"
          />
          %
        </label>
        <CheckOption
          checked={local.covarianceMatrix}
          onChange={v => {
            setLocal(o => ({ ...o, covarianceMatrix: v }))
          }}
        >
          {t('analysis:regression.covarianceMatrix')}
        </CheckOption>
        <CheckOption
          checked={local.rSquaredChange}
          onChange={v => {
            setLocal(o => ({ ...o, rSquaredChange: v }))
          }}
        >
          {t('analysis:regression.rSquaredChange')}
        </CheckOption>
        <CheckOption
          checked={local.descriptives}
          onChange={v => {
            setLocal(o => ({ ...o, descriptives: v }))
          }}
        >
          {t('analysis:regression.descriptives')}
        </CheckOption>
        <CheckOption
          checked={local.partialCorrelations}
          onChange={v => {
            setLocal(o => ({ ...o, partialCorrelations: v }))
          }}
        >
          {t('analysis:regression.partialCorrelations')}
        </CheckOption>
        <CheckOption
          checked={local.collinearity}
          onChange={v => {
            setLocal(o => ({ ...o, collinearity: v }))
          }}
        >
          {t('analysis:regression.collinearity')}
        </CheckOption>
      </OptionSection>
      <OptionSection titleKey="analysis:regression.residualsTitle" grid={false}>
        <CheckOption
          checked={local.durbinWatson}
          onChange={v => {
            setLocal(o => ({ ...o, durbinWatson: v }))
          }}
        >
          {t('analysis:regression.durbinWatson')}
        </CheckOption>
        <CheckOption
          checked={local.casewiseDiagnostics}
          onChange={v => {
            setLocal(o => ({ ...o, casewiseDiagnostics: v }))
          }}
        >
          {t('analysis:regression.casewiseDiagnostics')}
        </CheckOption>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="regression-casewise"
            checked={local.casewiseOutliersOnly}
            disabled={!local.casewiseDiagnostics}
            onChange={() => {
              setLocal(o => ({ ...o, casewiseOutliersOnly: true }))
            }}
          />
          {t('analysis:regression.casewiseOutliers')}
          <input
            type="number"
            step="1"
            min="0"
            value={local.casewiseSD}
            disabled={!local.casewiseDiagnostics || !local.casewiseOutliersOnly}
            onChange={e => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) setLocal(o => ({ ...o, casewiseSD: n }))
            }}
            className="numField"
          />
          {t('analysis:regression.casewiseStdDev')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="regression-casewise"
            checked={!local.casewiseOutliersOnly}
            disabled={!local.casewiseDiagnostics}
            onChange={() => {
              setLocal(o => ({ ...o, casewiseOutliersOnly: false }))
            }}
          />
          {t('analysis:regression.casewiseAllCases')}
        </label>
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

function OptionsContent({
  opts,
  onChange,
  onClose
}: {
  opts: RegressionOptions
  onChange: (o: RegressionOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(opts)

  const isStepwise = local.method !== 'enter'

  return (
    <>
      <OptionSection titleKey="analysis:regression.steppingCriteriaTitle" grid={false}>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="regression-criteria-type"
            checked={local.criteria.type === 'prob'}
            disabled={!isStepwise}
            onChange={() => {
              setLocal(o => ({ ...o, criteria: { ...o.criteria, type: 'prob' } }))
            }}
          />
          {t('analysis:regression.useProbF')}
        </label>
        <div className={cx(shellStyles.checkRow, shellStyles.checkRowIndent)}>
          <label>
            {t('analysis:regression.entryLabel')}
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={local.criteria.entryProb}
              disabled={!isStepwise || local.criteria.type !== 'prob'}
              onChange={e => {
                const n = Number(e.target.value)
                if (Number.isFinite(n))
                  setLocal(o => ({ ...o, criteria: { ...o.criteria, entryProb: n } }))
              }}
              className="numField"
            />
          </label>
          <label>
            {t('analysis:regression.removalLabel')}
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={local.criteria.removalProb}
              disabled={!isStepwise || local.criteria.type !== 'prob'}
              onChange={e => {
                const n = Number(e.target.value)
                if (Number.isFinite(n))
                  setLocal(o => ({ ...o, criteria: { ...o.criteria, removalProb: n } }))
              }}
              className="numField"
            />
          </label>
        </div>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="regression-criteria-type"
            checked={local.criteria.type === 'fvalue'}
            disabled={!isStepwise}
            onChange={() => {
              setLocal(o => ({ ...o, criteria: { ...o.criteria, type: 'fvalue' } }))
            }}
          />
          {t('analysis:regression.useFValue')}
        </label>
        <div className={cx(shellStyles.checkRow, shellStyles.checkRowIndent)}>
          <label>
            {t('analysis:regression.entryLabel')}
            <input
              type="number"
              step="0.01"
              min="0"
              value={local.criteria.entryF}
              disabled={!isStepwise || local.criteria.type !== 'fvalue'}
              onChange={e => {
                const n = Number(e.target.value)
                if (Number.isFinite(n))
                  setLocal(o => ({ ...o, criteria: { ...o.criteria, entryF: n } }))
              }}
              className="numField"
            />
          </label>
          <label>
            {t('analysis:regression.removalLabel')}
            <input
              type="number"
              step="0.01"
              min="0"
              value={local.criteria.removalF}
              disabled={!isStepwise || local.criteria.type !== 'fvalue'}
              onChange={e => {
                const n = Number(e.target.value)
                if (Number.isFinite(n))
                  setLocal(o => ({ ...o, criteria: { ...o.criteria, removalF: n } }))
              }}
              className="numField"
            />
          </label>
        </div>
      </OptionSection>
      <OptionSection grid={false}>
        <CheckOption
          checked={local.includeConstant}
          onChange={v => {
            setLocal(o => ({ ...o, includeConstant: v }))
          }}
        >
          {t('analysis:regression.includeConstant')}
        </CheckOption>
      </OptionSection>
      <OptionSection titleKey="analysis:regression.missingValuesTitle" grid={false}>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="regression-missing"
            checked={local.missingMethod === 'listwise'}
            onChange={() => {
              setLocal(o => ({ ...o, missingMethod: 'listwise' }))
            }}
          />
          {t('analysis:regression.missingListwise')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="regression-missing"
            checked={local.missingMethod === 'mean'}
            onChange={() => {
              setLocal(o => ({ ...o, missingMethod: 'mean' }))
            }}
          />
          {t('analysis:regression.missingMean')}
        </label>
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

/** SPSS's own Plots source-variable tokens — shown literally, unlocalized,
 *  same as SPSS's own dialog (they are not translated in real SPSS either). */
function plotTokenLabel(dependentName: string, token: RegressionPlotToken | ''): string {
  if (token === '') return ''
  return token === 'DEPENDNT' ? dependentName : `*${token}`
}

function PlotsContent({
  opts,
  dependentName,
  onChange,
  onClose
}: {
  opts: RegressionOptions
  dependentName: string
  onChange: (o: RegressionOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(opts)

  const selectField = (
    value: RegressionPlotToken | '',
    onSelect: (v: RegressionPlotToken | '') => void
  ) => (
    <select
      value={value}
      onChange={e => {
        onSelect(e.target.value as RegressionPlotToken | '')
      }}
      className="numField numField--select"
    >
      <option value="">{t('analysis:regression.noneOption')}</option>
      {REGRESSION_PLOT_TOKENS.map(tok => (
        <option key={tok} value={tok}>
          {plotTokenLabel(dependentName, tok)}
        </option>
      ))}
    </select>
  )

  return (
    <>
      <OptionSection titleKey="analysis:regression.scatterSectionTitle" grid={false}>
        <label className={shellStyles.checkRow}>
          {t('analysis:regression.yField')}
          {selectField(local.plots.scatterY, v => {
            setLocal(o => ({ ...o, plots: { ...o.plots, scatterY: v } }))
          })}
        </label>
        <label className={shellStyles.checkRow}>
          {t('analysis:regression.xField')}
          {selectField(local.plots.scatterX, v => {
            setLocal(o => ({ ...o, plots: { ...o.plots, scatterX: v } }))
          })}
        </label>
      </OptionSection>
      <OptionSection titleKey="analysis:regression.residualPlotsTitle" grid={false}>
        <CheckOption
          checked={local.plots.histogram}
          onChange={v => {
            setLocal(o => ({ ...o, plots: { ...o.plots, histogram: v } }))
          }}
        >
          {t('analysis:regression.histogramOption')}
        </CheckOption>
        <CheckOption
          checked={local.plots.normalPP}
          onChange={v => {
            setLocal(o => ({ ...o, plots: { ...o.plots, normalPP: v } }))
          }}
        >
          {t('analysis:regression.normalProbPlotOption')}
        </CheckOption>
      </OptionSection>
      <OptionSection grid={false}>
        <CheckOption
          checked={local.plots.partialPlots}
          onChange={v => {
            setLocal(o => ({ ...o, plots: { ...o.plots, partialPlots: v } }))
          }}
        >
          {t('analysis:regression.partialPlotsOption')}
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

export function LinearRegressionDialog({ onClose, bayesian = false }: Props) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { status, install } = usePackageGate('BayesFactor', bayesian)

  const [opts, setOpts] = useState<RegressionOptions>(defaultRegressionOptions)
  const [prior, setPrior] = useState<BayesPrior>(defaultBayesPrior)
  // SPSS keeps the prior behind its own Priors… button, not on the main page.
  const priorButton: SideButtonDef = {
    key: 'priors',
    labelKey: 'analysis:shell.btnPriors',
    titleKey: 'analysis:bayes.priorsTitle',
    renderContent: ({ onClose: closeSub }) => (
      <BayesPriorOptionsContent
        prior={prior}
        onChange={setPrior}
        onClose={closeSub}
        family="lmCont"
      />
    )
  }
  const [bootstrap, setBootstrap] = useState<BootstrapOptions>(defaultBootstrapOptions)
  const [newVars, setNewVars] = useState<NewVarSelection>({})
  const existingNames = useDatasetStore(s => s.variables).map(v => v.name)
  const { running, run } = useRunAnalysis()

  const titleKey = bayesian ? 'analysis:bayesRegression.title' : 'analysis:regression.title'

  const sideButtons: SideButtonDef[] = [
    {
      key: 'statistics',
      labelKey: 'analysis:shell.btnStatistics',
      titleKey: 'analysis:regression.statisticsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <StatisticsContent opts={opts} onChange={setOpts} onClose={closeSub} />
      )
    },
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:regression.optionsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <OptionsContent opts={opts} onChange={setOpts} onClose={closeSub} />
      )
    },
    {
      key: 'plots',
      labelKey: 'analysis:shell.btnPlots',
      titleKey: 'analysis:regression.plotsTitle',
      renderContent: ({ onClose: closeSub, assignments }) => (
        <PlotsContent
          opts={opts}
          dependentName={(assignments['dependent'] ?? [])[0]?.name ?? 'DEPENDNT'}
          onChange={setOpts}
          onClose={closeSub}
        />
      )
    },
    {
      key: 'bootstrap',
      labelKey: 'analysis:shell.btnBootstrap',
      titleKey: 'analysis:shell.btnBootstrap',
      renderContent: ({ onClose: closeSub }) => (
        <BootstrapSection value={bootstrap} onChange={setBootstrap} onClose={closeSub} />
      )
    },
    // Bayesian regression runs a different script (bayes-regression.R) that has
    // no per-case output, so the panel would offer columns it cannot produce.
    ...(bayesian
      ? []
      : [
          {
            key: 'newVars',
            labelKey: 'analysis:shell.btnNewVars',
            titleKey: 'analysis:newVars.title',
            renderContent: ({ onClose: closeSub }: { onClose: () => void }) => (
              <NewVariablesPanel
                slots={REGRESSION_NEW_VARS}
                value={newVars}
                onChange={setNewVars}
                existingNames={existingNames}
                onClose={closeSub}
              />
            )
          }
        ])
  ]

  const fieldDefs = [
    {
      key: 'dependent',
      labelKey: 'analysis:regression.dependentField',
      single: true,
      filter: (v: Variable) => v.type === 'numeric',
      sortMeasure: 'scale' as const,
      roleHint: 'target' as const
    },
    {
      key: 'independents',
      labelKey: 'analysis:regression.independentsField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric',
      roleHint: 'input' as const
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['dependent'] ?? []).length === 1 && (a['independents'] ?? []).length > 0 && !running

  const generateRCode = (a: Record<string, Variable[]>) => {
    // Forward/Backward/Stepwise selection has no single-call R equivalent that
    // matches SPSS's own nested-F entry/removal criteria (R's step() uses AIC
    // by default) — showing one here would misrepresent what the script does.
    if (opts.method !== 'enter') return null
    const dep = (a['dependent'] ?? [])[0]?.name
    const preds = (a['independents'] ?? []).map(v => v.name)
    if (!dep || preds.length === 0) return null
    const rhs = preds.map(p => `\`${p}\``).join(' + ')
    return [
      `fit <- lm(\`${dep}\` ~ ${opts.includeConstant ? rhs : `0 + ${rhs}`}, data = data)`,
      'print(summary(fit))'
    ].join('\n')
  }

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const dep = (a['dependent'] ?? [])[0]
    const preds = a['independents'] ?? []
    if (!dep) return
    const bootstrapParams = buildBootstrapParams(bootstrap)
    await run(
      {
        analysisId: bayesian ? 'bayesRegression' : 'regression',
        datasetId,
        scriptFile: bayesian ? 'bayes-regression.R' : 'regression-linear.R',
        params: {
          dependent: dep.colId,
          dependentName: dep.name,
          independents: preds.map(v => v.colId),
          varNames: Object.fromEntries([dep, ...preds].map(v => [v.colId, v.name])),
          ...(bayesian
            ? { rscale: bayesRscale(prior) }
            : {
                options: {
                  ...opts,
                  ...(bootstrapParams ? { bootstrap: bootstrapParams } : {})
                },
                createVars: cleanNewVarSelection(newVars, existingNames, REGRESSION_STEMS)
              })
        },
        columnFilters
      },
      onClose,
      { titleKey: titleKey, assignments: a }
    )
  }

  if (bayesian && status !== 'installed') {
    return (
      <PackageNeededDialog
        titleKey={titleKey}
        pkg="BayesFactor"
        featureKey="rpkg.feature.bayes"
        status={status}
        onInstall={() => void install()}
        onClose={onClose}
      />
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={bayesian ? 'bayesRegression' : 'regression'}
      titleKey={titleKey}
      fieldDefs={fieldDefs}
      sideButtons={bayesian ? [priorButton] : sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateRCode={bayesian ? undefined : generateRCode}
      generateSyntax={
        bayesian
          ? a =>
              buildSyntax.bayesRegression(
                a['dependent'] ?? [],
                a['independents'] ?? [],
                bayesRscale(prior)
              )
          : a => buildSyntax.regression(a['dependent'] ?? [], a['independents'] ?? [], opts)
      }
      extraContent={
        bayesian ? undefined : (
          <label className={shellStyles.checkRow}>
            {t('analysis:regression.methodField')}
            <select
              value={opts.method}
              onChange={e => {
                setOpts(o => ({ ...o, method: e.target.value as typeof o.method }))
              }}
              className="numField numField--select"
            >
              {REGRESSION_METHODS.map(m => (
                <option key={m} value={m}>
                  {t(`analysis:regression.method.${m}`)}
                </option>
              ))}
            </select>
          </label>
        )
      }
    />
  )
}
