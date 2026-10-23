// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Frequencies analysis dialog — SPSS-style.
 * Mirrors SPSS: Analyze → Descriptive Statistics → Frequencies
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
import { ValueListEditor } from '../_shared/ValueListEditor'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from '../_shared/useRunAnalysis'

// ─────────────────────────────────────────────────────────────
//  Options state
// ─────────────────────────────────────────────────────────────

interface FrequenciesStatistics {
  quartiles: boolean
  percentiles: boolean
  /** User-entered percentile values (SPSS's "Percentile(s):" list). Empty while
   *  `percentiles` is on means the fixed 5/10/25/50/75/90/95 default list. */
  customPercentiles: number[]
  /** SPSS's "Cut points for N equal groups"; null = unchecked. */
  cutPoints: number | null
  mean: boolean
  median: boolean
  mode: boolean
  sum: boolean
  sd: boolean
  variance: boolean
  range: boolean
  min: boolean
  max: boolean
  semean: boolean
  cv: boolean
  skewness: boolean
  kurtosis: boolean
}

/** The plain on/off entries — the two list/number entries above are set
 *  directly, so `set()` stays boolean-typed. */
type BoolStatKey = Exclude<keyof FrequenciesStatistics, 'customPercentiles' | 'cutPoints'>

interface FrequenciesCharts {
  type: 'none' | 'barChart' | 'pieChart' | 'histogram'
  showNormalCurve: boolean
}

interface FrequenciesOptions {
  showTable: boolean
  order: 'ascending' | 'descending' | 'ascFreq' | 'descFreq'
  statistics: FrequenciesStatistics
  charts: FrequenciesCharts
}

const defaultOptions: FrequenciesOptions = {
  showTable: true,
  order: 'ascending',
  statistics: {
    quartiles: false,
    percentiles: false,
    customPercentiles: [],
    cutPoints: null,
    mean: false,
    median: false,
    mode: false,
    sum: false,
    sd: false,
    variance: false,
    range: false,
    min: false,
    max: false,
    semean: false,
    cv: false,
    skewness: false,
    kurtosis: false
  },
  charts: {
    type: 'none',
    showNormalCurve: false
  }
}

// ─────────────────────────────────────────────────────────────
//  Statistics sub-dialog
// ─────────────────────────────────────────────────────────────

