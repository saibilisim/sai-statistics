// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * output-export-office.ts — native Word (.docx) and Excel (.xlsx) builders
 * for the Export Output dialog.
 *
 * These replaced the old "HTML saved as .doc/.xls" trick: Excel warned that
 * the file's format and extension did not match, Word dropped the data-URI
 * plots, and every number reached Excel as text. Here Word gets real tables
 * (SPSS/APA-style horizontal rules) with the plots embedded as PNG; Excel
 * gets one sheet per analysis with numeric cells written as numbers, in a
 * number format that shows exactly the decimals the Output view shows.
 *
 * Both walk the same ExportPart list (collectExportParts), which follows
 * buildOutputHtml's rules: document order, hidden-block filtering,
 * aiNote opt-in, inserted items only for a whole-document export.
 * Loaded lazily by output-export.ts — docx/jszip stay out of the main bundle.
 */

import type { TFunction } from 'i18next'
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  type IBorderOptions,
  type ParagraphChild
} from 'docx'
import JSZip from 'jszip'
import type { OutputPlot } from '@shared/analysis-types'
import { useOutputStore, type OutputBlock } from '../store/output-store'
import { translateOutputKey } from './output-format'
import { resolveTable, type ResolvedCell, type ResolvedTable } from './output-resolve'
import {
  visibleBlocks,
  rasterizePlot,
  type OutputExportOptions,
  type PlotImage
} from './output-export'

// ─── Shared document walk ──────────────────────────────────────────────────

export interface ExportBlockPart {
  kind: 'block'
  title: string
  meta: string
  warnings: string[]
  aiNote: { badge: string; text: string } | null
  tables: ResolvedTable[]
  plots: { title: string; image: PlotImage | null }[]
  notes: string[]
}

export type ExportPart =
  | ExportBlockPart
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'pageBreak' }

/** Same order/filter rules as buildOutputHtml. `rasterize` is injectable so
 *  unit tests can run without a DOM; a plot that fails to rasterize keeps its
 *  title with no image rather than aborting the whole export. */
export async function collectExportParts(
  blocks: OutputBlock[],
  t: TFunction,
  options: OutputExportOptions,
  includeDocItems: boolean,
  rasterize: (plot: OutputPlot) => Promise<PlotImage> = rasterizePlot
): Promise<ExportPart[]> {
  const state = useOutputStore.getState()
  const includedIds = new Set(visibleBlocks(blocks, options).map(b => b.id))
  const blocksById = new Map(blocks.map(b => [b.id, b]))
  const parts: ExportPart[] = []

  for (const item of state.items) {
    if (item.kind === 'block') {
      const block = blocksById.get(item.id)
      if (!block || !includedIds.has(item.id)) continue
      const blockEdits = state.edits[block.id]
      const plots = await Promise.all(
        block.result.plots.map(async p => ({
          title: translateOutputKey(p.titleKey, t),
          image: await rasterize(p).catch(() => null)
        }))
      )
      parts.push({
        kind: 'block',
        title: blockEdits?.titleOverride ?? translateOutputKey(block.titleKey, t),
        meta: `${block.datasetName} — ${new Date(block.timestamp).toLocaleString()}`,
        warnings: block.result.warnings.map(w => translateOutputKey(w, t)),
        aiNote:
          options.includeAiNotes === true && block.aiNote
            ? {
                badge: t('ai.output.generatedBadge', { defaultValue: 'AI-generated — verify' }),
                text: block.aiNote.text
              }
            : null,
        tables: block.result.tables.map((tb, i) =>
          resolveTable(tb, t, blockEdits?.tables[String(i)])
        ),
        plots,
        notes: block.result.notes.map(n => translateOutputKey(n, t))
      })
    } else if (includeDocItems) {
      if (item.kind === 'pageBreak') parts.push({ kind: 'pageBreak' })
      else parts.push({ kind: item.kind, text: item.text })
    }
  }
  return parts
}

/** Fit a plot into `maxWidth` pixels, keeping its aspect ratio. */
function fitImage(image: PlotImage, maxWidth: number): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / image.width)
  return { width: Math.round(image.width * scale), height: Math.round(image.height * scale) }
}

// ─── Word (.docx) ──────────────────────────────────────────────────────────

const DEFAULT_DOC_TITLE = 'SAI Statistics — Output'
// A4 with Word's default 1" margins leaves ~6.3" of text width ≈ 600 px @96dpi.
const DOCX_MAX_IMAGE_WIDTH = 600
const TABLE_FONT_SIZE = 18 // half-points → 9 pt
const SMALL_FONT_SIZE = 16 // 8 pt
const MUTED = '666666'
const WARNING = '9A6700'

