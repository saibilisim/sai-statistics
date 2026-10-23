// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod'

// Shared data model types — used by both Main and Renderer

export const VariableTypeSchema = z.enum(['numeric', 'string', 'date'])
export type VariableType = z.infer<typeof VariableTypeSchema>

export const MeasureLevelSchema = z.enum(['scale', 'ordinal', 'nominal'])
export type MeasureLevel = z.infer<typeof MeasureLevelSchema>

export const VariableRoleSchema = z.enum(['input', 'target', 'both', 'none', 'partition', 'split'])
export type VariableRole = z.infer<typeof VariableRoleSchema>

export const AlignTypeSchema = z.enum(['left', 'center', 'right'])
export type AlignType = z.infer<typeof AlignTypeSchema>

export const MissingValuesSchema = z.object({
  type: z.enum(['discrete', 'range', 'range+discrete']),
  discrete: z.array(z.union([z.string(), z.number()])).optional(),
  rangeLow: z.number().optional(),
  rangeHigh: z.number().optional()
})
export type MissingValues = z.infer<typeof MissingValuesSchema>

/** Bounds of a variable's numeric display attributes. `width` goes up to
 *  SPSS's own string limit (A32767) — imported .sav long-text fields carry
 *  it, and a tighter cap made such a dataset save fine but fail to reopen. */
export const VARIABLE_LIMITS = {
  width: { min: 1, max: 32767 },
  decimals: { min: 0, max: 20 },
  columns: { min: 1, max: 255 }
} as const

/** Rounds and clamps `value` into a VARIABLE_LIMITS range (import paths). */
export function clampVariableAttr(attr: keyof typeof VARIABLE_LIMITS, value: number): number {
  const { min, max } = VARIABLE_LIMITS[attr]
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min
}

export const VariableSchema = z.object({
  colId: z.string().regex(/^col_\d+$/),
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  type: VariableTypeSchema,
  width: z.number().int().min(VARIABLE_LIMITS.width.min).max(VARIABLE_LIMITS.width.max),
  decimals: z.number().int().min(VARIABLE_LIMITS.decimals.min).max(VARIABLE_LIMITS.decimals.max),
  label: z.string(),
  valueLabels: z.record(z.string(), z.string()),
  missing: MissingValuesSchema.nullable(),
  columns: z.number().int().min(VARIABLE_LIMITS.columns.min).max(VARIABLE_LIMITS.columns.max),
  align: AlignTypeSchema,
  measure: MeasureLevelSchema,
  role: VariableRoleSchema,
  numfmtPattern: z.string().optional()
})
export type Variable = z.infer<typeof VariableSchema>

// ─────────────────────────────────────────────────────────────
//  Custom styles — per-cell format overrides (font/bold/italic/underline/
//  colors/alignment) persisted alongside a dataset (in .sdf → styles.json).
//  Cells are keyed by their stable row id (`r{dbRowIndex}`, matching
//  DataView's `getRowId`/`toDbRow`) so formatting survives sort/filter.
//  Kept structurally typed (no `any`) so it can cross the IPC/zod boundary.
//
//  Replaces the pre-AG-Grid shape (`styles` id table + per-sheet/{s,f,custom}
//  cells) that mirrored the previous grid engine's own workbook snapshot —
//  that shape was never read by anything after the AG Grid migration
//  (aggrid-gecis-roadmap.md), only passed through unread. Old `.sdf` files
//  saved under the previous grid engine simply won't match these field
//  names on load, which is harmless: `.loose()` still parses them, they
//  just carry no cell formatting (which wasn't rendering under AG Grid
//  anyway).
// ─────────────────────────────────────────────────────────────

export const CellFormatSchema = z
  .object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    fontFamily: z.string().optional(),
    fontSize: z.number().positive().optional(),
    /** Text color, CSS hex string */
    color: z.string().optional(),
    /** Fill/background color, CSS hex string */
    bg: z.string().optional(),
    hAlign: z.enum(['left', 'center', 'right']).optional(),
    /** Display-only number format override (P1.7,
     *  spreadsheet-ozellikleri-envanteri.md §3) — does NOT change the
     *  underlying stored value, only how it's rendered. `'general'` (or
     *  unset) defers to the variable's own Decimals/Width display rule. */
    numberFormat: z.enum(['general', 'number', 'currency', 'percent', 'scientific']).optional(),
    /** Which currency to render when numberFormat is 'currency' — a flat
     *  symbol menu (Ribbon), not a free-text code, so this is a closed set.
     *  Ignored (falls back to 'TRY') when numberFormat isn't 'currency'. */
    currency: z.enum(['TRY', 'USD', 'EUR', 'GBP', 'JPY']).optional(),
    /** Cell formula (Excel-style "=A7+B7"), stored ONLY here in the local
     *  .sdf — never in DuckDB, which keeps the evaluated value so R/analyses
     *  read a plain number. Presence of this field marks the cell as computed;
     *  the recompute-all pass (DataView) re-evaluates it on any edit. */
    formula: z.string().optional()
  })
  .loose()
export type CellFormat = z.infer<typeof CellFormatSchema>

export const CustomStylesSchema = z
  .object({
    /** Per stable-row-id → per-colId cell format overrides. */
    cells: z.record(z.string(), z.record(z.string(), CellFormatSchema)).optional()
  })
  .loose()
export type CustomStyles = z.infer<typeof CustomStylesSchema>

export const DatasetSchema = z.object({
  id: z.string(),
  name: z.string(),
  filePath: z.string().nullable(),
  variables: z.array(VariableSchema),
  rowCount: z.number().int().nonnegative(),
  nextColSeq: z.number().int().positive(),
  /** Next value for the hidden `__case_id` column — the row counterpart of
   *  `nextColSeq`. Case ids are assigned once (at import) and NEVER renumbered
   *  by insert/delete/reorder/sort, so per-cell metadata (formats, formulas in
   *  `customStyles`) can key on a row's permanent identity instead of its
   *  shifting `__row_idx`. Optional so a Dataset restored from an older
   *  snapshot/schema still parses (falls back to rowCount). */
  nextCaseSeq: z.number().int().nonnegative().optional(),
  isModified: z.boolean(),
  customStyles: CustomStylesSchema.optional()
})
export type Dataset = z.infer<typeof DatasetSchema>

export type CellValue = string | number | boolean | null
