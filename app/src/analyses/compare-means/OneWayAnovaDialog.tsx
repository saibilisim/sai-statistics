// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One-Way ANOVA dialog — SPSS-style.
 * Mirrors SPSS: Analyze → Compare Means → One-Way ANOVA
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
import { buildSyntax } from '../../lib/spss-syntax'
import { useRunAnalysis } from '../_shared/useRunAnalysis'

interface AnovaOptions {
  homogeneity: boolean
  welch: boolean
  brownForsythe: boolean
  meansPlot: boolean
  effectSize: boolean
  tukey: boolean
  bonferroni: boolean
  lsd: boolean
  sidak: boolean
  scheffe: boolean
  gamesHowell: boolean
  tamhaneT2: boolean
  dunnettT3: boolean
  dunnettC: boolean
  hochbergGT2: boolean
  dunnett: boolean
  dunnettControl: 'first' | 'last'
  // Homogeneous-subsets-only procedures (agricolae-backed, see anova-oneway.R):
  // Tukey HSD/Scheffe above ALSO produce a subset table once selected, so they
  // have no separate checkbox here.
  snk: boolean
  duncan: boolean
  regwQ: boolean
  wallerDuncan: boolean
  sigLevel: string
  // MissingValuesSection's onChange is typed against the full MissingStrategy
  // union (it also serves the 'pairwise' variant used by Correlate), but this
  // dialog always renders the default 'analysis' variant, so 'pairwise' is
  // never actually produced here.
  missing: MissingStrategy
}

const defaultOptions: AnovaOptions = {
  homogeneity: false,
  welch: false,
  brownForsythe: false,
  meansPlot: false,
  effectSize: false,
  tukey: false,
  bonferroni: false,
  lsd: false,
  sidak: false,
  scheffe: false,
  gamesHowell: false,
  tamhaneT2: false,
  dunnettT3: false,
  dunnettC: false,
  hochbergGT2: false,
  dunnett: false,
  dunnettControl: 'last',
  snk: false,
  duncan: false,
  regwQ: false,
  wallerDuncan: false,
  sigLevel: '0.05',
  missing: 'analysis'
}

function OptionRow({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <CheckOption
      checked={checked}
      onChange={v => {
        onChange(v)
      }}
    >
      {label}
    </CheckOption>
  )
}

interface Props {
  onClose: () => void
  bayesian?: boolean
}

