// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Kaplan-Meier dialog — SPSS-style.
 * Analyze → Survival → Kaplan-Meier
 *
 * Mirrors SPSS's own sub-dialogs: "Compare Factor" (which of the three
 * weighted log-rank tests to run, and whether to run them pooled, per
 * stratum or pairwise) and "Options" (which statistics and which plots).
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
import type { KaplanMeierOptions } from '@shared/survival-types'
import { defaultKaplanMeierOptions, KM_COMPARE_MODES } from '@shared/survival-types'
import { NewVariablesPanel, type NewVarSlot } from '../../components/Dialogs/NewVariablesPanel'
import { cleanNewVarSelection, type NewVarSelection } from '@/lib/new-var-names'

/* What a KM run can hand back per case, each evaluated on that case's OWN
   group curve at its OWN follow-up time. Keys match requested_new_vars() in
   survival-km.R. */
const KM_NEW_VARS: NewVarSlot[] = [
  { key: 'survival', labelKey: 'analysis:survivalKM.newVar.survival', defaultName: 'sur' },
  { key: 'se', labelKey: 'analysis:survivalKM.newVar.se', defaultName: 'sur_se' },
  { key: 'hazard', labelKey: 'analysis:survivalKM.newVar.hazard', defaultName: 'haz' },
  { key: 'cumEvents', labelKey: 'analysis:survivalKM.newVar.cumEvents', defaultName: 'cum_ev' }
]

