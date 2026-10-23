// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useDatasetStore } from '../../store/dataset-store'
import type { CellValue } from '@shared/data-types'
import type { FilterOperator } from '@shared/data-filter'
import { findValueLabel, formatFilterItemLabel, normalizeForSearch } from '../../lib/aggrid-data'
import { cx } from '../../lib/cx'
import styles from './ColumnFilterPopup.module.css'

const CONDITION_OPERATORS: Array<{ value: FilterOperator; labelKey: string }> = [
  { value: 'equals', labelKey: 'common.opEquals' },
  { value: 'not_equals', labelKey: 'common.opNotEquals' },
  { value: 'greater_than', labelKey: 'common.opGt' },
  { value: 'greater_than_or_equal', labelKey: 'common.opGte' },
  { value: 'less_than', labelKey: 'common.opLt' },
  { value: 'less_than_or_equal', labelKey: 'common.opLte' },
  { value: 'contains', labelKey: 'common.opContains' },
  { value: 'starts_with', labelKey: 'common.opStartsWith' },
  { value: 'is_empty', labelKey: 'common.opIsEmpty' },
  { value: 'is_not_empty', labelKey: 'common.opIsNotEmpty' }
]

const NO_VALUE_OPS: FilterOperator[] = ['is_empty', 'is_not_empty']

interface ColumnFilterPopupProps {
  colIndex: number
  x: number
  y: number
  onClose: () => void
  allRows: CellValue[][]
}

