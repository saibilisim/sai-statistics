// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { app, dialog } from 'electron'
import { join } from 'path'
import AdmZip from 'adm-zip'
import type { Variable, Dataset, VariableType } from '../../../shared/data-types'
import { clampVariableAttr } from '../../../shared/data-types'
import { sanitizeVariableName, makeUniqueVariableName } from '../../../shared/variable-name'
import { getDbConnection } from '../db-handler'
import { getSettings } from '../settings-handler'
import { dialogStrings } from '../../i18n'
import log from 'electron-log'
import {
  chooseNumericStyle,
  dateValueExpr,
  deriveMeasure,
  nonEmptyExpr,
  numericBaseExpr,
  numericValueExpr,
  quoteCol,
  type NumericStyle,
  type SeparatorCounts
} from './type-inference'
import type { StatFileVariableMeta } from './stat-metadata'

/** Where the utility R scripts (import-metadata.R, export-sav.R) live. */
export function rScriptsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'r-scripts')
    : join(app.getAppPath(), 'r-scripts')
}

/** Native file-dialog labels in the user's selected language. */
export function dialogText() {
  return dialogStrings().fileDialogs
}

// K5.3 (faz8-kalite-roadmap.md): honest heads-up only, never blocks — Data
// View renders the full result set (CLAUDE.md §12, no pagination) so
// scrolling can get sluggish past ~200K rows, but analyses read straight from
// DuckDB and are unaffected. Fire-and-forget so the caller's promise resolves
// immediately; the info box appears once the renderer already has control.
export function warnIfLargeDataset(dataset: Dataset): void {
  if (dataset.rowCount <= 200_000) return
  const dlg = dialogText()
  void dialog.showMessageBox({
    type: 'info',
    title: dlg.largeDatasetTitle,
    message: dlg.largeDatasetMessage.replace('{{count}}', dataset.rowCount.toLocaleString()),
    buttons: [dlg.ok]
  })
}

function mapDuckDbTypeToVariableType(dbType: string): VariableType {
  const t = dbType.toUpperCase()
  if (
    t.includes('INT') ||
    t.includes('FLOAT') ||
    t.includes('DOUBLE') ||
    t.includes('DECIMAL') ||
    t.includes('NUMERIC')
  ) {
    return 'numeric'
  }
  if (t.includes('DATE') || t.includes('TIME') || t.includes('TIMESTAMP')) {
    return 'date'
  }
  return 'string'
}

type DbConnection = Awaited<ReturnType<typeof getDbConnection>>

/** How a text column ended up being read, carried between the scan passes. */
interface ColumnPlan {
  name: string
  type: VariableType
  /** Only for columns that arrived as text — they may need rewriting. */
  fromText: boolean
  /** Number notation of a text column read as numeric. */
  style?: NumericStyle
}

/** Distinct/integer facts a numeric column's measurement level is decided on. */
interface NumericStats {
  distinct: number
  allInteger: boolean
}

function num(v: unknown): number {
  return Number(v ?? 0)
}

/**
 * `getSettings()` throws until registerSettingsHandlers() has run (early
 * startup, unit tests). Falling back to the defaults keeps the importer
 * working rather than making inference depend on store initialisation order.
 */
function importSettings(): { maxDistinct: number; detectDecimalComma: boolean } {
  try {
    const s = getSettings().dataImport
    return { maxDistinct: s.categoricalMaxDistinct, detectDecimalComma: s.detectDecimalComma }
  } catch {
    return { maxDistinct: 24, detectDecimalComma: true }
  }
}

async function firstRow(conn: DbConnection, sql: string): Promise<unknown[] | null> {
  const result = await conn.runAndReadAll(sql)
  return result.getRows()[0] ?? null
}

/**
 * Pass 1 — the cheap question, asked of every text column: are all its values
 * plain numbers, or all dates? Three aggregates per column, one scan.
 * Columns that answer neither are handed to pass 2.
 */