function CompareFactorContent({
  compare,
  onChange,
  onClose
}: {
  compare: KaplanMeierOptions['compare']
  onChange: (c: KaplanMeierOptions['compare']) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(compare)

  return (
    <>
      <OptionSection titleKey="analysis:survivalKM.testStatistics">
        <CheckOption
          checked={local.logRank}
          onChange={v => {
            setLocal(prev => ({ ...prev, logRank: v }))
          }}
        >
          {t('analysis:survivalKM.testLogRank')}
        </CheckOption>
        <CheckOption
          checked={local.breslow}
          onChange={v => {
            setLocal(prev => ({ ...prev, breslow: v }))
          }}
          title={t('analysis:survivalKM.testBreslowHint')}
        >
          {t('analysis:survivalKM.testBreslow')}
        </CheckOption>
        <CheckOption
          checked={local.taroneWare}
          onChange={v => {
            setLocal(prev => ({ ...prev, taroneWare: v }))
          }}
          title={t('analysis:survivalKM.testTaroneWareHint')}
        >
          {t('analysis:survivalKM.testTaroneWare')}
        </CheckOption>
      </OptionSection>
      <OptionSection titleKey="analysis:survivalKM.compareMode" grid={false}>
        {KM_COMPARE_MODES.map(mode => (
          <label key={mode} className={shellStyles.checkRow}>
            <input
              type="radio"
              name="km-compare-mode"
              checked={local.mode === mode}
              onChange={() => {
                setLocal(prev => ({ ...prev, mode }))
              }}
            />
            {t(`analysis:survivalKM.mode_${mode}`)}
          </label>
        ))}
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

function OptionsContent({
  stats,
  plots,
  onStatsChange,
  onPlotsChange,
  onClose
}: {
  stats: KaplanMeierOptions['stats']
  plots: KaplanMeierOptions['plots']
  onStatsChange: (s: KaplanMeierOptions['stats']) => void
  onPlotsChange: (p: KaplanMeierOptions['plots']) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [localStats, setLocalStats] = useState(stats)
  const [localPlots, setLocalPlots] = useState(plots)

  return (
    <>
      <OptionSection titleKey="analysis:shell.btnStatistics">
        <CheckOption
          checked={localStats.survivalTable}
          onChange={v => {
            setLocalStats(prev => ({ ...prev, survivalTable: v }))
          }}
        >
          {t('analysis:survivalKM.statSurvivalTable')}
        </CheckOption>
        <CheckOption
          checked={localStats.meanMedian}
          onChange={v => {
            setLocalStats(prev => ({ ...prev, meanMedian: v }))
          }}
        >
          {t('analysis:survivalKM.statMeanMedian')}
        </CheckOption>
        <CheckOption
          checked={localStats.quartiles}
          onChange={v => {
            setLocalStats(prev => ({ ...prev, quartiles: v }))
          }}
        >
          {t('analysis:survivalKM.statQuartiles')}
        </CheckOption>
      </OptionSection>
      <OptionSection titleKey="analysis:shell.btnPlots">
        <CheckOption
          checked={localPlots.survival}
          onChange={v => {
            setLocalPlots(prev => ({ ...prev, survival: v }))
          }}
        >
          {t('analysis:survivalKM.plotSurvival')}
        </CheckOption>
        <CheckOption
          checked={localPlots.oneMinusSurvival}
          onChange={v => {
            setLocalPlots(prev => ({ ...prev, oneMinusSurvival: v }))
          }}
        >
          {t('analysis:survivalKM.plotOneMinus')}
        </CheckOption>
        <CheckOption
          checked={localPlots.hazard}
          onChange={v => {
            setLocalPlots(prev => ({ ...prev, hazard: v }))
          }}
        >
          {t('analysis:survivalKM.plotHazard')}
        </CheckOption>
        <CheckOption
          checked={localPlots.logSurvival}
          onChange={v => {
            setLocalPlots(prev => ({ ...prev, logSurvival: v }))
          }}
        >
          {t('analysis:survivalKM.plotLogSurvival')}
        </CheckOption>
      </OptionSection>

      <SubDialogFooter
        onContinue={() => {
          onStatsChange(localStats)
          onPlotsChange(localPlots)
          onClose()
        }}
        onCancel={onClose}
      />
    </>
  )
}

export function KaplanMeierDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [eventValue, setEventValue] = useState('1')
  const [opts, setOpts] = useState<KaplanMeierOptions>(defaultKaplanMeierOptions)
  const [newVars, setNewVars] = useState<NewVarSelection>({})
  const existingNames = useDatasetStore(s => s.variables).map(v => v.name)
  const { running, run } = useRunAnalysis()

  const setCompare = (compare: KaplanMeierOptions['compare']) => {
    setOpts(o => ({ ...o, compare }))
  }
  const setStats = (stats: KaplanMeierOptions['stats']) => {
    setOpts(o => ({ ...o, stats }))
  }
  const setPlots = (plots: KaplanMeierOptions['plots']) => {
    setOpts(o => ({ ...o, plots }))
  }

  const fieldDefs = [
    {
      key: 'time',
      labelKey: 'analysis:survivalKM.timeField',
      single: true,
      filter: (v: Variable) => v.type === 'numeric'
    },
    { key: 'status', labelKey: 'analysis:survivalKM.statusField', single: true },
    { key: 'factor', labelKey: 'analysis:survivalKM.factorField', single: true },
    { key: 'strata', labelKey: 'analysis:survivalKM.strataField', single: true }
  ]

  const sideButtons: SideButtonDef[] = [
    {
      key: 'compare',
      labelKey: 'analysis:survivalKM.btnCompare',
      titleKey: 'analysis:survivalKM.compareTitle',
      renderContent: ({ onClose: closeSub }) => (
        <CompareFactorContent compare={opts.compare} onChange={setCompare} onClose={closeSub} />
      )
    },
    {
      key: 'newVars',
      labelKey: 'analysis:shell.btnNewVars',
      titleKey: 'analysis:newVars.title',
      renderContent: ({ onClose: closeSub }) => (
        <NewVariablesPanel
          slots={KM_NEW_VARS}
          value={newVars}
          onChange={setNewVars}
          existingNames={existingNames}
          onClose={closeSub}
        />
      )
    },
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:survivalKM.optionsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <OptionsContent
          stats={opts.stats}
          plots={opts.plots}
          onStatsChange={setStats}
          onPlotsChange={setPlots}
          onClose={closeSub}
        />
      )
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['time'] ?? []).length === 1 &&
    (a['status'] ?? []).length === 1 &&
    eventValue.trim() !== '' &&
    !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const time = (a['time'] ?? [])[0]
    const status = (a['status'] ?? [])[0]
    const factor = (a['factor'] ?? [])[0]
    const strata = (a['strata'] ?? [])[0]
    if (!time || !status) return
    await run(
      {
        analysisId: 'survivalKM',
        datasetId,
        scriptFile: 'survival-km.R',
        params: {
          timeVar: time.colId,
          timeName: time.name,
          statusVar: status.colId,
          statusName: status.name,
          eventValue: eventValue.trim(),
          factor: factor?.colId ?? null,
          factorName: factor?.name ?? null,
          factorValueLabels: factor?.valueLabels ?? null,
          strata: strata?.colId ?? null,
          strataName: strata?.name ?? null,
          strataValueLabels: strata?.valueLabels ?? null,
          options: opts,
          createVars: cleanNewVarSelection(newVars, existingNames)
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:survivalKM.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'survivalKM'}
      titleKey="analysis:survivalKM.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.kaplanMeier(
          a['time'] ?? [],
          a['status'] ?? [],
          eventValue.trim(),
          a['factor'] ?? [],
          a['strata'] ?? [],
          opts
        )
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {t('analysis:survivalKM.eventValue')}
            <input
              type="text"
              value={eventValue}
              onChange={e => {
                setEventValue(e.target.value)
              }}
              className="numField"
            />
          </label>
        </div>
      }
    />
  )
}
