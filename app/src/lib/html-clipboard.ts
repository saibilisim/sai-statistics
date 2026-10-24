// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * html-clipboard.ts — reads the `text/html` clipboard flavor (Excel/Google
 * Sheets/LibreOffice all write a `<table>` alongside the plain-text/TSV
 * flavor `pasteAtActiveCell` already reads — some via inline per-`<td>`
 * `style="..."`, some via a `<style>` block + classes, see
 * `parseHtmlClipboardGrid`) and turns it into the same
 * `[row][col] -> { format }` shape the internal clipboard (`InternalClip` in
 * views/DataView/internal-clipboard.ts) already knows how to merge onto
 * pasted cells — external color/font paste reuses that merge code as-is, no
 * new merge logic.
 */
import type { CellFormat } from '@shared/data-types'

export interface HtmlClipboardGrid {
  rows: number
  cols: number
  cells: { format?: CellFormat }[][]
}

const BOLD_WEIGHT_RE = /^(bold|bolder|[6-9]\d\d|1000)$/i
const TRANSPARENT_RE = /^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/i

/** Diffs a cell's *computed* style against an unstyled baseline computed in
 *  the same DOM context (same injected `<style>` cascade) — only fields that
 *  actually differ from "what a plain, class-less `<td>` would look like
 *  here" are captured. Reading computed style (rather than only the inline
 *  `style=""` attribute) is what makes LibreOffice's copy format work: it
 *  emits per-cell classes resolved through a `<style>` block instead of
 *  inline styles (Excel/Sheets tend to use inline styles for this, which
 *  computed style also picks up — one code path covers both). Diffing
 *  against a baseline (rather than reading computed style values directly)
 *  is required BECAUSE computed style always resolves to a concrete value
 *  (e.g. `color: rgb(0, 0, 0)`, a real font-family, a real font-size) even
 *  for a cell the source never styled at all — without the baseline, every
 *  pasted cell would get an explicit black text color / default font
 *  stamped onto it. */