const RULE: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: '000000' }
const NO_RULE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }

function cellParagraph(text: string, align: 'txt' | 'num', bold = false): Paragraph {
  return new Paragraph({
    alignment: align === 'num' ? AlignmentType.RIGHT : AlignmentType.LEFT,
    children: [new TextRun({ text, bold, size: TABLE_FONT_SIZE })]
  })
}

const CELL_MARGINS = { top: 20, bottom: 20, left: 80, right: 80 }

/** SPSS/APA look: a rule above the table, under the header and below the
 *  last row — no vertical lines. Header cells take their column's alignment
 *  (taken from the first body row) so numeric headers sit over their numbers. */
function docxTable(resolved: ResolvedTable): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  if (resolved.title) {
    out.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: 160, after: 60 },
        children: [new TextRun({ text: resolved.title, bold: true })]
      })
    )
  }
  const colAlign = (i: number): 'txt' | 'num' => resolved.rows[0]?.[i]?.align ?? 'txt'
  const rows: TableRow[] = []
  if (resolved.columns.length > 0) {
    rows.push(
      new TableRow({
        tableHeader: true,
        children: resolved.columns.map(
          (col, i) =>
            new TableCell({
              margins: CELL_MARGINS,
              borders: { bottom: RULE },
              children: [cellParagraph(col, colAlign(i), true)]
            })
        )
      })
    )
  }
  for (const row of resolved.rows) {
    rows.push(
      new TableRow({
        cantSplit: true,
        children: row.map(
          (cell: ResolvedCell) =>
            new TableCell({
              margins: CELL_MARGINS,
              children: [cellParagraph(cell.text, cell.align)]
            })
        )
      })
    )
  }
  if (rows.length > 0) {
    out.push(
      new Table({
        rows,
        borders: {
          top: RULE,
          bottom: RULE,
          left: NO_RULE,
          right: NO_RULE,
          insideHorizontal: NO_RULE,
          insideVertical: NO_RULE
        }
      })
    )
  }
  for (const f of resolved.footnotes) {
    out.push(
      new Paragraph({
        children: [new TextRun({ text: f, size: SMALL_FONT_SIZE, color: MUTED })]
      })
    )
  }
  out.push(new Paragraph({ children: [] }))
  return out
}

/** Multi-line text → one run per line joined by line breaks. */
function textRuns(text: string, opts: { size?: number; color?: string } = {}): ParagraphChild[] {
  return text
    .split(/\r?\n/)
    .map((line, i) => new TextRun({ text: line, break: i > 0 ? 1 : 0, ...opts }))
}

function docxBlock(part: ExportBlockPart): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, text: part.title }),
    new Paragraph({
      children: [new TextRun({ text: part.meta, size: SMALL_FONT_SIZE, color: MUTED })]
    })
  ]
  for (const w of part.warnings) {
    out.push(new Paragraph({ children: [new TextRun({ text: `⚠ ${w}`, color: WARNING })] }))
  }
  if (part.aiNote) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({ text: part.aiNote.badge, size: SMALL_FONT_SIZE, color: MUTED, bold: true })
        ]
      }),
      new Paragraph({ children: textRuns(part.aiNote.text) })
    )
  }
  for (const table of part.tables) out.push(...docxTable(table))
  for (const plot of part.plots) {
    out.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: 160, after: 60 },
        children: [new TextRun({ text: plot.title, bold: true })]
      })
    )
    if (plot.image) {
      out.push(
        new Paragraph({
          children: [
            new ImageRun({
              type: 'png',
              data: plot.image.png,
              transformation: fitImage(plot.image, DOCX_MAX_IMAGE_WIDTH)
            })
          ]
        })
      )
    }
  }
  for (const n of part.notes) {
    out.push(new Paragraph({ children: textRuns(n, { size: SMALL_FONT_SIZE, color: MUTED }) }))
  }
  return out
}

export async function buildOutputDocx(
  parts: ExportPart[],
  /** Localised document title (output.documentTitle). */
  docTitle: string = DEFAULT_DOC_TITLE
): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, text: docTitle })
  ]
  for (const part of parts) {
    switch (part.kind) {
      case 'block':
        children.push(...docxBlock(part))
        break
      case 'heading':
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: part.text }))
        break
      case 'text':
        children.push(new Paragraph({ children: textRuns(part.text) }))
        break
      case 'pageBreak':
        children.push(new Paragraph({ children: [new PageBreak()] }))
        break
    }
  }
  const doc = new Document({
    creator: 'SAI Statistics',
    title: docTitle,
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{ children }]
  })
  return new Uint8Array(await Packer.toArrayBuffer(doc))
}

