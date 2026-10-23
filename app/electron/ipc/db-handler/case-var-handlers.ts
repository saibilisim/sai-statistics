// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * case-var-handlers.ts — turns an analysis's case-level output into new
 * dataset columns (transform:create-variables).
 *
 * This is SPSS's "Save New Variables" panel WITHOUT the misleading name: it
 * writes nothing to disk. A new column is added to the active dataset exactly
 * the way Transform > Compute Variable adds one — same DuckDB ALTER TABLE, same
 * captureForMutation() undo snapshot, same isModified flag. Saving the file
 * afterwards stays the user's separate, explicit action.
 *
 * One generic handler for every analysis (the analysis:run rule, CLAUDE.md §5):
 * an analysis only has to emit `caseVars` in its result, it never gets its own
 * write path.
 */
import log from 'electron-log'
import { IPC } from '../../../shared/ipc-contracts'
import type { TransformResult } from '../../../shared/ipc-contracts'
import { CreateVariablesRequestSchema } from '../../../shared/ipc-schemas'
import type { CaseVar } from '../../../shared/analysis-types'
import { VariableSchema } from '../../../shared/data-types'
import type { Variable } from '../../../shared/data-types'
import { handleValidated } from '../security'
import { getDbConnection, getDatasetOrThrow, setDatasetModified } from './state'
import { captureForMutation } from '../undo-manager'

// DuckDB tolerates far larger statements, but binding a few hundred thousand
// parameters in one call is where the node bindings get unhappy; chunking keeps
// peak memory flat and the statement size predictable.
const INSERT_CHUNK = 500

/**
 * A new variable name has to be usable from R and from SPSS syntax later, so
 * it is held to the same shape the rest of the app assumes for identifiers
 * rather than merely being non-empty.
 */
function isValidVariableName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(name)
}

export function registerCaseVarHandlers(): void {
  handleValidated(
    IPC.TRANSFORM_CREATE_VARIABLES,
    CreateVariablesRequestSchema,
    async (req): Promise<TransformResult> => {
      const conn = await getDbConnection()
      const dataset = getDatasetOrThrow(req.datasetId)
      const tableName = `dataset_${req.datasetId}`

      // ── Validate the whole batch BEFORE mutating anything ─────────────────
      // Half-applied is worse than rejected: the user would be left with three
      // of five columns and no signal about which two are missing.
      // Lower-cased: variable names are case-insensitive (namesEqual).
      const existingNames = new Set(dataset.variables.map(v => v.name.toLowerCase()))
      const seen = new Set<string>()
      for (const cv of req.variables) {
        if (!isValidVariableName(cv.name)) {
          throw new Error(`Invalid variable name: ${cv.name}`)
        }
        const key = cv.name.toLowerCase()
        if (existingNames.has(key) || seen.has(key)) {
          throw new Error(`Variable already exists: ${cv.name}`)
        }
        seen.add(key)
        if (cv.values.length !== cv.rowIndex.length) {
          throw new Error(
            `caseVar ${cv.name}: values/rowIndex length mismatch ` +
              `(${String(cv.values.length)} vs ${String(cv.rowIndex.length)})`
          )
        }
        // The alignment check that makes this safe. An analysis reports rows it
        // actually used, so fewer than rowCount is normal (listwise deletion,
        // weight/split filters) — but an index at or past rowCount means the
        // vector does not belong to this dataset, and writing it would put
        // values on the wrong cases while every table still looked right.
        for (const idx of cv.rowIndex) {
          if (idx >= dataset.rowCount) {
            throw new Error(
              `caseVar ${cv.name}: rowIndex ${String(idx)} out of range ` +
                `(rowCount ${String(dataset.rowCount)})`
            )
          }
        }
      }

      await captureForMutation(req.datasetId)

      const created: Variable[] = []
      for (const cv of req.variables) {
        const colId = `col_${String(dataset.nextColSeq)}`
        dataset.nextColSeq++
        await addCaseVarColumn(conn, tableName, colId, cv)

        const newVar: Variable = VariableSchema.parse({
          colId,
          name: cv.name,
          label: cv.label,
          type: cv.type,
          measure: cv.measure,
          width: 8,
          decimals: cv.type === 'string' ? 0 : cv.decimals,
          columns: 8,
          align: cv.type === 'string' ? 'left' : 'right',
          valueLabels: {},
          missing: null,
          // These columns are model output, not inputs to the next model. SPSS
          // marks them Input; Role exists precisely so a later dialog can
          // pre-fill sensibly, and a residual auto-offered as a predictor is
          // the wrong default.
          role: 'none'
        })
        dataset.variables.push(newVar)
        created.push(newVar)
      }

      setDatasetModified(dataset, true)
      log.info(
        `[case-vars] created ${String(created.length)} variable(s) in dataset ${req.datasetId}: ` +
          created.map(v => v.name).join(', ')
      )
      return { variables: dataset.variables, rowCount: dataset.rowCount }
    }
  )
}

/**
 * Add one column and fill it by joining a staged (row index -> value) table on
 * __row_idx. Rows the analysis did not use are simply never touched, so they
 * keep the NULL the ALTER TABLE gave them — which is the honest representation
 * of "this case was excluded from the model".
 */
async function addCaseVarColumn(
  conn: Awaited<ReturnType<typeof getDbConnection>>,
  tableName: string,
  colId: string,
  cv: CaseVar
): Promise<void> {
  const dbType = cv.type === 'string' ? 'VARCHAR' : 'DOUBLE'
  await conn.runAndReadAll(`ALTER TABLE ${tableName} ADD COLUMN "${colId}" ${dbType}`)

  if (cv.values.length === 0) return

  // A temp staging table rather than one UPDATE per case: a 500k-row dataset
  // would otherwise mean 500k round trips.
  const stageName = `stage_${colId}_${String(Date.now())}`
  await conn.runAndReadAll(`CREATE TEMP TABLE ${stageName} (__row_idx BIGINT, val ${dbType})`)
  try {
    for (let start = 0; start < cv.values.length; start += INSERT_CHUNK) {
      const end = Math.min(start + INSERT_CHUNK, cv.values.length)
      const tuples: string[] = []
      const binds: (number | string | null)[] = []
      for (let i = start; i < end; i++) {
        tuples.push('(?, ?)')
        binds.push(cv.rowIndex[i] ?? null, normaliseValue(cv.values[i], cv.type))
      }
      const prepared = await conn.prepare(
        `INSERT INTO ${stageName} (__row_idx, val) VALUES ${tuples.join(', ')}`
      )
      prepared.bind(binds)
      await prepared.run()
    }

    await conn.runAndReadAll(`
      UPDATE ${tableName}
      SET "${colId}" = s.val
      FROM ${stageName} s
      WHERE ${tableName}.__row_idx = s.__row_idx
    `)
  } finally {
    await conn.runAndReadAll(`DROP TABLE IF EXISTS ${stageName}`)
  }
}

/**
 * R sends NaN/Inf as null already, but a numeric caseVar that arrived as a
 * string (a JSON quirk on very large values) must not silently become the
 * VARCHAR "1e+21" in a DOUBLE column.
 */
function normaliseValue(
  v: string | number | null | undefined,
  type: CaseVar['type']
): number | string | null {
  if (v === null || v === undefined) return null
  if (type === 'string') return String(v)
  const num = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(num) ? num : null
}
