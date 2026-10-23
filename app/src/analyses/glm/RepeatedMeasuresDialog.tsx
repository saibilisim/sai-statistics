// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GLM Repeated Measures dialog — SPSS-style: one within-subject factor (one
 * column per level, in level order), optional between-subjects factors and
 * covariates.
 * Analyze → General Linear Model → Repeated Measures
 *
 * Sub-dialogs as SPSS: Plots (profile plot), Post Hoc (between factors — the
 * GLM panel), EM Means and Options (the GLM panels, extended with the within
 * factor). Multivariate tests and the polynomial within-subjects contrasts
 * are always printed, as SPSS does. Not offered: Model (custom terms),
 * Contrasts other than polynomial, Save.
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
import { EmMeansContent, OptionsContent, PostHocContent } from './GlmSubDialogs'
import {
  defaultEmMeans,
  defaultModel,
  defaultOptions,
  defaultPostHoc,
  glmOptionsPayload
} from './glm-options'

interface ProfilePlot {
  horizontal: string
  lines: string
  errorBars: boolean
}
const defaultPlot: ProfilePlot = { horizontal: '', lines: '', errorBars: false }

/** "WITHIN" stands for the within-subject factor in every option the R
 *  script reads (glm-repeated.R header). */
const WITHIN = 'WITHIN'

