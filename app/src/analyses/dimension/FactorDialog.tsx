// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Factor Analysis dialog — SPSS-style.
 * Analyze → Dimension Reduction → Factor
 *
 * Sub-dialogs as in SPSS: Descriptives, Extraction (method, matrix, number of
 * factors, scree plot), Rotation, Options (sorted / suppressed loadings) and
 * New Variables (regression factor scores). Beyond SPSS: polychoric matrix for
 * Likert items and Horn's parallel analysis.
 */

import { useId, useState } from 'react'
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
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { NewVariablesPanel, type NewVarSlot } from '../../components/Dialogs/NewVariablesPanel'
import { cleanNewVarSelection, type NewVarSelection } from '@/lib/new-var-names'
import { buildSyntax } from '../../lib/spss-syntax'
import { cx } from '../../lib/cx'
import {
  defaultFactorOptions,
  factorOptionParams,
  type FactorExtraction,
  type FactorOptions,
  type FactorRotation
} from './factor-options'

/* Regression-method factor scores, one column per retained factor. Three
   slots because three factors cover most uses of this dialog; a run that
   retains fewer simply produces fewer columns (factor.R only fills the slots
   that exist). Keys match requested_new_vars() in factor.R. */
const FACTOR_NEW_VARS: NewVarSlot[] = [
  { key: 'score1', labelKey: 'analysis:factor.newVar.score1', defaultName: 'fac1' },
  { key: 'score2', labelKey: 'analysis:factor.newVar.score2', defaultName: 'fac2' },
  { key: 'score3', labelKey: 'analysis:factor.newVar.score3', defaultName: 'fac3' }
]

const EXTRACTIONS: FactorExtraction[] = ['pc', 'paf', 'ml', 'uls', 'gls']
const ROTATIONS: FactorRotation[] = ['none', 'varimax', 'quartimax', 'equamax', 'oblimin', 'promax']
const ROTATION_LABEL: Record<FactorRotation, string> = {
  none: 'analysis:factor.rotationNone',
  varimax: 'analysis:factor.varimaxRotation',
  quartimax: 'analysis:factor.quartimax',
  equamax: 'analysis:factor.equamax',
  oblimin: 'analysis:factor.oblimin',
  promax: 'analysis:factor.promax'
}

interface SubProps {
  options: FactorOptions
  onChange: (o: FactorOptions) => void
  onClose: () => void
}

/** Local copy of the options while a sub-dialog is open; Continue commits it. */
function useLocalOptions(options: FactorOptions) {
  const [local, setLocal] = useState(options)
  const set = <K extends keyof FactorOptions>(key: K, val: FactorOptions[K]) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }
  return { local, set }
}

function Footer({ local, onChange, onClose }: SubProps & { local: FactorOptions }) {
  return (
    <SubDialogFooter
      onContinue={() => {
        onChange(local)
        onClose()
      }}
      onCancel={onClose}
    />
  )
}

function Radio<V extends string>(props: {
  name: string
  value: V
  current: V
  onSelect: (v: V) => void
  label: string
  children?: React.ReactNode
}) {
  return (
    <label className={shellStyles.checkRow}>
      <input
        type="radio"
        name={props.name}
        checked={props.current === props.value}
        onChange={() => {
          props.onSelect(props.value)
        }}
      />
      {props.label}
      {props.children}
    </label>
  )
}

// ─────────────────────────────────────────────────────────────
//  Descriptives sub-dialog
// ─────────────────────────────────────────────────────────────