async function scanPlainTypes(
  conn: DbConnection,
  tempTableName: string,
  textCols: ColumnPlan[],
  detectDecimalComma: boolean
): Promise<ColumnPlan[]> {
  const clauses = textCols.flatMap((p, i) => {
    const col = quoteCol(p.name)
    const ne = nonEmptyExpr(col)
    return [
      `COUNT(*) FILTER (WHERE ${ne}) AS t_${String(i)}`,
      `COUNT(*) FILTER (WHERE ${ne} AND TRY_CAST(${numericBaseExpr(col)} AS DOUBLE) IS NULL) AS n_${String(i)}`,
      `COUNT(*) FILTER (WHERE ${ne} AND ${dateValueExpr(col)} IS NULL) AS d_${String(i)}`,
      // Codes written with a leading zero ("001", "0532…" phone numbers, zip
      // codes) are identifiers, not quantities — casting them would destroy
      // the zeros. SPSS keeps such Excel/CSV text columns as strings too.
      `COUNT(*) FILTER (WHERE ${ne} AND regexp_matches(${numericBaseExpr(col)}, '^[+-]?0[0-9]+$')) AS z_${String(i)}`
    ]
  })
  const row = await firstRow(conn, `SELECT ${clauses.join(', ')} FROM ${tempTableName}`)
  if (!row) return []

  const unresolved: ColumnPlan[] = []
  textCols.forEach((p, i) => {
    const total = num(row[i * 4])
    const nonNumeric = num(row[i * 4 + 1])
    const nonDate = num(row[i * 4 + 2])
    const leadingZero = num(row[i * 4 + 3])
    // An entirely empty column carries no evidence — leave it as text.
    if (total === 0) return
    if (leadingZero > 0) return
    if (nonNumeric === 0) {
      p.type = 'numeric'
      p.style = 'plain'
    } else if (nonDate === 0) {
      p.type = 'date'
    } else if (detectDecimalComma) {
      unresolved.push(p)
    }
  })
  return unresolved
}

/**
 * Pass 2 — only for columns that are neither plain numbers nor dates: count
 * the separator shapes so chooseNumericStyle() can tell "3,14" (a number in
 * Turkish notation) from "1,234" (a thousands separator) from "1.2.3" (not a
 * number at all). Eight aggregates per column, which is why it is restricted
 * to the columns that actually need it.
 */
async function scanSeparatorStyles(
  conn: DbConnection,
  tempTableName: string,
  unresolved: ColumnPlan[]
): Promise<void> {
  const clauses = unresolved.flatMap((p, i) => {
    const col = quoteCol(p.name)
    const ne = nonEmptyExpr(col)
    const base = numericBaseExpr(col)
    const hasComma = `contains(${base}, ',')`
    const hasDot = `contains(${base}, '.')`
    const commaOnly = `${hasComma} AND NOT ${hasDot}`
    const dotOnly = `${hasDot} AND NOT ${hasComma}`
    // Searching the reversed string: the separator with the SMALLER reverse
    // position is the one that occurs last, i.e. the decimal mark.
    const commaIsLast = `strpos(reverse(${base}), ',') < strpos(reverse(${base}), '.')`
    return [
      `COUNT(*) FILTER (WHERE ${ne} AND TRY_CAST(${numericValueExpr(col, 'comma-decimal')} AS DOUBLE) IS NULL) AS a_${String(i)}`,
      `COUNT(*) FILTER (WHERE ${ne} AND TRY_CAST(${numericValueExpr(col, 'dot-decimal')} AS DOUBLE) IS NULL) AS b_${String(i)}`,
      `COUNT(*) FILTER (WHERE ${ne} AND ${hasComma} AND ${hasDot}) AS c_${String(i)}`,
      `COUNT(*) FILTER (WHERE ${ne} AND ${hasComma} AND ${hasDot} AND ${commaIsLast}) AS d_${String(i)}`,
      `COUNT(*) FILTER (WHERE ${ne} AND ${commaOnly}) AS e_${String(i)}`,
      `COUNT(*) FILTER (WHERE ${ne} AND ${commaOnly} AND regexp_matches(${base}, '^[+-]?\\d{1,3}(,\\d{3})+$')) AS f_${String(i)}`,
      `COUNT(*) FILTER (WHERE ${ne} AND ${dotOnly}) AS g_${String(i)}`,
      `COUNT(*) FILTER (WHERE ${ne} AND ${dotOnly} AND regexp_matches(${base}, '^[+-]?\\d{1,3}(\\.\\d{3})+$')) AS h_${String(i)}`
    ]
  })
  const row = await firstRow(conn, `SELECT ${clauses.join(', ')} FROM ${tempTableName}`)
  if (!row) return

  unresolved.forEach((p, i) => {
    const at = (offset: number): number => num(row[i * 8 + offset])
    const counts: SeparatorCounts = {
      nonNumCommaDecimal: at(0),
      nonNumDotDecimal: at(1),
      bothSeparators: at(2),
      commaLast: at(3),
      commaValues: at(4),
      commaGrouped: at(5),
      dotValues: at(6),
      dotGrouped: at(7)
    }
    const style = chooseNumericStyle(counts)
    if (style) {
      p.type = 'numeric'
      p.style = style
    }
  })
}