function PlotsContent({
  value,
  onChange,
  onClose,
  factorName,
  betweenVars
}: {
  value: ProfilePlot
  onChange: (v: ProfilePlot) => void
  onClose: () => void
  factorName: string
  betweenVars: Variable[]
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)
  const choices = [
    { id: WITHIN, label: factorName },
    ...betweenVars.map(v => ({ id: v.colId, label: v.name }))
  ]
  return (
    <>
      <OptionSection titleKey="analysis:glmRep.profilePlot" grid={false}>
        <label className={shellStyles.checkRow}>
          {t('analysis:glmRep.horizontalAxis')}
          <select
            value={local.horizontal}
            onChange={e => {
              const h = e.target.value
              setLocal(prev => ({
                ...prev,
                horizontal: h,
                lines: prev.lines === h ? '' : prev.lines
              }))
            }}
          >
            <option value="">{t('analysis:glmRep.noPlot')}</option>
            {choices.map(c => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={shellStyles.checkRow}>
          {t('analysis:glmRep.separateLines')}
          <select
            value={local.lines}
            disabled={!local.horizontal}
            onChange={e => {
              setLocal(prev => ({ ...prev, lines: e.target.value }))
            }}
          >
            <option value="">{t('analysis:glmRep.noLines')}</option>
            {choices
              .filter(c => c.id !== local.horizontal)
              .map(c => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
          </select>
        </label>
        <CheckOption
          checked={local.errorBars}
          disabled={!local.horizontal}
          onChange={v => {
            setLocal(prev => ({ ...prev, errorBars: v }))
          }}
        >
          {t('analysis:glmRep.errorBars')}
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

export function RepeatedMeasuresDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [factorName, setFactorName] = useState('factor1')
  const [postHoc, setPostHoc] = useState(defaultPostHoc)
  const [emMeans, setEmMeans] = useState(defaultEmMeans)
  const [options, setOptions] = useState(defaultOptions)
  const [plot, setPlot] = useState<ProfilePlot>(defaultPlot)
  const { running, run } = useRunAnalysis()
  const wname = factorName.trim() || 'factor1'

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:glmRep.variablesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    },
    { key: 'between', labelKey: 'analysis:glmRep.betweenField', single: false },
    {
      key: 'covariates',
      labelKey: 'analysis:glmUni.covariatesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length >= 2 && factorName.trim() !== '' && !running

  const sideButtons: SideButtonDef[] = [
    {
      key: 'plots',
      labelKey: 'analysis:shell.btnPlots',
      titleKey: 'analysis:glmRep.plotsTitleDlg',
      renderContent: ({ onClose: closeSub, assignments }) => (
        <PlotsContent
          value={plot}
          onChange={setPlot}
          onClose={closeSub}
          factorName={wname}
          betweenVars={assignments['between'] ?? []}
        />
      )
    },
    {
      key: 'posthoc',
      labelKey: 'analysis:shell.btnPostHoc',
      titleKey: 'analysis:glmRep.postHocTitleDlg',
      renderContent: ({ onClose: closeSub, assignments }) => (
        <PostHocContent
          value={postHoc}
          onChange={setPostHoc}
          onClose={closeSub}
          factorVars={assignments['between'] ?? []}
        />
      ),
      disabled: a => (a['between'] ?? []).length === 0
    },
    {
      key: 'emmeans',
      labelKey: 'analysis:shell.btnEmMeans',
      titleKey: 'analysis:glmRep.emMeansTitleDlg',
      renderContent: ({ onClose: closeSub, assignments }) => (
        <EmMeansContent
          value={emMeans}
          onChange={setEmMeans}
          onClose={closeSub}
          factorVars={assignments['between'] ?? []}
          extraMainTerms={[{ term: WITHIN, label: wname }]}
          extraInteractionTerms={(assignments['between'] ?? []).map(v => ({
            term: `${WITHIN}*${v.colId}`,
            label: `${v.name} * ${wname}`
          }))}
        />
      )
    },
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:glmRep.optionsTitleDlg',
      renderContent: ({ onClose: closeSub }) => (
        <OptionsContent
          value={options}
          onChange={setOptions}
          onClose={closeSub}
          showParamEstimates={false}
        />
      )
    }
  ]

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    const between = a['between'] ?? []
    const covs = a['covariates'] ?? []
    const known = new Set([WITHIN, ...between.map(v => v.colId)])
    const ph = glmOptionsPayload(
      { model: defaultModel, postHoc, emMeans: defaultEmMeans, options, contrasts: {} },
      between
    ).postHoc
    await run(
      {
        analysisId: 'glmRep',
        datasetId,
        scriptFile: 'glm-repeated.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          factorName: wname,
          betweenFactors: between.map(v => v.colId),
          betweenNames: Object.fromEntries(between.map(v => [v.colId, v.name])),
          covariates: covs.map(v => v.colId),
          covariateNames: Object.fromEntries(covs.map(v => [v.colId, v.name])),
          options: {
            descriptives: options.descriptives,
            effectSize: options.effectSize,
            power: options.power,
            homogeneity: options.homogeneity,
            sigLevel: options.sigLevel,
            ...(emMeans.terms.length > 0 ? { emMeans } : {}),
            // A plot axis that names a between factor no longer assigned is dropped.
            ...(plot.horizontal && known.has(plot.horizontal)
              ? {
                  profilePlot: {
                    horizontal: plot.horizontal,
                    lines: plot.lines && known.has(plot.lines) ? plot.lines : null,
                    errorBars: plot.errorBars
                  }
                }
              : {}),
            ...(ph ? { postHoc: ph } : {})
          }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:glmRep.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'glmRep'}
      titleKey="analysis:glmRep.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setFactorName('factor1')
        setPostHoc(defaultPostHoc)
        setEmMeans(defaultEmMeans)
        setOptions(defaultOptions)
        setPlot(defaultPlot)
      }}
      generateSyntax={a =>
        buildSyntax.glmRepeated(a['variables'] ?? [], wname, {
          between: a['between'] ?? [],
          covariates: a['covariates'] ?? [],
          descriptives: options.descriptives,
          effectSize: options.effectSize,
          power: options.power,
          homogeneity: options.homogeneity,
          sigLevel: options.sigLevel
        })
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {t('analysis:glmRep.factorNameLabel')}
            <input
              type="text"
              value={factorName}
              onChange={e => {
                setFactorName(e.target.value)
              }}
              className="numField numField--lg"
            />
          </label>
        </div>
      }
    />
  )
}
