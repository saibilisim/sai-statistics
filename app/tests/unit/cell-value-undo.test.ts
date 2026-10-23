// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import { CellValueUndoStack, type CellEditEntry } from '../../src/views/DataView/cell-value-undo'

function entry(overrides: Partial<CellEditEntry> = {}): CellEditEntry {
  return {
    visRow: 0,
    col: 0,
    colId: 'col_1',
    prevValue: null,
    nextValue: null,
    prevFormula: null,
    nextFormula: null,
    ...overrides
  }
}

describe('CellValueUndoStack', () => {
  it('starts empty', () => {
    const stack = new CellValueUndoStack()
    expect(stack.undoLength).toBe(0)
    expect(stack.redoLength).toBe(0)
    expect(stack.popUndo()).toBeUndefined()
    expect(stack.popRedo()).toBeUndefined()
  })

  it('records a batch and pops it back on undo', () => {
    const stack = new CellValueUndoStack()
    const batch = [entry({ prevValue: 1, nextValue: 2 })]
    stack.record(batch)
    expect(stack.undoLength).toBe(1)

    const popped = stack.popUndo()
    expect(popped).toBe(batch)
    expect(stack.undoLength).toBe(0)
    expect(stack.redoLength).toBe(1)
  })

  it('never pushes an empty batch (a genuine no-op edit)', () => {
    const stack = new CellValueUndoStack()
    stack.record([])
    expect(stack.undoLength).toBe(0)
  })

  it('undo -> redo round-trips the same batch', () => {
    const stack = new CellValueUndoStack()
    const batch = [entry({ prevValue: 'a', nextValue: 'b' })]
    stack.record(batch)
    const undone = stack.popUndo()
    expect(undone).toBe(batch)
    expect(stack.redoLength).toBe(1)

    const redone = stack.popRedo()
    expect(redone).toBe(batch)
    expect(stack.undoLength).toBe(1)
    expect(stack.redoLength).toBe(0)
  })

  it('a new record() invalidates the redo stack', () => {
    const stack = new CellValueUndoStack()
    stack.record([entry({ nextValue: 1 })])
    stack.popUndo()
    expect(stack.redoLength).toBe(1)

    stack.record([entry({ nextValue: 2 })])
    expect(stack.redoLength).toBe(0)
  })

  it('undoes multiple batches in LIFO order — the exact bug this stack fixes:', () => {
    // Two separate operations (e.g. two separate column deletes at
    // different times) must undo as two separate Ctrl+Z steps, not get
    // collapsed into one.
    const stack = new CellValueUndoStack()
    const first = [entry({ col: 1, prevValue: 10, nextValue: null })]
    const second = [entry({ col: 2, prevValue: 20, nextValue: null })]
    stack.record(first)
    stack.record(second)

    expect(stack.popUndo()).toBe(second)
    expect(stack.popUndo()).toBe(first)
    expect(stack.popUndo()).toBeUndefined()
  })

  it('caps history at maxDepth, dropping the oldest batch', () => {
    const stack = new CellValueUndoStack(2)
    const batchA = [entry({ col: 1 })]
    const batchB = [entry({ col: 2 })]
    const batchC = [entry({ col: 3 })]
    stack.record(batchA)
    stack.record(batchB)
    stack.record(batchC)
    expect(stack.undoLength).toBe(2)
    // Oldest (batchA) was dropped — popping twice reaches batchB, then empty.
    expect(stack.popUndo()).toBe(batchC)
    expect(stack.popUndo()).toBe(batchB)
    expect(stack.popUndo()).toBeUndefined()
  })

  it('reset() clears both stacks', () => {
    const stack = new CellValueUndoStack()
    stack.record([entry({ nextValue: 1 })])
    stack.popUndo()
    stack.record([entry({ nextValue: 2 })])
    expect(stack.undoLength + stack.redoLength).toBeGreaterThan(0)

    stack.reset()
    expect(stack.undoLength).toBe(0)
    expect(stack.redoLength).toBe(0)
  })

  it('popRedo returns undefined and does nothing when redo is empty', () => {
    const stack = new CellValueUndoStack()
    stack.record([entry()])
    expect(stack.popRedo()).toBeUndefined()
    expect(stack.undoLength).toBe(1)
  })
})
