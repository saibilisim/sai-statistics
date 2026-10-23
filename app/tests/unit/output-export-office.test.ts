// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * output-export-office.test.ts — the native Word/Excel exports (2026-10-21).
 * They replaced HTML saved as .doc/.xls, which Excel flagged as a format/
 * extension mismatch, Word showed without plots, and which turned every
 * number into text.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TFunction } from 'i18next'
import JSZip from 'jszip'
import type { AnalysisResult, OutputPlot } from '@shared/analysis-types'
import { useOutputStore } from '../../src/store/output-store'
import {
  buildOutputDocx,
  buildOutputXlsx,
  collectExportParts,
  excelNumberFormat,
  uniqueSheetName
} from '../../src/lib/output-export-office'
import type { PlotImage } from '../../src/lib/output-export'

const t = ((key: string) => key) as unknown as TFunction

// 1×1 transparent PNG.
const PNG_1PX = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  c => c.charCodeAt(0)
)
const fakeRasterize = (): Promise<PlotImage> =>
  Promise.resolve({ png: PNG_1PX, width: 800, height: 500 })

function result(title: string, plots: OutputPlot[] = []): AnalysisResult {
  return {
    success: true,
    tables: [
      {
        titleKey: title,
        columns: ['Variable', 'Mean', 'output.col.sig'],
        rows: [
          ['age', 34.25, 0.0123],
          ['score', 12, 0.00001]
        ],
        footnoteKey: null
      }
    ],
    plots,
    caseVars: [],
    warnings: [],
    notes: []
  }
}

function addBlock(id: string, plots: OutputPlot[] = []): void {
  useOutputStore.getState().addBlock({
    id,
    analysisId: 'descriptives',
    titleKey: `Block ${id}`,
    timestamp: '2026-10-21T10:00:00.000Z',
    datasetName: 'demo',
    result: result(`Table ${id}`, plots)
  })
}

async function unzip(bytes: Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(bytes)
}

async function parts(includeDocItems = true) {
  return collectExportParts(useOutputStore.getState().blocks, t, {}, includeDocItems, fakeRasterize)
}

beforeEach(() => {
  vi.stubGlobal('window', { api: { app: { setOutputDirty: vi.fn() } } })
  useOutputStore.setState({ blocks: [], items: [], edits: {}, selection: null, dirty: false })
})

describe('excelNumberFormat', () => {
  it('keeps the decimals the Output view shows', () => {
    expect(excelNumberFormat('34.25')).toBe('0.00')
    expect(excelNumberFormat('34,25')).toBe('0.00')
    expect(excelNumberFormat('12')).toBe('0')
    expect(excelNumberFormat('-1.5')).toBe('0.0')
  })
  it('keeps a dropped leading zero (p-values)', () => {
    expect(excelNumberFormat('.012')).toBe('#.000')
  })
  it('leaves non-plain numbers as text', () => {
    expect(excelNumberFormat('<.001')).toBeNull()
    expect(excelNumberFormat('1e+21')).toBeNull()
    expect(excelNumberFormat('Infinity')).toBeNull()
    expect(excelNumberFormat('')).toBeNull()
  })
})

describe('uniqueSheetName', () => {
  it('strips forbidden characters, caps at 31 and de-duplicates ignoring case', () => {
    const used = new Set<string>()
    expect(uniqueSheetName('T-Test: a/b [x]', used)).toBe('T-Test  a b  x')
    const long = 'Independent Samples Test with a very long title'
    const first = uniqueSheetName(long, used)
    expect(first).toHaveLength(31)
    const second = uniqueSheetName(long.toUpperCase(), used)
    expect(second).toHaveLength(31)
    expect(second.endsWith(' (2)')).toBe(true)
    expect(uniqueSheetName('', used)).toBe('Sheet')
  })
})

describe('buildOutputXlsx', () => {
  it('writes one sheet per analysis with real numbers', async () => {
    addBlock('one')
    addBlock('two')
    const zip = await unzip(await buildOutputXlsx(await parts()))
    const workbook = await zip.file('xl/workbook.xml')!.async('string')
    expect(workbook).toContain('name="Block one"')
    expect(workbook).toContain('name="Block two"')

    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(sheet).toContain('<v>34.25</v>')
    expect(sheet).toContain('<v>0.0123</v>')
    // A p below the display resolution stays as the "<.001" text.
    expect(sheet).toContain('&lt;.001')
    expect(sheet).not.toContain('<v>0.00001</v>')

    const styles = await zip.file('xl/styles.xml')!.async('string')
    expect(styles).toContain('formatCode="0.00"')
    expect(styles).toContain('formatCode="#.000"')
  })

  it('embeds plots as images', async () => {
    addBlock('plot', [{ titleKey: 'Histogram', type: 'png', data: 'x' } as OutputPlot])
    const zip = await unzip(await buildOutputXlsx(await parts()))
    expect(zip.file('xl/media/image1.png')).not.toBeNull()
    expect(zip.file('xl/drawings/drawing1.xml')).not.toBeNull()
    const types = await zip.file('[Content_Types].xml')!.async('string')
    expect(types).toContain('/xl/drawings/drawing1.xml')
  })

  it('still produces a valid workbook when nothing is in scope', async () => {
    const zip = await unzip(await buildOutputXlsx([]))
    expect(zip.file('xl/worksheets/sheet1.xml')).not.toBeNull()
  })
})

describe('buildOutputDocx', () => {
  it('follows the document order, inserted items included', async () => {
    addBlock('first')
    useOutputStore.getState().insertItem({ kind: 'heading', id: 'h', text: 'Section two' })
    addBlock('second')
    const zip = await unzip(await buildOutputDocx(await parts()))
    const xml = await zip.file('word/document.xml')!.async('string')
    const a = xml.indexOf('Table first')
    const h = xml.indexOf('Section two')
    const b = xml.indexOf('Table second')
    expect(a).toBeGreaterThan(-1)
    expect(a).toBeLessThan(h)
    expect(h).toBeLessThan(b)
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('34.25')
  })

  it('leaves inserted items out of a selected-blocks export', async () => {
    addBlock('first')
    useOutputStore.getState().insertItem({ kind: 'heading', id: 'h', text: 'Section two' })
    const zip = await unzip(await buildOutputDocx(await parts(false)))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).not.toContain('Section two')
  })

  it('embeds plots and keeps a plot that failed to render as its title', async () => {
    addBlock('plot', [
      { titleKey: 'Histogram', type: 'png', data: 'x' } as OutputPlot,
      { titleKey: 'Broken', type: 'png', data: 'y' } as OutputPlot
    ])
    let call = 0
    const flaky = (): Promise<PlotImage> =>
      ++call === 2 ? Promise.reject(new Error('boom')) : fakeRasterize()
    const p = await collectExportParts(useOutputStore.getState().blocks, t, {}, true, flaky)
    const zip = await unzip(await buildOutputDocx(p))
    const media = Object.values(zip.files).filter(f => !f.dir && f.name.startsWith('word/media/'))
    expect(media).toHaveLength(1)
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('Broken')
  })
})
