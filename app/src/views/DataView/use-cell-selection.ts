// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * use-cell-selection.ts — mouse/keyboard range selection + copy/paste for
 * DataView's AG Grid Community instance (aggrid-gecis-roadmap.md G4 / T5/T6).
 *
 * Built entirely on Community's public cell-mouse/cell-key events —
 * `CellSelectionModule` (the Enterprise feature this replaces) is never
 * imported (T7 — see eslint restriction). Framework-free, unit-tested
 * modules sit underneath this hook, which is just the thin AG-Grid-specific
 * wiring layer on top of them: the range model + TSV/fill-series logic
 * (cell-selection.ts), the cell-VALUE undo/redo stack (cell-value-undo.ts),
 * the fill handle's hit-test/drag geometry (fill-handle.ts), the internal
 * copy/paste format snapshot (internal-clipboard.ts), and keyboard-nav
 * geometry (cell-keyboard-nav.ts). Shared types live in
 * cell-selection-types.ts (FormulaOps/UseCellSelectionParams are re-exported
 * below so existing imports from this file keep working).
 */
import { useCallback, useRef, useEffect, useState } from 'react'
import type {
  CellMouseDownEvent,
  CellMouseOverEvent,
  CellClickedEvent,
  CellKeyDownEvent,
  CellClassParams,
  FullWidthCellKeyDownEvent
} from 'ag-grid-community'
import type { CellValue, CellFormat } from '@shared/data-types'
import { useDatasetStore } from '../../store/dataset-store'
import { useGridBridgeStore } from '../../store/grid-bridge-store'
import { useUIStore } from '../../store/ui-store'
import { toDbRow, findDataEdge, makeUniqueVarName, type ParsedAddress } from '../../lib/data-grid'
import { prepareCellEdit } from '../../lib/aggrid-data'
import { readClipboardHtml, parseHtmlClipboardGrid } from '../../lib/html-clipboard'
import { cx } from '../../lib/cx'
import {
  anyRangeContains,
  normalizeRange,
  subtractFromRanges,
  buildClipboardTextForSelection,
  parseClipboardText,
  transposeGrid,
  computeFillValue,
  cellsFromRanges,
  countCellsInRanges,
  type CellRange
} from './cell-selection'
import { CellValueUndoStack, type CellEditEntry } from './cell-value-undo'
import { performUndoRedo } from '../../lib/dataset-undo'
import { ROW_NUM_COL_ID, NEW_PASTE_COLUMN_TEMPLATE } from './constants'
import { hitsFillHandle, computeFillPreviewRect, computeFillDirection } from './fill-handle'
import {
  snapshotCopiedCells,
  transferClipboardStyles,
  type InternalClip,
  type ClipboardStyleSource
} from './internal-clipboard'
import { nextRangeCorner, nextCellInRange, extendFocusByArrow } from './cell-keyboard-nav'
import type { CopiedMark, SelectionMode, UseCellSelectionParams } from './cell-selection-types'
import styles from './DataView.module.css'

export type { FormulaOps, UseCellSelectionParams } from './cell-selection-types'

/**
 * The one reliable way to ask "does a real grid cell currently hold
 * keyboard focus?" — `gridApi.getFocusedCell()` is NOT it: that API keeps
 * returning the LAST cell AG Grid ever focused even long after focus has
 * moved elsewhere, because clicking a column/row header (ColumnHeader.tsx's
 * own onClick) never touches a real AG cell and so never clears it. Any
 * always-on keyboard handler (a global `window` keydown listener, or a
 * shared dispatcher called from one) that reads `getFocusedCell()` without
 * this check first will act on a stale cell after a header-only selection —
 * confirmed to actually happen for plain paste (Ctrl+V landed at an old
 * cell instead of the newly header-selected column) and, by the same
 * mechanism, latent in every other always-on branch that does the same
 * thing (Shift+F4, Ctrl+Shift++, Ctrl+-, Ctrl+0, Ctrl+Shift+V, the Ribbon's
 * active-format indicator). A real `cellKeyDown`/`onCellFocused` event
 * doesn't need this guard — the event itself guarantees genuine focus.
 */
export function isRealCellFocused(): boolean {
  return !!document.activeElement?.closest('.ag-cell')
}

/** Publishes the selection's distinct-cell count to the app StatusBar.
 *  Called from refreshHighlight and from the few sites (context menu, find)
 *  that replace `rangesRef` and repaint via `refreshCells` directly. */
export function publishSelectionCount(ranges: CellRange[]): void {
  const count = countCellsInRanges(ranges)
  const store = useGridBridgeStore.getState()
  if (store.selectedCellCount !== count) store.setSelectedCellCount(count)
}

