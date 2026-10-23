// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * use-cell-format.ts — cell formatting (bold/italic/underline/fonts/colors/
 * alignment) for DataView, wired Ribbon → current selection via
 * grid-bridge-store's `applyCellFormat` (extracted from DataView.tsx; no
 * behaviour change).
 *
 * Cells are keyed by stable DB row id ("r{dbRowIndex}", matching
 * getRowId/assignRowId in DataView) so formatting survives sort/filter
 * reorder — same identity convention T3 already uses for editing. Persisted
 * only via dataset-store's customStyles blob (no per-edit IPC channel —
 * matches how customStyles has always round-tripped through .sdf save, see
 * file-actions.ts), so a format change needs an explicit Save like any other
 * unsaved change (isModified already covers this).
 */
import { useCallback, useEffect } from 'react'
import type { GridApi } from 'ag-grid-community'
import type { CellValue, CellFormat } from '@shared/data-types'
import { toDbRow } from '../../lib/data-grid'
import { useDatasetStore } from '../../store/dataset-store'
import { useGridBridgeStore } from '../../store/grid-bridge-store'
import type { CaseIdentity } from './case-identity'
import { normalizeRange, type CellRange } from './cell-selection'
import { ROW_NUM_COL_ID } from './constants'
import { isRealCellFocused } from './use-cell-selection'

export interface UseCellFormatParams {
  gridApiRef: React.RefObject<GridApi<CellValue[]> | null>
  rangesRef: React.RefObject<CellRange[]>
  visibleToOriginalIndexRef: React.RefObject<number[]>
  caseIdentity: CaseIdentity
}

