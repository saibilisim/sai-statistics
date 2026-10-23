// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Crosstabs analysis dialog — SPSS-style.
 * Mirrors SPSS: Analyze → Descriptive Statistics → Crosstabs
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
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import {
  PMethodSection,
  buildPMethodParams,
  defaultPMethodOptions,
  type PMethodOptions
} from '../_shared/PMethodSection'
import { useRunAnalysis } from '../_shared/useRunAnalysis'

// ─────────────────────────────────────────────────────────────
//  Options state
// ─────────────────────────────────────────────────────────────

interface CrosstabsCells {
  observed: boolean
  expected: boolean
  rowPct: boolean
  colPct: boolean
  totalPct: boolean
  unstdResid: boolean
  stdResid: boolean
  adjResid: boolean
}

interface CrosstabsStats {
  chisquare: boolean
  phiCramer: boolean
  contingency: boolean
  lambda: boolean
  uncertainty: boolean
  correlations: boolean
  gamma: boolean
  somersd: boolean
  taub: boolean
  tauc: boolean
  eta: boolean
  kappa: boolean
  risk: boolean
  mcnemar: boolean
}

interface CrosstabsOptions {
  cells: CrosstabsCells
  stats: CrosstabsStats
}

const defaultOptions: CrosstabsOptions = {
  cells: {
    observed: true,
    expected: false,
    rowPct: false,
    colPct: false,
    totalPct: false,
    unstdResid: false,
    stdResid: false,
    adjResid: false
  },
  stats: {
    chisquare: true,
    phiCramer: false,
    contingency: false,
    lambda: false,
    uncertainty: false,
    correlations: false,
    gamma: false,
    somersd: false,
    taub: false,
    tauc: false,
    eta: false,
    kappa: false,
    risk: false,
    mcnemar: false
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
  stats: CrosstabsStats
  onChange: (s: CrosstabsStats) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(stats)
  const set = (key: keyof CrosstabsStats, val: boolean) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }
  const check = (key: keyof CrosstabsStats, labelKey: string) => (
    <CheckOption
      checked={local[key]}
      onChange={v => {
        set(key, v)
      }}
    >
      {t(labelKey as never)}
    </CheckOption>
  )

  return (
    <>
      <OptionSection>
        {check('chisquare', 'analysis:crosstabs.stats.chisquare')}
        {check('correlations', 'analysis:crosstabs.stats.correlations')}
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:crosstabs.stats.nominal">
        {check('contingency', 'analysis:crosstabs.stats.contingency')}
        {check('phiCramer', 'analysis:crosstabs.stats.phiCramer')}
        {check('lambda', 'analysis:crosstabs.stats.lambda')}
        {check('uncertainty', 'analysis:crosstabs.stats.uncertainty')}
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:crosstabs.stats.ordinal">
        {check('gamma', 'analysis:crosstabs.stats.gamma')}
        {check('somersd', 'analysis:crosstabs.stats.somersd')}
        {check('taub', 'analysis:crosstabs.stats.taub')}
        {check('tauc', 'analysis:crosstabs.stats.tauc')}
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:crosstabs.stats.nomByInt">
        {check('eta', 'analysis:crosstabs.stats.eta')}
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection>
        {check('kappa', 'analysis:crosstabs.stats.kappa')}
        {check('risk', 'analysis:crosstabs.stats.risk')}
        {check('mcnemar', 'analysis:crosstabs.stats.mcnemar')}
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
//  Cells sub-dialog
// ─────────────────────────────────────────────────────────────

function CellsContent({
  cells,
  onChange,
  onClose
}: {
  cells: CrosstabsCells
  onChange: (c: CrosstabsCells) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(cells)
  const set = (key: keyof CrosstabsCells, val: boolean) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }

  return (
    <>
      <OptionSection titleKey="analysis:crosstabs.cells.counts">
        <CheckOption
          checked={local.observed}
          onChange={v => {
            set('observed', v)
          }}
        >
          {t('analysis:crosstabs.cells.observed')}
        </CheckOption>
        <CheckOption
          checked={local.expected}
          onChange={v => {
            set('expected', v)
          }}
        >
          {t('analysis:crosstabs.cells.expected')}
        </CheckOption>
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:crosstabs.cells.percentages">
        <CheckOption
          checked={local.rowPct}
          onChange={v => {
            set('rowPct', v)
          }}
        >
          {t('analysis:crosstabs.cells.rowPct')}
        </CheckOption>
        <CheckOption
          checked={local.colPct}
          onChange={v => {
            set('colPct', v)
          }}
        >
          {t('analysis:crosstabs.cells.colPct')}
        </CheckOption>
        <CheckOption
          checked={local.totalPct}
          onChange={v => {
            set('totalPct', v)
          }}
        >
          {t('analysis:crosstabs.cells.totalPct')}
        </CheckOption>
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:crosstabs.cells.residuals">
        <CheckOption
          checked={local.unstdResid}
          onChange={v => {
            set('unstdResid', v)
          }}
        >
          {t('analysis:crosstabs.cells.unstdResid')}
        </CheckOption>
        <CheckOption
          checked={local.stdResid}
          onChange={v => {
            set('stdResid', v)
          }}
        >
          {t('analysis:crosstabs.cells.stdResid')}
        </CheckOption>
        <CheckOption
          checked={local.adjResid}
          onChange={v => {
            set('adjResid', v)
          }}
        >
          {t('analysis:crosstabs.cells.adjResid')}
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

export function CrosstabsDialog({ onClose }: Props) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)

  const [options, setOptions] = useState<CrosstabsOptions>(defaultOptions)
  const [pMethod, setPMethod] = useState<PMethodOptions>(defaultPMethodOptions)
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    { key: 'rows', labelKey: 'analysis:crosstabs.rowField', single: false },
    { key: 'cols', labelKey: 'analysis:crosstabs.colField', single: false }
  ]

  const sideButtons: SideButtonDef[] = [
    {
      key: 'statistics',
      labelKey: 'analysis:shell.btnStatistics',
      titleKey: 'analysis:crosstabs.statisticsTitle',
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
      key: 'cells',
      labelKey: 'analysis:shell.btnCells',
      titleKey: 'analysis:crosstabs.cellsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <CellsContent
          cells={options.cells}
          onChange={cells => {
            setOptions(prev => ({ ...prev, cells }))
          }}
          onClose={closeSub}
        />
      )
    },
    {
      key: 'exact',
      labelKey: 'analysis:shell.btnExact',
      titleKey: 'analysis:crosstabs.exactTitle',
      renderContent: ({ onClose: closeSub }) => (
        <PMethodSection value={pMethod} onChange={setPMethod} onClose={closeSub} />
      )
    }
  ]

  const canSubmit = (assignments: Record<string, Variable[]>) =>
    (assignments['rows'] ?? []).length > 0 && (assignments['cols'] ?? []).length > 0 && !running

  const generateRCode = (assignments: Record<string, Variable[]>) => {
    const rows = (assignments['rows'] ?? []).map(v => v.name)
    const cols = (assignments['cols'] ?? []).map(v => v.name)
    if (rows.length === 0 || cols.length === 0) return null
    return [
      '# SAI Statistics — Crosstabs',
      `for (r in c(${rows.map(v => `"${v}"`).join(', ')})) {`,
      `  for (cc in c(${cols.map(v => `"${v}"`).join(', ')})) {`,
      '    print(table(df[[r]], df[[cc]]))',
      '    print(chisq.test(table(df[[r]], df[[cc]])))',
      '  }',
      '}'
    ].join('\n')
  }

  const handleSubmit = async (assignments: Record<string, Variable[]>) => {
    if (!datasetId) return
    const rows = assignments['rows'] ?? []
    const cols = assignments['cols'] ?? []

    const rowValueLabels: Record<string, Record<string, string>> = {}
    for (const r of rows) {
      if (Object.keys(r.valueLabels).length > 0) {
        rowValueLabels[r.colId] = r.valueLabels
      }
    }
    const colValueLabels: Record<string, Record<string, string>> = {}
    for (const c of cols) {
      if (Object.keys(c.valueLabels).length > 0) {
        colValueLabels[c.colId] = c.valueLabels
      }
    }

    const pMethodParams = buildPMethodParams(pMethod)
    await run(
      {
        analysisId: 'crosstabs',
        datasetId,
        scriptFile: 'crosstabs.R',
        params: {
          rows: rows.map(v => v.colId),
          rowNames: Object.fromEntries(rows.map(v => [v.colId, v.name])),
          ...(Object.keys(rowValueLabels).length > 0 ? { rowValueLabels } : {}),
          cols: cols.map(v => v.colId),
          colNames: Object.fromEntries(cols.map(v => [v.colId, v.name])),
          ...(Object.keys(colValueLabels).length > 0 ? { colValueLabels } : {}),
          options: {
            cells: options.cells,
            stats: options.stats,
            ...(pMethodParams ? { pMethod: pMethodParams } : {})
          }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:crosstabs.title', assignments: assignments }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'crosstabs'}
      titleKey="analysis:crosstabs.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={assignments => void handleSubmit(assignments)}
      onCancel={onClose}
      generateRCode={generateRCode}
      generateSyntax={a => buildSyntax.crosstabs(a['rows'] ?? [], a['cols'] ?? [], options)}
    />
  )
}