function StatisticsContent({
  stats,
  onChange,
  onClose
}: {
  stats: FrequenciesStatistics
  onChange: (s: FrequenciesStatistics) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(stats)
  const set = (key: BoolStatKey, val: boolean) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }

  return (
    <>
      <OptionSection titleKey="analysis:frequencies.stats.percentileValues">
        <CheckOption
          checked={local.quartiles}
          onChange={v => {
            set('quartiles', v)
          }}
        >
          {t('analysis:frequencies.stats.quartiles')}
        </CheckOption>
        <label className={shellStyles.checkRow}>
          <input
            type="checkbox"
            checked={local.cutPoints !== null}
            onChange={e => {
              setLocal(prev => ({ ...prev, cutPoints: e.target.checked ? 10 : null }))
            }}
          />
          {t('analysis:frequencies.stats.cutPointsBefore')}
          <input
            type="number"
            className="numField--sm"
            min={2}
            max={100}
            value={local.cutPoints ?? ''}
            disabled={local.cutPoints === null}
            onChange={e => {
              const n = Number(e.target.value)
              setLocal(prev => ({
                ...prev,
                cutPoints:
                  Number.isFinite(n) && n >= 2 ? Math.min(100, Math.trunc(n)) : prev.cutPoints
              }))
            }}
          />
          {t('analysis:frequencies.stats.cutPointsAfter')}
        </label>
        <CheckOption
          checked={local.percentiles}
          onChange={v => {
            set('percentiles', v)
          }}
        >
          {t('analysis:frequencies.stats.percentiles')}
        </CheckOption>
        {local.percentiles && (
          <ValueListEditor
            label={t('analysis:frequencies.stats.percentileValue')}
            values={local.customPercentiles}
            min={0}
            max={100}
            onChange={v => {
              setLocal(prev => ({ ...prev, customPercentiles: v }))
            }}
          />
        )}
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:frequencies.stats.centralTendency">
        <CheckOption
          checked={local.mean}
          onChange={v => {
            set('mean', v)
          }}
        >
          {t('analysis:frequencies.stats.mean')}
        </CheckOption>
        <CheckOption
          checked={local.mode}
          onChange={v => {
            set('mode', v)
          }}
        >
          {t('analysis:frequencies.stats.mode')}
        </CheckOption>
        <CheckOption
          checked={local.median}
          onChange={v => {
            set('median', v)
          }}
        >
          {t('analysis:frequencies.stats.median')}
        </CheckOption>
        <CheckOption
          checked={local.sum}
          onChange={v => {
            set('sum', v)
          }}
        >
          {t('analysis:frequencies.stats.sum')}
        </CheckOption>
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:frequencies.stats.dispersion">
        <CheckOption
          checked={local.sd}
          onChange={v => {
            set('sd', v)
          }}
        >
          {t('analysis:frequencies.stats.sd')}
        </CheckOption>
        <CheckOption
          checked={local.min}
          onChange={v => {
            set('min', v)
          }}
        >
          {t('analysis:frequencies.stats.min')}
        </CheckOption>
        <CheckOption
          checked={local.variance}
          onChange={v => {
            set('variance', v)
          }}
        >
          {t('analysis:frequencies.stats.variance')}
        </CheckOption>
        <CheckOption
          checked={local.max}
          onChange={v => {
            set('max', v)
          }}
        >
          {t('analysis:frequencies.stats.max')}
        </CheckOption>
        <CheckOption
          checked={local.range}
          onChange={v => {
            set('range', v)
          }}
        >
          {t('analysis:frequencies.stats.range')}
        </CheckOption>
        <CheckOption
          checked={local.semean}
          onChange={v => {
            set('semean', v)
          }}
        >
          {t('analysis:frequencies.stats.semean')}
        </CheckOption>
        <CheckOption
          checked={local.cv}
          onChange={v => {
            set('cv', v)
          }}
        >
          {t('analysis:frequencies.stats.cv')}
        </CheckOption>
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:frequencies.stats.distribution">
        <CheckOption
          checked={local.skewness}
          onChange={v => {
            set('skewness', v)
          }}
        >
          {t('analysis:frequencies.stats.skewness')}
        </CheckOption>
        <CheckOption
          checked={local.kurtosis}
          onChange={v => {
            set('kurtosis', v)
          }}
        >
          {t('analysis:frequencies.stats.kurtosis')}
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
//  Charts sub-dialog
// ─────────────────────────────────────────────────────────────

function ChartsContent({
  charts,
  onChange,
  onClose
}: {
  charts: FrequenciesCharts
  onChange: (c: FrequenciesCharts) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(charts)

  return (
    <>
      <div className={shellStyles.optionSection}>
        <div className={shellStyles.optionSectionTitle}>
          {t('analysis:frequencies.charts.type')}
        </div>
        {(['none', 'barChart', 'pieChart', 'histogram'] as const).map(type => (
          <label key={type} className={shellStyles.checkRow}>
            <input
              type="radio"
              name="chart-type"
              checked={local.type === type}
              onChange={() => {
                setLocal(prev => ({ ...prev, type }))
              }}
            />
            {t(`analysis:frequencies.charts.type_${type}`)}
          </label>
        ))}
      </div>

      {local.type === 'histogram' && (
        <>
          <hr className={shellStyles.separator} />
          <div className={shellStyles.optionSection}>
            <CheckOption
              checked={local.showNormalCurve}
              onChange={v => {
                setLocal(prev => ({ ...prev, showNormalCurve: v }))
              }}
            >
              {t('analysis:frequencies.charts.normalCurve')}
            </CheckOption>
          </div>
        </>
      )}

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
//  Format sub-dialog
// ─────────────────────────────────────────────────────────────

function FormatContent({
  order,
  onChange,
  onClose
}: {
  order: FrequenciesOptions['order']
  onChange: (o: FrequenciesOptions['order']) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(order)

  return (
    <>
      <div className={shellStyles.optionSection}>
        <div className={shellStyles.optionSectionTitle}>
          {t('analysis:frequencies.format.order')}
        </div>
        {(['ascending', 'descending', 'ascFreq', 'descFreq'] as const).map(o => (
          <label key={o} className={shellStyles.checkRow}>
            <input
              type="radio"
              name="freq-order"
              checked={local === o}
              onChange={() => {
                setLocal(o)
              }}
            />
            {t(`analysis:frequencies.format.order_${o}`)}
          </label>
        ))}
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

// ─────────────────────────────────────────────────────────────
//  Main dialog
// ─────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
}

export function FrequenciesDialog({ onClose }: Props) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)

  const [options, setOptions] = useState<FrequenciesOptions>(defaultOptions)
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:frequencies.variablesField',
      single: false
    }
  ]

  const sideButtons: SideButtonDef[] = [
    {
      key: 'statistics',
      labelKey: 'analysis:shell.btnStatistics',
      titleKey: 'analysis:frequencies.statisticsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <StatisticsContent
          stats={options.statistics}
          onChange={stats => {
            setOptions(prev => ({ ...prev, statistics: stats }))
          }}
          onClose={closeSub}
        />
      )
    },
    {
      key: 'charts',
      labelKey: 'analysis:shell.btnCharts',
      titleKey: 'analysis:frequencies.chartsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <ChartsContent
          charts={options.charts}
          onChange={charts => {
            setOptions(prev => ({ ...prev, charts }))
          }}
          onClose={closeSub}
        />
      )
    },
    {
      key: 'format',
      labelKey: 'analysis:shell.btnFormat',
      titleKey: 'analysis:frequencies.formatTitle',
      renderContent: ({ onClose: closeSub }) => (
        <FormatContent
          order={options.order}
          onChange={order => {
            setOptions(prev => ({ ...prev, order }))
          }}
          onClose={closeSub}
        />
      )
    }
  ]

  const canSubmit = (assignments: Record<string, Variable[]>) =>
    (assignments['variables'] ?? []).length > 0 && !running

  const generateRCode = (assignments: Record<string, Variable[]>) => {
    const vars = (assignments['variables'] ?? []).map(v => v.name)
    if (vars.length === 0) return null
    const varStr = vars.map(v => `"${v}"`).join(', ')
    return [
      '# SAI Statistics — Frequency Tables',
      `freq_vars <- c(${varStr})`,
      '',
      'for (v in freq_vars) {',
      '  cat("\\nFrequency table for:", v, "\\n")',
      '  print(table(df[[v]], useNA = "always"))',
      '}'
    ].join('\n')
  }

  const handleSubmit = async (assignments: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = assignments['variables'] ?? []
    const varNames = Object.fromEntries(vars.map(v => [v.colId, v.name]))

    await run(
      {
        analysisId: 'frequencies',
        datasetId,
        scriptFile: 'frequencies.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames,
          valueLabels: Object.fromEntries(vars.map(v => [v.colId, v.valueLabels])),
          options: {
            showTable: options.showTable,
            order: options.order,
            statistics: options.statistics,
            charts: options.charts
          }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:frequencies.title', assignments: assignments }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'frequencies'}
      titleKey="analysis:frequencies.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={assignments => void handleSubmit(assignments)}
      onCancel={onClose}
      generateRCode={generateRCode}
      generateSyntax={a => buildSyntax.frequencies(a['variables'] ?? [], options)}
      extraContent={
        <CheckOption
          checked={options.showTable}
          onChange={v => {
            setOptions(prev => ({ ...prev, showTable: v }))
          }}
        >
          {t('analysis:frequencies.displayTable')}
        </CheckOption>
      }
    />
  )
}
