// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * use-data-loader.ts — chunked dataset loading + filter/sort view pipeline
 * for DataView (extracted from DataView.tsx; no behaviour change).
 *
 * Builds the filtered+sorted view from allRowsRef and pushes it into the
 * grid in one shot — no chunked painting needed (AG Grid's own client-side
 * model handles a 500K-row array assignment in well under a second, measured
 * in aggrid-gecis-roadmap.md G0.1). Owns the load-bookkeeping refs; the row
 * data refs themselves stay shared with DataView's other hooks.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { GridApi } from 'ag-grid-community'
import type { CellValue, Variable } from '@shared/data-types'
import { applyColumnFilters, applySortInMemory } from '../../lib/data-grid'
import { useDatasetStore } from '../../store/dataset-store'
import { useUIStore } from '../../store/ui-store'
import type { CaseIdentity } from './case-identity'
import { ROW_NUM_COL_ID } from './constants'
import { loadDatasetChunked } from './load-dataset-chunked'

export interface UseDataLoaderParams {
  gridApiRef: React.RefObject<GridApi<CellValue[]> | null>
  /** Flips true once onGridReady fires — gates the first load (see
   *  onGridReady's stale-closure comment in use-grid-events.ts). */
  gridReady: boolean
  datasetId: string | null
  variables: Variable[]
  structuralKey: string
  dataVersion: number
  columnFilters: Record<string, { operator: string; value: string }>
  columnSort: { colId: string; direction: 'asc' | 'desc' } | null
  caseIdentity: CaseIdentity
  assignRowId: (row: CellValue[], caseId: number) => void
  beginLoading: () => void
  endLoading: () => void
  setVisibleRowCount?: (count: number) => void
  rowsRef: React.RefObject<CellValue[][]>
  allRowsRef: React.RefObject<CellValue[][]>
  visibleToOriginalIndexRef: React.RefObject<number[]>
  isChunkLoadingRef: React.RefObject<boolean>
  rowIdMapRef: React.RefObject<WeakMap<CellValue[], string>>
}

