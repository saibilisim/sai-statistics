// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Single source of truth for formatting numeric values in output tables.
 *
 * Every analysis renders through OutputView, which delegates number formatting
 * here so that decimals, significance/p-values and the "missing" marker look
 * identical (SPSS-style) across all tables. Change formatting policy here only.
 */

import type { TFunction } from 'i18next'

/** Decimal places used for general statistics and p-values. */
export const OUTPUT_DECIMALS = 3

/** The "missing value" marker shown for null cells (SPSS uses a dot). */
export const MISSING_MARKER = '.'

/**
 * A column whose key denotes a significance / p-value column — i.e. its numeric
 * cells are p-values (…sig, sigTwoTailed, approxSig, leveneSig). The key is the
 * full i18n key (e.g. "output.col.sig"), so we match the "sig" token. We require
 * the key to look like an output/col key to avoid accidental matches.
 */
export function isSignificanceColumn(colKey: string): boolean {
  return /sig/i.test(colKey) && colKey.startsWith('output.')
}

/**
 * Whether a table row reports significance, detected from its label cells. In
 * stacked tables (e.g. a correlation matrix) the p-values sit in data columns
 * named after variables, so the column key cannot tell us — the row's measure
 * label (e.g. "output.col.sigTwoTailed") does.
 */
export function rowIsSignificance(row: ReadonlyArray<string | number | null>): boolean {
  return row.some(c => typeof c === 'string' && isSignificanceColumn(c))
}

/** Drop the leading zero of a decimal string ("0.524" → ".524", "-0.03" → "-.03"). */
function dropLeadingZero(s: string): string {
  return s.replace(/^(-?)0\./, '$1.')
}

// ─── Decimal separator ────────────────────────────────────────────────────────
// SPSS renders numbers in the user's locale: a Turkish SPSS prints "1,55" and
// ",85" where an English one prints "1.55" and "0.85". Output here was always
// dot-separated, which is what the manual SAI-vs-SPSS comparison flagged.
//
// So it is a Preferences setting (output.decimalSeparator), NOT derived from
// the UI language. Deriving it was the first attempt and is the wrong model:
// switching the interface to Turkish would silently reformat every table the
// user had already produced, and someone running a Turkish UI may well be
// submitting dot-separated tables to an English journal. Default is a dot;
// whoever wants commas chooses them once.
//
// Purely presentational. Nothing about how a value is stored, computed, or
// written back to the dataset passes through here — the formatters below are
// reachable only from the output renderer and from output export/clipboard.
// The DuckDB and file-import/export paths do their own thing (see
// electron/ipc/db-handler/state.ts).
//
// dropLeadingZero is a separate setting because it answers a different
// question: the separator is a locale convention, while dropping the leading
// zero is a statistical convention for values that cannot exceed 1, applied
// in every locale.

export type DecimalSeparator = '.' | ','

/** Setting → actual separator. Exported because React callers resolve it
 *  themselves (see OutputTableView) instead of reading the module state. */
export function resolveDecimalSeparator(setting: 'dot' | 'comma'): DecimalSeparator {
  return setting === 'comma' ? ',' : '.'
}

// Module-level because the formatters are called per cell from render/export
// paths that have no settings in hand; use-app-effects sets both from
// Preferences. Every formatter takes an explicit override so tests never
// depend on this state.
let currentSeparator: DecimalSeparator = '.'
let currentDropLeadingZero = true

/** Apply the Preferences number format to the module-state defaults, which the
 *  non-React callers (export, clipboard) rely on. */
export function setOutputNumberFormat(opts: {
  separator: 'dot' | 'comma'
  dropLeadingZero: boolean
}): void {
  currentSeparator = resolveDecimalSeparator(opts.separator)
  currentDropLeadingZero = opts.dropLeadingZero
}

export function getOutputDecimalSeparator(): DecimalSeparator {
  return currentSeparator
}

export function getOutputDropLeadingZero(): boolean {
  return currentDropLeadingZero
}

/** Swap the JS decimal point for the active separator. Applied last, so the
 *  leading-zero rule above keeps matching on "0." regardless of locale. */
function applySeparator(s: string, sep: DecimalSeparator): string {
  return sep === '.' ? s : s.replace('.', sep)
}

/**
 * Format a general statistic: integers verbatim, otherwise fixed decimals with
 * trailing zeros trimmed (keeps the leading zero, e.g. 0.5 → "0.5").
 */
export function formatNumber(
  value: number,
  decimals = OUTPUT_DECIMALS,
  separator: DecimalSeparator = currentSeparator
): string {
  if (!Number.isFinite(value)) return String(value)
  if (Number.isInteger(value)) return String(value)
  return applySeparator(value.toFixed(decimals).replace(/\.?0+$/, ''), separator)
}

/**
 * Format a p-value / significance SPSS-style: anything below the display
 * resolution collapses to "<.001"; otherwise fixed decimals with the leading
 * zero dropped (0.524 → ".524"). A genuine 0 (a p rounded down upstream) is
 * shown as "<.001" since p is never exactly 0.
 */
