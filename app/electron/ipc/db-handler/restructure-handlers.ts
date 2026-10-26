// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { IPC } from '../../../shared/ipc-contracts'
import type { FileOpenResult } from '../../../shared/ipc-contracts'
import {
  AggregateRequestSchema,
  TransposeRequestSchema,
  MergeAddCasesRequestSchema,
  MergeAddVariablesRequestSchema,
  RestructureWideToLongRequestSchema
} from '../../../shared/ipc-schemas'
import {
  namesEqual,
  sanitizeVariableName,
  makeUniqueVariableName
} from '../../../shared/variable-name'
import { VariableSchema, type Variable } from '../../../shared/data-types'
import log from 'electron-log'
import { handleSerialized } from './serialized-handler'
import { getDbConnection, getDatasetOrThrow, loadDatasetIntoDb, loadedDatasets } from './state'

// 10b. data:aggregate (SPSS Data > Aggregate) — break-variable groups +
// summary functions produce a NEW dataset (one row per group; "Create a
// new dataset" mode only — SPSS's default and most common choice). The
// active dataset is untouched; the renderer opens the result like an
// import (FileOpenResult) and switches to it.
const AGGREGATE_FN_SQL: Record<
  'mean' | 'sum' | 'n' | 'sd' | 'min' | 'max' | 'median' | 'first' | 'last',
  string
> = {
  mean: 'AVG',
  sum: 'SUM',
  n: 'COUNT',
  sd: 'STDDEV_SAMP',
  min: 'MIN',
  max: 'MAX',
  median: 'MEDIAN',
  first: 'FIRST',
  last: 'LAST'
}

// 10c. data:transpose (SPSS Data > Transpose) — rows become variables,
// variables become rows, in a NEW dataset. Only numeric variables are
// transposed (SPSS itself skips string variables — a case's value under a
// string variable has no meaningful place as a "variable value" once
// roles flip). Case count is capped: each original case becomes a new
// *variable*, and an unbounded case count would create an unusable number
// of columns.
const TRANSPOSE_MAX_CASES = 500

// 10d. data:merge-add-cases / data:merge-add-variables (SPSS Data > Merge
// Files). Both take a SECOND dataset id that the renderer already loaded
// via the ordinary file:import flow (so there's no separate "pick + parse
// a file" logic to duplicate here) and produce a NEW third dataset; the
// active dataset (A) is untouched, and B — which only existed to supply
// this merge — is dropped afterwards.
function variableDbType(v: Variable): string {
  if (v.type === 'numeric') return 'DOUBLE'
  if (v.type === 'date') return 'TIMESTAMP'
  return 'VARCHAR'
}

async function dropDataset(id: string): Promise<void> {
  const conn = await getDbConnection()
  await conn.runAndReadAll(`DROP TABLE IF EXISTS dataset_${id}`)
  loadedDatasets.delete(id)
}

