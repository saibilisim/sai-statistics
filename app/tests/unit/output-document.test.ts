// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * output-document.test.ts — the Output document schema (shared/output-
 * document.ts, stored in the .sdf as output.json) and its round trip through
 * buildOutputDocument()/loadOutputDocument() (src/lib/output-export.ts). Main-process file I/O (zip write/read,
 * extractZipSafely) isn't covered here — it has no Electron context in
 * Vitest — only the payload shape and the store <-> document mapping.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OutputDocumentSchema } from '@shared/output-document'
import type { AnalysisResult } from '@shared/analysis-types'
import { useOutputStore, type OutputBlock } from '../../src/store/output-store'
import { buildOutputDocument, loadOutputDocument } from '../../src/lib/output-export'

function makeResult(): AnalysisResult {
  return {
    success: true,
    tables: [
      {
        titleKey: 'output.table.descriptives',
        columns: ['output.col.statistic', 'output.col.value'],
        rows: [['Mean', 42.5]],
        footnoteKey: null
      }
    ],
    plots: [],
    warnings: [],
    notes: []
  }
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

describe('OutputDocumentSchema', () => {
  it('accepts a well-formed document', () => {
    const doc = {
      formatVersion: 1,
      savedAt: new Date().toISOString(),
      items: [{ kind: 'block', id: 'b1' }],
      blocks: [{ ...makeBlock('b1') }],
      edits: { b1: { hidden: false, tables: {} } }
    }
    const parsed = OutputDocumentSchema.safeParse(doc)
    expect(parsed.success).toBe(true)
  })

  it('rejects a formatVersion other than 1', () => {
    const doc = {
      formatVersion: 2,
      savedAt: new Date().toISOString(),
      items: [],
      blocks: [],
      edits: {}
    }
    const parsed = OutputDocumentSchema.safeParse(doc)
    expect(parsed.success).toBe(false)
  })

  it('rejects a malformed doc item (unknown kind)', () => {
    const doc = {
      formatVersion: 1,
      savedAt: new Date().toISOString(),
      items: [{ kind: 'bogus', id: 'x' }],
      blocks: [],
      edits: {}
    }
    const parsed = OutputDocumentSchema.safeParse(doc)
    expect(parsed.success).toBe(false)
  })

  it('rejects a block whose result fails AnalysisResultSchema', () => {
    const doc = {
      formatVersion: 1,
      savedAt: new Date().toISOString(),
      items: [{ kind: 'block', id: 'b1' }],
      blocks: [{ ...makeBlock('b1'), result: { success: true, tables: 'not-an-array' } }],
      edits: {}
    }
    const parsed = OutputDocumentSchema.safeParse(doc)
    expect(parsed.success).toBe(false)
  })
})

describe('buildOutputDocument / loadOutputDocument round trip', () => {
  it('builds a document snapshot of the current store', () => {
    useOutputStore.getState().addBlock(makeBlock('b1'))
    useOutputStore.getState().setTableEdits('b1', 0, { hiddenRows: [0] })

    const doc = buildOutputDocument()
    expect(doc.formatVersion).toBe(1)
    expect(doc.items).toEqual([{ kind: 'block', id: 'b1' }])
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0]?.id).toBe('b1')
    expect(doc.edits['b1']?.tables['0']?.hiddenRows).toEqual([0])
    // Round-trips through the schema itself.
    expect(OutputDocumentSchema.safeParse(doc).success).toBe(true)
  })

  it('keeps the auto header summary and syntax across save/reopen', () => {
    useOutputStore
      .getState()
      .addBlock({ ...makeBlock('b1'), summary: 'Variables: x', syntax: 'DESCRIPTIVES x.' })
    const parsed = OutputDocumentSchema.parse(buildOutputDocument())
    loadOutputDocument(parsed)
    const block = useOutputStore.getState().blocks[0]
    expect(block?.summary).toBe('Variables: x')
    expect(block?.syntax).toBe('DESCRIPTIVES x.')
  })

  it('loadOutputDocument replaces the store contents clean and clears undo history', () => {
    // Seed some pre-existing state that must be fully replaced, not merged.
    useOutputStore.getState().addBlock(makeBlock('stale'))

    loadOutputDocument({
      formatVersion: 1,
      savedAt: '2026-01-01T00:00:00.000Z',
      items: [{ kind: 'block', id: 'b1' }],
      blocks: [{ ...makeBlock('b1') }],
      edits: {
        b1: {
          hidden: false,
          tables: {
            '0': { hiddenRows: [], hiddenCols: [], transposed: true, footnotes: [] }
          }
        }
      }
    })

    const s = useOutputStore.getState()
    expect(s.blocks.map(b => b.id)).toEqual(['b1'])
    expect(s.items).toEqual([{ kind: 'block', id: 'b1' }])
    expect(s.edits['b1']?.tables['0']?.transposed).toBe(true)
    expect(s.dirty).toBe(false)
    expect(useOutputStore.temporal.getState().pastStates).toEqual([])
  })

  it('saves the top-to-bottom order and reads older (newest-first) files upside right', () => {
    useOutputStore.getState().addBlock(makeBlock('b1'))
    useOutputStore.getState().addBlock(makeBlock('b2'))
    const doc = buildOutputDocument()
    expect(doc.itemOrder).toBe('chronological')
    expect(doc.items.map(i => i.id)).toEqual(['b1', 'b2'])

    loadOutputDocument(doc)
    expect(useOutputStore.getState().items.map(i => i.id)).toEqual(['b1', 'b2'])

    // A file saved before the change: no itemOrder, newest first.
    const legacy = OutputDocumentSchema.parse({
      formatVersion: 1,
      savedAt: '2026-01-01T00:00:00.000Z',
      items: [
        { kind: 'block', id: 'b2' },
        { kind: 'heading', id: 'h', text: 'Başlık' },
        { kind: 'block', id: 'b1' }
      ],
      blocks: [makeBlock('b2'), makeBlock('b1')]
    })
    loadOutputDocument(legacy)
    expect(useOutputStore.getState().items.map(i => i.id)).toEqual(['b1', 'h', 'b2'])
  })
})

