// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Graphs menu v1 — legacy-dialog-style charts (SPSS: Graphs → Scatter/Bar/
 * Line/Histogram/Boxplot/P-P/Q-Q). One shared dialog + one R script
 * (chart.R), selected via `chartType`. See spss-parity-analysis.md §3.6.
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
import { useRunAnalysis } from './useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

export type ChartType = 'scatter' | 'bar' | 'line' | 'histogram' | 'boxplot' | 'pp' | 'qq'

interface Props {
  chartType: ChartType
  onClose: () => void
}

// ─────────────────────────────────────────────────────────────
//  Boxplot options — everything a chart-editor "Boxplot Options"
//  panel normally exposes: which points to draw, a mean marker,
//  notches, orientation, and group sort order.
// ─────────────────────────────────────────────────────────────

export interface BoxplotOptions {
  points: 'none' | 'outliers' | 'all'
  boxmean: 'none' | 'true' | 'sd'
  notched: boolean
  orientation: 'vertical' | 'horizontal'
  sortBy: 'alphabetical' | 'medianAsc' | 'medianDesc'
  showLegend: boolean
}

const defaultBoxplotOptions: BoxplotOptions = {
  points: 'outliers',
  boxmean: 'none',
  notched: false,
  orientation: 'vertical',
  sortBy: 'alphabetical',
  showLegend: true
}

// ─────────────────────────────────────────────────────────────
//  Scatter options — an optional fit line, the one thing a
//  scatterplot chart-editor normally lets you add.
// ─────────────────────────────────────────────────────────────

export interface ScatterOptions {
  fitLine: 'none' | 'linear'
}

const defaultScatterOptions: ScatterOptions = { fitLine: 'none' }

// ─────────────────────────────────────────────────────────────
//  Bar options — what the bars represent, their sort order, and
//  whether to print the value above each bar.
// ─────────────────────────────────────────────────────────────

export interface BarOptions {
  represent: 'count' | 'percent'
  sortBy: 'countDesc' | 'countAsc' | 'alphabetical'
  showValues: boolean
}

const defaultBarOptions: BarOptions = {
  represent: 'count',
  sortBy: 'countDesc',
  showValues: false
}

// ─────────────────────────────────────────────────────────────
//  Line options — marker/line style and, for a grouped line
//  chart, the category sort order.
// ─────────────────────────────────────────────────────────────

export interface LineOptions {
  style: 'linePlusMarker' | 'lineOnly' | 'markerOnly'
  sortBy: 'alphabetical' | 'valueAsc' | 'valueDesc'
}

const defaultLineOptions: LineOptions = {
  style: 'linePlusMarker',
  sortBy: 'alphabetical'
}

// ─────────────────────────────────────────────────────────────
//  Histogram options — an overlaid normal curve and control over
//  the number of bins.
// ─────────────────────────────────────────────────────────────

export interface HistogramOptions {
  normalCurve: boolean
  binsMode: 'auto' | 'custom'
  customBins: number
}

const defaultHistogramOptions: HistogramOptions = {
  normalCurve: false,
  binsMode: 'auto',
  customBins: 10
}

// ─────────────────────────────────────────────────────────────
//  P-P / Q-Q options — the detrended variant (deviations from the
//  reference line instead of raw cumulative/quantile values).
// ─────────────────────────────────────────────────────────────

export interface PPQQOptions {
  detrend: boolean
}

const defaultPPQQOptions: PPQQOptions = { detrend: false }

