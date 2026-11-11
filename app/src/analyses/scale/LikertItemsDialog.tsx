// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Likert Item Descriptives dialog — Analyze → Scale → Likert Item Descriptives.
 * Per-item option percentages, descriptives, score-interval level and a
 * diverging stacked bar chart (likert-items.R).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  CheckOption,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { ReverseItemsPanel } from './ReverseItemsPanel'
import { parseRange } from './scale-score-names'

export function LikertItemsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { running, run } = useRunAnalysis()
  const [reverse, setReverse] = useState<string[]>([])
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [chart, setChart] = useState(true)

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:likert.itemsField',
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const sideButtons: SideButtonDef[] = [
    {
      key: 'reverse',
      labelKey: 'analysis:scaleShared.btnReverse',
      titleKey: 'analysis:scaleShared.reverseTitle',
      renderContent: ({ onClose: closeSub, assignments }) => (
        <ReverseItemsPanel
          items={assignments['variables'] ?? []}
          value={reverse}
          onChange={setReverse}
          onClose={closeSub}
        />
      )
    }
  ]

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = a['variables'] ?? []
    const ids = new Set(vars.map(v => v.colId))
    await run(
      {
        analysisId: 'likert',
        datasetId,
        scriptFile: 'likert-items.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
          valueLabels: Object.fromEntries(vars.map(v => [v.colId, v.valueLabels])),
          reverseItems: reverse.filter(id => ids.has(id)),
          options: { ...parseRange(min, max), chart }
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:likert.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId="likert"
      titleKey="analysis:likert.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={a => (a['variables'] ?? []).length >= 1 && !running}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setReverse([])
        setMin('')
        setMax('')
        setChart(true)
      }}
      extraContent={
        <div className={shellStyles.optionSection}>
          <ScaleRangeInputs min={min} max={max} setMin={setMin} setMax={setMax} />
          <CheckOption checked={chart} onChange={setChart}>
            {t('analysis:likert.chartOption')}
          </CheckOption>
        </div>
      }
    />
  )
}

/** "Response range: [min] – [max]" (blank = from the data). */
export function ScaleRangeInputs(p: {
  min: string
  max: string
  setMin: (v: string) => void
  setMax: (v: string) => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  return (
    <label className={shellStyles.checkRow}>
      {t('analysis:scaleShared.range')}
      <input
        type="number"
        step="1"
        className="numField"
        placeholder={t('analysis:scaleShared.auto')}
        aria-label={t('analysis:scaleShared.rangeMin')}
        value={p.min}
        onChange={e => {
          p.setMin(e.target.value)
        }}
      />
      –
      <input
        type="number"
        step="1"
        className="numField"
        placeholder={t('analysis:scaleShared.auto')}
        aria-label={t('analysis:scaleShared.rangeMax')}
        value={p.max}
        onChange={e => {
          p.setMax(e.target.value)
        }}
      />
    </label>
  )
}
