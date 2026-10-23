// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ROC Analysis dialog — SPSS 26+ style.
 * Analyze → Classify → ROC Analysis
 *
 * Adds a Precision-Recall curve, Overall Model Quality and per-cutoff
 * classifier evaluation metrics on top of the classic ROC Curve procedure
 * (RocCurveDialog), plus (RA4, spss-parity-findings-2026-07-07 §B5) an
 * optional pairwise DeLong AUC comparison across 2+ test variables sharing the
 * same state variable/cases.
 *
 * As in SPSS, the main page carries only the variables and the state value
 * (which OK is gated on, so it must stay visible); everything else lives in
 * the Options (shared with ROC Curve) and Display sub-dialogs.
 */

import { useId, useState } from 'react'
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
import { cx } from '../../lib/cx'
import { defaultRocOptions, rocCiFraction, rocOptionParams, type RocOptions } from './roc-options'
import { RocOptionsContent } from './RocOptions'

interface RocAnalysisDisplay {
  plotCurve: boolean
  diagonal: boolean
  prCurve: boolean
  prInterp: 'tp' | 'fp'
  modelQuality: boolean
  seCi: boolean
  coordinates: boolean
  prCoordinates: boolean
  metrics: boolean
  compareAuc: boolean
}

const defaultDisplay: RocAnalysisDisplay = {
  plotCurve: true,
  diagonal: true,
  prCurve: true,
  prInterp: 'tp',
  modelQuality: false,
  seCi: true,
  coordinates: false,
  prCoordinates: false,
  metrics: true,
  compareAuc: false
}

// ─────────────────────────────────────────────────────────────
//  Display sub-dialog (SPSS: Plot + Print groups)
// ─────────────────────────────────────────────────────────────

function DisplayContent({
  display,
  onChange,
  onClose
}: {
  display: RocAnalysisDisplay
  onChange: (d: RocAnalysisDisplay) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const id = useId()
  const [local, setLocal] = useState(display)
  const set = <K extends keyof RocAnalysisDisplay>(key: K, val: RocAnalysisDisplay[K]) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }
  const interpRadio = (value: RocAnalysisDisplay['prInterp'], labelKey: string) => (
    <label className={cx(shellStyles.checkRow, shellStyles.checkRowIndent)}>
      <input
        type="radio"
        name={`${id}-interp`}
        checked={local.prInterp === value}
        disabled={!local.prCurve}
        onChange={() => {
          set('prInterp', value)
        }}
      />
      {t(labelKey as never)}
    </label>
  )

  return (
    <>
      <OptionSection titleKey="analysis:rocAnalysis.plotSection" grid={false}>
        <CheckOption
          checked={local.plotCurve}
          onChange={v => {
            set('plotCurve', v)
          }}
        >
          {t('analysis:roc.plotCurve')}
        </CheckOption>
        <CheckOption
          className={shellStyles.checkRowIndent}
          checked={local.diagonal}
          disabled={!local.plotCurve}
          onChange={v => {
            set('diagonal', v)
          }}
        >
          {t('analysis:roc.diagonal')}
        </CheckOption>
        <CheckOption
          checked={local.prCurve}
          onChange={v => {
            set('prCurve', v)
          }}
        >
          {t('analysis:rocAnalysis.prCurve')}
        </CheckOption>
        {interpRadio('tp', 'analysis:rocAnalysis.prInterpTp')}
        {interpRadio('fp', 'analysis:rocAnalysis.prInterpFp')}
        <CheckOption
          checked={local.modelQuality}
          onChange={v => {
            set('modelQuality', v)
          }}
        >
          {t('analysis:rocAnalysis.modelQuality')}
        </CheckOption>
      </OptionSection>

      <OptionSection titleKey="analysis:rocAnalysis.printSection" grid={false}>
        <CheckOption
          checked={local.seCi}
          onChange={v => {
            set('seCi', v)
          }}
        >
          {t('analysis:roc.seCi')}
        </CheckOption>
        <CheckOption
          checked={local.coordinates}
          onChange={v => {
            set('coordinates', v)
          }}
        >
          {t('analysis:roc.coordinates')}
        </CheckOption>
        <CheckOption
          checked={local.prCoordinates}
          onChange={v => {
            set('prCoordinates', v)
          }}
        >
          {t('analysis:rocAnalysis.prCoordinates')}
        </CheckOption>
        <CheckOption
          checked={local.metrics}
          onChange={v => {
            set('metrics', v)
          }}
        >
          {t('analysis:rocAnalysis.metrics')}
        </CheckOption>
        <CheckOption
          checked={local.compareAuc}
          onChange={v => {
            set('compareAuc', v)
          }}
        >
          {t('analysis:rocAnalysis.compareAuc')}
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

export function RocAnalysisDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [stateValue, setStateValue] = useState('')
  const [options, setOptions] = useState<RocOptions>(defaultRocOptions)
  const [display, setDisplay] = useState<RocAnalysisDisplay>(defaultDisplay)
  const { running, run } = useRunAnalysis()

  const sideButtons: SideButtonDef[] = [
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:rocAnalysis.optionsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <RocOptionsContent options={options} onChange={setOptions} onClose={closeSub} />
      )
    },
    {
      key: 'display',
      labelKey: 'analysis:shell.btnDisplay',
      titleKey: 'analysis:rocAnalysis.displayTitle',
      renderContent: ({ onClose: closeSub }) => (
        <DisplayContent display={display} onChange={setDisplay} onClose={closeSub} />
      )
    }
  ]

  const fieldDefs = [
    {
      key: 'test',
      labelKey: 'analysis:rocAnalysis.testField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    },
    { key: 'state', labelKey: 'analysis:rocAnalysis.stateField', single: true }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['test'] ?? []).length > 0 &&
    (a['state'] ?? []).length === 1 &&
    stateValue.trim() !== '' &&
    !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const test = a['test'] ?? []
    const state = (a['state'] ?? [])[0]
    if (test.length === 0 || !state) return
    await run(
      {
        analysisId: 'rocAnalysis',
        datasetId,
        scriptFile: 'roc-analysis.R',
        params: {
          variables: test.map(v => v.colId),
          varNames: Object.fromEntries(test.map(v => [v.colId, v.name])),
          stateVar: state.colId,
          stateName: state.name,
          stateLabel: state.label,
          stateValueLabels: state.valueLabels,
          stateValue: stateValue.trim(),
          options: { ...display, ...rocOptionParams(options) }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:rocAnalysis.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'rocAnalysis'}
      titleKey="analysis:rocAnalysis.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setStateValue('')
        setOptions(defaultRocOptions)
        setDisplay(defaultDisplay)
      }}
      generateSyntax={a =>
        buildSyntax.rocAnalysis(
          a['test'] ?? [],
          a['state'] ?? [],
          stateValue.trim(),
          { ...options, ciLevel: rocCiFraction(options) },
          display
        )
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {t('analysis:rocAnalysis.stateValue')}
            <input
              type="text"
              value={stateValue}
              onChange={e => {
                setStateValue(e.target.value)
              }}
              className="numField"
            />
          </label>
        </div>
      }
    />
  )
}
