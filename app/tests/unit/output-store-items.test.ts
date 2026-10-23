// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * output-store-items.test.ts — doc-item ordering actions added for the
 * Output navigator (drag-reorder, insert heading/text/page-break, hide/show
 * a block). These have no coverage elsewhere; output-document.test.ts covers
 * the .sdf output.json round trip, output-ai-note.test.ts covers blocks/aiNote.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AnalysisResult } from '@shared/analysis-types'
import { useOutputStore, type OutputBlock } from '../../src/store/output-store'

function makeResult(): AnalysisResult {
  return { success: true, tables: [], plots: [], warnings: [], notes: [] }
}

function makeBlock(id: string): Omit<OutputBlock, 'isCollapsed'> {
  return {
    id,
    analysisId: 'descriptives',
    titleKey: 'analysis.descriptives.title',
    timestamp: '2026-07-27T12:00:00.000Z',
    datasetName: 'demo.sdf',
    result: makeResult()
  }
}

beforeEach(() => {
  vi.stubGlobal('window', { api: { app: { setOutputDirty: vi.fn() } } })
  useOutputStore.setState({ blocks: [], items: [], edits: {}, selection: null, dirty: false })
  useOutputStore.temporal.getState().clear()
})

describe('reorderItems', () => {
  it('moves the dragged item to just before the drop target', () => {
    useOutputStore.getState().addBlock(makeBlock('b1'))
    useOutputStore.getState().addBlock(makeBlock('b2'))
    useOutputStore.getState().addBlock(makeBlock('b3'))
    // addBlock appends — the document reads top to bottom: b1, b2, b3.
    expect(useOutputStore.getState().items.map(i => i.id)).toEqual(['b1', 'b2', 'b3'])
    // blocks[] stays newest-first ("the latest result" is blocks[0]).
    expect(useOutputStore.getState().blocks.map(b => b.id)).toEqual(['b3', 'b2', 'b1'])

    useOutputStore.getState().reorderItems('b3', 'b1')
    expect(useOutputStore.getState().items.map(i => i.id)).toEqual(['b3', 'b1', 'b2'])
  })

  it('is a no-op when either id is missing or dragId === overId', () => {
    useOutputStore.getState().addBlock(makeBlock('b1'))
    useOutputStore.getState().addBlock(makeBlock('b2'))
    const before = useOutputStore.getState().items

    useOutputStore.getState().reorderItems('b1', 'b1')
    expect(useOutputStore.getState().items).toEqual(before)

    useOutputStore.getState().reorderItems('missing', 'b1')
    expect(useOutputStore.getState().items).toEqual(before)
  })
})

describe('insertItem / removeItem / updateItemText', () => {
  it('inserts a heading before a given item, or appends when beforeId is omitted', () => {
    useOutputStore.getState().addBlock(makeBlock('b1'))
    useOutputStore.getState().insertItem({ kind: 'heading', id: 'h1', text: 'Section' }, 'b1')
    expect(useOutputStore.getState().items.map(i => i.id)).toEqual(['h1', 'b1'])

    useOutputStore.getState().insertItem({ kind: 'pageBreak', id: 'pb1' })
    expect(useOutputStore.getState().items.map(i => i.id)).toEqual(['h1', 'b1', 'pb1'])
  })

  it('removeItem drops only the targeted item', () => {
    useOutputStore.getState().addBlock(makeBlock('b1'))
    useOutputStore.getState().insertItem({ kind: 'text', id: 't1', text: 'note' }, 'b1')
    useOutputStore.getState().removeItem('t1')
    expect(useOutputStore.getState().items.map(i => i.id)).toEqual(['b1'])
  })

  it('updateItemText edits heading/text items but leaves block/pageBreak items untouched', () => {
    useOutputStore.getState().addBlock(makeBlock('b1'))
    useOutputStore.getState().insertItem({ kind: 'heading', id: 'h1', text: 'Old' }, 'b1')
    useOutputStore.getState().insertItem({ kind: 'pageBreak', id: 'pb1' }, 'b1')

    useOutputStore.getState().updateItemText('h1', 'New title')
    useOutputStore.getState().updateItemText('pb1', 'ignored') // no text field on pageBreak
    useOutputStore.getState().updateItemText('b1', 'ignored') // no text field on block

    const items = useOutputStore.getState().items
    const heading = items.find(i => i.id === 'h1')
    expect(heading?.kind).toBe('heading')
    expect(heading && heading.kind === 'heading' ? heading.text : null).toBe('New title')
    expect(items.find(i => i.id === 'pb1')).toEqual({ kind: 'pageBreak', id: 'pb1' })
  })
})

describe('toggleBlockHidden', () => {
  it('toggles BlockEdits.hidden without touching other edit fields', () => {
    useOutputStore.getState().addBlock(makeBlock('b1'))
    useOutputStore.getState().setBlockTitle('b1', 'Custom title')

    useOutputStore.getState().toggleBlockHidden('b1')
    expect(useOutputStore.getState().edits['b1']).toMatchObject({
      hidden: true,
      titleOverride: 'Custom title'
    })

    useOutputStore.getState().toggleBlockHidden('b1')
    expect(useOutputStore.getState().edits['b1']?.hidden).toBe(false)
  })
})
