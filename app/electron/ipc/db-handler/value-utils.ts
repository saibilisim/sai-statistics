// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { CellValue } from '../../../shared/data-types'
import log from 'electron-log'

/**
 * Sanitizes and parses localized numeric strings (e.g. "1.000,25", "1,000.25", or "1000,25")
 * and SPSS-style scientific notations (e.g. "1.23D2", "1.23E+2", "1.23+2", "1.23-2")
 * into standard float numbers before inserting into numeric database columns.
 */
export function parseLocalizedNumber(val: CellValue): CellValue {
  if (val === null || val === '') return null
  if (typeof val === 'number') return val
  if (typeof val === 'boolean') return val

  if (typeof val === 'string') {
    let clean = val.trim()
    if (!clean) return null

    // 1. Support SPSS-style scientific notation: 1.23E2, 1.23D2, 1.23E+2, 1.23+2, 1.23-2
    // Pattern: coefficient + [E/D/e/d/+/-] + exponent_digits
    const sciRegex = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([EDed]|[+-])\s*([+-]?\d+)$/
    const match = sciRegex.exec(clean)
    if (match) {
      const coef = match[1] ?? ''
      const indicator = (match[2] ?? '').toUpperCase()
      const exp = match[3] ?? ''

      if (indicator === 'E' || indicator === 'D') {
        clean = `${coef}E${exp}`
      } else {
        // Indicator is '+' or '-'
        clean = `${coef}E${indicator}${exp}`
      }
    } else {
      // 2. Localized decimals/thousands formatting
      const hasComma = clean.includes(',')
      const hasDot = clean.includes('.')

      if (hasComma && hasDot) {
        const commaIdx = clean.lastIndexOf(',')
        const dotIdx = clean.lastIndexOf('.')
        if (commaIdx > dotIdx) {
          // Comma is decimal separator (e.g. "1.000,25")
          clean = clean.replace(/\./g, '').replace(',', '.')
        } else {
          // Dot is decimal separator (e.g. "1,000.25")
          clean = clean.replace(/,/g, '')
        }
      } else if (hasComma) {
        // Only has comma, e.g. "1000,25"
        clean = clean.replace(',', '.')
      }
    }

    const parsed = Number(clean)
    return isNaN(parsed) ? val : parsed
  }

  return val
}

/**
 * Normalizes one raw value read back from `@duckdb/node-api` into a
 * renderer-safe CellValue (string | number | boolean | null).
 *
 * Two shapes the driver returns that CellValue can't represent as-is:
 *  - plain `bigint` (large integer columns) → doesn't survive
 *    structured-clone across the IPC boundary at all.
 *  - a `{ micros: bigint }` wrapper for TIMESTAMP columns (every `date`-typed
 *    variable is stored as TIMESTAMP — see `dbType = 'TIMESTAMP'` above) →
 *    survives the IPC boundary as a plain object, but every consumer
 *    (grid display, clipboard, `.sdf` export) expects a CellValue and had no
 *    idea what to do with it, so it rendered as the literal string
 *    "[object Object]". Found via a real 500K-row fixture during the AG Grid
 *    migration's G8 measurement pass (aggrid-gecis-roadmap.md) — pre-existing,
 *    not introduced by that migration (the prior grid's cell-conversion code
 *    had no date-object handling either, so it would have shown the same thing).
 *
 * DuckDB TIMESTAMP is microseconds since 1970-01-01 UTC; every `date`
 * column here only ever holds a calendar date (no meaningful time-of-day
 * component was ever written), so converting to just the `YYYY-MM-DD` slice
 * of the resulting Date is the whole story — matches the `yyyy-MM-dd`
 * display pattern `aggrid-data.ts`'s `resolveDecimals`-adjacent formatting
 * already assumed date values would arrive in.
 */
export function normalizeDbValue(val: unknown): CellValue {
  if (typeof val === 'bigint') return Number(val)
  if (val !== null && typeof val === 'object' && 'micros' in val) {
    const millis = Number(val.micros) / 1000
    if (!Number.isFinite(millis)) return null
    const d = new Date(millis)
    if (Number.isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
  }
  return val as CellValue
}

/**
 * Splits raw rows shaped `[__case_id, ...userColumns]` into the plain
 * `CellValue[][]` the renderer's grid expects plus the parallel case-id array.
 * Selecting the id as a leading column (rather than a second query) keeps the
 * two perfectly aligned even while another mutation is in flight.
 */
export function splitCaseIds(rowsRaw: CellValue[][]): { rows: CellValue[][]; caseIds: number[] } {
  const rows: CellValue[][] = new Array<CellValue[]>(rowsRaw.length)
  const caseIds: number[] = new Array<number>(rowsRaw.length)
  for (let i = 0; i < rowsRaw.length; i++) {
    const raw = rowsRaw[i] ?? []
    if (raw[0] === null || raw[0] === undefined) {
      log.warn(`[db-handler] NULL __case_id at row ${String(i)}; falling back to positional index`)
    }
    caseIds[i] = Number(raw[0] ?? i)
    const row: CellValue[] = new Array<CellValue>(raw.length - 1)
    for (let c = 1; c < raw.length; c++) row[c - 1] = normalizeDbValue(raw[c])
    rows[i] = row
  }
  return { rows, caseIds }
}
