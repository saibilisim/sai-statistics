// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Runs Test dialog — SPSS-style.
 * Analyze → Nonparametric Tests → Runs
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
import {
  PMethodSection,
  defaultPMethodOptions,
  type PMethodOptions
} from '../_shared/PMethodSection'
import { buildSyntax } from '../../lib/spss-syntax'

export function RunsTestDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [cutPoint, setCutPoint] = useState<'median' | 'mean'>('median')
  const [pMethod, setPMethod] = useState<PMethodOptions>(defaultPMethodOptions)
  const exact = pMethod.method === 'exact'
  const [nparOpts, setNparOpts] = useState<NparOneSampleOptions>(defaultNparOneSampleOptions)
  const { running, run } = useRunAnalysis()

  // SPSS puts the exact p behind its own Exact… button, not on the main page.
  // npar-runs.R offers the exact distribution only (randtests), so the panel
  // hides Monte Carlo rather than offer a choice the script would ignore.
  const sideButtons: SideButtonDef[] = [
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:nparRuns.optionsTitleDlg',
      renderContent: ({ onClose: closeSub }) => (
        <NparOneSampleOptionsContent value={nparOpts} onChange={setNparOpts} onClose={closeSub} />
      )
    },
    {
      key: 'exact',
      labelKey: 'analysis:shell.btnExact',
      titleKey: 'analysis:common.pMethod.dialogTitle',
      renderContent: ({ onClose: closeSub }) => (
        <PMethodSection
          value={pMethod}
          onChange={setPMethod}
          onClose={closeSub}
          allowExact
          allowMonteCarlo={false}
        />
      )
    }
  ]

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:nparRuns.testField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) => (a['variables'] ?? []).length > 0 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    await run(
      {
        analysisId: 'nparRuns',
        datasetId,
        scriptFile: 'npar-runs.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          cutPoint,
          options: { ...nparOpts, ...(exact ? { pMethod: { method: 'exact' } } : {}) }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:nparRuns.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'nparRuns'}
      titleKey="analysis:nparRuns.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.nparRuns(
          a['variables'] ?? [],
          cutPoint,
          exact ? { method: 'exact' } : undefined
        )
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <div className={shellStyles.optionSectionTitle}>{t('analysis:nparRuns.cutPoint')}</div>
          <div className={shellStyles.optionGrid}>
            <label className={shellStyles.checkRow}>
              <input
                type="radio"
                checked={cutPoint === 'median'}
                onChange={() => {
                  setCutPoint('median')
                }}
              />
              {t('analysis:nparRuns.median')}
            </label>
            <label className={shellStyles.checkRow}>
              <input
                type="radio"
                checked={cutPoint === 'mean'}
                onChange={() => {
                  setCutPoint('mean')
                }}
              />
              {t('analysis:nparRuns.mean')}
            </label>
          </div>
        </div>
      }
    />
  )
}
