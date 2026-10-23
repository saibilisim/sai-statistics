// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api'
import type { Dataset, Variable, MissingValues, CustomStyles } from '../../../shared/data-types'
import type { ColumnFilter } from '../../../shared/data-filter'
import log from 'electron-log'

let instance: DuckDBInstance | null = null
let connection: DuckDBConnection | null = null

// In-memory registry of loaded datasets metadata
export const loadedDatasets = new Map<string, Dataset>()

/** Looks up a loaded dataset or throws — the guard every handler needs before touching one. */
export function getDatasetOrThrow(datasetId: string): Dataset {
  const dataset = loadedDatasets.get(datasetId)
  if (!dataset) throw new Error(`Dataset not found: ${datasetId}`)
  return dataset
}

/** True if any loaded dataset has unsaved changes (drives the close guard). */
export function hasUnsavedDatasets(): boolean {
  for (const dataset of loadedDatasets.values()) {
    if (dataset.isModified) return true
  }
  return false
}

// Main owns the authoritative dirty flag (every mutating handler sets it), but
// the renderer's copy drives the title-bar "*" and the New/Open/Import guard.
// Mirroring it here, at the single place the flag changes, keeps the two from
// drifting apart (grid edits, paste, row/column ops, undo … used to leave the
// renderer flag false → no "*" and no unsaved-changes prompt). main.ts wires
// the notifier to the window, so this module stays free of Electron imports.
type ModifiedNotifier = (datasetId: string, modified: boolean) => void
let modifiedNotifier: ModifiedNotifier | null = null

export function setModifiedNotifier(fn: ModifiedNotifier | null): void {
  modifiedNotifier = fn
}

/** Sets the dataset's dirty flag and mirrors it to the renderer. */
export function setDatasetModified(dataset: Dataset, modified: boolean): void {
  dataset.isModified = modified
  modifiedNotifier?.(dataset.id, modified)
}

// Cell formats/formulas (`customStyles`) live in the renderer and only reach
// Main on Save — so the crash-recovery checkpoint used to write every
// recovered .sdf without them. The renderer mirrors them here (debounced,
// data:set-custom-styles) so recovery keeps them.
export const datasetCustomStyles = new Map<string, CustomStyles>()

// Weight Cases (W1): active weight-variable colId per dataset, set via
// data:set-weight (Weight Cases dialog / column context menu / WEIGHT BY
// syntax all funnel through the renderer's setWeight() → here). Main-process
// source of truth so analysis-handler can inject it into every analysis:run
// without each of the 50+ analysis dialogs needing to know about weighting.
export const activeWeightVariable = new Map<string, string | null>()

/** Returns the active weight-variable colId for a dataset, or null if unset. */
export function getWeightVariable(datasetId: string): string | null {
  return activeWeightVariable.get(datasetId) ?? null
}

// Split File (B2, spss-parity-findings-2026-07-07): active split-variable
// colId per dataset, set via data:set-split. Same choke-point pattern as
// activeWeightVariable — previously Split File was renderer-only state
// (dataset-store.ts), never reaching analysis-handler, so the toggle had no
// effect on analysis output ("var ama çalışmıyor").
export const activeSplitVariable = new Map<string, string | null>()

/** Returns the active split-variable colId for a dataset, or null if unset. */
export function getSplitVariable(datasetId: string): string | null {
  return activeSplitVariable.get(datasetId) ?? null
}

/** Returns the active split-variable's display name, or null if unset/not found. */
export function getSplitVariableName(datasetId: string): string | null {
  const colId = getSplitVariable(datasetId)
  if (!colId) return null
  const dataset = loadedDatasets.get(datasetId)
  return dataset?.variables.find(v => v.colId === colId)?.name ?? colId
}

