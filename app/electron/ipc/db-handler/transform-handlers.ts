// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { DuckDBConnection } from '@duckdb/node-api'
import { IPC } from '../../../shared/ipc-contracts'
import type { TransformResult } from '../../../shared/ipc-contracts'
import {
  RecodeRequestSchema,
  AutoRecodeRequestSchema,
  CountValuesRequestSchema,
  RankCasesRequestSchema,
  VisualBinningRequestSchema,
  ShiftValuesRequestSchema,
  ReplaceMissingRequestSchema
} from '../../../shared/ipc-schemas'
import { VariableSchema, type Variable, type Dataset } from '../../../shared/data-types'
import { namesEqual } from '../../../shared/variable-name'
import log from 'electron-log'
import { handleValidated } from '../security'
import { captureForMutation } from '../undo-manager'
import { getDbConnection, getDatasetOrThrow, setDatasetModified } from './state'

/**
 * A syntax script (or the Compute/Recode/... dialogs) commonly gets re-run
 * as it's developed — SPSS itself just recomputes a transform's target
 * variable on a re-run rather than erroring because the name is already
 * taken. Drop the old physical column and its `dataset.variables` entry so
 * the caller can allocate a fresh one; a no-op when the name is free. MUST
 * be called after `captureForMutation()` so the drop is itself undoable.
 */
async function reclaimTargetName(
  conn: DuckDBConnection,
  tableName: string,
  dataset: Dataset,
  targetName: string
): Promise<void> {
  // Names are case-insensitive (SPSS): AGE_GROUP re-targets age_group.
  const idx = dataset.variables.findIndex(v => namesEqual(v.name, targetName))
  if (idx < 0) return
  const old = dataset.variables[idx] as Variable
  await conn.runAndReadAll(`ALTER TABLE ${tableName} DROP COLUMN "${old.colId}"`)
  dataset.variables.splice(idx, 1)
}

