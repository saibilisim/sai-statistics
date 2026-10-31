// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Paired-Samples T Test dialog — SPSS-style.
 * Mirrors SPSS: Analyze → Compare Means → Paired-Samples T Test
 *
 * Variables placed in "Variable 1" and "Variable 2" are zipped index-wise into
 * pairs (pair i = var1[i] vs var2[i]).
 */

import { useState } from 'react'
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
import { buildSyntax } from '../../lib/spss-syntax'
import { useRunAnalysis } from '../_shared/useRunAnalysis'

interface Props {
  onClose: () => void
  bayesian?: boolean
}

export function PairedTTestDialog({ onClose, bayesian = false }: Props) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { status, install } = usePackageGate('BayesFactor', bayesian)

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

  const titleKey = bayesian ? 'analysis:bayesTTestPaired.title' : 'analysis:ttestPaired.title'

  const fieldDefs = [
    {
      key: 'var1',
      labelKey: 'analysis:ttestPaired.var1Field',
      single: false,
      filter: (v: Variable) => v.type === 'numeric',
      sortMeasure: 'scale' as const
    },
    {
      key: 'var2',
      labelKey: 'analysis:ttestPaired.var2Field',
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
          titleKey: 'analysis:ttestPaired.optionsTitle',
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

  const canSubmit = (a: Record<string, Variable[]>) => {
    const n1 = (a['var1'] ?? []).length
    const n2 = (a['var2'] ?? []).length
    return n1 > 0 && n1 === n2 && !running
  }

  const generateRCode = (a: Record<string, Variable[]>) => {
    const v1 = (a['var1'] ?? []).map(v => v.name)
    const v2 = (a['var2'] ?? []).map(v => v.name)
    if (v1.length === 0 || v1.length !== v2.length) return null
    const lines: string[] = []
    v1.forEach((a1, i) => {
      lines.push(`print(t.test(data[["${a1}"]], data[["${v2[i] ?? ''}"]], paired = TRUE))`)
    })
    return lines.join('\n')
  }

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const v1 = a['var1'] ?? []
    const v2 = a['var2'] ?? []
    const bootstrapParams = buildBootstrapParams(bootstrap)
    await run(
      {
        analysisId: bayesian ? 'bayesTTestPaired' : 'ttestPaired',
        datasetId,
        scriptFile: bayesian ? 'bayes-ttest-paired.R' : 'ttest-paired.R',
        params: {
          var1: v1.map(v => v.colId),
          var2: v2.map(v => v.colId),
          varNames: Object.fromEntries([...v1, ...v2].map(v => [v.colId, v.name])),
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
      analysisId={bayesian ? 'bayesTTestPaired' : 'ttestPaired'}
      titleKey={titleKey}
      fieldDefs={fieldDefs}
      sideButtons={sideButtons.length > 0 ? sideButtons : undefined}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateRCode={bayesian ? undefined : generateRCode}
      generateSyntax={
        bayesian
          ? a => buildSyntax.bayesTtestPaired(a['var1'] ?? [], a['var2'] ?? [], bayesRscale(prior))
          : a => buildSyntax.ttestPaired(a['var1'] ?? [], a['var2'] ?? [], missing)
      }
    />
  )
}
