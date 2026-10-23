// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * undo-manager.ts — structural undo/redo for the data layer.
 *
 * The roadmap originally proposed zundo on the renderer store, but the data
 * lives in DuckDB (not the store), so a renderer-only undo would desync the grid
 * from the table. Instead we snapshot the DuckDB table + variable metadata in the
 * Main process before each *structural* mutation (insert/delete row/column, sort,
 * reorder, variable metadata) and restore it on undo. Cell *value* edits are not
 * captured here — those are owned by the grid's own in-cell undo (per
 * dataview-data-flow §9.3). Snapshots are full table copies, so the history
 * depth is capped.
 *
 * A snapshot is a cheap `CREATE TABLE … AS SELECT *` in the in-memory database;
 * restore is a `DROP` + `RENAME`, which consumes the snapshot table.
 */
import type { DuckDBConnection } from '@duckdb/node-api'
import { getDbConnection, loadedDatasets, setDatasetModified } from './db-handler'
import type { Variable } from '../../shared/data-types'
import log from 'electron-log'

const MAX_DEPTH = 25

interface UndoSnapshot {
  /** Name of the DuckDB table holding the snapshotted rows (incl. __row_idx). */
  snapTable: string
  variables: Variable[]
  rowCount: number
  nextColSeq: number
  /** Case-id allocator. The snapshot table keeps the __case_id VALUES (it is a
   *  `SELECT *` copy), but the counter lives in memory — without restoring it,
   *  undoing an insert then re-inserting would hand out an already-used id. */
  nextCaseSeq: number | undefined
}

interface DatasetHistory {
  undo: UndoSnapshot[]
  redo: UndoSnapshot[]
  seq: number
}

const histories = new Map<string, DatasetHistory>()

export interface UndoState {
  canUndo: boolean
  canRedo: boolean
}

function getHistory(datasetId: string): DatasetHistory {
  let h = histories.get(datasetId)
  if (!h) {
    h = { undo: [], redo: [], seq: 0 }
    histories.set(datasetId, h)
  }
  return h
}

function undoState(datasetId: string): UndoState {
  const h = histories.get(datasetId)
  return { canUndo: !!h && h.undo.length > 0, canRedo: !!h && h.redo.length > 0 }
}

async function dropTable(conn: DuckDBConnection, table: string): Promise<void> {
  await conn.runAndReadAll(`DROP TABLE IF EXISTS ${table}`)
}

/** Copies the live dataset table + metadata into a new snapshot. */
async function snapshot(conn: DuckDBConnection, datasetId: string): Promise<UndoSnapshot | null> {
  const dataset = loadedDatasets.get(datasetId)
  if (!dataset) return null
  const h = getHistory(datasetId)
  const snapTable = `__undo_${datasetId}_${String(h.seq++)}`
  await conn.runAndReadAll(`CREATE TABLE ${snapTable} AS SELECT * FROM dataset_${datasetId}`)
  return {
    snapTable,
    // Deep copy so later metadata edits don't mutate the captured state.
    variables: structuredClone(dataset.variables),
    rowCount: dataset.rowCount,
    nextColSeq: dataset.nextColSeq,
    nextCaseSeq: dataset.nextCaseSeq
  }
}

/** Restores a snapshot into the live dataset table + metadata (consumes it). */
async function restore(
  conn: DuckDBConnection,
  datasetId: string,
  snap: UndoSnapshot
): Promise<void> {
  const dataset = loadedDatasets.get(datasetId)
  if (!dataset) return
  await conn.runAndReadAll(`DROP TABLE IF EXISTS dataset_${datasetId}`)
  await conn.runAndReadAll(`ALTER TABLE ${snap.snapTable} RENAME TO dataset_${datasetId}`)
  dataset.variables = snap.variables
  dataset.rowCount = snap.rowCount
  dataset.nextColSeq = snap.nextColSeq
  // MONOTONIC, deliberately not a plain restore: undoing an insert removes the
  // row but not the customStyles entry the user may have put on it (that blob
  // lives in the renderer/.sdf). Rewinding the counter would hand the same id
  // to the next inserted row, which would then inherit that orphaned format —
  // the very bug __case_id exists to prevent. Ids are cheap; never reuse one.
  dataset.nextCaseSeq = Math.max(dataset.nextCaseSeq ?? 0, snap.nextCaseSeq ?? 0)
  setDatasetModified(dataset, true)
}

/**
 * Snapshots the current state *before* a structural mutation runs. Clears the
 * redo stack (a new edit invalidates redo) and trims history to MAX_DEPTH.
 */
export async function captureForMutation(datasetId: string): Promise<void> {
  const conn = await getDbConnection()
  const snap = await snapshot(conn, datasetId)
  if (!snap) return
  const h = getHistory(datasetId)

  // A fresh structural edit invalidates the redo branch.
  for (const r of h.redo) await dropTable(conn, r.snapTable)
  h.redo = []

  h.undo.push(snap)
  while (h.undo.length > MAX_DEPTH) {
    const oldest = h.undo.shift()
    if (oldest) await dropTable(conn, oldest.snapTable)
  }
}

export interface UndoResult extends UndoState {
  applied: boolean
  variables: Variable[]
  rowCount: number
}

async function step(datasetId: string, dir: 'undo' | 'redo'): Promise<UndoResult> {
  const conn = await getDbConnection()
  const dataset = loadedDatasets.get(datasetId)
  const h = histories.get(datasetId)
  const fromStack = dir === 'undo' ? h?.undo : h?.redo
  if (!dataset || !h || !fromStack || fromStack.length === 0) {
    return {
      applied: false,
      variables: dataset?.variables ?? [],
      rowCount: dataset?.rowCount ?? 0,
      ...undoState(datasetId)
    }
  }

  // Capture the current state onto the opposite stack so the step is reversible.
  const current = await snapshot(conn, datasetId)
  const target = fromStack.pop()
  if (!target) {
    return {
      applied: false,
      variables: dataset.variables,
      rowCount: dataset.rowCount,
      ...undoState(datasetId)
    }
  }
  if (current) (dir === 'undo' ? h.redo : h.undo).push(current)

  await restore(conn, datasetId, target)
  log.info(`Structural ${dir} applied for dataset ${datasetId}`)
  return {
    applied: true,
    variables: dataset.variables,
    rowCount: dataset.rowCount,
    ...undoState(datasetId)
  }
}

export function applyUndo(datasetId: string): Promise<UndoResult> {
  return step(datasetId, 'undo')
}

export function applyRedo(datasetId: string): Promise<UndoResult> {
  return step(datasetId, 'redo')
}

/** Drops all snapshot tables and clears history (on dataset close/replace). */
export async function clearUndoHistory(datasetId: string): Promise<void> {
  const h = histories.get(datasetId)
  if (!h) return
  const conn = await getDbConnection()
  for (const s of [...h.undo, ...h.redo]) await dropTable(conn, s.snapTable)
  histories.delete(datasetId)
}
