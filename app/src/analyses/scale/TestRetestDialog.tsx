// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test-Retest Reliability dialog — Analyze → Scale → Test-Retest Reliability.
 * First and second administrations are paired by position (test-retest.R).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnalysisDialogShell } from '../../components/Dialogs/AnalysisDialogShell'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'

type IccModel = 'mixed' | 'random'
type IccType = 'absolute' | 'consistency'

export function TestRetestDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { running, run } = useRunAnalysis()
  const [model, setModel] = useState<IccModel>('mixed')
  const [type, setType] = useState<IccType>('absolute')

  const numeric = (v: Variable) => v.type === 'numeric'
  const fieldDefs = [
    { key: 'first', labelKey: 'analysis:retest.firstField', filter: numeric },
    { key: 'second', labelKey: 'analysis:retest.secondField', filter: numeric }
  ]
  const pairsOk = (a: Record<string, Variable[]>) => {
    const n1 = (a['first'] ?? []).length
    return n1 > 0 && n1 === (a['second'] ?? []).length
  }

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const first = a['first'] ?? []
    const second = a['second'] ?? []
    const all = [...first, ...second]
    await run(
      {
        analysisId: 'retest',
        datasetId,
        scriptFile: 'test-retest.R',
        params: {
          first: first.map(v => v.colId),
          second: second.map(v => v.colId),
          varNames: Object.fromEntries(all.map(v => [v.colId, v.name])),
          options: { iccModel: model, iccType: type, ci: 95 }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:retest.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId="retest"
      titleKey="analysis:retest.title"
      fieldDefs={fieldDefs}
      canSubmit={a => pairsOk(a) && !running}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setModel('mixed')
        setType('absolute')
      }}
      extraContent={
        <div className={shellStyles.optionSection}>
          <div className={shellStyles.optionHint}>{t('analysis:retest.hint')}</div>
          <label className={shellStyles.checkRow}>
            {t('analysis:reliability.iccModelLabel')}
            <select
              className="numField numField--select"
              value={model}
              onChange={e => {
                setModel(e.target.value as IccModel)
              }}
            >
              <option value="mixed">{t('analysis:reliability.iccModel_mixed')}</option>
              <option value="random">{t('analysis:reliability.iccModel_random')}</option>
            </select>
          </label>
          <label className={shellStyles.checkRow}>
            {t('analysis:reliability.iccTypeLabel')}
            <select
              className="numField numField--select"
              value={type}
              onChange={e => {
                setType(e.target.value as IccType)
              }}
            >
              <option value="absolute">{t('analysis:reliability.iccType_absolute')}</option>
              <option value="consistency">{t('analysis:reliability.iccType_consistency')}</option>
            </select>
          </label>
        </div>
      }
    />
  )
}