function DescriptivesContent(props: SubProps) {
  const { t } = useTranslation(['common', 'analysis'])
  const { local, set } = useLocalOptions(props.options)
  const check = (key: 'univariate' | 'correlation' | 'kmoBartlett' | 'antiImage') => (
    <CheckOption
      checked={local[key]}
      onChange={v => {
        set(key, v)
      }}
    >
      {t(`analysis:factor.${key}`)}
    </CheckOption>
  )
  return (
    <>
      <OptionSection titleKey="analysis:factor.statisticsSection" grid={false}>
        {check('univariate')}
      </OptionSection>
      <OptionSection titleKey="analysis:factor.correlationSection" grid={false}>
        {check('correlation')}
        {check('kmoBartlett')}
        {check('antiImage')}
      </OptionSection>
      <Footer {...props} local={local} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
//  Extraction sub-dialog
// ─────────────────────────────────────────────────────────────

function ExtractionContent(props: SubProps) {
  const { t } = useTranslation(['common', 'analysis'])
  const id = useId()
  const { local, set } = useLocalOptions(props.options)
  const numInput = (key: 'minEigen' | 'nFactors' | 'maxIter', disabled: boolean, label: string) => (
    <input
      type="number"
      step={key === 'minEigen' ? 'any' : 1}
      min={key === 'minEigen' ? 0 : 1}
      value={local[key]}
      disabled={disabled}
      aria-label={label}
      onChange={e => {
        set(key, e.target.value)
      }}
      className="numField"
    />
  )
  return (
    <>
      <OptionSection titleKey="analysis:factor.methodSection" grid={false}>
        <label className={shellStyles.checkRow}>
          {t('analysis:factor.method')}
          <select
            value={local.extraction}
            onChange={e => {
              set('extraction', e.target.value as FactorExtraction)
            }}
            className="numField numField--select"
          >
            {EXTRACTIONS.map(m => (
              <option key={m} value={m}>
                {t(`analysis:factor.extract.${m}`)}
              </option>
            ))}
          </select>
        </label>
      </OptionSection>

      <OptionSection titleKey="analysis:factor.analyzeSection" grid={false}>
        <Radio
          name={`${id}-matrix`}
          value="correlation"
          current={local.matrix}
          onSelect={v => {
            set('matrix', v)
          }}
          label={t('analysis:factor.matrixCorrelation')}
        />
        <Radio
          name={`${id}-matrix`}
          value="polychoric"
          current={local.matrix}
          onSelect={v => {
            set('matrix', v)
          }}
          label={t('analysis:factor.matrixPolychoric')}
        />
      </OptionSection>

      <OptionSection titleKey="analysis:factor.extractSection" grid={false}>
        <Radio
          name={`${id}-crit`}
          value="eigen"
          current={local.criterion}
          onSelect={v => {
            set('criterion', v)
          }}
          label={t('analysis:factor.criterionEigen')}
        >
          {numInput('minEigen', local.criterion !== 'eigen', t('analysis:factor.criterionEigen'))}
        </Radio>
        <Radio
          name={`${id}-crit`}
          value="fixed"
          current={local.criterion}
          onSelect={v => {
            set('criterion', v)
          }}
          label={t('analysis:factor.criterionFixed')}
        >
          {numInput('nFactors', local.criterion !== 'fixed', t('analysis:factor.criterionFixed'))}
        </Radio>
        <Radio
          name={`${id}-crit`}
          value="parallel"
          current={local.criterion}
          onSelect={v => {
            set('criterion', v)
          }}
          label={t('analysis:factor.criterionParallel')}
        />
      </OptionSection>

      <OptionSection titleKey="analysis:factor.displaySection" grid={false}>
        <CheckOption
          checked={local.scree}
          onChange={v => {
            set('scree', v)
          }}
        >
          {t('analysis:factor.scree')}
        </CheckOption>
        <CheckOption
          checked={local.parallel || local.criterion === 'parallel'}
          disabled={local.criterion === 'parallel'}
          onChange={v => {
            set('parallel', v)
          }}
        >
          {t('analysis:factor.parallel')}
        </CheckOption>
      </OptionSection>

      <OptionSection grid={false}>
        <label className={shellStyles.checkRow}>
          {t('analysis:factor.maxIter')}
          {numInput('maxIter', local.extraction === 'pc', t('analysis:factor.maxIter'))}
        </label>
      </OptionSection>
      <Footer {...props} local={local} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
//  Rotation sub-dialog
// ─────────────────────────────────────────────────────────────

function RotationContent(props: SubProps) {
  const { t } = useTranslation(['common', 'analysis'])
  const id = useId()
  const { local, set } = useLocalOptions(props.options)
  return (
    <>
      <OptionSection titleKey="analysis:factor.rotationTitle">
        {ROTATIONS.map(r => (
          <Radio
            key={r}
            name={`${id}-rot`}
            value={r}
            current={local.rotation}
            onSelect={v => {
              set('rotation', v)
            }}
            label={t(ROTATION_LABEL[r] as never)}
          />
        ))}
      </OptionSection>
      <Footer {...props} local={local} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
//  Options sub-dialog (coefficient display format)
// ─────────────────────────────────────────────────────────────

function OptionsContent(props: SubProps) {
  const { t } = useTranslation(['common', 'analysis'])
  const { local, set } = useLocalOptions(props.options)
  return (
    <>
      <OptionSection titleKey="analysis:factor.formatSection" grid={false}>
        <CheckOption
          checked={local.sortBySize}
          onChange={v => {
            set('sortBySize', v)
          }}
        >
          {t('analysis:factor.sortBySize')}
        </CheckOption>
        <CheckOption
          checked={local.suppress}
          onChange={v => {
            set('suppress', v)
          }}
        >
          {t('analysis:factor.suppress')}
        </CheckOption>
        <label className={cx(shellStyles.checkRow, shellStyles.checkRowIndent)}>
          {t('analysis:factor.suppressBelow')}
          <input
            type="number"
            step="0.05"
            min="0"
            max="1"
            value={local.suppressBelow}
            disabled={!local.suppress}
            onChange={e => {
              set('suppressBelow', e.target.value)
            }}
            className="numField"
          />
        </label>
      </OptionSection>
      <Footer {...props} local={local} />
    </>
  )
}

export function FactorDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { running, run } = useRunAnalysis()
  const [options, setOptions] = useState<FactorOptions>(defaultFactorOptions)
  const [newVars, setNewVars] = useState<NewVarSelection>({})
  const existingNames = useDatasetStore(s => s.variables).map(v => v.name)

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:factor.variablesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const sub = (
    key: string,
    labelKey: string,
    titleKey: string,
    Content: (p: SubProps) => React.ReactNode
  ): SideButtonDef => ({
    key,
    labelKey,
    titleKey,
    renderContent: ({ onClose: closeSub }) => (
      <Content options={options} onChange={setOptions} onClose={closeSub} />
    )
  })
  const sideButtons: SideButtonDef[] = [
    sub(
      'descriptives',
      'analysis:shell.btnDescriptives',
      'analysis:factor.descriptivesTitle',
      DescriptivesContent
    ),
    sub(
      'extraction',
      'analysis:shell.btnExtraction',
      'analysis:factor.extractionTitle',
      ExtractionContent
    ),
    sub('rotation', 'analysis:shell.btnRotation', 'analysis:factor.rotationTitle', RotationContent),
    sub('options', 'analysis:shell.btnOptions', 'analysis:factor.optionsTitle', OptionsContent),
    {
      key: 'newVars',
      labelKey: 'analysis:shell.btnNewVars',
      titleKey: 'analysis:newVars.title',
      renderContent: ({ onClose: closeSub }) => (
        <NewVariablesPanel
          slots={FACTOR_NEW_VARS}
          value={newVars}
          onChange={setNewVars}
          existingNames={existingNames}
          onClose={closeSub}
        />
      )
    }
  ]

  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['variables'] ?? []).length >= 2 && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    await run(
      {
        analysisId: 'factor',
        datasetId,
        scriptFile: 'factor.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          options: factorOptionParams(options),
          createVars: cleanNewVarSelection(newVars, existingNames)
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:factor.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'factor'}
      titleKey="analysis:factor.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setOptions(defaultFactorOptions)
        setNewVars({})
      }}
      generateSyntax={a =>
        buildSyntax.factorAnalysis(a['variables'] ?? [], factorOptionParams(options))
      }
    />
  )
}
