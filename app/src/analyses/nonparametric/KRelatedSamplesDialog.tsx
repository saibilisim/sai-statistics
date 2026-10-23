// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K-Related-Samples (Friedman) dialog — SPSS-style.
 * Analyze → Nonparametric Tests → K Related Samples
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  CheckOption,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import {
  PMethodSection,
  buildPMethodParams,
  defaultPMethodOptions,
  type PMethodOptions
} from '../_shared/PMethodSection'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

export function KRelatedSamplesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [pairwise, setPairwise] = useState(false)
  const [pMethod, setPMethod] = useState<PMethodOptions>(defaultPMethodOptions)
  const { running, run } = useRunAnalysis()

  // Science-over-SPSS (CLAUDE.md §11): optional Monte Carlo / exact p via the
  // coin package (base R has no exact path for Friedman).
  const sideButtons: SideButtonDef[] = [
    {
      key: 'exact',
      labelKey: 'analysis:shell.btnExact',
      titleKey: 'analysis:common.pMethod.dialogTitle',
      renderContent: ({ onClose: closeSub }) => (
        <PMethodSection value={pMethod} onChange={setPMethod} onClose={closeSub} allowExact />
      )
    }
  ]

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:nparFriedman.variablesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length >= 2 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    await run(
      {
        analysisId: 'nparFriedman',
        datasetId,
        scriptFile: 'npar-friedman.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          options: {
            pairwise,
            ...(buildPMethodParams(pMethod) ? { pMethod: buildPMethodParams(pMethod) } : {})
          }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:nparFriedman.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'nparFriedman'}
      titleKey="analysis:nparFriedman.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.nparFriedman(a['variables'] ?? [], buildPMethodParams(pMethod))
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <CheckOption
            checked={pairwise}
            onChange={v => {
              setPairwise(v)
            }}
          >
            {t('analysis:nparFriedman.pairwiseOption')}
          </CheckOption>
        </div>
      }
    />
  )
}
