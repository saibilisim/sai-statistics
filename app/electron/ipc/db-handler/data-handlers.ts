// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { IPC } from '../../../shared/ipc-contracts'
import type { DataSliceResult, SplitGroupsResult } from '../../../shared/ipc-contracts'
import {
  DatasetIdRequestSchema,
  GetChunkRequestSchema,
  GetFilteredRequestSchema,
  GetSplitGroupsRequestSchema,
  SetWeightRequestSchema,
  SetSplitRequestSchema,
  SetColumnFiltersRequestSchema,
  SetCustomStylesRequestSchema
} from '../../../shared/ipc-schemas'
import { buildFilterWhere } from '../../../shared/data-filter'
import type { CellValue } from '../../../shared/data-types'
import log from 'electron-log'
import { handleValidated } from '../security'
import { clearUndoHistory } from '../undo-manager'
import {
  getDbConnection,
  getDatasetOrThrow,
  loadedDatasets,
  activeWeightVariable,
  activeSplitVariable,
  activeColumnFilters,
  datasetCustomStyles,
  setDatasetModified
} from './state'
import { normalizeDbValue, splitCaseIds } from './value-utils'

/** Frees everything Main holds for a dataset the renderer no longer shows. */
async function releaseDataset(datasetId: string): Promise<void> {
  if (!loadedDatasets.has(datasetId)) return
  const conn = await getDbConnection()
  await clearUndoHistory(datasetId)
  await conn.runAndReadAll(`DROP TABLE IF EXISTS dataset_${datasetId}`)
  loadedDatasets.delete(datasetId)
  activeWeightVariable.delete(datasetId)
  activeSplitVariable.delete(datasetId)
  activeColumnFilters.delete(datasetId)
  datasetCustomStyles.delete(datasetId)
  log.info(`Dataset released: ${datasetId}`)
}

