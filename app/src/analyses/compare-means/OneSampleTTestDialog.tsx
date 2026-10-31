// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One-Sample T Test dialog — SPSS-style.
 * Mirrors SPSS: Analyze → Compare Means → One-Sample T Test
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { PackageNeededDialog } from '../../components/Dialogs/PackageNeededDialog'
import { usePackageGate } from '../../lib/use-package-gate'
import { bayesRscale, defaultBayesPrior, type BayesPrior } from '../_bayes/BayesPriorSection'
import { BayesPriorOptionsContent } from '../_bayes/BayesPriorOptions'
import { type MissingStrategy } from '../_shared/MissingValuesSection'
import { MissingValuesOptionsContent } from '../_shared/MissingValuesOptionsContent'
import {
  BootstrapSection,
  buildBootstrapParams,
  defaultBootstrapOptions,
  type BootstrapOptions
} from '../_shared/BootstrapSection'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { buildSyntax } from '../../lib/spss-syntax'
import { useRunAnalysis } from '../_shared/useRunAnalysis'

interface Props {
  onClose: () => void
  bayesian?: boolean
}

export function OneSampleTTestDialog({ onClose, bayesian = false }: Props) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { status, install } = usePackageGate('BayesFactor', bayesian)

  const [testValue, setTestValue] = useState('0')
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

  const titleKey = bayesian ? 'analysis:bayesTTest1.title' : 'analysis:ttest1.title'

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:ttest1.testField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric',
      sortMeasure: 'scale' as const
    }
  ]

  // Bayesian mode has no missing/bootstrap options — its only knob is the
  // prior, behind its own Priors… button.
  const sideButtons: SideButtonDef[] = bayesian
    ? [priorButton]
    : [
        {
          key: 'options',
          labelKey: 'analysis:shell.btnOptions',
          titleKey: 'analysis:ttest1.optionsTitle',
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
    (a['variables'] ?? []).length > 0 && testValue.trim() !== '' && !running

  const generateRCode = (a: Record<string, Variable[]>) => {
    const vars = (a['variables'] ?? []).map(v => v.name)
    if (vars.length === 0) return null
    const mu = Number(testValue) || 0
    return [
      `for (v in c(${vars.map(v => `"${v}"`).join(', ')})) {`,
      `  print(t.test(data[[v]], mu = ${String(mu)}))`,
      '}'
    ].join('\n')
  }

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    const bootstrapParams = buildBootstrapParams(bootstrap)
    await run(
      {
        analysisId: bayesian ? 'bayesTTest1' : 'ttest1',
        datasetId,
        scriptFile: bayesian ? 'bayes-ttest-onesample.R' : 'ttest-onesample.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          testValue: Number(testValue) || 0,
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
      analysisId={bayesian ? 'bayesTTest1' : 'ttest1'}
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
              buildSyntax.bayesTtest1(
                a['variables'] ?? [],
                Number(testValue) || 0,
                bayesRscale(prior)
              )
          : a => buildSyntax.ttest1(a['variables'] ?? [], testValue, missing)
      }
      extraContent={
        <>
          <div className={shellStyles.optionSection}>
            <label className={shellStyles.checkRow}>
              {t('analysis:ttest1.testValue')}
              <input
                type="number"
                value={testValue}
                step="any"
                onChange={e => {
                  setTestValue(e.target.value)
                }}
                className="numField"
              />
            </label>
          </div>
        </>
      }
    />
  )
}
