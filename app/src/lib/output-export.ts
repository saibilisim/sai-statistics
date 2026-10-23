// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * output-export.ts — serializes the Output tab into a single self-contained
 * HTML file for sharing/printing (the reopenable copy of the Output tab is
 * the output.json embedded in the .sdf — see buildOutputDocument below).
 *
 * Tables render as real <table> markup (same formatting rules as OutputView:
 * src/lib/output-format.ts). Plots are rasterized to PNG so the file has no
 * external script dependency — `png`/`svg` blocks embed directly, `plotly`
 * blocks render off-screen once via plotly.js-dist-min and are captured with
 * `Plotly.toImage` (same API OutputPlotView/PlotlyChart already use).
 */

import type { TFunction } from 'i18next'
import type * as PlotlyTypes from 'plotly.js'
import { useOutputStore, type OutputBlock } from '../store/output-store'
import type { OutputPlot } from '@shared/analysis-types'
import type { OutputDocument } from '@shared/output-document'
import { translateOutputKey } from './output-format'
import {
  resolveTable,
  resolvedTableToHtml,
  resolvedTableToCsv,
  resolvedTableToMarkdown
} from './output-resolve'

type PlotlyModule = {
  newPlot: (
    el: HTMLElement,
    data: PlotlyTypes.Data[],
    layout?: Partial<PlotlyTypes.Layout>,
    config?: Partial<PlotlyTypes.Config>
  ) => Promise<PlotlyTypes.PlotlyHTMLElement>
  toImage: (
    el: HTMLElement,
    opts: { format: string; width: number; height: number }
  ) => Promise<string>
  purge: (el: HTMLElement) => void
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function renderPlotlyPng(data: unknown): Promise<string> {
  const Plotly = (await import('plotly.js-dist-min')) as unknown as PlotlyModule
  const div = document.createElement('div')
  div.style.position = 'fixed'
  div.style.left = '-99999px'
  div.style.top = '0'
  document.body.appendChild(div)
  try {
    const figure = data as { data: PlotlyTypes.Data[]; layout?: Partial<PlotlyTypes.Layout> }
    const width = 800
    const height = 500
    await Plotly.newPlot(div, figure.data, { ...figure.layout, width, height })
    return await Plotly.toImage(div, { format: 'png', width, height })
  } finally {
    Plotly.purge(div)
    div.remove()
  }
}

/** A plot as PNG bytes plus its pixel size — what the .docx/.xlsx exports
 *  embed (neither format takes a Plotly figure, and Word's SVG support is
 *  too uneven across versions to rely on). */
export interface PlotImage {
  png: Uint8Array
  width: number
  height: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      resolve(img)
    }
    img.onerror = () => {
      reject(new Error('Plot image could not be decoded'))
    }
    img.src = src
  })
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function rasterizePlot(plot: OutputPlot): Promise<PlotImage> {
  let pngUrl: string
  if (plot.type === 'png') {
    pngUrl = `data:image/png;base64,${String(plot.data)}`
  } else if (plot.type === 'svg') {
    const svg = await loadImage(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(plot.data))}`
    )
    const canvas = document.createElement('canvas')
    // 2× so the raster stays sharp when Word scales it to the page width.
    canvas.width = (svg.naturalWidth || 800) * 2
    canvas.height = (svg.naturalHeight || 500) * 2
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(svg, 0, 0, canvas.width, canvas.height)
    pngUrl = canvas.toDataURL('image/png')
  } else {
    pngUrl = await renderPlotlyPng(plot.data)
  }
  const img = await loadImage(pngUrl)
  return { png: dataUrlToBytes(pngUrl), width: img.naturalWidth, height: img.naturalHeight }
}

async function renderPlotHtml(plot: OutputPlot, t: TFunction): Promise<string> {
  const title = `<div class="plot-title">${escapeHtml(translateOutputKey(plot.titleKey, t))}</div>`
  if (plot.type === 'png') {
    return `<div class="plot-wrapper">${title}<img src="data:image/png;base64,${String(plot.data)}" alt="" /></div>`
  }
  if (plot.type === 'svg') {
    return `<div class="plot-wrapper">${title}${String(plot.data)}</div>`
  }
  // plotly
  const png = await renderPlotlyPng(plot.data)
  return `<div class="plot-wrapper">${title}<img src="${png}" alt="" /></div>`
}

const CSS = `
  body { font-family: Arial, Helvetica, sans-serif; margin: 2rem; color: #1a1a1a; background: #fff; }
  h1 { font-size: 1.4rem; border-bottom: 2px solid #333; padding-bottom: 0.5rem; }
  section { margin-bottom: 2.5rem; }
  section h2 { font-size: 1.1rem; margin-bottom: 0.1rem; }
  .meta { color: #666; font-size: 0.8rem; margin-bottom: 0.75rem; }
  .table-title, .plot-title { font-weight: 600; margin: 0.75rem 0 0.25rem; }
  table { border-collapse: collapse; margin-bottom: 0.5rem; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; font-size: 0.85rem; }
  th { background: #f0f0f0; text-align: left; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .table-footnote { color: #666; font-size: 0.75rem; margin-bottom: 1rem; }
  .plot-wrapper img { max-width: 100%; height: auto; border: 1px solid #ddd; }
  .warnings { color: #9a6700; font-size: 0.85rem; }
  .notes { color: #666; font-size: 0.75rem; margin-bottom: 0.25rem; }
  .ai-note { border: 1px solid #ccc; border-left: 3px solid #666; border-radius: 4px; padding: 6px 10px; margin-bottom: 0.75rem; }
  .ai-note-badge { display: inline-block; font-size: 0.7rem; color: #666; border: 1px solid #ccc; border-radius: 4px; padding: 0 4px; margin-bottom: 0.25rem; }
  .ai-note-text { font-size: 0.85rem; }
  .doc-heading { font-size: 1.2rem; font-weight: 700; margin: 1.5rem 0 0.5rem; }
  .doc-text { margin-bottom: 1rem; white-space: pre-wrap; }
  .doc-page-break { page-break-after: always; border: none; border-top: 1px dashed #999; margin: 1.5rem 0; }
`

/** Export seçenekleri. `includeAiNotes` varsayılan KAPALI
 *  (ai-entegrasyon-fizibilitesi.md §5.3): AI yorumu bilimsel/klinik rapora
 *  sessizce sızmamalı — yalnız kullanıcı açıkça isterse, 'AI-generated'
 *  rozetiyle birlikte basılır. Şu an export akışı diyalogsuz (menü → kaydet),
 *  bu yüzden çağıranlar bu seçeneği henüz geçmiyor = aiNote export'a girmez. */
export interface OutputExportOptions {
  includeAiNotes?: boolean
  /** Blocks the user hid via the navigator's eye toggle are excluded by
   *  default, same principle as includeAiNotes — an export is a deliberate
   *  "what you see" snapshot unless the user opts into more. */
  includeHidden?: boolean
}

/** Filters out blocks hidden via BlockEdits.hidden, unless includeHidden. */
export function visibleBlocks(blocks: OutputBlock[], options: OutputExportOptions): OutputBlock[] {
  if (options.includeHidden === true) return blocks
  const edits = useOutputStore.getState().edits
  return blocks.filter(b => edits[b.id]?.hidden !== true)
}

function renderAiNoteHtml(block: OutputBlock, t: TFunction): string {
  if (!block.aiNote) return ''
  const badge = t('ai.output.generatedBadge', { defaultValue: 'AI-generated — verify' })
  const text = escapeHtml(block.aiNote.text).replace(/\n/g, '<br />')
  return `<div class="ai-note"><div class="ai-note-badge">${escapeHtml(badge)}</div><div class="ai-note-text">${text}</div></div>`
}

async function renderBlockSectionHtml(
  block: OutputBlock,
  t: TFunction,
  options: OutputExportOptions
): Promise<string> {
  const blockEdits = useOutputStore.getState().edits[block.id]
  const tablesHtml = block.result.tables
    .map((tb, i) => resolvedTableToHtml(resolveTable(tb, t, blockEdits?.tables[String(i)])))
    .join('\n')
  const plotsHtml = (await Promise.all(block.result.plots.map(p => renderPlotHtml(p, t)))).join(
    '\n'
  )
  const warningsHtml =
    block.result.warnings.length > 0
      ? `<ul class="warnings">${block.result.warnings
          .map(w => `<li>${escapeHtml(translateOutputKey(w, t))}</li>`)
          .join('')}</ul>`
      : ''
  // Methodological notes (prior, SE method, ties …) — shown under the block
  // in the Output tab, so a report must carry them too.
  const notesHtml = block.result.notes
    .map(n => `<div class="notes">${escapeHtml(translateOutputKey(n, t))}</div>`)
    .join('')
  const when = new Date(block.timestamp).toLocaleString()
  const aiNoteHtml = options.includeAiNotes === true ? renderAiNoteHtml(block, t) : ''
  const blockTitle = blockEdits?.titleOverride ?? translateOutputKey(block.titleKey, t)
  return `<section>
        <h2>${escapeHtml(blockTitle)}</h2>
        <div class="meta">${escapeHtml(block.datasetName)} — ${escapeHtml(when)}</div>
        ${warningsHtml}
        ${aiNoteHtml}
        ${tablesHtml}
        ${plotsHtml}
        ${notesHtml}
      </section>`
}

/** Build a single self-contained HTML document from the Output tab's blocks.
 *  Follows the store's `items` order (drag-reordered blocks + inserted
 *  headings/text/page-breaks) rather than raw block order — a block only
 *  renders if it survived scope/hidden filtering into `blocks`; inserted
 *  items render only for a whole-document export (`includeDocItems`) — a
 *  "selected blocks only" export means exactly those blocks. */
export async function buildOutputHtml(
  blocks: OutputBlock[],
  t: TFunction,
  options: OutputExportOptions = {},
  includeDocItems = true
): Promise<string> {
  const includedIds = new Set(visibleBlocks(blocks, options).map(b => b.id))
  const blocksById = new Map(blocks.map(b => [b.id, b]))
  // `items` is already the document's top-to-bottom order (what the view shows).
  const sections = await Promise.all(
    useOutputStore.getState().items.map(async item => {
      if (item.kind === 'block') {
        const block = blocksById.get(item.id)
        if (!block || !includedIds.has(item.id)) return ''
        return renderBlockSectionHtml(block, t, options)
      }
      if (!includeDocItems) return ''
      if (item.kind === 'heading') {
        return `<div class="doc-heading">${escapeHtml(item.text)}</div>`
      }
      if (item.kind === 'text') {
        return `<div class="doc-text">${escapeHtml(item.text)}</div>`
      }
      return `<hr class="doc-page-break" />`
    })
  )

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>SAI Statistics — Output</title>
<style>${CSS}</style>
</head>
<body>
<h1>SAI Statistics — Output</h1>
${sections.filter(s => s !== '').join('\n')}
</body>
</html>`
}

/**
 * Export the current Output tab to an HTML file via the native save dialog,
 * clearing the dirty flag (P0.2 close-guard) on success. Shared by the
 * File ▸ Save Output menu item and the "export and quit" close-guard flow.
 * Returns the saved path, or null if there was nothing to export or the
 * user cancelled the save dialog.
 */
export async function exportOutputHtml(t: TFunction): Promise<string | null> {
  const blocks = useOutputStore.getState().blocks
  if (blocks.length === 0) return null

  const html = await buildOutputHtml(blocks, t)
  const path = await window.api.file.saveOutputHtml({ html, defaultName: 'output.html' })
  return path
}

/**
 * Export the current Output tab to a PDF file — same self-contained HTML as
 * exportOutputHtml(), rendered to PDF in Main via Electron's own
 * printToPDF() (see file-handler.ts). Shared by the File ▸ Export Output as
 * PDF menu item.
 */
export async function exportOutputPdf(t: TFunction): Promise<string | null> {
  const blocks = useOutputStore.getState().blocks
  if (blocks.length === 0) return null

  const html = await buildOutputHtml(blocks, t)
  const path = await window.api.file.exportOutputPdf({ html, defaultName: 'output.pdf' })
  return path
}

// ─────────────────────────────────────────────────────────────
//  Export dialog: scope + Word/Excel/CSV/Markdown formats
//  (Word/Excel build in output-export-office.ts)
// ─────────────────────────────────────────────────────────────

/** What subset of the Output tab an export dialog run targets. */
export type ExportScope = { kind: 'all' } | { kind: 'blocks'; blockIds: string[] }

export type ExportFormat = 'html' | 'pdf' | 'word' | 'excel' | 'csv' | 'markdown'

function scopedBlocks(scope: ExportScope): OutputBlock[] {
  const all = useOutputStore.getState().blocks
  if (scope.kind === 'all') return all
  const idSet = new Set(scope.blockIds)
  return all.filter(b => idSet.has(b.id))
}

/** `blocks` in the document's order (top to bottom, drag-reordering included). */
function inDocOrder(blocks: OutputBlock[]): OutputBlock[] {
  const pos = new Map(useOutputStore.getState().items.map((it, i) => [it.id, i]))
  return [...blocks].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0))
}

/** Every table across the scoped blocks, flattened into one CSV — blocks
 *  separated by a blank line and a title comment line. Plots/notes have no
 *  CSV representation and are silently skipped (a CSV is a data export). */
function buildOutputCsv(blocks: OutputBlock[], t: TFunction, options: OutputExportOptions): string {
  const editsByBlock = useOutputStore.getState().edits
  const sections = visibleBlocks(inDocOrder(blocks), options).map(block => {
    const blockEdits = editsByBlock[block.id]
    const blockTitle = blockEdits?.titleOverride ?? translateOutputKey(block.titleKey, t)
    const tables = block.result.tables.map((tb, i) =>
      resolvedTableToCsv(resolveTable(tb, t, blockEdits?.tables[String(i)]))
    )
    return [`# ${blockTitle}`, ...tables].join('\r\n')
  })
  return sections.join('\r\n\r\n')
}

/** Every table across the scoped blocks as Markdown — one ## heading per
 *  block, its tables below, plots represented by a titled placeholder line
 *  (Markdown here targets pasting into an issue/PR/notebook, not archival).
 *  Inserted headings/text follow the document order like the HTML export
 *  (whole-document exports only); page breaks have no Markdown form. */
function buildOutputMarkdown(
  blocks: OutputBlock[],
  t: TFunction,
  options: OutputExportOptions,
  includeDocItems: boolean
): string {
  const editsByBlock = useOutputStore.getState().edits
  const includedIds = new Set(visibleBlocks(blocks, options).map(b => b.id))
  const blocksById = new Map(blocks.map(b => [b.id, b]))
  const sections = useOutputStore.getState().items.map(item => {
    if (item.kind === 'heading') return includeDocItems ? `# ${item.text}` : ''
    if (item.kind === 'text') return includeDocItems ? item.text : ''
    if (item.kind === 'pageBreak') return ''
    const block = blocksById.get(item.id)
    if (!block || !includedIds.has(item.id)) return ''
    const blockEdits = editsByBlock[block.id]
    const blockTitle = blockEdits?.titleOverride ?? translateOutputKey(block.titleKey, t)
    const tables = block.result.tables.map((tb, i) =>
      resolvedTableToMarkdown(resolveTable(tb, t, blockEdits?.tables[String(i)]))
    )
    const plots = block.result.plots.map(p => `*[${translateOutputKey(p.titleKey, t)}]*`)
    const notes = block.result.notes.map(n => `> ${translateOutputKey(n, t)}`)
    return [`## ${blockTitle}`, '', ...tables, ...plots, ...notes].join('\n')
  })
  return sections.filter(s => s !== '').join('\n\n')
}

/**
 * Runs an export for the given format + scope, routing to the right
 * builder/save path. Returns the saved file path, or null if there was
 * nothing in scope or the user cancelled the save dialog. Shared by the
 * Export Output dialog (src/components/Dialogs/OutputExportDialog.tsx).
 */
export async function exportOutputAs(
  format: ExportFormat,
  t: TFunction,
  scope: ExportScope = { kind: 'all' },
  options: OutputExportOptions = {}
): Promise<string | null> {
  const blocks = scopedBlocks(scope)
  if (blocks.length === 0) return null
  const wholeDoc = scope.kind === 'all'

  let path: string | null = null
  switch (format) {
    case 'html': {
      const html = await buildOutputHtml(blocks, t, options, wholeDoc)
      path = await window.api.file.saveOutputHtml({ html, defaultName: 'output.html' })
      break
    }
    case 'pdf': {
      const html = await buildOutputHtml(blocks, t, options, wholeDoc)
      path = await window.api.file.exportOutputPdf({ html, defaultName: 'output.pdf' })
      break
    }
    case 'word':
    case 'excel': {
      // Native .docx/.xlsx (output-export-office.ts), loaded on demand.
      const office = await import('./output-export-office')
      const parts = await office.collectExportParts(blocks, t, options, wholeDoc)
      path = await window.api.file.exportOutputBinary(
        format === 'word'
          ? {
              data: await office.buildOutputDocx(parts),
              defaultName: 'output.docx',
              filterName: 'Word',
              extensions: ['docx']
            }
          : {
              data: await office.buildOutputXlsx(parts),
              defaultName: 'output.xlsx',
              filterName: 'Excel',
              extensions: ['xlsx']
            }
      )
      break
    }
    case 'csv': {
      path = await window.api.file.exportOutputText({
        content: buildOutputCsv(blocks, t, options),
        defaultName: 'output.csv',
        filterName: 'CSV',
        extensions: ['csv']
      })
      break
    }
    case 'markdown': {
      path = await window.api.file.exportOutputText({
        content: buildOutputMarkdown(blocks, t, options, wholeDoc),
        defaultName: 'output.md',
        filterName: 'Markdown',
        extensions: ['md']
      })
      break
    }
  }

  return path
}

/** Serializes the current store state into the on-disk OutputDocument shape
 *  — blocks + doc item order + every table/block edit overlay — embedded in
 *  the `.sdf` as output.json (file-actions.ts). */
export function buildOutputDocument(): OutputDocument {
  const s = useOutputStore.getState()
  return {
    formatVersion: 1,
    savedAt: new Date().toISOString(),
    itemOrder: 'chronological',
    items: s.items,
    blocks: s.blocks.map(b => ({
      id: b.id,
      analysisId: b.analysisId,
      titleKey: b.titleKey,
      timestamp: b.timestamp,
      datasetName: b.datasetName,
      result: b.result,
      aiNote: b.aiNote,
      summary: b.summary,
      syntax: b.syntax
    })),
    edits: s.edits
  }
}

/**
 * Replaces the Output tab with the .sdf's embedded `document` (null → empty
 * Output, e.g. a legacy .sdf without output.json) and resets the undo history
 * so the loaded state doesn't carry the previous session's edit stack. The
 * loaded state matches the file on disk, so Output starts clean.
 */
export function loadOutputDocument(document: OutputDocument | null): void {
  useOutputStore.setState({
    blocks: document?.blocks.map(b => ({ ...b, isCollapsed: false })) ?? [],
    // Saved before 2026-10-18: items were newest-first.
    items:
      document?.itemOrder === 'chronological'
        ? document.items
        : [...(document?.items ?? [])].reverse(),
    edits: document?.edits ?? {},
    selection: null
  })
  useOutputStore.getState().markSaved()
  useOutputStore.temporal.getState().clear()
}
