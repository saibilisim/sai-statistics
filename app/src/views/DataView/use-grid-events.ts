// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * use-grid-events.ts — AG Grid event wiring for DataView (extracted from
 * DataView.tsx; no behaviour change): grid lifecycle (onGridReady + bridge
 * store cleanup), freeze-panes column pinning, cell-edit persistence, column
 * width/order persistence (T8), native row-drag reordering, fill-handle
 * double-click, zebra row class, and the native row-selection config.
 */
import { useCallback, useEffect, useMemo } from 'react'
import type { TFunction } from 'i18next'
import type {
  GridApi,
  GridReadyEvent,
  CellValueChangedEvent,
  ColumnResizedEvent,
  ColumnMovedEvent,
  RowClassParams,
  CellDoubleClickedEvent,
  RowDragEndEvent,
  RowSelectionOptions
} from 'ag-grid-community'
import type { CellValue, Variable } from '@shared/data-types'
import { toDbRow } from '../../lib/data-grid'
import { useDatasetStore } from '../../store/dataset-store'
import { useGridBridgeStore } from '../../store/grid-bridge-store'
import type { CaseIdentity } from './case-identity'
import { ROW_NUM_COL_ID } from './constants'
import type { DataColDef } from './use-column-defs'
import { cx } from '../../lib/cx'
import styles from './DataView.module.css'

export interface UseGridEventsParams {
  gridApiRef: React.RefObject<GridApi<CellValue[]> | null>
  gridReady: boolean
  setGridReady: (ready: boolean) => void
  variables: Variable[]
  frozenColCount: number
  isChunkLoadingRef: React.RefObject<boolean>
  rowsRef: React.RefObject<CellValue[][]>
  allRowsRef: React.RefObject<CellValue[][]>
  visibleToOriginalIndexRef: React.RefObject<number[]>
  caseIdentity: CaseIdentity
  clearSelection: () => void
  tryAutoFillFromHandle: (mouseEvent: MouseEvent, rowIndex: number, colIndex: number) => boolean
  getCellFormula: (dbRow: number, colId: string) => string | undefined
  recomputeFormulas: () => void
  warnCell: (message: string) => void
  t: TFunction
}

