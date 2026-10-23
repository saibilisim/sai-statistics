// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * output-clipboard.ts — writes both a text/plain (TSV) and a text/html
 * flavor in a single ClipboardItem. Excel/SPSS paste from the TSV flavor;
 * Word/LibreOffice prefer the HTML flavor, so a copied table lands as a real
 * table there instead of tab-delimited text. Both flavors come from the same
 * ResolvedTable (src/lib/output-resolve.ts) so they can never drift.
 */

import type { TFunction } from 'i18next'
import type { OutputTable } from '@shared/analysis-types'
import type { TableEdits } from '@shared/output-document'
import {
  resolveTable,
  resolvedTableToHtml,
  resolvedTableToTsv,
  type ResolvedTable
} from './output-resolve'
import {
  escapeClipboardHtml,
  clipboardSpacerRowHtml,
  clipboardWideRowHtml
} from './output-clipboard-html'

/** Write both flavors to the OS clipboard in one go — shared by every copy
 *  trigger in the Output view (Ctrl+C, right-click ▸ Copy, a table's own
 *  "Copy Table"/"Copy Selection", a free mouse-drag selection) so they all
 *  produce clipboard data the exact same way. */
export async function writeDualFlavor(html: string, tsv: string): Promise<void> {
  // Safari/older browsers may not support multi-flavor ClipboardItem for
  // text/html — fall back to plain text so copy still works at all.
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([tsv], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' })
      })
    ])
  } catch {
    await navigator.clipboard.writeText(tsv)
  }
}

/** Copy an entire resolved table (both flavors). */
export async function copyResolvedTable(resolved: ResolvedTable): Promise<void> {
  await writeDualFlavor(resolvedTableToHtml(resolved), resolvedTableToTsv(resolved))
}

/** Copy a rectangular cell range (r1..r2, c1..c2 inclusive, 0-based) out of a
 *  resolved table — used for the drag/shift-click cell selection. */
export async function copyResolvedRange(
  resolved: ResolvedTable,
  r1: number,
  c1: number,
  r2: number,
  c2: number
): Promise<void> {
  const rTop = Math.min(r1, r2)
  const rBot = Math.max(r1, r2)
  const cLeft = Math.min(c1, c2)
  const cRight = Math.max(c1, c2)
  const rows = resolved.rows.slice(rTop, rBot + 1).map(row => row.slice(cLeft, cRight + 1))
  const sub: ResolvedTable = { title: null, columns: [], rows, footnotes: [] }
  const tsv = rows.map(row => row.map(c => c.text).join('\t')).join('\n')
  const html = resolvedTableToHtml(sub)
  await writeDualFlavor(html, tsv)
}

// ── Combined multi-item copy (navigator Ctrl+C / right-click ▸ Copy) ───────
// Pasting clipboard HTML that contains several SIBLING <table> elements into
// Excel/Sheets/LibreOffice Calc only imports the FIRST <table> tag — every
// later table (its header row included) silently disappears on paste. Since
// a single "test" block routinely produces 2+ tables (Ranks + Test
// Statistics for Mann-Whitney, etc.), the old per-table
// `<div class="table-wrapper"><table>...</table></div>` concatenation lost
// every table after the first as soon as more than one was selected. The fix
// is the standard workaround: emit ONE combined <table>, with title/heading/
// footnote text as colspan-spanning rows between each table's own real
// header row — so every header survives the paste, not just the first one's.
// The row builders (WIDE_COLSPAN, escaping) live in output-clipboard-html.ts,
// shared with selection-clipboard.ts's free mouse-drag selection copy, which
// hits the exact same Excel/Sheets/Calc limitation.

/** One table's rows (title + real header row + data + footnotes), meant to
 *  be spliced into a shared parent <table> rather than wrapped in its own. */