export function registerTransformHandlers(): void {
  // 12. transform:recode — recode into same or different variable
  handleValidated(
    IPC.TRANSFORM_RECODE,
    RecodeRequestSchema,
    async (req): Promise<TransformResult> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)

      const tableName = `dataset_${req.datasetId}`
      const srcExists = dataset.variables.some(v => v.colId === req.sourceColId)
      if (!srcExists) throw new Error(`Source column not found: ${req.sourceColId}`)

      // Build CASE WHEN expression — values are bound params, colId is allow-listed by zod.
      // Discrete (exact-value) mappings go FIRST: SQL CASE takes the first
      // matching WHEN, so this ordering lets a specific value mapping override
      // a broad range (SPSS behaviour — e.g. "5 → 99" beats "1 THRU 10 → 1").
      const rangeClauses = (req.rangeMappings ?? [])
        .map(r => {
          if (r.low !== null && r.high !== null) {
            return `WHEN CAST("${req.sourceColId}" AS DOUBLE) BETWEEN ? AND ? THEN ?`
          }
          if (r.low !== null) {
            return `WHEN CAST("${req.sourceColId}" AS DOUBLE) >= ? THEN ?`
          }
          if (r.high !== null) {
            return `WHEN CAST("${req.sourceColId}" AS DOUBLE) <= ? THEN ?`
          }
          // LO THRU HI: every valid value (it compared against NULL and matched none).
          return `WHEN TRY_CAST("${req.sourceColId}" AS DOUBLE) IS NOT NULL THEN ?`
        })
        .join(' ')
      const rangeParams: (string | number | null)[] = (req.rangeMappings ?? []).flatMap(r => {
        if (r.low !== null && r.high !== null) return [r.low, r.high, r.newValue]
        if (r.low === null && r.high === null) return [r.newValue]
        return [r.low ?? r.high, r.newValue]
      })

      // Match numerically when both sides parse as numbers: a DOUBLE column
      // renders 5 as VARCHAR "5.0", so a plain string compare against the
      // user-typed "5" would silently never match (the string branch still
      // covers genuine string columns).
      const discreteClauses = req.mappings
        .map(
          () =>
            `WHEN (CAST("${req.sourceColId}" AS VARCHAR) = ? OR TRY_CAST("${req.sourceColId}" AS DOUBLE) = TRY_CAST(? AS DOUBLE)) THEN ?`
        )
        .join(' ')
      const discreteParams: (string | number | null)[] = req.mappings.flatMap(m => [
        m.oldValue,
        m.oldValue,
        m.newValue
      ])

      // `(SYSMIS=x)` first: a NULL source matches none of the comparisons anyway.
      const sysmisClause =
        req.sysmisValue !== undefined ? `WHEN "${req.sourceColId}" IS NULL THEN ?` : ''
      const whenClauses = [sysmisClause, discreteClauses, rangeClauses].filter(Boolean).join(' ')
      const params: (string | number | null)[] = [
        ...(req.sysmisValue !== undefined ? [req.sysmisValue] : []),
        ...discreteParams,
        ...rangeParams
      ]

      // SYSMIS first: an unmatched row becomes NULL, not a bound '' cast into
      // the target's numeric type (DuckDB rejects CAST('' AS DOUBLE) — that
      // used to be ELSE=SYSMIS's literal representation and failed the whole
      // UPDATE the moment any row actually fell through to ELSE).
      const elseClause = req.elseSysmis
        ? 'ELSE NULL'
        : req.elseValue !== null
          ? `ELSE ?`
          : `ELSE CAST("${req.sourceColId}" AS VARCHAR)`
      if (!req.elseSysmis && req.elseValue !== null) params.push(req.elseValue)

      const caseExpr = `CASE ${whenClauses} ${elseClause} END`
      const dbType = req.outputType === 'numeric' ? 'DOUBLE' : 'VARCHAR'

      await captureForMutation(req.datasetId)

      const intoSame = req.targetColId === req.sourceColId

      if (intoSame) {
        // Update in-place; cast to target type
        const sql = `UPDATE ${tableName} SET "${req.sourceColId}" = CAST(${caseExpr} AS ${dbType})`
        const prepared = await conn.prepare(sql)
        prepared.bind(params)
        await prepared.run()
      } else {
        // Into different variable: create new column
        const colId = req.targetColId ?? `col_${String(dataset.nextColSeq)}`
        if (!req.targetColId) dataset.nextColSeq++

        const srcVar = dataset.variables.find(v => v.colId === req.sourceColId)
        const targetName = req.targetName ?? `${srcVar?.name ?? 'var'}_recode`

        await reclaimTargetName(conn, tableName, dataset, targetName)

        await conn.runAndReadAll(`ALTER TABLE ${tableName} ADD COLUMN "${colId}" ${dbType}`)

        const updateSql = `UPDATE ${tableName} SET "${colId}" = CAST(${caseExpr} AS ${dbType})`
        const prepared = await conn.prepare(updateSql)
        prepared.bind(params)
        await prepared.run()

        const newVar: Variable = VariableSchema.parse({
          colId,
          name: targetName,
          label: req.targetLabel ?? '',
          type: req.outputType === 'numeric' ? 'numeric' : 'string',
          measure: 'nominal',
          width: 8,
          decimals: 0,
          columns: 8,
          align: 'left',
          valueLabels: {},
          missing: null,
          role: 'input'
        })
        dataset.variables.push(newVar)
      }

      setDatasetModified(dataset, true)
      log.info(`Recode applied on dataset ${req.datasetId}`)
      return { variables: dataset.variables, rowCount: dataset.rowCount }
    }
  )

  // 13. transform:auto-recode — assign sequential integers to distinct string values
  handleValidated(
    IPC.TRANSFORM_AUTO_RECODE,
    AutoRecodeRequestSchema,
    async (req): Promise<TransformResult> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)

      if (!dataset.variables.some(v => v.colId === req.sourceColId)) {
        throw new Error(`Source column not found: ${req.sourceColId}`)
      }

      const tableName = `dataset_${req.datasetId}`
      const orderDir = req.order === 'ascending' ? 'ASC' : 'DESC'

      // Fetch distinct non-null values in requested order. Numeric-looking
      // values sort numerically (SPSS Auto Recode orders numeric variables by
      // value, not by string — "10" must come after "2"); genuine strings fall
      // back to lexicographic order via the second sort key.
      const reader = await conn.runAndReadAll(
        `SELECT val FROM (SELECT DISTINCT CAST("${req.sourceColId}" AS VARCHAR) AS val FROM ${tableName} WHERE "${req.sourceColId}" IS NOT NULL) ORDER BY TRY_CAST(val AS DOUBLE) ${orderDir} NULLS LAST, val ${orderDir}`
      )
      const distinctVals = (reader.getRows() as (string | null)[][]).map(r => r[0] ?? '')

      if (distinctVals.length === 0) {
        throw new Error('No non-null values to recode')
      }

      await captureForMutation(req.datasetId)
      await reclaimTargetName(conn, tableName, dataset, req.targetName)

      const colId = `col_${String(dataset.nextColSeq)}`
      dataset.nextColSeq++

      await conn.runAndReadAll(`ALTER TABLE ${tableName} ADD COLUMN "${colId}" DOUBLE`)

      // CASE WHEN per distinct value → integer code (1-based)
      const whenClauses = distinctVals
        .map((_, i) => `WHEN CAST("${req.sourceColId}" AS VARCHAR) = ? THEN ${String(i + 1)}`)
        .join(' ')
      const caseExpr = `CASE ${whenClauses} ELSE NULL END`
      const updateSql = `UPDATE ${tableName} SET "${colId}" = ${caseExpr}`
      const prepared = await conn.prepare(updateSql)
      prepared.bind(distinctVals)
      await prepared.run()

      const valueLabels: Record<string, string> = {}
      distinctVals.forEach((val, i) => {
        valueLabels[String(i + 1)] = val
      })

      const newVar: Variable = VariableSchema.parse({
        colId,
        name: req.targetName,
        label: req.targetLabel ?? '',
        type: 'numeric',
        measure: 'ordinal',
        width: 8,
        decimals: 0,
        columns: 8,
        align: 'right',
        valueLabels,
        missing: null,
        role: 'input'
      })
      dataset.variables.push(newVar)
      setDatasetModified(dataset, true)

      log.info(`Auto-recode applied: ${req.targetName} in dataset ${req.datasetId}`)
      return { variables: dataset.variables, rowCount: dataset.rowCount }
    }
  )

  // 14. transform:count-values — count matching values across selected columns per row
  handleValidated(
    IPC.TRANSFORM_COUNT_VALUES,
    CountValuesRequestSchema,
    async (req): Promise<TransformResult> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)

      const validColIds = new Set(dataset.variables.map(v => v.colId))
      for (const c of req.sourceColIds) {
        if (!validColIds.has(c)) throw new Error(`Column not found: ${c}`)
      }

      const tableName = `dataset_${req.datasetId}`
      await captureForMutation(req.datasetId)
      await reclaimTargetName(conn, tableName, dataset, req.targetName)

      const colId = `col_${String(dataset.nextColSeq)}`
      dataset.nextColSeq++

      await conn.runAndReadAll(`ALTER TABLE ${tableName} ADD COLUMN "${colId}" DOUBLE`)

      // Each source column contributes 1 if it matches matchValue, else 0.
      // matchValue is a bound parameter — never interpolated. Numeric-aware
      // compare (same reason as transform:recode): DOUBLE 5 renders as "5.0",
      // so a plain string compare against a user-typed "5" would never match.
      const terms = req.sourceColIds
        .map(
          c =>
            `CASE WHEN (CAST("${c}" AS VARCHAR) = ? OR TRY_CAST("${c}" AS DOUBLE) = TRY_CAST(? AS DOUBLE)) THEN 1 ELSE 0 END`
        )
        .join(' + ')
      const params = req.sourceColIds.flatMap(() => [req.matchValue, req.matchValue])

      const updateSql = `UPDATE ${tableName} SET "${colId}" = ${terms}`
      const prepared = await conn.prepare(updateSql)
      prepared.bind(params)
      await prepared.run()

      const newVar: Variable = VariableSchema.parse({
        colId,
        name: req.targetName,
        label: req.targetLabel ?? '',
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
      dataset.variables.push(newVar)
      setDatasetModified(dataset, true)

      log.info(`Count values applied: ${req.targetName} in dataset ${req.datasetId}`)
      return { variables: dataset.variables, rowCount: dataset.rowCount }
    }
  )

  // 15. transform:rank-cases — assign rank values to a new column via DuckDB window functions
  handleValidated(
    IPC.TRANSFORM_RANK_CASES,
    RankCasesRequestSchema,
    async (req): Promise<TransformResult> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)

      if (!dataset.variables.some(v => v.colId === req.sourceColId)) {
        throw new Error(`Source column not found: ${req.sourceColId}`)
      }

      const tableName = `dataset_${req.datasetId}`
      const orderDir = req.order === 'ascending' ? 'ASC' : 'DESC'

      const rankFn =
        req.method === 'dense_rank'
          ? `DENSE_RANK()`
          : req.method === 'percent_rank'
            ? `ROUND(PERCENT_RANK() * 100, 4)`
            : `RANK()`
      const windowExpr = `${rankFn} OVER (ORDER BY "${req.sourceColId}" ${orderDir} NULLS LAST)`

      await captureForMutation(req.datasetId)
      await reclaimTargetName(conn, tableName, dataset, req.targetName)

      const colId = `col_${String(dataset.nextColSeq)}`
      dataset.nextColSeq++

      await conn.runAndReadAll(`ALTER TABLE ${tableName} ADD COLUMN "${colId}" DOUBLE`)

      // DuckDB supports window functions in UPDATE via a subquery join on __row_idx
      const updateSql = `
        UPDATE ${tableName}
        SET "${colId}" = sub.rank_val
        FROM (
          SELECT __row_idx, ${windowExpr} AS rank_val
          FROM ${tableName}
          WHERE "${req.sourceColId}" IS NOT NULL
        ) sub
        WHERE ${tableName}.__row_idx = sub.__row_idx
      `
      await conn.runAndReadAll(updateSql)

      const newVar: Variable = VariableSchema.parse({
        colId,
        name: req.targetName,
        label: req.targetLabel ?? '',
        type: 'numeric',
        measure: 'scale',
        width: 8,
        decimals: 2,
        columns: 8,
        align: 'right',
        valueLabels: {},
        missing: null,
        role: 'input'
      })
      dataset.variables.push(newVar)
      setDatasetModified(dataset, true)

      log.info(`Rank cases applied: ${req.targetName} in dataset ${req.datasetId}`)
      return { variables: dataset.variables, rowCount: dataset.rowCount }
    }
  )

  // 15b. transform:visual-binning — SPSS Visual Binning: groups a continuous
  // variable into a new ordinal variable via equal-width, equal-count
  // (quantile), or user-supplied cut points.
  handleValidated(
    IPC.TRANSFORM_VISUAL_BINNING,
    VisualBinningRequestSchema,
    async (req): Promise<TransformResult> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)
      if (!dataset.variables.some(v => v.colId === req.sourceColId)) {
        throw new Error(`Source column not found: ${req.sourceColId}`)
      }

      const tableName = `dataset_${req.datasetId}`

      // Resolve ascending cut points depending on method.
      let cutPoints: number[]
      if (req.method === 'manual') {
        if (!req.cutPoints || req.cutPoints.length === 0) {
          throw new Error('Manual binning requires at least one cut point')
        }
        cutPoints = [...req.cutPoints].sort((a, b) => a - b)
      } else {
        const bins = req.bins ?? 4
        if (req.method === 'equalWidth') {
          const reader = await conn.runAndReadAll(
            `SELECT MIN("${req.sourceColId}") AS lo, MAX("${req.sourceColId}") AS hi FROM ${tableName}`
          )
          const row = reader.getRows()[0] as [number | bigint | null, number | bigint | null]
          const lo = row[0] !== null ? Number(row[0]) : 0
          const hi = row[1] !== null ? Number(row[1]) : 0
          const width = (hi - lo) / bins
          cutPoints = Array.from({ length: bins - 1 }, (_, i) => lo + width * (i + 1))
        } else {
          // equalCount: quantile cut points via PERCENTILE_CONT
          const percentileExprs = Array.from(
            { length: bins - 1 },
            (_, i) =>
              `PERCENTILE_CONT(${String((i + 1) / bins)}) WITHIN GROUP (ORDER BY "${req.sourceColId}") AS p${String(i)}`
          ).join(', ')
          const reader = await conn.runAndReadAll(`SELECT ${percentileExprs} FROM ${tableName}`)
          const row = reader.getRows()[0] as (number | bigint | null)[]
          cutPoints = row.map(v => (v !== null ? Number(v) : 0))
        }
      }

      await captureForMutation(req.datasetId)
      await reclaimTargetName(conn, tableName, dataset, req.targetName)

      const colId = `col_${String(dataset.nextColSeq)}`
      dataset.nextColSeq++
      await conn.runAndReadAll(`ALTER TABLE ${tableName} ADD COLUMN "${colId}" DOUBLE`)

      // CASE WHEN x <= cp[0] THEN 1 WHEN x <= cp[1] THEN 2 ... ELSE bins+1 END
      const whenClauses = cutPoints
        .map((_, i) => `WHEN CAST("${req.sourceColId}" AS DOUBLE) <= ? THEN ${String(i + 1)}`)
        .join(' ')
      const caseExpr = `CASE ${whenClauses} ELSE ${String(cutPoints.length + 1)} END`
      const updateSql = `UPDATE ${tableName} SET "${colId}" = ${caseExpr} WHERE "${req.sourceColId}" IS NOT NULL`
      const prepared = await conn.prepare(updateSql)
      prepared.bind(cutPoints)
      await prepared.run()

      // Auto-generate SPSS-style range value labels.
      const valueLabels: Record<string, string> = {}
      cutPoints.forEach((cp, i) => {
        const prev = cutPoints[i - 1]
        const label =
          i === 0 ? `<= ${cp.toFixed(2)}` : `${(prev ?? cp).toFixed(2)} - ${cp.toFixed(2)}`
        valueLabels[String(i + 1)] = label
      })
      const lastCut = cutPoints[cutPoints.length - 1]
      if (lastCut !== undefined) {
        valueLabels[String(cutPoints.length + 1)] = `> ${lastCut.toFixed(2)}`
      }

      const newVar: Variable = VariableSchema.parse({
        colId,
        name: req.targetName,
        label: req.targetLabel ?? '',
        type: 'numeric',
        measure: 'ordinal',
        width: 8,
        decimals: 0,
        columns: 8,
        align: 'right',
        valueLabels,
        missing: null,
        role: 'input'
      })
      dataset.variables.push(newVar)
      setDatasetModified(dataset, true)

      log.info(`Visual binning applied: ${req.targetName} in dataset ${req.datasetId}`)
      return { variables: dataset.variables, rowCount: dataset.rowCount }
    }
  )

  // 15c. transform:shift-values — SPSS Shift Values: a new variable holding
  // the value of an existing variable n cases before (lag) or after (lead)
  // the current case, in current row order.
  handleValidated(
    IPC.TRANSFORM_SHIFT_VALUES,
    ShiftValuesRequestSchema,
    async (req): Promise<TransformResult> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)
      const srcVar = dataset.variables.find(v => v.colId === req.sourceColId)
      if (!srcVar) throw new Error(`Source column not found: ${req.sourceColId}`)

      const tableName = `dataset_${req.datasetId}`
      let dbType = 'VARCHAR'
      if (srcVar.type === 'numeric') dbType = 'DOUBLE'
      else if (srcVar.type === 'date') dbType = 'TIMESTAMP'

      await captureForMutation(req.datasetId)
      await reclaimTargetName(conn, tableName, dataset, req.targetName)

      const colId = `col_${String(dataset.nextColSeq)}`
      dataset.nextColSeq++
      await conn.runAndReadAll(`ALTER TABLE ${tableName} ADD COLUMN "${colId}" ${dbType}`)

      const windowFn = req.direction === 'lag' ? 'LAG' : 'LEAD'
      const windowExpr = `${windowFn}("${req.sourceColId}", ${String(req.n)}) OVER (ORDER BY __row_idx)`
      const updateSql = `
        UPDATE ${tableName}
        SET "${colId}" = sub.shifted_val
        FROM (
          SELECT __row_idx, ${windowExpr} AS shifted_val
          FROM ${tableName}
        ) sub
        WHERE ${tableName}.__row_idx = sub.__row_idx
      `
      await conn.runAndReadAll(updateSql)

      const newVar: Variable = VariableSchema.parse({
        colId,
        name: req.targetName,
        label: req.targetLabel ?? '',
        type: srcVar.type,
        measure: srcVar.measure,
        width: srcVar.width,
        decimals: srcVar.decimals,
        columns: srcVar.columns,
        align: srcVar.align,
        valueLabels: {},
        missing: null,
        role: 'input'
      })
      dataset.variables.push(newVar)
      setDatasetModified(dataset, true)

      log.info(`Shift values applied: ${req.targetName} in dataset ${req.datasetId}`)
      return { variables: dataset.variables, rowCount: dataset.rowCount }
    }
  )

  // 16. transform:replace-missing — fill NULL values in an existing column
  handleValidated(
    IPC.TRANSFORM_REPLACE_MISSING,
    ReplaceMissingRequestSchema,
    async (req): Promise<void> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)

      const variable = dataset.variables.find(v => v.colId === req.colId)
      if (!variable) throw new Error(`Column not found: ${req.colId}`)

      const tableName = `dataset_${req.datasetId}`
      await captureForMutation(req.datasetId)

      let fillExpr: string
      const params: (string | number)[] = []

      if (req.method === 'value') {
        fillExpr = '?'
        const v = variable.type === 'numeric' ? parseFloat(req.value ?? '0') : (req.value ?? '')
        params.push(v)
      } else if (req.method === 'mean') {
        fillExpr = `(SELECT AVG("${req.colId}") FROM ${tableName} WHERE "${req.colId}" IS NOT NULL)`
      } else if (req.method === 'median') {
        fillExpr = `(SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "${req.colId}") FROM ${tableName} WHERE "${req.colId}" IS NOT NULL)`
      } else {
        // mode — most frequent non-null value; ties → the smallest value
        // (deterministic, same convention as SPSS FREQUENCIES' reported mode)
        fillExpr = `(SELECT "${req.colId}" FROM ${tableName} WHERE "${req.colId}" IS NOT NULL GROUP BY "${req.colId}" ORDER BY COUNT(*) DESC, "${req.colId}" ASC LIMIT 1)`
      }

      const sql = `UPDATE ${tableName} SET "${req.colId}" = ${fillExpr} WHERE "${req.colId}" IS NULL`
      if (params.length > 0) {
        const prepared = await conn.prepare(sql)
        prepared.bind(params)
        await prepared.run()
      } else {
        await conn.runAndReadAll(sql)
      }

      setDatasetModified(dataset, true)
      log.info(`Replace missing applied on ${req.colId} in dataset ${req.datasetId}`)
    }
  )
}
