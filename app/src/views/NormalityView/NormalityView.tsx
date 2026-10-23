// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * NormalityView — 4th tab: a live normality dashboard for scale variables.
 *
 * On open (or Refresh) it runs the generic `normality` analysis (normality.R)
 * over every scale-measure variable, reading straight from DuckDB, and shows
 * one AG Grid row per variable: rich descriptive stats + Kolmogorov-Smirnov
 * (Lilliefors) + Shapiro-Wilk + a verdict badge + an inline mini-histogram.
 * Selecting a row reveals the detail plots (histogram+normal curve, Q-Q,
 * detrended Q-Q, boxplot).
 *
 * The result is parked in `normality-store` so it survives tab switches; it is
 * re-computed when the active dataset changes or the user hits Refresh.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AgGridReact } from 'ag-grid-react'
import { ModuleRegistry, AllCommunityModule, type ColDef } from 'ag-grid-community'
import type { ICellRendererParams } from 'ag-grid-community'
import { useDatasetStore } from '../../store/dataset-store'
import { useResolvedTheme } from '../../theme/ThemeProvider'
import { useNormalityStore, normalityInputKey } from '../../store/normality-store'
import { PlotlyChart } from '../../components/PlotlyChart'
import { cx } from '../../lib/cx'
import { formatSignificance, getOutputDecimalSeparator } from '../../lib/output-format'
import type { OutputPlot } from '@shared/analysis-types'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'
import styles from './NormalityView.module.css'

ModuleRegistry.registerModules([AllCommunityModule])

// Field order MUST match `NORMALITY_COLUMNS` in r-scripts/normality.R.
const FIELDS = [
  'variable',
  'n',
  'missing',
  'mean',
  'median',
  'sd',
  'min',
  'max',
  'range',
  'skewness',
  'seSkewness',
  'zSkewness',
  'kurtosis',
  'seKurtosis',
  'zKurtosis',
  'ksStat',
  'ksDf',
  'ksSig',
  'swStat',
  'swDf',
  'swSig',
  'decision',
  'colId',
  'spark'
] as const

type NormalityRow = Record<string, string | number | null>

const INTEGER_FIELDS = new Set(['n', 'missing', 'ksDf', 'swDf'])
const PVALUE_FIELDS = new Set(['ksSig', 'swSig'])
const DASH = '—'

const PLOT_KINDS = ['histogram', 'qq', 'detrended', 'boxplot'] as const

// ── Cell renderers ──────────────────────────────────────────────────────────

function SparklineCell({ value }: ICellRendererParams<NormalityRow>) {
  const bins = useMemo<number[]>(() => {
    if (typeof value !== 'string') return []
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as number[]) : []
    } catch {
      return []
    }
  }, [value])

  if (bins.length === 0) return null
  const max = Math.max(...bins, 1)
  return (
    <div className={styles.spark} aria-hidden="true">
      {bins.map((c, i) => (
        <div
          key={i}
          className={styles.sparkBar}
          style={{ height: `${Math.max(2, (c / max) * 100).toFixed(1)}%` }}
        />
      ))}
    </div>
  )
}

function DecisionBadge({ value }: ICellRendererParams<NormalityRow>) {
  const { t } = useTranslation(['analysis', 'common', 'menu', 'dialogs'])
  const decision = typeof value === 'string' ? value : 'na'
  const cls =
    decision === 'normal'
      ? styles.badgeNormal
      : decision === 'notNormal'
        ? styles.badgeNotNormal
        : styles.badgeNa
  return (
    <span className={cx(styles.badge, cls)}>
      <span className={styles.dot} />
      {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion */}
      {t(`output.normality.decision.${decision}` as never)}
    </span>
  )
}

// ── View ────────────────────────────────────────────────────────────────────

