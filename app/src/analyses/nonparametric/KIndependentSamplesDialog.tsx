// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K-Independent-Samples (Kruskal-Wallis H / Median / Jonckheere-Terpstra)
 * dialog — SPSS-style.
 * Analyze → Nonparametric Tests → K Independent Samples
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
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import {
  PMethodSection,
  buildPMethodParams,
  defaultPMethodOptions,
  type PMethodOptions
} from '../_shared/PMethodSection'
import { MissingValuesSection, type MissingStrategy } from '../_shared/MissingValuesSection'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

interface TestType {
  kruskalWallis: boolean
  median: boolean
  jonckheereTerpstra: boolean
}

interface NparKWStats {
  descriptives: boolean
  quartiles: boolean
}

// SPSS leaves these off; ours default ON, same reasoning as the sibling
// 2-Independent-Samples dialog (npar-mann-whitney.R's own comment): a rank
// test reported without "per-group summary" is not publishable, so the
// useful output should not sit behind a box nobody opens.
const DEFAULT_STATS: NparKWStats = { descriptives: true, quartiles: true }

// SPSS keeps the Statistics and Missing Values choices in one Options
// sub-dialog; the pairwise follow-up joins them so the main page carries only
// the variables and the test types.
interface NparKWOptions extends NparKWStats {
  pairwise: boolean
  missing: MissingStrategy
}

function OptionsContent({
  options,
  onChange,
  onClose
}: {
  options: NparKWOptions
  onChange: (s: NparKWOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(options)

  return (
    <>
      <OptionSection titleKey="analysis:nparKW.statisticsSection">
        <CheckOption
          checked={local.descriptives}
          onChange={v => {
            setLocal(o => ({ ...o, descriptives: v }))
          }}
        >
          {t('analysis:nparKW.descriptivesOption')}
        </CheckOption>
        <CheckOption
          checked={local.quartiles}
          onChange={v => {
            setLocal(o => ({ ...o, quartiles: v }))
          }}
        >
          {t('analysis:nparKW.quartilesOption')}
        </CheckOption>
        <CheckOption
          checked={local.pairwise}
          onChange={v => {
            setLocal(o => ({ ...o, pairwise: v }))
          }}
        >
          {t('analysis:nparKW.pairwiseOption')}
        </CheckOption>
      </OptionSection>
      <MissingValuesSection
        value={local.missing}
        onChange={v => {
          setLocal(o => ({ ...o, missing: v }))
        }}
      />
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

export function KIndependentSamplesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [testType, setTestType] = useState<TestType>({
    kruskalWallis: true,
    median: false,
    jonckheereTerpstra: false
  })
  const [options, setOptions] = useState<NparKWOptions>({
    ...DEFAULT_STATS,
    pairwise: false,
    missing: 'analysis'
  })
  const { pairwise, missing, ...stats } = options
  const [pMethod, setPMethod] = useState<PMethodOptions>(defaultPMethodOptions)
  const { running, run } = useRunAnalysis()

  // Science-over-SPSS (CLAUDE.md §11): optional Monte Carlo / exact p via the
  // coin package (base R has no exact path for Kruskal-Wallis).
  const sideButtons: SideButtonDef[] = [
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:nparKW.optionsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <OptionsContent options={options} onChange={setOptions} onClose={closeSub} />
      )
    },
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
      labelKey: 'analysis:nparKW.testField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    },
    { key: 'factor', labelKey: 'analysis:nparKW.factorField', single: true }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length > 0 &&
    (a['factor'] ?? []).length === 1 &&
    (testType.kruskalWallis || testType.median || testType.jonckheereTerpstra) &&
    !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    const f = (a['factor'] ?? [])[0]
    if (!f) return
    await run(
      {
        analysisId: 'nparKW',
        datasetId,
        scriptFile: 'npar-kruskal-wallis.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          factor: f.colId,
          factorName: f.name,
          factorValueLabels: f.valueLabels,
          options: {
            testType,
            pairwise,
            missing,
            ...stats,
            ...(buildPMethodParams(pMethod) ? { pMethod: buildPMethodParams(pMethod) } : {})
          }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:nparKW.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'nparKW'}
      titleKey="analysis:nparKW.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        // The "pairwise comparisons" checkbox has no NPAR TESTS keyword — see
        // buildSyntax's NPAR note.
        buildSyntax.nparKruskalWallis(
          a['variables'] ?? [],
          a['factor'] ?? [],
          missing,
          buildPMethodParams(pMethod),
          undefined,
          testType,
          stats
        )
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <div className={shellStyles.optionSectionTitle}>{t('analysis:nparKW.testTypeTitle')}</div>
          <div className={shellStyles.optionGrid}>
            <CheckOption
              checked={testType.kruskalWallis}
              onChange={v => {
                setTestType(o => ({ ...o, kruskalWallis: v }))
              }}
            >
              {t('analysis:nparKW.kruskalWallisOption')}
            </CheckOption>
            <CheckOption
              checked={testType.median}
              onChange={v => {
                setTestType(o => ({ ...o, median: v }))
              }}
            >
              {t('analysis:nparKW.medianOption')}
            </CheckOption>
            <CheckOption
              checked={testType.jonckheereTerpstra}
              onChange={v => {
                setTestType(o => ({ ...o, jonckheereTerpstra: v }))
              }}
            >
              {t('analysis:nparKW.jonckheereTerpstraOption')}
            </CheckOption>
          </div>
        </div>
      }
    />
  )
}
