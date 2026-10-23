// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * dataset-lifecycle.test.ts — Main-process dataset bookkeeping that the
 * renderer depends on for data safety: the dirty-flag push (title "*" and the
 * New/Open/Import guard), the reorder permutation guard (a partial order used
 * to delete the missing rows), batch variable delete (never all of them; the
 * deleted column's filter goes too) and releasing a replaced dataset.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Variable } from '../../shared/data-types'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, raw: unknown) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, raw: unknown) => unknown) => {
      mocks.handlers.set(channel, fn)
    }
  },
  BrowserWindow: { fromWebContents: () => ({ fake: 'window' }) }
}))
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

const { IPC } = await import('../../shared/ipc-contracts')
const db = await import('../../electron/ipc/db-handler')
const state = await import('../../electron/ipc/db-handler/state')

db.registerDbHandlers()

const wc: Record<string, unknown> = {}
wc['mainFrame'] = { wc }
const event = { sender: wc, senderFrame: wc['mainFrame'] }

function invoke(channel: string, raw: unknown): Promise<unknown> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return Promise.resolve(handler(event, raw))
}

const numVar = (colId: string, name: string): Variable => ({
  colId,
  name,
  type: 'numeric',
  width: 8,
  decimals: 0,
  label: '',
  valueLabels: {},
  missing: null,
  columns: 8,
  align: 'right',
  measure: 'scale',
  role: 'input'
})

let seq = 1000
async function loadThreeRows(): Promise<string> {
  const id = `ds_${String(++seq)}`
  const conn = await db.getDbConnection()
  const temp = `temp_lifecycle_${id}`
  await conn.runAndReadAll(
    `CREATE TABLE ${temp} AS SELECT * FROM (VALUES (1, 10), (2, 20), (3, 30)) t(col_1, col_2)`
  )
  await db.loadDatasetIntoDb(
    id,
    'lifecycle',
    null,
    [numVar('col_1', 'a'), numVar('col_2', 'b')],
    temp
  )
  return id
}

describe('dataset lifecycle (Main)', () => {
  const pushes: { datasetId: string; modified: boolean }[] = []
  beforeEach(() => {
    pushes.length = 0
    db.setModifiedNotifier((datasetId, modified) => pushes.push({ datasetId, modified }))
  })

  it('pushes the dirty flag to the renderer on a cell edit', async () => {
    const id = await loadThreeRows()
    await invoke(IPC.DATA_UPDATE_CELL, { datasetId: id, rowIndex: 0, colId: 'col_1', value: 5 })
    expect(db.loadedDatasets.get(id)?.isModified).toBe(true)
    expect(pushes).toContainEqual({ datasetId: id, modified: true })
  })

  it('refuses a row order that does not list every row (no silent row loss)', async () => {
    const id = await loadThreeRows()
    await expect(
      invoke(IPC.DATA_REORDER_ROWS, { datasetId: id, rowIndices: [1, 0] })
    ).rejects.toThrow()
    await expect(
      invoke(IPC.DATA_REORDER_ROWS, { datasetId: id, rowIndices: [0, 0, 1] })
    ).rejects.toThrow()
    await invoke(IPC.DATA_REORDER_ROWS, { datasetId: id, rowIndices: [2, 0, 1] })
    const conn = await db.getDbConnection()
    const rows = (
      await conn.runAndReadAll(`SELECT col_1 FROM dataset_${id} ORDER BY __row_idx`)
    ).getRows()
    expect(rows.map(r => r[0])).toEqual([3, 1, 2])
  })

  it('never deletes the last variable, and drops a deleted column filter', async () => {
    const id = await loadThreeRows()
    await expect(
      invoke(IPC.VARIABLE_DELETE_MANY, { datasetId: id, colIds: ['col_1', 'col_2'] })
    ).rejects.toThrow()
    expect(db.loadedDatasets.get(id)?.variables).toHaveLength(2)

    await invoke(IPC.DATA_SET_COLUMN_FILTERS, {
      datasetId: id,
      columnFilters: { col_1: { operator: 'greater_than', value: '1' } }
    })
    await invoke(IPC.VARIABLE_DELETE_MANY, { datasetId: id, colIds: ['col_1'] })
    expect(db.getColumnFilters(id)).toEqual({})
    // Undo brings the column back — but not a filter nobody can see.
    await invoke(IPC.DATA_UNDO, { datasetId: id })
    expect(db.loadedDatasets.get(id)?.variables).toHaveLength(2)
    expect(db.getColumnFilters(id)).toEqual({})
  })

  it('release frees the table and stops it counting as unsaved', async () => {
    const id = await loadThreeRows()
    await invoke(IPC.DATA_UPDATE_CELL, { datasetId: id, rowIndex: 0, colId: 'col_1', value: 9 })
    await invoke(IPC.DATA_RELEASE_DATASET, { datasetId: id })
    expect(db.loadedDatasets.has(id)).toBe(false)
    const conn = await db.getDbConnection()
    const tables = (
      await conn.runAndReadAll(
        `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%${id}%'`
      )
    ).getRows()
    expect(tables).toEqual([])
    // Release every other dataset this file loaded → nothing left unsaved.
    for (const other of [...db.loadedDatasets.keys()]) {
      await invoke(IPC.DATA_RELEASE_DATASET, { datasetId: other })
    }
    expect(db.hasUnsavedDatasets()).toBe(false)
  })

  it('keeps custom styles for the recovery checkpoint and marks the dataset dirty', async () => {
    const id = await loadThreeRows()
    const customStyles = { cells: { r0: { col_1: { bold: true } } } }
    await invoke(IPC.DATA_SET_CUSTOM_STYLES, { datasetId: id, customStyles })
    expect(state.datasetCustomStyles.get(id)).toEqual(customStyles)
    expect(db.loadedDatasets.get(id)?.isModified).toBe(true)
  })

  it('treats duplicate-indicator names case-insensitively', async () => {
    const id = await loadThreeRows()
    await expect(
      invoke(IPC.DATA_IDENTIFY_DUPLICATES, {
        datasetId: id,
        matchColIds: ['col_1'],
        primaryName: 'A',
        sequenceName: 'seq'
      })
    ).rejects.toThrow(/already exists/)
    await expect(
      invoke(IPC.DATA_IDENTIFY_DUPLICATES, {
        datasetId: id,
        matchColIds: ['col_1'],
        primaryName: 'dup',
        sequenceName: 'DUP'
      })
    ).rejects.toThrow(/already exists/)
  })
})
