// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Confirmatory Factor Analysis dialog.
 * Analyze → Dimension Reduction → Confirmatory Factor Analysis
 *
 * The model is built without writing syntax: each factor is a target box the
 * items are transferred into; factors can be added, renamed and removed, and
 * "Import from EFA" fills the boxes from the newest Factor Analysis result
 * (every item under the factor it loads highest on). An optional grouping
 * variable adds the measurement invariance sequence. cfa.R fits the model with
 * lavaan.
 */

import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  CheckOption,
  OptionSection,
  SubDialogFooter,
  type FieldDef,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import { useOutputStore } from '../../store/output-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { cx } from '../../lib/cx'
import {
  cfaOptionParams,
  defaultCfaOptions,
  efaToCfaAssignment,
  type CfaEstimator,
  type CfaFactor,
  type CfaOptions
} from './cfa-options'

const ESTIMATORS: CfaEstimator[] = ['auto', 'ml', 'mlr', 'wlsmv']
const GROUP_FIELD = 'group'

interface SubProps {
  options: CfaOptions
  onChange: (o: CfaOptions) => void
  onClose: () => void
}

function useLocalOptions(options: CfaOptions) {
  const [local, setLocal] = useState(options)
  const set = <K extends keyof CfaOptions>(key: K, val: CfaOptions[K]) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }
  return { local, set }
}

function Footer({ local, onChange, onClose }: SubProps & { local: CfaOptions }) {
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
    </label>
  )
}

// ─────────────────────────────────────────────────────────────
//  Model sub-dialog: identification, factor covariances, error covariances
// ─────────────────────────────────────────────────────────────

