// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Content Validity (Lawshe) dialog — Analyze → Scale → Content Validity.
 * One row per expert, one column per item; the cells hold rating codes
 * (lawshe.R).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnalysisDialogShell } from '../../components/Dialogs/AnalysisDialogShell'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'

export function LawsheDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { running, run } = useRunAnalysis()
  const [essential, setEssential] = useState('1')
  const [criterion, setCriterion] = useState<'exact' | 'lawshe'>('exact')
  const essentialOk = essential.trim() !== '' && Number.isFinite(Number(essential))

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    await run(
      {
        analysisId: 'lawshe',
        datasetId,
        scriptFile: 'lawshe.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          options: { essential: Number(essential), criterion }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:lawshe.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId="lawshe"
      titleKey="analysis:lawshe.title"
      fieldDefs={[
        {
          key: 'variables',
          labelKey: 'analysis:lawshe.itemsField',
          filter: (v: Variable) => v.type === 'numeric'
        }
      ]}
      canSubmit={a => (a['variables'] ?? []).length >= 1 && essentialOk && !running}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setEssential('1')
        setCriterion('exact')
      }}
      extraContent={
        <div className={shellStyles.optionSection}>
          <div className={shellStyles.optionHint}>{t('analysis:lawshe.hint')}</div>
          <label className={shellStyles.checkRow}>
            {t('analysis:lawshe.essentialCode')}
            <input
              type="number"
              step="1"
              className="numField"
              value={essential}
              onChange={e => {
                setEssential(e.target.value)
              }}
            />
          </label>
          <label className={shellStyles.checkRow}>
            {t('analysis:lawshe.criterionLabel')}
            <select
              className="numField numField--select"
              value={criterion}
              onChange={e => {
                setCriterion(e.target.value as 'exact' | 'lawshe')
              }}
            >
              <option value="exact">{t('analysis:lawshe.criterionExact')}</option>
              <option value="lawshe">{t('analysis:lawshe.criterionLawshe')}</option>
            </select>
          </label>
        </div>
      }
    />
  )
}
