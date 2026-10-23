// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Probit Analysis dialog — SPSS-style (grouped dose-response, not a per-case
 * binary model). Analyze → Regression → Probit
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
import {
  PROBIT_TRANSFORMS,
  PROBIT_MODELS,
  PROBIT_NATURAL_RESPONSE_MODES,
  defaultProbitOptions,
  type ProbitModel,
  type ProbitOptions,
  type ProbitTransform
} from '@shared/probit-types'

/* Keys match requested_new_vars() in regression-probit.R. */
const PROBIT_NEW_VARS: NewVarSlot[] = [
  { key: 'probability', labelKey: 'analysis:probit.newVar.probability', defaultName: 'pre' },
  { key: 'expected', labelKey: 'analysis:probit.newVar.expected', defaultName: 'exp' },
  { key: 'residual', labelKey: 'analysis:probit.newVar.residual', defaultName: 'res' }
]

interface FactorRange {
  min: string
  max: string
}

function RangeContent({
  range,
  onChange,
  onClose
}: {
  range: FactorRange
  onChange: (r: FactorRange) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(range)
  return (
    <>
      <OptionSection titleKey="analysis:probit.rangeHint" grid={false}>
        <label className={shellStyles.checkRow}>
          {t('analysis:probit.rangeMin')}
          <input
            type="number"
            value={local.min}
            onChange={e => {
              setLocal(r => ({ ...r, min: e.target.value }))
            }}
            className="numField"
          />
        </label>
        <label className={shellStyles.checkRow}>
          {t('analysis:probit.rangeMax')}
          <input
            type="number"
            value={local.max}
            onChange={e => {
              setLocal(r => ({ ...r, max: e.target.value }))
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

function OptionsContent({
  opts,
  hasFactor,
  onChange,
  onClose
}: {
  opts: ProbitOptions
  hasFactor: boolean
  onChange: (o: ProbitOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(opts)

  return (
    <>
      <OptionSection titleKey="analysis:probit.statisticsTitle" grid={false}>
        <CheckOption
          checked={local.frequencies}
          onChange={v => {
            setLocal(o => ({ ...o, frequencies: v }))
          }}
        >
          {t('analysis:probit.frequenciesOption')}
        </CheckOption>
        <CheckOption
          checked={local.parallelism}
          onChange={v => {
            setLocal(o => ({ ...o, parallelism: v }))
          }}
          title={!hasFactor ? t('analysis:probit.parallelismNeedsFactor') : undefined}
        >
          {t('analysis:probit.parallelismOption')}
        </CheckOption>
        <label className={shellStyles.checkRow}>
          <input
            type="checkbox"
            checked={local.fiducialCI}
            onChange={e => {
              setLocal(o => ({ ...o, fiducialCI: e.target.checked }))
            }}
          />
          {t('analysis:probit.fiducialOption')}
        </label>
        <label className={shellStyles.checkRow}>
          {t('analysis:probit.heterogeneitySigLabel')}
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={local.heterogeneitySig}
            onChange={e => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) setLocal(o => ({ ...o, heterogeneitySig: n }))
            }}
            className="numField"
          />
        </label>
      </OptionSection>

      <OptionSection titleKey="analysis:probit.naturalResponseTitle" grid={false}>
        {PROBIT_NATURAL_RESPONSE_MODES.map(mode => (
          <label key={mode} className={shellStyles.checkRow}>
            <input
              type="radio"
              name="probit-nrm"
              checked={local.naturalResponseMode === mode}
              onChange={() => {
                setLocal(o => ({ ...o, naturalResponseMode: mode }))
              }}
            />
            {t(`analysis:probit.nrm_${mode}`)}
            {mode === 'value' && (
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                disabled={local.naturalResponseMode !== 'value'}
                value={local.naturalResponseValue ?? ''}
                onChange={e => {
                  const n = Number(e.target.value)
                  setLocal(o => ({
                    ...o,
                    naturalResponseValue: e.target.value === '' || !Number.isFinite(n) ? null : n
                  }))
                }}
                className="numField"
              />
            )}
          </label>
        ))}
      </OptionSection>

      <OptionSection grid={false}>
        <label className={shellStyles.checkRow}>
          {t('analysis:probit.maxIterations')}
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

export function ProbitDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [newVars, setNewVars] = useState<NewVarSelection>({})
  const [transform, setTransform] = useState<ProbitTransform>('none')
  const [modelType, setModelType] = useState<ProbitModel>('probit')
  const [opts, setOpts] = useState<ProbitOptions>(defaultProbitOptions)
  const [range, setRange] = useState<FactorRange>({ min: '', max: '' })
  const existingNames = useDatasetStore(s => s.variables).map(v => v.name)
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    { key: 'responseFreq', labelKey: 'analysis:probit.responseFreqField', single: true },
    { key: 'totalObserved', labelKey: 'analysis:probit.totalObservedField', single: true },
    { key: 'factor', labelKey: 'analysis:probit.factorField', single: true },
    {
      key: 'covariates',
      labelKey: 'analysis:probit.covariatesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]

  const sideButtons: SideButtonDef[] = [
    {
      key: 'range',
      labelKey: 'analysis:probit.btnDefineRange',
      titleKey: 'analysis:probit.rangeTitle',
      disabled: a => (a['factor'] ?? []).length === 0,
      renderContent: ({ onClose: closeSub }) => (
        <RangeContent range={range} onChange={setRange} onClose={closeSub} />
      )
    },
    {
      key: 'newVars',
      labelKey: 'analysis:shell.btnNewVars',
      titleKey: 'analysis:newVars.title',
      renderContent: ({ onClose: closeSub }) => (
        <NewVariablesPanel
          slots={PROBIT_NEW_VARS}
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
      titleKey: 'analysis:probit.optionsTitle',
      renderContent: ({ assignments, onClose: closeSub }) => (
        <OptionsContent
          opts={opts}
          hasFactor={(assignments['factor'] ?? []).length > 0}
          onChange={setOpts}
          onClose={closeSub}
        />
      )
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['responseFreq'] ?? []).length === 1 &&
    (a['totalObserved'] ?? []).length === 1 &&
    (a['covariates'] ?? []).length > 0 &&
    !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const respFreq = (a['responseFreq'] ?? [])[0]
    const totalObs = (a['totalObserved'] ?? [])[0]
    const factor = (a['factor'] ?? [])[0]
    const covs = a['covariates'] ?? []
    if (!respFreq || !totalObs || covs.length === 0) return
    const rangeMin = range.min.trim() === '' ? null : Number(range.min)
    const rangeMax = range.max.trim() === '' ? null : Number(range.max)
    await run(
      {
        analysisId: 'probit',
        datasetId,
        scriptFile: 'regression-probit.R',
        params: {
          responseFreq: respFreq.colId,
          totalObserved: totalObs.colId,
          factor: factor?.colId ?? null,
          factorRange:
            factor && rangeMin !== null && rangeMax !== null
              ? { min: rangeMin, max: rangeMax }
              : null,
          covariates: covs.map(v => v.colId),
          varNames: Object.fromEntries(covs.map(v => [v.colId, v.name])),
          transform,
          modelType,
          options: opts,
          createVars: cleanNewVarSelection(newVars, existingNames)
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:probit.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'probit'}
      titleKey="analysis:probit.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.probit(
          a['responseFreq'] ?? [],
          a['totalObserved'] ?? [],
          a['factor'] ?? [],
          a['covariates'] ?? [],
          { transform, modelType, options: opts }
        )
      }
      extraContent={
        <>
          <OptionSection titleKey="analysis:probit.transformTitle" grid={false}>
            <label className={shellStyles.checkRow}>
              <select
                value={transform}
                onChange={e => {
                  setTransform(e.target.value as ProbitTransform)
                }}
              >
                {PROBIT_TRANSFORMS.map(tf => (
                  <option key={tf} value={tf}>
                    {t(`analysis:probit.transform_${tf}`)}
                  </option>
                ))}
              </select>
            </label>
          </OptionSection>
          <OptionSection titleKey="analysis:probit.modelTitle" grid={false}>
            {PROBIT_MODELS.map(m => (
              <label key={m} className={shellStyles.checkRow}>
                <input
                  type="radio"
                  name="probit-model"
                  checked={modelType === m}
                  onChange={() => {
                    setModelType(m)
                  }}
                />
                {t(`analysis:probit.model_${m}`)}
              </label>
            ))}
          </OptionSection>
        </>
      }
    />
  )
}
