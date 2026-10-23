// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Cox Regression dialog — SPSS-style.
 * Analyze → Survival → Cox Regression
 *
 * Sub-dialogs mirror SPSS's: "Categorical…" (which covariates are factors and
 * how their contrasts are coded), "Plots" (which curves, at which covariate
 * values, split by which category) and "Options" (confidence limits, the
 * correlation matrix, the baseline table, the stepwise thresholds).
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
import { buildSyntax } from '../../lib/spss-syntax'
import type {
  CoxCategoricalSpec,
  CoxMethod,
  CoxOptions,
  CoxPlotOptions
} from '@shared/survival-types'
import {
  COX_CONTRASTS,
  COX_METHODS,
  defaultCoxOptions,
  defaultCoxPlotOptions
} from '@shared/survival-types'
import { NewVariablesPanel, type NewVarSlot } from '../../components/Dialogs/NewVariablesPanel'
import { cleanNewVarSelection, type NewVarSelection } from '@/lib/new-var-names'

/* Per-case output of the FINAL model (so a stepwise run saves the model it
   actually reports). Keys match requested_new_vars() in survival-cox.R.
   The last two produce one column PER COEFFICIENT, so their name is a stem
   that R suffixes with 1, 2, 3… */
const COX_NEW_VARS: NewVarSlot[] = [
  { key: 'survival', labelKey: 'analysis:survivalCox.newVar.survival', defaultName: 'sur' },
  { key: 'hazard', labelKey: 'analysis:survivalCox.newVar.hazard', defaultName: 'haz' },
  { key: 'lml', labelKey: 'analysis:survivalCox.newVar.lml', defaultName: 'lml' },
  { key: 'xbeta', labelKey: 'analysis:survivalCox.newVar.xbeta', defaultName: 'xbeta' },
  {
    key: 'dfbeta',
    labelKey: 'analysis:survivalCox.newVar.dfbeta',
    defaultName: 'dfb',
    perCoefficient: true
  },
  {
    key: 'schoenfeld',
    labelKey: 'analysis:survivalCox.newVar.schoenfeld',
    defaultName: 'sch',
    perCoefficient: true
  }
]
const COX_STEMS = COX_NEW_VARS.filter(s => s.perCoefficient === true).map(s => s.key)