export function useCellSelection(params: UseCellSelectionParams) {
  const {
    gridApiRef,
    rowsRef,
    visibleToOriginalIndexRef,
    caseIdentity,
    variables,
    showValueLabels,
    isChunkLoadingRef,
    warnCell,
    t,
    formulaOps
  } = params

  const rangesRef = useRef<CellRange[]>([])
  const isDraggingRef = useRef(false)
  /** Set while dragging FROM the fill handle rather than drawing a new
   *  selection. Holds the range being filled FROM (frozen at drag-start —
   *  `rangesRef`'s last entry is temporarily repurposed to show the live
   *  fill preview, then the actual fill is computed from this frozen copy
   *  on drop). */
  const fillSourceRef = useRef<CellRange | null>(null)

  // ── Copy/cut marching-ants mark (B4) ───────────────────────────────────
  // The range last copied (isCut=false) or cut (isCut=true), shown with a
  // dashed frame. A cut clears its source cells once pasted. Cleared on Esc,
  // on paste (cut), or when a new copy/cut is made.
  const copiedMarkRef = useRef<CopiedMark | null>(null)

  /** Internal clipboard captured on copy/cut (B4). The OS clipboard only
   *  carries TSV text, so "paste format" / "paste formula" would be impossible
   *  without this: it snapshots each copied cell's visual format and (stable,
   *  db-form) formula alongside its value. Plain value pastes still read the
   *  OS clipboard, so pasting from other apps keeps working. */
  const internalClipRef = useRef<InternalClip | null>(null)

  // ── Cell-VALUE undo/redo (cell-value-undo.ts) ──────────────────────────
  // AG Grid's own `undoRedoCellEditing` only records edits that flow through
  // its own valueSetter/setValue cycle — every bulk accelerator this hook
  // implements (Delete-clear, Ctrl+D/R fill, Ctrl+Enter broadcast, paste)
  // mutates rowsRef directly and never touches that cycle, so none of them
  // were ever undoable, and Ctrl+Z's grid-level fallback (Ribbon.tsx's old
  // undoRedo()) silently popped whatever unrelated single-cell edit happened
  // to be on that stack instead — the exact "only one cell came back" /
  // "two separate clears got undone together" bugs. The stack below is a
  // from-scratch one that both this hook's bulk writes AND DataView's own
  // valueSetter (a single interactive edit = a one-entry batch) push onto, so
  // Ctrl+Z always undoes exactly the one operation that was last performed,
  // in true chronological order across both sources.
  const undoStackRef = useRef(new CellValueUndoStack())

  // ── Selection mode (F8 / Shift+F8, B1 — see SelectionMode in
  // cell-selection-types.ts for the three modes' meanings) ─────────────────
  // Kept in a ref (read by the mouse handlers, which must see the current
  // value without a stale closure) and mirrored to state (drives the
  // status-bar indicator in DataView).
  const [selectionMode, setSelectionModeState] = useState<SelectionMode>('normal')
  const selectionModeRef = useRef<SelectionMode>('normal')
  const setSelectionMode = useCallback((m: SelectionMode) => {
    selectionModeRef.current = m
    setSelectionModeState(m)
  }, [])

  /** Moves AG Grid's focused cell to a data (row, col), scrolling it into
   *  view. `col` is a data-column index (row-number column excluded). */
  const focusCell = useCallback(
    (row: number, col: number) => {
      const api = gridApiRef.current
      if (!api) return
      const variable = variables[col]
      if (!variable) return
      api.ensureIndexVisible(row)
      api.ensureColumnVisible(variable.colId)
      api.setFocusedCell(row, variable.colId)
    },
    [gridApiRef, variables]
  )

  /** Reads the current focused cell as a plain (row, dataCol) pair, or null
   *  when nothing / the row-number column is focused. */
  const getFocusedRC = useCallback((): { row: number; col: number } | null => {
    const focused = gridApiRef.current?.getFocusedCell()
    if (!focused || typeof focused.rowIndex !== 'number') return null
    const col = (focused.column.getColDef() as { dataColIndex?: number }).dataColIndex
    if (col === undefined || col < 0) return null
    return { row: focused.rowIndex, col }
  }, [gridApiRef])

  const refreshHighlight = useCallback(() => {
    const api = gridApiRef.current
    if (api) {
      const lastCol = variables.length - 1
      const selectedRowSet = new Set<number>()
      if (lastCol >= 0) {
        for (const r of rangesRef.current) {
          const { top, bottom, left, right } = normalizeRange(r)
          if (left === 0 && right === lastCol) {
            for (let row = top; row <= bottom; row++) selectedRowSet.add(row)
          }
        }
      }
      api.forEachNode(node => {
        if (node.rowIndex !== null) {
          const isRowSel = selectedRowSet.has(node.rowIndex)
          if (node.isSelected() !== isRowSel) {
            node.setSelected(isRowSel, false)
          }
        }
      })
      api.refreshCells({ force: true })
    }
    publishSelectionCount(rangesRef.current)
  }, [gridApiRef, variables.length])

  // DataView unmounted (tab switch keeps it mounted; this is a real teardown)
  // → no live selection left to count.
  useEffect(
    () => () => {
      useGridBridgeStore.getState().setSelectedCellCount(0)
    },
    []
  )

  /** Plain (row, col) predicates — used both from `cellClass` callbacks
   *  (via the small wrappers below, which unwrap AG Grid's CellClassParams)
   *  and directly from mouse handlers, where there's no CellClassParams to
   *  begin with. */
  const isCellSelectedAt = useCallback(
    (rowIndex: number, colIndex: number) => anyRangeContains(rangesRef.current, rowIndex, colIndex),
    []
  )

  const isFillHandleAnchorAt = useCallback((rowIndex: number, colIndex: number) => {
    const last = rangesRef.current[rangesRef.current.length - 1]
    if (!last) return false
    const { bottom, right } = normalizeRange(last)
    return rowIndex === bottom && colIndex === right
  }, [])

  /** `cellClassRules`-style function bound to one column's dataColIndex —
   *  colDefs pass `colIndex` in via closure at colDef-build time. */
  const isCellSelected = useCallback(
    (colIndex: number, p: CellClassParams<CellValue[]>) =>
      p.node.rowIndex !== null && isCellSelectedAt(p.node.rowIndex, colIndex),
    [isCellSelectedAt]
  )

  /** True for the single cell at the bottom-right corner of the most recent
   *  range — where the fill-handle square is drawn (DataView.module.css). */
  const isFillHandleAnchor = useCallback(
    (colIndex: number, p: CellClassParams<CellValue[]>) =>
      p.node.rowIndex !== null && isFillHandleAnchorAt(p.node.rowIndex, colIndex),
    [isFillHandleAnchorAt]
  )

  // ── Copy/cut marching-ants mark helpers (B4) ───────────────────────────
  const setCopiedMark = useCallback(
    (ranges: CellRange[], isCut: boolean, tsv: string) => {
      if (ranges.length === 0) return
      let top = Infinity
      let bottom = -1
      let left = Infinity
      let right = -1
      for (const r of ranges) {
        const n = normalizeRange(r)
        top = Math.min(top, n.top)
        bottom = Math.max(bottom, n.bottom)
        left = Math.min(left, n.left)
        right = Math.max(right, n.right)
      }
      copiedMarkRef.current = { rect: { top, bottom, left, right }, isCut }
      // `tsv` is what the caller just put on the OS clipboard — see the
      // internalClipRef declaration for why it is stored with the snapshot.

      // Snapshot formats + formulas of the copied block for paste-special.
      const freshVars = useDatasetStore.getState().variables
      const styleCells = useDatasetStore.getState().customStyles?.cells
      const cells = snapshotCopiedCells(
        { top, bottom, left, right },
        freshVars,
        styleCells,
        caseIdentity,
        visibleToOriginalIndexRef.current
      )
      internalClipRef.current = { rows: bottom - top + 1, cols: right - left + 1, cells, tsv }

      gridApiRef.current?.refreshCells({ force: true })
    },
    [gridApiRef, visibleToOriginalIndexRef, caseIdentity]
  )

  const clearCopiedMark = useCallback(() => {
    if (!copiedMarkRef.current) return
    copiedMarkRef.current = null
    gridApiRef.current?.refreshCells({ force: true })
  }, [gridApiRef])

  /** Which sides of a cell lie on the copied-mark rectangle's perimeter (for
   *  the dashed marching-ants frame). Returns '' when the cell isn't on it. */
  const copiedEdgeClass = useCallback(
    (colIndex: number, p: CellClassParams<CellValue[]>): string => {
      const mark = copiedMarkRef.current
      const row = p.node.rowIndex
      if (!mark || row === null) return ''
      const { top, bottom, left, right } = mark.rect
      if (row < top || row > bottom || colIndex < left || colIndex > right) return ''
      return cx(
        styles.copiedCell,
        mark.isCut && styles.cutCell,
        row === top && styles.copiedTop,
        row === bottom && styles.copiedBottom,
        colIndex === left && styles.copiedLeft,
        colIndex === right && styles.copiedRight
      )
    },
    []
  )

  const startRange = useCallback((row: number, col: number, mode: 'replace' | 'add' | 'extend') => {
    if (mode === 'extend' && rangesRef.current.length > 0) {
      const last = rangesRef.current[rangesRef.current.length - 1]
      if (last) {
        last.focusRow = row
        last.focusCol = col
        return
      }
    }
    const next: CellRange = { anchorRow: row, anchorCol: col, focusRow: row, focusCol: col }
    if (mode === 'add') {
      // Ctrl/Cmd+click toggle-off (Excel/Sheets convention): clicking an
      // already-selected cell removes just that cell — regardless of
      // whether it's currently selected as its own range or as part of a
      // larger (e.g. Shift-extended) block, which subtractFromRanges splits.
      rangesRef.current = anyRangeContains(rangesRef.current, row, col)
        ? subtractFromRanges(rangesRef.current, { top: row, bottom: row, left: col, right: col })
        : [...rangesRef.current, next]
    } else {
      rangesRef.current = [next]
    }
  }, [])

  /** Row-header click (the pinned row-number column, `dataColIndex: -1`) —
   *  selects the entire row across all data columns, matching Excel's
   *  click-a-row-number behavior. Shift extends the last range to the
   *  clicked row (full width); Ctrl/Cmd adds a new discontiguous row range;
   *  a plain click replaces the selection — same three-mode convention
   *  `onCellMouseDown`/`startRange` already use for regular cell drags. */
  const selectRow = useCallback(
    (rowIndex: number, mode: 'replace' | 'add' | 'extend' = 'replace') => {
      const lastCol = variables.length - 1
      if (lastCol < 0) return
      if (mode === 'extend' && rangesRef.current.length > 0) {
        const last = rangesRef.current[rangesRef.current.length - 1]
        if (last) {
          last.anchorCol = 0
          last.focusCol = lastCol
          last.focusRow = rowIndex
          refreshHighlight()
          return
        }
      }
      const next: CellRange = {
        anchorRow: rowIndex,
        anchorCol: 0,
        focusRow: rowIndex,
        focusCol: lastCol
      }
      if (mode === 'add') {
        // Same toggle-off convention as startRange — checked via
        // anyRangeContains so it fires whether this row is selected on its
        // own or as part of a larger (Shift-extended) block.
        rangesRef.current = anyRangeContains(rangesRef.current, rowIndex, 0)
          ? subtractFromRanges(rangesRef.current, {
              top: rowIndex,
              bottom: rowIndex,
              left: 0,
              right: lastCol
            })
          : [...rangesRef.current, next]
      } else {
        rangesRef.current = [next]
      }
      refreshHighlight()
    },
    [variables.length, refreshHighlight]
  )

  /** Column-header click — selects the entire column across all currently
   *  displayed (post filter/sort) rows, matching Excel's click-a-column-
   *  letter behavior. Same replace/add/extend modes as `selectRow`. */
  const selectColumn = useCallback(
    (colIndex: number, mode: 'replace' | 'add' | 'extend' = 'replace') => {
      const lastRow = rowsRef.current.length - 1
      if (lastRow < 0) return
      if (mode === 'extend' && rangesRef.current.length > 0) {
        const last = rangesRef.current[rangesRef.current.length - 1]
        if (last) {
          last.anchorRow = 0
          last.focusRow = lastRow
          last.focusCol = colIndex
          refreshHighlight()
          return
        }
      }
      const next: CellRange = {
        anchorRow: 0,
        anchorCol: colIndex,
        focusRow: lastRow,
        focusCol: colIndex
      }
      if (mode === 'add') {
        rangesRef.current = anyRangeContains(rangesRef.current, 0, colIndex)
          ? subtractFromRanges(rangesRef.current, {
              top: 0,
              bottom: lastRow,
              left: colIndex,
              right: colIndex
            })
          : [...rangesRef.current, next]
      } else {
        rangesRef.current = [next]
      }
      refreshHighlight()
    },
    [rowsRef, refreshHighlight]
  )

  /** Row-number cell click → select the whole row (Excel convention). Wired
   *  as `onCellClicked` (not `onCellMouseDown`) because the row-number column
   *  carries AG Grid's native row-drag handle, which consumes mousedown for
   *  drag-detection; a genuine click still fires cellClicked afterwards.
   *  Data cells are handled by onCellMouseDown (range selection) instead. */
  const onCellClicked = useCallback(
    (e: CellClickedEvent<CellValue[]>) => {
      const colId = e.column.getColId()
      if (colId === ROW_NUM_COL_ID && e.rowIndex !== null) {
        const mouseEvent = e.event as MouseEvent | null
        const rowMode = mouseEvent?.shiftKey
          ? 'extend'
          : mouseEvent?.ctrlKey || mouseEvent?.metaKey
            ? 'add'
            : 'replace'
        selectRow(e.rowIndex, rowMode)
      }
    },
    [selectRow]
  )

  const onCellMouseDown = useCallback(
    (e: CellMouseDownEvent<CellValue[]>) => {
      const colIndex = (e.colDef as { dataColIndex?: number }).dataColIndex
      if (colIndex === undefined || e.rowIndex === null) return
      const mouseEvent = e.event as MouseEvent | null
      // Right-click (button 2) must never change the selection — Excel/
      // Sheets convention is "right-click inside the current multi-selection
      // keeps it as-is, so Copy from the context menu acts on the whole
      // selection"; only onCellContextMenu below (which checks whether the
      // click landed OUTSIDE the existing selection) is allowed to replace
      // it. Without this guard, mousedown fires before contextmenu and this
      // handler's own replace/add/extend logic collapsed any multi-row/
      // multi-cell selection down to the single right-clicked cell before
      // the menu even opened.
      if (mouseEvent && mouseEvent.button !== 0) return
      // Row-number column (colIndex < 0): do NOTHING on mousedown. AG Grid's
      // native row-drag handle lives on this cell and needs the mousedown for
      // drag-detection; selecting the row here would also collapse a
      // multi-row selection to one row *before* rowDragMultiRow reads it
      // (the multi-row-drag bug). Row selection is handled on click instead
      // (onCellClicked → selectRow), which fires only for a genuine click,
      // not a drag.
      if (colIndex < 0) return

      if (mouseEvent && isFillHandleAnchorAt(e.rowIndex, colIndex) && hitsFillHandle(mouseEvent)) {
        const last = rangesRef.current[rangesRef.current.length - 1]
        if (last) {
          fillSourceRef.current = { ...last }
          isDraggingRef.current = true
          return
        }
      }

      // Held modifiers win; otherwise a sticky F8/Shift+F8 mode applies
      // (extend → like Shift, add → like Ctrl), else a plain replace.
      const mode: 'extend' | 'add' | 'replace' = mouseEvent?.shiftKey
        ? 'extend'
        : mouseEvent?.ctrlKey || mouseEvent?.metaKey
          ? 'add'
          : selectionModeRef.current === 'extend'
            ? 'extend'
            : selectionModeRef.current === 'add'
              ? 'add'
              : 'replace'
      startRange(e.rowIndex, colIndex, mode)
      isDraggingRef.current = true
      refreshHighlight()
    },
    [startRange, refreshHighlight, isFillHandleAnchorAt]
  )

  const onCellMouseOver = useCallback(
    (e: CellMouseOverEvent<CellValue[]>) => {
      if (!isDraggingRef.current) return
      const colIndex = (e.colDef as { dataColIndex?: number }).dataColIndex
      if (colIndex === undefined || colIndex < 0 || e.rowIndex === null) return

      if (fillSourceRef.current) {
        // Fill-drag preview: extend the SOURCE range in whichever of the four
        // directions the cursor has overflowed the most (Excel constrains the
        // fill to one axis based on the dominant drag direction).
        const src = normalizeRange(fillSourceRef.current)
        const last = rangesRef.current[rangesRef.current.length - 1]
        if (!last) return
        const rect = computeFillPreviewRect(src, e.rowIndex, colIndex)
        last.anchorRow = rect.top
        last.anchorCol = rect.left
        last.focusRow = rect.bottom
        last.focusCol = rect.right
        refreshHighlight()
        return
      }

      const last = rangesRef.current[rangesRef.current.length - 1]
      if (!last) return
      if (last.focusRow === e.rowIndex && last.focusCol === colIndex) return
      last.focusRow = e.rowIndex
      last.focusCol = colIndex
      refreshHighlight()
    },
    [refreshHighlight]
  )

  /** Resets the value-undo history whenever the mounted dataset changes —
   *  entries key on visible-row/col position within ONE dataset's grid, so
   *  carrying them across a dataset switch would apply someone else's edit
   *  to the wrong file. */
  useEffect(() => {
    let lastId = useDatasetStore.getState().datasetId
    return useDatasetStore.subscribe(state => {
      if (state.datasetId !== lastId) {
        lastId = state.datasetId
        undoStackRef.current.reset()
      }
    })
  }, [])

  const recordBatch = useCallback((batch: CellEditEntry[]) => {
    undoStackRef.current.record(batch)
  }, [])

  /** Writes a batch's `prev*` (undo) or `next*` (redo) side back into
   *  rowsRef + DuckDB + formulas — the inverse of whatever originally
   *  produced the batch. Shared by undoLastEdit/redoLastEdit below. */
  const applyEntries = useCallback(
    (entries: CellEditEntry[], direction: 'undo' | 'redo') => {
      const dsId = useDatasetStore.getState().datasetId
      if (!dsId) return
      const updates: { rowIndex: number; colId: string; value: CellValue }[] = []
      let formulaTouched = false
      for (const entry of entries) {
        const rowArr = rowsRef.current[entry.visRow]
        if (!rowArr) continue
        const value = direction === 'undo' ? entry.prevValue : entry.nextValue
        const formula = direction === 'undo' ? entry.prevFormula : entry.nextFormula
        rowArr[entry.col] = value
        const dbRow = toDbRow(entry.visRow, visibleToOriginalIndexRef.current)
        updates.push({ rowIndex: dbRow, colId: entry.colId, value })
        if (formulaOps) {
          formulaOps.setCellFormula(dbRow, entry.colId, formula)
          formulaTouched = true
        }
      }
      if (updates.length > 0) {
        void window.api.data.updateCells({ datasetId: dsId, updates }).catch((err: unknown) => {
          console.error(`Cell-edit ${direction} persist failed:`, err)
        })
      }
      if (formulaTouched) formulaOps?.recomputeFormulas()
      gridApiRef.current?.refreshCells({ force: true })
    },
    [rowsRef, visibleToOriginalIndexRef, formulaOps, gridApiRef]
  )

  /** Ctrl+Z's sole handler for cell-value edits (grid-bridge-store wires this
   *  up for Ribbon/menu — see dataset-undo.ts). Returns whether a step was
   *  actually popped, so callers know the stack wasn't empty. */
  const undoLastEdit = useCallback((): boolean => {
    const batch = undoStackRef.current.popUndo()
    if (!batch) return false
    applyEntries(batch, 'undo')
    return true
  }, [applyEntries])

  const redoLastEdit = useCallback((): boolean => {
    const batch = undoStackRef.current.popRedo()
    if (!batch) return false
    applyEntries(batch, 'redo')
    return true
  }, [applyEntries])

  const applyFill = useCallback(() => {
    const source = fillSourceRef.current
    fillSourceRef.current = null
    if (!source) return false

    const filled = rangesRef.current[rangesRef.current.length - 1]
    if (!filled) return false
    const src = normalizeRange(source)
    const dst = normalizeRange(filled)

    // Exactly one axis/direction was extended in the preview (onCellMouseOver).
    const dir = computeFillDirection(src, dst)
    if (!dir) return false // dragged back inside — nothing to fill

    if (isChunkLoadingRef.current) {
      warnCell(t('dataset.editLockedWhileLoading'))
      return true
    }
    const dsId = useDatasetStore.getState().datasetId
    if (!dsId) return true
    const map = visibleToOriginalIndexRef.current

    const updates: { rowIndex: number; colId: string; value: CellValue }[] = []
    const batch: CellEditEntry[] = []
    // Held in an object, not two `let`s: `fillTargetCell` below sets them from
    // inside a closure, which TypeScript's control-flow analysis can't follow —
    // it keeps narrowing the locals to `false` and the linter then reports the
    // checks at the bottom as dead code.
    const flags = { hadFormula: false, rejected: false }

    /** Fills target cell (tr,tc) from the source EDGE cell (sr,sc): copies the
     *  edge's formula reference-shifted by (tr-sr, tc-sc), else the plain
     *  series/copy `value`. The plain value is validated against the TARGET
     *  column's type (prepareCellEdit) — a horizontal fill can cross columns
     *  of different types, and a string must not land in a numeric column
     *  (same rule as cell editing / paste). Invalid cells are skipped. */
    const fillTargetCell = (tr: number, tc: number, sr: number, sc: number, value: CellValue) => {
      const rowArr = rowsRef.current[tr]
      const variable = variables[tc]
      if (!rowArr || !variable) return
      const targetDb = toDbRow(tr, map)
      const srcVar = variables[sc]
      const srcFormula = srcVar
        ? formulaOps?.getCellFormula(toDbRow(sr, map), srcVar.colId)
        : undefined
      const prevValue = rowArr[tc] ?? null
      const prevFormula = formulaOps?.getCellFormula(targetDb, variable.colId) ?? null
      if (srcFormula && formulaOps) {
        const adjusted = formulaOps.shiftFormulaForFill(srcFormula, tr - sr, tc - sc)
        rowArr[tc] = formulaOps.applyFormulaToCell(targetDb, tc, adjusted)
        flags.hadFormula = true
        batch.push({
          visRow: tr,
          col: tc,
          colId: variable.colId,
          prevValue,
          nextValue: rowArr[tc] ?? null,
          prevFormula,
          nextFormula: adjusted
        })
      } else {
        const result = prepareCellEdit(
          value === null ? '' : String(value),
          variable,
          showValueLabels
        )
        if (!result.ok) {
          flags.rejected = true
          return
        }
        if (formulaOps?.getCellFormula(targetDb, variable.colId))
          formulaOps.setCellFormula(targetDb, variable.colId, null)
        rowArr[tc] = result.value
        updates.push({ rowIndex: targetDb, colId: variable.colId, value: result.value })
        batch.push({
          visRow: tr,
          col: tc,
          colId: variable.colId,
          prevValue,
          nextValue: result.value,
          prevFormula,
          nextFormula: null
        })
      }
    }

    if (dir === 'down' || dir === 'up') {
      for (let col = src.left; col <= src.right; col++) {
        const colValues: CellValue[] = []
        for (let r = src.top; r <= src.bottom; r++)
          colValues.push(rowsRef.current[r]?.[col] ?? null)
        if (dir === 'down') {
          for (let k = 0; k < dst.bottom - src.bottom; k++)
            fillTargetCell(src.bottom + 1 + k, col, src.bottom, col, computeFillValue(colValues, k))
        } else {
          const rev = [...colValues].reverse()
          for (let k = 0; k < src.top - dst.top; k++)
            fillTargetCell(src.top - 1 - k, col, src.top, col, computeFillValue(rev, k))
        }
      }
    } else {
      for (let row = src.top; row <= src.bottom; row++) {
        const rowValues: CellValue[] = []
        for (let c = src.left; c <= src.right; c++)
          rowValues.push(rowsRef.current[row]?.[c] ?? null)
        if (dir === 'right') {
          for (let k = 0; k < dst.right - src.right; k++)
            fillTargetCell(row, src.right + 1 + k, row, src.right, computeFillValue(rowValues, k))
        } else {
          const rev = [...rowValues].reverse()
          for (let k = 0; k < src.left - dst.left; k++)
            fillTargetCell(row, src.left - 1 - k, row, src.left, computeFillValue(rev, k))
        }
      }
    }

    if (flags.rejected) warnCell(t('dataset.numericInvalid'))
    if (updates.length > 0 || batch.length > 0) {
      void window.api.data.updateCells({ datasetId: dsId, updates }).catch((err: unknown) => {
        console.error('Fill persist failed:', err)
      })
      recordBatch(batch)
    }
    if (flags.hadFormula) formulaOps?.recomputeFormulas()
    gridApiRef.current?.refreshCells({ force: true })
    return true
  }, [
    gridApiRef,
    rowsRef,
    variables,
    visibleToOriginalIndexRef,
    isChunkLoadingRef,
    showValueLabels,
    warnCell,
    t,
    formulaOps,
    recordBatch
  ])

  /** Ctrl+D — Excel/Calc/Sheets' standard "fill down": copies the current
   *  selection's TOP row into every other row of the selection, per column
   *  (a plain copy, not a series continuation — matches real Ctrl+D, unlike
   *  the fill-handle drag which continues arithmetic/named series when the
   *  source spans ≥2 rows; passing a single-row source into the same
   *  `computeFillValue` naturally reduces to a plain copy here). */
  const fillDown = useCallback(() => {
    const last = rangesRef.current[rangesRef.current.length - 1]
    if (!last) return
    const { top, bottom, left, right } = normalizeRange(last)
    if (bottom <= top) return
    if (isChunkLoadingRef.current) {
      warnCell(t('dataset.editLockedWhileLoading'))
      return
    }
    const dsId = useDatasetStore.getState().datasetId
    if (!dsId) return

    const updates: { rowIndex: number; colId: string; value: CellValue }[] = []
    const batch: CellEditEntry[] = []
    let hadFormula = false
    for (let col = left; col <= right; col++) {
      const variable = variables[col]
      if (!variable) continue
      const srcDbRow = toDbRow(top, visibleToOriginalIndexRef.current)
      const srcFormula = formulaOps?.getCellFormula(srcDbRow, variable.colId)
      const sourceValue = rowsRef.current[top]?.[col] ?? null
      for (let r = top + 1; r <= bottom; r++) {
        const rowArr = rowsRef.current[r]
        if (!rowArr) continue
        const dbRow = toDbRow(r, visibleToOriginalIndexRef.current)
        const prevValue = rowArr[col] ?? null
        const prevFormula = formulaOps?.getCellFormula(dbRow, variable.colId) ?? null
        if (srcFormula && formulaOps) {
          const adjusted = formulaOps.shiftFormulaForFill(srcFormula, r - top, 0)
          rowArr[col] = formulaOps.applyFormulaToCell(dbRow, col, adjusted)
          hadFormula = true
          batch.push({
            visRow: r,
            col,
            colId: variable.colId,
            prevValue,
            nextValue: rowArr[col] ?? null,
            prevFormula,
            nextFormula: adjusted
          })
        } else {
          if (formulaOps?.getCellFormula(dbRow, variable.colId))
            formulaOps.setCellFormula(dbRow, variable.colId, null)
          rowArr[col] = sourceValue
          updates.push({ rowIndex: dbRow, colId: variable.colId, value: sourceValue })
          batch.push({
            visRow: r,
            col,
            colId: variable.colId,
            prevValue,
            nextValue: sourceValue,
            prevFormula,
            nextFormula: null
          })
        }
      }
    }
    if (updates.length > 0 || batch.length > 0) {
      void window.api.data.updateCells({ datasetId: dsId, updates }).catch((err: unknown) => {
        console.error('Fill down persist failed:', err)
      })
      recordBatch(batch)
    }
    if (hadFormula) formulaOps?.recomputeFormulas()
    gridApiRef.current?.refreshCells({ force: true })
  }, [
    gridApiRef,
    rowsRef,
    variables,
    visibleToOriginalIndexRef,
    isChunkLoadingRef,
    warnCell,
    t,
    formulaOps,
    recordBatch
  ])

  /** Ctrl+R — same as `fillDown` but copies the selection's LEFT column
   *  into every other column of the selection, per row. */
  const fillRight = useCallback(() => {
    const last = rangesRef.current[rangesRef.current.length - 1]
    if (!last) return
    const { top, bottom, left, right } = normalizeRange(last)
    if (right <= left) return
    if (isChunkLoadingRef.current) {
      warnCell(t('dataset.editLockedWhileLoading'))
      return
    }
    const dsId = useDatasetStore.getState().datasetId
    if (!dsId) return

    const updates: { rowIndex: number; colId: string; value: CellValue }[] = []
    const batch: CellEditEntry[] = []
    let hadFormula = false
    let rejected = false
    for (let r = top; r <= bottom; r++) {
      const rowArr = rowsRef.current[r]
      if (!rowArr) continue
      const dbRow = toDbRow(r, visibleToOriginalIndexRef.current)
      const srcVariable = variables[left]
      const srcFormula = srcVariable
        ? formulaOps?.getCellFormula(dbRow, srcVariable.colId)
        : undefined
      const sourceValue = rowArr[left] ?? null
      for (let col = left + 1; col <= right; col++) {
        const variable = variables[col]
        if (!variable) continue
        const prevValue = rowArr[col] ?? null
        const prevFormula = formulaOps?.getCellFormula(dbRow, variable.colId) ?? null
        if (srcFormula && formulaOps) {
          const adjusted = formulaOps.shiftFormulaForFill(srcFormula, 0, col - left)
          rowArr[col] = formulaOps.applyFormulaToCell(dbRow, col, adjusted)
          hadFormula = true
          batch.push({
            visRow: r,
            col,
            colId: variable.colId,
            prevValue,
            nextValue: rowArr[col] ?? null,
            prevFormula,
            nextFormula: adjusted
          })
        } else {
          // Ctrl+R crosses columns → validate against the target type.
          const result = prepareCellEdit(
            sourceValue === null ? '' : String(sourceValue),
            variable,
            showValueLabels
          )
          if (!result.ok) {
            rejected = true
            continue
          }
          if (formulaOps?.getCellFormula(dbRow, variable.colId))
            formulaOps.setCellFormula(dbRow, variable.colId, null)
          rowArr[col] = result.value
          updates.push({ rowIndex: dbRow, colId: variable.colId, value: result.value })
          batch.push({
            visRow: r,
            col,
            colId: variable.colId,
            prevValue,
            nextValue: result.value,
            prevFormula,
            nextFormula: null
          })
        }
      }
    }
    if (rejected) warnCell(t('dataset.numericInvalid'))
    if (updates.length > 0 || batch.length > 0) {
      void window.api.data.updateCells({ datasetId: dsId, updates }).catch((err: unknown) => {
        console.error('Fill right persist failed:', err)
      })
      recordBatch(batch)
    }
    if (hadFormula) formulaOps?.recomputeFormulas()
    gridApiRef.current?.refreshCells({ force: true })
  }, [
    gridApiRef,
    rowsRef,
    variables,
    visibleToOriginalIndexRef,
    isChunkLoadingRef,
    showValueLabels,
    warnCell,
    t,
    formulaOps,
    recordBatch
  ])

  // ── Data-entry accelerators (B3) ────────────────────────────────────────
  /** Writes a plain value into a set of visible cells (clearing any formula on
   *  each), persists, and recomputes — the shared core of Ctrl+Enter /
   *  Ctrl+; / Ctrl+' below. `raw` is per-cell so a broadcast (same value) and
   *  a copy (per-cell source) reuse it. */
  const writeToCells = useCallback(
    (cells: { visRow: number; col: number; raw: string }[]) => {
      if (cells.length === 0) return
      if (isChunkLoadingRef.current) {
        warnCell(t('dataset.editLockedWhileLoading'))
        return
      }
      const dsId = useDatasetStore.getState().datasetId
      if (!dsId) return
      const updates: { rowIndex: number; colId: string; value: CellValue }[] = []
      const batch: CellEditEntry[] = []
      let rejected = 0
      for (const { visRow, col, raw } of cells) {
        const variable = variables[col]
        const rowArr = rowsRef.current[visRow]
        if (!variable || !rowArr) continue
        const result = prepareCellEdit(raw, variable, showValueLabels)
        if (!result.ok) {
          rejected++
          continue
        }
        const dbRow = toDbRow(visRow, visibleToOriginalIndexRef.current)
        const prevValue = rowArr[col] ?? null
        const prevFormula = formulaOps?.getCellFormula(dbRow, variable.colId) ?? null
        if (prevValue === result.value && prevFormula === null) continue // genuinely a no-op
        rowArr[col] = result.value
        if (prevFormula !== null) formulaOps?.setCellFormula(dbRow, variable.colId, null)
        updates.push({ rowIndex: dbRow, colId: variable.colId, value: result.value })
        batch.push({
          visRow,
          col,
          colId: variable.colId,
          prevValue,
          nextValue: result.value,
          prevFormula,
          nextFormula: null
        })
      }
      if (rejected > 0) warnCell(t('dataset.numericInvalid'))
      if (updates.length > 0) {
        void window.api.data.updateCells({ datasetId: dsId, updates }).catch((err: unknown) => {
          console.error('Cell write failed:', err)
        })
        formulaOps?.recomputeFormulas()
        gridApiRef.current?.refreshCells({ force: true })
        recordBatch(batch)
      }
    },
    [
      gridApiRef,
      rowsRef,
      variables,
      visibleToOriginalIndexRef,
      isChunkLoadingRef,
      showValueLabels,
      warnCell,
      t,
      formulaOps,
      recordBatch
    ]
  )

  /** All distinct (visRow, col) cells across every current range. */
  const collectSelectedCells = useCallback(
    (): { visRow: number; col: number }[] => cellsFromRanges(rangesRef.current),
    []
  )

  /** Ctrl+Enter — broadcast the focused cell's value to every selected cell. */
  const broadcastToSelection = useCallback(() => {
    const rc = getFocusedRC()
    if (!rc) return
    const cells = collectSelectedCells()
    if (cells.length <= 1) return
    const raw = String(rowsRef.current[rc.row]?.[rc.col] ?? '')
    writeToCells(cells.map(c => ({ ...c, raw })))
  }, [getFocusedRC, collectSelectedCells, rowsRef, writeToCells])

  /** Ctrl+; / Ctrl+Shift+; / Ctrl+Alt+Shift+; — insert today's date / current
   *  time / date+time into the focused cell (locale-formatted). */
  const insertDateTime = useCallback(
    (mode: 'date' | 'time' | 'datetime') => {
      const rc = getFocusedRC()
      if (!rc) return
      const now = new Date()
      const raw =
        mode === 'date'
          ? now.toLocaleDateString()
          : mode === 'time'
            ? now.toLocaleTimeString()
            : `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`
      writeToCells([{ visRow: rc.row, col: rc.col, raw }])
    },
    [getFocusedRC, writeToCells]
  )

  /** Ctrl+' — copy the cell directly above into the focused cell. Excel's
   *  "exact copy" (no reference shift, unlike Ctrl+D): a formula above is
   *  copied verbatim (same stable references), else the plain value. */
  const copyFromAbove = useCallback(() => {
    const rc = getFocusedRC()
    if (!rc || rc.row === 0) return
    const variable = variables[rc.col]
    if (!variable) return
    if (isChunkLoadingRef.current) {
      warnCell(t('dataset.editLockedWhileLoading'))
      return
    }
    const aboveDb = toDbRow(rc.row - 1, visibleToOriginalIndexRef.current)
    const targetDb = toDbRow(rc.row, visibleToOriginalIndexRef.current)
    const aboveFormula = formulaOps?.getCellFormula(aboveDb, variable.colId)
    if (aboveFormula && formulaOps) {
      const display = formulaOps.applyFormulaToCell(targetDb, rc.col, aboveFormula)
      const rowArr = rowsRef.current[rc.row]
      if (rowArr) rowArr[rc.col] = display
      formulaOps.recomputeFormulas()
      gridApiRef.current?.refreshCells({ force: true })
      return
    }
    const aboveVal = rowsRef.current[rc.row - 1]?.[rc.col] ?? null
    writeToCells([{ visRow: rc.row, col: rc.col, raw: aboveVal === null ? '' : String(aboveVal) }])
  }, [
    getFocusedRC,
    variables,
    visibleToOriginalIndexRef,
    isChunkLoadingRef,
    rowsRef,
    gridApiRef,
    formulaOps,
    writeToCells,
    warnCell,
    t
  ])

  /** Fill-handle double-click (B3): auto-fill the selection down to the length
   *  of the adjacent column's data (left neighbour, else right) — Excel's
   *  "double-click the fill handle" behaviour. Reuses the drag fill machinery
   *  (formula-aware, series-aware) by framing the auto-extent as a fill drag. */
  const autoFillDown = useCallback(() => {
    const last = rangesRef.current[rangesRef.current.length - 1]
    if (!last) return
    const src = normalizeRange(last)
    const neighborCol = src.left > 0 ? src.left - 1 : src.right + 1
    if (neighborCol < 0 || neighborCol >= variables.length) return
    let endRow = src.bottom
    for (let r = src.bottom + 1; r < rowsRef.current.length; r++) {
      const v = rowsRef.current[r]?.[neighborCol] ?? null
      if (v === null || v === '') break
      endRow = r
    }
    if (endRow <= src.bottom) return // neighbour has no further data
    fillSourceRef.current = {
      anchorRow: src.top,
      anchorCol: src.left,
      focusRow: src.bottom,
      focusCol: src.right
    }
    rangesRef.current[rangesRef.current.length - 1] = {
      anchorRow: src.top,
      anchorCol: src.left,
      focusRow: endRow,
      focusCol: src.right
    }
    applyFill()
    refreshHighlight()
  }, [variables.length, rowsRef, applyFill, refreshHighlight])

  /** True (and triggers an auto-fill) if a double-click landed on the fill
   *  handle of the current selection's anchor cell — so DataView can cancel
   *  the edit AG Grid would otherwise start. */
  const tryAutoFillFromHandle = useCallback(
    (mouseEvent: MouseEvent, rowIndex: number, colIndex: number): boolean => {
      if (!isFillHandleAnchorAt(rowIndex, colIndex) || !hitsFillHandle(mouseEvent)) return false
      autoFillDown()
      return true
    },
    [isFillHandleAnchorAt, autoFillDown]
  )

  const stopDragging = useCallback(() => {
    if (fillSourceRef.current) applyFill()
    isDraggingRef.current = false
  }, [applyFill])

  const getEffectiveRanges = useCallback((): CellRange[] => {
    if (rangesRef.current.length > 0) {
      return rangesRef.current
    }
    const api = gridApiRef.current
    if (api && variables.length > 0) {
      const selectedNodes = api.getSelectedNodes()
      if (selectedNodes.length > 0) {
        const lastCol = variables.length - 1
        const rowRanges: CellRange[] = []
        for (const node of selectedNodes) {
          if (node.rowIndex !== null) {
            rowRanges.push({
              anchorRow: node.rowIndex,
              anchorCol: 0,
              focusRow: node.rowIndex,
              focusCol: lastCol
            })
          }
        }
        return rowRanges
      }
    }
    return []
  }, [gridApiRef, variables.length])

  /** Delete/Backspace — clear the value of every selected cell (Excel/Sheets
   *  convention: unlike a plain overtype, this never touches cell formatting,
   *  only the value/formula). Falls back to `getEffectiveRanges()` so a
   *  whole-row selection (native row nodes, no drawn range) clears too. */
  const clearSelectedCells = useCallback(() => {
    const ranges = getEffectiveRanges()
    if (ranges.length === 0) return
    writeToCells(cellsFromRanges(ranges).map(c => ({ ...c, raw: '' })))
  }, [getEffectiveRanges, writeToCells])

  /**
   * The internal clipboard snapshot — but only if the OS clipboard STILL holds
   * exactly the text it was captured with. Nothing notifies a web context that
   * another app took over the clipboard, so without this check a copy made in
   * SAI, followed by a copy in Excel, followed by a paste here would apply the
   * old SAI formats to the Excel values (denetim raporu §4.1). A mismatch
   * retires the snapshot outright, so the next paste doesn't re-check it.
   */
  const validInternalClip = useCallback((osText: string) => {
    const clip = internalClipRef.current
    if (!clip) return null
    if (clip.tsv !== osText) {
      internalClipRef.current = null
      return null
    }
    return clip
  }, [])

  // ── Copy / paste (T6) ───────────────────────────────────────────────────
  const copySelection = useCallback(() => {
    const rangesToCopy = getEffectiveRanges()
    if (rangesToCopy.length === 0) return
    const tsv = buildClipboardTextForSelection(
      rangesToCopy,
      rowsRef.current,
      variables,
      showValueLabels
    )
    void navigator.clipboard.writeText(tsv).catch((err: unknown) => {
      console.error('Clipboard write failed:', err)
    })
    setCopiedMark(rangesToCopy, false, tsv)
  }, [getEffectiveRanges, rowsRef, variables, showValueLabels, setCopiedMark])

  /** Ctrl+X — same as copy but marks the source as a cut: pasting clears the
   *  source cells (a move). Writes the same TSV to the clipboard, so a paste
   *  into another app still works (that just won't clear the source here). */
  const cutSelection = useCallback(() => {
    const rangesToCopy = getEffectiveRanges()
    if (rangesToCopy.length === 0) return
    const tsv = buildClipboardTextForSelection(
      rangesToCopy,
      rowsRef.current,
      variables,
      showValueLabels
    )
    void navigator.clipboard.writeText(tsv).catch((err: unknown) => {
      console.error('Clipboard write failed:', err)
    })
    setCopiedMark(rangesToCopy, true, tsv)
  }, [getEffectiveRanges, rowsRef, variables, showValueLabels, setCopiedMark])

  const pasteAtActiveCell = useCallback(
    (focusedRow: number, focusedCol: number) => {
      if (isChunkLoadingRef.current) {
        warnCell(t('dataset.editLockedWhileLoading'))
        return
      }
      const dsId = useDatasetStore.getState().datasetId
      if (!dsId) return

      void (async () => {
        let text: string
        let html: string | null
        try {
          ;[text, html] = await Promise.all([navigator.clipboard.readText(), readClipboardHtml()])
        } catch (err) {
          console.error('Clipboard read failed:', err)
          return
        }
        const grid = parseClipboardText(text)
        if (grid.length === 0) return

        // ── Grow the dataset to fit the pasted block ────────────────────────
        // Paste always targets from the focused cell down/right, so any
        // overflow is always at the bottom/right — never a mid-grid insert,
        // which keeps this an append-only operation on both axes.
        let activeVariables = variables
        const maxColsInGrid = grid.reduce((m, row) => Math.max(m, row.length), 0)
        const rowsNeeded = focusedRow + grid.length
        const colsNeeded = focusedCol + maxColsInGrid
        const colsToAdd = colsNeeded - activeVariables.length
        const rowsToAdd = rowsNeeded - rowsRef.current.length

        if (colsToAdd > 0) {
          try {
            const usedNames = new Set(activeVariables.map(v => v.name))
            for (let i = 0; i < colsToAdd; i++) {
              const name = makeUniqueVarName(usedNames)
              usedNames.add(name)
              activeVariables = await window.api.variable.add({
                datasetId: dsId,
                variable: { ...NEW_PASTE_COLUMN_TEMPLATE, name },
                index: activeVariables.length
              })
            }
            useDatasetStore.getState().setVariables(activeVariables)
          } catch (err) {
            console.error('Paste column growth failed:', err)
            warnCell(t('dataset.pasteGrowFailed'))
            return
          }
        }

        if (rowsToAdd > 0) {
          try {
            await window.api.data.appendRows({ datasetId: dsId, count: rowsToAdd })
            const s = useDatasetStore.getState()
            s.setRowCount(s.rowCount + rowsToAdd)
            s.bumpDataVersion()
            // rowsRef is rebuilt by DataView's own dataVersion-driven reload
            // effect, not by this hook — wait for that reload to actually
            // land the new rows before indexing into rows that don't exist
            // in the in-memory array yet.
            const deadline = Date.now() + 10_000
            while (rowsRef.current.length < rowsNeeded || isChunkLoadingRef.current) {
              if (Date.now() > deadline) {
                warnCell(t('dataset.pasteGrowFailed'))
                return
              }
              await new Promise(resolve => setTimeout(resolve, 30))
            }
          } catch (err) {
            console.error('Paste row growth failed:', err)
            warnCell(t('dataset.pasteGrowFailed'))
            return
          }
        }

        const updates: { rowIndex: number; colId: string; value: CellValue }[] = []
        const batch: CellEditEntry[] = []
        let rejectedCount = 0
        let maxColCount = 0

        for (let r = 0; r < grid.length; r++) {
          const targetRow = focusedRow + r
          const rowArr = rowsRef.current[targetRow]
          if (!rowArr) break
          const gridRow = grid[r]
          if (!gridRow) continue
          if (gridRow.length > maxColCount) maxColCount = gridRow.length
          for (let c = 0; c < gridRow.length; c++) {
            const targetCol = focusedCol + c
            const variable = activeVariables[targetCol]
            if (!variable) continue
            const raw = gridRow[c] ?? ''
            const result = prepareCellEdit(raw, variable, showValueLabels)
            if (!result.ok) {
              rejectedCount++
              continue
            }
            const dbRow = toDbRow(targetRow, visibleToOriginalIndexRef.current)
            const prevValue = rowArr[targetCol] ?? null
            const prevFormula = formulaOps?.getCellFormula(dbRow, variable.colId) ?? null
            rowArr[targetCol] = result.value
            // Pasting a plain value over a formula cell removes its formula
            // (else recompute would overwrite the pasted value).
            if (prevFormula !== null) formulaOps?.setCellFormula(dbRow, variable.colId, null)
            updates.push({ rowIndex: dbRow, colId: variable.colId, value: result.value })
            batch.push({
              visRow: targetRow,
              col: targetCol,
              colId: variable.colId,
              prevValue,
              nextValue: result.value,
              prevFormula,
              nextFormula: null
            })
          }
        }

        if (rejectedCount > 0) warnCell(t('dataset.numericInvalidCount', { count: rejectedCount }))
        if (updates.length === 0) return

        const actualRows = Math.min(grid.length, rowsRef.current.length - focusedRow)
        const actualCols = Math.min(maxColCount, activeVariables.length - focusedCol)
        if (actualRows > 0 && actualCols > 0) {
          rangesRef.current = [
            {
              anchorRow: focusedRow,
              anchorCol: focusedCol,
              focusRow: focusedRow + actualRows - 1,
              focusCol: focusedCol + actualCols - 1
            }
          ]
        }

        const existingStyles = useDatasetStore.getState().customStyles
        const styleCells: Record<string, Record<string, CellFormat>> = {
          ...(existingStyles?.cells ?? {})
        }
        let stylesChanged = false

        // Transfer cell formatting onto the pasted block: prefer the internal
        // clipboard (a SAI→SAI copy, which also carries formulas) — only
        // when this snapshot really belongs to the text just read back from
        // the OS clipboard. Otherwise fall back to the text/html clipboard
        // flavor Excel/Sheets/LibreOffice also place on the clipboard
        // (per-cell inline style — color/font only, no formulas). Either
        // source feeds the exact same merge in transferClipboardStyles.
        const internalClip = validInternalClip(text)
        const styleSource: ClipboardStyleSource | null =
          internalClip ?? (html ? parseHtmlClipboardGrid(html) : null)
        if (styleSource) {
          stylesChanged = transferClipboardStyles(
            styleSource,
            grid,
            focusedRow,
            focusedCol,
            rowsRef.current.length,
            activeVariables,
            visibleToOriginalIndexRef.current,
            caseIdentity,
            styleCells
          )
        }

        // A cut (Ctrl+X) clears its source cells once pasted (a move).
        const mark = copiedMarkRef.current
        if (mark?.isCut) {
          const { top, bottom, left, right } = mark.rect
          for (let r = top; r <= bottom; r++) {
            const srcRowArr = rowsRef.current[r]
            if (!srcRowArr) continue
            const srcDb = toDbRow(r, visibleToOriginalIndexRef.current)
            const srcRowId = caseIdentity.keyOfDb(srcDb)
            const srcRowCells: Record<string, CellFormat> = { ...(styleCells[srcRowId] ?? {}) }
            let rowStyleChanged = false

            for (let c = left; c <= right; c++) {
              const v = activeVariables[c]
              if (!v) continue
              const prevValue = srcRowArr[c] ?? null
              const prevFormula = formulaOps?.getCellFormula(srcDb, v.colId) ?? null
              srcRowArr[c] = null
              if (prevFormula !== null) formulaOps?.setCellFormula(srcDb, v.colId, null)
              updates.push({ rowIndex: srcDb, colId: v.colId, value: null })
              batch.push({
                visRow: r,
                col: c,
                colId: v.colId,
                prevValue,
                nextValue: null,
                prevFormula,
                nextFormula: null
              })

              const cellFmt = srcRowCells[v.colId]
              if (cellFmt) {
                const formula = cellFmt.formula
                if (formula) {
                  srcRowCells[v.colId] = { formula }
                } else {
                  Reflect.deleteProperty(srcRowCells, v.colId)
                }
                rowStyleChanged = true
                stylesChanged = true
              }
            }

            if (rowStyleChanged) {
              if (Object.keys(srcRowCells).length > 0) {
                styleCells[srcRowId] = srcRowCells
              } else {
                Reflect.deleteProperty(styleCells, srcRowId)
              }
            }
          }
          copiedMarkRef.current = null
          internalClipRef.current = null
        }

        if (stylesChanged) {
          useDatasetStore.getState().setCustomStyles({ cells: styleCells })
          useDatasetStore.getState().setModified(true)
          gridApiRef.current?.refreshCells({ force: true })
        }

        refreshHighlight()
        try {
          await window.api.data.updateCells({ datasetId: dsId, updates })
        } catch (err) {
          console.error('Paste persist failed:', err)
        }
        recordBatch(batch)
        // Pasted values may feed formulas elsewhere → recompute.
        formulaOps?.recomputeFormulas()
      })()
    },
    [
      gridApiRef,
      caseIdentity,
      validInternalClip,
      rowsRef,
      variables,
      showValueLabels,
      visibleToOriginalIndexRef,
      isChunkLoadingRef,
      refreshHighlight,
      warnCell,
      t,
      formulaOps,
      recordBatch
    ]
  )

  /**
   * Paste Special (B4). Modes, matching Excel's own axes:
   *  - 'transpose' — the clipboard grid pasted rows↔columns (values).
   *  - 'format'    — only the copied cells' visual formatting (bold/colors/
   *                  alignment/number-format); values are left untouched.
   *  - 'formula'   — only the copied cells' formulas, re-shifted relative to
   *                  the paste position (like a fill); cells whose source had
   *                  no formula are skipped.
   * ('values' is the plain paste — callers route it to pasteAtActiveCell.)
   * 'format'/'formula' need the internal clipboard (formats/formulas don't
   * survive the OS clipboard), so they no-op when it's empty (e.g. the copy
   * came from another app).
   */
  const pasteSpecial = useCallback(
    (focusedRow: number, focusedCol: number, mode: 'transpose' | 'format' | 'formula') => {
      if (isChunkLoadingRef.current) {
        warnCell(t('dataset.editLockedWhileLoading'))
        return
      }
      const dsId = useDatasetStore.getState().datasetId
      if (!dsId) return

      // ── Format / formula: driven by the internal clipboard ───────────────
      if (mode === 'format' || mode === 'formula') {
        // The OS clipboard is read purely to authenticate the snapshot (see
        // validInternalClip) — its text is not pasted in these modes.
        void navigator.clipboard
          .readText()
          .then(osText => {
            applyFormatOrFormula(validInternalClip(osText))
          })
          .catch((err: unknown) => {
            console.error('Clipboard read failed:', err)
          })
        return
      }

      function applyFormatOrFormula(clip: InternalClip | null): void {
        if (!clip) {
          warnCell(t('dataset.pasteSpecialNeedsInternalCopy'))
          return
        }
        if (mode === 'format') {
          const existing = useDatasetStore.getState().customStyles
          const styleCells: Record<string, Record<string, CellFormat>> = {
            ...(existing?.cells ?? {})
          }
          let changed = false
          for (let r = 0; r < clip.rows; r++) {
            const targetRow = focusedRow + r
            if (targetRow >= rowsRef.current.length) break
            const dbRow = toDbRow(targetRow, visibleToOriginalIndexRef.current)
            const rowId = caseIdentity.keyOfDb(dbRow)
            const rowCells = { ...(styleCells[rowId] ?? {}) }
            for (let c = 0; c < clip.cols; c++) {
              const variable = variables[focusedCol + c]
              const src = clip.cells[r]?.[c]
              if (!variable || !src?.format) continue
              // Keep any formula already on the target; replace only the visuals.
              const keptFormula = rowCells[variable.colId]?.formula
              rowCells[variable.colId] = {
                ...src.format,
                ...(keptFormula ? { formula: keptFormula } : {})
              }
              changed = true
            }
            styleCells[rowId] = rowCells
          }
          if (changed) {
            useDatasetStore.getState().setCustomStyles({ cells: styleCells })
            useDatasetStore.getState().setModified(true)
            gridApiRef.current?.refreshCells({ force: true })
          }
          clearCopiedMark()
          return
        }
        // mode === 'formula'
        if (!formulaOps) return
        // Every cell shifts by the same delta: where the block was copied from
        // → where it's being pasted (relative references follow, like a fill).
        const srcRect = copiedMarkRef.current?.rect
        const dRow = srcRect ? focusedRow - srcRect.top : 0
        const dCol = srcRect ? focusedCol - srcRect.left : 0
        let pasted = 0
        for (let r = 0; r < clip.rows; r++) {
          const targetRow = focusedRow + r
          const rowArr = rowsRef.current[targetRow]
          if (!rowArr) break
          for (let c = 0; c < clip.cols; c++) {
            const targetCol = focusedCol + c
            const variable = variables[targetCol]
            const src = clip.cells[r]?.[c]
            if (!variable || !src?.formula) continue
            const dbRow = toDbRow(targetRow, visibleToOriginalIndexRef.current)
            const shifted = formulaOps.shiftFormulaForFill(src.formula, dRow, dCol)
            rowArr[targetCol] = formulaOps.applyFormulaToCell(dbRow, targetCol, shifted)
            pasted++
          }
        }
        if (pasted > 0) {
          formulaOps.recomputeFormulas()
          gridApiRef.current?.refreshCells({ force: true })
        }
        clearCopiedMark()
        return
      }

      // ── Transpose: values, from the OS clipboard (works cross-app) ────────
      void navigator.clipboard
        .readText()
        .then(text => {
          const grid = transposeGrid(parseClipboardText(text))
          if (grid.length === 0) return

          const updates: { rowIndex: number; colId: string; value: CellValue }[] = []
          const batch: CellEditEntry[] = []
          let rejected = 0
          for (let r = 0; r < grid.length; r++) {
            const targetRow = focusedRow + r
            const rowArr = rowsRef.current[targetRow]
            if (!rowArr) break
            const gridRow = grid[r]
            if (!gridRow) continue
            for (let c = 0; c < gridRow.length; c++) {
              const targetCol = focusedCol + c
              const variable = variables[targetCol]
              if (!variable) continue
              const result = prepareCellEdit(gridRow[c] ?? '', variable, showValueLabels)
              if (!result.ok) {
                rejected++
                continue
              }
              const dbRow = toDbRow(targetRow, visibleToOriginalIndexRef.current)
              const prevValue = rowArr[targetCol] ?? null
              const prevFormula = formulaOps?.getCellFormula(dbRow, variable.colId) ?? null
              rowArr[targetCol] = result.value
              if (prevFormula !== null) formulaOps?.setCellFormula(dbRow, variable.colId, null)
              updates.push({ rowIndex: dbRow, colId: variable.colId, value: result.value })
              batch.push({
                visRow: targetRow,
                col: targetCol,
                colId: variable.colId,
                prevValue,
                nextValue: result.value,
                prevFormula,
                nextFormula: null
              })
            }
          }
          if (rejected > 0) warnCell(t('dataset.numericInvalid'))
          if (updates.length > 0) {
            gridApiRef.current?.refreshCells({ force: true })
            void window.api.data.updateCells({ datasetId: dsId, updates }).catch((err: unknown) => {
              console.error('Paste special persist failed:', err)
            })
            formulaOps?.recomputeFormulas()
            recordBatch(batch)
          }
          clearCopiedMark()
        })
        .catch((err: unknown) => {
          console.error('Clipboard read failed:', err)
        })
    },
    [
      gridApiRef,
      caseIdentity,
      rowsRef,
      variables,
      showValueLabels,
      visibleToOriginalIndexRef,
      isChunkLoadingRef,
      clearCopiedMark,
      validInternalClip,
      warnCell,
      t,
      formulaOps,
      recordBatch
    ]
  )

  /**
   * The accelerators that mean the exact same thing regardless of WHERE the
   * keydown came from — a focused grid cell (`onCellKeyDown`) or a
   * column/row-header selection with no focused cell at all (the
   * document-level listener further down, the only thing that can see a
   * header-select keydown at all). Used to be two separate copies of this
   * logic, one per listener — which is exactly how the "Ctrl+C/X/V fires
   * twice, paste's undo silently no-ops" bug happened (a fix landing in one
   * copy and not the other). Single source of truth now; each listener just
   * calls this first and only falls through to its own cell-focus-specific
   * behavior (F8, Tab/Enter range nav, Ctrl+Arrow, …) if it returns false.
   * Returns whether the key was recognized and handled here.
   */
  const handleSharedAccelerators = useCallback(
    (e: KeyboardEvent): boolean => {
      const isCtrl = e.ctrlKey || e.metaKey
      // Ctrl+Z / Ctrl+Y — deliberately NOT an Electron menu accelerator (see
      // menu-builder.ts's Edit-menu comment): on Linux, registering
      // 'CmdOrCtrl+Z'/'CmdOrCtrl+Y' swallows the keypress before the menu
      // item's own click handler ever runs, so this is the only place
      // Ctrl+Z/Ctrl+Y are handled at all. Unlike Ctrl+C/X/V/Delete, this
      // isn't selection-scoped — it should fire the same way whether a
      // cell or a header is what's selected — so it doesn't gate on
      // getEffectiveRanges().
      if (isCtrl && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        performUndoRedo('undo')
        return true
      }
      if (isCtrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault()
        performUndoRedo('redo')
        return true
      }
      if (isCtrl && e.key.toLowerCase() === 'c') {
        const effective = getEffectiveRanges()
        if (effective.length === 0) return false
        e.preventDefault()
        copySelection()
        return true
      }
      if (isCtrl && e.key.toLowerCase() === 'x') {
        const effective = getEffectiveRanges()
        if (effective.length === 0) return false
        e.preventDefault()
        cutSelection()
        return true
      }
      if (isCtrl && !e.shiftKey && e.key.toLowerCase() === 'v') {
        // Ctrl+Shift+V (paste special) is handled in DataView — don't plain-paste here.
        //
        // isRealCellFocused() guards against gridApi.getFocusedCell()'s
        // staleness (see its doc comment) — without it, pasting after
        // header-select → Ctrl+C → a DIFFERENT header-select → Ctrl+V wrote
        // to wherever a cell had been clicked earlier in the session, not to
        // the column the user just selected.
        const focused = isRealCellFocused() ? gridApiRef.current?.getFocusedCell() : null
        if (focused) {
          const colIndex = (focused.column.getColDef() as { dataColIndex?: number }).dataColIndex
          const targetCol = colIndex !== undefined && colIndex >= 0 ? colIndex : 0
          e.preventDefault()
          pasteAtActiveCell(focused.rowIndex, targetCol)
          return true
        }
        const effective = getEffectiveRanges()
        if (effective.length === 0) return false
        const last = effective[effective.length - 1]
        if (!last) return false
        const { top, left } = normalizeRange(last)
        e.preventDefault()
        pasteAtActiveCell(top, left)
        return true
      }
      if (isCtrl && e.key.toLowerCase() === 'a') {
        const total = rowsRef.current.length
        if (total === 0 || variables.length === 0) return false
        e.preventDefault()
        rangesRef.current = [
          { anchorRow: 0, anchorCol: 0, focusRow: total - 1, focusCol: variables.length - 1 }
        ]
        refreshHighlight()
        return true
      }
      // Delete/Backspace — clear selected cells' values (Excel/Sheets
      // convention). Only when NOT actively editing a cell — mid-edit these
      // keys must still delete/backspace text inside the editor.
      if (!isCtrl && !e.shiftKey && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace')) {
        const isEditingNow = (gridApiRef.current?.getEditingCells().length ?? 0) > 0
        if (isEditingNow) return false
        const effective = getEffectiveRanges()
        if (effective.length === 0) return false
        e.preventDefault()
        clearSelectedCells()
        return true
      }
      return false
    },
    [
      getEffectiveRanges,
      copySelection,
      cutSelection,
      pasteAtActiveCell,
      gridApiRef,
      rowsRef,
      variables,
      refreshHighlight,
      clearSelectedCells
    ]
  )

  const onCellKeyDown = useCallback(
    (e: CellKeyDownEvent<CellValue[]> | FullWidthCellKeyDownEvent<CellValue[]>) => {
      const keyboardEvent = e.event as KeyboardEvent | null
      if (!keyboardEvent) return
      const isCtrl = keyboardEvent.ctrlKey || keyboardEvent.metaKey
      // Ctrl+C/X/V, Ctrl+A, Delete/Backspace — identical regardless of
      // listener; see handleSharedAccelerators' doc comment.
      if (handleSharedAccelerators(keyboardEvent)) return
      if (isCtrl && keyboardEvent.key.toLowerCase() === 'd') {
        keyboardEvent.preventDefault()
        fillDown()
        return
      }
      if (isCtrl && keyboardEvent.key.toLowerCase() === 'r') {
        keyboardEvent.preventDefault()
        fillRight()
        return
      }
      // ── Data-entry accelerators (B3) ──────────────────────────────────────
      // Ctrl+Enter — same value to every selected cell.
      if (isCtrl && keyboardEvent.key === 'Enter') {
        keyboardEvent.preventDefault()
        broadcastToSelection()
        return
      }
      // Ctrl+; (date) / Ctrl+Shift+; (time) / Ctrl+Alt+Shift+; (date+time).
      // `code` (layout-independent) — Shift+; is ':' via `key` on many layouts.
      if (isCtrl && keyboardEvent.code === 'Semicolon') {
        keyboardEvent.preventDefault()
        const mode =
          keyboardEvent.altKey && keyboardEvent.shiftKey
            ? 'datetime'
            : keyboardEvent.shiftKey
              ? 'time'
              : 'date'
        insertDateTime(mode)
        return
      }
      // Ctrl+' — copy the cell above (formula-aware, exact copy).
      if (isCtrl && keyboardEvent.code === 'Quote') {
        keyboardEvent.preventDefault()
        copyFromAbove()
        return
      }
      // ── F8 / Shift+F8 — sticky "Extend"/"Add" selection modes (B1) ──────
      if (keyboardEvent.key === 'F8') {
        keyboardEvent.preventDefault()
        if (keyboardEvent.shiftKey) {
          setSelectionMode(selectionModeRef.current === 'add' ? 'normal' : 'add')
        } else {
          setSelectionMode(selectionModeRef.current === 'extend' ? 'normal' : 'extend')
        }
        return
      }
      if (keyboardEvent.key === 'Escape') {
        // Clear the copy/cut marching-ants frame and any sticky selection mode.
        if (copiedMarkRef.current) clearCopiedMark()
        if (selectionModeRef.current !== 'normal') setSelectionMode('normal')
        return
      }

      // ── Ctrl+Backspace — scroll the active cell back into view (B1) ──────
      if (isCtrl && keyboardEvent.key === 'Backspace') {
        const rc = getFocusedRC()
        if (rc) {
          keyboardEvent.preventDefault()
          focusCell(rc.row, rc.col)
        }
        return
      }

      // ── Ctrl+. — cycle focus through the active range's four corners (B1) ─
      if (isCtrl && keyboardEvent.key === '.') {
        const last = rangesRef.current[rangesRef.current.length - 1]
        if (!last) return
        keyboardEvent.preventDefault()
        const next = nextRangeCorner(normalizeRange(last), getFocusedRC())
        focusCell(next[0], next[1])
        return
      }

      // ── Ctrl+Arrow / Ctrl+Shift+Arrow — jump to the data-block edge (B1) ──
      if (isCtrl && keyboardEvent.key.startsWith('Arrow')) {
        const rc = getFocusedRC()
        if (!rc) return
        const delta: Record<string, [number, number]> = {
          ArrowUp: [-1, 0],
          ArrowDown: [1, 0],
          ArrowLeft: [0, -1],
          ArrowRight: [0, 1]
        }
        const d = delta[keyboardEvent.key]
        if (!d) return
        keyboardEvent.preventDefault()
        const maxRow = rowsRef.current.length - 1
        const maxCol = variables.length - 1
        const edge = findDataEdge(rowsRef.current, rc.row, rc.col, d[0], d[1], maxRow, maxCol)
        if (keyboardEvent.shiftKey) {
          // Extend the range from its anchor to the edge (Ctrl+Shift+Arrow).
          const last = rangesRef.current[rangesRef.current.length - 1]
          if (last) {
            last.focusRow = edge.row
            last.focusCol = edge.col
          } else {
            rangesRef.current = [
              { anchorRow: rc.row, anchorCol: rc.col, focusRow: edge.row, focusCol: edge.col }
            ]
          }
        } else {
          rangesRef.current = [
            { anchorRow: edge.row, anchorCol: edge.col, focusRow: edge.row, focusCol: edge.col }
          ]
        }
        focusCell(edge.row, edge.col)
        refreshHighlight()
        return
      }

      // ── Range-aware Tab/Enter — move the active cell WITHIN a multi-cell
      // selection without collapsing it (B1). AG Grid's own Tab/Enter nav for
      // these keys is suppressed via the colDef `suppressKeyboardEvent` in
      // DataView.tsx while a multi-cell range is active, so this is the sole
      // mover. Single-cell selections fall through to native nav. ───────────
      {
        const isEditingNow = (gridApiRef.current?.getEditingCells().length ?? 0) > 0
        if ((keyboardEvent.key === 'Tab' || keyboardEvent.key === 'Enter') && !isEditingNow) {
          const last = rangesRef.current[rangesRef.current.length - 1]
          if (last) {
            const next = nextCellInRange(
              normalizeRange(last),
              getFocusedRC(),
              keyboardEvent.key,
              keyboardEvent.shiftKey
            )
            if (next) {
              keyboardEvent.preventDefault()
              focusCell(next.row, next.col)
              return
            }
          }
        }
      }

      // Shift+Space / Ctrl+Space — Excel/Calc/Sheets' standard "select the
      // focused cell's whole row/column" shortcuts (P1.5,
      // spreadsheet-ozellikleri-envanteri.md §2.1/§2.3 test #8). Skipped
      // while a cell is actively being edited — otherwise typing a literal
      // space into a text cell would hijack the selection instead.
      const isEditing = (gridApiRef.current?.getEditingCells().length ?? 0) > 0
      if (keyboardEvent.key === ' ' && !isEditing) {
        if (keyboardEvent.shiftKey && !isCtrl) {
          keyboardEvent.preventDefault()
          const focused = gridApiRef.current?.getFocusedCell()
          if (!focused || typeof focused.rowIndex !== 'number') return
          selectRow(focused.rowIndex, 'replace')
          return
        }
        if (isCtrl) {
          keyboardEvent.preventDefault()
          const focused = gridApiRef.current?.getFocusedCell()
          if (!focused) return
          const colIndex = (focused.column.getColDef() as { dataColIndex?: number }).dataColIndex
          if (colIndex === undefined || colIndex < 0) return
          selectColumn(colIndex, 'replace')
          return
        }
      }
      // Shift+Arrow extends the active range's focus by one cell in that
      // direction (AG Grid's own single-cell nav still moves the focused
      // cell underneath — we only layer the range on top).
      if (keyboardEvent.shiftKey && keyboardEvent.key.startsWith('Arrow')) {
        const last = rangesRef.current[rangesRef.current.length - 1]
        if (!last) return
        const maxRow = rowsRef.current.length - 1
        const maxCol = variables.length - 1
        const next = extendFocusByArrow(
          last.focusRow,
          last.focusCol,
          keyboardEvent.key,
          maxRow,
          maxCol
        )
        if (!next) return
        last.focusRow = next.focusRow
        last.focusCol = next.focusCol
        refreshHighlight()
      }
    },
    [
      handleSharedAccelerators,
      gridApiRef,
      rowsRef,
      variables,
      refreshHighlight,
      selectRow,
      selectColumn,
      fillDown,
      fillRight,
      setSelectionMode,
      getFocusedRC,
      focusCell,
      broadcastToSelection,
      insertDateTime,
      copyFromAbove,
      clearCopiedMark
    ]
  )

  const clearSelection = useCallback(() => {
    rangesRef.current = []
    refreshHighlight()
  }, [refreshHighlight])

  /** Selects and scrolls to a parsed Name-Box address (B1). Replaces the
   *  current selection with the address rectangle and puts the focused cell
   *  at its top-left, matching Excel's Name Box behaviour. */
  const navigateToAddress = useCallback(
    (addr: ParsedAddress) => {
      rangesRef.current = [
        {
          anchorRow: addr.top,
          anchorCol: addr.left,
          focusRow: addr.bottom,
          focusCol: addr.right
        }
      ]
      focusCell(addr.top, addr.left)
      refreshHighlight()
    },
    [focusCell, refreshHighlight]
  )

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // DataView stays MOUNTED (just hidden) behind the other tabs, so this
      // window listener keeps running there too. Without this guard a Ctrl+C
      // on the Output tab / in the AI chat re-copied the grid's stale cell
      // selection over what the user had actually selected (the "0,00" bug),
      // and Ctrl+V / Delete would silently edit hidden data.
      if (useUIStore.getState().activeTab !== 'data') return
      // Text highlighted outside the grid (e.g. the AI chat side panel) is
      // what the user means to copy — leave the key to the browser.
      const textSel = window.getSelection()
      if (
        textSel &&
        !textSel.isCollapsed &&
        !textSel.anchorNode?.parentElement?.closest('.ag-root-wrapper')
      ) {
        return
      }
      const activeEl = document.activeElement
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return
      }

      const isEditing = (gridApiRef.current?.getEditingCells().length ?? 0) > 0
      if (isEditing) return

      // A real data cell currently holds DOM focus → AG Grid's own
      // `cellKeyDown` dispatch (this hook's onCellKeyDown) already handles
      // every key below for that case. Without this guard, the SAME keydown
      // bubbles from the cell all the way up to here, so both handlers ran
      // for every Ctrl+C/X/V/A/Delete — harmless for copy (rewriting the
      // same clipboard text twice), but for paste it silently recorded a
      // second, spurious "no-op" entry onto the undo stack (captured AFTER
      // the first paste already ran, so prev===next) that then sat on TOP
      // of the real one — one Ctrl+Z popped that no-op and looked like it
      // did nothing.
      //
      // isRealCellFocused() (not gridApi.getFocusedCell(), see its doc
      // comment) — a header click moves `document.activeElement` to the
      // header element, which is never inside `.ag-cell`.
      if (isRealCellFocused()) return

      if (e.key === 'Escape' && copiedMarkRef.current) {
        clearCopiedMark()
        return
      }
      // Ctrl+C/X/V, Ctrl+A, Delete/Backspace — identical regardless of
      // listener; see handleSharedAccelerators' doc comment. This is what
      // actually reaches a column/row-header selection (ColumnHeader.tsx's
      // own onClick selects without ever focusing a grid cell, so AG Grid's
      // `onCellKeyDown` never fires for it — only this document-level
      // listener does).
      handleSharedAccelerators(e)
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown)
    }
  }, [clearCopiedMark, handleSharedAccelerators, gridApiRef])

  return {
    rangesRef,
    isCellSelected,
    isFillHandleAnchor,
    onCellClicked,
    onCellMouseDown,
    onCellMouseOver,
    stopDragging,
    onCellKeyDown,
    clearSelection,
    clearSelectedCells,
    recordCellEdit: recordBatch,
    undoLastEdit,
    redoLastEdit,
    copySelection,
    pasteAtActiveCell,
    pasteSpecial,
    selectColumn,
    selectRow,
    navigateToAddress,
    tryAutoFillFromHandle,
    cutSelection,
    copiedEdgeClass,
    clearCopiedMark,
    selectionMode,
    selectedCellClass: styles.selectedCell,
    fillHandleAnchorClass: styles.fillHandleAnchor
  }
}
