// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * use-cell-focus.ts — focus tracking + Name Box + formula bar for DataView
 * (B1, extracted from DataView.tsx; no behaviour change).
 *
 * Owns the focused-cell state (`activeCell` as a DB row for the status bar,
 * `focusRCRef` as the VISIBLE position for the Focus Cell crosshair), the
 * Name Box address input, the formula bar input, and the commit path shared
 * by edits that happen outside AG Grid's own editing (formula bar, Alt+↓
 * dropdown).
 */
import { useCallback, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import type { GridApi } from 'ag-grid-community'
import type { CellValue, Variable } from '@shared/data-types'
import {
  getColumnLetter,
  parseNameBoxAddress,
  toDbRow,
  type ParsedAddress
} from '../../lib/data-grid'
import { useDatasetStore } from '../../store/dataset-store'
import { useUIStore } from '../../store/ui-store'
import { ROW_NUM_COL_ID } from './constants'
import type { CommitResult } from './use-formulas'

export interface UseCellFocusParams {
  gridApiRef: React.RefObject<GridApi<CellValue[]> | null>
  rowsRef: React.RefObject<CellValue[][]>
  visibleToOriginalIndexRef: React.RefObject<number[]>
  variables: Variable[]
  navigateToAddress: (addr: ParsedAddress) => void
  publishActiveCellFormat: () => void
  getDisplayFormula: (dbRow: number, colId: string) => string | undefined
  getCellFormula: (dbRow: number, colId: string) => string | undefined
  commitCellInput: (dbRow: number, colIndex: number, raw: string) => CommitResult
  recomputeFormulas: () => void
  warnCell: (message: string) => void
  t: TFunction
}

export function useCellFocus(params: UseCellFocusParams) {
  const {
    gridApiRef,
    rowsRef,
    visibleToOriginalIndexRef,
    variables,
    navigateToAddress,
    publishActiveCellFormat,
    getDisplayFormula,
    getCellFormula,
    commitCellInput,
    recomputeFormulas,
    warnCell,
    t
  } = params

  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null)
  // Focus Cell crosshair (B5) — the focused cell's VISIBLE position (activeCell
  // above holds the DB row, which is what the status bar shows; the crosshair
  // has to match on-screen rows instead). Kept in a ref + a version counter so
  // cellClass reads it without rebuilding every colDef on each focus move.
  const focusRCRef = useRef<{ row: number; col: number } | null>(null)
  // Name Box (B1) — the address input (Excel's top-left box). Shows the
  // focused cell's address (letter+visible-row, e.g. "C7"); typing an address
  // + Enter navigates there. Updated from onCellFocused; user edits are local
  // until they blur/Enter (cell focus can't change while the box has focus).
  const [nameBoxValue, setNameBoxValue] = useState('')
  // Formula bar (Excel-style, next to the Name Box) — shows the focused cell's
  // formula if it has one, else its raw value; Enter commits to that cell.
  const [formulaBarValue, setFormulaBarValue] = useState('')

  // ── Name Box navigation (B1) ────────────────────────────────────────────
  const onNameBoxKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        const maxRow = rowsRef.current.length - 1
        const maxCol = variables.length - 1
        const addr = parseNameBoxAddress(nameBoxValue, maxRow, maxCol)
        if (addr) {
          navigateToAddress(addr)
          e.currentTarget.blur()
        } else {
          warnCell(t('dataset.invalidAddress'))
        }
      } else if (e.key === 'Escape') {
        e.currentTarget.blur()
      }
    },
    [rowsRef, nameBoxValue, variables.length, navigateToAddress, warnCell, t]
  )

  // Writes a committed display value into the row array, persists (plain cells
  // only — formula cells go through recompute), and repaints. Shared by the
  // formula bar and the Alt+↓ dropdown (both commit outside AG Grid editing).
  const applyCommittedValue = useCallback(
    (dbRow: number, colIndex: number, display: CellValue) => {
      const map = visibleToOriginalIndexRef.current
      const visRow = map.length === 0 ? dbRow : map.indexOf(dbRow)
      const rowArr = rowsRef.current[visRow]
      if (rowArr) rowArr[colIndex] = display
      const dsId = useDatasetStore.getState().datasetId
      const variable = useDatasetStore.getState().variables[colIndex]
      if (dsId && variable && getCellFormula(dbRow, variable.colId) === undefined) {
        void window.api.data
          .updateCell({ datasetId: dsId, rowIndex: dbRow, colId: variable.colId, value: display })
          .catch((err: unknown) => {
            console.error('updateCell failed:', err)
          })
      }
      recomputeFormulas()
      gridApiRef.current?.refreshCells({ force: true })
    },
    [gridApiRef, rowsRef, getCellFormula, recomputeFormulas, visibleToOriginalIndexRef]
  )

  // ── Formula bar commit (B1-adjacent formula feature) ────────────────────
  const onFormulaBarKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.currentTarget.blur()
        return
      }
      if (e.key !== 'Enter') return
      e.preventDefault()
      if (!activeCell) return
      const { row: dbRow, col: colIndex } = activeCell
      const { ok, display } = commitCellInput(dbRow, colIndex, formulaBarValue)
      if (!ok) return
      // Write the display into the row array (the inline valueSetter path
      // isn't used here since the edit came from the bar, not the grid).
      const map = visibleToOriginalIndexRef.current
      const visRow = map.length === 0 ? dbRow : map.indexOf(dbRow)
      const rowArr = rowsRef.current[visRow]
      if (rowArr) rowArr[colIndex] = display
      // Plain values persist directly; formula cells persist via recompute.
      const dsId = useDatasetStore.getState().datasetId
      const variable = variables[colIndex]
      if (dsId && variable && getCellFormula(dbRow, variable.colId) === undefined) {
        void window.api.data
          .updateCell({ datasetId: dsId, rowIndex: dbRow, colId: variable.colId, value: display })
          .catch((err: unknown) => {
            console.error('updateCell failed:', err)
          })
      }
      recomputeFormulas()
      gridApiRef.current?.refreshCells({ force: true })
      e.currentTarget.blur()
    },
    [
      gridApiRef,
      rowsRef,
      activeCell,
      formulaBarValue,
      commitCellInput,
      getCellFormula,
      recomputeFormulas,
      variables,
      visibleToOriginalIndexRef
    ]
  )

  // ── Selection tracking (status bar only — no multi-range yet, G4) ──────
  const onCellFocused = useCallback(() => {
    const api = gridApiRef.current
    publishActiveCellFormat()
    if (!api) return
    const focused = api.getFocusedCell()
    if (!focused || typeof focused.rowIndex !== 'number') {
      setActiveCell(null)
      focusRCRef.current = null
      return
    }
    const colId = focused.column.getColId()
    if (colId === ROW_NUM_COL_ID) {
      setActiveCell(null)
      focusRCRef.current = null
      return
    }
    const freshVars = useDatasetStore.getState().variables
    const colIdx = freshVars.findIndex(v => v.colId === colId)
    if (colIdx === -1) {
      setActiveCell(null)
      focusRCRef.current = null
      return
    }
    // Focus Cell crosshair: remember the VISIBLE position and repaint so the
    // old cross clears and the new one draws (cheap — content-only refresh).
    if (useUIStore.getState().focusCellHighlight) {
      focusRCRef.current = { row: focused.rowIndex, col: colIdx }
      api.refreshCells({ force: true })
    } else {
      focusRCRef.current = null
    }
    const dbRow = toDbRow(focused.rowIndex, visibleToOriginalIndexRef.current)
    setActiveCell({ row: dbRow, col: colIdx })
    // Name Box shows the visible position (matches the row-number gutter,
    // which is 1..N position-based), with the letter always from the data
    // column index (Excel uses letters even when headers show names).
    setNameBoxValue(`${getColumnLetter(colIdx)}${String(focused.rowIndex + 1)}`)
    // Formula bar: the cell's formula (translated to current visible
    // positions, Excel-style) if computed, else its raw value.
    const formula = getDisplayFormula(dbRow, colId)
    if (formula !== undefined) {
      setFormulaBarValue(formula)
    } else {
      const raw = rowsRef.current[focused.rowIndex]?.[colIdx] ?? null
      setFormulaBarValue(raw === null ? '' : String(raw))
    }
  }, [gridApiRef, rowsRef, publishActiveCellFormat, visibleToOriginalIndexRef, getDisplayFormula])

  return {
    activeCell,
    focusRCRef,
    nameBoxValue,
    setNameBoxValue,
    formulaBarValue,
    setFormulaBarValue,
    onNameBoxKeyDown,
    onFormulaBarKeyDown,
    onCellFocused,
    applyCommittedValue
  }
}
