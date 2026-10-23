// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * aggrid-data.ts — Pure, framework-free helpers that turn DuckDB CellValue
 * rows + Variable metadata into what AG Grid needs for display (formatted
 * text, missing/label detection). Ports the display logic that used to live
 * in the previous grid's cell-conversion helper — that grid's per-cell
 * object construction (value/type/style/custom fields) has no AG Grid
 * equivalent; AG Grid instead asks per-cell via valueFormatter/
 * cellClassRules, so this file exposes the same lookups as small standalone
 * functions instead of one object builder.
 */

import type { Variable, CellValue, CellFormat } from '@shared/data-types'

/**
 * Looks up the value label for a cell value. Tries the exact key first, then
 * a numeric match: the grid displays numerics formatted ("1.00"), so users
 * often type the formatted text into the Value Labels dialog while DuckDB
 * hands back the canonical form ("1"). `{"1.00": "Erkek"}` must still match
 * the value 1. (Ported unchanged from the previous grid's display logic.)
 */
export function findValueLabel(variable: Variable, value: CellValue): string | undefined {
  if (value === null) return undefined
  const valStr = String(value)
  const direct = variable.valueLabels[valStr]
  if (direct !== undefined) return direct

  const num = Number(valStr)
  if (valStr.trim() === '' || Number.isNaN(num)) return undefined
  for (const [key, label] of Object.entries(variable.valueLabels)) {
    if (Number(key) === num) return label
  }
  return undefined
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Normalizes text for search matching, handling Turkish characters (e.g. ı/i)
 * and diacritics case-insensitively.
 */
export function normalizeForSearch(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
}

/**
 * Formats a value and its optional label for display in filter lists (e.g. "1 - Erkek").
 * Empty value returns "(Empty)". If no label, returns the raw value.
 * If the label already includes the value prefix, returns the label without duplicating.
 */
export function formatFilterItemLabel(value: string, label: string | undefined): string {
  if (value === '') return '(Empty)'
  if (!label) return value
  const trimmedLabel = label.trim()
  if (trimmedLabel === value) return value
  // If the label is already prefixed with the value (e.g. "1 - Erkek", "1: Erkek", "1. Erkek")
  const prefixRegex = new RegExp(`^${escapeRegex(value)}\\s*[-:.]\\s*`, 'i')
  if (prefixRegex.test(trimmedLabel)) {
    return trimmedLabel
  }
  return `${value} - ${trimmedLabel}`
}

/** Checks whether a cell value qualifies as a user-defined missing value. */
export function isMissingValue(value: CellValue, missing: Variable['missing']): boolean {
  if (!missing) return false
  if (value === null) return true

  const numVal = typeof value === 'number' ? value : NaN

  switch (missing.type) {
    case 'discrete':
      return missing.discrete?.some(d => d === value || String(d) === String(value)) ?? false

    case 'range':
      if (isNaN(numVal)) return false
      return (
        missing.rangeLow !== undefined &&
        numVal >= missing.rangeLow &&
        missing.rangeHigh !== undefined &&
        numVal <= missing.rangeHigh
      )

    case 'range+discrete': {
      const inDiscrete =
        missing.discrete?.some(d => d === value || String(d) === String(value)) ?? false
      if (inDiscrete) return true
      if (isNaN(numVal)) return false
      return (
        missing.rangeLow !== undefined &&
        numVal >= missing.rangeLow &&
        missing.rangeHigh !== undefined &&
        numVal <= missing.rangeHigh
      )
    }

    default:
      return false
  }
}

/**
 * Resolves the display decimal count for a numeric variable. Priority:
 * explicit numfmtPattern (parsed for its decimal-digit count) > decimals field.
 */
function resolveDecimals(v: Variable): number {
  if (v.numfmtPattern) {
    const match = /\.(0+)/.exec(v.numfmtPattern)
    if (match?.[1]) return match[1].length
  }
  return v.decimals
}

/**
 * Applies a hücre-bazlı (cell-level) display-only number format override
 * (P1.7, spreadsheet-ozellikleri-envanteri.md §3/§6) — the raw stored value
 * never changes, only how it's rendered. Currency defaults to TRY (SAI is a
 * Turkish-market product) but the Ribbon's Currency control (a flat symbol
 * menu — $/€/£/¥/₺) can override it per cell via `CellFormat.currency`.
 * Percent appends "%" to the value as-is rather than multiplying by 100 —
 * SPSS-style data typically already stores "50" to mean "50%", unlike
 * Excel's fraction convention (0.5 → "50%"), so multiplying here would
 * silently misrepresent the actual stored value.
 */
function applyNumberFormat(
  num: number,
  format: NonNullable<CellFormat['numberFormat']>,
  decimals: number,
  currency: NonNullable<CellFormat['currency']> = 'TRY',
  separator: DecimalSeparator = currentDataDecimalSeparator
): string {
  switch (format) {
    case 'currency':
      // TRY explicitly uses the Turkish locale (established convention —
      // SAI defaults to it); every other currency defers to the system/
      // browser locale for grouping/placement conventions — the SYMBOL
      // itself comes from the `currency` code, not the locale, so ¥/€/£/$
      // render correctly regardless.
      return new Intl.NumberFormat(currency === 'TRY' ? 'tr-TR' : undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }).format(num)
    case 'percent':
      return withSeparator(num.toFixed(decimals), separator) + '%'
    case 'scientific':
      return num.toExponential(decimals)
    case 'number':
      // System/browser locale (not hardcoded 'tr-TR' like currency above) —
      // SAI's UI ships in 6 languages (CLAUDE.md §6), and grouping/decimal
      // separator conventions should follow whatever locale the OS/browser
      // is already using, not force Turkish formatting on every language.
      return new Intl.NumberFormat(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: true
      }).format(num)
    case 'general':
    default:
      return withSeparator(num.toFixed(decimals), separator)
  }
}

