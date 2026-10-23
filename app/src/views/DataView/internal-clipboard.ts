// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * internal-clipboard.ts — the internal (in-app) clipboard snapshot behind
 * DataView's copy/cut (B4), extracted from use-cell-selection.ts. The OS
 * clipboard only carries TSV text, so "paste format" / "paste formula" would
 * be impossible without this snapshot: it captures each copied cell's visual
 * format and (stable, db-form) formula alongside its value. Plain value
 * pastes still read the OS clipboard, so pasting from other apps keeps
 * working. Framework-free apart from the CaseIdentity translator it is
 * handed — unit-testable like cell-selection.ts.
 */
import type { CellFormat, Variable } from '@shared/data-types'
import { toDbRow } from '../../lib/data-grid'
import type { CaseIdentity } from './case-identity'
import type { RangeRect } from './cell-selection-types'

export interface InternalClip {
  rows: number
  cols: number
  /** [r][c] relative to the copied rect's top-left. */
  cells: { format?: CellFormat; formula?: string }[][]
  /** The exact TSV this snapshot was written to the OS clipboard with.
   *  Paste compares it against what it actually reads back: if they differ,
   *  the user copied something else in between (Excel, a browser, …) and
   *  this snapshot's formats must NOT be applied to those foreign values —
   *  the stale-clipboard bug in denetim raporu §4.1. There is no event that
   *  tells us the OS clipboard changed, so comparison is the only reliable
   *  test. */
  tsv: string
}

/** Snapshots the formats + formulas of the copied block for paste-special —
 *  the `cells` payload of an InternalClip. `variables` must be the store's
 *  CURRENT variable list (not a render-time capture), `styleCells` the
 *  current customStyles.cells map. */
export function snapshotCopiedCells(
  rect: RangeRect,
  variables: Variable[],
  styleCells: Record<string, Record<string, CellFormat>> | undefined,
  caseIdentity: CaseIdentity,
  visibleToOriginalIndex: number[]
): { format?: CellFormat; formula?: string }[][] {
  const cells: { format?: CellFormat; formula?: string }[][] = []
  for (let r = rect.top; r <= rect.bottom; r++) {
    const dbRow = toDbRow(r, visibleToOriginalIndex)
    const rowCells: { format?: CellFormat; formula?: string }[] = []
    for (let c = rect.left; c <= rect.right; c++) {
      const variable = variables[c]
      const fmt = variable ? styleCells?.[caseIdentity.keyOfDb(dbRow)]?.[variable.colId] : undefined
      if (fmt) {
        const { formula, ...visual } = fmt
        rowCells.push({
          format: Object.keys(visual).length > 0 ? visual : undefined,
          formula
        })
      } else {
        rowCells.push({})
      }
    }
    cells.push(rowCells)
  }
  return cells
}

/** The shape both clipboard style sources share: the internal snapshot
 *  (InternalClip — a SAI→SAI copy, which also carries formulas) and the
 *  parsed text/html grid Excel/Sheets/LibreOffice place on the OS clipboard
 *  (per-cell inline style — color/font only, no formulas). Either source
 *  feeds the exact same merge in transferClipboardStyles. */
export interface ClipboardStyleSource {
  rows: number
  cols: number
  cells: { format?: CellFormat; formula?: string }[][]
}

/**
 * Transfers cell formatting from a clipboard style source onto the pasted
 * block: each pasted cell's visual format is replaced by the source's
 * (tiled — the source block repeats when the paste is larger than the copy),
 * while any formula already stored on the target cell is kept. Mutates
 * `styleCells` (the caller's working copy of customStyles.cells) in place;
 * returns whether anything changed.
 */
export function transferClipboardStyles(
  styleSource: ClipboardStyleSource,
  grid: string[][],
  focusedRow: number,
  focusedCol: number,
  rowCount: number,
  variables: Variable[],
  visibleToOriginalIndex: number[],
  caseIdentity: CaseIdentity,
  styleCells: Record<string, Record<string, CellFormat>>
): boolean {
  let stylesChanged = false
  for (let r = 0; r < grid.length; r++) {
    const targetRow = focusedRow + r
    if (targetRow >= rowCount) break
    const dbRow = toDbRow(targetRow, visibleToOriginalIndex)
    const rowId = caseIdentity.keyOfDb(dbRow)
    const rowCells: Record<string, CellFormat> = { ...(styleCells[rowId] ?? {}) }
    const gridRow = grid[r]
    if (!gridRow) continue

    for (let c = 0; c < gridRow.length; c++) {
      const targetCol = focusedCol + c
      const variable = variables[targetCol]
      if (!variable) continue

      const clipR = r % styleSource.rows
      const clipC = c % styleSource.cols
      const srcCell = styleSource.cells[clipR]?.[clipC]
      const srcFormat = srcCell?.format

      const existingCellFormat = rowCells[variable.colId] ?? {}
      const { formula: existingFormula } = existingCellFormat

      if (srcFormat && Object.keys(srcFormat).length > 0) {
        rowCells[variable.colId] = {
          ...srcFormat,
          ...(existingFormula ? { formula: existingFormula } : {})
        }
        stylesChanged = true
      } else if (Object.keys(existingCellFormat).length > 0) {
        if (existingFormula) {
          rowCells[variable.colId] = { formula: existingFormula }
        } else {
          Reflect.deleteProperty(rowCells, variable.colId)
        }
        stylesChanged = true
      }
    }

    if (Object.keys(rowCells).length > 0) {
      styleCells[rowId] = rowCells
    } else {
      Reflect.deleteProperty(styleCells, rowId)
    }
  }
  return stylesChanged
}
