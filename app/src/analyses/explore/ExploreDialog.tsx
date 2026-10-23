// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Explore analysis dialog — SPSS-style.
 * Mirrors SPSS: Analyze → Descriptive Statistics → Explore
 */

import { useState, useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  CheckOption,
  OptionSection,
  SubDialogFooter,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { buildSyntax } from '../../lib/spss-syntax'
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
import { useRunAnalysis } from '../_shared/useRunAnalysis'

// ─────────────────────────────────────────────────────────────
//  Options state
// ─────────────────────────────────────────────────────────────

type DisplayMode = 'both' | 'statistics' | 'plots'

interface ExploreStats {
  descriptives: boolean
  percentiles: boolean
  mEstimators: boolean
  outliers: boolean
}

interface ExplorePlots {
  boxplot: boolean
  histogram: boolean
  normality: boolean
}

interface ExploreOptions {
  display: DisplayMode
  stats: ExploreStats
  plots: ExplorePlots
}

const defaultOptions: ExploreOptions = {
  display: 'both',
  stats: { descriptives: true, percentiles: false, mEstimators: false, outliers: false },
  plots: { boxplot: true, histogram: false, normality: false }
}

// ─────────────────────────────────────────────────────────────
//  Statistics sub-dialog
// ─────────────────────────────────────────────────────────────

function StatisticsContent({
  stats,
  onChange,
  onClose
}: {
  stats: ExploreStats
  onChange: (s: ExploreStats) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(stats)
  const set = (key: keyof ExploreStats, val: boolean) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }

  return (
    <>
      <OptionSection>
        <CheckOption
          checked={local.descriptives}
          onChange={v => {
            set('descriptives', v)
          }}
        >
          {t('analysis:explore.stats.descriptives')}
        </CheckOption>
        <CheckOption
          checked={local.percentiles}
          onChange={v => {
            set('percentiles', v)
          }}
        >
          {t('analysis:explore.stats.percentiles')}
        </CheckOption>
        <CheckOption
          checked={local.mEstimators}
          onChange={v => {
            set('mEstimators', v)
          }}
        >
          {t('analysis:explore.stats.mEstimators')}
        </CheckOption>
        <CheckOption
          checked={local.outliers}
          onChange={v => {
            set('outliers', v)
          }}
        >
          {t('analysis:explore.stats.outliers')}
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

// ─────────────────────────────────────────────────────────────
//  Plots sub-dialog
// ─────────────────────────────────────────────────────────────

function PlotsContent({
  plots,
  onChange,
  onClose
}: {
  plots: ExplorePlots
  onChange: (p: ExplorePlots) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(plots)
  const set = (key: keyof ExplorePlots, val: boolean) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }

  return (
    <>
      <OptionSection>
        <CheckOption
          checked={local.boxplot}
          onChange={v => {
            set('boxplot', v)
          }}
        >
          {t('analysis:explore.plots.boxplot')}
        </CheckOption>
        <CheckOption
          checked={local.histogram}
          onChange={v => {
            set('histogram', v)
          }}
        >
          {t('analysis:explore.plots.histogram')}
        </CheckOption>
        <CheckOption
          checked={local.normality}
          onChange={v => {
            set('normality', v)
          }}
        >
          {t('analysis:explore.plots.normality')}
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

// ─────────────────────────────────────────────────────────────
//  Main dialog
// ─────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
}

export function ExploreDialog({ onClose }: Props) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const uid = useId()

  const [options, setOptions] = useState<ExploreOptions>(defaultOptions)
  // SPSS EXAMINE's own default is listwise (verified: job-missing.sps), so the
  // dialog starts there too; "analysis by analysis" remains as a beyond-SPSS
  // per-variable mode.
  const [missing, setMissing] = useState<MissingStrategy>('listwise')
  const [bootstrap, setBootstrap] = useState<BootstrapOptions>(defaultBootstrapOptions)
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'dependent',
      labelKey: 'analysis:explore.dependentField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    },
    {
      key: 'factor',
      labelKey: 'analysis:explore.factorField',
      single: false
    },
    {
      key: 'labelBy',
      labelKey: 'analysis:explore.labelByField',
      single: true
    }
  ]

  const sideButtons: SideButtonDef[] = [
    {
      key: 'statistics',
      labelKey: 'analysis:shell.btnStatistics',
      titleKey: 'analysis:explore.statisticsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <StatisticsContent
          stats={options.stats}
          onChange={stats => {
            setOptions(prev => ({ ...prev, stats }))
          }}
          onClose={closeSub}
        />
      )
    },
    {
      key: 'plots',
      labelKey: 'analysis:shell.btnPlots',
      titleKey: 'analysis:explore.plotsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <PlotsContent
          plots={options.plots}
          onChange={plots => {
            setOptions(prev => ({ ...prev, plots }))
          }}
          onClose={closeSub}
        />
      )
    },
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:explore.optionsTitle',
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

  const canSubmit = (assignments: Record<string, Variable[]>) =>
    (assignments['dependent'] ?? []).length > 0 && !running

  const generateRCode = (assignments: Record<string, Variable[]>) => {
    const deps = (assignments['dependent'] ?? []).map(v => v.name)
    if (deps.length === 0) return null
    const factors = (assignments['factor'] ?? []).map(v => v.name)
    const labelBy = assignments['labelBy']?.[0]?.name
    const depStr = deps.map(v => `"${v}"`).join(', ')
    const lines = ['# SAI Statistics — Explore', `explore_vars <- c(${depStr})`, '']
    if (factors.length > 0) {
      lines.push(`# grouped by: ${factors.join(', ')}`)
    }
    if (labelBy) {
      lines.push(`# label cases by: ${labelBy}`)
    }
    lines.push('for (v in explore_vars) {', '  print(summary(df[[v]]))', '}')
    return lines.join('\n')
  }

  const handleSubmit = async (assignments: Record<string, Variable[]>) => {
    if (!datasetId) return
    const deps = assignments['dependent'] ?? []
    const factors = assignments['factor'] ?? []
    const labelBy = assignments['labelBy']?.[0]
    const bootstrapParams = buildBootstrapParams(bootstrap)

    await run(
      {
        analysisId: 'explore',
        datasetId,
        scriptFile: 'explore.R',
        params: {
          variables: deps.map(v => v.colId),
          varNames: Object.fromEntries(deps.map(v => [v.colId, v.label || v.name])),
          factors: factors.map(v => v.colId),
          factorNames: Object.fromEntries(factors.map(v => [v.colId, v.label || v.name])),
          ...(factors.some(v => Object.keys(v.valueLabels).length > 0)
            ? { factorValueLabels: Object.fromEntries(factors.map(v => [v.colId, v.valueLabels])) }
            : {}),
          ...(labelBy
            ? { labelBy: labelBy.colId, labelByName: labelBy.label || labelBy.name }
            : {}),
          options: {
            display: options.display,
            stats: options.stats,
            plots: options.plots,
            missing,
            ...(bootstrapParams ? { bootstrap: bootstrapParams } : {})
          }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:explore.title', assignments: assignments }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'explore'}
      titleKey="analysis:explore.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={assignments => void handleSubmit(assignments)}
      onCancel={onClose}
      generateRCode={generateRCode}
      generateSyntax={a =>
        buildSyntax.examine(a['dependent'] ?? [], a['factor'] ?? [], a['labelBy']?.[0], missing, {
          stats: options.stats,
          plots: options.plots
        })
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <div className={shellStyles.optionSectionTitle}>{t('analysis:explore.displayTitle')}</div>
          {(['both', 'statistics', 'plots'] as const).map(mode => (
            <label key={mode} className={shellStyles.checkRow}>
              <input
                type="radio"
                name={`${uid}-display`}
                checked={options.display === mode}
                onChange={() => {
                  setOptions(prev => ({ ...prev, display: mode }))
                }}
              />
              {t(`analysis:explore.display_${mode}`)}
            </label>
          ))}
        </div>
      }
    />
  )
}