/** Data View's decimal-separator Preference (editor.decimalSeparator, P1.9) —
 *  display only, distinct from output's (see settings-types.ts). */
export type DecimalSeparator = 'dot' | 'comma'

// Module-level, mirroring output-format.ts's currentSeparator: most callers
// here (find-replace matching, cell-selection copy, the autocomplete list in
// use-data-view-shortcuts.ts) are plain functions with no settings in hand,
// only the CellValue/Variable they're already passed. use-app-effects.ts
// syncs this from editor.decimalSeparator on load and on every Preferences
// change; use-column-defs.ts additionally passes the setting explicitly
// (below) since it already reads it reactively for the grid's own colDefs.
let currentDataDecimalSeparator: DecimalSeparator = 'comma'

export function setDataViewDecimalSeparator(separator: DecimalSeparator): void {
  currentDataDecimalSeparator = separator
}

/** Swaps the JS decimal point for the active separator (mirrors
 *  output-format.ts's applySeparator; kept local since DataView's
 *  formatter is a plain string result, not a DecimalSeparator char). */
function withSeparator(s: string, separator: DecimalSeparator): string {
  return separator === 'comma' ? s.replace('.', ',') : s
}

/**
 * Formats a single raw CellValue for display, matching the previous grid's
 * rendering: value-label text when Value Labels mode is on and a label
 * exists, else numeric values formatted to the variable's decimal count
 * (optionally overridden per-cell by `numberFormat`, P1.7), else the raw
 * string. Null → empty string.
 */
export function formatCellDisplay(
  value: CellValue,
  variable: Variable,
  showValueLabels: boolean,
  numberFormat?: CellFormat['numberFormat'],
  currency?: CellFormat['currency'],
  decimalSeparator: DecimalSeparator = currentDataDecimalSeparator
): string {
  if (value === null) return ''

  if (showValueLabels) {
    const label = findValueLabel(variable, value)
    if (label !== undefined) return label
  }

  if (variable.type === 'numeric') {
    const num = typeof value === 'number' ? value : Number(value)
    if (!Number.isNaN(num)) {
      const decimals = resolveDecimals(variable)
      if (numberFormat && numberFormat !== 'general') {
        return applyNumberFormat(num, numberFormat, decimals, currency, decimalSeparator)
      }
      return withSeparator(num.toFixed(decimals), decimalSeparator)
    }
  }

  return String(value)
}

/**
 * Recovers a plain numeric string from typed/pasted text that may still
 * carry one of this app's OWN display-only `numberFormat` decorations
 * (applyNumberFormat above — Currency/Percent) or the equivalent from a
 * source like Excel: currency symbols, a trailing "%", and a thousands
 * separator. numberFormat never changes the stored value, only the
 * rendering, so typing/pasting a formatted display back in must round-trip
 * to the same plain number — before this, "$1,234.56" or "50%" pasted (or
 * re-typed) into a numeric cell was rejected as invalid, and a
 * thousands-grouped plain number ("12,345.67") silently mis-parsed (the old
 * code blindly replaced the FIRST comma with a period, producing
 * "12.345.67" → NaN → the raw text stored as-is in a numeric column).
 *
 * Percent is intentionally left as-is numerically (stripping "%" from "50%"
 * yields 50, not 0.5) — matches applyNumberFormat's own convention: SPSS-
 * style data already stores "50" to mean 50%, unlike Excel's 0–1 fraction
 * convention.
 *
 * Thousands-separator handling only resolves the UNAMBIGUOUS cases: a
 * separator that repeats, or both `,` and `.` present (a number has only
 * one decimal point, so whichever occurs LAST is it and the other must be
 * grouping). A single lone `,` or `.` (e.g. "12,345" with no other clue) is
 * inherently ambiguous without knowing the source locale — that's kept as
 * this app's existing convention (a single comma = decimal separator,
 * Turkish/European-first per CLAUDE.md), unchanged from before.
 */
