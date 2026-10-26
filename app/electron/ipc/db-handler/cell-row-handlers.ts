// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { IPC } from '../../../shared/ipc-contracts'
import {
  UpdateCellRequestSchema,
  UpdateCellsRequestSchema,
  InsertRowRequestSchema,
  AppendRowsRequestSchema,
  RowIndicesRequestSchema
} from '../../../shared/ipc-schemas'
import type { CellValue } from '../../../shared/data-types'
import log from 'electron-log'
import { handleSerialized } from './serialized-handler'
import { captureForMutation } from '../undo-manager'
import { getDbConnection, getDatasetOrThrow, setDatasetModified } from './state'
import { parseLocalizedNumber } from './value-utils'

export function registerCellRowHandlers(): void {
  // 3. data:update-cell
  handleSerialized(IPC.DATA_UPDATE_CELL, UpdateCellRequestSchema, async (req): Promise<void> => {
    const conn = await getDbConnection()
    const dataset = getDatasetOrThrow(req.datasetId)

    const tableName = `dataset_${req.datasetId}`
    const variable = dataset.variables.find(v => v.colId === req.colId)
    if (!variable) {
      throw new Error(`Column not found: ${req.colId}`)
    }

    const sql = `UPDATE ${tableName} SET "${req.colId}" = ? WHERE __row_idx = ?`
    const prepared = await conn.prepare(sql)

    // The renderer always sends a primitive CellValue, so no unwrap here.
    const val: CellValue = variable.type === 'numeric' ? parseLocalizedNumber(req.value) : req.value

    // Bind all arguments as an array matching placeholder order
    prepared.bind([val, req.rowIndex])
    await prepared.run()
    setDatasetModified(dataset, true)
  })

  // 3b. data:update-cells (batch)
  handleSerialized(IPC.DATA_UPDATE_CELLS, UpdateCellsRequestSchema, async (req): Promise<void> => {
    const conn = await getDbConnection()
    const dataset = getDatasetOrThrow(req.datasetId)

    const tableName = `dataset_${req.datasetId}`
    const validColIds = new Set(dataset.variables.map(v => v.colId))

    // colId format is enforced by the schema; here we only check existence.
    for (const u of req.updates) {
      if (!validColIds.has(u.colId)) throw new Error(`Column not found: ${u.colId}`)
    }

    // Prepared statements cached per colId to avoid re-preparing the same SQL.
    // One transaction: a failure half-way must not leave a partial paste, and
    // thousands of single-statement commits are the slow path.
    const stmtCache = new Map<string, Awaited<ReturnType<typeof conn.prepare>>>()
    await conn.run('BEGIN TRANSACTION')
    try {
      for (const u of req.updates) {
        let stmt = stmtCache.get(u.colId)
        if (!stmt) {
          stmt = await conn.prepare(`UPDATE ${tableName} SET "${u.colId}" = ? WHERE __row_idx = ?`)
          stmtCache.set(u.colId, stmt)
        }
        const variable = dataset.variables.find(v => v.colId === u.colId)
        const val: CellValue =
          variable?.type === 'numeric' ? parseLocalizedNumber(u.value) : u.value

        stmt.bind([val, u.rowIndex])
        await stmt.run()
      }
      await conn.run('COMMIT')
    } catch (err) {
      await conn.run('ROLLBACK').catch(() => undefined)
      throw err
    }

    setDatasetModified(dataset, true)
  })

  // 4. data:insert-row
  handleSerialized(IPC.DATA_INSERT_ROW, InsertRowRequestSchema, async (req): Promise<void> => {
    const conn = await getDbConnection()
    const dataset = getDatasetOrThrow(req.datasetId)

    await captureForMutation(req.datasetId)
    const tableName = `dataset_${req.datasetId}`

    // Shift subsequent rows down
    const shiftSql = `UPDATE ${tableName} SET __row_idx = __row_idx + 1 WHERE __row_idx >= ?`
    const shiftPrep = await conn.prepare(shiftSql)
    shiftPrep.bind([req.rowIndex])
    await shiftPrep.run()

    // Insert new empty row. It gets a fresh, never-reused case id so no
    // existing cell format/formula can be inherited by the new blank row —
    // the bug this column exists to prevent.
    const caseId = dataset.nextCaseSeq ?? dataset.rowCount
    dataset.nextCaseSeq = caseId + 1
    const insertSql = `INSERT INTO ${tableName} (__row_idx, __case_id) VALUES (?, ?)`
    const insertPrep = await conn.prepare(insertSql)
    insertPrep.bind([req.rowIndex, caseId])
    await insertPrep.run()

    dataset.rowCount += 1
    setDatasetModified(dataset, true)
    log.info(`Row inserted at index ${String(req.rowIndex)} in dataset ${req.datasetId}`)
  })

  // 4b. data:append-rows — bulk append at the end (paste growth). A single
  // captureForMutation snapshot + a single rowCount/dataVersion update for
  // N rows, instead of N data:insert-row round trips (each of which would
  // otherwise bump dataVersion and trigger a full DataView reload N times).
  handleSerialized(IPC.DATA_APPEND_ROWS, AppendRowsRequestSchema, async (req): Promise<void> => {
    const conn = await getDbConnection()
    const dataset = getDatasetOrThrow(req.datasetId)

    await captureForMutation(req.datasetId)
    const tableName = `dataset_${req.datasetId}`

    const insertPrep = await conn.prepare(
      `INSERT INTO ${tableName} (__row_idx, __case_id) VALUES (?, ?)`
    )
    const startRowIdx = dataset.rowCount
    const startCaseId = dataset.nextCaseSeq ?? dataset.rowCount
    for (let i = 0; i < req.count; i++) {
      insertPrep.bind([startRowIdx + i, startCaseId + i])
      await insertPrep.run()
    }
    dataset.nextCaseSeq = startCaseId + req.count
    dataset.rowCount += req.count
    setDatasetModified(dataset, true)
    log.info(`Appended ${String(req.count)} rows to dataset ${req.datasetId}`)
  })

  // 5. data:delete-rows — indices are schema-validated as non-negative integers.
  handleSerialized(IPC.DATA_DELETE_ROWS, RowIndicesRequestSchema, async (req): Promise<void> => {
    if (req.rowIndices.length === 0) return

    const conn = await getDbConnection()
    const dataset = getDatasetOrThrow(req.datasetId)

    // Main is the trust boundary: duplicates / out-of-range indices would make
    // the caller's idea of the row count diverge from what was really deleted.
    const uniqueIndices = [...new Set(req.rowIndices)].filter(i => i < dataset.rowCount)
    if (uniqueIndices.length === 0) return

    await captureForMutation(req.datasetId)
    const tableName = `dataset_${req.datasetId}`
    const indicesStr = uniqueIndices.join(', ')

    // Delete matched rows
    await conn.runAndReadAll(`DELETE FROM ${tableName} WHERE __row_idx IN (${indicesStr})`)

    // Re-index to keep __row_idx sequential and contiguous
    const tempTableName = `temp_reindex_${req.datasetId}`
    await conn.runAndReadAll(`DROP TABLE IF EXISTS ${tempTableName}`)
    await conn.runAndReadAll(
      `CREATE TABLE ${tempTableName} AS SELECT ROW_NUMBER() OVER (ORDER BY __row_idx) - 1 AS new_row_idx, * EXCLUDE (__row_idx) FROM ${tableName}`
    )
    await conn.runAndReadAll(`DROP TABLE ${tableName}`)
    await conn.runAndReadAll(`ALTER TABLE ${tempTableName} RENAME TO ${tableName}`)
    await conn.runAndReadAll(`ALTER TABLE ${tableName} RENAME COLUMN new_row_idx TO __row_idx`)

    const countReader = await conn.runAndReadAll(`SELECT COUNT(*) FROM ${tableName}`)
    dataset.rowCount = Number(
      countReader.getRows()[0]?.[0] ?? dataset.rowCount - uniqueIndices.length
    )
    setDatasetModified(dataset, true)
    log.info(`Deleted ${String(uniqueIndices.length)} rows in dataset ${req.datasetId}`)
  })

  // 5b. data:reorder-rows — indices are schema-validated as non-negative integers.
  handleSerialized(IPC.DATA_REORDER_ROWS, RowIndicesRequestSchema, async (req): Promise<void> => {
    if (req.rowIndices.length === 0) return

    const conn = await getDbConnection()
    const dataset = getDatasetOrThrow(req.datasetId)

    // The rebuild below is an INNER JOIN on the given order — any row missing
    // from it would be dropped for good (e.g. a drag while a large dataset is
    // still streaming in, when the grid only knows the rows loaded so far).
    // Accept only a full permutation of the current rows.
    const seen = new Set(req.rowIndices)
    if (
      req.rowIndices.length !== dataset.rowCount ||
      seen.size !== dataset.rowCount ||
      req.rowIndices.some(i => i >= dataset.rowCount)
    ) {
      throw new Error('Row order must list every row exactly once')
    }

    await captureForMutation(req.datasetId)
    const tableName = `dataset_${req.datasetId}`
    const valuesStr = req.rowIndices
      .map((oldIdx, ord) => `(${String(oldIdx)}, ${String(ord)})`)
      .join(', ')

    const tempTableName = `temp_reorder_${req.datasetId}`
    await conn.runAndReadAll(`DROP TABLE IF EXISTS ${tempTableName}`)

    const query = `
        CREATE TABLE ${tempTableName} AS 
        SELECT ROW_NUMBER() OVER (ORDER BY m.ord) - 1 AS new_row_idx, t.* EXCLUDE (__row_idx)
        FROM (
          VALUES ${valuesStr}
        ) m(old_idx, ord)
        JOIN ${tableName} t ON t.__row_idx = m.old_idx
      `
    await conn.runAndReadAll(query)
    await conn.runAndReadAll(`DROP TABLE ${tableName}`)
    await conn.runAndReadAll(`ALTER TABLE ${tempTableName} RENAME TO ${tableName}`)
    await conn.runAndReadAll(`ALTER TABLE ${tableName} RENAME COLUMN new_row_idx TO __row_idx`)

    setDatasetModified(dataset, true)
    log.info(`Reordered rows in dataset ${req.datasetId}`)
  })
}
