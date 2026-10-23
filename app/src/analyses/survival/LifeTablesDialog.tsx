// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Life Tables dialog — SPSS Survival → Life Tables.
 * Analyze → Survival → Life Tables
 *
 * Options sub-dialog as SPSS: display the life table, and the survival,
 * log survival, hazard, density and one minus survival plots.
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
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

const PLOT_KINDS = ['survival', 'logSurvival', 'hazard', 'density', 'oneMinusSurvival'] as const
type PlotKind = (typeof PLOT_KINDS)[number]
const PLOT_LABEL_KEYS = {
  survival: 'analysis:output.lifetab.plotSurvival',
  logSurvival: 'analysis:output.lifetab.plotLogSurvival',
  hazard: 'analysis:output.lifetab.plotHazard',
  density: 'analysis:output.lifetab.plotDensity',
  oneMinusSurvival: 'analysis:output.lifetab.plotOneMinusSurvival'
} as const satisfies Record<PlotKind, string>

interface LifeTableOptions {
  table: boolean
  plots: PlotKind[]
}

function OptionsContent({
  value,
  onChange,
  onClose
}: {
  value: LifeTableOptions
  onChange: (v: LifeTableOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)
  return (
    <>
      <OptionSection grid={false}>
        <CheckOption
          checked={local.table}
          onChange={v => {
            setLocal(prev => ({ ...prev, table: v }))
          }}
        >
          {t('analysis:lifetab.displayTable')}
        </CheckOption>
      </OptionSection>
      <OptionSection titleKey="analysis:lifetab.plotsSection">
        {PLOT_KINDS.map(k => (
          <CheckOption
            key={k}
            checked={local.plots.includes(k)}
            onChange={on => {
              setLocal(prev => ({
                ...prev,
                plots: on ? [...prev.plots, k] : prev.plots.filter(x => x !== k)
              }))
            }}
          >
            {t(PLOT_LABEL_KEYS[k])}
          </CheckOption>
        ))}
      </OptionSection>
      <SubDialogFooter
        continueDisabled={!local.table && local.plots.length === 0}
        onContinue={() => {
          onChange(local)
          onClose()
        }}
        onCancel={onClose}
      />
    </>
  )
}

export function LifeTablesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [interval, setInterval] = useState('')
  const [options, setOptions] = useState<LifeTableOptions>({ table: true, plots: [] })
  const { running, run } = useRunAnalysis()

  const sideButtons: SideButtonDef[] = [
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:lifetab.optionsTitleDlg',
      renderContent: ({ onClose: closeSub }) => (
        <OptionsContent value={options} onChange={setOptions} onClose={closeSub} />
      )
    }
  ]

  const fieldDefs = [
    {
      key: 'time',
      labelKey: 'analysis:lifetab.timeField',
      single: true,
      filter: (v: Variable) => v.type === 'numeric'
    },
    {
      key: 'status',
      labelKey: 'analysis:lifetab.statusField',
      single: true,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['time'] ?? []).length === 1 && (a['status'] ?? []).length === 1 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const time = (a['time'] ?? [])[0]
    const status = (a['status'] ?? [])[0]
    if (!time || !status) return
    const iv = parseFloat(interval)
    await run(
      {
        analysisId: 'lifetab',
        datasetId,
        scriptFile: 'life-tables.R',
        params: {
          time: time.colId,
          status: status.colId,
          interval: Number.isFinite(iv) && iv > 0 ? iv : null,
          varNames: { [time.colId]: time.name, [status.colId]: status.name },
          options: {
            table: options.table,
            plots: PLOT_KINDS.filter(k => options.plots.includes(k))
          }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:lifetab.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'lifetab'}
      titleKey="analysis:lifetab.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.lifeTables(a['time'] ?? [], a['status'] ?? [], parseFloat(interval) || null)
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <div className={shellStyles.optionSectionTitle}>{t('analysis:lifetab.interval')}</div>
          <label className={shellStyles.checkRow}>
            <input
              type="number"
              min="0"
              step="any"
              value={interval}
              placeholder={t('analysis:lifetab.intervalAuto')}
              onChange={e => {
                setInterval(e.target.value)
              }}
              className="numField"
            />
          </label>
        </div>
      }
    />
  )
}
