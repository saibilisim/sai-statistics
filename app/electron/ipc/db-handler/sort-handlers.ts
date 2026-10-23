// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { IPC } from '../../../shared/ipc-contracts'
import type { TransformResult } from '../../../shared/ipc-contracts'
import {
  SortRequestSchema,
  SortMultiRequestSchema,
  IdentifyDuplicatesRequestSchema
} from '../../../shared/ipc-schemas'
import { isValidVariableName, namesEqual } from '../../../shared/variable-name'
import { VariableSchema, type Variable } from '../../../shared/data-types'
import log from 'electron-log'
import { handleValidated } from '../security'
import { captureForMutation } from '../undo-manager'
import { getDbConnection, getDatasetOrThrow, setDatasetModified } from './state'

export function registerSortHandlers(): void {
  // 10. data:sort — colId + direction ('asc'|'desc') are enforced by the schema.
  handleValidated(IPC.DATA_SORT, SortRequestSchema, async (req): Promise<void> => {
    const conn = await getDbConnection()
    const dataset = getDatasetOrThrow(req.datasetId)

    const tableName = `dataset_${req.datasetId}`
    const variable = dataset.variables.find(v => v.colId === req.colId)
    if (!variable) {
      throw new Error(`Column not found: ${req.colId}`)
    }
    const sqlDirection = req.direction === 'asc' ? 'ASC' : 'DESC'

    await captureForMutation(req.datasetId)
    // Re-order __row_idx according to the sort order
    const tempTableName = `temp_sort_${req.datasetId}`
    await conn.runAndReadAll(`DROP TABLE IF EXISTS ${tempTableName}`)

    const sql = `CREATE TABLE ${tempTableName} AS SELECT ROW_NUMBER() OVER (ORDER BY "${
      req.colId
    }" ${sqlDirection} NULLS LAST) - 1 AS new_row_idx, * EXCLUDE (__row_idx) FROM ${tableName}`
    await conn.runAndReadAll(sql)
    await conn.runAndReadAll(`DROP TABLE ${tableName}`)
    await conn.runAndReadAll(`ALTER TABLE ${tempTableName} RENAME TO ${tableName}`)
    await conn.runAndReadAll(`ALTER TABLE ${tableName} RENAME COLUMN new_row_idx TO __row_idx`)

    setDatasetModified(dataset, true)
    log.info(`Sorted dataset ${req.datasetId} by column ${req.colId} ${req.direction}`)
  })

  // 10b. data:sort-multi — Sort Cases (Data menu): same rebuild as data:sort,
  // generalised to an ordered list of {colId, direction} keys.
  handleValidated(IPC.DATA_SORT_MULTI, SortMultiRequestSchema, async (req): Promise<void> => {
    const conn = await getDbConnection()
    const dataset = getDatasetOrThrow(req.datasetId)

    const tableName = `dataset_${req.datasetId}`
    for (const key of req.keys) {
      if (!dataset.variables.some(v => v.colId === key.colId)) {
        throw new Error(`Column not found: ${key.colId}`)
      }
    }
    const orderBy = req.keys
      .map(k => `"${k.colId}" ${k.direction === 'asc' ? 'ASC' : 'DESC'}`)
      .join(', ')

    await captureForMutation(req.datasetId)
    const tempTableName = `temp_sortmulti_${req.datasetId}`
    await conn.runAndReadAll(`DROP TABLE IF EXISTS ${tempTableName}`)

    const sql = `CREATE TABLE ${tempTableName} AS SELECT ROW_NUMBER() OVER (ORDER BY ${orderBy} NULLS LAST) - 1 AS new_row_idx, * EXCLUDE (__row_idx) FROM ${tableName}`
    await conn.runAndReadAll(sql)
    await conn.runAndReadAll(`DROP TABLE ${tableName}`)
    await conn.runAndReadAll(`ALTER TABLE ${tempTableName} RENAME TO ${tableName}`)
    await conn.runAndReadAll(`ALTER TABLE ${tableName} RENAME COLUMN new_row_idx TO __row_idx`)

    setDatasetModified(dataset, true)
    log.info(`Sorted dataset ${req.datasetId} by ${String(req.keys.length)} key(s)`)
  })

  // 10c. data:identify-duplicates — Identify Duplicate Cases (Data menu):
  // adds a primary-indicator (1 = first case in its matching group) and a
  // match-sequence (1-based rank within the group, by current row order; 0
  // for unduplicated cases), mirroring SPSS's PrimaryFirst/MatchSequence.
  handleValidated(
    IPC.DATA_IDENTIFY_DUPLICATES,
    IdentifyDuplicatesRequestSchema,
    async (req): Promise<TransformResult> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)

      for (const c of req.matchColIds) {
        if (!dataset.variables.some(v => v.colId === c)) {
          throw new Error(`Column not found: ${c}`)
        }
      }
      // Case-insensitive, like every other variable-name check.
      if (dataset.variables.some(v => namesEqual(v.name, req.primaryName))) {
        throw new Error(`Variable already exists: ${req.primaryName}`)
      }
      if (dataset.variables.some(v => namesEqual(v.name, req.sequenceName))) {
        throw new Error(`Variable already exists: ${req.sequenceName}`)
      }
      if (namesEqual(req.primaryName, req.sequenceName)) {
        throw new Error(`Variable already exists: ${req.sequenceName}`)
      }
      if (!isValidVariableName(req.primaryName) || !isValidVariableName(req.sequenceName)) {
        throw new Error('Invalid variable name')
      }

      const tableName = `dataset_${req.datasetId}`
      await captureForMutation(req.datasetId)

      const primaryColId = `col_${String(dataset.nextColSeq)}`
      dataset.nextColSeq++
      const sequenceColId = `col_${String(dataset.nextColSeq)}`
      dataset.nextColSeq++

      await conn.runAndReadAll(`ALTER TABLE ${tableName} ADD COLUMN "${primaryColId}" DOUBLE`)
      await conn.runAndReadAll(`ALTER TABLE ${tableName} ADD COLUMN "${sequenceColId}" DOUBLE`)

      // SPSS MatchSequence: 1..n within a group of duplicates, but 0 for a
      // case that has no duplicate at all (so "MatchSequence > 0" selects
      // exactly the duplicated cases).
      const partitionBy = req.matchColIds.map(c => `"${c}"`).join(', ')
      const updateSql = `
        UPDATE ${tableName}
        SET "${sequenceColId}" = CASE WHEN sub.grp_n = 1 THEN 0 ELSE sub.seq END,
            "${primaryColId}" = CASE WHEN sub.seq = 1 THEN 1 ELSE 0 END
        FROM (
          SELECT __row_idx,
                 ROW_NUMBER() OVER (PARTITION BY ${partitionBy} ORDER BY __row_idx) AS seq,
                 COUNT(*) OVER (PARTITION BY ${partitionBy}) AS grp_n
          FROM ${tableName}
        ) sub
        WHERE ${tableName}.__row_idx = sub.__row_idx
      `
      await conn.runAndReadAll(updateSql)

      const primaryVar: Variable = VariableSchema.parse({
        colId: primaryColId,
        name: req.primaryName,
        label: req.primaryLabel ?? '',
        type: 'numeric',
        measure: 'nominal',
        width: 8,
        decimals: 0,
        columns: 8,
        align: 'right',
        valueLabels: { '0': 'Duplicate', '1': 'Primary' },
        missing: null,
        role: 'input'
      })
      const sequenceVar: Variable = VariableSchema.parse({
        colId: sequenceColId,
        name: req.sequenceName,
        label: req.sequenceLabel ?? '',
        type: 'numeric',
        measure: 'scale',
        width: 8,
        decimals: 0,
        columns: 8,
        align: 'right',
        valueLabels: {},
        missing: null,
        role: 'input'
      })
      dataset.variables.push(primaryVar, sequenceVar)
      setDatasetModified(dataset, true)

      log.info(`Identify duplicates applied on dataset ${req.datasetId}`)
      return { variables: dataset.variables, rowCount: dataset.rowCount }
    }
  )
}