export function useCellFormat(params: UseCellFormatParams) {
  const { gridApiRef, rangesRef, visibleToOriginalIndexRef, caseIdentity } = params

  /** Re-publishes the active cell's format to grid-bridge-store — drives
   *  the Ribbon's active-state indicators (bold highlighted, color swatches,
   *  font/size/number-format values). Called on focus change and right
   *  after a format is applied (the focused cell doesn't change on a
   *  Ribbon click, so its indicators need an explicit refresh too).
   *
   *  Prefers the genuinely focused cell (covers plain arrow-key navigation,
   *  which never touches rangesRef) and falls back to the current range
   *  selection's top-left cell otherwise. That fallback is what a column/
   *  row-header click needs — it selects via rangesRef without ever
   *  focusing a real AG cell, so a version of this that only ever read
   *  `gridApi.getFocusedCell()` published `null` for every header
   *  selection. The Ribbon's Bold button computes its next patch as
   *  `{ bold: !activeCellFormat?.bold }`, so a permanently-null
   *  activeCellFormat meant `!undefined` → always `true`: clicking Bold on
   *  a header-selected column could only ever turn bold ON, never back off. */
  const publishActiveCellFormat = useCallback(() => {
    const api = gridApiRef.current
    const freshVars = useDatasetStore.getState().variables
    let dbRow: number | undefined
    let colId: string | undefined

    if (api && isRealCellFocused()) {
      const focused = api.getFocusedCell()
      if (focused && typeof focused.rowIndex === 'number') {
        const fColId = focused.column.getColId()
        if (fColId !== ROW_NUM_COL_ID) {
          dbRow = toDbRow(focused.rowIndex, visibleToOriginalIndexRef.current)
          colId = fColId
        }
      }
    }

    if (dbRow === undefined || colId === undefined) {
      const last = rangesRef.current[rangesRef.current.length - 1]
      if (last) {
        const { top, left } = normalizeRange(last)
        const variable = freshVars[left]
        if (variable) {
          dbRow = toDbRow(top, visibleToOriginalIndexRef.current)
          colId = variable.colId
        }
      }
    }

    if (dbRow === undefined || colId === undefined) {
      useGridBridgeStore.getState().setActiveCellFormat(null)
      return
    }
    const format =
      useDatasetStore.getState().customStyles?.cells?.[caseIdentity.keyOfDb(dbRow)]?.[colId] ?? null
    useGridBridgeStore.getState().setActiveCellFormat(format)
  }, [gridApiRef, rangesRef, visibleToOriginalIndexRef, caseIdentity])

  const applyCellFormat = useCallback(
    (patch: CellFormat) => {
      const ranges = rangesRef.current
      if (ranges.length === 0) return
      const freshVars = useDatasetStore.getState().variables
      const existing = useDatasetStore.getState().customStyles
      const nextCells: Record<string, Record<string, CellFormat>> = { ...(existing?.cells ?? {}) }
      for (const range of ranges) {
        const { top, bottom, left, right } = normalizeRange(range)
        for (let r = top; r <= bottom; r++) {
          const dbRow = toDbRow(r, visibleToOriginalIndexRef.current)
          const rowId = caseIdentity.keyOfDb(dbRow)
          const rowCells: Record<string, CellFormat> = { ...(nextCells[rowId] ?? {}) }
          for (let c = left; c <= right; c++) {
            const variable = freshVars[c]
            if (!variable) continue
            // numberFormat/currency are display-only (never change the
            // stored value or the variable's type — see CellFormatSchema's
            // doc comments) but only mean something on numeric data (SPSS/
            // Excel don't offer Currency/Percent/Scientific for a text
            // column either); drop them here rather than writing a dead
            // style attribute onto a non-numeric column's cells.
            const effectivePatch: CellFormat =
              ('numberFormat' in patch || 'currency' in patch) && variable.type !== 'numeric'
                ? Object.fromEntries(
                    Object.entries(patch).filter(([k]) => k !== 'numberFormat' && k !== 'currency')
                  )
                : patch
            if (Object.keys(effectivePatch).length === 0) continue
            const updated: CellFormat = { ...(rowCells[variable.colId] ?? {}), ...effectivePatch }
            for (const key of Object.keys(effectivePatch)) {
              if (
                effectivePatch[key] === undefined ||
                effectivePatch[key] === null ||
                effectivePatch[key] === ''
              ) {
                Reflect.deleteProperty(updated, key)
              }
            }
            if (Object.keys(updated).length === 0) {
              Reflect.deleteProperty(rowCells, variable.colId)
            } else {
              rowCells[variable.colId] = updated
            }
          }
          if (Object.keys(rowCells).length === 0) {
            Reflect.deleteProperty(nextCells, rowId)
          } else {
            nextCells[rowId] = rowCells
          }
        }
      }
      useDatasetStore.getState().setCustomStyles({ cells: nextCells })
      useDatasetStore.getState().setModified(true)
      gridApiRef.current?.refreshCells({ force: true })
      publishActiveCellFormat()
    },
    [gridApiRef, rangesRef, visibleToOriginalIndexRef, caseIdentity, publishActiveCellFormat]
  )

  // Ctrl+\ (B4): clear visual formatting on the selected cells (keeps the
  // value and any formula — only bold/color/align/number-format etc. go).
  const clearFormatOnSelection = useCallback(() => {
    const ranges = rangesRef.current
    if (ranges.length === 0) return
    const existing = useDatasetStore.getState().customStyles
    if (!existing?.cells) return
    const cells: Record<string, Record<string, CellFormat>> = { ...existing.cells }
    const freshVars = useDatasetStore.getState().variables
    let changed = false
    for (const range of ranges) {
      const { top, bottom, left, right } = normalizeRange(range)
      for (let r = top; r <= bottom; r++) {
        const dbRow = toDbRow(r, visibleToOriginalIndexRef.current)
        const rowId = caseIdentity.keyOfDb(dbRow)
        const rowCells = cells[rowId]
        if (!rowCells) continue
        const nextRowCells = { ...rowCells }
        for (let c = left; c <= right; c++) {
          const variable = freshVars[c]
          if (!variable) continue
          const cell = nextRowCells[variable.colId]
          if (!cell) continue
          // Keep only the formula (not a visual format); drop everything else.
          if (cell.formula !== undefined) nextRowCells[variable.colId] = { formula: cell.formula }
          else Reflect.deleteProperty(nextRowCells, variable.colId)
          changed = true
        }
        cells[rowId] = nextRowCells
      }
    }
    if (changed) {
      useDatasetStore.getState().setCustomStyles({ cells })
      useDatasetStore.getState().setModified(true)
      gridApiRef.current?.refreshCells({ force: true })
      publishActiveCellFormat()
    }
  }, [gridApiRef, rangesRef, visibleToOriginalIndexRef, caseIdentity, publishActiveCellFormat])

  useEffect(() => {
    useGridBridgeStore.getState().setApplyCellFormat(applyCellFormat)
    return () => {
      useGridBridgeStore.getState().setApplyCellFormat(null)
    }
  }, [applyCellFormat])

  return { publishActiveCellFormat, applyCellFormat, clearFormatOnSelection }
}
