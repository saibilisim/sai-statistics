// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * use-data-view-shortcuts.ts — window-level keyboard shortcuts for DataView
 * (extracted from DataView.tsx; no behaviour change): Alt+↓ column-value
 * dropdown (B3), Ctrl+Shift+V Paste Special menu (B4), the Ctrl+F/H/\+/-/0
 * cluster, Shift+F4 find-next, and the menu:edit:undo/redo IPC channel.
 * Also owns the two popup-menu states those shortcuts open.
 */
import { useCallback, useEffect, useState } from 'react'
import type { GridApi } from 'ag-grid-community'
import type { CellValue, Variable } from '@shared/data-types'
import { toDbRow } from '../../lib/data-grid'
import { formatCellDisplay } from '../../lib/aggrid-data'
import { performUndoRedo } from '../../lib/dataset-undo'
import { useDatasetStore } from '../../store/dataset-store'
import { useUIStore } from '../../store/ui-store'
import { normalizeRange, type CellRange } from './cell-selection'
import { findMatches, findStartIndex, type MatchPosition, type SearchOptions } from './find-replace'
import { ROW_NUM_COL_ID } from './constants'
import { isRealCellFocused } from './use-cell-selection'
import type { CommitResult } from './use-formulas'

/** Alt+↓ (B3) "pick from list" dropdown state — anchored at the focused cell. */
export interface ValueDropdownState {
  x: number
  y: number
  items: { display: string; raw: CellValue }[]
  dbRow: number
  col: number
}

/** Ctrl+Shift+V Paste Special menu (B4) state — anchored at the focused cell. */
export interface PasteSpecialMenuState {
  x: number
  y: number
  row: number
  col: number
}

export interface UseDataViewShortcutsParams {
  gridApiRef: React.RefObject<GridApi<CellValue[]> | null>
  allRowsRef: React.RefObject<CellValue[][]>
  rowsRef: React.RefObject<CellValue[][]>
  rangesRef: React.RefObject<CellRange[]>
  visibleToOriginalIndexRef: React.RefObject<number[]>
  variables: Variable[]
  showValueLabels: boolean
  setHiddenColIds: React.Dispatch<React.SetStateAction<Set<string>>>
  openFind: (showReplace: boolean) => void
  clearFormatOnSelection: () => void
  insertRow: (visibleRow: number, position: 'above' | 'below') => void
  deleteRows: (visibleRows: number[]) => void
  goToMatch: (index: number, matchList: MatchPosition[]) => void
  searchTermRef: React.RefObject<string>
  searchOptionsRef: React.RefObject<SearchOptions>
  setCurrentMatchIndex: (index: number) => void
  setMatches: (matches: MatchPosition[]) => void
  commitCellInput: (dbRow: number, colIndex: number, raw: string) => CommitResult
  applyCommittedValue: (dbRow: number, colIndex: number, display: CellValue) => void
}

