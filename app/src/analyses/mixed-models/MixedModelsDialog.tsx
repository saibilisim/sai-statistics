// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Linear Mixed Models dialog — SPSS Mixed → Linear.
 * Analyze → Mixed Models → Linear
 *
 * Main page: Dependent, Factor(s), Covariate(s) and the Subjects grouping
 * variable. Sub-dialogs as SPSS: Fixed (model, intercept, SS type), Random
 * (intercept, slopes, covariance type), Estimation (REML/ML), Statistics and
 * EM Means. The engine is nlme::lme (mixed-models.R). Not offered: Repeated
 * (residual covariance structures), Save.
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
import { EmMeansContent } from '../glm/GlmSubDialogs'
import { defaultEmMeans, type EmMeansOptions } from '../glm/glm-options'

interface FixedOpts {
  model: 'main' | 'factorial'
  intercept: boolean
  ssType: 'I' | 'III'
}
interface RandomOpts {
  intercept: boolean
  slopes: string[]
  covType: 'vc' | 'diagonal' | 'unstructured' | 'identity'
}
interface StatsOpts {
  descriptives: boolean
  paramEstimates: boolean
  covCI: boolean
  ciLevel: string
}

const defaultFixed: FixedOpts = { model: 'main', intercept: true, ssType: 'III' }
const defaultRandom: RandomOpts = { intercept: true, slopes: [], covType: 'vc' }
const defaultStats: StatsOpts = {
  descriptives: false,
  paramEstimates: true,
  covCI: false,
  ciLevel: '95'
}

function useLocal<T>(value: T) {
  const [local, setLocal] = useState(value)
  const set = <K extends keyof T>(key: K, v: T[K]) => {
    setLocal(prev => ({ ...prev, [key]: v }))
  }
  return [local, set] as const
}

function Footer<T>({
  local,
  onChange,
  onClose
}: {
  local: T
  onChange: (v: T) => void
  onClose: () => void
}) {
  return (
    <SubDialogFooter
      onContinue={() => {
        onChange(local)
        onClose()
      }}
      onCancel={onClose}
    />
  )
}

function FixedContent({
  value,
  onChange,
  onClose,
  hasFactors
}: {
  value: FixedOpts
  onChange: (v: FixedOpts) => void
  onClose: () => void
  hasFactors: boolean
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, set] = useLocal(value)
  return (
    <>
      <OptionSection titleKey="analysis:mixed.fixedModel" grid={false}>
        {(['main', 'factorial'] as const).map(m => (
          <label key={m} className={shellStyles.checkRow}>
            <input
              type="radio"
              name="mixed-fixed-model"
              checked={local.model === m}
              disabled={m === 'factorial' && !hasFactors}
              onChange={() => {
                set('model', m)
              }}
            />
            {t(m === 'main' ? 'analysis:mixed.fixedMain' : 'analysis:mixed.fixedFactorial')}
          </label>
        ))}
        <CheckOption
          checked={local.intercept}
          onChange={v => {
            set('intercept', v)
          }}
        >
          {t('analysis:mixed.includeIntercept')}
        </CheckOption>
      </OptionSection>
      <OptionSection titleKey="analysis:mixed.ssType" grid={false}>
        {(['III', 'I'] as const).map(s => (
          <label key={s} className={shellStyles.checkRow}>
            <input
              type="radio"
              name="mixed-ss-type"
              checked={local.ssType === s}
              onChange={() => {
                set('ssType', s)
              }}
            />
            {t(s === 'III' ? 'analysis:mixed.ssType3' : 'analysis:mixed.ssType1')}
          </label>
        ))}
      </OptionSection>
      <Footer local={local} onChange={onChange} onClose={onClose} />
    </>
  )
}

