// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Compare Means and Proportions — One-/Independent-/Paired-Sample
 * Proportions (SPSS 27+). Mirrors SPSS: Analyze → Compare Means →
 * One-/Independent-/Paired-Samples Proportions.
 */

import { useState } from 'react'
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
import { useTranslation } from 'react-i18next'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

export type ProportionsDesign = 'one' | 'independent' | 'paired'

/** The SPSS 27+ interval and test types per design — the keys proportions.R
 *  switches on (output.proportions.ci.<key> / .test.<key>). */
const CI_METHODS: Record<ProportionsDesign, string[]> = {
  one: [
    'agrestiCoull',
    'anscombe',
    'clopperPearson',
    'jeffreys',
    'logit',
    'wald',
    'waldCC',
    'wilson',
    'wilsonCC'
  ],
  independent: [
    'agrestiCaffo',
    'brownLi',
    'hauckAnderson',
    'newcombe',
    'newcombeCC',
    'wald',
    'waldCC'
  ],
  paired: ['agrestiMin', 'bonettPrice', 'newcombe', 'wald', 'waldCC']
}
const TEST_METHODS: Record<ProportionsDesign, string[]> = {
  one: ['exact', 'midP', 'score', 'scoreCC', 'wald', 'waldCC'],
  independent: ['hauckAnderson', 'wald', 'waldCC', 'waldH0', 'waldH0CC'],
  paired: ['exact', 'midP', 'mcnemar', 'mcnemarCC', 'wald', 'waldCC']
}