// Column Filters (SELECT IF / Data View grid): active column filters per
// dataset, mirrored from the Renderer via data:set-column-filters whenever
// they change. Same choke-point pattern as activeWeightVariable/
// activeSplitVariable — previously this had no Main-side equivalent at all,
// so any analysis triggered by the AI (run_analysis/run_syntax) silently ran
// on the full, unfiltered dataset no matter what SELECT IF the user had
// approved (destek talebi 2026-09-04).
export const activeColumnFilters = new Map<string, Record<string, ColumnFilter>>()

/** Returns the active column filters for a dataset, or {} if none set. */
export function getColumnFilters(datasetId: string): Record<string, ColumnFilter> {
  return activeColumnFilters.get(datasetId) ?? {}
}

/**
 * Returns the active split-variable's value->label map (e.g. {"0":"Kadın"}),
 * or null if unset/not found/no labels defined. Lets split_title() in
 * _bootstrap.R show "cinsiyet = Kadın" instead of "cinsiyet = 0" the same way
 * groupValueLabels does for the independent t-test's grouping variable — but
 * Split File is main-process global state (not a per-dialog field), so this
 * follows the getMissingValuesMap()/getVariableDecimalsMap() choke-point
 * pattern instead: analysis-handler.ts injects it into every analysis:run.
 */
export function getSplitValueLabels(datasetId: string): Record<string, string> | null {
  const colId = getSplitVariable(datasetId)
  if (!colId) return null
  const dataset = loadedDatasets.get(datasetId)
  const labels = dataset?.variables.find(v => v.colId === colId)?.valueLabels
  return labels && Object.keys(labels).length > 0 ? labels : null
}

// Missing Values (M1): Variable View's per-variable "Missing" definitions
// (discrete/range user-defined missing codes) live on `dataset.variables`
// already — there's no separate active/inactive toggle like Weight Cases,
// they're just always part of the variable's metadata. This reads them out
// into a colId → MissingValues map so analysis-handler.ts can inject it into
// every analysis:run the same way it injects weightVariable, without each
// analysis dialog needing to know about missing values.
/** Returns a colId -> MissingValues map for every variable in the dataset
 *  that has a missing-value spec defined (variables without one are omitted). */
export function getMissingValuesMap(datasetId: string): Record<string, MissingValues> {
  const dataset = loadedDatasets.get(datasetId)
  if (!dataset) return {}
  const result: Record<string, MissingValues> = {}
  for (const v of dataset.variables) {
    if (v.missing) result[v.colId] = v.missing
  }
  return result
}

// Decimals (M2): SPSS applies a numeric variable's Decimals setting to its
// own raw-value display in output tables (e.g. Frequencies' "Value" column) —
// display formatting only, never the precision of computed statistics (those
// already have their own fixed formatting, see src/lib/output-format.ts).
// Only numeric variables are included — decimals is meaningless for
// string/date columns.
/** Returns a colId -> decimals map for every numeric variable in the dataset. */
export function getVariableDecimalsMap(datasetId: string): Record<string, number> {
  const dataset = loadedDatasets.get(datasetId)
  if (!dataset) return {}
  const result: Record<string, number> = {}
  for (const v of dataset.variables) {
    if (v.type === 'numeric') result[v.colId] = v.decimals
  }
  return result
}

export async function getDbConnection(): Promise<DuckDBConnection> {
  if (!connection) {
    try {
      instance = await DuckDBInstance.create(':memory:')
      connection = await instance.connect()
      log.info('DuckDB In-Memory Instance and Connection created successfully.')
    } catch (err) {
      log.error('Failed to initialize DuckDB instance', err)
      throw err
    }
  }
  return connection
}

/**
 * Registers a dataset in memory and builds its DuckDB table from a temporary source table.
 */