// ─── Excel (.xlsx) ─────────────────────────────────────────────────────────
//
// Hand-written SpreadsheetML (via jszip, which docx already depends on) rather
// than a spreadsheet library: the output is a handful of styled cells per
// sheet plus optional images, which needs ~one screen of XML, and keeping it
// in-house avoids an unmaintained or heavy dependency.

const XLSX_MAX_IMAGE_WIDTH = 640
const XLSX_ROW_PX = 20 // default row height (15 pt) in pixels
const EMU_PER_PX = 9525

/** Display text → Excel number format showing the same decimals, or null
 *  when the text is not a plain number ("<.001", "1e+21", "Inf"). Mirrors
 *  output-format.ts: either separator, optional dropped leading zero, no
 *  grouping, trailing zeros already stripped for non-p values. */
export function excelNumberFormat(text: string): string | null {
  const m = /^-?(\d*)(?:[.,](\d+))?$/.exec(text.trim())
  if (!m) return null
  const intPart = m[1] ?? ''
  const decimals = m[2]?.length ?? 0
  if (intPart === '' && decimals === 0) return null
  const lead = intPart === '' ? '#' : '0'
  return decimals > 0 ? `${lead}.${'0'.repeat(decimals)}` : '0'
}

interface XlsxStyle {
  font: 'normal' | 'bold' | 'title' | 'muted' | 'warning'
  border: 'none' | 'top' | 'bottom' | 'topBottom'
  align: 'left' | 'right' | null
  numFmt: string | null
}

type XlsxCell = { text: string; num?: undefined } | { num: number; text?: undefined }

interface XlsxRow {
  cells: { cell: XlsxCell; style: XlsxStyle }[]
}

interface XlsxSheet {
  name: string
  rows: XlsxRow[]
  images: { row: number; image: PlotImage }[]
}

const FONT_IDS: Record<XlsxStyle['font'], number> = {
  normal: 0,
  bold: 1,
  title: 2,
  muted: 3,
  warning: 4
}
const BORDER_IDS: Record<XlsxStyle['border'], number> = {
  none: 0,
  top: 1,
  bottom: 2,
  topBottom: 3
}

