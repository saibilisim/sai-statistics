// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reliability Analysis dialog — SPSS-style.
 * Analyze → Scale → Reliability Analysis
 *
 * Models as in SPSS (alpha, split-half, Guttman, parallel, strictly parallel)
 * plus McDonald's omega; the Statistics sub-dialog carries the inter-item
 * correlations, Hotelling's T², Tukey's test of additivity, the ANOVA table
 * (F / Friedman / Cochran) and the intraclass correlation coefficient.
 */

import { useId, useState } from 'react'
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
import { cx } from '../../lib/cx'
import {
  RELIABILITY_MODELS,
  defaultReliabilityOptions,
  reliabilityOptionParams,
  type IccModel,
  type IccType,
  type ReliabilityAnova,
  type ReliabilityModel,
  type ReliabilityOptions
} from './reliability-options'

const ANOVAS: ReliabilityAnova[] = ['none', 'f', 'friedman', 'cochran']
const MODEL_LABEL = {
  alpha: 'analysis:reliability.modelAlpha',
  split: 'analysis:reliability.modelSplit',
  guttman: 'analysis:reliability.modelGuttman',
  parallel: 'analysis:reliability.modelParallel',
  strict: 'analysis:reliability.modelStrict',
  omega: 'analysis:reliability.modelOmega'
} as const satisfies Record<ReliabilityModel, string>
const ICC_MODELS: IccModel[] = ['oneway', 'random', 'mixed']
const ICC_TYPES: IccType[] = ['consistency', 'absolute']

// ─────────────────────────────────────────────────────────────
//  Statistics sub-dialog
// ─────────────────────────────────────────────────────────────

function StatisticsContent({
  options,
  onChange,
  onClose
}: {
  options: ReliabilityOptions
  onChange: (v: ReliabilityOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const id = useId()
  const [local, setLocal] = useState(options)
  const set = <K extends keyof ReliabilityOptions>(key: K, val: ReliabilityOptions[K]) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }
  const setIcc = (patch: Partial<ReliabilityOptions['icc']>) => {
    setLocal(prev => ({ ...prev, icc: { ...prev.icc, ...patch } }))
  }
  const num = (v: string, fallback: number) => {
    const x = Number(v)
    return Number.isFinite(x) ? x : fallback
  }

  return (
    <>
      <OptionSection titleKey="analysis:reliability.interItemSection" grid={false}>
        <CheckOption
          checked={local.interItemCorr}
          onChange={v => {
            set('interItemCorr', v)
          }}
        >
          {t('analysis:reliability.interItemCorrOption')}
        </CheckOption>
      </OptionSection>
      <OptionSection titleKey="analysis:reliability.anovaSection" grid={false}>
        {ANOVAS.map(a => (
          <label key={a} className={shellStyles.checkRow}>
            <input
              type="radio"
              name={`${id}-anova`}
              checked={local.anova === a}
              onChange={() => {
                set('anova', a)
              }}
            />
            {t(`analysis:reliability.anova_${a}`)}
          </label>
        ))}
      </OptionSection>
      <OptionSection grid={false}>
        <CheckOption
          checked={local.hotelling}
          onChange={v => {
            set('hotelling', v)
          }}
        >
          {t('analysis:reliability.hotellingOption')}
        </CheckOption>
        <CheckOption
          checked={local.tukey}
          onChange={v => {
            set('tukey', v)
          }}
        >
          {t('analysis:reliability.tukeyOption')}
        </CheckOption>
      </OptionSection>
      <OptionSection titleKey="analysis:reliability.iccSection" grid={false}>
        <CheckOption
          checked={local.icc.enabled}
          onChange={v => {
            setIcc({ enabled: v })
          }}
        >
          {t('analysis:reliability.iccOption')}
        </CheckOption>
        <label className={cx(shellStyles.checkRow, shellStyles.checkRowIndent)}>
          {t('analysis:reliability.iccModelLabel')}
          <select
            className="numField numField--select"
            value={local.icc.model}
            disabled={!local.icc.enabled}
            onChange={e => {
              setIcc({ model: e.target.value as IccModel })
            }}
          >
            {ICC_MODELS.map(m => (
              <option key={m} value={m}>
                {t(`analysis:reliability.iccModel_${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label className={cx(shellStyles.checkRow, shellStyles.checkRowIndent)}>
          {t('analysis:reliability.iccTypeLabel')}
          <select
            className="numField numField--select"
            value={local.icc.type}
            disabled={!local.icc.enabled || local.icc.model === 'oneway'}
            onChange={e => {
              setIcc({ type: e.target.value as IccType })
            }}
          >
            {ICC_TYPES.map(m => (
              <option key={m} value={m}>
                {t(`analysis:reliability.iccType_${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label className={cx(shellStyles.checkRow, shellStyles.checkRowIndent)}>
          {t('analysis:reliability.iccCi')}
          <input
            type="number"
            min="50"
            max="99.9"
            step="1"
            className="numField"
            value={local.icc.ci}
            disabled={!local.icc.enabled}
            onChange={e => {
              setIcc({ ci: Math.min(99.9, Math.max(50, num(e.target.value, 95))) })
            }}
          />
        </label>
        <label className={cx(shellStyles.checkRow, shellStyles.checkRowIndent)}>
          {t('analysis:reliability.iccTestValue')}
          <input
            type="number"
            min="0"
            max="0.99"
            step="0.05"
            className="numField"
            value={local.icc.testValue}
            disabled={!local.icc.enabled}
            onChange={e => {
              setIcc({ testValue: Math.min(0.99, Math.max(0, num(e.target.value, 0))) })
            }}
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

export function ReliabilityDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [options, setOptions] = useState<ReliabilityOptions>(defaultReliabilityOptions)
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:reliability.itemsField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  // Model stays in the main dialog (SPSS keeps its Model list there too);
  // only the extra output toggles move behind "Statistics…".
  const sideButtons: SideButtonDef[] = [
    {
      key: 'statistics',
      labelKey: 'analysis:shell.btnStatistics',
      titleKey: 'analysis:reliability.statisticsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <StatisticsContent options={options} onChange={setOptions} onClose={closeSub} />
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
        analysisId: 'reliability',
        datasetId,
        scriptFile: 'reliability.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          options: reliabilityOptionParams(options)
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:reliability.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'reliability'}
      titleKey="analysis:reliability.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setOptions(defaultReliabilityOptions)
      }}
      generateSyntax={a => buildSyntax.reliability(a['variables'] ?? [], options)}
      extraContent={
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {t('analysis:reliability.modelLabel')}
            <select
              value={options.model}
              onChange={e => {
                setOptions(prev => ({ ...prev, model: e.target.value as ReliabilityModel }))
              }}
              className="numField numField--select"
            >
              {RELIABILITY_MODELS.map(m => (
                <option key={m} value={m}>
                  {t(MODEL_LABEL[m])}
                </option>
              ))}
            </select>
          </label>
        </div>
      }
    />
  )
}
