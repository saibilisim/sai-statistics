// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * rview-tables.ts — DuckDB temp tables behind the R console's View() grid
 * (Faz T3). R writes a Parquet snapshot; it is loaded once into an in-memory
 * table, and the renderer pages/sorts rows out of it — so a 500k-row data
 * frame opens instantly and the grid never holds more than a page.
 *
 * Read-only and separate from the dataset tables (`dataset_*`): nothing here
 * can touch the user's data. The Parquet path comes from r-session.ts, which
 * only accepts files inside the session's own side directory; the sort column
 * is checked against the table's own column list (identifier allow-list).
 */
import { unlink } from 'fs/promises'
import log from 'electron-log'
import type { TerminalRViewPayload } from '../../../shared/ipc-contracts'
import type { TerminalRViewRowsRequest } from '../../../shared/ipc-schemas'
import { getDbConnection } from './state'

/** Most View() grids kept at once; the oldest is dropped beyond this. */
const MAX_VIEWS = 20

let seq = 0
interface RView {
  columns: string[]
  /** SELECT list that yields only JSON-safe values (number/string/boolean). */
  projection: string
}
const views = new Map<string, RView>()

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`

const NUMERIC_TYPE =
  /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|DECIMAL)/

/** Numbers → DOUBLE, booleans/text as-is, everything else (dates, times, …) → text. */
function projectColumn(name: string, type: string): string {
  const id = quoteIdent(name)
  if (NUMERIC_TYPE.test(type)) return `CAST(${id} AS DOUBLE)`
  if (type === 'BOOLEAN' || type === 'VARCHAR') return id
  return `CAST(${id} AS VARCHAR)`
}

/** Load a View() Parquet snapshot into a temp table; the file is deleted afterwards. */
export async function loadRView(parquetPath: string, title: string): Promise<TerminalRViewPayload> {
  const conn = await getDbConnection()
  const viewId = `rview_${String(++seq)}`
  // COPY/read_parquet paths can't be bound as parameters; the path was
  // validated by the caller (inside the session side dir, no quotes).
  const literal = parquetPath.replace(/\\/g, '/').replace(/'/g, "''")
  try {
    await conn.run(`CREATE TEMP TABLE ${viewId} AS SELECT * FROM read_parquet('${literal}')`)
    const described = await conn.runAndReadAll(`DESCRIBE ${viewId}`)
    const columns = described.getRowObjects().map(r => ({
      name: String(r['column_name']),
      type: String(r['column_type'])
    }))
    const counted = await conn.runAndReadAll(`SELECT COUNT(*) AS n FROM ${viewId}`)
    const rowCount = Number(counted.getRowObjects()[0]?.['n'] ?? 0)
    views.set(viewId, {
      columns: columns.map(c => c.name),
      projection: columns.map(c => projectColumn(c.name, c.type)).join(', ') || '*'
    })
    while (views.size > MAX_VIEWS) {
      const oldest = views.keys().next().value
      if (oldest === undefined) break
      await dropRView(oldest)
    }
    return { viewId, title, columns, rowCount }
  } finally {
    await unlink(parquetPath).catch(() => undefined)
  }
}

/** One page of a View() table, optionally sorted by one of its columns. */
export async function readRViewRows(
  req: TerminalRViewRowsRequest
): Promise<(string | number | boolean | null)[][]> {
  const view = views.get(req.viewId)
  if (!view) throw new Error(`View not found: ${req.viewId}`)
  let orderBy = ''
  if (req.sortCol !== undefined) {
    if (!view.columns.includes(req.sortCol)) throw new Error('Unknown sort column')
    orderBy = ` ORDER BY ${quoteIdent(req.sortCol)} ${req.sortDir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`
  }
  const conn = await getDbConnection()
  const prepared = await conn.prepare(
    `SELECT ${view.projection} FROM ${req.viewId}${orderBy} LIMIT ? OFFSET ?`
  )
  prepared.bind([req.limit, req.offset])
  const reader = await prepared.runAndReadAll()
  return reader.getRows() as (string | number | boolean | null)[][]
}

export async function dropRView(viewId: string): Promise<void> {
  if (!views.delete(viewId)) return
  try {
    const conn = await getDbConnection()
    await conn.run(`DROP TABLE IF EXISTS ${viewId}`)
  } catch (err) {
    log.warn(`[rview] drop ${viewId} failed: ${String(err)}`)
  }
}

/** Drop every View() table (session restart / shutdown). */
export async function dropAllRViews(): Promise<void> {
  for (const id of [...views.keys()]) await dropRView(id)
}