function styleToCellFormat(
  style: CSSStyleDeclaration,
  baseline: CSSStyleDeclaration
): CellFormat | undefined {
  const format: CellFormat = {}
  if (
    style.backgroundColor !== baseline.backgroundColor &&
    !TRANSPARENT_RE.test(style.backgroundColor)
  ) {
    format.bg = style.backgroundColor
  }
  if (style.color !== baseline.color) format.color = style.color
  if (style.fontWeight !== baseline.fontWeight && BOLD_WEIGHT_RE.test(style.fontWeight)) {
    format.bold = true
  }
  if (
    style.fontStyle !== baseline.fontStyle &&
    (style.fontStyle === 'italic' || style.fontStyle === 'oblique')
  ) {
    format.italic = true
  }
  if (
    style.textDecorationLine !== baseline.textDecorationLine &&
    style.textDecorationLine.includes('underline')
  ) {
    format.underline = true
  }
  if (style.fontFamily !== baseline.fontFamily) {
    const family = style.fontFamily
      .split(',')[0]
      ?.trim()
      .replace(/^["']|["']$/g, '')
    if (family) format.fontFamily = family
  }
  if (style.fontSize !== baseline.fontSize) {
    const px = parseFloat(style.fontSize)
    if (!Number.isNaN(px) && px > 0) format.fontSize = px
  }
  return Object.keys(format).length > 0 ? format : undefined
}

/** Reads the `text/html` clipboard flavor, if any, via Electron's native
 *  `clipboard.readHTML()` (main process — see clipboard-handler.ts), NOT
 *  the renderer's `navigator.clipboard.read()` Async Clipboard API: that
 *  API's Electron/Chromium implementation does not reliably surface
 *  `text/html` among a clipboard entry's available types even when the OS
 *  clipboard genuinely has it (observed: pasting a colored Excel/LibreOffice
 *  cell never carried formatting through `read()`, while the OS clipboard
 *  unquestionably had an HTML flavor — `clipboard.readHTML()` reads it
 *  correctly every time). Swallows all errors since a paste must still work
 *  from plain text alone when this comes back empty. */
export async function readClipboardHtml(): Promise<string | null> {
  try {
    const html = await window.api.clipboard.readHtml()
    return html || null
  } catch {
    return null
  }
}

const TABLE_TAGS = new Set([
  'table',
  'caption',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th'
])
const TABLE_ATTRS = new Set([
  'class',
  'style',
  'colspan',
  'rowspan',
  'span',
  'align',
  'valign',
  'bgcolor',
  'width',
  'height',
  'nowrap'
])

/** First <table> of the payload, detached from an inert document and cut down
 *  to TABLE_TAGS/TABLE_ATTRS, plus its <style> blocks as text-only copies. */
function sanitizeClipboardTable(
  html: string
): { table: HTMLTableElement; styles: HTMLStyleElement[] } | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const source = doc.querySelector('table')
  if (!source) return null
  for (const el of Array.from(source.querySelectorAll('*'))) {
    if (!TABLE_TAGS.has(el.localName)) {
      el.remove()
      continue
    }
    for (const attr of Array.from(el.attributes)) {
      if (!TABLE_ATTRS.has(attr.name.toLowerCase())) el.removeAttribute(attr.name)
    }
  }
  for (const attr of Array.from(source.attributes)) {
    if (!TABLE_ATTRS.has(attr.name.toLowerCase())) source.removeAttribute(attr.name)
  }
  const styles = Array.from(doc.querySelectorAll('style')).map(s => {
    const copy = document.createElement('style')
    copy.textContent = s.textContent
    return copy
  })
  return { table: document.importNode(source, true), styles }
}

/** Parses the first `<table>` found in an HTML clipboard payload into a
 *  format-only grid. Returns null when there is no table (e.g. the HTML
 *  flavor is just a wrapped plain-text run, or parsing fails).
 *
 *  Renders the payload into a hidden, offscreen element that IS attached to
 *  `document` (inside a shadow root, so any `<style>` rules the payload
 *  carries — LibreOffice writes per-cell classes resolved through a
 *  `<style>` block rather than inline styles — apply and are scoped, never
 *  leaking onto the rest of the app) so `getComputedStyle` can resolve the
 *  real, cascaded value for each cell. A plain `DOMParser` document (used by
 *  an earlier version of this function) is never part of a rendered tree,
 *  so `getComputedStyle` on its elements doesn't reflect the payload's own
 *  `<style>` block at all — only inline `style=""` attributes, which is why
 *  the previous implementation worked for Excel/Sheets (inline styles) but
 *  not LibreOffice (class + stylesheet). */
export function parseHtmlClipboardGrid(html: string): HtmlClipboardGrid | null {
  if (!/<table[\s>]/i.test(html)) return null

  // The payload comes from whatever app filled the clipboard, so it is first
  // parsed inert (DOMParser runs no script, loads nothing) and only the first
  // <table> plus <style> blocks, stripped to layout tags/attributes, are
  // rendered — no img/iframe/svg or on* handlers ever reach the live tree.
  const parsed = sanitizeClipboardTable(html)
  if (!parsed) return null

  const host = document.createElement('div')
  host.style.cssText = 'position:fixed; left:-99999px; top:-99999px; visibility:hidden;'
  document.body.appendChild(host)
  try {
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.append(...parsed.styles, parsed.table)
    const table = parsed.table

    // Unstyled reference point, evaluated in the SAME shadow (so any
    // table-wide, non-per-cell rule in the payload's <style> block applies
    // equally to both) but outside the copied <table> itself.
    const baselineTd = document.createElement('td')
    const baselineTable = document.createElement('table')
    baselineTable.append(document.createElement('tbody'))
    baselineTable.querySelector('tbody')?.append(document.createElement('tr'))
    baselineTable.querySelector('tr')?.append(baselineTd)
    shadow.appendChild(baselineTable)
    const baseline = getComputedStyle(baselineTd)

    const cells: { format?: CellFormat }[][] = []
    let cols = 0
    for (const tr of Array.from(table.querySelectorAll('tr'))) {
      const tds = Array.from(tr.querySelectorAll('td, th'))
      if (tds.length === 0) continue
      const row = tds.map(td => ({
        format: styleToCellFormat(getComputedStyle(td as HTMLElement), baseline)
      }))
      cols = Math.max(cols, row.length)
      cells.push(row)
    }
    if (cells.length === 0) return null
    return { rows: cells.length, cols, cells }
  } catch {
    return null
  } finally {
    host.remove()
  }
}
