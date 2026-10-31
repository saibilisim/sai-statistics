// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bivariate Correlations dialog — SPSS-style.
 * Mirrors SPSS: Analyze → Correlate → Bivariate
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
import { buildSyntax } from '../../lib/spss-syntax'
import { PackageNeededDialog } from '../../components/Dialogs/PackageNeededDialog'
import { usePackageGate } from '../../lib/use-package-gate'
import { bayesRscale, defaultBayesPrior, type BayesPrior } from '../_bayes/BayesPriorSection'
import { BayesPriorOptionsContent } from '../_bayes/BayesPriorOptions'
import { MissingValuesSection, type MissingStrategy } from '../_shared/MissingValuesSection'
import {
  BootstrapSection,
  buildBootstrapParams,
  defaultBootstrapOptions,
  type BootstrapOptions
} from '../_shared/BootstrapSection'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { defaultCorrelateOptions, type CorrelateOptions } from '@shared/correlate-types'

/** Statistics + Missing Values, combined in one "Options" sub-dialog (SPSS
 *  keeps them in the same sub-dialog too). Missing Values stays its own typed
 *  MissingStrategy field (shared with Case Summaries/OLAP Cubes/Explore's own
 *  Options sub-dialog) rather than folding into CorrelateOptions. */
function OptionsContent({
  missing,
  extras,
  onChange,
  onClose
}: {
  missing: MissingStrategy
  extras: Omit<CorrelateOptions, 'missing'>
  onChange: (missing: MissingStrategy, extras: Omit<CorrelateOptions, 'missing'>) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [localMissing, setLocalMissing] = useState(missing)
  const [localExtras, setLocalExtras] = useState(extras)

  return (
    <>
      <OptionSection titleKey="analysis:correlate.statisticsTitle" grid={false}>
        <CheckOption
          checked={localExtras.meansAndSD}
          onChange={v => {
            setLocalExtras(o => ({ ...o, meansAndSD: v }))
          }}
        >
          {t('analysis:correlate.meansAndSD')}
        </CheckOption>
        <CheckOption
          checked={localExtras.crossProduct}
          onChange={v => {
            setLocalExtras(o => ({ ...o, crossProduct: v }))
          }}
        >
          {t('analysis:correlate.crossProduct')}
        </CheckOption>
      </OptionSection>
      <MissingValuesSection value={localMissing} onChange={setLocalMissing} variant="pairwise" />
      <SubDialogFooter
        onContinue={() => {
          onChange(localMissing, localExtras)
          onClose()
        }}
        onCancel={onClose}
      />
    </>
  )
}

interface Methods {
  pearson: boolean
  spearman: boolean
  kendall: boolean
}

interface Props {
  onClose: () => void
  bayesian?: boolean
}

export function BivariateCorrelationDialog({ onClose, bayesian = false }: Props) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { status, install } = usePackageGate('BayesFactor', bayesian)

  const [methods, setMethods] = useState<Methods>({
    pearson: true,
    spearman: false,
    kendall: false
  })
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
        family="correlation"
      />
    )
  }
  const [missing, setMissing] = useState<MissingStrategy>('pairwise')
  const [extras, setExtras] = useState<Omit<CorrelateOptions, 'missing'>>({
    oneTailed: defaultCorrelateOptions.oneTailed,
    flagSignificant: defaultCorrelateOptions.flagSignificant,
    meansAndSD: defaultCorrelateOptions.meansAndSD,
    crossProduct: defaultCorrelateOptions.crossProduct
  })
  const [bootstrap, setBootstrap] = useState<BootstrapOptions>(defaultBootstrapOptions)
  const { running, run } = useRunAnalysis()
  const set = (key: keyof Methods, val: boolean) => {
    setMethods(prev => ({ ...prev, [key]: val }))
  }

  const titleKey = bayesian ? 'analysis:bayesCorrelate.title' : 'analysis:correlate.title'

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:correlate.variablesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric',
      sortMeasure: 'scale' as const
    }
  ]

  // The coefficient checkboxes stay in the main dialog (SPSS keeps them there
  // too, and canSubmit depends on them); only missing-values and bootstrap
  // move behind side buttons. Bayesian mode has only Priors…
  const sideButtons: SideButtonDef[] = bayesian
    ? [priorButton]
    : [
        {
          key: 'options',
          labelKey: 'analysis:shell.btnOptions',
          titleKey: 'analysis:correlate.optionsTitle',
          renderContent: ({ onClose: closeSub }) => (
            <OptionsContent
              missing={missing}
              extras={extras}
              onChange={(m, e) => {
                setMissing(m)
                setExtras(e)
              }}
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
        }
      ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length >= 2 &&
    (bayesian || methods.pearson || methods.spearman || methods.kendall) &&
    !running

  const generateRCode = (a: Record<string, Variable[]>) => {
    const vars = (a['variables'] ?? []).map(v => v.name)
    if (vars.length < 2) return null
    const ms = (['pearson', 'spearman', 'kendall'] as const).filter(m => methods[m])
    return [
      `vars <- c(${vars.map(v => `"${v}"`).join(', ')})`,
      ...ms.map(m => `print(cor(data[vars], method = "${m}", use = "pairwise.complete.obs"))`)
    ].join('\n')
  }

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    const bootstrapParams = buildBootstrapParams(bootstrap)
    await run(
      {
        analysisId: bayesian ? 'bayesCorrelate' : 'correlate',
        datasetId,
        scriptFile: bayesian ? 'bayes-correlation.R' : 'correlation.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          ...(bayesian
            ? { rscale: bayesRscale(prior) }
            : {
                methods,
                options: {
                  missing,
                  ...extras,
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

  const checkbox = (key: keyof Methods, labelKey: string) => (
    <CheckOption
      checked={methods[key]}
      onChange={v => {
        set(key, v)
      }}
    >
      {t(labelKey as never)}
    </CheckOption>
  )

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
      analysisId={bayesian ? 'bayesCorrelate' : 'correlate'}
      titleKey={titleKey}
      fieldDefs={fieldDefs}
      sideButtons={sideButtons.length > 0 ? sideButtons : undefined}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateRCode={bayesian ? undefined : generateRCode}
      generateSyntax={
        bayesian
          ? a => buildSyntax.bayesCorrelation(a['variables'] ?? [], bayesRscale(prior))
          : a =>
              buildSyntax.correlations(a['variables'] ?? [], methods, {
                // MissingValuesSection's variant="pairwise" below means `missing`
                // is only ever 'pairwise' or 'listwise' at runtime — narrow the
                // type so it lines up with CorrelateOptions.
                missing: missing === 'listwise' ? 'listwise' : 'pairwise',
                ...extras
              })
      }
      extraContent={
        bayesian ? undefined : (
          <>
            <div className={shellStyles.optionSection}>
              <div className={shellStyles.optionSectionTitle}>
                {t('analysis:correlate.coefficients')}
              </div>
              <div className={shellStyles.optionGrid}>
                {checkbox('pearson', 'analysis:correlate.pearson')}
                {checkbox('kendall', 'analysis:correlate.kendall')}
                {checkbox('spearman', 'analysis:correlate.spearman')}
              </div>
            </div>
            <div className={shellStyles.optionSection}>
              <div className={shellStyles.optionSectionTitle}>
                {t('analysis:correlate.testOfSignificance')}
              </div>
              <div className={shellStyles.optionGrid}>
                <label className={shellStyles.checkRow}>
                  <input
                    type="radio"
                    name="correlate-tails"
                    checked={!extras.oneTailed}
                    onChange={() => {
                      setExtras(o => ({ ...o, oneTailed: false }))
                    }}
                  />
                  {t('analysis:correlate.twoTailed')}
                </label>
                <label className={shellStyles.checkRow}>
                  <input
                    type="radio"
                    name="correlate-tails"
                    checked={extras.oneTailed}
                    onChange={() => {
                      setExtras(o => ({ ...o, oneTailed: true }))
                    }}
                  />
                  {t('analysis:correlate.oneTailed')}
                </label>
              </div>
            </div>
            <div className={shellStyles.optionSection}>
              <CheckOption
                checked={extras.flagSignificant}
                onChange={v => {
                  setExtras(o => ({ ...o, flagSignificant: v }))
                }}
              >
                {t('analysis:correlate.flagSignificant')}
              </CheckOption>
            </div>
          </>
        )
      }
    />
  )
}