function ModelContent(props: SubProps & { items: Variable[] }) {
  const { t } = useTranslation(['common', 'analysis'])
  const id = useId()
  const { local, set } = useLocalOptions(props.options)
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const nameOf = (colId: string) => props.items.find(v => v.colId === colId)?.name ?? colId
  const pairs = local.errorCov.filter(([x, y]) =>
    [x, y].every(c => props.items.some(v => v.colId === c))
  )
  const exists = pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
  const itemSelect = (value: string, onSet: (v: string) => void, label: string) => (
    <select
      className={shellStyles.input}
      value={value}
      aria-label={label}
      onChange={e => {
        onSet(e.target.value)
      }}
    >
      <option value="">—</option>
      {props.items.map(v => (
        <option key={v.colId} value={v.colId}>
          {v.name}
        </option>
      ))}
    </select>
  )
  return (
    <>
      <OptionSection titleKey="analysis:cfa.identSection" grid={false}>
        <Radio
          name={`${id}-ident`}
          value="marker"
          current={local.identification}
          onSelect={v => {
            set('identification', v)
          }}
          label={t('analysis:cfa.identMarker')}
        />
        <Radio
          name={`${id}-ident`}
          value="std"
          current={local.identification}
          onSelect={v => {
            set('identification', v)
          }}
          label={t('analysis:cfa.identStd')}
        />
      </OptionSection>
      <OptionSection grid={false}>
        <CheckOption
          checked={local.correlated}
          onChange={v => {
            set('correlated', v)
          }}
        >
          {t('analysis:cfa.correlated')}
        </CheckOption>
      </OptionSection>
      <OptionSection titleKey="analysis:cfa.errorCovSection" grid={false}>
        <div className={shellStyles.optionHint}>{t('analysis:cfa.errorCovHint')}</div>
        <div className={shellStyles.newVarRow}>
          {itemSelect(a, setA, t('analysis:cfa.errorCovFirst'))}
          <span aria-hidden="true">↔</span>
          {itemSelect(b, setB, t('analysis:cfa.errorCovSecond'))}
          <button
            type="button"
            className={shellStyles.btn}
            disabled={!a || !b || a === b || exists}
            onClick={() => {
              set('errorCov', [...pairs, [a, b]])
              setA('')
              setB('')
            }}
          >
            {t('analysis:cfa.addPair')}
          </button>
        </div>
        {pairs.map(([x, y], i) => (
          <div key={`${x}-${y}`} className={shellStyles.newVarRow}>
            <span className={shellStyles.checkRow}>
              {nameOf(x)} ↔ {nameOf(y)}
            </span>
            <button
              type="button"
              className={shellStyles.btn}
              aria-label={`${t('analysis:cfa.removePair')}: ${nameOf(x)} ↔ ${nameOf(y)}`}
              onClick={() => {
                set(
                  'errorCov',
                  pairs.filter((_, j) => j !== i)
                )
              }}
            >
              {t('analysis:cfa.removePair')}
            </button>
          </div>
        ))}
      </OptionSection>
      <Footer {...props} local={local} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
//  Estimation sub-dialog
// ─────────────────────────────────────────────────────────────

function EstimationContent(props: SubProps) {
  const { t } = useTranslation(['common', 'analysis'])
  const id = useId()
  const { local, set } = useLocalOptions(props.options)
  return (
    <>
      <OptionSection titleKey="analysis:cfa.estimatorSection" grid={false}>
        {ESTIMATORS.map(e => (
          <Radio
            key={e}
            name={`${id}-est`}
            value={e}
            current={local.estimator}
            onSelect={v => {
              set('estimator', v)
            }}
            label={t(`analysis:cfa.estimator_${e}`)}
          />
        ))}
      </OptionSection>
      <OptionSection titleKey="analysis:cfa.missingSection" grid={false}>
        <Radio
          name={`${id}-miss`}
          value="listwise"
          current={local.missingMethod}
          onSelect={v => {
            set('missingMethod', v)
          }}
          label={t('analysis:cfa.missingListwise')}
        />
        <Radio
          name={`${id}-miss`}
          value="fiml"
          current={local.missingMethod}
          onSelect={v => {
            set('missingMethod', v)
          }}
          label={t('analysis:cfa.missingFiml')}
        />
      </OptionSection>
      <Footer {...props} local={local} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
//  Output sub-dialog
// ─────────────────────────────────────────────────────────────

function OutputContent(props: SubProps) {
  const { t } = useTranslation(['common', 'analysis'])
  const { local, set } = useLocalOptions(props.options)
  const check = (key: 'reliability' | 'fornell' | 'htmt' | 'mi' | 'diagram' | 'invariance') => (
    <CheckOption
      checked={local[key]}
      onChange={v => {
        set(key, v)
      }}
    >
      {t(`analysis:cfa.out_${key}`)}
    </CheckOption>
  )
  return (
    <>
      <OptionSection titleKey="analysis:cfa.validitySection" grid={false}>
        {check('reliability')}
        {check('fornell')}
        {check('htmt')}
      </OptionSection>
      <OptionSection titleKey="analysis:cfa.modelSection" grid={false}>
        {check('mi')}
        <label className={cx(shellStyles.checkRow, shellStyles.checkRowIndent)}>
          {t('analysis:cfa.miMin')}
          <input
            type="number"
            step="0.5"
            min="0"
            value={local.miMin}
            disabled={!local.mi}
            onChange={e => {
              set('miMin', e.target.value)
            }}
            className="numField"
          />
        </label>
        {check('diagram')}
        {check('invariance')}
      </OptionSection>
      <Footer {...props} local={local} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
//  Dialog
// ─────────────────────────────────────────────────────────────

let factorSeq = 0
const newFactor = (name: string): CfaFactor => {
  factorSeq += 1
  return { id: `f${String(factorSeq)}`, name }
}

export function CfaDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const variables = useDatasetStore(s => s.variables)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const blocks = useOutputStore(s => s.blocks)
  const { running, run } = useRunAnalysis()
  const factorName = (i: number) => t('analysis:cfa.defaultFactorName', { n: i })
  const [factors, setFactors] = useState<CfaFactor[]>(() => [
    newFactor(factorName(1)),
    newFactor(factorName(2))
  ])
  const [options, setOptions] = useState<CfaOptions>(defaultCfaOptions)
  // Import from EFA remounts the shell with these assignments (see shell's
  // initialAssignments); the key change is what makes it re-read them.
  const [shellKey, setShellKey] = useState(0)
  const [initial, setInitial] = useState<Record<string, string[]> | undefined>(undefined)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const efa = efaToCfaAssignment(blocks, variables)

  const fieldDefs: FieldDef[] = [
    ...factors.map(f => ({
      key: f.id,
      labelKey: 'analysis:cfa.factorField',
      label: f.name.trim() || t('analysis:cfa.factorField'),
      filter: (v: Variable) => v.type === 'numeric'
    })),
    { key: GROUP_FIELD, labelKey: 'analysis:cfa.groupField', single: true }
  ]

  const itemsOf = (a: Record<string, Variable[]>) => {
    const seen = new Map<string, Variable>()
    for (const f of factors) for (const v of a[f.id] ?? []) seen.set(v.colId, v)
    return [...seen.values()]
  }
  const filled = (a: Record<string, Variable[]>) => factors.filter(f => (a[f.id] ?? []).length > 0)
  const namesUnique = () => {
    const names = factors.map(f => f.name.trim())
    return names.every(n => n !== '') && new Set(names).size === names.length
  }
  const canSubmit = (a: Record<string, Variable[]>) =>
    filled(a).length >= 1 && itemsOf(a).length >= 3 && namesUnique() && !running

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const items = itemsOf(a)
    const group = (a[GROUP_FIELD] ?? [])[0]
    await run(
      {
        analysisId: 'cfa',
        datasetId,
        scriptFile: 'cfa.R',
        params: {
          variables: items.map(v => v.colId),
          varNames: Object.fromEntries(items.map(v => [v.colId, v.name])),
          factors: filled(a).map(f => ({
            name: f.name.trim(),
            items: (a[f.id] ?? []).map(v => v.colId)
          })),
          ordinalItems: items.filter(v => v.measure === 'ordinal').map(v => v.colId),
          ...(group ? { groupVar: group.colId, groupName: group.name } : {}),
          options: cfaOptionParams(
            options,
            items.map(v => v.colId)
          )
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:cfa.title', assignments: a }
    )
  }

  const importFromEfa = () => {
    if (!efa) return
    const fs = efa.assignment.map((_, i) => newFactor(factorName(i + 1)))
    setFactors(fs)
    setInitial(Object.fromEntries(fs.map((f, i) => [f.id, efa.assignment[i] ?? []])))
    setShellKey(k => k + 1)
    setImportMsg(t('analysis:cfa.importDone', { n: fs.length }))
  }

  const sideButtons: SideButtonDef[] = [
    {
      key: 'model',
      labelKey: 'analysis:cfa.btnModel',
      titleKey: 'analysis:cfa.modelTitle',
      renderContent: ({ onClose: closeSub, assignments }) => (
        <ModelContent
          options={options}
          onChange={setOptions}
          onClose={closeSub}
          items={itemsOf(assignments)}
        />
      )
    },
    {
      key: 'estimation',
      labelKey: 'analysis:cfa.btnEstimation',
      titleKey: 'analysis:cfa.estimationTitle',
      renderContent: ({ onClose: closeSub }) => (
        <EstimationContent options={options} onChange={setOptions} onClose={closeSub} />
      )
    },
    {
      key: 'output',
      labelKey: 'analysis:cfa.btnOutput',
      titleKey: 'analysis:cfa.outputTitle',
      renderContent: ({ onClose: closeSub }) => (
        <OutputContent options={options} onChange={setOptions} onClose={closeSub} />
      )
    }
  ]

  const factorPanel = (
    <OptionSection titleKey="analysis:cfa.factorsSection" grid={false}>
      {factors.map((f, i) => (
        <div key={f.id} className={shellStyles.newVarRow}>
          <label className={shellStyles.checkRow}>
            {t('analysis:cfa.factorNameLabel', { n: i + 1 })}
            <input
              className={shellStyles.input}
              value={f.name}
              maxLength={40}
              onChange={e => {
                const name = e.target.value
                setFactors(prev => prev.map(x => (x.id === f.id ? { ...x, name } : x)))
              }}
            />
          </label>
          <button
            type="button"
            className={shellStyles.btn}
            disabled={factors.length <= 1}
            aria-label={`${t('analysis:cfa.removeFactor')}: ${f.name}`}
            onClick={() => {
              setFactors(prev => prev.filter(x => x.id !== f.id))
            }}
          >
            {t('analysis:cfa.removeFactor')}
          </button>
        </div>
      ))}
      {!namesUnique() && (
        <div className={shellStyles.errorText}>{t('analysis:cfa.namesError')}</div>
      )}
      <div className={shellStyles.newVarRow}>
        <button
          type="button"
          className={shellStyles.btn}
          disabled={factors.length >= 12}
          onClick={() => {
            setFactors(prev => [...prev, newFactor(factorName(prev.length + 1))])
          }}
        >
          {t('analysis:cfa.addFactor')}
        </button>
        <button
          type="button"
          className={shellStyles.btn}
          disabled={!efa}
          title={efa ? undefined : t('analysis:cfa.importNone')}
          onClick={importFromEfa}
        >
          {t('analysis:cfa.importEfa')}
        </button>
      </div>
      {importMsg && <div className={shellStyles.hintText}>{importMsg}</div>}
    </OptionSection>
  )

  return (
    <AnalysisDialogShell
      key={shellKey}
      titleKey="analysis:cfa.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      extraContent={factorPanel}
      initialAssignments={initial}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setOptions(defaultCfaOptions)
        setFactors([newFactor(factorName(1)), newFactor(factorName(2))])
        setImportMsg(null)
      }}
    />
  )
}
