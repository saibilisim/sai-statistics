// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * End-to-end check of the import-time inference against a real DuckDB, since
 * every interesting decision is made by SQL the unit tests cannot reach.
 *
 * The table is built entirely of VARCHAR columns on purpose: that is exactly
 * what read_xlsx(all_varchar=true) hands the importer, and it is the shape in
 * which both reported symptoms appeared — coded categories arriving as Scale
 * and Turkish-notation numbers arriving as text/Nominal.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import { getDbConnection } from '../../electron/ipc/db-handler'
import { buildVariablesFromTempTable } from '../../electron/ipc/file-handler/shared'
import type { Variable } from '../../shared/data-types'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showMessageBox: vi.fn(), showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  // getName/getPath are what electron-store needs — shared.ts reaches i18n,
  // which builds a settings Store at module scope.
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd(),
    getName: () => 'sai-statistics-test',
    getVersion: () => '0.0.0'
  },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: vi.fn() }
}))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

// electron/i18n.ts builds a settings Store at module load; outside a real
// Electron process it has no userData path to write to. Inference then falls
// back to its own defaults (threshold 24), which is what we want to test.
vi.mock('electron-store', () => ({
  default: class {
    store: Record<string, unknown> = {}
    get(): undefined {
      return undefined
    }
    set(): void {
      /* no-op */
    }
  }
}))

const TABLE = 'temp_import_inference_test'

/** id has 30 distinct values so it lands above the default threshold of 24. */
const ROWS = Array.from({ length: 30 }, (_, i) => {
  const q = (s: string): string => `'${s}'`
  return [
    q(String(i + 1)), // id       — many distinct integers
    q(i % 2 === 0 ? '1' : '2'), // gender   — coded category
    q(i % 2 === 0 ? '3,14' : '2,71'), // score    — Turkish decimal comma
    q(i % 2 === 0 ? '1.234,56' : '2.000,00'), // price    — TR thousands + decimal
    q(i % 2 === 0 ? '1,234.56' : '2,000.10'), // usd      — EN thousands + decimal
    q(i % 2 === 0 ? '1,234' : '5,678'), // grouped  — thousands only
    q(i % 2 === 0 ? '1.2.3' : '1.2.4'), // version  — not a number
    q(`${String((i % 28) + 1).padStart(2, '0')}.02.2024`), // hiredate
    q(i % 2 === 0 ? 'ankara' : 'izmir'), // city     — text category
    `'﻿' || '${String(i + 1)}'`, // bom      — BOM-prefixed number
    q('') // blank    — no evidence at all
  ].join(', ')
})

const COLS = [
  'id',
  'gender',
  'score',
  'price',
  'usd',
  'grouped',
  'version',
  'hiredate',
  'city',
  'bom',
  'blank'
]

function byName(vars: Variable[], label: string): Variable {
  const found = vars.find(v => v.label === label)
  if (!found) throw new Error(`no variable for column ${label}`)
  return found
}

describe('import type & measure inference', () => {
  let variables: Variable[]

  beforeAll(async () => {
    const conn = await getDbConnection()
    await conn.runAndReadAll(`DROP TABLE IF EXISTS ${TABLE}`)
    await conn.runAndReadAll(
      `CREATE TABLE ${TABLE} AS SELECT * FROM (VALUES ${ROWS.map(r => `(${r})`).join(', ')}) AS v(${COLS.join(', ')})`
    )
    variables = (await buildVariablesFromTempTable(conn, TABLE)).variables
  })

  it('keeps a high-cardinality integer column Scale', () => {
    const id = byName(variables, 'id')
    expect(id.type).toBe('numeric')
    expect(id.measure).toBe('scale')
  })

  it('imports a 1/2-coded column as Nominal instead of Scale', () => {
    const gender = byName(variables, 'gender')
    expect(gender.type).toBe('numeric')
    expect(gender.measure).toBe('nominal')
  })

  it('reads decimal-comma values as numbers, not text', async () => {
    const score = byName(variables, 'score')
    expect(score.type).toBe('numeric')
    expect(score.measure).toBe('scale')

    const conn = await getDbConnection()
    const rows = (await conn.runAndReadAll(`SELECT DISTINCT score FROM ${TABLE} ORDER BY 1`))
      .getRows()
      .map(r => Number(r[0]))
    expect(rows).toEqual([2.71, 3.14])
  })

  it('reads both thousands/decimal conventions with the right value', async () => {
    expect(byName(variables, 'price').type).toBe('numeric')
    expect(byName(variables, 'usd').type).toBe('numeric')

    const conn = await getDbConnection()
    const row = (
      await conn.runAndReadAll(`SELECT MIN(price), MAX(price), MIN(usd), MAX(usd) FROM ${TABLE}`)
    ).getRows()[0]
    expect(row?.map(Number)).toEqual([1234.56, 2000, 1234.56, 2000.1])
  })

  it('treats a strictly grouped comma column as thousands separators', async () => {
    expect(byName(variables, 'grouped').type).toBe('numeric')
    const conn = await getDbConnection()
    const rows = (await conn.runAndReadAll(`SELECT DISTINCT grouped FROM ${TABLE} ORDER BY 1`))
      .getRows()
      .map(r => Number(r[0]))
    expect(rows).toEqual([1234, 5678])
  })

  it('does not turn version strings into numbers', () => {
    const version = byName(variables, 'version')
    expect(version.type).toBe('string')
    expect(version.measure).toBe('nominal')
  })

  it('recognises dd.MM.yyyy dates and calls them Scale', () => {
    const hiredate = byName(variables, 'hiredate')
    expect(hiredate.type).toBe('date')
    expect(hiredate.measure).toBe('scale')
  })

  it('keeps text categories Nominal', () => {
    expect(byName(variables, 'city').type).toBe('string')
    expect(byName(variables, 'city').measure).toBe('nominal')
  })

  it('survives a BOM-prefixed numeric column instead of failing the import', async () => {
    // The old path classified this as numeric and then let the loader run a
    // bare CAST over it, which DuckDB answers with a hard conversion error.
    const bom = byName(variables, 'bom')
    expect(bom.type).toBe('numeric')
    const conn = await getDbConnection()
    const max = (await conn.runAndReadAll(`SELECT MAX(bom) FROM ${TABLE}`)).getRows()[0]?.[0]
    expect(Number(max)).toBe(30)
  })

  it('leaves an all-empty column as text', () => {
    expect(byName(variables, 'blank').type).toBe('string')
  })
})

/**
 * CSV and .sav/.dta arrive already typed (read_csv_auto sniffs, read_stat
 * reports real types), so those columns skip the text passes entirely — the
 * measurement level still has to be decided for them.
 */
describe('measure inference on already-typed columns', () => {
  const TYPED = 'temp_import_typed_test'

  it('separates coded integers from continuous values without any text pass', async () => {
    const conn = await getDbConnection()
    await conn.runAndReadAll(`DROP TABLE IF EXISTS ${TYPED}`)
    await conn.runAndReadAll(
      `CREATE TABLE ${TYPED} AS
       SELECT i AS pid, (i % 3) AS grp, i * 1.5 AS weight
       FROM range(1, 101) t(i)`
    )
    const { variables: vars } = await buildVariablesFromTempTable(conn, TYPED)

    expect(byName(vars, 'pid').measure).toBe('scale') // 100 distinct integers
    expect(byName(vars, 'grp').measure).toBe('nominal') // 3 distinct integers
    expect(byName(vars, 'weight').measure).toBe('scale') // fractional
  })
})
