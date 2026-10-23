// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two-Independent-Samples (Mann-Whitney U) dialog — SPSS-style.
 * Analyze → Nonparametric Tests → 2 Independent Samples
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
import { MissingValuesSection, type MissingStrategy } from '../_shared/MissingValuesSection'
import {
  PMethodSection,
  buildPMethodParams,
  defaultPMethodOptions,
  type PMethodOptions
} from '../_shared/PMethodSection'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

/** The optional output blocks, behind the "Statistics" side button (SPSS's
 *  own 2-Independent-Samples Options button holds the same two first). */
interface NparMWStats {
  descriptives: boolean
  quartiles: boolean
  effectSize: boolean
  boxplot: boolean
  continuityCorrection: boolean
}

// SPSS leaves all of these off and then prints a pooled summary that ignores
// the grouping variable. Ours are per-group and default ON: a rank test
// reported without "Median (IQR) per group" and without an effect size is not
// publishable, so the useful output should not sit behind a box nobody opens.
// continuityCorrection defaults OFF: SPSS's asymptotic Z has no continuity term
// (confirmed by tests/spss-parity); the ±0.5 correction is opt-in.
const DEFAULT_STATS: NparMWStats = {
  descriptives: true,
  quartiles: true,
  effectSize: true,
  boxplot: true,
  continuityCorrection: false
}

// ─────────────────────────────────────────────────────────────
//  Options sub-dialog — SPSS keeps Statistics and Missing Values together
// ─────────────────────────────────────────────────────────────

interface NparMWOptions extends NparMWStats {
  missing: MissingStrategy
}

function OptionsContent({
  options,
  onChange,
  onClose
}: {
  options: NparMWOptions
  onChange: (s: NparMWOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(options)
  const set = (key: keyof NparMWStats, val: boolean) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }

  return (
    <>
      <OptionSection titleKey="analysis:nparMW.statisticsSection">
        <CheckOption
          checked={local.descriptives}
          onChange={v => {
            set('descriptives', v)
          }}
        >
          {t('analysis:nparMW.descriptivesOption')}
        </CheckOption>
        <CheckOption
          checked={local.quartiles}
          onChange={v => {
            set('quartiles', v)
          }}
        >
          {t('analysis:nparMW.quartilesOption')}
        </CheckOption>
        <CheckOption
          checked={local.effectSize}
          onChange={v => {
            set('effectSize', v)
          }}
        >
          {t('analysis:nparMW.effectSizeOption')}
        </CheckOption>
        <CheckOption
          checked={local.boxplot}
          onChange={v => {
            set('boxplot', v)
          }}
        >
          {t('analysis:nparMW.boxplotOption')}
        </CheckOption>
        <CheckOption
          checked={local.continuityCorrection}
          onChange={v => {
            set('continuityCorrection', v)
          }}
        >
          {t('analysis:nparMW.continuityCorrectionOption')}
        </CheckOption>
      </OptionSection>
      <MissingValuesSection
        value={local.missing}
        onChange={v => {
          setLocal(prev => ({ ...prev, missing: v }))
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

// ─────────────────────────────────────────────────────────────
//  Main dialog
// ─────────────────────────────────────────────────────────────

export function TwoIndependentSamplesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const [group1, setGroup1] = useState('')
  const [group2, setGroup2] = useState('')
  const [options, setOptions] = useState<NparMWOptions>({ ...DEFAULT_STATS, missing: 'analysis' })
  const { missing, ...stats } = options
  const [pMethod, setPMethod] = useState<PMethodOptions>(defaultPMethodOptions)
  const { running, run } = useRunAnalysis()

  const sideButtons: SideButtonDef[] = [
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:nparMW.optionsTitle',
      renderContent: ({ onClose: closeSub }) => (
        <OptionsContent options={options} onChange={setOptions} onClose={closeSub} />
      )
    },
    // Science-over-SPSS (CLAUDE.md §11): base R's wilcox.test(exact=TRUE)
    // already covers the common case automatically (see npar-mann-whitney.R);
    // this button's Monte Carlo / exact-via-`coin` path is what fills in the
    // cases that leaves blank — larger samples or tied data.
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
      labelKey: 'analysis:nparMW.testField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    },
    { key: 'group', labelKey: 'analysis:nparMW.groupField', single: true }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length > 0 &&
    (a['group'] ?? []).length === 1 &&
    group1.trim() !== '' &&
    group2.trim() !== '' &&
    group1.trim() !== group2.trim() &&
    !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    const g = (a['group'] ?? [])[0]
    if (!g) return
    await run(
      {
        analysisId: 'nparMW',
        datasetId,
        scriptFile: 'npar-mann-whitney.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          groupVar: g.colId,
          groupName: g.name,
          groupValueLabels: g.valueLabels,
          group1: group1.trim(),
          group2: group2.trim(),
          options: {
            missing,
            ...stats,
            ...(buildPMethodParams(pMethod) ? { pMethod: buildPMethodParams(pMethod) } : {})
          }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:nparMW.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'nparMW'}
      titleKey="analysis:nparMW.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        // Effect size / box plot have no NPAR TESTS keyword (SPSS has neither),
        // so Paste can only carry the two /STATISTICS keywords — same
        // limitation as the K-Independent dialog's pairwise checkbox.
        buildSyntax.nparMannWhitney(
          a['variables'] ?? [],
          a['group'] ?? [],
          group1.trim(),
          group2.trim(),
          missing,
          buildPMethodParams(pMethod),
          { descriptives: stats.descriptives, quartiles: stats.quartiles }
        )
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <div className={shellStyles.optionSectionTitle}>{t('analysis:nparMW.defineGroups')}</div>
          <div className={shellStyles.optionGrid}>
            <label className={shellStyles.checkRow}>
              {t('analysis:nparMW.group1')}
              <input
                type="text"
                value={group1}
                onChange={e => {
                  setGroup1(e.target.value)
                }}
                className="numField"
              />
            </label>
            <label className={shellStyles.checkRow}>
              {t('analysis:nparMW.group2')}
              <input
                type="text"
                value={group2}
                onChange={e => {
                  setGroup2(e.target.value)
                }}
                className="numField"
              />
            </label>
          </div>
        </div>
      }
    />
  )
}