function BoxplotOptionsContent({
  value,
  onChange,
  onClose
}: {
  value: BoxplotOptions
  onChange: (v: BoxplotOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)
  const set = <K extends keyof BoxplotOptions>(key: K, val: BoxplotOptions[K]) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }

  return (
    <>
      <OptionSection titleKey="analysis:chart.pointsLabel">
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bp-points"
            checked={local.points === 'outliers'}
            onChange={() => {
              set('points', 'outliers')
            }}
          />
          {t('analysis:chart.pointsOutliers')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bp-points"
            checked={local.points === 'all'}
            onChange={() => {
              set('points', 'all')
            }}
          />
          {t('analysis:chart.pointsAll')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bp-points"
            checked={local.points === 'none'}
            onChange={() => {
              set('points', 'none')
            }}
          />
          {t('analysis:chart.pointsNone')}
        </label>
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:chart.meanLabel">
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bp-mean"
            checked={local.boxmean === 'none'}
            onChange={() => {
              set('boxmean', 'none')
            }}
          />
          {t('analysis:chart.meanNone')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bp-mean"
            checked={local.boxmean === 'true'}
            onChange={() => {
              set('boxmean', 'true')
            }}
          />
          {t('analysis:chart.meanLine')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bp-mean"
            checked={local.boxmean === 'sd'}
            onChange={() => {
              set('boxmean', 'sd')
            }}
          />
          {t('analysis:chart.meanSd')}
        </label>
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:chart.orientationLabel">
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bp-orientation"
            checked={local.orientation === 'vertical'}
            onChange={() => {
              set('orientation', 'vertical')
            }}
          />
          {t('analysis:chart.orientationVertical')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bp-orientation"
            checked={local.orientation === 'horizontal'}
            onChange={() => {
              set('orientation', 'horizontal')
            }}
          />
          {t('analysis:chart.orientationHorizontal')}
        </label>
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:chart.sortLabel" grid={false}>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bp-sort"
            checked={local.sortBy === 'alphabetical'}
            onChange={() => {
              set('sortBy', 'alphabetical')
            }}
          />
          {t('analysis:chart.sortAlphabetical')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bp-sort"
            checked={local.sortBy === 'medianAsc'}
            onChange={() => {
              set('sortBy', 'medianAsc')
            }}
          />
          {t('analysis:chart.sortMedianAsc')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bp-sort"
            checked={local.sortBy === 'medianDesc'}
            onChange={() => {
              set('sortBy', 'medianDesc')
            }}
          />
          {t('analysis:chart.sortMedianDesc')}
        </label>
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection grid={false}>
        <CheckOption
          checked={local.notched}
          onChange={v => {
            set('notched', v)
          }}
        >
          {t('analysis:chart.notchedLabel')}
        </CheckOption>
        <CheckOption
          checked={local.showLegend}
          onChange={v => {
            set('showLegend', v)
          }}
        >
          {t('analysis:chart.showLegend')}
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

function ScatterOptionsContent({
  value,
  onChange,
  onClose
}: {
  value: ScatterOptions
  onChange: (v: ScatterOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)

  return (
    <>
      <OptionSection titleKey="analysis:chart.fitLineLabel">
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="sc-fit"
            checked={local.fitLine === 'none'}
            onChange={() => {
              setLocal({ fitLine: 'none' })
            }}
          />
          {t('analysis:chart.fitLineNone')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="sc-fit"
            checked={local.fitLine === 'linear'}
            onChange={() => {
              setLocal({ fitLine: 'linear' })
            }}
          />
          {t('analysis:chart.fitLineLinear')}
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

function BarOptionsContent({
  value,
  onChange,
  onClose
}: {
  value: BarOptions
  onChange: (v: BarOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)
  const set = <K extends keyof BarOptions>(key: K, val: BarOptions[K]) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }

  return (
    <>
      <OptionSection titleKey="analysis:chart.barRepresentLabel">
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bar-represent"
            checked={local.represent === 'count'}
            onChange={() => {
              set('represent', 'count')
            }}
          />
          {t('analysis:chart.barRepresentCount')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bar-represent"
            checked={local.represent === 'percent'}
            onChange={() => {
              set('represent', 'percent')
            }}
          />
          {t('analysis:chart.barRepresentPercent')}
        </label>
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:chart.barSortLabel" grid={false}>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bar-sort"
            checked={local.sortBy === 'countDesc'}
            onChange={() => {
              set('sortBy', 'countDesc')
            }}
          />
          {t('analysis:chart.barSortCountDesc')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bar-sort"
            checked={local.sortBy === 'countAsc'}
            onChange={() => {
              set('sortBy', 'countAsc')
            }}
          />
          {t('analysis:chart.barSortCountAsc')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="bar-sort"
            checked={local.sortBy === 'alphabetical'}
            onChange={() => {
              set('sortBy', 'alphabetical')
            }}
          />
          {t('analysis:chart.barSortAlphabetical')}
        </label>
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection grid={false}>
        <CheckOption
          checked={local.showValues}
          onChange={v => {
            set('showValues', v)
          }}
        >
          {t('analysis:chart.barShowValues')}
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

function LineOptionsContent({
  value,
  onChange,
  onClose
}: {
  value: LineOptions
  onChange: (v: LineOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)
  const set = <K extends keyof LineOptions>(key: K, val: LineOptions[K]) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }

  return (
    <>
      <OptionSection titleKey="analysis:chart.lineStyleLabel">
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="line-style"
            checked={local.style === 'linePlusMarker'}
            onChange={() => {
              set('style', 'linePlusMarker')
            }}
          />
          {t('analysis:chart.lineStyleBoth')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="line-style"
            checked={local.style === 'lineOnly'}
            onChange={() => {
              set('style', 'lineOnly')
            }}
          />
          {t('analysis:chart.lineStyleLineOnly')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="line-style"
            checked={local.style === 'markerOnly'}
            onChange={() => {
              set('style', 'markerOnly')
            }}
          />
          {t('analysis:chart.lineStyleMarkersOnly')}
        </label>
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:chart.lineSortLabel" grid={false}>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="line-sort"
            checked={local.sortBy === 'alphabetical'}
            onChange={() => {
              set('sortBy', 'alphabetical')
            }}
          />
          {t('analysis:chart.lineSortAlphabetical')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="line-sort"
            checked={local.sortBy === 'valueAsc'}
            onChange={() => {
              set('sortBy', 'valueAsc')
            }}
          />
          {t('analysis:chart.lineSortValueAsc')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="line-sort"
            checked={local.sortBy === 'valueDesc'}
            onChange={() => {
              set('sortBy', 'valueDesc')
            }}
          />
          {t('analysis:chart.lineSortValueDesc')}
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

function HistogramOptionsContent({
  value,
  onChange,
  onClose
}: {
  value: HistogramOptions
  onChange: (v: HistogramOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)

  return (
    <>
      <OptionSection grid={false}>
        <CheckOption
          checked={local.normalCurve}
          onChange={v => {
            setLocal(prev => ({ ...prev, normalCurve: v }))
          }}
        >
          {t('analysis:chart.histogramNormalCurve')}
        </CheckOption>
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:chart.histogramBinsLabel" grid={false}>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="hist-bins"
            checked={local.binsMode === 'auto'}
            onChange={() => {
              setLocal(prev => ({ ...prev, binsMode: 'auto' }))
            }}
          />
          {t('analysis:chart.histogramBinsAuto')}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            name="hist-bins"
            checked={local.binsMode === 'custom'}
            onChange={() => {
              setLocal(prev => ({ ...prev, binsMode: 'custom' }))
            }}
          />
          {t('analysis:chart.histogramBinsCustom')}
          <input
            type="number"
            className="numField--sm"
            min={2}
            max={100}
            value={local.customBins}
            disabled={local.binsMode !== 'custom'}
            onChange={e => {
              const n = Number(e.target.value)
              setLocal(prev => ({
                ...prev,
                customBins:
                  Number.isFinite(n) && n >= 2 ? Math.min(100, Math.trunc(n)) : prev.customBins
              }))
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

function PPQQOptionsContent({
  value,
  onChange,
  onClose
}: {
  value: PPQQOptions
  onChange: (v: PPQQOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)

  return (
    <>
      <OptionSection grid={false}>
        <CheckOption
          checked={local.detrend}
          onChange={v => {
            setLocal({ detrend: v })
          }}
        >
          {t('analysis:chart.ppqqDetrend')}
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

const TITLE_KEYS: Record<ChartType, string> = {
  scatter: 'analysis:chart.scatterTitle',
  bar: 'analysis:chart.barTitle',
  line: 'analysis:chart.lineTitle',
  histogram: 'analysis:chart.histogramTitle',
  boxplot: 'analysis:chart.boxplotTitle',
  pp: 'analysis:chart.ppTitle',
  qq: 'analysis:chart.qqTitle'
}

// Types that need a numeric X field vs. a categorical one.
const NUMERIC_X: ChartType[] = ['scatter', 'line', 'histogram', 'boxplot', 'pp', 'qq']
const HAS_GROUP: ChartType[] = ['line', 'boxplot']
const HAS_Y: ChartType[] = ['scatter']

export function ChartDialog({ chartType, onClose }: Props) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { running, run } = useRunAnalysis()
  const [boxplotOptions, setBoxplotOptions] = useState<BoxplotOptions>(defaultBoxplotOptions)
  const [scatterOptions, setScatterOptions] = useState<ScatterOptions>(defaultScatterOptions)
  const [barOptions, setBarOptions] = useState<BarOptions>(defaultBarOptions)
  const [lineOptions, setLineOptions] = useState<LineOptions>(defaultLineOptions)
  const [histogramOptions, setHistogramOptions] =
    useState<HistogramOptions>(defaultHistogramOptions)
  const [ppqqOptions, setPPQQOptions] = useState<PPQQOptions>(defaultPPQQOptions)

  const numericX = NUMERIC_X.includes(chartType)
  const hasGroup = HAS_GROUP.includes(chartType)
  const hasY = HAS_Y.includes(chartType)

  const chartOptions:
    | BoxplotOptions
    | ScatterOptions
    | BarOptions
    | LineOptions
    | HistogramOptions
    | PPQQOptions =
    chartType === 'boxplot'
      ? boxplotOptions
      : chartType === 'scatter'
        ? scatterOptions
        : chartType === 'bar'
          ? barOptions
          : chartType === 'line'
            ? lineOptions
            : chartType === 'histogram'
              ? histogramOptions
              : ppqqOptions // pp | qq

  let sideButtons: SideButtonDef[] | undefined
  switch (chartType) {
    case 'boxplot':
      sideButtons = [
        {
          key: 'options',
          labelKey: 'analysis:shell.btnOptions',
          titleKey: 'analysis:chart.optionsTitle',
          renderContent: ({ onClose: closeSub }) => (
            <BoxplotOptionsContent
              value={boxplotOptions}
              onChange={setBoxplotOptions}
              onClose={closeSub}
            />
          )
        }
      ]
      break
    case 'scatter':
      sideButtons = [
        {
          key: 'options',
          labelKey: 'analysis:shell.btnOptions',
          titleKey: 'analysis:chart.scatterOptionsTitle',
          renderContent: ({ onClose: closeSub }) => (
            <ScatterOptionsContent
              value={scatterOptions}
              onChange={setScatterOptions}
              onClose={closeSub}
            />
          )
        }
      ]
      break
    case 'bar':
      sideButtons = [
        {
          key: 'options',
          labelKey: 'analysis:shell.btnOptions',
          titleKey: 'analysis:chart.barOptionsTitle',
          renderContent: ({ onClose: closeSub }) => (
            <BarOptionsContent value={barOptions} onChange={setBarOptions} onClose={closeSub} />
          )
        }
      ]
      break
    case 'line':
      sideButtons = [
        {
          key: 'options',
          labelKey: 'analysis:shell.btnOptions',
          titleKey: 'analysis:chart.lineOptionsTitle',
          renderContent: ({ onClose: closeSub }) => (
            <LineOptionsContent value={lineOptions} onChange={setLineOptions} onClose={closeSub} />
          )
        }
      ]
      break
    case 'histogram':
      sideButtons = [
        {
          key: 'options',
          labelKey: 'analysis:shell.btnOptions',
          titleKey: 'analysis:chart.histogramOptionsTitle',
          renderContent: ({ onClose: closeSub }) => (
            <HistogramOptionsContent
              value={histogramOptions}
              onChange={setHistogramOptions}
              onClose={closeSub}
            />
          )
        }
      ]
      break
    case 'pp':
    case 'qq':
      sideButtons = [
        {
          key: 'options',
          labelKey: 'analysis:shell.btnOptions',
          titleKey: 'analysis:chart.ppqqOptionsTitle',
          renderContent: ({ onClose: closeSub }) => (
            <PPQQOptionsContent value={ppqqOptions} onChange={setPPQQOptions} onClose={closeSub} />
          )
        }
      ]
      break
  }

  const fieldDefs = [
    {
      key: 'x',
      labelKey: chartType === 'bar' ? 'analysis:chart.categoryField' : 'analysis:chart.xField',
      single: true,
      ...(numericX ? { filter: (v: Variable) => v.type === 'numeric' } : {})
    },
    ...(hasY
      ? [
          {
            key: 'y',
            labelKey: 'analysis:chart.yField',
            single: true,
            filter: (v: Variable) => v.type === 'numeric'
          }
        ]
      : []),
    ...(hasGroup ? [{ key: 'group', labelKey: 'analysis:chart.groupField', single: true }] : [])
  ]

  const canSubmit = (a: Record<string, Variable[]>) => {
    if (running) return false
    if ((a['x'] ?? []).length !== 1) return false
    if (hasY && (a['y'] ?? []).length !== 1) return false
    return true
  }

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const x = a['x']?.[0]
    const y = a['y']?.[0]
    const group = a['group']?.[0]
    await run(
      {
        analysisId: `chart-${chartType}`,
        datasetId,
        scriptFile: 'chart.R',
        params: {
          chartType,
          xVar: x?.colId,
          xVarName: x?.label || x?.name,
          ...(x?.valueLabels && Object.keys(x.valueLabels).length > 0
            ? { xValueLabels: x.valueLabels }
            : {}),
          ...(y
            ? {
                yVar: y.colId,
                yVarName: y.label || y.name,
                ...(Object.keys(y.valueLabels).length > 0 ? { yValueLabels: y.valueLabels } : {})
              }
            : {}),
          ...(group
            ? {
                groupVar: group.colId,
                groupVarName: group.label || group.name,
                ...(Object.keys(group.valueLabels).length > 0
                  ? { groupValueLabels: group.valueLabels }
                  : {})
              }
            : {}),
          options: chartOptions
        },
        columnFilters
      },
      onClose,
      { titleKey: TITLE_KEYS[chartType], assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={`chart-${chartType}`}
      titleKey={TITLE_KEYS[chartType]}
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.chart(
          chartType,
          a['x'] ?? [],
          a['y'] ?? [],
          a['group'] ?? [],
          chartType === 'bar' ? barOptions : histogramOptions
        )
      }
    />
  )
}
