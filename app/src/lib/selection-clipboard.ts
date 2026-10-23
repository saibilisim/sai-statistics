// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * selection-clipboard.ts — turns the browser's own free mouse-drag text
 * selection inside the Output content pane into clipboard-ready {html, text}
 * payloads. Backs TWO triggers that both need the SAME result:
 *   - the native 'copy' event (Ctrl+C / Edit ▸ Copy), see OutputView.tsx
 *   - a "Copy Selection" context-menu item — our own custom right-click
 *     menus replace the browser's native one, so without this a selection
 *     spanning free text (outside any table) would have no right-click way
 *     to be copied at all.
 *
 * Multiple sibling <table> elements in HTML clipboard data get truncated to
 * just the FIRST one by Excel/Sheets/LibreOffice Calc on paste (see
 * output-clipboard.ts's doc comment for the identical issue on the
 * navigator's own copy path) — so every <table> found in the selection is
 * folded into ONE shared <table>, with any non-table text turned into a
 * colspan-spanning row in selection order.
 */

import { clipboardSpacerRowHtml, clipboardWideRowHtml } from './output-clipboard-html'

export interface SelectionClipboardPayload {
  html: string
  text: string
}

type ClipPart = { kind: 'table'; el: HTMLTableElement } | { kind: 'text'; text: string }

/** Elements that start a new line of text. Everything else (span, sub, sup,
 *  b, em, a …) is inline and its text is concatenated into the current line —
 *  previously every TEXT NODE became its own line, so a note like
 *  "under H<sub>0</sub> (area = 0.5)" pasted as three broken lines. Tag-based
 *  (not getComputedStyle) because the walked nodes are a detached clone. */
const BLOCK_TAGS = new Set([
  'DIV',
  'P',
  'LI',
  'UL',
  'OL',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'PRE',
  'BLOCKQUOTE',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'DETAILS',
  'SUMMARY'
])

/** UI chrome that is never part of the copied content: plot SVGs (Plotly
 *  axis tick labels are real text nodes), toolbar/action buttons, inputs. */
const SKIP_TAGS = new Set([
  'svg',
  'SVG',
  'BUTTON',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'SCRIPT',
  'STYLE'
])

function collectParts(root: ParentNode): ClipPart[] {
  const parts: ClipPart[] = []
  let line = ''
  function flush() {
    const text = line.replace(/\s+/g, ' ').trim()
    if (text) parts.push({ kind: 'text', text })
    line = ''
  }
  function walk(node: ChildNode) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (SKIP_TAGS.has(el.tagName)) return
      if (el.tagName === 'TABLE') {
        flush()
        parts.push({ kind: 'table', el: el as HTMLTableElement })
        return
      }
      if (el.tagName === 'BR') {
        flush()
        return
      }
      const block = BLOCK_TAGS.has(el.tagName)
      if (block) flush()
      el.childNodes.forEach(walk)
      if (block) flush()
      return
    }
    if (node.nodeType === Node.TEXT_NODE) line += node.textContent ?? ''
  }
  root.childNodes.forEach(walk)
  flush()
  return parts
}

/** Build a clipboard payload from an arbitrary DOM Range. The range is only
 *  ever cloned (`cloneContents()`) — the live DOM/selection is never
 *  touched — so this is equally safe to call from a live 'copy' event or a
 *  context-menu click made well after the selection was made. */
export function buildSelectionClipboard(range: Range): SelectionClipboardPayload {
  const container = document.createElement('div')
  container.appendChild(range.cloneContents())
  const parts = collectParts(container)

  const textLines: string[] = []
  const rowGroups: string[] = []
  parts.forEach(part => {
    if (part.kind === 'table') {
      const trs = Array.from(part.el.querySelectorAll('tr'))
      rowGroups.push(trs.map(tr => tr.outerHTML).join(''))
      textLines.push(
        ...trs.map(tr =>
          Array.from(tr.children)
            .map(c => c.textContent.trim())
            .join('\t')
        )
      )
    } else {
      rowGroups.push(clipboardWideRowHtml(part.text))
      textLines.push(part.text)
    }
  })

  const html = `<table style="border-collapse:collapse">${rowGroups
    .map((rows, i) => (i > 0 ? clipboardSpacerRowHtml() + rows : rows))
    .join('')}</table>`
  return { html, text: textLines.join('\n') }
}

