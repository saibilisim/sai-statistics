// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two-Related-Samples (Wilcoxon Signed-Rank) dialog — SPSS-style.
 * Analyze → Nonparametric Tests → 2 Related Samples
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  CheckOption,
  OptionSection,
  SubDialogFooter,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { MissingValuesSection, type MissingStrategy } from '../_shared/MissingValuesSection'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

// The Options sub-dialog: continuity correction (this test's only statistical
// toggle) plus the standard Missing Values choice. Defaults to ON — matches
// both SPSS's own asymptotic Z and R's own wilcox.test(correct=TRUE) default
// (CLAUDE.md §11 "R'ın varsayılanını kullan").
function OptionsContent({
  continuityCorrection,
  missing,
  onChange,
  onClose
}: {
  continuityCorrection: boolean
  missing: MissingStrategy
  onChange: (opts: { continuityCorrection: boolean; missing: MissingStrategy }) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [localCC, setLocalCC] = useState(continuityCorrection)
  const [localMissing, setLocalMissing] = useState(missing)

  return (
    <>
      <OptionSection>
        <CheckOption checked={localCC} onChange={setLocalCC}>
          {t('analysis:nparWilcoxon.continuityCorrectionOption')}
        </CheckOption>
      </OptionSection>
      <MissingValuesSection value={localMissing} onChange={setLocalMissing} />

      <SubDialogFooter
        onContinue={() => {
          onChange({ continuityCorrection: localCC, missing: localMissing })
          onClose()
        }}
        onCancel={onClose}
      />
    </>
  )
}

export function TwoRelatedSamplesDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [missing, setMissing] = useState<MissingStrategy>('analysis')
  const [continuityCorrection, setContinuityCorrection] = useState(false)

  const sideButtons: SideButtonDef[] = [
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:nparWilcoxon.optionsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <OptionsContent
          continuityCorrection={continuityCorrection}
          missing={missing}
          onChange={opts => {
            setContinuityCorrection(opts.continuityCorrection)
            setMissing(opts.missing)
          }}
          onClose={closeSub}
        />
      )
    }
  ]
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'var1',
      labelKey: 'analysis:nparWilcoxon.var1Field',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    },
    {
      key: 'var2',
      labelKey: 'analysis:nparWilcoxon.var2Field',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) => {
    const n1 = (a['var1'] ?? []).length
    const n2 = (a['var2'] ?? []).length
    return n1 > 0 && n1 === n2 && !running
  }

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const v1 = a['var1'] ?? []
    const v2 = a['var2'] ?? []
    await run(
      {
        analysisId: 'nparWilcoxon',
        datasetId,
        scriptFile: 'npar-wilcoxon.R',
        params: {
          var1: v1.map(v => v.colId),
          var2: v2.map(v => v.colId),
          varNames: Object.fromEntries([...v1, ...v2].map(v => [v.colId, v.name])),
          options: { missing, continuityCorrection }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:nparWilcoxon.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'nparWilcoxon'}
      titleKey="analysis:nparWilcoxon.title"
      fieldDefs={fieldDefs}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a => buildSyntax.nparWilcoxon(a['var1'] ?? [], a['var2'] ?? [], missing)}
      sideButtons={sideButtons}
    />
  )
}