function CategoricalContent({
  covs,
  categorical,
  onChange,
  onClose
}: {
  covs: Variable[]
  categorical: Record<string, CoxCategoricalSpec>
  onChange: (c: Record<string, CoxCategoricalSpec>) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(categorical)

  if (covs.length === 0) {
    return (
      <>
        <div className={shellStyles.checkRow}>{t('analysis:survivalCox.noCovariates')}</div>
        <SubDialogFooter onContinue={onClose} onCancel={onClose} />
      </>
    )
  }

  return (
    <>
      <OptionSection titleKey="analysis:survivalCox.categoricalHint" grid={false}>
        {covs.map(v => {
          const spec = local[v.colId]
          return (
            <div key={v.colId} className={shellStyles.optionSection}>
              <CheckOption
                checked={Boolean(spec)}
                onChange={on => {
                  setLocal(c =>
                    on
                      ? { ...c, [v.colId]: { contrast: 'indicator', reference: 'last' } }
                      : Object.fromEntries(Object.entries(c).filter(([colId]) => colId !== v.colId))
                  )
                }}
              >
                {v.label ? `${v.name} (${v.label})` : v.name}
              </CheckOption>
              {spec && (
                <>
                  <label className={shellStyles.checkRow}>
                    {t('analysis:survivalCox.contrastLabel')}
                    <select
                      value={spec.contrast}
                      onChange={e => {
                        const contrast = e.target.value as CoxCategoricalSpec['contrast']
                        setLocal(c => ({ ...c, [v.colId]: { ...spec, contrast } }))
                      }}
                    >
                      {COX_CONTRASTS.map(ct => (
                        <option key={ct} value={ct}>
                          {t(`analysis:survivalCox.contrast_${ct}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {spec.contrast !== 'polynomial' && (
                    <div className={shellStyles.optionGrid}>
                      {(['first', 'last'] as const).map(ref => (
                        <label key={ref} className={shellStyles.checkRow}>
                          <input
                            type="radio"
                            name={`cox-ref-${v.colId}`}
                            checked={spec.reference === ref}
                            onChange={() => {
                              setLocal(c => ({
                                ...c,
                                [v.colId]: { ...spec, reference: ref }
                              }))
                            }}
                          />
                          {t(`analysis:survivalCox.reference_${ref}`)}
                        </label>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
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

function PlotsContent({
  covs,
  categorical,
  plots,
  onChange,
  onClose
}: {
  covs: Variable[]
  categorical: Record<string, CoxCategoricalSpec>
  plots: CoxPlotOptions
  onChange: (p: CoxPlotOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(plots)
  const catCovs = covs.filter(v => categorical[v.colId])
  const scaleCovs = covs.filter(v => !categorical[v.colId])

  return (
    <>
      <OptionSection titleKey="analysis:survivalCox.plotType">
        <CheckOption
          checked={local.survival}
          onChange={v => {
            setLocal(p => ({ ...p, survival: v }))
          }}
        >
          {t('analysis:survivalCox.plotSurvival')}
        </CheckOption>
        <CheckOption
          checked={local.hazard}
          onChange={v => {
            setLocal(p => ({ ...p, hazard: v }))
          }}
        >
          {t('analysis:survivalCox.plotHazard')}
        </CheckOption>
        <CheckOption
          checked={local.logMinusLog}
          onChange={v => {
            setLocal(p => ({ ...p, logMinusLog: v }))
          }}
        >
          {t('analysis:survivalCox.plotLogMinusLog')}
        </CheckOption>
        <CheckOption
          checked={local.oneMinusSurvival}
          onChange={v => {
            setLocal(p => ({ ...p, oneMinusSurvival: v }))
          }}
        >
          {t('analysis:survivalCox.plotOneMinus')}
        </CheckOption>
      </OptionSection>
      <OptionSection titleKey="analysis:survivalCox.plotSeparate" grid={false}>
        <label className={shellStyles.checkRow}>
          <select
            value={local.separateBy ?? ''}
            onChange={e => {
              const val = e.target.value === '' ? null : e.target.value
              setLocal(p => ({ ...p, separateBy: val }))
            }}
          >
            <option value="">{t('analysis:survivalCox.separateNone')}</option>
            {catCovs.map(v => (
              <option key={v.colId} value={v.colId}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        {catCovs.length === 0 && (
          <div className={shellStyles.checkRow}>
            {t('analysis:survivalCox.separateNeedsCategorical')}
          </div>
        )}
      </OptionSection>
      <OptionSection titleKey="analysis:survivalCox.plotValues" grid={false}>
        {scaleCovs.length === 0 ? (
          <div className={shellStyles.checkRow}>{t('analysis:survivalCox.plotValuesNone')}</div>
        ) : (
          scaleCovs.map(v => (
            <label key={v.colId} className={shellStyles.checkRow}>
              {v.name}
              <input
                type="number"
                placeholder={t('analysis:survivalCox.plotValueMean')}
                value={v.colId in local.values ? String(local.values[v.colId]) : ''}
                onChange={e => {
                  const raw = e.target.value
                  const n = Number(raw)
                  setLocal(p => {
                    const kept = Object.fromEntries(
                      Object.entries(p.values).filter(([colId]) => colId !== v.colId)
                    )
                    return {
                      ...p,
                      values: raw === '' || !Number.isFinite(n) ? kept : { ...kept, [v.colId]: n }
                    }
                  })
                }}
                className="numField"
              />
            </label>
          ))
        )}
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
  isStepwise,
  onChange,
  onClose
}: {
  opts: CoxOptions
  isStepwise: boolean
  onChange: (o: CoxOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(opts)

  return (
    <>
      <OptionSection titleKey="analysis:survivalCox.modelStatistics" grid={false}>
        <label className={shellStyles.checkRow}>
          <input
            type="checkbox"
            checked={local.ciExpB}
            onChange={e => {
              setLocal(o => ({ ...o, ciExpB: e.target.checked }))
            }}
          />
          {t('analysis:survivalCox.ciForExpB')}
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
        <CheckOption
          checked={local.correlation}
          onChange={v => {
            setLocal(o => ({ ...o, correlation: v }))
          }}
        >
          {t('analysis:survivalCox.correlationOfEstimates')}
        </CheckOption>
        <CheckOption
          checked={local.baseline}
          onChange={v => {
            setLocal(o => ({ ...o, baseline: v }))
          }}
        >
          {t('analysis:survivalCox.displayBaseline')}
        </CheckOption>
        <CheckOption
          checked={local.phTest}
          onChange={v => {
            setLocal(o => ({ ...o, phTest: v }))
          }}
          title={t('analysis:survivalCox.phTestHint')}
        >
          {t('analysis:survivalCox.phTest')}
        </CheckOption>
      </OptionSection>
      <OptionSection titleKey="analysis:survivalCox.displayModelInfo" grid={false}>
        {(['each', 'last'] as const).map(d => (
          <label key={d} className={shellStyles.checkRow}>
            <input
              type="radio"
              name="cox-display"
              checked={local.display === d}
              disabled={!isStepwise}
              onChange={() => {
                setLocal(o => ({ ...o, display: d }))
              }}
            />
            {t(`analysis:survivalCox.display_${d}`)}
          </label>
        ))}
      </OptionSection>
      <OptionSection titleKey="analysis:survivalCox.probStepwise" grid={false}>
        <label className={shellStyles.checkRow}>
          {t('analysis:survivalCox.entryProb')}
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={local.entry}
            disabled={!isStepwise}
            onChange={e => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) setLocal(o => ({ ...o, entry: n }))
            }}
            className="numField"
          />
        </label>
        <label className={shellStyles.checkRow}>
          {t('analysis:survivalCox.removalProb')}
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={local.removal}
            disabled={!isStepwise}
            onChange={e => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) setLocal(o => ({ ...o, removal: n }))
            }}
            className="numField"
          />
        </label>
        <label className={shellStyles.checkRow}>
          {t('analysis:survivalCox.maxIterations')}
          <input
            type="number"
            step="1"
            value={local.maxIterations}
            onChange={e => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) setLocal(o => ({ ...o, maxIterations: n }))
            }}
            className="numField"
          />
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

export function CoxRegressionDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [eventValue, setEventValue] = useState('1')
  const [method, setMethod] = useState<CoxMethod>('enter')
  const [categorical, setCategorical] = useState<Record<string, CoxCategoricalSpec>>({})
  const [opts, setOpts] = useState<CoxOptions>(defaultCoxOptions)
  const [plots, setPlots] = useState<CoxPlotOptions>(defaultCoxPlotOptions)
  const [newVars, setNewVars] = useState<NewVarSelection>({})
  const existingNames = useDatasetStore(s => s.variables).map(v => v.name)
  const { running, run } = useRunAnalysis()

  const isStepwise = method !== 'enter'

  const fieldDefs = [
    {
      key: 'time',
      labelKey: 'analysis:survivalCox.timeField',
      single: true,
      filter: (v: Variable) => v.type === 'numeric'
    },
    { key: 'status', labelKey: 'analysis:survivalCox.statusField', single: true },
    { key: 'covariates', labelKey: 'analysis:survivalCox.covariatesField', single: false },
    { key: 'strata', labelKey: 'analysis:survivalCox.strataField', single: true }
  ]

  const sideButtons: SideButtonDef[] = [
    {
      key: 'categorical',
      labelKey: 'analysis:survivalCox.btnCategorical',
      titleKey: 'analysis:survivalCox.categoricalTitle',
      renderContent: ({ assignments, onClose: closeSub }) => (
        <CategoricalContent
          covs={assignments['covariates'] ?? []}
          categorical={categorical}
          onChange={setCategorical}
          onClose={closeSub}
        />
      )
    },
    {
      key: 'plots',
      labelKey: 'analysis:shell.btnPlots',
      titleKey: 'analysis:survivalCox.plotsTitle',
      renderContent: ({ assignments, onClose: closeSub }) => (
        <PlotsContent
          covs={assignments['covariates'] ?? []}
          categorical={categorical}
          plots={plots}
          onChange={setPlots}
          onClose={closeSub}
        />
      )
    },
    {
      key: 'newVars',
      labelKey: 'analysis:shell.btnNewVars',
      titleKey: 'analysis:newVars.title',
      renderContent: ({ onClose: closeSub }) => (
        <NewVariablesPanel
          slots={COX_NEW_VARS}
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
      titleKey: 'analysis:survivalCox.optionsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <OptionsContent opts={opts} isStepwise={isStepwise} onChange={setOpts} onClose={closeSub} />
      )
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['time'] ?? []).length === 1 &&
    (a['status'] ?? []).length === 1 &&
    (a['covariates'] ?? []).length > 0 &&
    eventValue.trim() !== '' &&
    !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const time = (a['time'] ?? [])[0]
    const status = (a['status'] ?? [])[0]
    const covs = a['covariates'] ?? []
    const strata = (a['strata'] ?? [])[0]
    if (!time || !status) return
    const covIds = new Set(covs.map(v => v.colId))
    // A covariate can be removed from the field list after being marked
    // categorical (or picked as the plots' separating variable); sending the
    // stale entry would make the script look for a column that is not in the
    // model. Filter both against what is actually assigned right now.
    const activeCategorical = Object.fromEntries(
      Object.entries(categorical).filter(([colId]) => covIds.has(colId))
    )
    const separateBy =
      plots.separateBy && activeCategorical[plots.separateBy] ? plots.separateBy : null
    const plotValues = Object.fromEntries(
      Object.entries(plots.values).filter(([colId]) => covIds.has(colId))
    )
    await run(
      {
        analysisId: 'survivalCox',
        datasetId,
        scriptFile: 'survival-cox.R',
        params: {
          timeVar: time.colId,
          timeName: time.name,
          statusVar: status.colId,
          eventValue: eventValue.trim(),
          covariates: covs.map(v => v.colId),
          varNames: Object.fromEntries(covs.map(v => [v.colId, v.name])),
          categorical: activeCategorical,
          categoricalValueLabels: Object.fromEntries(
            covs.filter(v => activeCategorical[v.colId]).map(v => [v.colId, v.valueLabels])
          ),
          strata: strata?.colId ?? null,
          strataName: strata?.name ?? null,
          method,
          options: opts,
          plots: { ...plots, separateBy, values: plotValues },
          createVars: cleanNewVarSelection(newVars, existingNames, COX_STEMS)
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:survivalCox.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'survivalCox'}
      titleKey="analysis:survivalCox.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.coxRegression(
          a['time'] ?? [],
          a['status'] ?? [],
          eventValue.trim(),
          a['covariates'] ?? [],
          a['strata'] ?? [],
          method,
          // Syntax is written in variable names, so the colId-keyed state is
          // re-keyed by name here (and stale entries for covariates no longer
          // assigned fall out on their own).
          Object.fromEntries(
            (a['covariates'] ?? [])
              .filter(v => categorical[v.colId])
              .map(v => [v.name, categorical[v.colId] as CoxCategoricalSpec])
          ),
          opts
        )
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {t('analysis:survivalCox.eventValue')}
            <input
              type="text"
              value={eventValue}
              onChange={e => {
                setEventValue(e.target.value)
              }}
              className="numField"
            />
          </label>
          <label className={shellStyles.checkRow}>
            {t('analysis:survivalCox.methodLabel')}
            <select
              value={method}
              onChange={e => {
                setMethod(e.target.value as CoxMethod)
              }}
            >
              {COX_METHODS.map(m => (
                <option key={m} value={m}>
                  {t(`analysis:survivalCox.method_${m}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      }
    />
  )
}