/**
 * Rewrite every text column that turned out to be numeric or a date into its
 * real DuckDB type, applying the same normalisation the scan decided on.
 *
 * This is not only about "3,14". The loader used to run a bare
 * `CAST(col AS DOUBLE)` on whatever this function classified as numeric, and
 * DuckDB's CAST *throws* on a value it cannot convert — so a column whose
 * first cell carried a BOM was recognised as numeric here and then aborted the
 * whole import there. Materialising with TRY_CAST once, up front, means the
 * loader's cast is a no-op and an unconvertible straggler becomes NULL
 * (missing) instead of a failed import.
 */
async function materialiseColumnTypes(
  conn: DbConnection,
  tempTableName: string,
  plans: ColumnPlan[]
): Promise<void> {
  for (const p of plans) {
    if (!p.fromText || p.type === 'string') continue
    const col = quoteCol(p.name)
    const [target, expr] =
      p.type === 'numeric'
        ? ['DOUBLE', `TRY_CAST(${numericValueExpr(col, p.style ?? 'plain')} AS DOUBLE)`]
        : ['TIMESTAMP', dateValueExpr(col)]
    try {
      await conn.runAndReadAll(
        `ALTER TABLE ${tempTableName} ALTER COLUMN ${col} SET DATA TYPE ${target} USING ${expr}`
      )
      if (p.style && p.style !== 'plain') {
        log.info(`[import] column "${p.name}" read as numeric (${p.style} notation)`)
      }
    } catch (err) {
      log.warn(`[import] could not convert column "${p.name}" to ${target}, keeping text:`, err)
      p.type = 'string'
      p.style = undefined
    }
  }
}

/**
 * Distinct-value and whole-number counts for every numeric column — the input
 * to deriveMeasure().
 *
 * Two stages on purpose: an exact COUNT(DISTINCT) over every numeric column of
 * a wide, long table builds one hash table per column and can cost more memory
 * than the data itself, while the only thing the threshold rule needs to know
 * is whether the count is *small*. So HyperLogLog answers that cheaply first
 * (it is effectively exact in the small range, and its error only shows up at
 * cardinalities far above any category threshold), and the exact count is then
 * asked only of the handful of columns near the threshold.
 */