function RandomContent({
  value,
  onChange,
  onClose,
  covariates
}: {
  value: RandomOpts
  onChange: (v: RandomOpts) => void
  onClose: () => void
  covariates: Variable[]
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, set] = useLocal(value)
  const empty = !local.intercept && local.slopes.length === 0
  return (
    <>
      <OptionSection titleKey="analysis:mixed.randomEffects" grid={false}>
        <CheckOption
          checked={local.intercept}
          onChange={v => {
            set('intercept', v)
          }}
        >
          {t('analysis:mixed.randomIntercept')}
        </CheckOption>
        {covariates.map(v => (
          <CheckOption
            key={v.colId}
            checked={local.slopes.includes(v.colId)}
            onChange={on => {
              set(
                'slopes',
                on ? [...local.slopes, v.colId] : local.slopes.filter(x => x !== v.colId)
              )
            }}
          >
            {t('analysis:mixed.randomSlope', { name: v.name })}
          </CheckOption>
        ))}
      </OptionSection>
      <OptionSection titleKey="analysis:mixed.covType" grid={false}>
        <label className={shellStyles.checkRow}>
          {t('analysis:mixed.covTypeLabel')}
          <select
            value={local.covType}
            onChange={e => {
              set('covType', e.target.value as RandomOpts['covType'])
            }}
          >
            <option value="vc">{t('analysis:mixed.covTypeVc')}</option>
            <option value="diagonal">{t('analysis:mixed.covTypeDiagonal')}</option>
            <option value="unstructured">{t('analysis:mixed.covTypeUnstructured')}</option>
            <option value="identity">{t('analysis:mixed.covTypeIdentity')}</option>
          </select>
        </label>
      </OptionSection>
      <SubDialogFooter
        continueDisabled={empty}
        onContinue={() => {
          onChange(local)
          onClose()
        }}
        onCancel={onClose}
      />
    </>
  )
}

function EstimationContent({
  value,
  onChange,
  onClose
}: {
  value: 'REML' | 'ML'
  onChange: (v: 'REML' | 'ML') => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)
  return (
    <>
      <OptionSection titleKey="analysis:mixed.method" grid={false}>
        {(['REML', 'ML'] as const).map(m => (
          <label key={m} className={shellStyles.checkRow}>
            <input
              type="radio"
              name="mixed-method"
              checked={local === m}
              onChange={() => {
                setLocal(m)
              }}
            />
            {t(m === 'REML' ? 'analysis:mixed.methodReml' : 'analysis:mixed.methodMl')}
          </label>
        ))}
      </OptionSection>
      <Footer local={local} onChange={onChange} onClose={onClose} />
    </>
  )
}

function StatisticsContent({
  value,
  onChange,
  onClose
}: {
  value: StatsOpts
  onChange: (v: StatsOpts) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, set] = useLocal(value)
  return (
    <>
      <OptionSection titleKey="analysis:mixed.summaryStats" grid={false}>
        <CheckOption
          checked={local.descriptives}
          onChange={v => {
            set('descriptives', v)
          }}
        >
          {t('analysis:mixed.descriptives')}
        </CheckOption>
      </OptionSection>
      <OptionSection titleKey="analysis:mixed.modelStats" grid={false}>
        <CheckOption
          checked={local.paramEstimates}
          onChange={v => {
            set('paramEstimates', v)
          }}
        >
          {t('analysis:mixed.paramEstimates')}
        </CheckOption>
        <CheckOption
          checked={local.covCI}
          onChange={v => {
            set('covCI', v)
          }}
        >
          {t('analysis:mixed.covCI')}
        </CheckOption>
        <label className={shellStyles.checkRow}>
          {t('analysis:mixed.ciLevel')}
          <input
            type="number"
            value={local.ciLevel}
            min="1"
            max="99.99"
            step="any"
            onChange={e => {
              set('ciLevel', e.target.value)
            }}
            className="numField"
          />
        </label>
      </OptionSection>
      <Footer local={local} onChange={onChange} onClose={onClose} />
    </>
  )
}

const ciFraction = (s: StatsOpts) => {
  const v = Number(s.ciLevel)
  return v > 0 && v < 100 ? v / 100 : 0.95
}

