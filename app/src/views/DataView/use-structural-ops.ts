// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * use-structural-ops.ts — row/column insert & delete for the AG Grid
 * DataView (aggrid-gecis-roadmap.md G5 / T8).
 *
 * Deliberately simple compared to the previous grid's use-structural-commands.ts:
 * that file had to splice rowsRef/allRowsRef and the live worksheet by hand,
 * then set `skipNextReloadRef` to stop the resulting store update from
 * triggering an expensive redundant re-fetch (chunked-load-roadmap.md C3.4 —
 * the very bug this session fixed twice). None of that is needed here: a
 * full re-fetch after a structural op is cheap in this architecture (471ms
 * measured for 60K rows, see G0.1/G1 results), so a row op just bumps
 * `dataVersion` and a column op just calls `setVariables()` — both already
 * drive DataView's existing load pipeline (T1) to refetch correctly. No
 * interception, no skip-flag dance.
 */
import { useCallback } from 'react'
import type { TFunction } from 'i18next'
import { useDatasetStore } from '../../store/dataset-store'
import { toDbRow, makeUniqueVarName } from '../../lib/data-grid'
import { NEW_COLUMN_TEMPLATE } from './constants'

export interface UseStructuralOpsParams {
  visibleToOriginalIndexRef: React.RefObject<number[]>
  /** True while a background chunked load is still streaming rows in for
   *  this dataset. Row/column insert-delete shift `__row_idx` in the live
   *  DuckDB table via OFFSET/LIMIT reads (load-dataset-chunked.ts), which a
   *  concurrent structural mutation would desync (duplicate/skipped rows) —
   *  block the op instead, same as onCellValueChanged already does for cell
   *  edits (denetim raporu 2026-07-26). */
  isChunkLoadingRef: React.RefObject<boolean>
  warnCell: (message: string) => void
  t: TFunction
}

export function useStructuralOps(params: UseStructuralOpsParams) {
  const { visibleToOriginalIndexRef, isChunkLoadingRef, warnCell, t } = params

  const insertRow = useCallback(
    (visibleRow: number, position: 'above' | 'below') => {
      const dsId = useDatasetStore.getState().datasetId
      if (!dsId) return
      if (isChunkLoadingRef.current) {
        warnCell(t('dataset.editLockedWhileLoading'))
        return
      }
      const dbRow = toDbRow(visibleRow, visibleToOriginalIndexRef.current)
      const rowIndex = position === 'above' ? dbRow : dbRow + 1
      void window.api.data
        .insertRow({ datasetId: dsId, rowIndex })
        .then(() => {
          const s = useDatasetStore.getState()
          s.setRowCount(s.rowCount + 1)
          s.bumpDataVersion()
        })
        .catch((err: unknown) => {
          console.error('Insert row failed:', err)
        })
    },
    [visibleToOriginalIndexRef, isChunkLoadingRef, warnCell, t]
  )

  const deleteRows = useCallback(
    (visibleRows: number[]) => {
      const dsId = useDatasetStore.getState().datasetId
      if (!dsId || visibleRows.length === 0) return
      if (isChunkLoadingRef.current) {
        warnCell(t('dataset.editLockedWhileLoading'))
        return
      }
      const dbIndices = visibleRows.map(r => toDbRow(r, visibleToOriginalIndexRef.current))
      void window.api.data
        .deleteRows({ datasetId: dsId, rowIndices: dbIndices })
        .then(() => {
          const s = useDatasetStore.getState()
          s.setRowCount(Math.max(0, s.rowCount - dbIndices.length))
          s.bumpDataVersion()
        })
        .catch((err: unknown) => {
          console.error('Delete rows failed:', err)
        })
    },
    [visibleToOriginalIndexRef, isChunkLoadingRef, warnCell, t]
  )

  const insertColumn = useCallback(
    (atIndex: number) => {
      const dsId = useDatasetStore.getState().datasetId
      if (!dsId) return
      if (isChunkLoadingRef.current) {
        warnCell(t('dataset.editLockedWhileLoading'))
        return
      }
      const usedNames = new Set(useDatasetStore.getState().variables.map(v => v.name))
      const name = makeUniqueVarName(usedNames)
      void window.api.variable
        .add({ datasetId: dsId, variable: { ...NEW_COLUMN_TEMPLATE, name }, index: atIndex })
        .then(updated => {
          useDatasetStore.getState().setVariables(updated)
        })
        .catch((err: unknown) => {
          console.error('Insert column failed:', err)
        })
    },
    [isChunkLoadingRef, warnCell, t]
  )

  const deleteColumn = useCallback(
    (colIndex: number) => {
      const dsId = useDatasetStore.getState().datasetId
      if (!dsId) return
      if (isChunkLoadingRef.current) {
        warnCell(t('dataset.editLockedWhileLoading'))
        return
      }
      const variable = useDatasetStore.getState().variables[colIndex]
      if (!variable) return
      if (useDatasetStore.getState().variables.length <= 1) {
        warnCell(t('dataset.cannotDeleteLastColumn'))
        return
      }
      void window.api.variable
        .delete({ datasetId: dsId, colId: variable.colId })
        .then(() => window.api.variable.getAll({ datasetId: dsId }))
        .then(updated => {
          useDatasetStore.getState().setVariables(updated)
        })
        .catch((err: unknown) => {
          console.error('Delete column failed:', err)
        })
    },
    [isChunkLoadingRef, warnCell, t]
  )

  return { insertRow, deleteRows, insertColumn, deleteColumn }
}