function MethodsContent({
  design,
  kind,
  selected,
  extra,
  onChange,
  onClose
}: {
  design: ProportionsDesign
  kind: 'ci' | 'test'
  selected: string[]
  extra: { label: string; value: string; min: number; max: number }
  onChange: (sel: string[], extraValue: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(selected)
  const [extraValue, setExtraValue] = useState(extra.value)
  const methods = (kind === 'ci' ? CI_METHODS : TEST_METHODS)[design]
  return (
    <>
      <OptionSection
        titleKey={kind === 'ci' ? 'analysis:proportions.ciTypes' : 'analysis:proportions.testTypes'}
      >
        {methods.map(m => (
          <CheckOption
            key={m}
            checked={local.includes(m)}
            onChange={on => {
              setLocal(prev => (on ? [...prev, m] : prev.filter(x => x !== m)))
            }}
          >
            {t(`analysis:output.proportions.${kind}.${m}`, { defaultValue: m })}
          </CheckOption>
        ))}
      </OptionSection>
      {extra.label && (
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {extra.label}
            <input
              type="number"
              step="any"
              min={extra.min}
              max={extra.max}
              value={extraValue}
              onChange={e => {
                setExtraValue(e.target.value)
              }}
              className="numField"
            />
          </label>
        </div>
      )}
      <SubDialogFooter
        onContinue={() => {
          onChange(
            methods.filter(m => local.includes(m)),
            extraValue
          )
          onClose()
        }}
        onCancel={onClose}
      />
    </>
  )
}

interface Props {
  design: ProportionsDesign
  onClose: () => void
}

export function ProportionsDialog({ design, onClose }: Props) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)

  const [successValue, setSuccessValue] = useState('1')
  const [testValue, setTestValue] = useState('0.5')
  const [ciLevel, setCiLevel] = useState('95')
  const [ciMethods, setCiMethods] = useState<string[]>([])
  const [testMethods, setTestMethods] = useState<string[]>([])
  const { running, run } = useRunAnalysis()

  const titleKey =
    design === 'one'
      ? 'analysis:proportions.oneTitle'
      : design === 'independent'
        ? 'analysis:proportions.indepTitle'
        : 'analysis:proportions.pairedTitle'

  const analysisId =
    design === 'one'
      ? 'proportionsOne'
      : design === 'independent'
        ? 'proportionsIndep'
        : 'proportionsPaired'

  const fieldDefs =
    design === 'one'
      ? [{ key: 'variable', labelKey: 'analysis:proportions.variableField', single: true }]
      : design === 'independent'
        ? [
            { key: 'variable', labelKey: 'analysis:proportions.variableField', single: true },
            { key: 'groupVar', labelKey: 'analysis:proportions.groupField', single: true }
          ]
        : [
            { key: 'variable1', labelKey: 'analysis:proportions.variable1Field', single: true },
            { key: 'variable2', labelKey: 'analysis:proportions.variable2Field', single: true }
          ]

  const canSubmit = (a: Record<string, Variable[]>) => {
    if (running || successValue.trim() === '' || ciLevel.trim() === '') return false
    if (design === 'one') return (a['variable'] ?? []).length === 1 && testValue.trim() !== ''
    if (design === 'independent') {
      return (a['variable'] ?? []).length === 1 && (a['groupVar'] ?? []).length === 1
    }
    return (a['variable1'] ?? []).length === 1 && (a['variable2'] ?? []).length === 1
  }

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const common = {
      successValue: successValue.trim(),
      ciLevel: Number(ciLevel) || 95,
      ...(ciMethods.length ? { ciMethods } : {}),
      ...(testMethods.length ? { testMethods } : {})
    }
    const designParams =
      design === 'one'
        ? {
            variable: a['variable']?.[0]?.colId,
            varName: a['variable']?.[0]?.name,
            testValue: Number(testValue) || 0.5
          }
        : design === 'independent'
          ? {
              variable: a['variable']?.[0]?.colId,
              varName: a['variable']?.[0]?.name,
              groupVar: a['groupVar']?.[0]?.colId,
              groupVarName: a['groupVar']?.[0]?.name,
              groupValueLabels: a['groupVar']?.[0]?.valueLabels
            }
          : {
              variable1: a['variable1']?.[0]?.colId,
              varName1: a['variable1']?.[0]?.name,
              variable2: a['variable2']?.[0]?.colId,
              varName2: a['variable2']?.[0]?.name
            }

    await run(
      {
        analysisId,
        datasetId,
        scriptFile: 'proportions.R',
        params: { design, ...common, ...designParams },
        columnFilters
      },
      onClose,
      { titleKey, assignments: a }
    )
  }

  // SPSS keeps the confidence level in Confidence Intervals and the test
  // value in Tests; the success value (OK is gated on it) stays on the page.
  const sideButtons: SideButtonDef[] = [
    {
      key: 'ci',
      labelKey: 'analysis:proportions.btnCi',
      titleKey: 'analysis:proportions.ciTitleDlg',
      renderContent: ({ onClose: closeSub }) => (
        <MethodsContent
          design={design}
          kind="ci"
          selected={ciMethods}
          extra={{
            label: t('analysis:proportions.ciLevelLabel'),
            value: ciLevel,
            min: 50.1,
            max: 99.9
          }}
          onChange={(sel, v) => {
            setCiMethods(sel)
            setCiLevel(v)
          }}
          onClose={closeSub}
        />
      )
    },
    {
      key: 'tests',
      labelKey: 'analysis:proportions.btnTests',
      titleKey: 'analysis:proportions.testsTitleDlg',
      renderContent: ({ onClose: closeSub }) => (
        <MethodsContent
          design={design}
          kind="test"
          selected={testMethods}
          extra={
            design === 'one'
              ? { label: t('analysis:proportions.testValue'), value: testValue, min: 0, max: 1 }
              : { label: '', value: '', min: 0, max: 1 }
          }
          onChange={(sel, v) => {
            setTestMethods(sel)
            if (design === 'one') setTestValue(v)
          }}
          onClose={closeSub}
        />
      )
    }
  ]

  return (
    <AnalysisDialogShell
      analysisId={analysisId}
      titleKey={titleKey}
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.proportions(
          design,
          design === 'paired' ? (a['variable1'] ?? []) : (a['variable'] ?? []),
          design === 'paired' ? (a['variable2'] ?? []) : (a['groupVar'] ?? []),
          {
            successValue: successValue.trim(),
            ciLevel: Number(ciLevel) || 95,
            testValue: Number(testValue) || 0.5
          }
        )
      }
      extraContent={
        <div className={shellStyles.optionSection}>
          <label className={shellStyles.checkRow}>
            {t('analysis:proportions.successValue')}
            <input
              value={successValue}
              onChange={e => {
                setSuccessValue(e.target.value)
              }}
              className="numField"
            />
          </label>
        </div>
      }
    />
  )
}