// Output is embedded in the .sdf (output.json) — `dirty` now means "not yet
// saved into the project file", so edits/removals count and exports don't.
describe('Output dirty flag (.sdf-embedded output)', () => {
  it('table/block edits and doc reordering mark Output dirty', () => {
    useOutputStore.getState().addBlock(makeBlock('b1'))
    useOutputStore.getState().markSaved()

    useOutputStore.getState().setTableEdits('b1', 0, { transposed: true })
    expect(useOutputStore.getState().dirty).toBe(true)

    useOutputStore.getState().markSaved()
    useOutputStore.getState().setBlockTitle('b1', 'Renamed')
    expect(useOutputStore.getState().dirty).toBe(true)
  })

  it('a no-op edit (unknown id) does not mark dirty', () => {
    useOutputStore.getState().addBlock(makeBlock('b1'))
    useOutputStore.getState().markSaved()
    useOutputStore.getState().reorderItems('missing', 'b1')
    expect(useOutputStore.getState().dirty).toBe(false)
  })

  it('removing a saved block marks dirty (the .sdf still holds it)', () => {
    useOutputStore.getState().addBlock(makeBlock('b1'))
    useOutputStore.getState().markSaved()
    useOutputStore.getState().removeBlock('b1')
    expect(useOutputStore.getState().dirty).toBe(true)
  })

  it('clearing an already-empty Output is not a change', () => {
    useOutputStore.getState().clearAll()
    expect(useOutputStore.getState().dirty).toBe(false)
  })

  it('loadOutputDocument from a .sdf replaces the tab clean; null empties it', () => {
    useOutputStore.getState().addBlock(makeBlock('stale'))
    useOutputStore.getState().addBlock(makeBlock('b1'))
    const doc = buildOutputDocument()

    loadOutputDocument(doc)
    expect(useOutputStore.getState().blocks.map(b => b.id)).toEqual(['b1', 'stale'])
    expect(useOutputStore.getState().dirty).toBe(false)

    loadOutputDocument(null)
    expect(useOutputStore.getState().blocks).toEqual([])
    expect(useOutputStore.getState().items).toEqual([])
    expect(useOutputStore.getState().dirty).toBe(false)
  })
})