function xmlEscape(s: string): string {
  return (
    s
      // Control characters are not allowed in XML 1.0 at all.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  )
}

function columnName(index: number): string {
  let n = index + 1
  let name = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

/** Excel sheet names: ≤31 chars, none of \ / ? * [ ] :, unique ignoring case. */
export function uniqueSheetName(title: string, used: Set<string>): string {
  const base =
    title
      .replace(/[\\/?*[\]:]/g, ' ')
      .replace(/^'+|'+$/g, '')
      .trim()
      .slice(0, 31) || 'Sheet'
  let name = base
  for (let n = 2; used.has(name.toLowerCase()); n++) {
    const suffix = ` (${String(n)})`
    name = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(name.toLowerCase())
  return name
}

const PLAIN: XlsxStyle = { font: 'normal', border: 'none', align: null, numFmt: null }

function textRow(text: string, font: XlsxStyle['font'] = 'normal'): XlsxRow {
  return { cells: [{ cell: { text }, style: { ...PLAIN, font } }] }
}

function sheetCell(cell: ResolvedCell, border: XlsxStyle['border']): XlsxRow['cells'][number] {
  if (cell.num !== undefined && Number.isFinite(cell.num)) {
    const numFmt = excelNumberFormat(cell.text)
    if (numFmt) {
      return { cell: { num: cell.num }, style: { font: 'normal', border, align: null, numFmt } }
    }
  }
  return {
    cell: { text: cell.text },
    style: { font: 'normal', border, align: cell.align === 'num' ? 'right' : null, numFmt: null }
  }
}

function blockSheet(part: ExportBlockPart, used: Set<string>): XlsxSheet {
  const rows: XlsxRow[] = [textRow(part.title, 'title'), textRow(part.meta, 'muted')]
  const images: XlsxSheet['images'] = []
  for (const w of part.warnings) rows.push(textRow(`⚠ ${w}`, 'warning'))
  if (part.aiNote) {
    rows.push(textRow(part.aiNote.badge, 'muted'), textRow(part.aiNote.text))
  }
  for (const table of part.tables) {
    rows.push({ cells: [] })
    if (table.title) rows.push(textRow(table.title, 'bold'))
    const lastBody = table.rows.length - 1
    if (table.columns.length > 0) {
      rows.push({
        cells: table.columns.map((col, i) => ({
          cell: { text: col },
          style: {
            font: 'bold',
            border: 'topBottom',
            align: table.rows[0]?.[i]?.align === 'num' ? 'right' : null,
            numFmt: null
          }
        }))
      })
    }
    table.rows.forEach((row, ri) => {
      rows.push({ cells: row.map(cell => sheetCell(cell, ri === lastBody ? 'bottom' : 'none')) })
    })
    for (const f of table.footnotes) rows.push(textRow(f, 'muted'))
  }
  for (const plot of part.plots) {
    rows.push({ cells: [] }, textRow(plot.title, 'bold'))
    if (plot.image) {
      images.push({ row: rows.length, image: plot.image })
      const { height } = fitImage(plot.image, XLSX_MAX_IMAGE_WIDTH)
      for (let i = 0; i < Math.ceil(height / XLSX_ROW_PX) + 1; i++) rows.push({ cells: [] })
    }
  }
  if (part.notes.length > 0) rows.push({ cells: [] })
  for (const n of part.notes) rows.push(textRow(n, 'muted'))
  return { name: uniqueSheetName(part.title, used), rows, images }
}

class StyleTable {
  private readonly numFmts = new Map<string, number>()
  private readonly xfs = new Map<string, number>([['normal|none||', 0]])
  private readonly xfList: XlsxStyle[] = [PLAIN]

  index(style: XlsxStyle): number {
    const key = `${style.font}|${style.border}|${style.align ?? ''}|${style.numFmt ?? ''}`
    const existing = this.xfs.get(key)
    if (existing !== undefined) return existing
    if (style.numFmt && !this.numFmts.has(style.numFmt)) {
      this.numFmts.set(style.numFmt, 164 + this.numFmts.size)
    }
    const id = this.xfList.length
    this.xfList.push(style)
    this.xfs.set(key, id)
    return id
  }

  toXml(): string {
    const numFmts = [...this.numFmts]
      .map(([code, id]) => `<numFmt numFmtId="${String(id)}" formatCode="${xmlEscape(code)}"/>`)
      .join('')
    const xfs = this.xfList
      .map(s => {
        const numFmtId = s.numFmt ? (this.numFmts.get(s.numFmt) ?? 0) : 0
        const align = s.align ? `<alignment horizontal="${s.align}"/>` : ''
        return (
          `<xf numFmtId="${String(numFmtId)}" fontId="${String(FONT_IDS[s.font])}" fillId="0" borderId="${String(BORDER_IDS[s.border])}" xfId="0"` +
          `${numFmtId ? ' applyNumberFormat="1"' : ''} applyFont="1" applyBorder="1"` +
          (align ? ` applyAlignment="1">${align}</xf>` : '/>')
        )
      })
      .join('')
    const line = '<left/><right/>'
    const thin = '<color rgb="FF000000"/>'
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      (this.numFmts.size > 0
        ? `<numFmts count="${String(this.numFmts.size)}">${numFmts}</numFmts>`
        : '') +
      `<fonts count="5">` +
      `<font><sz val="11"/><name val="Calibri"/></font>` +
      `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
      `<font><b/><sz val="14"/><name val="Calibri"/></font>` +
      `<font><sz val="9"/><color rgb="FF666666"/><name val="Calibri"/></font>` +
      `<font><sz val="11"/><color rgb="FF9A6700"/><name val="Calibri"/></font>` +
      `</fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="4">` +
      `<border>${line}<top/><bottom/><diagonal/></border>` +
      `<border>${line}<top style="thin">${thin}</top><bottom/><diagonal/></border>` +
      `<border>${line}<top/><bottom style="thin">${thin}</bottom><diagonal/></border>` +
      `<border>${line}<top style="thin">${thin}</top><bottom style="thin">${thin}</bottom><diagonal/></border>` +
      `</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${String(this.xfList.length)}">${xfs}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`
    )
  }
}

function sheetXml(sheet: XlsxSheet, styles: StyleTable, hasDrawing: boolean): string {
  const widths = new Map<number, number>()
  const rowsXml = sheet.rows
    .map((row, ri) => {
      const r = String(ri + 1)
      const cells = row.cells
        .map(({ cell, style }, ci) => {
          const ref = `${columnName(ci)}${r}`
          const s = String(styles.index(style))
          // Column 0 also carries block titles/notes; those overflow into the
          // empty cells to their right, so they must not widen the column.
          const value = cell.text ?? String(cell.num)
          if (row.cells.length > 1 || ci > 0) {
            widths.set(ci, Math.max(widths.get(ci) ?? 0, value.length))
          }
          if (cell.num !== undefined) return `<c r="${ref}" s="${s}"><v>${value}</v></c>`
          return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`
        })
        .join('')
      return `<row r="${r}">${cells}</row>`
    })
    .join('')
  const cols = [...widths]
    .sort(([a], [b]) => a - b)
    .map(([i, w]) => {
      const c = String(i + 1)
      const width = String(Math.min(60, Math.max(8, w + 2)))
      return `<col min="${c}" max="${c}" width="${width}" customWidth="1"/>`
    })
    .join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${rowsXml}</sheetData>` +
    (hasDrawing ? `<drawing r:id="rId1"/>` : '') +
    `</worksheet>`
  )
}

/** Image i of a sheet is relationship rId(i+1) in its drawing's .rels. */
function drawingXml(images: XlsxSheet['images']): string {
  const anchors = images
    .map(({ row, image }, i) => {
      const { width, height } = fitImage(image, XLSX_MAX_IMAGE_WIDTH)
      const ext = `cx="${String(width * EMU_PER_PX)}" cy="${String(height * EMU_PER_PX)}"`
      const n = String(i + 1)
      return (
        `<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${String(row)}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:ext ${ext}/>` +
        `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${String(i + 2)}" name="Picture ${n}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip r:embed="rId${n}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ${ext}/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
        `</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`
      )
    })
    .join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    anchors +
    `</xdr:wsDr>`
  )
}

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function relsXml(rels: { id: string; type: string; target: string }[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}">` +
    rels.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join('') +
    `</Relationships>`
  )
}

/** Headings/text/page breaks have no sheet of their own — like the CSV
 *  export, the workbook carries the analyses; an empty export still yields a
 *  valid one-sheet workbook. */
export async function buildOutputXlsx(parts: ExportPart[]): Promise<Uint8Array> {
  const used = new Set<string>()
  const sheets = parts
    .filter((p): p is ExportBlockPart => p.kind === 'block')
    .map(p => blockSheet(p, used))
  if (sheets.length === 0) sheets.push({ name: 'Sheet1', rows: [], images: [] })

  const zip = new JSZip()
  const styles = new StyleTable()
  const overrides: string[] = []
  let mediaCount = 0

  sheets.forEach((sheet, si) => {
    const n = String(si + 1)
    const hasDrawing = sheet.images.length > 0
    zip.file(`xl/worksheets/sheet${n}.xml`, sheetXml(sheet, styles, hasDrawing))
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    if (!hasDrawing) return
    zip.file(
      `xl/worksheets/_rels/sheet${n}.xml.rels`,
      relsXml([{ id: 'rId1', type: `${DOC_REL}/drawing`, target: `../drawings/drawing${n}.xml` }])
    )
    zip.file(`xl/drawings/drawing${n}.xml`, drawingXml(sheet.images))
    overrides.push(
      `<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
    )
    const imageRels = sheet.images.map(({ image }, i) => {
      const media = `image${String(++mediaCount)}.png`
      zip.file(`xl/media/${media}`, image.png)
      return { id: `rId${String(i + 1)}`, type: `${DOC_REL}/image`, target: `../media/${media}` }
    })
    zip.file(`xl/drawings/_rels/drawing${n}.xml.rels`, relsXml(imageRels))
  })

  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${DOC_REL}"><sheets>` +
      sheets
        .map((s, i) => {
          const n = String(i + 1)
          return `<sheet name="${xmlEscape(s.name)}" sheetId="${n}" r:id="rId${n}"/>`
        })
        .join('') +
      `</sheets></workbook>`
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    relsXml([
      ...sheets.map((_, i) => ({
        id: `rId${String(i + 1)}`,
        type: `${DOC_REL}/worksheet`,
        target: `worksheets/sheet${String(i + 1)}.xml`
      })),
      { id: `rId${String(sheets.length + 1)}`, type: `${DOC_REL}/styles`, target: 'styles.xml' }
    ])
  )
  // Styles last: every sheet has registered its cell styles by now.
  zip.file('xl/styles.xml', styles.toXml())
  zip.file(
    '_rels/.rels',
    relsXml([{ id: 'rId1', type: `${DOC_REL}/officeDocument`, target: 'xl/workbook.xml' }])
  )
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="png" ContentType="image/png"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      overrides.join('') +
      `</Types>`
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