export function formatSignificance(
  value: number,
  decimals = OUTPUT_DECIMALS,
  separator: DecimalSeparator = currentSeparator,
  dropZero: boolean = currentDropLeadingZero
): string {
  if (!Number.isFinite(value) || value < 0) return formatNumber(value, decimals, separator)
  const strip = (s: string): string => (dropZero ? dropLeadingZero(s) : s)
  const threshold = Math.pow(10, -decimals) // 0.001 at 3 dp
  if (value < threshold) {
    return `<${applySeparator(strip(threshold.toFixed(decimals)), separator)}`
  }
  return applySeparator(strip(value.toFixed(decimals)), separator)
}

/**
 * Format a numeric output cell. `isSig` selects p-value formatting (caller
 * derives it from the column key and/or the row's significance label).
 * `decimals` lets a per-table override (output-resolve.ts TableEdits.decimals)
 * replace the OUTPUT_DECIMALS default without touching the underlying value.
 */
export function formatStatValue(
  value: number,
  isSig: boolean,
  decimals = OUTPUT_DECIMALS,
  separator: DecimalSeparator = currentSeparator,
  dropZero: boolean = currentDropLeadingZero
): string {
  return isSig
    ? formatSignificance(value, decimals, separator, dropZero)
    : formatNumber(value, decimals, separator)
}

/**
 * Output Key Translator Helper.
 *
 * Every key below is assembled dynamically (R output keys, param-suffixed
 * keys like "output.stat.pct90"), so none of them narrow to i18next's typed
 * literal-key union. `call()` centralizes the resulting `as never` widening
 * (tsc requires it for the dynamic-key + options-object overload; see
 * OutputPlotView.tsx's `pe()` helper for the same, confirmed tsc-vs-eslint
 * disagreement) so every branch below can call `t()` normally.
 */
export function translateOutputKey(key: string, t: TFunction): string {
  const call = (k: string, opts?: Record<string, unknown>): string => t(k as never, opts)

  if (typeof key !== 'string') return String(key)

  if (key.includes(':')) {
    const colonIdx = key.indexOf(':')
    const realKey = key.substring(0, colonIdx)
    const paramValue = key.substring(colonIdx + 1)

    // Free text that merely contains a colon (e.g. a raw R error message in an
    // error block's warnings) is not a "key:param" pair — show it untouched
    // instead of swallowing everything before the first colon.
    if (!/^[\w.]+$/.test(realKey)) return key

    // Single-param keys use {{name}}; multi-param keys pipe-separate values that
    // map to {{p0}}, {{p1}}, … (e.g. the chi-square expected-count footnote).
    //
    // A parameter that is itself an output key is translated first, so a label
    // can be composed from a literal and a translated part — Report Summaries
    // in Columns needs "<variable name> — <statistic>" headers, where the
    // variable name is user data and the statistic is a key. Without this the
    // statistic would leak through untranslated.
    //
    // A bare decimal number gets the Preferences decimal separator, like a table
    // cell does — R writes "1.45" into footnote/title parameters (ROC's Youden
    // cutoff, a CI level of 97.5), and in comma mode those printed with a dot
    // while every cell around them used a comma.
    const resolveParam = (p: string): string =>
      p.startsWith('output.')
        ? translateOutputKey(p, t)
        : /^-?\d+\.\d+$/.test(p)
          ? applySeparator(p, currentSeparator)
          : p
    const opts: Record<string, string> = {
      name: resolveParam(paramValue),
      defaultValue: paramValue
    }
    paramValue.split('|').forEach((part, idx) => {
      opts[`p${String(idx)}`] = resolveParam(part)
    })

    // "output.col.X:param" columns live in the root col.* namespace, same as
    // the no-colon "output.col.X" branch below — not nested under output.*.
    if (realKey.startsWith('output.col.')) {
      const subKey = realKey.substring('output.col.'.length)
      return call(`analysis:col.${subKey}`, opts)
    }

    if (realKey.startsWith('output.')) {
      return call(`analysis:${realKey}`, opts)
    }
    return call(realKey, opts)
  }

  if (key.startsWith('analysis.')) {
    const subKey = key.substring('analysis.'.length)
    return call(`analysis:${subKey}`, { defaultValue: key })
  }

  if (key.startsWith('output.col.')) {
    const subKey = key.substring('output.col.'.length)
    return call(`analysis:col.${subKey}`, { defaultValue: subKey })
  }

  if (key.startsWith('output.freq.')) {
    return call(`analysis:${key}`, { defaultValue: key })
  }

  if (key.startsWith('output.crosstabs.')) {
    return call(`analysis:${key}`, { defaultValue: key })
  }

  // output.stat.pct* — percentile labels need special formatting; must be
  // checked BEFORE the general output.* catch-all below.
  if (key.startsWith('output.stat.pct')) {
    const pctValue = key.substring('output.stat.pct'.length)
    return call('analysis:output.stat.pct', {
      value: pctValue,
      defaultValue: `Percentile ${pctValue}`
    })
  }

  // output.errorBlock is the shared error-block title and lives in the common
  // (default) namespace, not under analysis:* — resolve it before the catch-all.
  if (key === 'output.errorBlock') {
    return call(key, { defaultValue: key })
  }

  // Catch-all for any remaining output.* key (compare-means, stat.*, etc.)
  if (key.startsWith('output.')) {
    return call(`analysis:${key}`, { defaultValue: key })
  }

  return call(key, { defaultValue: key })
}