export function ColumnFilterPopup({ colIndex, x, y, onClose, allRows }: ColumnFilterPopupProps) {
  const { t } = useTranslation(['common', 'menu', 'analysis', 'dialogs'])
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const columnSort = useDatasetStore(s => s.columnSort)
  const setColumnFilter = useDatasetStore(s => s.setColumnFilter)
  const setColumnSort = useDatasetStore(s => s.setColumnSort)
  const bumpDataVersion = useDatasetStore(s => s.bumpDataVersion)
  const setModified = useDatasetStore(s => s.setModified)

  const variable = variables[colIndex]
  const popupRef = useRef<HTMLDivElement>(null)

  // 1. Calculate unique values, labels, and their counts
  const uniqueItems = useMemo(() => {
    if (!variable) return []
    const counts: Record<string, number> = {}

    allRows.forEach(row => {
      const val = row[colIndex]
      const strVal = val === null || val === undefined ? '' : String(val)
      counts[strVal] = (counts[strVal] || 0) + 1
    })

    return Object.entries(counts)
      .map(([value, count]) => {
        const label = findValueLabel(variable, value)
        const displayLabel = formatFilterItemLabel(value, label)
        return { value, count, label, displayLabel }
      })
      .sort((a, b) => {
        const nA = Number(a.value)
        const nB = Number(b.value)
        if (!isNaN(nA) && !isNaN(nB)) return nA - nB
        return a.value.localeCompare(b.value, undefined, { numeric: true, sensitivity: 'base' })
      })
  }, [variable, allRows, colIndex])

  // 2. Initialize checked values from store
  const activeColFilter = variable ? columnFilters[variable.colId] : null
  const initialChecked = useMemo(() => {
    if (activeColFilter?.operator === 'in') {
      try {
        return JSON.parse(activeColFilter.value) as string[]
      } catch {
        return uniqueItems.map(item => item.value)
      }
    }
    // Default: all checked
    return uniqueItems.map(item => item.value)
  }, [activeColFilter, uniqueItems])

  // A condition-mode filter (any operator other than the checkbox-list's
  // 'in') seeds the Condition tab and opens the popup there, so the user
  // sees the filter that's actually active on this column.
  const isConditionFilter = !!activeColFilter && activeColFilter.operator !== 'in'

  // Initial check state is seeded from the store filter. The parent remounts
  // this component (via `key={colIndex}`) when a different column is opened, so
  // no reset-on-prop-change effect is needed.
  const [checkedValues, setCheckedValues] = useState<string[]>(initialChecked)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'value' | 'color' | 'condition'>(
    isConditionFilter ? 'condition' : 'value'
  )
  const [conditionOp, setConditionOp] = useState<FilterOperator>(
    isConditionFilter ? (activeColFilter.operator as FilterOperator) : 'equals'
  )
  const [conditionVal, setConditionVal] = useState<string>(
    isConditionFilter ? activeColFilter.value : ''
  )
  const conditionNeedsValue = !NO_VALUE_OPS.includes(conditionOp)
  const canApplyCondition = !conditionNeedsValue || conditionVal.trim() !== ''

  // Adjust popup position if it goes off screen
  const [adjustedPos, setAdjustedPos] = useState({ left: x, top: y })
  useEffect(() => {
    if (popupRef.current) {
      const rect = popupRef.current.getBoundingClientRect()
      let left = x
      let top = y
      if (left + rect.width > window.innerWidth) {
        left = window.innerWidth - rect.width - 16
      }
      if (top + rect.height > window.innerHeight) {
        top = window.innerHeight - rect.height - 16
      }
      setAdjustedPos({ left: Math.max(8, left), top: Math.max(8, top) })
    }
  }, [x, y, uniqueItems])

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim()
    if (!q) return uniqueItems
    const qLower = q.toLowerCase()
    const qNorm = normalizeForSearch(q)

    return uniqueItems.filter(item => {
      return (
        item.value.toLowerCase().includes(qLower) ||
        normalizeForSearch(item.value).includes(qNorm) ||
        item.displayLabel.toLowerCase().includes(qLower) ||
        normalizeForSearch(item.displayLabel).includes(qNorm) ||
        (item.label &&
          (item.label.toLowerCase().includes(qLower) ||
            normalizeForSearch(item.label).includes(qNorm)))
      )
    })
  }, [uniqueItems, searchQuery])

  if (!variable) return null

  const isSortedAsc =
    columnSort != null && columnSort.colId === variable.colId && columnSort.direction === 'asc'
  const isSortedDesc =
    columnSort != null && columnSort.colId === variable.colId && columnSort.direction === 'desc'

  const allFilteredChecked = filteredItems.every(item => checkedValues.includes(item.value))

  const handleSelectAllToggle = () => {
    if (allFilteredChecked) {
      // Uncheck all in current filtered view
      const filteredVals = filteredItems.map(item => item.value)
      setCheckedValues(prev => prev.filter(v => !filteredVals.includes(v)))
    } else {
      // Check all in current filtered view
      const filteredVals = filteredItems.map(item => item.value)
      setCheckedValues(prev => Array.from(new Set([...prev, ...filteredVals])))
    }
  }

  const handleSelectInvert = () => {
    const filteredVals = filteredItems.map(item => item.value)
    setCheckedValues(prev => {
      const next = [...prev]
      filteredVals.forEach(v => {
        const idx = next.indexOf(v)
        if (idx > -1) {
          next.splice(idx, 1)
        } else {
          next.push(v)
        }
      })
      return next
    })
  }

  const handleItemToggle = (value: string) => {
    setCheckedValues(prev => {
      if (prev.includes(value)) {
        return prev.filter(v => v !== value)
      } else {
        return [...prev, value]
      }
    })
  }

  // Real DB sort (SPSS Data > Sort Cases semantics) — same window.api.data.sort
  // call the "SORT CASES BY" syntax command uses (spss-syntax.ts), so the
  // A↓/Z↓ buttons here and the Data menu's Sort Cases dialog are never two
  // different behaviors: both physically reorder DuckDB's rows. columnSort is
  // cleared (not set) afterwards — the rows arrive from data:get-all already
  // in the true DB order, so re-sorting them again in memory would be
  // redundant and risks a subtly different result (applySortInMemory's
  // locale-aware comparator isn't guaranteed identical to DuckDB's ORDER BY).
  const handleSort = (dir: 'asc' | 'desc') => {
    if (!datasetId) return
    onClose()
    void window.api.data
      .sort({ datasetId, colId: variable.colId, direction: dir })
      .then(() => {
        setColumnSort('', null)
        bumpDataVersion()
        setModified(true)
      })
      .catch((err: unknown) => {
        console.error('Failed to sort:', err)
      })
  }

  const handleOk = () => {
    if (activeTab === 'condition') {
      if (!canApplyCondition) return
      setColumnFilter(variable.colId, {
        operator: conditionOp,
        value: conditionNeedsValue ? conditionVal.trim() : ''
      })
      onClose()
      return
    }
    // Value tab: if all items are selected, it's equivalent to no filter on this column
    if (checkedValues.length === uniqueItems.length) {
      setColumnFilter(variable.colId, null)
    } else {
      setColumnFilter(variable.colId, {
        operator: 'in',
        value: JSON.stringify(checkedValues)
      })
    }
    onClose()
  }

  const handleClear = () => {
    setColumnFilter(variable.colId, null)
    onClose()
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={popupRef}
        className={styles.popup}
        // Konum tıklanan sütun başlığından çalışma zamanında hesaplanır — sınıfa taşınamaz.
        style={{ left: `${String(adjustedPos.left)}px`, top: `${String(adjustedPos.top)}px` }}
        onClick={e => {
          e.stopPropagation()
        }}
      >
        {/* Sort Buttons */}
        <div className={cx(styles.section, styles.sortRow)}>
          <button
            className={cx(styles.sortButton, isSortedAsc && styles.active)}
            onClick={() => {
              handleSort('asc')
            }}
          >
            <span>A↓</span> {t('menu:data.sortCases')} (Asc)
          </button>
          <button
            className={cx(styles.sortButton, isSortedDesc && styles.active)}
            onClick={() => {
              handleSort('desc')
            }}
          >
            <span>Z↓</span> {t('menu:data.sortCases')} (Desc)
          </button>
        </div>

        {/* Tabs Row */}
        <div className={styles.tabs}>
          <button
            className={cx(styles.tab, activeTab === 'value' && styles.active)}
            onClick={() => {
              setActiveTab('value')
            }}
          >
            {t('common.filterValue')}
          </button>
          <button
            className={cx(styles.tab, activeTab === 'condition' && styles.active)}
            onClick={() => {
              setActiveTab('condition')
            }}
          >
            {t('common.filterCondition')}
          </button>
          <button
            className={cx(styles.tab, activeTab === 'color' && styles.active)}
            onClick={() => {
              setActiveTab('color')
            }}
            disabled
          >
            {t('common.filterColor')}
          </button>
        </div>

        {activeTab === 'value' && (
          <>
            {/* Search Input */}
            <div className={styles.searchBox}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder={t('common.filterSearchPlaceholder')}
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value)
                }}
              />
              <span className={styles.searchIcon}>🔍</span>
            </div>

            {/* Action Link Bar */}
            <div className={styles.actionBar}>
              <span className={styles.actionLink} onClick={handleSelectAllToggle}>
                {allFilteredChecked ? t('common.filterDeselectAll') : t('common.filterSelectAll')}
              </span>
              <span className={styles.actionLink} onClick={handleSelectInvert}>
                {t('common.filterInvert')}
              </span>
              <span className={styles.actionLink} onClick={handleClear}>
                {t('common.reset')}
              </span>
            </div>

            {/* Checkbox List */}
            <div className={styles.listContainer}>
              {filteredItems.map(item => {
                const isChecked = checkedValues.includes(item.value)
                return (
                  <div
                    key={item.value}
                    className={styles.listItem}
                    onClick={() => {
                      handleItemToggle(item.value)
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}} // handled by row click
                    />
                    <span className={styles.itemLabel} title={item.displayLabel}>
                      {item.displayLabel}
                    </span>
                    <span className={styles.itemCount}>({item.count})</span>
                  </div>
                )
              })}
              {filteredItems.length === 0 && (
                <div className={styles.emptyList}>{t('common.filterNoMatches')}</div>
              )}
            </div>
          </>
        )}

        {activeTab === 'condition' && (
          <div className={cx(styles.section, styles.conditionSection)}>
            <select
              className={styles.searchInput}
              value={conditionOp}
              onChange={e => {
                setConditionOp(e.target.value as FilterOperator)
              }}
              aria-label={t('common.filterCondition')}
            >
              {CONDITION_OPERATORS.map(o => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey as never)}
                </option>
              ))}
            </select>
            {conditionNeedsValue && (
              <input
                type="text"
                className={styles.searchInput}
                value={conditionVal}
                onChange={e => {
                  setConditionVal(e.target.value)
                }}
                placeholder={t('common.filterConditionValuePlaceholder')}
                aria-label={t('common.filterValue')}
              />
            )}
            <div className={styles.actionBar}>
              <span className={styles.actionLink} onClick={handleClear}>
                {t('common.reset')}
              </span>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className={styles.footer}>
          <button
            className={cx(styles.footerButton, styles.btnOk)}
            onClick={handleOk}
            disabled={activeTab === 'condition' && !canApplyCondition}
          >
            {t('common.ok')}
          </button>
          <button className={cx(styles.footerButton, styles.btnCancel)} onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
