// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from './DialogBase'
import { cx } from '../../lib/cx'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import styles from './DataDialogs.module.css'

interface Props {
  onClose: () => void
}

type SortCriterion = 'name' | 'type' | 'label' | 'measure'
type SortOrder = 'ascending' | 'descending'

const MEASURE_RANK: Record<string, number> = { scale: 0, ordinal: 1, nominal: 2 }

const CRITERION_KEYS: Record<
  SortCriterion,
  | 'dialog.sortVariables.byName'
  | 'dialog.sortVariables.byType'
  | 'dialog.sortVariables.byLabel'
  | 'dialog.sortVariables.byMeasure'
> = {
  name: 'dialog.sortVariables.byName',
  type: 'dialog.sortVariables.byType',
  label: 'dialog.sortVariables.byLabel',
  measure: 'dialog.sortVariables.byMeasure'
}

const ORDER_KEYS: Record<
  SortOrder,
  'dialog.sortVariables.ascending' | 'dialog.sortVariables.descending'
> = {
  ascending: 'dialog.sortVariables.ascending',
  descending: 'dialog.sortVariables.descending'
}

function compareBy(criterion: SortCriterion, a: Variable, b: Variable): number {
  switch (criterion) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'type':
      return a.type.localeCompare(b.type)
    case 'label':
      return (a.label || a.name).localeCompare(b.label || b.name)
    case 'measure':
      return (MEASURE_RANK[a.measure] ?? 99) - (MEASURE_RANK[b.measure] ?? 99)
  }
}

export function SortVariablesDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const uid = useId()
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)
  const setVariables = useDatasetStore(s => s.setVariables)
  const setModified = useDatasetStore(s => s.setModified)

  const [criterion, setCriterion] = useState<SortCriterion>('name')
  const [order, setOrder] = useState<SortOrder>('ascending')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleOk = async () => {
    if (!datasetId) return
    setRunning(true)
    setError(null)
    try {
      const sorted = [...variables].sort((a, b) => {
        const cmp = compareBy(criterion, a, b)
        return order === 'ascending' ? cmp : -cmp
      })
      const colIds = sorted.map(v => v.colId)
      await window.api.variable.reorder({ datasetId, colIds })
      setVariables(sorted)
      setModified(true)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <DialogBase
      titleKey="dialog.sortVariables.title"
      onOk={() => void handleOk()}
      onCancel={onClose}
      okDisabled={running}
    >
      <p className={styles.colLabel}>{t('dialog.sortVariables.sortBy')}</p>
      <div className={styles.radioStack}>
        {(['name', 'type', 'label', 'measure'] as const).map(c => (
          <label key={c} className={styles.radioRow}>
            <input
              type="radio"
              name={`${uid}-criterion`}
              checked={criterion === c}
              onChange={() => {
                setCriterion(c)
              }}
            />
            {t(CRITERION_KEYS[c])}
          </label>
        ))}
      </div>

      <p className={cx(styles.colLabel, 'mt-md')}>{t('dialog.sortVariables.order')}</p>
      <div className="row-md">
        {(['ascending', 'descending'] as const).map(o => (
          <label key={o} className={styles.radioRow}>
            <input
              type="radio"
              name={`${uid}-order`}
              checked={order === o}
              onChange={() => {
                setOrder(o)
              }}
            />
            {t(ORDER_KEYS[o])}
          </label>
        ))}
      </div>

      {error && <div className={styles.errorText}>{error}</div>}
    </DialogBase>
  )
}