export async function loadDatasetIntoDb(
  datasetId: string,
  name: string,
  filePath: string | null,
  variables: Variable[],
  tempTableName: string,
  /** Optional temp-table source column name per variable (parallel to
   *  `variables`). Used when `name` has been sanitized away from the raw
   *  header (CSV/Excel import). When omitted, falls back to colId/name match. */
  sourceColumns?: string[]
): Promise<Dataset> {
  const conn = await getDbConnection()
  const tableName = `dataset_${datasetId}`

  // 1. Drop existing table if any
  await conn.runAndReadAll(`DROP TABLE IF EXISTS ${tableName}`)

  // 2. Initialize colId if missing, and calculate nextColSeq
  let maxSeq = 0
  variables.forEach((v, index) => {
    if (!v.colId) {
      v.colId = `col_${String(index + 1)}`
    }
    const match = v.colId.match(/^col_(\d+)$/)
    if (match && match[1]) {
      const num = parseInt(match[1], 10)
      if (num > maxSeq) maxSeq = num
    }
  })
  const nextColSeq = maxSeq + 1

  // 3. Get columns of the temporary table
  const info = await conn.runAndReadAll(`PRAGMA table_info('${tempTableName}')`)
  const pragmaRows = info.getRows() as [number, string, string, boolean, unknown, boolean][]
  const tempColNames = pragmaRows.map(row => row[1])

  // 4. Map temp table columns to target colId columns. Prefer an explicit
  //    source column (import path, where `name` is sanitized and no longer
  //    matches the raw header), then colId (.sdf reopen), then name (legacy).
  const selectParts = variables.map((v, i) => {
    const src = sourceColumns?.[i]
    let dbType = 'VARCHAR'
    if (v.type === 'numeric') dbType = 'DOUBLE'
    else if (v.type === 'date') dbType = 'TIMESTAMP'

    if (src !== undefined && tempColNames.includes(src)) {
      return `CAST("${src.replace(/"/g, '""')}" AS ${dbType}) AS "${v.colId}"`
    } else if (tempColNames.includes(v.colId)) {
      return `CAST("${v.colId}" AS ${dbType}) AS "${v.colId}"`
    } else if (tempColNames.includes(v.name)) {
      return `CAST("${v.name}" AS ${dbType}) AS "${v.colId}"`
    } else {
      return `CAST(NULL AS ${dbType}) AS "${v.colId}"`
    }
  })

  // `__case_id` = permanent case identity (see Dataset.nextCaseSeq). Preserved
  // verbatim when the source already carries one (.sdf reopen — the saved
  // parquet keeps the column), otherwise assigned in row order, which makes it
  // numerically identical to __row_idx on a fresh import. That equality is what
  // lets pre-__case_id .sdf files (whose customStyles keys are old row indices)
  // reopen with their formats/formulas still on the right rows.
  const caseIdExpr = tempColNames.includes('__case_id')
    ? 'CAST("__case_id" AS BIGINT) AS __case_id'
    : 'ROW_NUMBER() OVER () - 1 AS __case_id'
  const projection = ['ROW_NUMBER() OVER () - 1 AS __row_idx', caseIdExpr, ...selectParts].join(
    ', '
  )

  // 5. Create final table
  await conn.runAndReadAll(
    `CREATE TABLE ${tableName} AS SELECT ${projection} FROM ${tempTableName}`
  )

  // 6. Drop temporary table
  await conn.runAndReadAll(`DROP TABLE ${tempTableName}`)

  // 7. Get row count + the next free case id
  const countReader = await conn.runAndReadAll(
    `SELECT COUNT(*) AS cnt, COALESCE(MAX(__case_id), -1) + 1 AS next_case FROM ${tableName}`
  )
  const countRows = countReader.getRows()
  const rowCount = countRows[0]?.[0] !== undefined ? Number(countRows[0][0]) : 0
  const nextCaseSeq = countRows[0]?.[1] !== undefined ? Number(countRows[0][1]) : rowCount

  const dataset: Dataset = {
    id: datasetId,
    name,
    filePath,
    variables,
    rowCount,
    nextColSeq,
    nextCaseSeq,
    isModified: false
  }

  loadedDatasets.set(datasetId, dataset)
  log.info(
    `Dataset loaded: ${name} (ID: ${datasetId}), Rows: ${String(rowCount)}, NextColSeq: ${String(nextColSeq)}`
  )
  return dataset
}