function normalizeNumericInput(raw: string): string {
  let s = raw
    .trim()
    .replace(/[₺$€£]/g, '')
    .replace(/\bTL\b|\bTRY\b/gi, '')
    .replace(/%/g, '')
    .trim()
    .replace(/[\s\u00A0]/g, '') // thousands-separator spaces (e.g. "1 234,56")

  const commaCount = (s.match(/,/g) ?? []).length
  const dotCount = (s.match(/\./g) ?? []).length

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = s.lastIndexOf(',')
    const lastDot = s.lastIndexOf('.')
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (commaCount > 1) {
    s = s.replace(/,/g, '')
  } else if (dotCount > 1) {
    s = s.replace(/\./g, '')
  } else if (commaCount === 1) {
    s = s.replace(',', '.')
  }
  return s
}

/** Parses user-typed display text back into a CellValue for a given variable
 *  before persisting — inverse of formatCellDisplay for the common case
 *  (label text typed back untouched should re-resolve to its raw code). */
export function parseCellInput(
  displayValue: string,
  variable: Variable,
  showValueLabels: boolean
): CellValue {
  if (displayValue === '') return null

  if (showValueLabels) {
    // If the typed text matches a known label exactly, resolve to its raw code.
    for (const [rawKey, label] of Object.entries(variable.valueLabels)) {
      if (label === displayValue) {
        return variable.type === 'numeric' && !Number.isNaN(Number(rawKey))
          ? Number(rawKey)
          : rawKey
      }
    }
  }

  if (variable.type === 'numeric') {
    const normalized = normalizeNumericInput(displayValue)
    const num = Number(normalized)
    return Number.isNaN(num) ? displayValue : num
  }

  return displayValue
}

/**
 * Whether a value is acceptable for a numeric column. Empty becomes null
 * (ok); numbers are ok. Ported unchanged from the previous grid's
 * persist-cell-edits.ts (same rule, same rationale: DOUBLE columns can't
 * hold text, so DuckDB would silently drop an invalid write).
 */
function isValidNumericValue(value: CellValue): boolean {
  if (value === null) return true
  if (typeof value === 'number') return true
  if (typeof value === 'boolean') return false
  return !Number.isNaN(Number(value))
}

export type CellEditResult =
  | { ok: true; value: CellValue; truncated: boolean }
  | { ok: false; reason: 'numeric' }

/**
 * Parses raw typed text into a CellValue, validates it against the
 * variable's type, and truncates to `variable.width` if needed — the single
 * entry point AG Grid column defs call from `valueSetter`. Kept as one pure
 * function (rather than split across valueSetter/onCellValueChanged like the
 * previous grid's flow needed) because AG Grid's valueSetter already has direct
 * write access to the row, so there's no reason to defer validation to a
 * later event.
 */
/**
 * Rounds `n` to the most decimals that still fit in `width` characters.
 * Returns null when no rounding helps (the integer part alone is too long, or
 * the value only renders in exponential form) — the caller then keeps the
 * exact value rather than corrupting its magnitude.
 */
function fitNumberToWidth(n: number, width: number): number | null {
  if (!Number.isFinite(n)) return null
  if (String(n).includes('e')) return null // exponential: slicing is meaningless
  for (let d = 10; d >= 0; d--) {
    const candidate = Number(n.toFixed(d))
    if (String(candidate).length <= width) return candidate
  }
  return null
}

export function prepareCellEdit(
  rawInput: string,
  variable: Variable,
  showValueLabels: boolean
): CellEditResult {
  const parsed = parseCellInput(rawInput, variable, showValueLabels)

  if (variable.type === 'numeric' && !isValidNumericValue(parsed)) {
    return { ok: false, reason: 'numeric' }
  }

  let value = parsed
  let truncated = false
  if (value !== null) {
    const strVal = String(value)
    if (strVal.length > variable.width) {
      if (variable.type === 'numeric' && typeof value === 'number') {
        // Numbers are shortened by DROPPING DECIMALS, never by cutting the
        // string: slicing "1.23456789e+30" to 8 chars used to yield 1.234567,
        // off by 30 orders of magnitude (denetim raporu §4.5). If even the
        // rounded-to-integer form doesn't fit, the width is simply too narrow
        // for this magnitude — keep the value exact and only flag it, since
        // silently changing what number was entered is the worse failure.
        const fitted = fitNumberToWidth(value, variable.width)
        if (fitted !== null) {
          value = fitted
          truncated = true
        }
      } else {
        value = strVal.slice(0, variable.width)
        truncated = true
      }
    }
  }

  return { ok: true, value, truncated }
}
