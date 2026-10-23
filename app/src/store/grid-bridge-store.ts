// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import type { GridApi } from 'ag-grid-community'
import type { CellValue, CellFormat } from '@shared/data-types'

/**
 * grid-bridge-store.ts — live bridges to the mounted DataView grid instance.
 * These are transient function references (registered on mount, cleared on
 * unmount), not persistent dataset data — kept out of dataset-store so that
 * store can later carry a structural undo history without snapshotting
 * volatile callbacks.
 *
 * Renamed from an earlier grid-bridge module (aggrid-gecis-roadmap.md
 * follow-up): the old per-cell command/format fields are gone —
 * `applyCellFormat`/`activeCellFormat` are the real, AG-Grid-native
 * replacement (DataView registers `applyCellFormat`, writes into
 * `dataset-store`'s `customStyles` and repaints via `gridApi.refreshCells()`;
 * Ribbon just calls it).
 */

interface GridBridgeState {
  /** The live AG Grid API, set on grid-ready / cleared on unmount — used by
   *  the Ribbon's Undo/Redo buttons to fall back to cell-edit undo when
   *  there's no structural (DB-snapshot) history to pop, and by format
   *  commands to repaint after writing into customStyles. */
  gridApi: GridApi<CellValue[]> | null
  /** Applies a format patch to the current cell selection (registered by
   *  DataView on mount — merges into dataset-store's customStyles, repaints
   *  via gridApi.refreshCells()). Null when no DataView is mounted/editable. */
  applyCellFormat: ((patch: CellFormat) => void) | null
  /** Format of the currently focused cell, published by DataView whenever
   *  focus changes — drives the Ribbon's active-state indicators (bold
   *  highlighted, font/size dropdown values, etc). */
  activeCellFormat: CellFormat | null
  /** Opens the DataView find/replace bar (registered by DataView on mount) —
   *  lets the Ribbon's search button trigger the same panel Ctrl+F does. */
  openFind: ((showReplace: boolean) => void) | null
  /** Pops one step of use-cell-selection.ts's own cell-VALUE undo/redo stack
   *  (registered by DataView on mount) — the real handler for Ctrl+Z/Ctrl+Y
   *  on cell edits, now that AG Grid's own `undoRedoCellEditing` never sees
   *  the bulk accelerators (Delete-clear, fill, paste, broadcast) this app
   *  adds on top of it. Returns whether a step actually existed to pop.
   *  dataset-undo.ts's performUndoRedo() is the sole caller. */
  undoValueEdit: (() => boolean) | null
  redoValueEdit: (() => boolean) | null
  /** Number of distinct cells in the current DataView selection (overlapping
   *  Ctrl-added ranges counted once) — published by use-cell-selection.ts on
   *  every highlight refresh, shown in the app StatusBar. 0 = no selection. */
  selectedCellCount: number

  setGridApi: (api: GridApi<CellValue[]> | null) => void
  setApplyCellFormat: (fn: ((patch: CellFormat) => void) | null) => void
  setActiveCellFormat: (format: CellFormat | null) => void
  setOpenFind: (fn: ((showReplace: boolean) => void) | null) => void
  setUndoValueEdit: (fn: (() => boolean) | null) => void
  setRedoValueEdit: (fn: (() => boolean) | null) => void
  setSelectedCellCount: (count: number) => void
}

export const useGridBridgeStore = create<GridBridgeState>()(set => ({
  gridApi: null,
  applyCellFormat: null,
  activeCellFormat: null,
  openFind: null,
  undoValueEdit: null,
  redoValueEdit: null,
  selectedCellCount: 0,

  setGridApi: gridApi => {
    set({ gridApi })
  },
  setApplyCellFormat: applyCellFormat => {
    set({ applyCellFormat })
  },
  setActiveCellFormat: activeCellFormat => {
    set({ activeCellFormat })
  },
  setOpenFind: openFind => {
    set({ openFind })
  },
  setUndoValueEdit: undoValueEdit => {
    set({ undoValueEdit })
  },
  setRedoValueEdit: redoValueEdit => {
    set({ redoValueEdit })
  },
  setSelectedCellCount: selectedCellCount => {
    set({ selectedCellCount })
  }
}))
