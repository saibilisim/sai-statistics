// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Independent-Samples T Test dialog — SPSS-style.
 * Mirrors SPSS: Analyze → Compare Means → Independent-Samples T Test
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { PackageNeededDialog } from '../../components/Dialogs/PackageNeededDialog'
import { usePackageGate } from '../../lib/use-package-gate'
import { type MissingStrategy } from '../_shared/MissingValuesSection'
import { MissingValuesOptionsContent } from '../_shared/MissingValuesOptionsContent'
import {
  BootstrapSection,
  buildBootstrapParams,
  defaultBootstrapOptions,
  type BootstrapOptions
} from '../_shared/BootstrapSection'
import { bayesRscale, defaultBayesPrior, type BayesPrior } from '../_bayes/BayesPriorSection'
import { BayesPriorOptionsContent } from '../_bayes/BayesPriorOptions'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { buildSyntax } from '../../lib/spss-syntax'
import { useRunAnalysis } from '../_shared/useRunAnalysis'

interface Props {
  onClose: () => void
  /** Bayesian mode reuses this exact dialog but runs the BayesFactor engine. */
  bayesian?: boolean
}

export function IndependentTTestDialog({ onClose, bayesian = false }: Props) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  // Only the Bayesian path needs the BayesFactor package; gate is a no-op otherwise.
  const { status, install } = usePackageGate('BayesFactor', bayesian)

  const [group1, setGroup1] = useState('')
  const [group2, setGroup2] = useState('')
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
        family="ttest"
      />
    )
  }
  const [missing, setMissing] = useState<MissingStrategy>('analysis')
  const [bootstrap, setBootstrap] = useState<BootstrapOptions>(defaultBootstrapOptions)
  const { running, run } = useRunAnalysis()

  const titleKey = bayesian ? 'analysis:bayesTTestInd.title' : 'analysis:ttestInd.title'

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:ttestInd.testField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric',
      sortMeasure: 'scale' as const
    },
    {
      key: 'group',
      labelKey: 'analysis:ttestInd.groupField',
      single: true
    }
  ]

  const sideButtons: SideButtonDef[] = bayesian
    ? [priorButton]
    : [
        {
          key: 'options',
          labelKey: 'analysis:shell.btnOptions',
          titleKey: 'analysis:ttestInd.optionsTitle',
          renderContent: ({ onClose: closeSub }) => (
            <MissingValuesOptionsContent value={missing} onChange={setMissing} onClose={closeSub} />
          )
        },
        {
          key: 'bootstrap',
          labelKey: 'analysis:shell.btnBootstrap',
          titleKey: 'analysis:shell.btnBootstrap',
          renderContent: ({ onClose: closeSub }) => (
            <BootstrapSection value={bootstrap} onChange={setBootstrap} onClose={closeSub} />
          )
        }
      ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length > 0 &&
    (a['group'] ?? []).length === 1 &&
    group1.trim() !== '' &&
    group2.trim() !== '' &&
    group1.trim() !== group2.trim() &&
    !running

  const generateRCode = (a: Record<string, Variable[]>) => {
    const vars = (a['variables'] ?? []).map(v => v.name)
    const g = (a['group'] ?? [])[0]?.name
    if (vars.length === 0 || !g) return null
    return [
      `g <- data[["${g}"]]`,
      `keep <- g %in% c("${group1}", "${group2}")`,
      `for (v in c(${vars.map(v => `"${v}"`).join(', ')})) {`,
      '  print(t.test(data[[v]][keep] ~ g[keep]))',
      '}'
    ].join('\n')
  }

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    const g = (a['group'] ?? [])[0]
    if (!g) return
    const bootstrapParams = buildBootstrapParams(bootstrap)
    await run(
      {
        analysisId: bayesian ? 'bayesTTestInd' : 'ttestInd',
        datasetId,
        scriptFile: bayesian ? 'bayes-ttest-independent.R' : 'ttest-independent.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          groupVar: g.colId,
          groupName: g.name,
          groupValueLabels: g.valueLabels,
          group1: group1.trim(),
          group2: group2.trim(),
          ...(bayesian
            ? { rscale: bayesRscale(prior) }
            : {
                options: {
                  missing,
                  ...(bootstrapParams ? { bootstrap: bootstrapParams } : {})
                }
              })
        },
        columnFilters
      },
      onClose,
      { titleKey: titleKey, assignments: a }
    )
  }

  // Bayesian mode requires the BayesFactor package — show the install prompt
  // (on-demand) until it is available; the frequentist path is never gated.
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
      analysisId={bayesian ? 'bayesTTestInd' : 'ttestInd'}
      titleKey={titleKey}
      fieldDefs={fieldDefs}
      sideButtons={sideButtons.length > 0 ? sideButtons : undefined}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateRCode={bayesian ? undefined : generateRCode}
      generateSyntax={
        bayesian
          ? a =>
              buildSyntax.bayesTtestInd(
                a['variables'] ?? [],
                a['group'] ?? [],
                group1.trim(),
                group2.trim(),
                bayesRscale(prior)
              )
          : a =>
              buildSyntax.ttestInd(a['variables'] ?? [], a['group'] ?? [], group1, group2, missing)
      }
      extraContent={
        <>
          <div className={shellStyles.optionSection}>
            <div className={shellStyles.optionSectionTitle}>
              {t('analysis:ttestInd.defineGroups')}
            </div>
            <div className={shellStyles.optionGrid}>
              <label className={shellStyles.checkRow}>
                {t('analysis:ttestInd.group1')}
                <input
                  type="text"
                  value={group1}
                  onChange={e => {
                    setGroup1(e.target.value)
                  }}
                  className="numField"
                />
              </label>
              <label className={shellStyles.checkRow}>
                {t('analysis:ttestInd.group2')}
                <input
                  type="text"
                  value={group2}
                  onChange={e => {
                    setGroup2(e.target.value)
                  }}
                  className="numField"
                />
              </label>
            </div>
          </div>
        </>
      }
    />
  )
}
