// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * type-inference.ts — how an imported column's *type*, *number notation* and
 * *measurement level* are decided.
 *
 * Kept apart from shared.ts (which owns the DuckDB round-trips) because every
 * decision here is a pure function of counters: that is what makes the rules
 * testable (tests/unit/type-inference.test.ts) instead of only observable
 * through a full import.
 *
 * Why any of this exists: the importer used to derive both facts from the
 * storage type alone — `numeric → scale, everything else → nominal`. That got
 * both common cases wrong. A 1/2-coded group variable is numeric, so it came
 * in as Scale; and a genuinely continuous column written in Turkish notation
 * ("3,14") failed the DOUBLE cast, fell back to string, and came in as
 * Nominal. Type and measure are separate questions and are answered separately
 * below.
 */

import type { MeasureLevel, VariableType } from '../../../shared/data-types'

/**
 * Which decimal/thousands convention a text column is written in. `plain` is
 * SQL's own notation ("3.14"); the other two need rewriting before the value
 * can be cast, and the same rewrite must be applied when the column is
 * materialised — see `numericValueExpr`.
 */
export type NumericStyle = 'plain' | 'comma-decimal' | 'dot-decimal'

/** SQL identifier quoting for a raw source column name. */
export function quoteCol(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * Invisible characters that ride along in real-world exports and make an
 * otherwise numeric cell uncastable: BOM (Excel/Notepad UTF-8 headers) and the
 * two non-breaking spaces Excel emits as a thousands separator in some locales.
 * The NBSPs become ordinary spaces here rather than disappearing, so date
 * formats that contain a space still line up; `numericBaseExpr` drops them.
 */
export function textCleanExpr(colSql: string): string {
  return `TRIM(REPLACE(REPLACE(REPLACE(${colSql}, CHR(65279), ''), CHR(160), ' '), CHR(8239), ' '))`
}

/** Text cleaning plus space removal — "1 234,56" and " 12 " both normalise. */
export function numericBaseExpr(colSql: string): string {
  return `REPLACE(${textCleanExpr(colSql)}, ' ', '')`
}

/** The cleaned value rewritten into SQL's own notation, ready to cast. */
export function numericValueExpr(colSql: string, style: NumericStyle): string {
  const base = numericBaseExpr(colSql)
  switch (style) {
    // "1.234,56" → "1234,56" → "1234.56"
    case 'comma-decimal':
      return `REPLACE(REPLACE(${base}, '.', ''), ',', '.')`
    // "1,234.56" → "1234.56"
    case 'dot-decimal':
      return `REPLACE(${base}, ',', '')`
    default:
      return base
  }
}

/** Non-empty test — a cell of nothing but spaces/NBSP counts as missing. */
export function nonEmptyExpr(colSql: string): string {
  return `${colSql} IS NOT NULL AND ${numericBaseExpr(colSql)} <> ''`
}

/**
 * Date layouts a text column is tried against, most-specific first. ISO plus
 * the day-first and month-first slash/dot forms Excel exports in TR/EN locales.
 */
const SQL_DATE_FORMATS = [
  '%Y-%m-%d %H:%M:%S',
  '%Y-%m-%d %H:%M',
  '%Y-%m-%d',
  '%d.%m.%Y %H:%M:%S',
  '%d.%m.%Y %H:%M',
  '%d.%m.%Y',
  '%d/%m/%Y %H:%M:%S',
  '%d/%m/%Y %H:%M',
  '%d/%m/%Y',
  '%m/%d/%Y %H:%M:%S',
  '%m/%d/%Y %H:%M',
  '%m/%d/%Y'
]

/**
 * Parsed timestamp, or NULL when the cell matches no known layout.
 *
 * Guarded by "must contain a four-digit run", because strptime's %Y happily
 * matches a one-digit year: without the guard "1.2.3" parses as 3 AD and a
 * column of version strings imports as dates.
 */
export function dateValueExpr(colSql: string): string {
  const list = SQL_DATE_FORMATS.map(f => `'${f}'`).join(', ')
  const clean = textCleanExpr(colSql)
  return `CASE WHEN regexp_matches(${clean}, '(^|[^0-9])[0-9]{4}([^0-9]|$)') THEN try_strptime(${clean}, [${list}]) END`
}

/**
 * Counters describing the separator *shape* of a text column, collected only
 * for columns that failed a plain numeric cast and a date parse. Every field
 * counts non-empty cells.
 */
export interface SeparatorCounts {
  /** Cells that still fail to cast when read as "1.234,56". */
  nonNumCommaDecimal: number
  /** Cells that still fail to cast when read as "1,234.56". */
  nonNumDotDecimal: number
  /** Cells containing both separators. */
  bothSeparators: number
  /** Of those, the ones where the comma is the *last* separator. */
  commaLast: number
  /** Cells with commas only. */
  commaValues: number
  /** Of those, the ones grouped strictly as thousands ("1,234", "12,345,678"). */
  commaGrouped: number
  /** Cells with dots only. */
  dotValues: number
  /** Of those, the ones grouped strictly as thousands ("1.234.567"). */
  dotGrouped: number
}

/**
 * Decide the number notation of a column whose plain cast already failed.
 * Returns null when the column is not numeric under any convention, or when
 * the evidence is contradictory — a column that mixes conventions is left as
 * text rather than silently reinterpreted, because guessing wrong here does
 * not produce a visible error, it produces wrong numbers.
 */
export function chooseNumericStyle(c: SeparatorCounts): NumericStyle | null {
  // Values carrying both separators settle the question on their own: the one
  // that appears last is the decimal mark. Require unanimity — a column with
  // both "1.234,56" and "1,234.56" in it is not trustworthy either way.
  if (c.bothSeparators > 0) {
    if (c.commaLast === c.bothSeparators && c.nonNumCommaDecimal === 0) return 'comma-decimal'
    if (c.commaLast === 0 && c.nonNumDotDecimal === 0) return 'dot-decimal'
    return null
  }

  // Commas only. "1,234" is genuinely ambiguous (1234 or 1.234?); read it as a
  // thousands separator when *every* comma cell is strictly grouped, which is
  // how Excel and SPSS read it, and as a decimal mark otherwise — one "3,14"
  // in the column is proof of the Turkish convention.
  if (c.commaValues > 0 && c.dotValues === 0) {
    if (c.commaValues === c.commaGrouped && c.nonNumDotDecimal === 0) return 'dot-decimal'
    if (c.nonNumCommaDecimal === 0) return 'comma-decimal'
    return null
  }

  // Dots only, and the plain cast already failed — so these dots are not
  // decimal marks. Accept them as thousands separators only when they are
  // strictly grouped, so that "1.234.567" becomes 1234567 while version-like
  // strings ("1.2.3") stay text instead of turning into 123.
  if (c.dotValues > 0 && c.commaValues === 0) {
    if (c.dotValues === c.dotGrouped && c.nonNumCommaDecimal === 0) return 'comma-decimal'
    return null
  }

  // No separators at all (or both kinds in different cells) — nothing to fix.
  return null
}

export interface MeasureInput {
  type: VariableType
  /** Distinct non-empty values; only meaningful for numeric columns. */
  distinct: number
  /** True when every value is a whole number. */
  allInteger: boolean
  /** Upper bound for "few enough distinct values to be a category". */
  maxDistinct: number
  /** Set when the source file itself declares value labels (.sav/.dta). */
  hasValueLabels?: boolean
}

/**
 * Measurement level, decided independently of storage type.
 *
 * The threshold rule is SPSS's ("measurement level for unknown", default 24):
 * a numeric column of whole numbers with few distinct values is a code, not a
 * quantity. We stop at Nominal and never guess Ordinal — nothing in the data
 * distinguishes a Likert item from an unordered code, and Nominal is the
 * conservative wrong answer (it never implies an order that isn't there).
 * Non-integer values are always Scale: no one codes categories as 3.7.
 */
export function deriveMeasure(o: MeasureInput): MeasureLevel {
  // A declared value label is the file's own statement that the codes mean
  // something — it outranks any count-based guess.
  if (o.hasValueLabels) return 'nominal'
  if (o.type === 'string') return 'nominal'
  // Dates are quantities on a scale, and SPSS treats them as Scale too.
  if (o.type === 'date') return 'scale'
  if (!o.allInteger) return 'scale'
  if (o.maxDistinct <= 0) return 'scale'
  return o.distinct > 0 && o.distinct <= o.maxDistinct ? 'nominal' : 'scale'
}
