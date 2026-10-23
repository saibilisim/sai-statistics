// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generalized Linear Mixed Models dialog — SPSS Mixed → Generalized Linear.
 * Package-gated on lme4: if not installed, shows the install prompt instead.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  OptionSection,
  SubDialogFooter,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { PackageNeededDialog } from '../../components/Dialogs/PackageNeededDialog'
import { usePackageGate } from '../../lib/use-package-gate'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

type Family = 'binomial' | 'poisson'

function FamilyContent({
  family,
  onChange,
  onClose
}: {
  family: Family
  onChange: (f: Family) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(family)

  return (
    <>
      <OptionSection title={t('analysis:glmm.family')} grid={false}>
        {(['binomial', 'poisson'] as Family[]).map(f => (
          <label key={f} className={shellStyles.checkRow}>
            <input
              type="radio"
              checked={local === f}
              onChange={() => {
                setLocal(f)
              }}
            />
            {t(`analysis:glmm.${f}`)}
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

export function GlmmDialog({ onClose }: { onClose: () => void }) {
  const { status, install } = usePackageGate('lme4')
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [family, setFamily] = useState<Family>('binomial')
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'dependent',
      labelKey: 'analysis:glmm.dependentField',
      single: true,
      filter: (v: Variable) => v.type === 'numeric'
    },
    {
      key: 'predictors',
      labelKey: 'analysis:glmm.predictorsField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    },
    { key: 'subject', labelKey: 'analysis:glmm.subjectField', single: true }
  ]

  const sideButtons: SideButtonDef[] = [
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:glmm.family',
      renderContent: ({ onClose: closeSub }) => (
        <FamilyContent family={family} onChange={setFamily} onClose={closeSub} />
      )
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['dependent'] ?? []).length === 1 &&
    (a['predictors'] ?? []).length > 0 &&
    (a['subject'] ?? []).length === 1 &&
    !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const dep = (a['dependent'] ?? [])[0]
    const subj = (a['subject'] ?? [])[0]
    const preds = a['predictors'] ?? []
    if (!dep || !subj) return
    await run(
      {
        analysisId: 'glmm',
        datasetId,
        scriptFile: 'glmm.R',
        params: {
          dependent: dep.colId,
          dependentName: dep.name,
          predictors: preds.map(v => v.colId),
          subject: subj.colId,
          family,
          varNames: Object.fromEntries(preds.map(v => [v.colId, v.name]))
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:glmm.title', assignments: a }
    )
  }

  if (status !== 'installed') {
    return (
      <PackageNeededDialog
        titleKey="analysis:glmm.title"
        pkg="lme4"
        featureKey="rpkg.feature.glmm"
        status={status}
        onInstall={() => void install()}
        onClose={onClose}
      />
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'glmm'}
      titleKey="analysis:glmm.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.glmm(a['dependent'] ?? [], a['predictors'] ?? [], a['subject'] ?? [], family)
      }
    />
  )
}
