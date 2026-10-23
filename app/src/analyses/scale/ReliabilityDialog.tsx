// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reliability Analysis dialog — SPSS-style.
 * Analyze → Scale → Reliability Analysis
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

// ─────────────────────────────────────────────────────────────
//  Statistics sub-dialog
// ─────────────────────────────────────────────────────────────

function StatisticsContent({
  interItemCorr,
  onChange,
  onClose
}: {
  interItemCorr: boolean
  onChange: (v: boolean) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(interItemCorr)

  return (
    <>
      <OptionSection>
        <CheckOption checked={local} onChange={setLocal}>
          {t('analysis:reliability.interItemCorrOption')}
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

export function ReliabilityDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [interItemCorr, setInterItemCorr] = useState(false)
  // SPSS's Model list. Alpha is the default; Split-half cuts the scale in two
  // by item order and reports the halves' agreement instead — a different
  // model, which is why it replaces rather than extends the alpha output.
  const [model, setModel] = useState<'alpha' | 'split'>('alpha')
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:reliability.itemsField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  // Model stays in the main dialog (SPSS keeps its Model list there too);
  // only the extra output toggles move behind "Statistics…".
  const sideButtons: SideButtonDef[] = [
    {
      key: 'statistics',
      labelKey: 'analysis:shell.btnStatistics',
      titleKey: 'analysis:reliability.statisticsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <StatisticsContent
          interItemCorr={interItemCorr}
          onChange={setInterItemCorr}
          onClose={closeSub}
        />
      )
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length >= 2 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    await run(
      {
        analysisId: 'reliability',
        datasetId,
        scriptFile: 'reliability.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          options: { interItemCorr, model }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:reliability.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'reliability'}
      titleKey="analysis:reliability.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a => buildSyntax.reliability(a['variables'] ?? [], { interItemCorr, model })}
      extraContent={
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {t('analysis:reliability.modelLabel')}
            <select
              value={model}
              onChange={e => {
                setModel(e.target.value as 'alpha' | 'split')
              }}
              className="numField numField--select"
            >
              <option value="alpha">{t('analysis:reliability.modelAlpha')}</option>
              <option value="split">{t('analysis:reliability.modelSplit')}</option>
            </select>
          </label>
        </div>
      }
    />
  )
}