export function registerRestructureHandlers(): void {
  handleSerialized(
    IPC.DATA_AGGREGATE,
    AggregateRequestSchema,
    async (req): Promise<FileOpenResult> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)

      const varByColId = new Map(dataset.variables.map(v => [v.colId, v]))
      for (const c of req.breakColIds) {
        if (!varByColId.has(c)) throw new Error(`Column not found: ${c}`)
      }
      for (const agg of req.aggregates) {
        if (!varByColId.has(agg.colId)) throw new Error(`Column not found: ${agg.colId}`)
      }

      const sourceTableName = `dataset_${req.datasetId}`
      const usedNames: string[] = []
      const variables: Variable[] = []
      const sourceColumns: string[] = []
      const selectParts: string[] = []
      let colSeq = 1

      for (const breakColId of req.breakColIds) {
        const srcVar = varByColId.get(breakColId)
        if (!srcVar) continue
        const targetName = makeUniqueVariableName(
          sanitizeVariableName(srcVar.name, colSeq),
          usedNames
        )
        usedNames.push(targetName)
        selectParts.push(`"${breakColId}" AS "${targetName}"`)
        sourceColumns.push(targetName)
        variables.push({ ...srcVar, colId: `col_${String(colSeq)}`, name: targetName })
        colSeq++
      }

      // Aggregate results are always numeric (SPSS convention — summary
      // statistics of a variable, regardless of the source variable's own
      // type/measure).
      for (const agg of req.aggregates) {
        const targetName = makeUniqueVariableName(
          sanitizeVariableName(agg.targetName, colSeq),
          usedNames
        )
        usedNames.push(targetName)
        const fnSql = AGGREGATE_FN_SQL[agg.fn]
        selectParts.push(`${fnSql}("${agg.colId}") AS "${targetName}"`)
        sourceColumns.push(targetName)
        variables.push(
          VariableSchema.parse({
            colId: `col_${String(colSeq)}`,
            name: targetName,
            label: '',
            type: 'numeric',
            width: 8,
            decimals: agg.fn === 'n' ? 0 : 2,
            valueLabels: {},
            missing: null,
            columns: 8,
            align: 'right',
            measure: 'scale',
            role: 'input'
          })
        )
        colSeq++
      }

      // SPSS writes the aggregated file sorted by the break variables; a bare
      // GROUP BY returns groups in hash order (differs run to run).
      const breakList = req.breakColIds.map(c => `"${c}"`).join(', ')
      const groupByClause =
        req.breakColIds.length > 0 ? `GROUP BY ${breakList} ORDER BY ${breakList}` : ''

      const newDatasetId = `ds_${String(Date.now())}`
      const tempTableName = `temp_aggregate_${newDatasetId}`
      await conn.runAndReadAll(
        `CREATE TABLE ${tempTableName} AS SELECT ${selectParts.join(', ')} FROM ${sourceTableName} ${groupByClause}`
      )

      const newDataset = await loadDatasetIntoDb(
        newDatasetId,
        `Aggregate of ${dataset.name}`,
        null,
        variables,
        tempTableName,
        sourceColumns
      )

      log.info(`Aggregate created new dataset ${newDatasetId} from ${req.datasetId}`)
      return { dataset: newDataset, variables }
    }
  )

  handleSerialized(
    IPC.DATA_TRANSPOSE,
    TransposeRequestSchema,
    async (req): Promise<FileOpenResult> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)

      if (dataset.rowCount > TRANSPOSE_MAX_CASES) {
        throw new Error(
          `Transpose creates one new variable per case — this dataset has ${String(dataset.rowCount)} cases, over the ${String(TRANSPOSE_MAX_CASES)}-case limit. Reduce the number of cases first (e.g. Select Cases) and try again.`
        )
      }

      let nameVar: Variable | undefined
      if (req.nameColId) {
        nameVar = dataset.variables.find(v => v.colId === req.nameColId)
        if (!nameVar) throw new Error(`Column not found: ${req.nameColId}`)
      }

      const sourceVars = dataset.variables.filter(
        v => v.colId !== req.nameColId && v.type === 'numeric'
      )
      if (sourceVars.length === 0) {
        throw new Error('No numeric variables to transpose (Transpose skips string variables)')
      }

      const tableName = `dataset_${req.datasetId}`
      const selectCols = [
        ...(nameVar ? [`"${nameVar.colId}"`] : []),
        ...sourceVars.map(v => `"${v.colId}"`)
      ]
      const reader = await conn.runAndReadAll(
        `SELECT ${selectCols.join(', ')} FROM ${tableName} ORDER BY __row_idx`
      )
      const rows = reader.getRows()

      // New case (column) names: from the Name Variable's values when given
      // (sanitized+uniqued), else SPSS's own var001, var002, ... fallback.
      const usedCaseNames: string[] = []
      const nameOffset = nameVar ? 1 : 0
      const caseNames = rows.map((row, i) => {
        const raw = nameVar ? row[0] : null
        const base =
          raw !== null && raw !== undefined && String(raw).trim() !== ''
            ? sanitizeVariableName(String(raw), i + 1)
            : `var${String(i + 1).padStart(3, '0')}`
        const unique = makeUniqueVariableName(base, usedCaseNames)
        usedCaseNames.push(unique)
        return unique
      })

      // New variables: "case_lbl" (original variable names, SPSS's own
      // naming) + one per original case.
      const variables: Variable[] = []
      let colSeq = 1
      variables.push(
        VariableSchema.parse({
          colId: `col_${String(colSeq)}`,
          name: 'case_lbl',
          label: '',
          type: 'string',
          width: 20,
          decimals: 0,
          valueLabels: {},
          missing: null,
          columns: 20,
          align: 'left',
          measure: 'nominal',
          role: 'input'
        })
      )
      colSeq++
      for (const caseName of caseNames) {
        variables.push(
          VariableSchema.parse({
            colId: `col_${String(colSeq)}`,
            name: caseName,
            label: '',
            type: 'numeric',
            width: 8,
            decimals: 2,
            valueLabels: {},
            missing: null,
            columns: 8,
            align: 'right',
            measure: 'scale',
            role: 'input'
          })
        )
        colSeq++
      }

      const newDatasetId = `ds_${String(Date.now())}`
      const tempTableName = `temp_transpose_${newDatasetId}`
      const colDefs = variables
        .map(v => `"${v.name}" ${v.type === 'string' ? 'VARCHAR' : 'DOUBLE'}`)
        .join(', ')
      await conn.runAndReadAll(`CREATE TABLE ${tempTableName} (${colDefs})`)

      const insertSql = `INSERT INTO ${tempTableName} VALUES (${variables.map(() => '?').join(', ')})`
      for (let vi = 0; vi < sourceVars.length; vi++) {
        const srcVar = sourceVars[vi]
        if (!srcVar) continue
        const label = srcVar.label || srcVar.name
        const values = rows.map(row => {
          const cell = row[vi + nameOffset]
          if (cell === null || cell === undefined) return null
          const num = Number(cell)
          return Number.isNaN(num) ? null : num
        })
        const prepared = await conn.prepare(insertSql)
        prepared.bind([label, ...values])
        await prepared.run()
      }

      const newDataset = await loadDatasetIntoDb(
        newDatasetId,
        `Transpose of ${dataset.name}`,
        null,
        variables,
        tempTableName,
        variables.map(v => v.name)
      )

      log.info(`Transpose created new dataset ${newDatasetId} from ${req.datasetId}`)
      return { dataset: newDataset, variables }
    }
  )

  handleSerialized(
    IPC.DATA_MERGE_ADD_CASES,
    MergeAddCasesRequestSchema,
    async (req): Promise<FileOpenResult> => {
      const conn = await getDbConnection()
      const dsA = getDatasetOrThrow(req.datasetIdA)
      const dsB = getDatasetOrThrow(req.datasetIdB)

      const tableA = `dataset_${req.datasetIdA}`
      const tableB = `dataset_${req.datasetIdB}`
      const matchedBColIds = new Set<string>()

      // Merged variable list: A's variables first (matched-by-name pairs use
      // A's own metadata — label/measure/decimals/valueLabels), then any
      // B-only variables appended with B's metadata.
      const variables: Variable[] = []
      const exprA: string[] = []
      const exprB: string[] = []
      let colSeq = 1

      for (const va of dsA.variables) {
        const vb = dsB.variables.find(v => namesEqual(v.name, va.name))
        const targetColId = `col_${String(colSeq)}`
        const dbType = variableDbType(va)
        exprA.push(`CAST("${va.colId}" AS ${dbType}) AS "${targetColId}"`)
        if (vb) {
          matchedBColIds.add(vb.colId)
          exprB.push(`CAST("${vb.colId}" AS ${dbType}) AS "${targetColId}"`)
        } else {
          exprB.push(`CAST(NULL AS ${dbType}) AS "${targetColId}"`)
        }
        variables.push({ ...va, colId: targetColId })
        colSeq++
      }
      for (const vb of dsB.variables) {
        if (matchedBColIds.has(vb.colId)) continue
        const targetColId = `col_${String(colSeq)}`
        const dbType = variableDbType(vb)
        exprA.push(`CAST(NULL AS ${dbType}) AS "${targetColId}"`)
        exprB.push(`CAST("${vb.colId}" AS ${dbType}) AS "${targetColId}"`)
        variables.push({ ...vb, colId: targetColId })
        colSeq++
      }

      const newDatasetId = `ds_${String(Date.now())}`
      const tempTableName = `temp_merge_cases_${newDatasetId}`
      // UNION ALL has no guaranteed output order (DuckDB may interleave the
      // two scans) — pin "A's cases in order, then B's" explicitly.
      await conn.runAndReadAll(
        `CREATE TABLE ${tempTableName} AS ` +
          `SELECT * EXCLUDE ("__src", "__src_row") FROM (` +
          `SELECT ${exprA.join(', ')}, 0 AS "__src", __row_idx AS "__src_row" FROM ${tableA} ` +
          `UNION ALL ` +
          `SELECT ${exprB.join(', ')}, 1 AS "__src", __row_idx AS "__src_row" FROM ${tableB}` +
          `) ORDER BY "__src", "__src_row"`
      )

      const newDataset = await loadDatasetIntoDb(
        newDatasetId,
        `Merged (${dsA.name} + ${dsB.name})`,
        null,
        variables,
        tempTableName,
        variables.map(v => v.colId)
      )

      await dropDataset(req.datasetIdB)
      log.info(`Merge Add Cases: ${req.datasetIdA} + ${req.datasetIdB} → ${newDatasetId}`)
      return { dataset: newDataset, variables }
    }
  )

  handleSerialized(
    IPC.DATA_MERGE_ADD_VARIABLES,
    MergeAddVariablesRequestSchema,
    async (req): Promise<FileOpenResult> => {
      const conn = await getDbConnection()
      const dsA = getDatasetOrThrow(req.datasetIdA)
      const dsB = getDatasetOrThrow(req.datasetIdB)
      const keyVarA = dsA.variables.find(v => v.colId === req.keyColIdA)
      const keyVarB = dsB.variables.find(v => v.colId === req.keyColIdB)
      if (!keyVarA) throw new Error(`Column not found: ${req.keyColIdA}`)
      if (!keyVarB) throw new Error(`Column not found: ${req.keyColIdB}`)

      const tableA = `dataset_${req.datasetIdA}`
      const tableB = `dataset_${req.datasetIdB}`

      // All of A's variables, plus B's variables minus its own key (already
      // present via A's). Colliding names are uniquified (e.g. "age_2") —
      // same convention as import — rather than a hard error, since the user
      // has no chance to rename B's variables before this merge step.
      const usedNames = dsA.variables.map(v => v.name)
      const variables: Variable[] = []
      const selectParts: string[] = []
      let colSeq = 1

      for (const va of dsA.variables) {
        const targetColId = `col_${String(colSeq)}`
        selectParts.push(`A."${va.colId}" AS "${targetColId}"`)
        variables.push({ ...va, colId: targetColId })
        colSeq++
      }
      for (const vb of dsB.variables) {
        if (vb.colId === req.keyColIdB) continue
        const targetName = makeUniqueVariableName(vb.name, usedNames)
        usedNames.push(targetName)
        const targetColId = `col_${String(colSeq)}`
        selectParts.push(`B."${vb.colId}" AS "${targetColId}"`)
        variables.push({ ...vb, colId: targetColId, name: targetName })
        colSeq++
      }

      const dbTypeA = variableDbType(keyVarA)
      const dbTypeB = variableDbType(keyVarB)
      const joinCondition =
        dbTypeA === dbTypeB
          ? `A."${keyVarA.colId}" = B."${keyVarB.colId}"`
          : `CAST(A."${keyVarA.colId}" AS VARCHAR) = CAST(B."${keyVarB.colId}" AS VARCHAR)`

      // B is a keyed lookup table (SPSS /TABLE): a key repeated in B would
      // silently duplicate A's cases through the join — refuse instead.
      const dupReader = await conn.runAndReadAll(
        `SELECT COUNT(*) FROM (SELECT "${keyVarB.colId}" FROM ${tableB} ` +
          `WHERE "${keyVarB.colId}" IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1)`
      )
      if (Number((dupReader.getRows()[0] as [number | bigint])[0]) > 0) {
        throw new Error(`Key variable "${keyVarB.name}" is not unique in the second file`)
      }

      const newDatasetId = `ds_${String(Date.now())}`
      const tempTableName = `temp_merge_vars_${newDatasetId}`
      // A hash join doesn't preserve A's row order; loadDatasetIntoDb assigns
      // __row_idx in insertion order, so order explicitly by A's cases.
      await conn.runAndReadAll(
        `CREATE TABLE ${tempTableName} AS ` +
          `SELECT ${selectParts.join(', ')} FROM ${tableA} A ` +
          `LEFT JOIN ${tableB} B ON ${joinCondition} ORDER BY A.__row_idx`
      )

      const newDataset = await loadDatasetIntoDb(
        newDatasetId,
        `Merged (${dsA.name} + ${dsB.name})`,
        null,
        variables,
        tempTableName,
        variables.map(v => v.colId)
      )

      await dropDataset(req.datasetIdB)
      log.info(`Merge Add Variables: ${req.datasetIdA} + ${req.datasetIdB} → ${newDatasetId}`)
      return { dataset: newDataset, variables }
    }
  )

  // 10e. data:restructure-wide-to-long (SPSS Data > Restructure — Variables
  // to Cases). Stacks a group of wide columns into one long "value" column +
  // an "index" column recording which source column each row came from (in
  // the order given). Id columns are kept as-is, replicated across the
  // stacked rows. Produces a NEW dataset; row order preserved as (original
  // case, then index order) via an ORDER BY on the source __row_idx before
  // the value/index columns — same trick used by loadDatasetIntoDb's own
  // unordered ROW_NUMBER() OVER() downstream (it assigns __row_idx in
  // physical/insertion order, so ordering it here is what makes the final
  // dataset's row order correct).
  handleSerialized(
    IPC.DATA_RESTRUCTURE_WIDE_TO_LONG,
    RestructureWideToLongRequestSchema,
    async (req): Promise<FileOpenResult> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)

      const varByColId = new Map(dataset.variables.map(v => [v.colId, v]))
      for (const c of req.idColIds) {
        if (!varByColId.has(c)) throw new Error(`Column not found: ${c}`)
      }
      for (const c of req.valueColIds) {
        if (!varByColId.has(c)) throw new Error(`Column not found: ${c}`)
      }

      const idVars = req.idColIds.map(c => varByColId.get(c)).filter((v): v is Variable => !!v)
      const firstValueColId = req.valueColIds[0]
      const firstValueVar = firstValueColId ? varByColId.get(firstValueColId) : undefined
      if (!firstValueVar) throw new Error('No value columns')
      const valueDbType = variableDbType(firstValueVar)

      const sourceTableName = `dataset_${req.datasetId}`
      const usedNames: string[] = []
      const idPairs = idVars.map(v => {
        const targetName = makeUniqueVariableName(v.name, usedNames)
        usedNames.push(targetName)
        return { variable: v, targetName }
      })
      // indexName/valueName are free text from the dialog and get interpolated
      // as SQL identifiers below — sanitize before use (a `"` would break out
      // of the quoted identifier).
      const indexTargetName = makeUniqueVariableName(
        sanitizeVariableName(req.indexName, idPairs.length + 1),
        usedNames
      )
      usedNames.push(indexTargetName)
      const valueTargetName = makeUniqueVariableName(
        sanitizeVariableName(req.valueName, idPairs.length + 2),
        usedNames
      )
      usedNames.push(valueTargetName)

      const idSelectList = idPairs
        .map(
          ({ variable, targetName }) =>
            `CAST("${variable.colId}" AS ${variableDbType(variable)}) AS "${targetName}"`
        )
        .join(', ')

      const unionParts = req.valueColIds.map((colId, i) => {
        const idPart = idSelectList ? `${idSelectList}, ` : ''
        return (
          `SELECT __row_idx AS "__src_row_idx", ${idPart}` +
          `${String(i + 1)} AS "${indexTargetName}", ` +
          `CAST("${colId}" AS ${valueDbType}) AS "${valueTargetName}" ` +
          `FROM ${sourceTableName}`
        )
      })

      const newDatasetId = `ds_${String(Date.now())}`
      const tempTableName = `temp_restructure_${newDatasetId}`
      await conn.runAndReadAll(
        `CREATE TABLE ${tempTableName} AS ` +
          `SELECT * EXCLUDE ("__src_row_idx") FROM (${unionParts.join(' UNION ALL ')}) ` +
          `ORDER BY "__src_row_idx", "${indexTargetName}"`
      )

      const variables: Variable[] = []
      let colSeq = 1
      for (const { variable, targetName } of idPairs) {
        variables.push({ ...variable, colId: `col_${String(colSeq)}`, name: targetName })
        colSeq++
      }
      variables.push(
        VariableSchema.parse({
          colId: `col_${String(colSeq)}`,
          name: indexTargetName,
          label: '',
          type: 'numeric',
          width: 8,
          decimals: 0,
          valueLabels: {},
          missing: null,
          columns: 8,
          align: 'right',
          measure: 'nominal',
          role: 'input'
        })
      )
      colSeq++
      variables.push(
        VariableSchema.parse({
          colId: `col_${String(colSeq)}`,
          name: valueTargetName,
          label: '',
          type: firstValueVar.type,
          width: firstValueVar.width,
          decimals: firstValueVar.decimals,
          valueLabels: {},
          missing: null,
          columns: firstValueVar.columns,
          align: firstValueVar.align,
          measure: firstValueVar.measure,
          role: 'input'
        })
      )

      const newDataset = await loadDatasetIntoDb(
        newDatasetId,
        `Restructured (${dataset.name})`,
        null,
        variables,
        tempTableName,
        variables.map(v => v.name)
      )

      log.info(`Restructure wide→long created new dataset ${newDatasetId} from ${req.datasetId}`)
      return { dataset: newDataset, variables }
    }
  )
}
