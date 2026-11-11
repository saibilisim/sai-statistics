// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scale Scores Report dialog — Analyze → Scale → Scale Scores Report.
 * Subscale boxes (add / rename / remove, as in the CFA dialog) with their
 * items; reverse-scored items; mean or sum scores; the normality cut-off; and
 * saving each score as a new variable (scale-report.R).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  CheckOption,
  OptionSection,
  type FieldDef,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { parseRange, scoreVarNames } from './scale-score-names'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { ReverseItemsPanel } from './ReverseItemsPanel'
import { ScaleRangeInputs } from './LikertItemsDialog'

interface Subscale {
  id: string
  name: string
}
let seq = 0
const newSub = (name: string): Subscale => {
  seq += 1
  return { id: `s${String(seq)}`, name }
}

export function ScaleReportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const existingNames = useDatasetStore(s => s.variables).map(v => v.name)
  const { running, run } = useRunAnalysis()
  const subName = (i: number) => t('analysis:scaleReport.defaultName', { n: i })
  const [subs, setSubs] = useState<Subscale[]>(() => [newSub(subName(1))])
  const [reverse, setReverse] = useState<string[]>([])
  const [score, setScore] = useState<'mean' | 'sum'>('mean')
  const [total, setTotal] = useState(false)
  const [criterion, setCriterion] = useState('1.5')
  const [save, setSave] = useState(false)
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')

  const fieldDefs: FieldDef[] = subs.map(s => ({
    key: s.id,
    labelKey: 'analysis:scaleReport.subscaleField',
    label: s.name.trim() || t('analysis:scaleReport.subscaleField'),
    filter: (v: Variable) => v.type === 'numeric'
  }))
  const itemsOf = (a: Record<string, Variable[]>) => {
    const m = new Map<string, Variable>()
    for (const s of subs) for (const v of a[s.id] ?? []) m.set(v.colId, v)
    return [...m.values()]
  }
  const namesOk = () => {
    const ns = subs.map(s => s.name.trim())
    return ns.every(n => n !== '') && new Set(ns).size === ns.length
  }
  const filled = (a: Record<string, Variable[]>) => subs.filter(s => (a[s.id] ?? []).length > 0)

  const sideButtons: SideButtonDef[] = [
    {
      key: 'reverse',
      labelKey: 'analysis:scaleShared.btnReverse',
      titleKey: 'analysis:scaleShared.reverseTitle',
      renderContent: ({ onClose: closeSub, assignments }) => (
        <ReverseItemsPanel
          items={itemsOf(assignments)}
          value={reverse}
          onChange={setReverse}
          onClose={closeSub}
        />
      )
    }
  ]

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const items = itemsOf(a)
    const ids = new Set(items.map(v => v.colId))
    const used = filled(a)
    const createVars = save
      ? scoreVarNames(
          [
            ...used.map((s, i) => ({ slot: `score${String(i + 1)}`, base: s.name.trim() })),
            ...(total && used.length > 1 ? [{ slot: 'total', base: 'Total' }] : [])
          ],
          existingNames
        )
      : {}
    await run(
      {
        analysisId: 'scaleReport',
        datasetId,
        scriptFile: 'scale-report.R',
        params: {
          variables: items.map(v => v.colId),
          varNames: Object.fromEntries(items.map(v => [v.colId, v.name])),
          valueLabels: Object.fromEntries(items.map(v => [v.colId, v.valueLabels])),
          subscales: used.map(s => ({
            name: s.name.trim(),
            items: (a[s.id] ?? []).map(v => v.colId)
          })),
          reverseItems: reverse.filter(id => ids.has(id)),
          createVars,
          options: { score, total, criterion: Number(criterion), ...parseRange(min, max) }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:scaleReport.title', assignments: a }
    )
  }

  const panel = (
    <>
      <OptionSection titleKey="analysis:scaleReport.subscalesSection" grid={false}>
        {subs.map((s, i) => (
          <div key={s.id} className={shellStyles.newVarRow}>
            <label className={shellStyles.checkRow}>
              {t('analysis:scaleReport.nameLabel', { n: i + 1 })}
              <input
                className={shellStyles.input}
                value={s.name}
                maxLength={40}
                onChange={e => {
                  const name = e.target.value
                  setSubs(prev => prev.map(x => (x.id === s.id ? { ...x, name } : x)))
                }}
              />
            </label>
            <button
              type="button"
              className={shellStyles.btn}
              disabled={subs.length <= 1}
              aria-label={`${t('analysis:cfa.removeFactor')}: ${s.name}`}
              onClick={() => {
                setSubs(prev => prev.filter(x => x.id !== s.id))
              }}
            >
              {t('analysis:cfa.removeFactor')}
            </button>
          </div>
        ))}
        {!namesOk() && <div className={shellStyles.errorText}>{t('analysis:cfa.namesError')}</div>}
        <div className={shellStyles.newVarRow}>
          <button
            type="button"
            className={shellStyles.btn}
            disabled={subs.length >= 12}
            onClick={() => {
              setSubs(prev => [...prev, newSub(subName(prev.length + 1))])
            }}
          >
            {t('analysis:scaleReport.addSubscale')}
          </button>
        </div>
      </OptionSection>
      <OptionSection titleKey="analysis:scaleReport.optionsSection" grid={false}>
        <label className={shellStyles.checkRow}>
          {t('analysis:scaleReport.scoreLabel')}
          <select
            className="numField numField--select"
            value={score}
            onChange={e => {
              setScore(e.target.value as 'mean' | 'sum')
            }}
          >
            <option value="mean">{t('analysis:scaleReport.scoreMean')}</option>
            <option value="sum">{t('analysis:scaleReport.scoreSum')}</option>
          </select>
        </label>
        <ScaleRangeInputs min={min} max={max} setMin={setMin} setMax={setMax} />
        <label className={shellStyles.checkRow}>
          {t('analysis:scaleReport.criterionLabel')}
          <select
            className="numField numField--select"
            value={criterion}
            onChange={e => {
              setCriterion(e.target.value)
            }}
          >
            <option value="1">{t('analysis:scaleReport.criterion1')}</option>
            <option value="1.5">{t('analysis:scaleReport.criterion15')}</option>
            <option value="2">{t('analysis:scaleReport.criterion2')}</option>
          </select>
        </label>
        <CheckOption checked={total} onChange={setTotal}>
          {t('analysis:scaleReport.totalOption')}
        </CheckOption>
        <CheckOption checked={save} onChange={setSave}>
          {t('analysis:scaleReport.saveOption')}
        </CheckOption>
      </OptionSection>
    </>
  )

  return (
    <AnalysisDialogShell
      titleKey="analysis:scaleReport.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      extraContent={panel}
      canSubmit={a => filled(a).length >= 1 && namesOk() && !running}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setSubs([newSub(subName(1))])
        setReverse([])
        setScore('mean')
        setTotal(false)
        setCriterion('1.5')
        setSave(false)
        setMin('')
        setMax('')
      }}
    />
  )
}