function PostHocContent({
  options,
  onChange,
  onClose
}: {
  options: AnovaOptions
  onChange: (patch: Partial<AnovaOptions>) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(options)
  const setL = (key: keyof AnovaOptions, val: boolean) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }
  const setLV = <K extends keyof AnovaOptions>(key: K, val: AnovaOptions[K]) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }

  return (
    <>
      <div className={shellStyles.optionSection}>
        <div className={shellStyles.optionSectionTitle}>
          {t('analysis:anova.equalVariancesAssumed')}
        </div>
        <div className={shellStyles.optionGrid}>
          <OptionRow
            checked={local.lsd}
            onChange={v => {
              setL('lsd', v)
            }}
            label={t('analysis:anova.lsd')}
          />
          <OptionRow
            checked={local.bonferroni}
            onChange={v => {
              setL('bonferroni', v)
            }}
            label={t('analysis:anova.bonferroni')}
          />
          <OptionRow
            checked={local.sidak}
            onChange={v => {
              setL('sidak', v)
            }}
            label={t('analysis:anova.sidak')}
          />
          <OptionRow
            checked={local.scheffe}
            onChange={v => {
              setL('scheffe', v)
            }}
            label={t('analysis:anova.scheffe')}
          />
          <OptionRow
            checked={local.tukey}
            onChange={v => {
              setL('tukey', v)
            }}
            label={t('analysis:anova.tukey')}
          />
          <OptionRow
            checked={local.hochbergGT2}
            onChange={v => {
              setL('hochbergGT2', v)
            }}
            label={t('analysis:anova.hochbergGT2')}
          />
        </div>
        <div className={shellStyles.optionSectionTitle}>{t('analysis:anova.homogSubsets')}</div>
        <div className={shellStyles.optionGrid}>
          <OptionRow
            checked={local.snk}
            onChange={v => {
              setL('snk', v)
            }}
            label={t('analysis:anova.snk')}
          />
          <OptionRow
            checked={local.duncan}
            onChange={v => {
              setL('duncan', v)
            }}
            label={t('analysis:anova.duncan')}
          />
          <OptionRow
            checked={local.regwQ}
            onChange={v => {
              setL('regwQ', v)
            }}
            label={t('analysis:anova.regwQ')}
          />
          <OptionRow
            checked={local.wallerDuncan}
            onChange={v => {
              setL('wallerDuncan', v)
            }}
            label={t('analysis:anova.wallerDuncan')}
          />
        </div>
        <div className={shellStyles.optionSectionTitle}>
          {t('analysis:anova.equalVariancesNotAssumed')}
        </div>
        <div className={shellStyles.optionGrid}>
          <OptionRow
            checked={local.gamesHowell}
            onChange={v => {
              setL('gamesHowell', v)
            }}
            label={t('analysis:anova.gamesHowell')}
          />
          <OptionRow
            checked={local.tamhaneT2}
            onChange={v => {
              setL('tamhaneT2', v)
            }}
            label={t('analysis:anova.tamhaneT2')}
          />
          <OptionRow
            checked={local.dunnettT3}
            onChange={v => {
              setL('dunnettT3', v)
            }}
            label={t('analysis:anova.dunnettT3')}
          />
          <OptionRow
            checked={local.dunnettC}
            onChange={v => {
              setL('dunnettC', v)
            }}
            label={t('analysis:anova.dunnettC')}
          />
        </div>
        <div className={shellStyles.optionSectionTitle}>{t('analysis:anova.dunnett')}</div>
        <div className={shellStyles.optionGrid}>
          <OptionRow
            checked={local.dunnett}
            onChange={v => {
              setL('dunnett', v)
            }}
            label={t('analysis:anova.dunnett')}
          />
          <label className={shellStyles.checkRow}>
            {t('analysis:anova.dunnettControl')}
            <select
              value={local.dunnettControl}
              onChange={e => {
                setLV('dunnettControl', e.target.value as 'first' | 'last')
              }}
              className="numField numField--select"
            >
              <option value="last">{t('analysis:anova.dunnettControlLast')}</option>
              <option value="first">{t('analysis:anova.dunnettControlFirst')}</option>
            </select>
          </label>
        </div>
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {t('analysis:anova.sigLevel')}
            <input
              type="number"
              value={local.sigLevel}
              step="any"
              min="0"
              max="1"
              onChange={e => {
                setLV('sigLevel', e.target.value)
              }}
              className="numField"
            />
          </label>
        </div>
      </div>
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

function AnovaOptionsContent({
  options,
  onChange,
  onClose
}: {
  options: AnovaOptions
  onChange: (patch: Partial<AnovaOptions>) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(options)
  const setL = (key: keyof AnovaOptions, val: boolean) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }

  return (
    <>
      <OptionSection>
        <OptionRow
          checked={local.homogeneity}
          onChange={v => {
            setL('homogeneity', v)
          }}
          label={t('analysis:anova.homogeneity')}
        />
        <OptionRow
          checked={local.welch}
          onChange={v => {
            setL('welch', v)
          }}
          label={t('analysis:anova.welch')}
        />
        <OptionRow
          checked={local.brownForsythe}
          onChange={v => {
            setL('brownForsythe', v)
          }}
          label={t('analysis:anova.brownForsythe')}
        />
        <OptionRow
          checked={local.effectSize}
          onChange={v => {
            setL('effectSize', v)
          }}
          label={t('analysis:anova.effectSizeOption')}
        />
        <OptionRow
          checked={local.meansPlot}
          onChange={v => {
            setL('meansPlot', v)
          }}
          label={t('analysis:anova.meansPlot')}
        />
      </OptionSection>
      <MissingValuesSection
        value={local.missing}
        onChange={v => {
          setLocal(prev => ({ ...prev, missing: v }))
        }}
      />
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

export function OneWayAnovaDialog({ onClose, bayesian = false }: Props) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { status, install } = usePackageGate('BayesFactor', bayesian)

  const [options, setOptions] = useState<AnovaOptions>(defaultOptions)
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
        family="anovaFixed"
      />
    )
  }
  const [bootstrap, setBootstrap] = useState<BootstrapOptions>(defaultBootstrapOptions)
  const { running, run } = useRunAnalysis()

  const titleKey = bayesian ? 'analysis:bayesAnova.title' : 'analysis:anova.title'
  const fieldDefs = [
    {
      key: 'dependent',
      labelKey: 'analysis:anova.dependentField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric',
      sortMeasure: 'scale' as const
    },
    {
      key: 'factor',
      labelKey: 'analysis:anova.factorField',
      single: true
    }
  ]

  const sideButtons: SideButtonDef[] = [
    {
      key: 'posthoc',
      labelKey: 'analysis:shell.btnPostHoc',
      titleKey: 'analysis:anova.postHocTitle',
      renderContent: ({ onClose: closeSub }) => (
        <PostHocContent
          options={options}
          onChange={patch => {
            setOptions(prev => ({ ...prev, ...patch }))
          }}
          onClose={closeSub}
        />
      )
    },
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:anova.optionsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <AnovaOptionsContent
          options={options}
          onChange={patch => {
            setOptions(prev => ({ ...prev, ...patch }))
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
    (a['dependent'] ?? []).length > 0 && (a['factor'] ?? []).length === 1 && !running

  const generateRCode = (a: Record<string, Variable[]>) => {
    const deps = (a['dependent'] ?? []).map(v => v.name)
    const f = (a['factor'] ?? [])[0]?.name
    if (deps.length === 0 || !f) return null
    return [
      '# SAI Statistics — One-Way ANOVA',
      `for (v in c(${deps.map(v => `"${v}"`).join(', ')})) {`,
      `  print(summary(aov(df[[v]] ~ factor(df[["${f}"]]))))`,
      '}'
    ].join('\n')
  }

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const deps = a['dependent'] ?? []
    const f = (a['factor'] ?? [])[0]
    if (!f) return
    const bootstrapParams = buildBootstrapParams(bootstrap)
    await run(
      {
        analysisId: bayesian ? 'bayesAnova' : 'anova',
        datasetId,
        scriptFile: bayesian ? 'bayes-anova.R' : 'anova-oneway.R',
        params: {
          variables: deps.map(v => v.colId),
          varNames: Object.fromEntries(deps.map(v => [v.colId, v.name])),
          factor: f.colId,
          factorName: f.name,
          ...(bayesian
            ? { rscale: bayesRscale(prior) }
            : {
                options: {
                  ...options,
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
      analysisId={bayesian ? 'bayesAnova' : 'anova'}
      titleKey={titleKey}
      fieldDefs={fieldDefs}
      sideButtons={bayesian ? [priorButton] : sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateRCode={bayesian ? undefined : generateRCode}
      generateSyntax={
        bayesian
          ? a => buildSyntax.bayesAnova(a['dependent'] ?? [], a['factor'] ?? [], bayesRscale(prior))
          : a => buildSyntax.oneway(a['dependent'] ?? [], a['factor'] ?? [], options)
      }
    />
  )
}
