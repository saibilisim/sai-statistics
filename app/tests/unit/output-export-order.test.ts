// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * output-export-order.test.ts — the HTML/PDF export prints the document in the
 * same top-to-bottom order the Output view shows (2026-10-18). It used to
 * reverse `items`, so inserted headings and drag-reordering came out upside
 * down in the exported file.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TFunction } from 'i18next'
import type { AnalysisResult } from '@shared/analysis-types'
import { useOutputStore } from '../../src/store/output-store'
import { buildOutputHtml } from '../../src/lib/output-export'

const t = ((key: string) => key) as unknown as TFunction

function result(title: string): AnalysisResult {
  return {
    success: true,
    tables: [{ titleKey: title, columns: ['A'], rows: [[1]], footnoteKey: null }],
    plots: [],
    caseVars: [],
    warnings: [],
    notes: []
  }
}

function addBlock(id: string): void {
  useOutputStore.getState().addBlock({
    id,
    analysisId: 'descriptives',
    titleKey: `Title ${id}`,
    timestamp: '2026-10-18T10:00:00.000Z',
    datasetName: 'demo',
    result: result(`Table ${id}`)
  })
}

beforeEach(() => {
  vi.stubGlobal('window', { api: { app: { setOutputDirty: vi.fn() } } })
  useOutputStore.setState({ blocks: [], items: [], edits: {}, selection: null, dirty: false })
})

describe('buildOutputHtml order', () => {
  it('follows the document order: oldest first, inserted items where they are', async () => {
    addBlock('first')
    useOutputStore.getState().insertItem({ kind: 'heading', id: 'h', text: 'Section two' })
    addBlock('second')
    const html = await buildOutputHtml(useOutputStore.getState().blocks, t)
    const a = html.indexOf('Table first')
    const h = html.indexOf('Section two')
    const b = html.indexOf('Table second')
    expect(a).toBeGreaterThan(-1)
    expect(a).toBeLessThan(h)
    expect(h).toBeLessThan(b)
  })

  it('keeps a drag-reordered document as arranged', async () => {
    addBlock('first')
    addBlock('second')
    useOutputStore.getState().reorderItems('second', 'first')
    const html = await buildOutputHtml(useOutputStore.getState().blocks, t)
    expect(html.indexOf('Table second')).toBeLessThan(html.indexOf('Table first'))
  })
})
