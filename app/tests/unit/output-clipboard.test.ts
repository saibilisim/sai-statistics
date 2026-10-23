// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * output-clipboard.test.ts — regression for a real clipboard bug: copying a
 * "test" from the Output navigator (right-click ▸ Copy on the block, or a
 * multi-select) that produces 2+ tables (e.g. Mann-Whitney's Ranks + Test
 * Statistics) used to emit several sibling `<table>` elements in the HTML
 * clipboard flavor. Excel/Sheets/LibreOffice Calc only import the FIRST
 * `<table>` tag from pasted HTML — every table after it, headers included,
 * silently vanished on paste. The fix combines everything into ONE <table>
 * (colspan-spanning rows for titles/headings between each table's own real
 * header row) so every header survives the paste.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TFunction } from 'i18next'
import type { OutputTable } from '@shared/analysis-types'
import { copyMultipleSelectedItems } from '../../src/lib/output-clipboard'

const t = ((key: string, opts?: Record<string, unknown>) => {
  if (opts && typeof opts === 'object' && 'defaultValue' in opts) {
    return (opts as { defaultValue?: string }).defaultValue ?? key
  }
  return key
}) as unknown as TFunction

function translateOutputKey(key: string): string {
  return key
}

// navigator.clipboard.write / ClipboardItem / Blob don't exist in vitest's
// node environment — stub the minimum surface writeDualFlavor() touches, and
// capture what actually got written for the assertions below.
let written: { html: string; tsv: string } | null = null

beforeEach(() => {
  written = null
  vi.stubGlobal(
    'Blob',
    class {
      constructor(
        public parts: string[],
        public opts: { type: string }
      ) {}
      async text() {
        return this.parts.join('')
      }
    }
  )
  vi.stubGlobal(
    'ClipboardItem',
    class {
      constructor(public items: Record<string, InstanceType<typeof Blob>>) {}
    }
  )
  vi.stubGlobal('navigator', {
    clipboard: {
      write: vi.fn(async (items: InstanceType<typeof ClipboardItem>[]) => {
        const item = items[0]
        written = {
          html: (item.items['text/html'] as unknown as { parts: string[] }).parts.join(''),
          tsv: (item.items['text/plain'] as unknown as { parts: string[] }).parts.join('')
        }
      })
    }
  })
})

function twoTableBlock(id: string) {
  const ranks: OutputTable = {
    titleKey: 'output.npar.ranksTitle',
    columns: ['output.col.variable', 'output.col.n', 'output.col.meanRank'],
    rows: [['score', 15, 12.3]],
    footnoteKey: null
  }
  const stats: OutputTable = {
    titleKey: 'output.npar.testStatsTitle',
    columns: ['output.col.mannWhitneyU', 'output.col.z', 'output.col.asympSig'],
    rows: [[42, -1.9, 0.05]],
    footnoteKey: null
  }
  return { id, titleKey: 'analysis.nparMW.title', result: { tables: [ranks, stats] } }
}

describe('copyMultipleSelectedItems — combined single-<table> HTML', () => {
  it('emits exactly ONE <table> for a block with 2 tables, with BOTH header rows present', async () => {
    const block = twoTableBlock('block-1')
    await copyMultipleSelectedItems(['block-1'], [block], [], {}, t, translateOutputKey)

    expect(written).not.toBeNull()
    const html = written!.html
    // Exactly one <table ...> opening tag — not two sibling tables (the bug).
    expect((html.match(/<table[ >]/g) ?? []).length).toBe(1)
    // Both tables' own header cells are present in that one table.
    expect(html).toContain('<th>variable</th>')
    expect(html).toContain('<th>mannWhitneyU</th>')
    // Both tables' data made it in too.
    expect(html).toContain('score')
    expect(html).toContain('42')
  })

  it('still keeps both tables fully present in the TSV flavor', async () => {
    const block = twoTableBlock('block-2')
    await copyMultipleSelectedItems(['block-2'], [block], [], {}, t, translateOutputKey)

    const tsv = written!.tsv
    expect(tsv).toContain('variable\tn\tmeanRank')
    expect(tsv).toContain('mannWhitneyU\tz\tasympSig')
    expect(tsv).toContain('score')
  })

  it('single-table selection also stays a single <table> (no regression)', async () => {
    const table: OutputTable = {
      titleKey: 'output.table.descriptives',
      columns: ['output.col.statistic', 'output.col.value'],
      rows: [['Mean', 42.5]],
      footnoteKey: null
    }
    const block = { id: 'block-3', titleKey: 'x', result: { tables: [table] } }
    await copyMultipleSelectedItems(['block-3'], [block], [], {}, t, translateOutputKey)
    expect((written!.html.match(/<table[ >]/g) ?? []).length).toBe(1)
    expect(written!.html).toContain('<th>statistic</th>')
  })

  it('combines two different multi-table blocks (multi-select) into one <table> too', async () => {
    const b1 = twoTableBlock('block-a')
    const b2 = twoTableBlock('block-b')
    await copyMultipleSelectedItems(['block-a', 'block-b'], [b1, b2], [], {}, t, translateOutputKey)
    expect((written!.html.match(/<table[ >]/g) ?? []).length).toBe(1)
    // 4 header rows total (2 tables per block x 2 blocks) all present.
    expect((written!.html.match(/<th>variable<\/th>/g) ?? []).length).toBe(2)
    expect((written!.html.match(/<th>mannWhitneyU<\/th>/g) ?? []).length).toBe(2)
  })
})
