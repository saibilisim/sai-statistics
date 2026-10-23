// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * cell-value-undo.ts — the batched undo/redo stack for DataView's cell
 * VALUE edits (T7 follow-up). Framework-free and unit-tested, same split as
 * cell-selection.ts: this file owns just the stack bookkeeping; the
 * AG-Grid/IPC-specific wiring (writing rowsRef, persisting via
 * window.api.data.updateCells, recomputing formulas) stays a thin layer in
 * use-cell-selection.ts.
 *
 * AG Grid's own `undoRedoCellEditing` only records edits that flow through
 * its own valueSetter/setValue cycle — every bulk accelerator this app adds
 * on top (Delete-clear, Ctrl+D/R fill, Ctrl+Enter broadcast, paste) mutates
 * rowsRef directly and never touches that cycle, so none of them were ever
 * undoable there, and Ctrl+Z's old fallback (`gridApi.undoCellEditing()`)
 * silently popped whatever unrelated single-cell edit happened to be on
 * that stack instead. This is a from-scratch stack that both this hook's
 * bulk writes AND the grid's own valueSetter push onto, so Ctrl+Z always
 * undoes exactly the one operation that was last performed.
 */
import type { CellValue } from '@shared/data-types'

/** One cell's before/after state for the value-undo stack — `null` formula
 *  means "no formula on this cell". `visRow`/`col` are the VISIBLE position
 *  at record time (same positional-identity caveat as the rest of
 *  use-cell-selection.ts: a sort/filter between the edit and the undo would
 *  target the wrong cell). */
export interface CellEditEntry {
  visRow: number
  col: number
  colId: string
  prevValue: CellValue
  nextValue: CellValue
  prevFormula: string | null
  nextFormula: string | null
}

export type CellEditBatch = CellEditEntry[]

/**
 * A plain undo/redo stack of batches — each batch is one atomic user
 * action (a bulk Delete-clear, a paste, a single typed edit, …). Framework-
 * free: no React, no AG Grid, no IPC, so it's directly unit-testable.
 */
export class CellValueUndoStack {
  private undo: CellEditBatch[] = []
  private redo: CellEditBatch[] = []
  private readonly maxDepth: number

  constructor(maxDepth = 200) {
    this.maxDepth = maxDepth
  }

  /** Pushes a completed edit as one atomic undo step. A no-op edit (empty
   *  batch) never hits the stack, so Ctrl+Z can't land on a step that
   *  changed nothing. Any new edit invalidates the redo stack (standard
   *  editor convention). */
  record(batch: CellEditBatch): void {
    if (batch.length === 0) return
    this.undo.push(batch)
    if (this.undo.length > this.maxDepth) this.undo.shift()
    this.redo = []
  }

  /** Pops the most recent batch onto the redo stack and returns it (the
   *  caller applies its `prev*` side). `undefined` when there's nothing to
   *  undo. */
  popUndo(): CellEditBatch | undefined {
    const batch = this.undo.pop()
    if (batch) this.redo.push(batch)
    return batch
  }

  /** Pops the most recent redo batch back onto the undo stack and returns
   *  it (the caller applies its `next*` side). */
  popRedo(): CellEditBatch | undefined {
    const batch = this.redo.pop()
    if (batch) this.undo.push(batch)
    return batch
  }

  /** Clears both stacks — called when the mounted dataset changes, since
   *  entries key on visible-row/col position within ONE dataset's grid. */
  reset(): void {
    this.undo = []
    this.redo = []
  }

  get undoLength(): number {
    return this.undo.length
  }

  get redoLength(): number {
    return this.redo.length
  }
}
