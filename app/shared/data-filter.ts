// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * data-filter.ts — Single source of truth for the column-filter semantics.
 *
 * The Data View applies filters in-memory ({@link matchFilter}) to drive the
 * grid; the analysis layer applies the *same* filter to DuckDB via the WHERE
 * clause {@link buildFilterWhere} builds, so statistics run on exactly the cases
 * the user sees. Both derive from this one definition — the consistency test
 * (tests/) asserts they select identical rows on representative data.
 *
 * Lives in shared/ (no renderer/main imports) so both processes use it.
 */
import type { CellValue, Variable } from './data-types'

export type FilterOperator =
  | 'is_empty'
  | 'is_not_empty'
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'in'
  | 'greater_than'
  | 'less_than'
  | 'greater_than_or_equal'
  | 'less_than_or_equal'

export interface ColumnFilter {
  /** One of {@link FilterOperator}; typed as string since it crosses the store boundary. */
  operator: string
  value: string
}

// ─────────────────────────────────────────────────────────────
//  In-memory evaluation (Data View grid)
// ─────────────────────────────────────────────────────────────

/** Evaluates a single cell value against one filter operator. */
export function matchFilter(val: CellValue, op: string, fVal: string): boolean {
  if (op === 'is_empty') {
    return val === null || String(val).trim() === ''
  }
  if (op === 'is_not_empty') {
    return val !== null && String(val).trim() !== ''
  }
  if (val === null) return false

  const sVal = String(val).toLowerCase()
  const sFilter = fVal.toLowerCase()

  switch (op) {
    case 'equals':
      return sVal === sFilter
    case 'not_equals':
      return sVal !== sFilter
    case 'contains':
      return sVal.includes(sFilter)
    case 'starts_with':
      return sVal.startsWith(sFilter)
    case 'ends_with':
      return sVal.endsWith(sFilter)
    case 'in': {
      try {
        // Parsed JSON entries are untyped, so coerce each to a string for compare.
        const list = JSON.parse(fVal) as unknown[]
        return list.map(item => String(item).toLowerCase()).includes(sVal)
      } catch {
        return false
      }
    }
    case 'greater_than': {
      const nVal = Number(val)
      const nFilter = Number(fVal)
      if (!isNaN(nVal) && !isNaN(nFilter)) return nVal > nFilter
      return sVal > sFilter
    }
    case 'less_than': {
      const nVal = Number(val)
      const nFilter = Number(fVal)
      if (!isNaN(nVal) && !isNaN(nFilter)) return nVal < nFilter
      return sVal < sFilter
    }
    case 'greater_than_or_equal': {
      const nVal = Number(val)
      const nFilter = Number(fVal)
      if (!isNaN(nVal) && !isNaN(nFilter)) return nVal >= nFilter
      return sVal >= sFilter
    }
    case 'less_than_or_equal': {
      const nVal = Number(val)
      const nFilter = Number(fVal)
      if (!isNaN(nVal) && !isNaN(nFilter)) return nVal <= nFilter
      return sVal <= sFilter
    }
    default:
      return true
  }
}

// ─────────────────────────────────────────────────────────────
//  SQL translation (analysis layer / DuckDB)
// ─────────────────────────────────────────────────────────────

export interface FilterWhere {
  /** WHERE body without the `WHERE` keyword; empty string when no active filter. */
  sql: string
  /** Positional bind parameters matching the `?` placeholders in {@link sql}. */
  params: (string | number)[]
}

/**
 * A SQL expression that renders a column the same way JS `String(value)` does,
 * lowercased — so SQL string comparisons match {@link matchFilter}. The key
 * subtlety: a numeric column stores `5` as the DOUBLE `5.0`, whose default
 * VARCHAR cast is `'5.0'`, but JS `String(5)` is `'5'`. For integral numeric
 * values we therefore render via BIGINT to drop the `.0`.
 */
function valueStrExpr(colId: string, isNumeric: boolean): string {
  const col = `"${colId}"` // colId is allow-listed (^col_\d+$) — safe to interpolate
  if (!isNumeric) return `LOWER(CAST(${col} AS VARCHAR))`
  return (
    `LOWER(CASE WHEN ${col} = floor(${col}) AND abs(${col}) < 1e15 ` +
    `THEN CAST(CAST(${col} AS BIGINT) AS VARCHAR) ELSE CAST(${col} AS VARCHAR) END)`
  )
}

