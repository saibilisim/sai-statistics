// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * output-resolve.test.ts — resolveTable() is the single source of truth for
 * turning an OutputTable + edits into display-ready rows (replaces the
 * previously-duplicated formatCell/buildTsv in OutputView.tsx and
 * renderTableHtml in output-export.ts). Covers: parity with the pre-refactor
 * output (no-edits case must be byte-identical), and each edit kind in
 * isolation (hidden rows/cols, transpose, per-table decimals, footnotes).
 * Deliberately no cell-level override/formatting — that surface was removed
 * (output-document.ts's doc comment has the reasoning): editing an
 * individual statistic's displayed text in a stats tool is a correctness
 * hazard, and it made table selection fight with native text selection.
 */

import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import type { OutputTable } from '@shared/analysis-types'
import type { TableEdits } from '@shared/output-document'
import {
  resolveTable,
  resolvedTableToTsv,
  resolvedTableToHtml,
  resolvedTableToCsv,
  resolvedTableToMarkdown
} from '../../src/lib/output-resolve'

// Identity translator with the same defaultValue-passthrough behavior real
// i18next has for missing keys — good enough since translateOutputKey's own
// resolution logic is tested elsewhere (output-format.ts is unmodified).
const t = ((key: string, opts?: Record<string, unknown>) => {
  if (opts && typeof opts === 'object' && 'defaultValue' in opts) {
    return (opts as { defaultValue?: string }).defaultValue ?? key
  }
  return key
}) as unknown as TFunction

function makeTable(overrides: Partial<OutputTable> = {}): OutputTable {
  return {
    titleKey: 'output.table.descriptives',
    columns: ['output.col.statistic', 'output.col.value', 'output.col.sig'],
    rows: [
      ['Mean', 42.5, 0.031],
      ['SD', 3.2, 0.0004],
      ['N', 10, null]
    ],
    footnoteKey: null,
    ...overrides
  }
}

describe('resolveTable — no edits (parity)', () => {
  it('resolves columns/rows/title with translated keys and formatted numbers', () => {
    const table = makeTable()
    const resolved = resolveTable(table, t)

    expect(resolved.title).toBe('output.table.descriptives')
    // output.col.* keys route through translateOutputKey's col-specific branch,
    // which strips the prefix (defaultValue: subKey) — "statistic"/"value"/"sig".
    expect(resolved.columns).toEqual(['statistic', 'value', 'sig'])
    expect(resolved.rows).toHaveLength(3)

    // Text cell
    expect(resolved.rows[0]?.[0]).toMatchObject({ text: 'Mean', align: 'txt' })
    // Plain numeric cell (not a sig column) — general number formatting
    expect(resolved.rows[0]?.[1]).toMatchObject({ text: '42.5', align: 'num' })
    // Sig column: p=0.031 → ".031", sig tier
    expect(resolved.rows[0]?.[2]).toMatchObject({ text: '.031', align: 'num', sigLevel: 'sig' })
    // p=0.0004 → below 0.001 threshold → "<.001", vsig tier
    expect(resolved.rows[1]?.[2]).toMatchObject({ text: '<.001', sigLevel: 'vsig' })
    // null → missing marker
    expect(resolved.rows[2]?.[2]).toMatchObject({ text: '.', align: 'num' })
  })

  it('produces the same TSV shape the old buildTsv() produced', () => {
    const table = makeTable()
    const resolved = resolveTable(table, t)
    const tsv = resolvedTableToTsv(resolved)
    expect(tsv).toBe(
      ['statistic\tvalue\tsig', 'Mean\t42.5\t.031', 'SD\t3.2\t<.001', 'N\t10\t.'].join('\n')
    )
  })

  it('includes the footnote as a trailing TSV line when present', () => {
    const table = makeTable({ footnoteKey: 'output.footnote.example' })
    const resolved = resolveTable(table, t)
    const tsv = resolvedTableToTsv(resolved)
    expect(tsv.endsWith('output.footnote.example')).toBe(true)
  })

  it('emits real <table> HTML with header/body cells', () => {
    const table = makeTable()
    const resolved = resolveTable(table, t)
    const html = resolvedTableToHtml(resolved)
    expect(html).toContain('<table')
    expect(html).toContain('<th>statistic</th>')
    expect(html).toContain('<td style="text-align:left">Mean</td>')
    expect(html).toContain('<td style="text-align:right">.031</td>')
  })

  it('emits RFC 4180 CSV, quoting cells that contain a comma', () => {
    const table = makeTable({ rows: [['Mean, adjusted', 42.5, 0.031]] })
    const resolved = resolveTable(table, t)
    const csv = resolvedTableToCsv(resolved)
    expect(csv.split('\r\n')[0]).toBe('statistic,value,sig')
    expect(csv.split('\r\n')[1]).toBe('"Mean, adjusted",42.5,.031')
  })

  it('doubles embedded quotes in CSV cells', () => {
    const table = makeTable({ rows: [['6" screen', 1, null]] })
    const resolved = resolveTable(table, t)
    const csv = resolvedTableToCsv(resolved)
    expect(csv.split('\r\n')[1]).toBe('"6"" screen",1,.')
  })

  it('emits a GitHub-flavored Markdown pipe table with an escaped pipe cell', () => {
    const table = makeTable({ rows: [['A | B', 1, null]] })
    const resolved = resolveTable(table, t)
    const md = resolvedTableToMarkdown(resolved)
    const lines = md.split('\n')
    expect(lines).toContain('| statistic | value | sig |')
    expect(lines).toContain('| --- | --- | --- |')
    expect(lines).toContain('| A \\| B | 1 | . |')
  })
})

describe('resolveTable — edits', () => {
  const edits = (partial: Partial<TableEdits>): TableEdits => ({
    hiddenRows: [],
    hiddenCols: [],
    transposed: false,
    footnotes: [],
    ...partial
  })

  it('hides rows by original index', () => {
    const resolved = resolveTable(makeTable(), t, edits({ hiddenRows: [1] }))
    expect(resolved.rows).toHaveLength(2)
    expect(resolved.rows[0]?.[0]?.text).toBe('Mean')
    expect(resolved.rows[1]?.[0]?.text).toBe('N')
  })

  it('hides columns by original index', () => {
    const resolved = resolveTable(makeTable(), t, edits({ hiddenCols: [2] }))
    expect(resolved.columns).toEqual(['statistic', 'value'])
    expect(resolved.rows[0]).toHaveLength(2)
  })

  it('overrides the title', () => {
    const resolved = resolveTable(makeTable(), t, edits({ titleOverride: 'My Custom Title' }))
    expect(resolved.title).toBe('My Custom Title')
  })

  it('appends user footnotes after the original footnote', () => {
    const resolved = resolveTable(
      makeTable({ footnoteKey: 'output.footnote.example' }),
      t,
      edits({ footnotes: ['Custom note'] })
    )
    expect(resolved.footnotes).toEqual(['output.footnote.example', 'Custom note'])
  })

  it('transposes rows/columns, labeling the header row with the first column and body rows with original column headers', () => {
    const resolved = resolveTable(makeTable(), t, edits({ transposed: true }))
    // New header: '' + row labels (Mean, SD, N)
    expect(resolved.columns).toEqual(['', 'Mean', 'SD', 'N'])
    // Two body rows: value, sig (label column itself is not repeated as a body row)
    expect(resolved.rows).toHaveLength(2)
    expect(resolved.rows[0]?.[0]?.text).toBe('value')
    expect(resolved.rows[0]?.map(c => c.text)).toEqual(['value', '42.5', '3.2', '10'])
    expect(resolved.rows[1]?.map(c => c.text)).toEqual(['sig', '.031', '<.001', '.'])
  })

  it('every data cell carries its ORIGINAL row/col, unaffected by hiding or transposing — this is what edits must key on, not on-screen position', () => {
    // Plain layout: origRow/origCol match on-screen position 1:1.
    const plain = resolveTable(makeTable(), t)
    expect(plain.rows[1]?.[2]).toMatchObject({ origRow: 1, origCol: 2 }) // SD row, sig col

    // Hide the first row — the on-screen row 0 is now original row 1, but its
    // cells must still report origRow: 1 (a naive index-based key would say 0).
    const hidden = resolveTable(makeTable(), t, edits({ hiddenRows: [0] }))
    expect(hidden.rows[0]?.[0]).toMatchObject({ text: 'SD', origRow: 1, origCol: 0 })

    // Transposed: on-screen row 0 is the original "value" column (origCol 1);
    // each cell in it comes from a different original row.
    const transposed = resolveTable(makeTable(), t, edits({ transposed: true }))
    expect(transposed.rows[0]?.[1]).toMatchObject({ text: '42.5', origRow: 0, origCol: 1 })
    expect(transposed.rows[0]?.[2]).toMatchObject({ text: '3.2', origRow: 1, origCol: 1 })
  })

  it('overrides the decimal precision for the whole table', () => {
    const resolved = resolveTable(makeTable(), t, edits({ decimals: 1 }))
    expect(resolved.rows[0]?.[1]?.text).toBe('42.5')
    expect(resolved.rows[0]?.[2]?.text).toBe('<.1') // p=0.031 rounds below the 1-decimal threshold
    expect(resolved.rows[1]?.[1]?.text).toBe('3.2')
  })
})
