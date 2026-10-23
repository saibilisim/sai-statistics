// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * use-column-defs.ts — builds DataView's AG Grid column definitions (the
 * row-number pseudo-column + one per variable), split out of DataView.tsx
 * (which had grown past 2500 lines). Purely a `useMemo` wrapped as its own
 * hook — every dependency it needs is passed in, so DataView.tsx stays the
 * single owner of the state/refs, this file just assembles the colDefs from
 * them.
 */
import { useMemo } from 'react'
import type {
  ColDef,
  ValueGetterParams,
  ValueSetterParams,
  ValueFormatterParams,
  CellClassParams
} from 'ag-grid-community'
import type { CellValue, Variable } from '@shared/data-types'
import type { HeaderMode } from '../../store/ui-store'
import { useDatasetStore } from '../../store/dataset-store'
import { toDbRow, getColumnLetter } from '../../lib/data-grid'
import { formatCellDisplay, isMissingValue, type DecimalSeparator } from '../../lib/aggrid-data'
import { cx } from '../../lib/cx'
import { normalizeRange, type CellRange } from './cell-selection'
import type { CellEditEntry } from './cell-value-undo'
import type { CommitResult } from './use-formulas'
import type { CaseIdentity } from './case-identity'
import { ColumnHeader, type ColumnHeaderParams } from './ColumnHeader'
import { ROW_NUM_COL_ID } from './constants'
import styles from './DataView.module.css'

export interface DataColDef extends ColDef<CellValue[]> {
  dataColIndex: number
  /** null only for the row-number pseudo-column. */
  variable: Variable | null
}

export interface UseColumnDefsParams {
  variables: Variable[]
  caseIdentity: CaseIdentity
  headerMode: HeaderMode
  showValueLabels: boolean
  decimalSeparator: DecimalSeparator
  showColumnFilterIcons: boolean
  columnFilters: Record<string, { operator: string; value: string }>
  columnSort: { colId: string; direction: 'asc' | 'desc' } | null
  onFilterClick: (colIndex: number, anchor: DOMRect) => void
  selectColumn: (colIndex: number, mode: 'replace' | 'add' | 'extend') => void
  onHeaderContextMenu: (colIndex: number, x: number, y: number) => void
  frozenColCount: number
  hiddenColIds: Set<string>
  isCellSelected: (colIndex: number, p: CellClassParams<CellValue[]>) => boolean
  selectedCellClass: string | undefined
  isFillHandleAnchor: (colIndex: number, p: CellClassParams<CellValue[]>) => boolean
  fillHandleAnchorClass: string | undefined
  copiedEdgeClass: (colIndex: number, p: CellClassParams<CellValue[]>) => string
  focusCellHighlight: boolean
  /** Visible (row, col) of the Focus Cell crosshair, or null when off —
   *  written by DataView's own onCellFocused, read here for cellClass. */
  focusRCRef: React.RefObject<{ row: number; col: number } | null>
  rangesRef: React.RefObject<CellRange[]>
  visibleToOriginalIndexRef: React.RefObject<number[]>
  commitCellInput: (dbRow: number, colIndex: number, raw: string) => CommitResult
  getCellFormula: (dbRow: number, colId: string) => string | undefined
  recordCellEdit: (batch: CellEditEntry[]) => void
}

