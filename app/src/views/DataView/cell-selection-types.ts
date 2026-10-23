// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * cell-selection-types.ts — shared types for DataView's cell-selection hook
 * (use-cell-selection.ts) and the framework-free helper modules it was split
 * into (fill-handle.ts, internal-clipboard.ts, cell-keyboard-nav.ts). Pure
 * type declarations — no runtime code.
 */
import type { TFunction } from 'i18next'
import type { GridApi } from 'ag-grid-community'
import type { CellValue, Variable } from '@shared/data-types'
import type { CaseIdentity } from './case-identity'

/** Formula hooks passed from DataView (useFormulas) so fill/paste can keep
 *  cell formulas consistent. Optional — the grid still works without it. */
export interface FormulaOps {
  getCellFormula: (dbRow: number, colId: string) => string | undefined
  setCellFormula: (dbRow: number, colId: string, formula: string | null) => void
  applyFormulaToCell: (dbRow: number, colIndex: number, formula: string) => CellValue
  /** Fill-shifts a stored (db-form) formula by a visible-row/col delta. */
  shiftFormulaForFill: (srcFormula: string, dVisRow: number, dCol: number) => string
  recomputeFormulas: () => void
}

export interface UseCellSelectionParams {
  gridApiRef: React.RefObject<GridApi<CellValue[]> | null>
  /** Currently displayed rows (post filter/sort) — selection coordinates are
   *  visible-row positions, so copy/paste read/write through this, not
   *  allRowsRef (DB order). */
  rowsRef: React.RefObject<CellValue[][]>
  visibleToOriginalIndexRef: React.RefObject<number[]>
  /** dbRow ↔ permanent case id — per-cell formats/formulas key on the case id
   *  so a later row insert/delete/reorder can't move them (case-identity.ts). */
  caseIdentity: CaseIdentity
  variables: Variable[]
  showValueLabels: boolean
  isChunkLoadingRef: React.RefObject<boolean>
  warnCell: (message: string) => void
  t: TFunction
  formulaOps?: FormulaOps
}

/** A normalized range rectangle (both ends inclusive) — the return shape of
 *  cell-selection.ts's normalizeRange, shared by the helper modules. */
export interface RangeRect {
  top: number
  bottom: number
  left: number
  right: number
}

/** The range last copied (isCut=false) or cut (isCut=true), shown with a
 *  dashed marching-ants frame (B4). A cut clears its source cells once
 *  pasted. Cleared on Esc, on paste (cut), or when a new copy/cut is made. */
export interface CopiedMark {
  rect: RangeRect
  isCut: boolean
}

/** Selection mode (F8 / Shift+F8, B1):
 *  'normal' — plain click replaces the selection (default).
 *  'extend' — F8 "Extend Selection": a plain click extends the last range
 *             (like holding Shift), persists until F8/Escape.
 *  'add'    — Shift+F8 "Add to Selection": a plain click adds a new
 *             discontiguous range (like holding Ctrl), persists until
 *             Shift+F8/Escape. */
export type SelectionMode = 'normal' | 'extend' | 'add'
