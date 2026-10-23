// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Missing Value Analysis dialog — SPSS Analyze → Missing Value Analysis.
 *
 * Sub-dialogs as SPSS: Estimation (listwise, pairwise, EM, regression — on
 * SPSS's main page, kept behind a button here so the page stays compact),
 * Patterns (tabulated patterns) and Descriptives (separate-variance t tests,
 * percent mismatch). missing-values.R always prints the Univariate
 * Statistics and Little's MCAR test.
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

const ESTIMATIONS = ['listwise', 'pairwise', 'em', 'regression'] as const
type Estimation = (typeof ESTIMATIONS)[number]
const ESTIMATION_LABEL_KEYS = {
  listwise: 'analysis:output.missing.listwise',
  pairwise: 'analysis:missing.pairwise',
  em: 'analysis:output.missing.em',
  regression: 'analysis:output.missing.regression'
} as const satisfies Record<Estimation, string>

interface MvaOptions {
  estimation: Estimation[]
  patterns: boolean
  tTests: boolean
  mismatch: boolean
  minPercent: string
}
const defaultMva: MvaOptions = {
  estimation: [],
  patterns: false,
  tTests: false,
  mismatch: false,
  minPercent: '5'
}

/** One sub-dialog body; `part` picks which of the options it edits. */
function MvaContent({
  part,
  value,
  onChange,
  onClose
}: {
  part: 'estimation' | 'patterns' | 'descriptives'
  value: MvaOptions
  onChange: (v: MvaOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)
  const set = <K extends keyof MvaOptions>(k: K, v: MvaOptions[K]) => {
    setLocal(prev => ({ ...prev, [k]: v }))
  }
  return (
    <>
      {part === 'estimation' && (
        <OptionSection titleKey="analysis:missing.estimationSection">
          {ESTIMATIONS.map(e => (
            <CheckOption
              key={e}
              checked={local.estimation.includes(e)}
              onChange={on => {
                set(
                  'estimation',
                  on ? [...local.estimation, e] : local.estimation.filter(x => x !== e)
                )
              }}
            >
              {t(ESTIMATION_LABEL_KEYS[e])}
            </CheckOption>
          ))}
        </OptionSection>
      )}
      {part === 'patterns' && (
        <OptionSection grid={false}>
          <CheckOption
            checked={local.patterns}
            onChange={v => {
              set('patterns', v)
            }}
          >
            {t('analysis:missing.tabulatedPatterns')}
          </CheckOption>
        </OptionSection>
      )}
      {part === 'descriptives' && (
        <OptionSection titleKey="analysis:missing.indicatorSection" grid={false}>
          <CheckOption
            checked={local.tTests}
            onChange={v => {
              set('tTests', v)
            }}
          >
            {t('analysis:missing.tTests')}
          </CheckOption>
          <CheckOption
            checked={local.mismatch}
            onChange={v => {
              set('mismatch', v)
            }}
          >
            {t('analysis:missing.mismatch')}
          </CheckOption>
          <label className={shellStyles.checkRow}>
            {t('analysis:missing.minPercent')}
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              value={local.minPercent}
              disabled={!local.tTests}
              onChange={e => {
                set('minPercent', e.target.value)
              }}
              className="numField"
            />
          </label>
        </OptionSection>
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

export function MissingValuesDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { running, run } = useRunAnalysis()
  const [opts, setOpts] = useState<MvaOptions>(defaultMva)

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:missing.variablesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length >= 2 && !running

  const button = (
    key: 'estimation' | 'patterns' | 'descriptives',
    labelKey: string,
    titleKey: string
  ): SideButtonDef => ({
    key,
    labelKey,
    titleKey,
    renderContent: ({ onClose: closeSub }) => (
      <MvaContent part={key} value={opts} onChange={setOpts} onClose={closeSub} />
    )
  })
  const sideButtons: SideButtonDef[] = [
    button('estimation', 'analysis:missing.btnEstimation', 'analysis:missing.estimationTitleDlg'),
    button('patterns', 'analysis:missing.btnPatterns', 'analysis:missing.patternsTitleDlg'),
    button(
      'descriptives',
      'analysis:shell.btnDescriptives',
      'analysis:missing.descriptivesTitleDlg'
    )
  ]

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    const minPct = Number(opts.minPercent)
    await run(
      {
        analysisId: 'missing',
        datasetId,
        scriptFile: 'missing-values.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          options: {
            estimation: ESTIMATIONS.filter(e => opts.estimation.includes(e)),
            patterns: opts.patterns,
            tTests: opts.tTests,
            mismatch: opts.mismatch,
            minPercent: Number.isFinite(minPct) ? minPct : 5
          }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:missing.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'missing'}
      titleKey="analysis:missing.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setOpts(defaultMva)
      }}
      generateSyntax={a => buildSyntax.missingValueAnalysis(a['variables'] ?? [])}
    />
  )
}
