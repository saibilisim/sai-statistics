// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { buildFilterWhere } from '../../../shared/data-filter'
import log from 'electron-log'
import { getDbConnection, getDatasetOrThrow } from './state'

// ─── Analysis support ─────────────────────────────────────────────────────────

/**
 * Export a (filtered) dataset table to a temporary Parquet file for R analysis.
 * Returns the absolute path of the created Parquet file.
 * Caller is responsible for deleting the file after use.
 */
export async function exportDatasetToParquet(
  datasetId: string,
  columnFilters: Record<string, { operator: string; value: string }>
): Promise<string> {
  const conn = await getDbConnection()
  const dataset = getDatasetOrThrow(datasetId)

  const tableName = `dataset_${datasetId}`
  const parquetPath = join(tmpdir(), `sai-export-${randomUUID()}.parquet`)

  // Build WHERE clause from column filters (may be empty)
  const { sql: where, params } = buildFilterWhere(columnFilters, dataset.variables)

  const whereClause = where ? ` WHERE ${where}` : ''

  // DuckDB COPY TO with Parquet format
  // The parquetPath must be a string literal in the SQL — we use a prepared
  // statement with the path as a parameter via a workaround: DuckDB's COPY TO
  // does not support parameterised file paths, so we build the path as a quoted
  // string. The path itself comes from os.tmpdir() + randomUUID(), never from
  // user input, so interpolation is safe here.
  // tmpdir() lives under the user profile — a `'` in the user name (O'Connor)
  // would end the literal, so it is doubled like the other path literals.
  const safePath = parquetPath.replace(/\\/g, '/').replace(/'/g, "''")

  if (params.length > 0) {
    // We need to use a CTE or subquery with parameters for the WHERE clause,
    // then COPY that to parquet. DuckDB supports COPY (query) TO ...
    const innerSql = `SELECT * FROM ${tableName}${whereClause}`
    const copySql = `COPY (${innerSql}) TO '${safePath}' (FORMAT PARQUET)`
    const prepared = await conn.prepare(copySql)
    prepared.bind(params)
    await prepared.run()
  } else {
    await conn.runAndReadAll(`COPY (SELECT * FROM ${tableName}) TO '${safePath}' (FORMAT PARQUET)`)
  }

  log.info(`[db-handler] exported dataset ${datasetId} to ${parquetPath}`)
  return parquetPath
}

/**
 * Export a dataset to Parquet for the R CONSOLE bridge (Faz T2). Unlike the
 * analysis export, columns are projected to their user-facing variable NAMES
 * (not internal colIds) and the internal `__row_idx` is dropped — so `data` in
 * R reads like the Variable View. Read-only snapshot: variable names are unique
 * + valid identifiers, and nothing is written back, so this can't affect the
 * DuckDB master or the colId identity scheme.
 */
export async function exportDatasetForConsole(datasetId: string): Promise<string> {
  const conn = await getDbConnection()
  const dataset = getDatasetOrThrow(datasetId)
  if (dataset.variables.length === 0) throw new Error(`Dataset has no variables: ${datasetId}`)

  const tableName = `dataset_${datasetId}`
  const parquetPath = join(tmpdir(), `sai-rconsole-${randomUUID()}.parquet`).replace(/\\/g, '/')
  const projection = dataset.variables
    .map(v => `"${v.colId}" AS "${v.name.replace(/"/g, '""')}"`)
    .join(', ')

  await conn.runAndReadAll(
    `COPY (SELECT ${projection} FROM ${tableName} ORDER BY __row_idx) TO '${parquetPath.replace(/'/g, "''")}' (FORMAT PARQUET)`
  )
  log.info(`[db-handler] exported dataset ${datasetId} for R console to ${parquetPath}`)
  return parquetPath
}