export function useDataLoader(params: UseDataLoaderParams) {
  const {
    gridApiRef,
    gridReady,
    datasetId,
    variables,
    structuralKey,
    dataVersion,
    columnFilters,
    columnSort,
    caseIdentity,
    assignRowId,
    beginLoading,
    endLoading,
    setVisibleRowCount,
    rowsRef,
    allRowsRef,
    visibleToOriginalIndexRef,
    isChunkLoadingRef,
    rowIdMapRef
  } = params

  // ── Refs mirroring the previous grid's design (chunked-load-roadmap.md +
  // hibrit/aggrid roadmaps) — same names, same semantics, so the mental
  // model carries over even though the paint mechanism underneath changed. ──
  const lastDatasetIdRef = useRef<string | null>(null)
  const lastVariablesKeyRef = useRef<string | null>(null)
  const lastDataVersionRef = useRef<number>(0)
  const activeInitIdRef = useRef(0)
  const baseRowOrderRef = useRef<number[] | null>(null)
  /** True for the whole duration of a full chunked re-fetch (needsRefetch
   *  branch) — guards against the very first load's double-trigger race:
   *  `onGridReady` calls loadData() directly *and* the loadData-dependency
   *  effect below also fires (deferred) on the same initial mount, since
   *  datasetId/variables both go from empty to set in one update. The
   *  second call used to see `lastDatasetIdRef`/`lastVariablesKeyRef`
   *  already written by the first call's synchronous prefix (before its
   *  first await) and wrongly take the "just filter/sort changed" fast
   *  path — calling applyViewAndSet() against an still-empty allRowsRef and
   *  painting an empty grid ("No Rows To Show" until an unrelated later
   *  reload, e.g. a column move, happened to fix it). */
  const loadInFlightRef = useRef(false)
  /** Set when a fast-path call (filter/sort/etc changed) arrives while a
   *  full load is still in flight for the same target — the in-flight
   *  load's own completion re-applies the latest filter/sort once, instead
   *  of the fast-path call silently doing nothing. */
  const pendingReapplyRef = useRef(false)

  // ── Builds the filtered+sorted view from allRowsRef and pushes it into
  // the grid in one shot — no chunked painting needed (AG Grid's own
  // client-side model handles a 500K-row array assignment in well under a
  // second, measured in aggrid-gecis-roadmap.md G0.1). ──────────────────────
  const applyViewAndSet = useCallback(
    (api: GridApi<CellValue[]>) => {
      const freshVars = useDatasetStore.getState().variables
      const freshFilters = useDatasetStore.getState().columnFilters
      const freshSort = useDatasetStore.getState().columnSort

      const baseIndices: number[] =
        baseRowOrderRef.current !== null &&
        baseRowOrderRef.current.length === allRowsRef.current.length
          ? [...baseRowOrderRef.current]
          : Array.from({ length: allRowsRef.current.length }, (_, i) => i)

      const { filteredRows, visibleToOriginalIndex } = applyColumnFilters(
        allRowsRef.current,
        baseIndices,
        freshVars,
        freshFilters
      )
      const { sortedRows, sortedMapping } = applySortInMemory(
        filteredRows,
        visibleToOriginalIndex,
        freshVars,
        freshSort
      )

      rowsRef.current = sortedRows
      visibleToOriginalIndexRef.current = sortedMapping
      setVisibleRowCount?.(sortedRows.length)
      api.setGridOption('rowData', sortedRows)
      // AG Grid matches rows across this reassignment by getRowId and, seeing
      // the same row-array (data) reference as before, treats an unchanged
      // row's cells as unchanged too — reasonable in general, but the row-num
      // column's value is POSITION-based (not data-based), so a row that only
      // moved (not edited) would otherwise keep showing its old number. Force
      // just that column to recompute/repaint after every filter/sort change.
      api.refreshCells({ force: true, columns: [ROW_NUM_COL_ID] })
    },
    [rowsRef, allRowsRef, visibleToOriginalIndexRef, setVisibleRowCount]
  )

  // ── Data loading ────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const api = gridApiRef.current
    if (!datasetId || !api || !gridReady || variables.length === 0) return

    const isSameDatasetAndStructure =
      lastDatasetIdRef.current === datasetId && lastVariablesKeyRef.current === structuralKey
    const needsRefetch = !isSameDatasetAndStructure || lastDataVersionRef.current !== dataVersion

    if (!needsRefetch) {
      // Only filter/sort/value-labels/theme changed — no IPC round trip.
      if (loadInFlightRef.current) {
        // A full load for this same target is still streaming in (the
        // initial-mount double-trigger race) — allRowsRef isn't complete
        // yet, so applying a view now would paint an empty/partial grid.
        // Defer: the in-flight load re-applies the latest filter/sort
        // itself right after it finishes (see below).
        pendingReapplyRef.current = true
        return
      }
      applyViewAndSet(api)
      return
    }

    if (loadInFlightRef.current) return // duplicate full-reload request for the same target already running
    loadInFlightRef.current = true

    const initId = ++activeInitIdRef.current
    const isStale = () => initId !== activeInitIdRef.current
    const hasFilterOrSort = Object.keys(columnFilters).length > 0 || !!columnSort?.colId

    beginLoading()
    rowIdMapRef.current = new WeakMap()
    if (lastDatasetIdRef.current !== datasetId) baseRowOrderRef.current = null
    lastDatasetIdRef.current = datasetId
    lastVariablesKeyRef.current = structuralKey
    lastDataVersionRef.current = dataVersion
    allRowsRef.current = []
    caseIdentity.reset()

    const reportProgress = (loaded: number, total: number) => {
      if (isStale()) return
      const percent = total > 0 ? Math.round((loaded / total) * 100) : 100
      useUIStore.getState().setProcessing(true, 'status.loadingRows', percent, { loaded, total })
    }

    let firstChunkPainted = false

    const { aborted } = await loadDatasetChunked({
      datasetId,
      colCount: variables.length,
      isStale,
      onChunk: (chunk, offset, total, chunkCaseIds) => {
        if (isStale()) return
        // Fall back to the position when main didn't send ids — on a fresh
        // import the two are equal anyway, so this degrades to the old
        // behaviour instead of mis-keying.
        const chunkIds = chunk.map((_, i) => chunkCaseIds?.[i] ?? offset + i)
        caseIdentity.append(chunkIds)
        for (let i = 0; i < chunk.length; i++) {
          const row = chunk[i]
          const caseId = chunkIds[i]
          if (row && caseId !== undefined) assignRowId(row, caseId)
        }
        allRowsRef.current.push(...chunk)

        if (hasFilterOrSort) {
          // Collect-then-paint: filtering/sorting needs the full set before
          // anything meaningful can be shown — just accumulate and report.
          reportProgress(offset + chunk.length, total)
          return
        }

        if (!firstChunkPainted) {
          firstChunkPainted = true
          visibleToOriginalIndexRef.current = Array.from({ length: chunk.length }, (_, i) => i)
          rowsRef.current = allRowsRef.current
          setVisibleRowCount?.(total)
          api.setGridOption('rowData', chunk)
          // getRowId is position-based ("r{index}"), so on a RELOAD over
          // existing rows (e.g. after a row-drag reorder → bumpDataVersion)
          // AG Grid matches "r5"(old) to "r5"(new) and, for the position-
          // based row-number column, reuses the cached value → stale numbers
          // ("1..N don't refresh until you click elsewhere"). Force that one
          // column to recompute, same as applyViewAndSet does for filter/
          // sort. Cheap (single narrow pinned column).
          api.refreshCells({ force: true, columns: [ROW_NUM_COL_ID] })
          endLoading()
          if (total > chunk.length) {
            isChunkLoadingRef.current = true
            reportProgress(chunk.length, total)
          }
          return
        }

        // Subsequent chunks: append without a full rowData reassignment
        // (measured ~1.3s total for 500K rows this way — see G0.1).
        visibleToOriginalIndexRef.current = Array.from(
          { length: allRowsRef.current.length },
          (_, i) => i
        )
        rowsRef.current = allRowsRef.current
        setVisibleRowCount?.(allRowsRef.current.length)
        api.applyTransactionAsync({ add: chunk })
        reportProgress(offset + chunk.length, total)
      }
    })

    isChunkLoadingRef.current = false
    loadInFlightRef.current = false
    if (aborted || isStale()) {
      endLoading()
      return
    }

    if (hasFilterOrSort || pendingReapplyRef.current) {
      pendingReapplyRef.current = false
      applyViewAndSet(api)
      endLoading()
    }
    useUIStore.getState().setProcessing(false)
  }, [
    gridApiRef,
    datasetId,
    caseIdentity,
    assignRowId,
    variables.length,
    structuralKey,
    dataVersion,
    columnFilters,
    columnSort,
    applyViewAndSet,
    beginLoading,
    endLoading,
    gridReady,
    rowsRef,
    allRowsRef,
    visibleToOriginalIndexRef,
    isChunkLoadingRef,
    rowIdMapRef,
    setVisibleRowCount
  ])

  useEffect(() => {
    // Deferred via setTimeout (not called directly): loadData's "only
    // filter/sort changed" fast path calls setVisibleRowCount without an
    // intervening await, which react-hooks' set-state-in-effect rule (and
    // the cascading-render it warns about) correctly flags for a *direct*
    // synchronous call from the effect body. The timer hands control back
    // to the browser first, so any resulting state update lands in its own
    // task — same effective timing (next tick), no synchronous double-commit.
    const timer = setTimeout(() => {
      void loadData()
    }, 0)
    return () => {
      clearTimeout(timer)
    }
  }, [loadData])
}
