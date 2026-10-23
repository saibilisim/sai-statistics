// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Multiple Imputation dialog — SPSS Analyze → Multiple Imputation → Impute.
 * Package-gated on mice: if not installed, shows the install prompt instead.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnalysisDialogShell } from '../../components/Dialogs/AnalysisDialogShell'
import { PackageNeededDialog } from '../../components/Dialogs/PackageNeededDialog'
import { usePackageGate } from '../../lib/use-package-gate'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

export function MultipleImputationDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const { status, install } = usePackageGate('mice')
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [imputations, setImputations] = useState('5')
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:mi.variablesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length >= 2 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    const m = parseInt(imputations, 10)
    await run(
      {
        analysisId: 'mi',
        datasetId,
        scriptFile: 'mi.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          m: Number.isFinite(m) && m > 0 ? m : 5
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:mi.title', assignments: a }
    )
  }

  if (status !== 'installed') {
    return (
      <PackageNeededDialog
        titleKey="analysis:mi.title"
        pkg="mice"
        featureKey="rpkg.feature.mi"
        status={status}
        onInstall={() => void install()}
        onClose={onClose}
      />
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'mi'}
      titleKey="analysis:mi.title"
      fieldDefs={fieldDefs}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.multipleImputation(a['variables'] ?? [], parseInt(imputations, 10) || 5)
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <div className={shellStyles.optionSectionTitle}>{t('analysis:mi.imputations')}</div>
          <label className={shellStyles.checkRow}>
            <input
              type="number"
              min="2"
              step="1"
              value={imputations}
              onChange={e => {
                setImputations(e.target.value)
              }}
              className="numField"
            />
          </label>
        </div>
      }
    />
  )
}