export function NormalityView() {
  const { t } = useTranslation(['analysis', 'common', 'menu', 'dialogs'])
  const resolvedTheme = useResolvedTheme()
  const isDarkMode = resolvedTheme !== 'light'

  const datasetId = useDatasetStore(s => s.datasetId)
  const variables = useDatasetStore(s => s.variables)

  const status = useNormalityStore(s => s.status)
  const result = useNormalityStore(s => s.result)
  const resultDatasetId = useNormalityStore(s => s.resultDatasetId)
  const resultKey = useNormalityStore(s => s.resultKey)
  const errorKey = useNormalityStore(s => s.errorKey)

  const [selectedColId, setSelectedColId] = useState<string | null>(null)

  const scaleVars = useMemo(() => variables.filter(v => v.measure === 'scale'), [variables])

  // ── Run the analysis ────────────────────────────────────────────────────────
  const runNormality = useCallback(() => {
    const ds = useDatasetStore.getState()
    if (!ds.datasetId) return
    const scale = ds.variables.filter(v => v.measure === 'scale')
    const varNames = Object.fromEntries(
      scale.map(v => [v.colId, v.label.trim() !== '' ? v.label : v.name])
    )
    useNormalityStore.getState().setRunning(normalityInputKey(ds))
    setSelectedColId(null)
    void window.api.analysis
      .run({
        analysisId: 'normality',
        datasetId: ds.datasetId,
        scriptFile: 'normality.R',
        params: { variables: scale.map(v => v.colId), varNames },
        columnFilters: ds.columnFilters
      })
      .catch((err: unknown) => {
        console.error('Failed to queue normality analysis:', err)
        useNormalityStore.getState().setError('output.normality.error.run')
      })
  }, [])

  // Job results/errors land in normality-store via the app-level
  // subscription (use-app-effects.ts) — this view may be unmounted when the
  // run finishes.

  // Auto-run when the tab is shown and the result doesn't match the current
  // data: another dataset, or the same one edited/filtered/reweighted since.
  // (A null resultKey = a result injected without a launch key, e.g. e2e —
  // trusted as-is.)
  const inputKey = useDatasetStore(normalityInputKey)
  const ranForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!datasetId) return
    const haveResult =
      result !== null &&
      resultDatasetId === datasetId &&
      (resultKey === null || resultKey === inputKey)
    if (haveResult) {
      ranForRef.current = inputKey
      return
    }
    if (status === 'running' || ranForRef.current === inputKey) return
    ranForRef.current = inputKey
    runNormality()
  }, [datasetId, inputKey, result, resultDatasetId, resultKey, status, runNormality])

  // ── Build grid rows + column defs ───────────────────────────────────────────
  const rowData = useMemo<NormalityRow[]>(() => {
    const table = result?.tables[0]
    if (!table) return []
    return table.rows.map(row => {
      const obj: NormalityRow = {}
      FIELDS.forEach((f, i) => {
        obj[f] = row[i] ?? null
      })
      return obj
    })
  }, [result])

  const columnDefs = useMemo<ColDef<NormalityRow>[]>(() => {
    const num = (field: string, key: string): ColDef<NormalityRow> => ({
      field,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      headerName: t(`output.normality.col.${key}` as never),
      type: 'numericColumn',
      valueFormatter: p => formatCell(field, p.value),
      width: 96
    })
    return [
      {
        field: 'variable',
        headerName: t('output.normality.col.variable'),
        pinned: 'left',
        minWidth: 150,
        cellStyle: { fontWeight: 600 }
      },
      {
        field: 'spark',
        headerName: t('output.normality.col.distribution'),
        cellRenderer: SparklineCell,
        sortable: false,
        filter: false,
        width: 130
      },
      num('n', 'n'),
      num('missing', 'missing'),
      num('mean', 'mean'),
      num('median', 'median'),
      num('sd', 'sd'),
      num('min', 'min'),
      num('max', 'max'),
      num('range', 'range'),
      num('skewness', 'skewness'),
      num('seSkewness', 'seSkewness'),
      num('zSkewness', 'zSkewness'),
      num('kurtosis', 'kurtosis'),
      num('seKurtosis', 'seKurtosis'),
      num('zKurtosis', 'zKurtosis'),
      num('ksStat', 'ksStat'),
      num('ksDf', 'ksDf'),
      num('ksSig', 'ksSig'),
      num('swStat', 'swStat'),
      num('swDf', 'swDf'),
      num('swSig', 'swSig'),
      {
        field: 'decision',
        headerName: t('output.normality.col.decision'),
        cellRenderer: DecisionBadge,
        pinned: 'right',
        width: 140,
        sortable: true
      },
      { field: 'colId', hide: true }
    ]
  }, [t])

  // ── Detail plots for the selected variable ──────────────────────────────────
  const detailPlots = useMemo<Record<string, OutputPlot | undefined>>(() => {
    const map: Record<string, OutputPlot | undefined> = {}
    if (!result || !selectedColId) return map
    for (const kind of PLOT_KINDS) {
      map[kind] = result.plots.find(p => p.titleKey === `${selectedColId}|${kind}`)
    }
    return map
  }, [result, selectedColId])

  const themeClass = isDarkMode ? 'ag-theme-quartz-dark' : 'ag-theme-quartz'
  const selectedLabel = useMemo(() => {
    if (!selectedColId) return null
    const row = rowData.find(r => r['colId'] === selectedColId)
    return (row?.['variable'] as string | undefined) ?? selectedColId
  }, [rowData, selectedColId])

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!datasetId) {
    return (
      <div className={styles.root} data-testid="normality-view">
        <div className={styles.placeholder}>{t('common:status.noData', 'No active dataset.')}</div>
      </div>
    )
  }

  if (status === 'running' && result === null) {
    return (
      <div className={styles.root} data-testid="normality-view">
        <div className={styles.toolbar}>
          <span className={styles.title}>{t('output.normality.title')}</span>
          <span className={styles.count}>
            {t('output.normality.scaleCount', { count: scaleVars.length })}
          </span>
          <span className={styles.spacer} />
          <button className={styles.button} disabled>
            {t('output.normality.running')}
          </button>
        </div>
        <div className={styles.placeholder}>
          <div className={styles.spinner} />
          <span>{t('output.normality.running')}</span>
        </div>
      </div>
    )
  }

  const hasSelectedPlots = selectedColId && PLOT_KINDS.some(k => detailPlots[k])

  return (
    <div className={styles.root} data-testid="normality-view">
      <div className={styles.toolbar}>
        <span className={styles.title}>{t('output.normality.title')}</span>
        <span className={styles.count}>
          {t('output.normality.scaleCount', { count: scaleVars.length })}
        </span>
        <span className={styles.spacer} />
        <button className={styles.button} onClick={runNormality} disabled={status === 'running'}>
          {status === 'running' ? t('output.normality.running') : t('output.normality.refresh')}
        </button>
      </div>

      {status === 'error' ? (
        <div className={styles.placeholder}>
          <span className={styles.error}>
            {t((errorKey ?? 'output.normality.error.run') as never)}
          </span>
          <button className={styles.button} onClick={runNormality}>
            {t('output.normality.refresh')}
          </button>
        </div>
      ) : scaleVars.length === 0 ? (
        <div className={styles.placeholder}>{t('output.normality.noScaleVars')}</div>
      ) : (
        <div className={styles.body}>
          <div className={styles.gridWrap}>
            <div className={cx(themeClass, styles.grid)}>
              <AgGridReact<NormalityRow>
                theme="legacy"
                rowData={rowData}
                columnDefs={columnDefs}
                rowSelection="single"
                onRowClicked={e => {
                  const id = e.data?.['colId']
                  setSelectedColId(typeof id === 'string' ? id : null)
                }}
                defaultColDef={{ resizable: true, sortable: true }}
                animateRows={false}
              />
            </div>
          </div>

          <div className={styles.detail}>
            <div className={styles.detailHeader}>
              {selectedLabel
                ? t('output.normality.detailFor', { name: selectedLabel })
                : t('output.normality.detailHint')}
            </div>
            {hasSelectedPlots ? (
              <div className={styles.plotsGrid}>
                {PLOT_KINDS.map(kind => {
                  const plot = detailPlots[kind]
                  if (!plot) return null
                  return (
                    <div key={kind} className={styles.plotCard}>
                      <div className={styles.plotTitle}>{t(`output.normality.plot.${kind}`)}</div>
                      <PlotlyChart
                        data={plot.data}
                        minHeight={220}
                        filename={[selectedLabel, t(`output.normality.plot.${kind}`)]
                          .filter(Boolean)
                          .join(' - ')}
                      />
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className={styles.detailHint}>{t('output.normality.detailHint')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCell(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return DASH
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return typeof value === 'string' ? value : ''
  if (INTEGER_FIELDS.has(field)) return String(Math.round(n))
  // Same Preferences-driven separator / leading-zero rule as the Output tab.
  if (PVALUE_FIELDS.has(field)) return formatSignificance(n)
  const sep = getOutputDecimalSeparator()
  return sep === '.' ? n.toFixed(3) : n.toFixed(3).replace('.', sep)
}