async function scanNumericStats(
  conn: DbConnection,
  tempTableName: string,
  numericCols: ColumnPlan[],
  maxDistinct: number
): Promise<Map<string, NumericStats>> {
  const stats = new Map<string, NumericStats>()
  const approxClauses = numericCols.flatMap((p, i) => {
    const col = quoteCol(p.name)
    return [
      `approx_count_distinct(${col}) AS a_${String(i)}`,
      `COUNT(*) FILTER (WHERE ${col} IS NOT NULL AND ${col} <> FLOOR(${col})) AS n_${String(i)}`
    ]
  })
  const row = await firstRow(conn, `SELECT ${approxClauses.join(', ')} FROM ${tempTableName}`)
  if (!row) return stats

  const needExact: ColumnPlan[] = []
  numericCols.forEach((p, i) => {
    const approx = num(row[i * 2])
    const allInteger = num(row[i * 2 + 1]) === 0
    stats.set(p.name, { distinct: approx, allInteger })
    // Slack over the threshold so an approximation that drifts a little near
    // the boundary still gets checked exactly.
    if (allInteger && approx <= maxDistinct * 2 + 8) needExact.push(p)
  })

  if (needExact.length > 0) {
    const exactClauses = needExact.map(
      (p, i) => `COUNT(DISTINCT ${quoteCol(p.name)}) AS e_${String(i)}`
    )
    const exactRow = await firstRow(conn, `SELECT ${exactClauses.join(', ')} FROM ${tempTableName}`)
    if (exactRow) {
      needExact.forEach((p, i) => {
        const current = stats.get(p.name)
        if (current) current.distinct = num(exactRow[i])
      })
    }
  }
  return stats
}

/**
 * Builds the variable metadata for an imported temp table — the single place
 * where raw source headers become SAI variables, regardless of source format
 * (CSV, Excel, SPSS/Stata/SAS via read_stat). Every importer funnels its data
 * into a temp table and calls this; there is no per-format variable logic.
 *
 * Two things are decided here, and they are separate questions:
 *   - the storage TYPE, refined by scanning the values (Excel arrives entirely
 *     as text, and CSV columns DuckDB sniffed as VARCHAR may still be numbers
 *     written in another locale's notation);
 *   - the MEASUREMENT LEVEL, from distinct-value counts rather than from the
 *     type. Deriving it from the type alone — the rule this used to apply —
 *     made every 1/2-coded group variable a Scale variable.
 *
 * `fileMeta` carries labels the source file declared about itself (.sav/.dta,
 * see stat-metadata.ts); it is always optional and always empty for formats
 * that carry no metadata.
 *
 * Returns the variables plus a parallel `sourceColumns` array (the raw temp
 * column name for each variable) so the loader can map columns even though
 * `name` has been sanitized away from the original header.
 */