export function useColumnDefs(params: UseColumnDefsParams): DataColDef[] {
  const {
    variables,
    caseIdentity,
    headerMode,
    showValueLabels,
    decimalSeparator,
    showColumnFilterIcons,
    columnFilters,
    columnSort,
    onFilterClick,
    selectColumn,
    onHeaderContextMenu,
    frozenColCount,
    hiddenColIds,
    isCellSelected,
    selectedCellClass,
    isFillHandleAnchor,
    fillHandleAnchorClass,
    copiedEdgeClass,
    focusCellHighlight,
    focusRCRef,
    rangesRef,
    visibleToOriginalIndexRef,
    commitCellInput,
    getCellFormula,
    recordCellEdit
  } = params

  return useMemo<DataColDef[]>(() => {
    const rowNumCol: DataColDef = {
      colId: ROW_NUM_COL_ID,
      dataColIndex: -1,
      variable: null,
      headerName: '',
      // Plain display position (1,2,3...N, always sequential) — matches
      // Excel/SPSS's actual convention: the row-number gutter reflects
      // *where a record currently sits on screen*, not a permanent per-
      // record id. Sorting reorders which record shows at which number
      // (a given case's number changes when it moves), but the number
      // sequence itself always stays ardışık 1..N. (A "permanent case id
      // that survives sort" variant was tried and explicitly rejected —
      // the two behaviors are mutually exclusive, this is the confirmed
      // choice.)
      valueGetter: (p: ValueGetterParams<CellValue[]>) => (p.node?.rowIndex ?? 0) + 1,
      pinned: 'left',
      width: 56,
      editable: false,
      sortable: false,
      filter: false,
      resizable: false,
      suppressMovable: true,
      lockPosition: true,
      rowDrag: () => {
        const s = useDatasetStore.getState()
        return Object.keys(s.columnFilters).length === 0 && !s.columnSort
      },
      cellClass: styles.rowNumCell
    }

    const dataCols: DataColDef[] = variables.map((v, colIndex) => ({
      colId: v.colId,
      dataColIndex: colIndex,
      variable: v,
      headerName: headerMode === 'name' ? v.name : getColumnLetter(colIndex),
      headerTooltip: v.label || v.name,
      headerComponent: ColumnHeader,
      headerComponentParams: {
        showFilterIcon: showColumnFilterIcons,
        hasFilter: !!columnFilters[v.colId],
        onFilterClick,
        onSelectColumn: selectColumn,
        onHeaderContextMenu,
        sortDirection: columnSort?.colId === v.colId ? columnSort.direction : null,
        colIndex
      } satisfies ColumnHeaderParams,
      // `null` (not `undefined`) when unfrozen — AG Grid treats `undefined`
      // as "no preference, leave whatever pinned state the column already
      // has", so unfreezing (frozenColCount back to 0) would silently no-op
      // without this; `null` is the documented "explicitly not pinned".
      pinned: colIndex < frozenColCount ? 'left' : null,
      hide: hiddenColIds.has(v.colId),
      width: Math.max(64, (v.columns || 8) * 9),
      editable: true,
      // Value-label dropdown (C7): a variable WITH value labels is categorical,
      // so editing it should offer its defined codes rather than free text —
      // SPSS does the same. `agSelectCellEditor` runs each option through the
      // column's valueFormatter (verified against AG Grid v35 source), so the
      // list shows labels ("Erkek") while the stored value stays the raw code
      // (1); getValue() returns that raw code, which still flows through
      // valueSetter → commitCellInput → prepareCellEdit like any other edit.
      ...(Object.keys(v.valueLabels).length > 0
        ? {
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: (p: { data?: CellValue[] }) => {
              const defined: CellValue[] = Object.keys(v.valueLabels).map(k =>
                v.type === 'numeric' && !Number.isNaN(Number(k)) ? Number(k) : k
              )
              // Keep the cell's current value selectable even when it has no
              // label yet — otherwise opening the editor on an unlabelled code
              // would show nothing selected and could silently change it.
              const current = p.data?.[colIndex] ?? null
              const values =
                current !== null && !defined.some(d => d === current)
                  ? [...defined, current]
                  : defined
              return { values }
            }
          }
        : {}),
      // Native sorting is deliberately off (C1): header clicks SELECT the
      // column (Excel/Sheets convention, P1.5), so AG Grid's sort would never
      // be reachable — and if it were, it would reorder rowData behind
      // visibleToOriginalIndexRef's back and send cell edits to the wrong DB
      // row. Sorting goes through the context menu → applySortInMemory, which
      // keeps that mapping in sync. The header shows its own ▲/▼ indicator.
      sortable: false,
      // Range-aware Tab/Enter (B1): while a multi-cell range is selected,
      // suppress AG Grid's own Tab/Enter navigation so the hook's
      // onCellKeyDown is the sole mover (it cycles the focus WITHIN the
      // range instead of collapsing it). Single-cell selections fall through
      // to native nav (returns false).
      suppressKeyboardEvent: (p): boolean => {
        const e = p.event
        // Alt+↓ opens the value dropdown (DataView) — stop AG Grid moving the
        // focus down first, or the dropdown would target the row below.
        if (e.altKey && e.key === 'ArrowDown') return true
        if ((e.key === 'Tab' || e.key === 'Enter') && !p.editing) {
          const last = rangesRef.current[rangesRef.current.length - 1]
          if (last) {
            const { top, bottom, left, right } = normalizeRange(last)
            if ((right - left + 1) * (bottom - top + 1) > 1) return true
          }
        }
        // Delete/Backspace on a non-editing cell: AG Grid's own default
        // behavior clears just the FOCUSED cell via the normal edit cycle —
        // running independently of (and racing) use-cell-selection.ts's own
        // onCellKeyDown, which clears the WHOLE selection. Both firing for
        // the same keypress split one logical "clear selection" into two
        // separate undo-stack batches (the focused cell as its own step),
        // so Ctrl+Z only restored the rest of the selection, leaving that one
        // cell needing a second Ctrl+Z. Suppressing AG Grid's own handling
        // here makes the hook's clearSelectedCells() the sole writer.
        if ((e.key === 'Delete' || e.key === 'Backspace') && !p.editing) return true
        return false
      },
      valueGetter: (p: ValueGetterParams<CellValue[]>) => p.data?.[colIndex] ?? null,
      valueSetter: (p: ValueSetterParams<CellValue[]>) => {
        const visibleRow = p.node?.rowIndex
        if (visibleRow === null || visibleRow === undefined) return false
        const dbRow = toDbRow(visibleRow, visibleToOriginalIndexRef.current)
        // Captured BEFORE commitCellInput — it may itself set/clear the
        // formula synchronously, so this is the only point where "what it
        // was before this edit" is still readable (value-undo stack).
        const prevValue = p.data[colIndex] ?? null
        const prevFormula = getCellFormula(dbRow, v.colId) ?? null
        // commitCellInput handles both a "=formula" (stored in customStyles,
        // evaluated now) and a plain value (validated, any prior formula
        // cleared). Formula-cell DB persistence + dependent recompute happen
        // in onCellValueChanged.
        const { ok, display } = commitCellInput(dbRow, colIndex, String(p.newValue ?? ''))
        if (!ok) return false
        p.data[colIndex] = display
        const nextFormula = getCellFormula(dbRow, v.colId) ?? null
        if (prevValue !== display || prevFormula !== nextFormula) {
          recordCellEdit([
            {
              visRow: visibleRow,
              col: colIndex,
              colId: v.colId,
              prevValue,
              nextValue: display,
              prevFormula,
              nextFormula
            }
          ])
        }
        return true
      },
      valueFormatter: (p: ValueFormatterParams<CellValue[]>) => {
        if (p.node?.rowIndex === null || p.node?.rowIndex === undefined) {
          return formatCellDisplay(
            (p.value ?? null) as CellValue,
            v,
            showValueLabels,
            undefined,
            undefined,
            decimalSeparator
          )
        }
        const dbRow = toDbRow(p.node.rowIndex, visibleToOriginalIndexRef.current)
        const format =
          useDatasetStore.getState().customStyles?.cells?.[caseIdentity.keyOfDb(dbRow)]?.[v.colId]
        return formatCellDisplay(
          (p.value ?? null) as CellValue,
          v,
          showValueLabels,
          format?.numberFormat,
          format?.currency,
          decimalSeparator
        )
      },
      cellClass: (p: CellClassParams<CellValue[]>) => {
        const val = p.data?.[colIndex] ?? null
        const focus = focusCellHighlight ? focusRCRef.current : null
        return cx(
          isMissingValue(val, v.missing) && styles.missingCell,
          isCellSelected(colIndex, p) && selectedCellClass,
          isFillHandleAnchor(colIndex, p) && fillHandleAnchorClass,
          copiedEdgeClass(colIndex, p),
          // Focus Cell crosshair (B5): tint the focused cell's whole row and
          // column (the cell itself gets both, which reads as the crosshair
          // centre).
          focus && (p.node.rowIndex === focus.row || colIndex === focus.col) && styles.focusCross
        )
      },
      cellStyle: (p: CellClassParams<CellValue[]>) => {
        const baseAlign: string =
          v.align === 'left' ? 'left' : v.align === 'center' ? 'center' : 'right'
        if (p.node.rowIndex === null) return { textAlign: baseAlign }
        const dbRow = toDbRow(p.node.rowIndex, visibleToOriginalIndexRef.current)
        const format =
          useDatasetStore.getState().customStyles?.cells?.[caseIdentity.keyOfDb(dbRow)]?.[v.colId]
        if (!format) return { textAlign: baseAlign }
        const style: Record<string, string> = { textAlign: format.hAlign ?? baseAlign }
        if (format.bold) style.fontWeight = 'bold'
        if (format.italic) style.fontStyle = 'italic'
        if (format.underline) style.textDecoration = 'underline'
        if (format.fontFamily) style.fontFamily = format.fontFamily
        if (format.fontSize) style.fontSize = `${String(format.fontSize)}px`
        if (format.color) style.color = format.color
        if (format.bg) style.backgroundColor = format.bg
        return style
      }
    }))

    return [rowNumCol, ...dataCols]
  }, [
    variables,
    caseIdentity,
    headerMode,
    showValueLabels,
    decimalSeparator,
    showColumnFilterIcons,
    columnFilters,
    columnSort,
    onFilterClick,
    selectColumn,
    onHeaderContextMenu,
    frozenColCount,
    hiddenColIds,
    isCellSelected,
    selectedCellClass,
    isFillHandleAnchor,
    fillHandleAnchorClass,
    copiedEdgeClass,
    focusCellHighlight,
    focusRCRef,
    rangesRef,
    visibleToOriginalIndexRef,
    commitCellInput,
    getCellFormula,
    recordCellEdit
  ])
}