export function useDataViewShortcuts(params: UseDataViewShortcutsParams) {
  const {
    gridApiRef,
    allRowsRef,
    rowsRef,
    rangesRef,
    visibleToOriginalIndexRef,
    variables,
    showValueLabels,
    setHiddenColIds,
    openFind,
    clearFormatOnSelection,
    insertRow,
    deleteRows,
    goToMatch,
    searchTermRef,
    searchOptionsRef,
    setCurrentMatchIndex,
    setMatches,
    commitCellInput,
    applyCommittedValue
  } = params

  // Alt+↓ column-value dropdown (B3) — pick an existing value from the column.
  const [valueDropdown, setValueDropdown] = useState<ValueDropdownState | null>(null)
  // Ctrl+Shift+V Paste Special menu (B4) — anchored at the focused cell.
  const [pasteSpecialMenu, setPasteSpecialMenu] = useState<PasteSpecialMenuState | null>(null)

  // Alt+↓ (B3): open a dropdown of the focused column's existing distinct
  // values (Excel/Sheets "pick from list"). Selecting one enters it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUIStore.getState().activeTab !== 'data') return
      if (!e.altKey || e.key !== 'ArrowDown') return
      const api = gridApiRef.current
      if (!api) return
      // isRealCellFocused() — see use-cell-selection.ts's doc comment; this
      // listener is always-on, so a stale gridApi.getFocusedCell() after a
      // header-only selection would open the dropdown for the wrong column.
      const focused = isRealCellFocused() ? api.getFocusedCell() : null
      if (!focused || typeof focused.rowIndex !== 'number') return
      const colId = focused.column.getColId()
      if (colId === ROW_NUM_COL_ID) return
      const freshVars = useDatasetStore.getState().variables
      const col = freshVars.findIndex(v => v.colId === colId)
      const variable = freshVars[col]
      if (col < 0 || !variable) return
      e.preventDefault()
      const seen = new Set<string>()
      const items: { display: string; raw: CellValue }[] = []
      for (const row of allRowsRef.current) {
        const raw = row[col] ?? null
        if (raw === null || raw === '') continue
        const key = String(raw)
        if (seen.has(key)) continue
        seen.add(key)
        items.push({ display: formatCellDisplay(raw, variable, showValueLabels), raw })
        if (items.length >= 30) break
      }
      if (items.length === 0) return
      const cellEl = document.querySelector('.ag-cell-focus')
      const rect = cellEl?.getBoundingClientRect()
      const dbRow = toDbRow(focused.rowIndex, visibleToOriginalIndexRef.current)
      setValueDropdown({
        x: rect?.left ?? 120,
        y: rect ? rect.bottom : 120,
        items,
        dbRow,
        col
      })
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [gridApiRef, allRowsRef, showValueLabels, visibleToOriginalIndexRef])

  const selectDropdownValue = useCallback(
    (dbRow: number, col: number, raw: CellValue) => {
      const { ok, display } = commitCellInput(dbRow, col, String(raw ?? ''))
      if (ok) applyCommittedValue(dbRow, col, display)
    },
    [commitCellInput, applyCommittedValue]
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (useUIStore.getState().activeTab !== 'data') return
      const isCtrl = e.ctrlKey || e.metaKey
      if (e.key === 'F4' && e.shiftKey) {
        // Shift+F4 (B6) — jump to the next match without reopening the bar,
        // reusing the last search term.
        e.preventDefault()
        const term = searchTermRef.current
        if (term === '') return
        const found = findMatches(
          term,
          rowsRef.current,
          variables,
          showValueLabels,
          searchOptionsRef.current
        )
        if (found.length === 0) return
        // isRealCellFocused() — see use-cell-selection.ts's doc comment;
        // this listener is always-on, so a stale gridApi.getFocusedCell()
        // after a header-only selection would jump from the wrong cell.
        const focused = isRealCellFocused() ? gridApiRef.current?.getFocusedCell() : null
        const fromRow = typeof focused?.rowIndex === 'number' ? focused.rowIndex : 0
        const fromColId = focused?.column.getColId()
        const fromCol = fromColId
          ? useDatasetStore.getState().variables.findIndex(v => v.colId === fromColId)
          : 0
        // Start strictly AFTER the current cell so repeated presses advance.
        const idx = findStartIndex(found, fromRow, Math.max(0, fromCol) + 1)
        setMatches(found)
        setCurrentMatchIndex(idx)
        goToMatch(idx, found)
        return
      }
      if (isCtrl && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openFind(false)
      } else if (isCtrl && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        openFind(true)
      } else if (isCtrl && e.key === '\\') {
        e.preventDefault()
        clearFormatOnSelection()
      } else if (isCtrl && (e.key === '+' || (e.shiftKey && e.code === 'Equal'))) {
        // Ctrl+Shift++ — insert a row above the focused row (Excel).
        e.preventDefault()
        const focused = isRealCellFocused() ? gridApiRef.current?.getFocusedCell() : null
        if (typeof focused?.rowIndex === 'number') insertRow(focused.rowIndex, 'above')
      } else if (isCtrl && !e.shiftKey && (e.key === '-' || e.code === 'Minus')) {
        // Ctrl+- — delete the selected rows.
        e.preventDefault()
        const rowSet = new Set<number>()
        for (const r of rangesRef.current) {
          const { top, bottom } = normalizeRange(r)
          for (let row = top; row <= bottom; row++) rowSet.add(row)
        }
        if (rowSet.size === 0) {
          const focused = isRealCellFocused() ? gridApiRef.current?.getFocusedCell() : null
          if (typeof focused?.rowIndex === 'number') rowSet.add(focused.rowIndex)
        }
        if (rowSet.size > 0) deleteRows([...rowSet].sort((a, b) => a - b))
      } else if (isCtrl && e.shiftKey && e.code === 'Digit0') {
        // Ctrl+Shift+0 — show all hidden columns.
        e.preventDefault()
        setHiddenColIds(new Set())
      } else if (isCtrl && !e.shiftKey && e.code === 'Digit0') {
        // Ctrl+0 — hide the focused column (blocked for the last visible one,
        // same guard as the context menu).
        e.preventDefault()
        const focused = isRealCellFocused() ? gridApiRef.current?.getFocusedCell() : null
        const colId = focused?.column.getColId()
        if (!colId || colId === ROW_NUM_COL_ID) return
        const freshVars = useDatasetStore.getState().variables
        setHiddenColIds(prev => {
          if (freshVars.length - prev.size <= 1) return prev
          return new Set(prev).add(colId)
        })
      } else if (isCtrl && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        const focused = isRealCellFocused() ? gridApiRef.current?.getFocusedCell() : null
        if (!focused || typeof focused.rowIndex !== 'number') return
        const colId = focused.column.getColId()
        if (colId === ROW_NUM_COL_ID) return
        const col = useDatasetStore.getState().variables.findIndex(v => v.colId === colId)
        if (col < 0) return
        const rect = document.querySelector('.ag-cell-focus')?.getBoundingClientRect()
        setPasteSpecialMenu({
          x: rect?.left ?? 120,
          y: rect ? rect.bottom : 120,
          row: focused.rowIndex,
          col
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [
    gridApiRef,
    openFind,
    clearFormatOnSelection,
    insertRow,
    deleteRows,
    rangesRef,
    rowsRef,
    variables,
    showValueLabels,
    goToMatch,
    searchTermRef,
    searchOptionsRef,
    setCurrentMatchIndex,
    setMatches,
    setHiddenColIds
  ])

  useEffect(() => {
    return window.api.on.menuCommand(channel => {
      if (channel === 'menu:edit:undo') performUndoRedo('undo')
      else if (channel === 'menu:edit:redo') performUndoRedo('redo')
    })
  }, [])

  return {
    valueDropdown,
    setValueDropdown,
    pasteSpecialMenu,
    setPasteSpecialMenu,
    selectDropdownValue
  }
}