export function useGridEvents(params: UseGridEventsParams) {
  const {
    gridApiRef,
    gridReady,
    setGridReady,
    variables,
    frozenColCount,
    isChunkLoadingRef,
    rowsRef,
    allRowsRef,
    visibleToOriginalIndexRef,
    caseIdentity,
    clearSelection,
    tryAutoFillFromHandle,
    getCellFormula,
    recomputeFormulas,
    warnCell,
    t
  } = params

  // ── Grid lifecycle ──────────────────────────────────────────────────────
  const onGridReady = useCallback(
    (e: GridReadyEvent<CellValue[]>) => {
      gridApiRef.current = e.api
      useGridBridgeStore.getState().setGridApi(e.api)
      // NOT `void loadData()` here: this callback's own useCallback has `[]`
      // deps ("one-shot wiring on mount"), so it — and everything it closes
      // over, including whichever `loadData` existed at the time — is frozen
      // from the very first render, before any dataset/gridApi existed. That
      // frozen `loadData` call was always an immediate no-op (its own closure
      // had datasetId=null baked in) — this was the actual root cause of "No
      // Rows To Show" on first open (found 2026-07-21): the ONLY other trigger
      // (the loadData-dependency effect below) can itself fire before this
      // callback has even run once, so a load request could be dropped with no
      // retry once the grid finally became ready. Flipping this state instead
      // forces loadData's useCallback to recreate — the effect watching it
      // fires again, this time with both a live gridApiRef AND fresh
      // datasetId/variables (never a stale closure).
      setGridReady(true)
    },
    [gridApiRef, setGridReady]
  )

  useEffect(() => {
    return () => {
      useGridBridgeStore.getState().setGridApi(null)
      gridApiRef.current = null
    }
  }, [gridApiRef])

  useEffect(() => {
    const api = gridApiRef.current
    if (!api || !gridReady) return
    const state = [
      { colId: ROW_NUM_COL_ID, pinned: 'left' as const },
      ...variables.map((v, idx) => ({
        colId: v.colId,
        pinned: idx < frozenColCount ? ('left' as const) : null
      }))
    ]
    api.applyColumnState({
      state,
      defaultState: { pinned: null }
    })
  }, [gridApiRef, frozenColCount, variables, gridReady])

  // ── Cell edit persistence ──────────────────────────────────────────────
  const onCellValueChanged = useCallback(
    (e: CellValueChangedEvent<CellValue[]>) => {
      const dsId = useDatasetStore.getState().datasetId
      if (!dsId) return
      if (isChunkLoadingRef.current) {
        warnCell(t('dataset.editLockedWhileLoading'))
        return
      }

      const colDef = e.colDef as DataColDef
      if (colDef.dataColIndex < 0 || !colDef.variable) return

      const visibleRow = e.rowIndex ?? e.node.rowIndex
      if (visibleRow === null) return
      const dbRow = toDbRow(visibleRow, visibleToOriginalIndexRef.current)
      const value = e.data[colDef.dataColIndex] ?? null

      // Formula cells are persisted (DB-safe) by recomputeFormulas below —
      // the raw `value` here would be the result or an error string, so only
      // plain cells take the direct updateCell path.
      const isFormulaCell = getCellFormula(dbRow, colDef.variable.colId) !== undefined
      if (!isFormulaCell) {
        void window.api.data
          .updateCell({ datasetId: dsId, rowIndex: dbRow, colId: colDef.variable.colId, value })
          .catch((err: unknown) => {
            console.error('updateCell failed:', err)
          })
      }

      // Any edit may feed a formula elsewhere → recompute all formula cells
      // (cheap no-op when there are none).
      recomputeFormulas()
    },
    [isChunkLoadingRef, warnCell, t, getCellFormula, recomputeFormulas, visibleToOriginalIndexRef]
  )

  // ── Column width / order persistence (T8) ──────────────────────────────
  const onColumnResized = useCallback((e: ColumnResizedEvent) => {
    if (!e.finished || e.source === 'api') return
    const col = e.column
    if (!col) return
    const colId = col.getColId()
    if (colId === ROW_NUM_COL_ID) return
    const dsId = useDatasetStore.getState().datasetId
    if (!dsId) return
    const freshVars = useDatasetStore.getState().variables
    const idx = freshVars.findIndex(v => v.colId === colId)
    if (idx === -1) return
    const pixelWidth = col.getActualWidth()
    const newColumns = Math.max(1, Math.round(pixelWidth / 9))
    if (newColumns === freshVars[idx]?.columns) return
    useDatasetStore.getState().updateVariable(idx, { columns: newColumns })
    void window.api.variable
      .update({ datasetId: dsId, colId, updates: { columns: newColumns } })
      .catch((err: unknown) => {
        console.error('Failed to persist column width:', err)
      })
  }, [])

  const onColumnMoved = useCallback(
    (e: ColumnMovedEvent) => {
      if (!e.finished || e.source === 'api') return
      const api = gridApiRef.current
      if (!api) return
      const dsId = useDatasetStore.getState().datasetId
      if (!dsId) return
      const orderedColIds = api
        .getAllGridColumns()
        .map(c => c.getColId())
        .filter(id => id !== ROW_NUM_COL_ID)
      const freshVars = useDatasetStore.getState().variables
      const currentOrder = freshVars.map(v => v.colId)
      if (orderedColIds.join(',') === currentOrder.join(',')) return
      void window.api.variable.reorder({ datasetId: dsId, colIds: orderedColIds }).then(
        () => {
          void window.api.variable.getAll({ datasetId: dsId }).then(vars => {
            useDatasetStore.getState().setVariables(vars)
          })
        },
        (err: unknown) => {
          console.error('Failed to persist column reorder:', err)
        }
      )
    },
    [gridApiRef]
  )

  // ── Row reordering (AG Grid native rowDrag) ──────────────────────────────
  const onRowDragEnd = useCallback(
    (event: RowDragEndEvent<CellValue[]>) => {
      const dsId = useDatasetStore.getState().datasetId
      if (!dsId) return
      // Mid-chunked-load the grid only holds the rows streamed so far — a
      // reorder built from them would drop the rest (Main also refuses it).
      if (isChunkLoadingRef.current) {
        warnCell(t('dataset.editLockedWhileLoading'))
        // rowDragManaged already moved the node — put the grid back.
        event.api.setGridOption('rowData', rowsRef.current)
        return
      }

      // Position lookup built once (O(n)) — `indexOf` per node was O(n²) and
      // made dropping a row in a large dataset take seconds (denetim §4.3).
      const posOf = new Map<CellValue[], number>()
      rowsRef.current.forEach((row, i) => posOf.set(row, i))

      const newOrder: number[] = []
      event.api.forEachNode(node => {
        if (node.data) {
          const origIndex = posOf.get(node.data)
          if (origIndex !== undefined) {
            newOrder.push(origIndex)
          }
        }
      })

      if (newOrder.length === 0 || newOrder.every((idx, pos) => idx === pos)) return

      // Apply the same permutation to the rows AND to their case ids, so the
      // renderer's dbRow→caseId map keeps matching the DuckDB table that
      // data:reorder-rows is about to rewrite. Row drag is only offered with
      // no filter/sort active, so the visible order IS the DB order here and
      // rowsRef/allRowsRef stay the same array (identity view).
      const prevIds = caseIdentity.all()
      const newRows = newOrder.map(i => allRowsRef.current[i]).filter((r): r is CellValue[] => !!r)
      allRowsRef.current = newRows
      rowsRef.current = newRows
      caseIdentity.setAll(newOrder.map(i => prevIds[i] ?? i))

      clearSelection()
      void window.api.data
        .reorderRows({ datasetId: dsId, rowIndices: newOrder })
        .catch((err: unknown) => {
          console.error('Failed to reorder rows:', err)
        })
    },
    [rowsRef, allRowsRef, clearSelection, caseIdentity, isChunkLoadingRef, warnCell, t]
  )

  // Fill-handle double-click (B3): if the double-click landed on the fill
  // handle, auto-fill down to the neighbour column's length and cancel the
  // cell edit AG Grid would otherwise start.
  const onCellDoubleClicked = useCallback(
    (e: CellDoubleClickedEvent<CellValue[]>) => {
      const mouseEvent = e.event as MouseEvent | null
      const colIndex = (e.colDef as { dataColIndex?: number }).dataColIndex ?? -1
      if (mouseEvent && e.rowIndex !== null && colIndex >= 0) {
        if (tryAutoFillFromHandle(mouseEvent, e.rowIndex, colIndex)) {
          e.api.stopEditing(true)
        }
      }
    },
    [tryAutoFillFromHandle]
  )

  const getRowClass = useCallback((p: RowClassParams<CellValue[]>) => {
    return cx(p.rowIndex % 2 === 1 && styles.oddRow)
  }, [])

  // Native row selection config (AG Grid v35 object API — replaces the
  // deprecated `rowSelection="multiple"` + `suppressRowClickSelection`).
  // `enableClickSelection: false` because we drive row selection ourselves
  // (onCellClicked → selectRow → node.setSelected in refreshHighlight);
  // `checkboxes/headerCheckbox: false` so no selection-checkbox column is
  // injected. multiRow + this config is what `rowDragMultiRow` reads to
  // carry a multi-row selection when dragging.
  const rowSelection = useMemo<RowSelectionOptions<CellValue[]>>(
    () => ({
      mode: 'multiRow',
      enableClickSelection: false,
      checkboxes: false,
      headerCheckbox: false
    }),
    []
  )

  return {
    onGridReady,
    onCellValueChanged,
    onColumnResized,
    onColumnMoved,
    onRowDragEnd,
    onCellDoubleClicked,
    getRowClass,
    rowSelection
  }
}
