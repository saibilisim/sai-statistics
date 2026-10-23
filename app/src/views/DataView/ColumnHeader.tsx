// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ColumnHeader.tsx — AG Grid custom header renderer for DataView's data
 * columns. Replaces the previous grid's `headerOverlay`/`FilterIcon` absolute-
 * positioned strip (constants.ts's `getColumnHeaderStyle` + DataView.tsx's
 * scrollX-tracked overlay) — AG Grid headers scroll natively with their
 * columns, so a header rendered *inside* the column needs no manual
 * scroll-position bookkeeping at all.
 */
import type { CustomHeaderProps } from 'ag-grid-react'
import type { CellValue } from '@shared/data-types'
import { FilterIcon } from './FilterIcon'
import styles from './DataView.module.css'

export interface ColumnHeaderParams {
  showFilterIcon: boolean
  hasFilter: boolean
  onFilterClick: (colIndex: number, anchor: DOMRect) => void
  onSelectColumn: (colIndex: number, mode: 'replace' | 'add' | 'extend') => void
  /** Right-click on the header itself — AG Grid's own `onCellContextMenu`
   *  only fires for body cells, never for header cells, so this is wired
   *  separately (P1.4, spreadsheet-ozellikleri-envanteri.md §3/§6). */
  onHeaderContextMenu: (colIndex: number, x: number, y: number) => void
  /** Sort direction currently applied to THIS column, if any (C1) — drawn as
   *  a small ▲/▼ so an active sort is visible from the header. AG Grid's own
   *  sort indicator isn't used: header clicks select the column (Excel/Sheets
   *  convention), so native sorting is never triggered and its icon would
   *  never light up. */
  sortDirection: 'asc' | 'desc' | null
  colIndex: number
}

export function ColumnHeader(props: CustomHeaderProps<CellValue[]> & ColumnHeaderParams) {
  const {
    displayName,
    showFilterIcon,
    hasFilter,
    onFilterClick,
    onSelectColumn,
    onHeaderContextMenu,
    sortDirection,
    colIndex
  } = props

  return (
    <div
      className={styles.columnHeaderInner}
      onClick={e => {
        const mode = e.shiftKey ? 'extend' : e.ctrlKey || e.metaKey ? 'add' : 'replace'
        onSelectColumn(colIndex, mode)
      }}
      onContextMenu={e => {
        e.preventDefault()
        onSelectColumn(colIndex, 'replace')
        onHeaderContextMenu(colIndex, e.clientX, e.clientY)
      }}
    >
      <span className={styles.columnHeaderText} title={displayName}>
        {displayName}
      </span>
      {sortDirection && (
        <span className={styles.sortIndicator} aria-hidden="true">
          {sortDirection === 'asc' ? '▲' : '▼'}
        </span>
      )}
      {showFilterIcon && (
        <button
          type="button"
          className={styles.filterButtonInline}
          onClick={e => {
            e.stopPropagation()
            onFilterClick(colIndex, e.currentTarget.getBoundingClientRect())
          }}
        >
          <FilterIcon active={hasFilter} />
        </button>
      )}
    </div>
  )
}
