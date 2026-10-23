// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generalized Linear Models dialog — SPSS GENLIN-style.
 * Analyze → Generalized Linear Models
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  OptionSection,
  SubDialogFooter,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

type Dist = 'poisson' | 'negbin' | 'gamma' | 'normal'

function DistributionContent({
  dist,
  onChange,
  onClose
}: {
  dist: Dist
  onChange: (d: Dist) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(dist)

  return (
    <>
      <OptionSection title={t('analysis:genlin.distribution')} grid={false}>
        {(['poisson', 'negbin', 'gamma', 'normal'] as Dist[]).map(val => (
          <label key={val} className={shellStyles.checkRow}>
            <input
              type="radio"
              checked={local === val}
              onChange={() => {
                setLocal(val)
              }}
            />
            {t(`analysis:genlin.${val}`)}
          </label>
        ))}
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

export function GeneralizedLinearDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [dist, setDist] = useState<Dist>('poisson')
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'dependent',
      labelKey: 'analysis:genlin.dependentField',
      single: true,
      filter: (v: Variable) => v.type === 'numeric'
    },
    {
      key: 'predictors',
      labelKey: 'analysis:genlin.predictorsField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]

  const sideButtons: SideButtonDef[] = [
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:genlin.distribution',
      renderContent: ({ onClose: closeSub }) => (
        <DistributionContent dist={dist} onChange={setDist} onClose={closeSub} />
      )
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['dependent'] ?? []).length === 1 && (a['predictors'] ?? []).length > 0 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const dep = (a['dependent'] ?? [])[0]
    const preds = a['predictors'] ?? []
    if (!dep) return
    await run(
      {
        analysisId: 'genlin',
        datasetId,
        scriptFile: 'genlin.R',
        params: {
          dependent: dep.colId,
          dependentName: dep.name,
          predictors: preds.map(v => v.colId),
          varNames: Object.fromEntries(preds.map(v => [v.colId, v.name])),
          distribution: dist
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:genlin.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'genlin'}
      titleKey="analysis:genlin.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.generalizedLinear(a['dependent'] ?? [], a['predictors'] ?? [], dist)
      }
    />
  )
}