export async function buildVariablesFromTempTable(
  conn: DbConnection,
  tempTableName: string,
  fileMeta: Record<string, StatFileVariableMeta> = {},
  /** SPSS/Stata/SAS declare their column types — a string variable holding
   *  "001" codes must stay a string, not be re-typed by the text scan. */
  trustSourceTypes = false
): Promise<{ variables: Variable[]; sourceColumns: string[] }> {
  const info = await conn.runAndReadAll(`PRAGMA table_info('${tempTableName}')`)
  const pragmaRows = info.getRows() as [number, string, string, boolean, unknown, boolean][]
  const { maxDistinct, detectDecimalComma } = importSettings()

  const plans: ColumnPlan[] = pragmaRows.map(row => {
    const type = mapDuckDbTypeToVariableType(row[2])
    return { name: row[1], type, fromText: type === 'string' && !trustSourceTypes }
  })

  // 1–3. Refine the text columns and materialise whatever they turned out to
  //      be. A scan failure is not fatal: the columns simply stay text.
  const textCols = plans.filter(p => p.fromText)
  if (textCols.length > 0) {
    try {
      const unresolved = await scanPlainTypes(conn, tempTableName, textCols, detectDecimalComma)
      if (unresolved.length > 0) {
        await scanSeparatorStyles(conn, tempTableName, unresolved)
      }
      await materialiseColumnTypes(conn, tempTableName, plans)
    } catch (err) {
      log.warn('Failed to refine column types using data scan:', err)
    }
  }

  // 4. Distinct/integer counts drive the measurement level.
  let numericStats = new Map<string, NumericStats>()
  const numericCols = plans.filter(p => p.type === 'numeric')
  if (numericCols.length > 0 && maxDistinct > 0) {
    try {
      numericStats = await scanNumericStats(conn, tempTableName, numericCols, maxDistinct)
    } catch (err) {
      log.warn('Failed to scan numeric columns for measurement level:', err)
    }
  }

  // 5. Build variables. `name` = sanitized + unique identifier (dialogs/scripts);
  //    `label` = the file's own label when it has one, else the raw header,
  //    shown verbatim in output. `sourceColumns` keeps the raw header so the
  //    loader can still find the temp column.
  let colSeq = 1
  const sourceColumns: string[] = []
  const usedNames: string[] = []
  const variables: Variable[] = plans.map(plan => {
    const colName = plan.name
    const varType = plan.type
    const meta = fileMeta[colName]
    const valueLabels = meta?.valueLabels ?? {}
    const stats = numericStats.get(colName)
    // A statistical file's own print format (SPSS F8.0 → 0 decimals) wins
    // over the generic 2-decimal default.
    // File metadata is clamped into the schema's bounds — an out-of-range
    // value would import fine but make the saved .sdf fail to reopen.
    const decimals = varType === 'numeric' ? clampVariableAttr('decimals', meta?.decimals ?? 2) : 0
    const numfmtPattern =
      varType === 'numeric'
        ? decimals > 0
          ? `0.${'0'.repeat(decimals)}`
          : '0'
        : varType === 'date'
          ? 'yyyy-MM-dd'
          : undefined
    const colId = `col_${String(colSeq)}`
    const name = makeUniqueVariableName(sanitizeVariableName(colName, colSeq), usedNames)
    usedNames.push(name)
    sourceColumns.push(colName)
    colSeq++
    return {
      colId,
      name,
      type: varType,
      width: clampVariableAttr('width', meta?.width ?? (varType === 'numeric' ? 8 : 20)),
      decimals,
      label: meta?.label ?? colName,
      valueLabels,
      missing: meta?.missing ?? null,
      columns: clampVariableAttr('columns', meta?.columns ?? Math.max(8, colName.length + 4)),
      align: varType === 'numeric' ? 'right' : 'left',
      measure: deriveMeasure({
        type: varType,
        distinct: stats?.distinct ?? 0,
        allInteger: stats?.allInteger ?? false,
        maxDistinct,
        hasValueLabels: Object.keys(valueLabels).length > 0
      }),
      role: 'none',
      numfmtPattern
    } satisfies Variable
  })

  return { variables, sourceColumns }
}

/**
 * Zip-bomb + zip-slip guard for our own zip-based file format (.sdf
 * datasets, incl. the embedded output.json): rejects archives with too many entries
 * or too much uncompressed data, then extracts only `allowedFiles` (by exact
 * entry name — no path traversal) into `destDir`. `formatLabel` is used only
 * for the error message shown to the user (e.g. ".sdf").
 */
export function extractZipSafely(
  filePath: string,
  allowedFiles: string[],
  destDir: string,
  formatLabel: string
): void {
  const zip = new AdmZip(filePath)
  const entries = zip.getEntries()

  if (entries.length > 20) {
    throw new Error(`Invalid ${formatLabel} file: Too many entries inside the archive`)
  }
  let totalSize = 0
  const SIZE_LIMIT = 500 * 1024 * 1024 // 500 MB limit
  for (const entry of entries) {
    totalSize += entry.header.size
    if (totalSize > SIZE_LIMIT) {
      throw new Error(`Invalid ${formatLabel} file: Uncompressed data size exceeds safety limit`)
    }
  }

  for (const entry of entries) {
    if (allowedFiles.includes(entry.entryName)) {
      zip.extractEntryTo(entry.entryName, destDir, false, true)
    }
  }
}