/**
 * Builds a parameterised WHERE body mirroring {@link matchFilter} for every
 * active column filter (AND-combined). Column identifiers come from the
 * allow-listed `colId`; all user values are bound parameters (no interpolation).
 * Filters on unknown columns are ignored (matches matchFilter's colIdx === -1).
 */
export function buildFilterWhere(
  columnFilters: Record<string, ColumnFilter>,
  variables: Pick<Variable, 'colId' | 'type'>[]
): FilterWhere {
  const byId = new Map(variables.map(v => [v.colId, v]))
  const clauses: string[] = []
  const params: (string | number)[] = []

  for (const [colId, filter] of Object.entries(columnFilters)) {
    const variable = byId.get(colId)
    if (!variable) continue // unknown column → no constraint (matchFilter parity)

    const col = `"${colId}"`
    const isNumeric = variable.type === 'numeric'
    const valStr = valueStrExpr(colId, isNumeric)
    const op = filter.operator
    const fLower = filter.value.toLowerCase()

    switch (op) {
      case 'is_empty':
        clauses.push(`(${col} IS NULL OR trim(CAST(${col} AS VARCHAR)) = '')`)
        break
      case 'is_not_empty':
        clauses.push(`(${col} IS NOT NULL AND trim(CAST(${col} AS VARCHAR)) <> '')`)
        break
      // Every operator below treats NULL as non-matching (matchFilter returns
      // false for null), so each guards with `IS NOT NULL`.
      case 'equals':
        clauses.push(`(${col} IS NOT NULL AND ${valStr} = ?)`)
        params.push(fLower)
        break
      case 'not_equals':
        clauses.push(`(${col} IS NOT NULL AND ${valStr} <> ?)`)
        params.push(fLower)
        break
      case 'contains':
        clauses.push(`(${col} IS NOT NULL AND contains(${valStr}, ?))`)
        params.push(fLower)
        break
      case 'starts_with':
        clauses.push(`(${col} IS NOT NULL AND starts_with(${valStr}, ?))`)
        params.push(fLower)
        break
      case 'ends_with':
        clauses.push(`(${col} IS NOT NULL AND ends_with(${valStr}, ?))`)
        params.push(fLower)
        break
      case 'in': {
        let list: unknown[]
        try {
          list = JSON.parse(filter.value) as unknown[]
        } catch {
          clauses.push('FALSE')
          break
        }
        if (list.length === 0) {
          clauses.push('FALSE')
          break
        }
        const placeholders = list.map(() => '?').join(', ')
        clauses.push(`(${col} IS NOT NULL AND ${valStr} IN (${placeholders}))`)
        list.forEach(item => params.push(String(item).toLowerCase()))
        break
      }
      case 'greater_than':
      case 'less_than':
      case 'greater_than_or_equal':
      case 'less_than_or_equal': {
        const sqlOp =
          op === 'greater_than'
            ? '>'
            : op === 'less_than'
              ? '<'
              : op === 'greater_than_or_equal'
                ? '>='
                : '<='
        const numFilter = Number(filter.value)
        if (!isNaN(numFilter)) {
          // matchFilter: numeric compare when BOTH sides are numeric, else
          // lowercased string compare. Decide the value side per-row via TRY_CAST.
          clauses.push(
            `(${col} IS NOT NULL AND CASE WHEN TRY_CAST(${col} AS DOUBLE) IS NOT NULL ` +
              `THEN TRY_CAST(${col} AS DOUBLE) ${sqlOp} ? ELSE ${valStr} ${sqlOp} ? END)`
          )
          params.push(numFilter, fLower)
        } else {
          clauses.push(`(${col} IS NOT NULL AND ${valStr} ${sqlOp} ?)`)
          params.push(fLower)
        }
        break
      }
      default:
        // Unknown operator → matchFilter returns true (no constraint). Skip.
        break
    }
  }

  return { sql: clauses.join(' AND '), params }
}
