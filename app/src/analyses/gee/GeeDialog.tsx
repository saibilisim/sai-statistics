// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generalized Estimating Equations dialog — SPSS GEE.
 * Analyze → Generalized Estimating Equations
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

type Family = 'gaussian' | 'poisson' | 'binomial'
type Corstr = 'independence' | 'exchangeable' | 'ar1'

function DistributionContent({
  family,
  corstr,
  onFamilyChange,
  onCorstrChange,
  onClose
}: {
  family: Family
  corstr: Corstr
  onFamilyChange: (f: Family) => void
  onCorstrChange: (c: Corstr) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [localFamily, setLocalFamily] = useState(family)
  const [localCorstr, setLocalCorstr] = useState(corstr)

  return (
    <>
      <OptionSection title={t('analysis:gee.family')} grid={false}>
        {(['gaussian', 'poisson', 'binomial'] as Family[]).map(f => (
          <label key={f} className={shellStyles.checkRow}>
            <input
              type="radio"
              checked={localFamily === f}
              onChange={() => {
                setLocalFamily(f)
              }}
            />
            {t(`analysis:gee.${f}`)}
          </label>
        ))}
      </OptionSection>
      <OptionSection title={t('analysis:gee.corstr')} grid={false}>
        {(['independence', 'exchangeable', 'ar1'] as Corstr[]).map(c => (
          <label key={c} className={shellStyles.checkRow}>
            <input
              type="radio"
              checked={localCorstr === c}
              onChange={() => {
                setLocalCorstr(c)
              }}
            />
            {t(`analysis:gee.${c}`)}
          </label>
        ))}
      </OptionSection>

      <SubDialogFooter
        onContinue={() => {
          onFamilyChange(localFamily)
          onCorstrChange(localCorstr)
          onClose()
        }}
        onCancel={onClose}
      />
    </>
  )
}

export function GeeDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [family, setFamily] = useState<Family>('gaussian')
  const [corstr, setCorstr] = useState<Corstr>('exchangeable')
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'dependent',
      labelKey: 'analysis:gee.dependentField',
      single: true,
      filter: (v: Variable) => v.type === 'numeric'
    },
    {
      key: 'predictors',
      labelKey: 'analysis:gee.predictorsField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    },
    {
      key: 'subject',
      labelKey: 'analysis:gee.subjectField',
      single: true
    }
  ]

  const sideButtons: SideButtonDef[] = [
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:gee.family',
      renderContent: ({ onClose: closeSub }) => (
        <DistributionContent
          family={family}
          corstr={corstr}
          onFamilyChange={setFamily}
          onCorstrChange={setCorstr}
          onClose={closeSub}
        />
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
        analysisId: 'gee',
        datasetId,
        scriptFile: 'gee.R',
        params: {
          dependent: dep.colId,
          dependentName: dep.name,
          predictors: preds.map(v => v.colId),
          subject: subj.colId,
          family,
          corstr,
          varNames: Object.fromEntries(preds.map(v => [v.colId, v.name]))
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:gee.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'gee'}
      titleKey="analysis:gee.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.gee(
          a['dependent'] ?? [],
          a['predictors'] ?? [],
          a['subject'] ?? [],
          family,
          corstr
        )
      }
    />
  )
}
