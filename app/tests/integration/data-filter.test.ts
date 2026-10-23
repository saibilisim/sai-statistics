// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { getDbConnection, loadDatasetIntoDb } from '../../electron/ipc/db-handler'
import { matchFilter, buildFilterWhere, type ColumnFilter } from '../../shared/data-filter'
import type { Variable, CellValue } from '../../shared/data-types'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}))

const mkVar = (name: string, type: Variable['type']): Variable => ({
  name,
  type,
  width: type === 'numeric' ? 8 : 20,
  decimals: type === 'numeric' ? 2 : 0,
  label: '',
  valueLabels: {},
  missing: null,
  columns: 8,
  align: type === 'numeric' ? 'right' : 'left',
  measure: type === 'numeric' ? 'scale' : 'nominal',
  role: 'both'
})

const DATASET_ID = 'ds_filter_parity'
const variables = [mkVar('yas', 'numeric'), mkVar('ad', 'string')]

/**
 * Guarantees the Data View's in-memory filter (matchFilter) and the analysis
 * layer's SQL filter (buildFilterWhere → DuckDB) select EXACTLY the same cases.
 * Divergence here would mean statistics silently run on the wrong population.
 */
describe('Filter parity: matchFilter (JS) vs buildFilterWhere (DuckDB)', () => {
  let memRows: { idx: number; yas: CellValue; ad: CellValue }[] = []

  beforeAll(async () => {
    const conn = await getDbConnection()
    const temp = 'temp_filter_parity'
    await conn.runAndReadAll(`DROP TABLE IF EXISTS ${temp}`)
    await conn.runAndReadAll(`CREATE TABLE ${temp} (yas DOUBLE, ad VARCHAR)`)
    await conn.runAndReadAll(
      `INSERT INTO ${temp} VALUES (20,'Ali'),(25,'veli'),(30,'Ayse'),(35,''),(NULL,'Mehmet'),(30,NULL)`
    )
    await loadDatasetIntoDb(DATASET_ID, 'Filter Parity', null, variables, temp)

    const reader = await conn.runAndReadAll(
      `SELECT __row_idx, "col_1", "col_2" FROM dataset_${DATASET_ID} ORDER BY __row_idx`
    )
    memRows = (reader.getRows() as CellValue[][]).map(r => ({
      idx: Number(r[0]),
      yas: typeof r[1] === 'bigint' ? Number(r[1]) : r[1],
      ad: typeof r[2] === 'bigint' ? Number(r[2]) : r[2]
    }))
  })

  const cases: { colId: 'col_1' | 'col_2'; field: 'yas' | 'ad'; filter: ColumnFilter }[] = [
    { colId: 'col_1', field: 'yas', filter: { operator: 'greater_than', value: '28' } },
    { colId: 'col_1', field: 'yas', filter: { operator: 'less_than_or_equal', value: '25' } },
    { colId: 'col_1', field: 'yas', filter: { operator: 'equals', value: '30' } },
    { colId: 'col_1', field: 'yas', filter: { operator: 'not_equals', value: '30' } },
    { colId: 'col_1', field: 'yas', filter: { operator: 'in', value: '["20","35"]' } },
    { colId: 'col_1', field: 'yas', filter: { operator: 'is_empty', value: '' } },
    { colId: 'col_1', field: 'yas', filter: { operator: 'is_not_empty', value: '' } },
    { colId: 'col_2', field: 'ad', filter: { operator: 'contains', value: 'a' } },
    { colId: 'col_2', field: 'ad', filter: { operator: 'equals', value: 'ali' } },
    { colId: 'col_2', field: 'ad', filter: { operator: 'starts_with', value: 'A' } },
    { colId: 'col_2', field: 'ad', filter: { operator: 'ends_with', value: 'i' } },
    { colId: 'col_2', field: 'ad', filter: { operator: 'in', value: '["ali","ayse"]' } },
    { colId: 'col_2', field: 'ad', filter: { operator: 'is_empty', value: '' } },
    { colId: 'col_2', field: 'ad', filter: { operator: 'is_not_empty', value: '' } }
  ]

  it.each(cases)('$colId $filter.operator "$filter.value"', async ({ colId, field, filter }) => {
    // In-memory (matchFilter)
    const memIdx = memRows
      .filter(r => matchFilter(r[field], filter.operator, filter.value))
      .map(r => r.idx)
      .sort((a, b) => a - b)

    // SQL (buildFilterWhere → DuckDB)
    const conn = await getDbConnection()
    const { sql: where, params } = buildFilterWhere({ [colId]: filter }, variables)
    const sql = `SELECT __row_idx FROM dataset_${DATASET_ID}${where ? ` WHERE ${where}` : ''} ORDER BY __row_idx`
    const prepared = await conn.prepare(sql)
    if (params.length > 0) prepared.bind(params)
    const reader = await prepared.runAndReadAll()
    const dbIdx = (reader.getRows() as unknown[][]).map(r => Number(r[0])).sort((a, b) => a - b)

    expect(dbIdx).toEqual(memIdx)
  })
})
