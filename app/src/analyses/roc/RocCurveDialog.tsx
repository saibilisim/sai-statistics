// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ROC Curve dialog — SPSS-style.
 * Analyze → Classify → ROC Curve
 *
 * The main page holds only the variables and the state value (OK is gated on
 * it). Unlike SPSS, which prints the Display group on the main page, Display
 * is its own sub-dialog here, so the page stays as compact as ROC Analysis.
 * Classification, Test Direction, the standard error parameters and Missing
 * Values live in the Options sub-dialog shared with ROC Analysis.
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
import { defaultRocOptions, rocCiFraction, rocOptionParams, type RocOptions } from './roc-options'
import { RocOptionsContent } from './RocOptions'

interface RocDisplay {
  plotCurve: boolean
  diagonal: boolean
  seCi: boolean
  coordinates: boolean
}

const defaultDisplay: RocDisplay = {
  plotCurve: true,
  diagonal: true,
  seCi: true,
  coordinates: false
}

// ─────────────────────────────────────────────────────────────
//  Display sub-dialog (same Plot / Print grouping as ROC Analysis)
// ─────────────────────────────────────────────────────────────

function DisplayContent({
  display,
  onChange,
  onClose
}: {
  display: RocDisplay
  onChange: (d: RocDisplay) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(display)
  const set = <K extends keyof RocDisplay>(key: K, val: RocDisplay[K]) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }

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

export function RocCurveDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [stateValue, setStateValue] = useState('')
  const [display, setDisplay] = useState<RocDisplay>(defaultDisplay)
  const [options, setOptions] = useState<RocOptions>(defaultRocOptions)
  const { running, run } = useRunAnalysis()

  const sideButtons: SideButtonDef[] = [
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:roc.optionsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <RocOptionsContent options={options} onChange={setOptions} onClose={closeSub} />
      )
    },
    {
      key: 'display',
      labelKey: 'analysis:shell.btnDisplay',
      titleKey: 'analysis:roc.displayTitle',
      renderContent: ({ onClose: closeSub }) => (
        <DisplayContent display={display} onChange={setDisplay} onClose={closeSub} />
      )
    }
  ]

  const fieldDefs = [
    {
      key: 'test',
      labelKey: 'analysis:roc.testField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    },
    { key: 'state', labelKey: 'analysis:roc.stateField', single: true }
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
        analysisId: 'roc',
        datasetId,
        scriptFile: 'roc.R',
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
      { titleKey: 'analysis:roc.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'roc'}
      titleKey="analysis:roc.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setStateValue('')
        setDisplay(defaultDisplay)
        setOptions(defaultRocOptions)
      }}
      generateSyntax={a =>
        buildSyntax.roc(a['test'] ?? [], a['state'] ?? [], stateValue.trim(), {
          ...display,
          ...options,
          ciLevel: rocCiFraction(options)
        })
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {t('analysis:roc.stateValue')}
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