export function registerDataHandlers(): void {
  // 1. data:get-all — DataView loads the full dataset at once. Pagination is out
  //    of scope (see CLAUDE.md §12); analysis reads straight from DuckDB.
  handleValidated(
    IPC.DATA_GET_ALL,
    DatasetIdRequestSchema,
    async (req): Promise<DataSliceResult> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)

      if (dataset.rowCount === 0) {
        return { rows: [], totalRows: 0 }
      }

      const colNames = dataset.variables.map(v => `"${v.colId}"`).join(', ')
      const tableName = `dataset_${req.datasetId}`

      const sql = `SELECT __case_id, ${colNames} FROM ${tableName} ORDER BY __row_idx`
      const reader = await conn.runAndReadAll(sql)
      const rowsRaw = reader.getRows() as CellValue[][]
      const { rows, caseIds } = splitCaseIds(rowsRaw)

      return {
        rows,
        caseIds,
        totalRows: dataset.rowCount
      }
    }
  )

  // 1b. data:get-chunk (chunked-load-roadmap.md C1) — same rows as a
  // data:get-all slice, but bounded by `limit` (schema-capped at 50K) so
  // DataView can paint progressively instead of blocking the Renderer's UI
  // thread with one giant structured-clone deserialization. LIMIT/OFFSET
  // rather than a __row_idx BETWEEN range — gap-safe if rows were ever
  // deleted (holes in __row_idx), and the cost difference is immeasurable
  // for an in-memory DuckDB scan.
  handleValidated(
    IPC.DATA_GET_CHUNK,
    GetChunkRequestSchema,
    async (req): Promise<DataSliceResult> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)

      if (dataset.rowCount === 0 || req.offset >= dataset.rowCount) {
        return { rows: [], totalRows: dataset.rowCount }
      }

      const colNames = dataset.variables.map(v => `"${v.colId}"`).join(', ')
      const tableName = `dataset_${req.datasetId}`

      const sql = `SELECT __case_id, ${colNames} FROM ${tableName} ORDER BY __row_idx LIMIT ? OFFSET ?`
      const prepared = await conn.prepare(sql)
      prepared.bind([req.limit, req.offset])
      const reader = await prepared.runAndReadAll()
      const rowsRaw = reader.getRows() as CellValue[][]
      const { rows, caseIds } = splitCaseIds(rowsRaw)

      return {
        rows,
        caseIds,
        totalRows: dataset.rowCount
      }
    }
  )

  // 2b. data:get-filtered — same shape as data:get-all but applies the active
  //     column filter (Select Cases) as a parameterised WHERE. The analysis
  //     layer calls this so statistics run on exactly the selected cases.
  handleValidated(
    IPC.DATA_GET_FILTERED,
    GetFilteredRequestSchema,
    async (req): Promise<DataSliceResult> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)
      if (dataset.rowCount === 0) {
        return { rows: [], totalRows: 0 }
      }

      const colNames = dataset.variables.map(v => `"${v.colId}"`).join(', ')
      const tableName = `dataset_${req.datasetId}`
      const { sql: where, params } = buildFilterWhere(req.columnFilters, dataset.variables)

      const sql =
        `SELECT ${colNames} FROM ${tableName}` +
        (where ? ` WHERE ${where}` : '') +
        ` ORDER BY __row_idx`

      const prepared = await conn.prepare(sql)
      if (params.length > 0) prepared.bind(params)
      const reader = await prepared.runAndReadAll()
      const rowsRaw = reader.getRows() as CellValue[][]
      const rows = rowsRaw.map(row => row.map(normalizeDbValue))

      return { rows, totalRows: rows.length }
    }
  )

  // 2c. data:get-split-groups — distinct values of the Split File variable,
  //     respecting the active filter, ordered. The analysis runner loops these
  //     and runs the procedure once per group (adding an equality predicate).
  handleValidated(
    IPC.DATA_GET_SPLIT_GROUPS,
    GetSplitGroupsRequestSchema,
    async (req): Promise<SplitGroupsResult> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)
      if (!dataset.variables.some(v => v.colId === req.splitColId)) {
        throw new Error(`Column not found: ${req.splitColId}`)
      }
      if (dataset.rowCount === 0) {
        return { groups: [] }
      }

      const tableName = `dataset_${req.datasetId}`
      const { sql: where, params } = buildFilterWhere(req.columnFilters, dataset.variables)
      // Null split values do not form a meaningful group → excluded.
      const splitNotNull = `"${req.splitColId}" IS NOT NULL`
      const whereClause = where ? `${where} AND ${splitNotNull}` : splitNotNull

      const sql =
        `SELECT DISTINCT "${req.splitColId}" FROM ${tableName} ` +
        `WHERE ${whereClause} ORDER BY "${req.splitColId}"`

      const prepared = await conn.prepare(sql)
      if (params.length > 0) prepared.bind(params)
      const reader = await prepared.runAndReadAll()
      const groups = (reader.getRows() as CellValue[][]).map(r => normalizeDbValue(r[0] ?? null))

      return { groups }
    }
  )

  // 2d. data:set-weight — Weight Cases (W1). Records the active weight
  // variable so analysis-handler can inject it into every subsequent
  // analysis:run; validated against the dataset's variables to reject stale
  // colIds (e.g. a weight column deleted after being selected).
  handleValidated(IPC.DATA_SET_WEIGHT, SetWeightRequestSchema, (req): void => {
    const dataset = getDatasetOrThrow(req.datasetId)
    if (req.colId !== null && !dataset.variables.some(v => v.colId === req.colId)) {
      throw new Error(`Column not found: ${req.colId}`)
    }
    activeWeightVariable.set(req.datasetId, req.colId)
  })

  // 2e. data:set-split — Split File (B2). Records the active split variable
  // so analysis-handler can inject it into every subsequent analysis:run;
  // validated against the dataset's variables like data:set-weight.
  handleValidated(IPC.DATA_SET_SPLIT, SetSplitRequestSchema, (req): void => {
    const dataset = getDatasetOrThrow(req.datasetId)
    if (req.colId !== null && !dataset.variables.some(v => v.colId === req.colId)) {
      throw new Error(`Column not found: ${req.colId}`)
    }
    activeSplitVariable.set(req.datasetId, req.colId)
  })

  // 2f. data:set-column-filters — mirrors the Renderer's active column
  // filters (Data View grid / SELECT IF) so analysis-handler and the AI
  // bridge's enqueueAiAnalysis can both inject them into every analysis:run,
  // the same choke-point pattern as data:set-weight/data:set-split. Filters
  // on unknown/deleted colIds are dropped rather than rejected — buildFilterWhere
  // already ignores unknown columns, so a stale entry would be a silent no-op
  // there too; failing the whole sync over one stale filter would be worse.
  handleValidated(IPC.DATA_SET_COLUMN_FILTERS, SetColumnFiltersRequestSchema, (req): void => {
    const dataset = getDatasetOrThrow(req.datasetId)
    const validIds = new Set(dataset.variables.map(v => v.colId))
    const columnFilters = Object.fromEntries(
      Object.entries(req.columnFilters).filter(([colId]) => validIds.has(colId))
    )
    activeColumnFilters.set(req.datasetId, columnFilters)
  })

  // 2g. data:release-dataset — the renderer replaced the active dataset.
  handleValidated(IPC.DATA_RELEASE_DATASET, DatasetIdRequestSchema, req =>
    releaseDataset(req.datasetId)
  )

  // 2h. data:set-custom-styles — cell formats/formulas changed in the
  // renderer: keep a copy for the recovery checkpoint and mark the dataset
  // dirty (a format-only edit touches no DuckDB data, so nothing else would).
  handleValidated(IPC.DATA_SET_CUSTOM_STYLES, SetCustomStylesRequestSchema, (req): void => {
    const dataset = getDatasetOrThrow(req.datasetId)
    if (req.customStyles) datasetCustomStyles.set(req.datasetId, req.customStyles)
    else datasetCustomStyles.delete(req.datasetId)
    setDatasetModified(dataset, true)
  })
}