/** Gives every <table> under `root` explicit inline borders + cell padding.
 *  Once app classes are stripped, a bare <table> pastes into Word/Outlook/
 *  Docs with zero cell spacing and no borders, so adjacent columns run into
 *  each other ("Ham p.186" …). Inline styles are the only thing those editors
 *  honour; colors are neutral print colors, not theme tokens, on purpose —
 *  the pasted document is not themed. Numeric columns (`data-numeric`, set
 *  by MarkdownText) stay right-aligned. Call AFTER stripping style attrs. */
export function styleTablesForClipboard(root: ParentNode): void {
  root.querySelectorAll('table').forEach(table => {
    table.setAttribute('style', 'border-collapse:collapse')
  })
  root.querySelectorAll('th, td').forEach(cell => {
    const align = cell.getAttribute('data-numeric') === 'true' ? 'right' : 'left'
    const weight = cell.tagName === 'TH' ? ';font-weight:bold' : ''
    cell.setAttribute(
      'style',
      `border:1px solid #bfbfbf;padding:2px 8px;text-align:${align}${weight}`
    )
    cell.removeAttribute('data-numeric')
  })
}

/** Clipboard payload for a free selection over rich prose (AI chat markdown:
 *  paragraphs, lists, headings, tables). Unlike buildSelectionClipboard it
 *  keeps the document structure instead of folding everything into one
 *  <table>. Text comes from Selection.toString(), which Chromium serializes
 *  layout-aware (block → newline, table cell → tab); the HTML is the selected
 *  markup stripped of app classes/inline theme styles (which otherwise paste
 *  into Word as dark-theme colors) and of UI chrome such as action buttons. */
export function buildProseSelectionClipboard(sel: Selection): SelectionClipboardPayload | null {
  if (sel.rangeCount === 0 || sel.isCollapsed) return null
  const container = document.createElement('div')
  container.appendChild(sel.getRangeAt(0).cloneContents())
  container.querySelectorAll('button, svg, input, textarea, select').forEach(el => {
    el.remove()
  })
  container.querySelectorAll('*').forEach(el => {
    el.removeAttribute('class')
    el.removeAttribute('style')
    el.removeAttribute('id')
  })
  styleTablesForClipboard(container)
  const text = sel
    .toString()
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!text) return null
  return { html: container.innerHTML, text }
}

/** The current window selection's Range, but only when it is non-collapsed
 *  AND fully inside `container` — a stale/foreign selection (left over from
 *  clicking somewhere else) must never silently get copied instead of
 *  whatever the user is actually pointing at right now. */
export function getActiveSelectionRange(container: HTMLElement): Range | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null
  }
  return range
}

/** True when the page has a non-collapsed text selection that is NOT inside
 *  `container` — e.g. text selected in the AI chat panel next to Output. A
 *  view-level Ctrl+C shortcut must stand aside then, or it copies its own
 *  (stale) selection instead of what the user just highlighted. */
export function hasForeignSelection(container: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false
  const range = sel.getRangeAt(0)
  return !container.contains(range.startContainer) || !container.contains(range.endContainer)
}

/** True when the active selection's Range is confined entirely to `el` —
 *  used to decide whether a table's own right-click menu needs an extra
 *  "copy everything selected" item, or whether its usual "Copy Table"/"Copy
 *  Selection" items already cover exactly what's selected. */
export function selectionIsConfinedTo(range: Range, el: HTMLElement): boolean {
  return el.contains(range.startContainer) && el.contains(range.endContainer)
}