function tableRowsHtml(resolved: ResolvedTable): string {
  const rows: string[] = []
  if (resolved.title) rows.push(clipboardWideRowHtml(resolved.title, true))
  if (resolved.columns.length > 0) {
    rows.push(
      `<tr>${resolved.columns.map(c => `<th>${escapeClipboardHtml(c)}</th>`).join('')}</tr>`
    )
  }
  rows.push(
    ...resolved.rows.map(row => {
      const cells = row
        .map(cell => {
          const alignStyle = cell.align === 'num' ? 'text-align:right' : 'text-align:left'
          return `<td style="${alignStyle}">${escapeClipboardHtml(cell.text)}</td>`
        })
        .join('')
      return `<tr>${cells}</tr>`
    })
  )
  resolved.footnotes.forEach(f => {
    rows.push(
      `<tr><td colspan="${String(Math.max(resolved.columns.length, 1))}" style="color:#666;font-size:0.75rem;font-style:italic">${escapeClipboardHtml(f)}</td></tr>`
    )
  })
  return rows.join('')
}

/** Copy multiple selected blocks, individual tables, or inserted text items —
 *  supports Ctrl/Shift multi-selection copying in the Output navigator. */
export async function copyMultipleSelectedItems(
  selectedIds: string[],
  blocks: { id: string; titleKey: string; result: { tables: OutputTable[] } }[],
  items: { id: string; kind: string; text?: string }[],
  edits: Record<string, { tables?: Record<string, TableEdits>; titleOverride?: string }>,
  t: TFunction,
  translateOutputKeyFunc: (key: string, t: TFunction) => string
): Promise<void> {
  if (selectedIds.length === 0) return

  const blocksById = new Map(blocks.map(b => [b.id, b]))
  const itemsById = new Map(items.map(it => [it.id, it]))

  const tsvParts: string[] = []
  const htmlRowGroups: string[] = []
  const copiedTableKeys = new Set<string>()

  function pushTable(resolved: ResolvedTable) {
    tsvParts.push(resolvedTableToTsv(resolved))
    htmlRowGroups.push(tableRowsHtml(resolved))
  }
  function pushText(text: string, bold: boolean) {
    tsvParts.push(text)
    htmlRowGroups.push(clipboardWideRowHtml(text, bold))
  }

  for (const id of selectedIds) {
    if (id.startsWith('table-')) {
      const match = id.match(/^table-(.+)-(\d+)$/)
      const blockId = match?.[1]
      const tableIndexStr = match?.[2]
      if (blockId !== undefined && tableIndexStr !== undefined) {
        const tableIndex = parseInt(tableIndexStr, 10)
        const tableKey = `${blockId}-${String(tableIndex)}`
        if (copiedTableKeys.has(tableKey)) continue

        const block = blocksById.get(blockId)
        if (block && block.result.tables[tableIndex]) {
          const table = block.result.tables[tableIndex]
          const tableEdit = edits[blockId]?.tables?.[String(tableIndex)]
          pushTable(resolveTable(table, t, tableEdit))
          copiedTableKeys.add(tableKey)
        }
      }
    } else {
      const block = blocksById.get(id)
      if (block) {
        if (block.result.tables.length > 0) {
          block.result.tables.forEach((table, i) => {
            const tableKey = `${block.id}-${String(i)}`
            if (!copiedTableKeys.has(tableKey)) {
              const tableEdit = edits[block.id]?.tables?.[String(i)]
              pushTable(resolveTable(table, t, tableEdit))
              copiedTableKeys.add(tableKey)
            }
          })
        } else {
          const title = edits[block.id]?.titleOverride ?? translateOutputKeyFunc(block.titleKey, t)
          pushText(title, true)
        }
      } else {
        const item = itemsById.get(id)
        if (item) {
          if (item.kind === 'heading' && item.text) {
            pushText(item.text, true)
          } else if (item.kind === 'text' && item.text) {
            pushText(item.text, false)
          }
        }
      }
    }
  }

  if (tsvParts.length === 0) return

  const combinedTsv = tsvParts.join('\n\n')
  const combinedHtml = `<table style="border-collapse:collapse">${htmlRowGroups
    .map((rows, i) => (i > 0 ? clipboardSpacerRowHtml() + rows : rows))
    .join('')}</table>`
  await writeDualFlavor(combinedHtml, combinedTsv)
}
