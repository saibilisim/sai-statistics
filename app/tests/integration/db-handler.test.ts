// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { getDbConnection, loadDatasetIntoDb } from '../../electron/ipc/db-handler'
import type { Variable } from '../../shared/data-types'

// Mock Electron and electron-log
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}))

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))

describe('DuckDB Integration Tests', () => {
  beforeAll(async () => {
    // Ensure connection is established
    await getDbConnection()
  })

  it('should create database connection and register a dataset', async () => {
    const conn = await getDbConnection()
    expect(conn).toBeDefined()

    // 1. Create a mock source temp table (using VARCHAR for numeric column to test auto-casting)
    const tempTable = 'temp_test_table'
    await conn.runAndReadAll(`CREATE TABLE ${tempTable} (col_num VARCHAR, col_str VARCHAR)`)
    await conn.runAndReadAll(`INSERT INTO ${tempTable} VALUES ('1.5', 'hello'), ('2.7', 'world')`)

    // 2. Load into DB
    const datasetId = 'ds_test_id'
    const name = 'Test Dataset'
    const variables: Variable[] = [
      {
        name: 'col_num',
        type: 'numeric',
        width: 8,
        decimals: 2,
        label: 'Numeric Col',
        valueLabels: {},
        missing: null,
        columns: 8,
        align: 'right',
        measure: 'scale',
        role: 'both'
      },
      {
        name: 'col_str',
        type: 'string',
        width: 20,
        decimals: 0,
        label: 'String Col',
        valueLabels: {},
        missing: null,
        columns: 8,
        align: 'left',
        measure: 'nominal',
        role: 'both'
      }
    ]

    const dataset = await loadDatasetIntoDb(datasetId, name, null, variables, tempTable)

    expect(dataset.id).toBe(datasetId)
    expect(dataset.name).toBe(name)
    expect(dataset.rowCount).toBe(2)
    expect(dataset.variables).toHaveLength(2)

    // 3. Verify content
    const reader = await conn.runAndReadAll(`SELECT * FROM dataset_${datasetId} ORDER BY __row_idx`)
    const rows = reader.getRows() as unknown[][]
    expect(rows).toHaveLength(2)
    expect(rows[0][0]).toBe(0n) // __row_idx
    expect(rows[0][1]).toBe(0n) // __case_id — equals the row index on import
    expect(rows[0][2]).toBe(1.5) // col_num
    expect(rows[0][3]).toBe('hello') // col_str

    // Permanent case identity (denetim raporu §2): assigned in row order and
    // the allocator points past the last one, so an inserted row can never
    // reuse an id an existing customStyles entry is keyed on.
    expect(rows[1][1]).toBe(1n)
    expect(dataset.nextCaseSeq).toBe(2)
  })
})