export function MixedModelsDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { running, run } = useRunAnalysis()
  const [fixed, setFixed] = useState(defaultFixed)
  const [random, setRandom] = useState(defaultRandom)
  const [method, setMethod] = useState<'REML' | 'ML'>('REML')
  const [stats, setStats] = useState(defaultStats)
  const [emMeans, setEmMeans] = useState<EmMeansOptions>(defaultEmMeans)

  const fieldDefs = [
    {
      key: 'dependent',
      labelKey: 'analysis:mixed.dependentField',
      single: true,
      filter: (v: Variable) => v.type === 'numeric'
    },
    { key: 'factors', labelKey: 'analysis:mixed.factorsField', single: false },
    {
      key: 'predictors',
      labelKey: 'analysis:mixed.covariatesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    },
    { key: 'subject', labelKey: 'analysis:mixed.subjectField', single: true }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['dependent'] ?? []).length === 1 &&
    ((a['predictors'] ?? []).length > 0 || (a['factors'] ?? []).length > 0) &&
    (a['subject'] ?? []).length === 1 &&
    !running

  const sideButtons: SideButtonDef[] = [
    {
      key: 'fixed',
      labelKey: 'analysis:mixed.btnFixed',
      titleKey: 'analysis:mixed.fixedTitleDlg',
      renderContent: ({ onClose: closeSub, assignments }) => (
        <FixedContent
          value={fixed}
          onChange={setFixed}
          onClose={closeSub}
          hasFactors={(assignments['factors'] ?? []).length > 1}
        />
      )
    },
    {
      key: 'random',
      labelKey: 'analysis:mixed.btnRandom',
      titleKey: 'analysis:mixed.randomTitleDlg',
      renderContent: ({ onClose: closeSub, assignments }) => (
        <RandomContent
          value={random}
          onChange={setRandom}
          onClose={closeSub}
          covariates={assignments['predictors'] ?? []}
        />
      )
    },
    {
      key: 'estimation',
      labelKey: 'analysis:mixed.btnEstimation',
      titleKey: 'analysis:mixed.estimationTitleDlg',
      renderContent: ({ onClose: closeSub }) => (
        <EstimationContent value={method} onChange={setMethod} onClose={closeSub} />
      )
    },
    {
      key: 'statistics',
      labelKey: 'analysis:shell.btnStatistics',
      titleKey: 'analysis:mixed.statisticsTitleDlg',
      renderContent: ({ onClose: closeSub }) => (
        <StatisticsContent value={stats} onChange={setStats} onClose={closeSub} />
      )
    },
    {
      key: 'emmeans',
      labelKey: 'analysis:shell.btnEmMeans',
      titleKey: 'analysis:mixed.emMeansTitleDlg',
      renderContent: ({ onClose: closeSub, assignments }) => (
        <EmMeansContent
          value={emMeans}
          onChange={setEmMeans}
          onClose={closeSub}
          factorVars={assignments['factors'] ?? []}
        />
      )
    }
  ]

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const dep = (a['dependent'] ?? [])[0]
    const subj = (a['subject'] ?? [])[0]
    const facs = a['factors'] ?? []
    const covs = a['predictors'] ?? []
    if (!dep || !subj) return
    const facIds = new Set(facs.map(v => v.colId))
    await run(
      {
        analysisId: 'mixed',
        datasetId,
        scriptFile: 'mixed-models.R',
        params: {
          dependent: dep.colId,
          dependentName: dep.name,
          factors: facs.map(v => v.colId),
          covariates: covs.map(v => v.colId),
          subject: subj.colId,
          varNames: Object.fromEntries([...facs, ...covs].map(v => [v.colId, v.name])),
          options: {
            fixed,
            random: {
              ...random,
              slopes: random.slopes.filter(id => covs.some(c => c.colId === id))
            },
            estimation: { method },
            statistics: { ...stats, ciLevel: ciFraction(stats) },
            // Interaction terms are a GLM option the mixed engine does not take.
            ...(emMeans.terms.some(x => x === 'OVERALL' || facIds.has(x))
              ? {
                  emMeans: {
                    ...emMeans,
                    terms: emMeans.terms.filter(x => x === 'OVERALL' || facIds.has(x))
                  }
                }
              : {})
          }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:mixed.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'mixed'}
      titleKey="analysis:mixed.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setFixed(defaultFixed)
        setRandom(defaultRandom)
        setMethod('REML')
        setStats(defaultStats)
        setEmMeans(defaultEmMeans)
      }}
      generateSyntax={a => {
        const covs = a['predictors'] ?? []
        return buildSyntax.mixedModel(a['dependent'] ?? [], covs, a['subject'] ?? [], {
          factors: a['factors'] ?? [],
          fixedModel: fixed.model,
          intercept: fixed.intercept,
          ssType: fixed.ssType,
          randomIntercept: random.intercept,
          slopes: covs.filter(c => random.slopes.includes(c.colId)),
          covType: random.covType,
          method,
          descriptives: stats.descriptives,
          paramEstimates: stats.paramEstimates,
          covCI: stats.covCI,
          ciLevel: ciFraction(stats),
          emTerms: emMeans.terms.map(x => (a['factors'] ?? []).find(f => f.colId === x)?.name ?? x),
          compareMainEffects: emMeans.compareMainEffects,
          ciAdjust: emMeans.ciAdjust
        })
      }}
    />
  )
}
