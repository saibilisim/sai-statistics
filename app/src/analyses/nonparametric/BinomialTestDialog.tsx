// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Binomial Test dialog — SPSS-style.
 * Analyze → Nonparametric Tests → Binomial
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { NparOneSampleOptionsContent } from './NparOneSampleOptionsContent'
import { defaultNparOneSampleOptions, type NparOneSampleOptions } from './npar-options'
import { buildSyntax } from '../../lib/spss-syntax'

export function BinomialTestDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [testProp, setTestProp] = useState('0.5')
  const [nparOpts, setNparOpts] = useState<NparOneSampleOptions>(defaultNparOneSampleOptions)
  const { running, run } = useRunAnalysis()

  const sideButtons: SideButtonDef[] = [
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:nparBinomial.optionsTitleDlg',
      renderContent: ({ onClose: closeSub }) => (
        <NparOneSampleOptionsContent value={nparOpts} onChange={setNparOpts} onClose={closeSub} />
      )
    }
  ]

  const fieldDefs = [
    { key: 'variables', labelKey: 'analysis:nparBinomial.testField', single: false }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length > 0 && testProp.trim() !== '' && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    await run(
      {
        analysisId: 'nparBinomial',
        datasetId,
        scriptFile: 'npar-binomial.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          testProp: Number(testProp) || 0.5,
          options: nparOpts
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:nparBinomial.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'nparBinomial'}
      titleKey="analysis:nparBinomial.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a => buildSyntax.nparBinomial(a['variables'] ?? [], Number(testProp) || 0.5)}
      extraContent={
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {t('analysis:nparBinomial.testPropLabel')}
            <input
              type="number"
              value={testProp}
              step="0.01"
              min="0"
              max="1"
              onChange={e => {
                setTestProp(e.target.value)
              }}
              className="numField"
            />
          </label>
        </div>
      }
    />
  )
}
