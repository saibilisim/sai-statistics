// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Harman's Single-Factor Test dialog — Analyze → Scale → Harman's
 * Single-Factor Test (common method variance; harman.R).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnalysisDialogShell, CheckOption } from '../../components/Dialogs/AnalysisDialogShell'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'

export function HarmanDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { running, run } = useRunAnalysis()
  const [cfa, setCfa] = useState(true)

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    await run(
      {
        analysisId: 'harman',
        datasetId,
        scriptFile: 'harman.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          options: { cfa }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:harman.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId="harman"
      titleKey="analysis:harman.title"
      fieldDefs={[
        {
          key: 'variables',
          labelKey: 'analysis:harman.itemsField',
          filter: (v: Variable) => v.type === 'numeric'
        }
      ]}
      canSubmit={a => (a['variables'] ?? []).length >= 3 && !running}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setCfa(true)
      }}
      extraContent={
        <div className={shellStyles.optionSection}>
          <div className={shellStyles.optionHint}>{t('analysis:harman.hint')}</div>
          <CheckOption checked={cfa} onChange={setCfa}>
            {t('analysis:harman.cfaOption')}
          </CheckOption>
        </div>
      }
    />
  )
}
