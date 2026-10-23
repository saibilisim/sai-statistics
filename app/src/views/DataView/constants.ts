// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * constants.ts — Shared constants for the DataView module.
 *
 * Trimmed by the AG Grid migration (aggrid-gecis-roadmap.md G7): the old
 * grid's gutter/row-height pixel constants, structural command-ID
 * allowlist, hidden-menu-item map, and canvas header-style reader all went
 * with use-structural-commands.ts/use-spreadsheet-effects.ts. Only the
 * column template (still needed by use-structural-ops.ts's insertColumn)
 * survives.
 */

/** Row number column ID for DataView */
export const ROW_NUM_COL_ID = '__row_num__'

/** Template for a freshly inserted numeric column (colId is assigned by backend). */
export const NEW_COLUMN_TEMPLATE = {
  colId: '',
  type: 'numeric' as const,
  width: 8,
  decimals: 2,
  label: '',
  missing: null,
  valueLabels: {},
  columns: 8,
  align: 'right' as const,
  measure: 'scale' as const,
  role: 'none' as const,
  numfmtPattern: '0.00'
}

/** Template for a column auto-created to fit a paste that overflows the
 *  grid to the right. Deliberately `string`, not `NEW_COLUMN_TEMPLATE`'s
 *  `numeric` default — a numeric column would reject the very text it was
 *  just created to hold (the same rejection this paste-growth feature
 *  exists to stop the user from hitting). Matches the string-column shape
 *  file-handler.ts's CSV import already uses for non-numeric columns. */
export const NEW_PASTE_COLUMN_TEMPLATE = {
  colId: '',
  type: 'string' as const,
  width: 20,
  decimals: 0,
  label: '',
  missing: null,
  valueLabels: {},
  columns: 8,
  align: 'left' as const,
  measure: 'nominal' as const,
  role: 'none' as const
}
