// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * output-resolve.ts — single source of truth for turning an OutputTable +
 * its user edits into presentation-ready rows.
 *
 * Previously this logic was duplicated between OutputView.tsx (screen
 * render + TSV copy) and output-export.ts (HTML export), which would have
 * tripled once per-table editing (hidden rows/cols, transpose, cell
 * overrides, per-table decimals) landed. Every consumer now calls
 * resolveTable() and only deals with ResolvedCell[][].
 */

import type { TFunction } from 'i18next'
import type { OutputTable } from '@shared/analysis-types'
import type { TableEdits } from '@shared/output-document'
import {
  MISSING_MARKER,
  formatStatValue,
  type DecimalSeparator,
  isSignificanceColumn,
  rowIsSignificance,
  translateOutputKey
} from './output-format'

export interface ResolvedCell {
  text: string
  /** Cell alignment — text labels left, numeric/missing right. */
  align: 'txt' | 'num'
  isSig: boolean
  /** Significance tier for styling, derived from the numeric value. */
  sigLevel: 'none' | 'sig' | 'vsig'
  /** Position in the ORIGINAL (untransposed, nothing-hidden) table grid —
   *  callers (bulk hide-rows/hide-cols) must map back to these, never to the
   *  cell's on-screen row/col, since those shift once rows/cols are hidden
   *  or the table is transposed. -1 marks a synthetic cell (a transposed
   *  row's label) that has no single origin cell. */
  origRow: number
  origCol: number
  /** The unformatted number behind `text` — set only for numeric cells, so
   *  the .xlsx export can write a real number (formatted to the same
   *  decimals) instead of the display string. */
  num?: number
}

export interface ResolvedTable {
  title: string | null
  columns: string[]
  rows: ResolvedCell[][]
  footnotes: string[]
}

const EMPTY_EDITS: TableEdits = {
  hiddenRows: [],
  hiddenCols: [],
  transposed: false,
  footnotes: []
}

/** Resolve one OutputTable against its edits (or none) into display-ready
 *  rows. Order of operations: hide rows/cols on the ORIGINAL grid → transpose
 *  → format/translate. Structural-only overlay (hide/rename/transpose/
 *  decimals) — no per-cell text override or formatting; see output-
 *  document.ts's doc comment for why. */
export function resolveTable(
  table: OutputTable,
  t: TFunction,
  edits: TableEdits = EMPTY_EDITS,
  /** Number format from Preferences. Optional because the export/clipboard
   *  paths have no React context and are happy with output-format's module
   *  state; React callers pass it explicitly so that changing the setting is a
   *  real render dependency rather than an invisible module mutation they
   *  would not re-render for. */
  numberFormat?: { separator: DecimalSeparator; dropLeadingZero: boolean }
): ResolvedTable {
  const hiddenRows = new Set(edits.hiddenRows)
  const hiddenCols = new Set(edits.hiddenCols)

  const visibleColIdx = table.columns.map((_, i) => i).filter(i => !hiddenCols.has(i))
  const visibleRowIdx = table.rows.map((_, i) => i).filter(i => !hiddenRows.has(i))

  const translatedCols = table.columns.map(col => translateOutputKey(col, t))

  function resolveCell(origRow: number, origCol: number): ResolvedCell {
    const row = table.rows[origRow] ?? []
    const raw = row[origCol] ?? null
    const colKey = table.columns[origCol] ?? ''
    const rowSig = rowIsSignificance(row)
    const isSig = rowSig || isSignificanceColumn(colKey)

    let text: string
    if (raw === null) {
      text = MISSING_MARKER
    } else if (typeof raw === 'number') {
      text = formatStatValue(
        raw,
        isSig,
        edits.decimals,
        numberFormat?.separator,
        numberFormat?.dropLeadingZero
      )
    } else if (raw.startsWith('output.')) {
      text = translateOutputKey(raw, t)
    } else {
      text = raw
    }

    const align: 'txt' | 'num' = typeof raw === 'number' || raw === null ? 'num' : 'txt'
    let sigLevel: ResolvedCell['sigLevel'] = 'none'
    if (typeof raw === 'number' && isSig) {
      if (raw < 0.001) sigLevel = 'vsig'
      else if (raw < 0.05) sigLevel = 'sig'
    }

    return {
      text,
      align,
      isSig,
      sigLevel,
      origRow,
      origCol,
      ...(typeof raw === 'number' ? { num: raw } : {})
    }
  }

  let rows: ResolvedCell[][]
  let columns: string[]

  if (edits.transposed) {
    // SPSS-style transpose: the first (label) column becomes the header row,
    // every other original column becomes a body row labeled by its own
    // original column header.
    const labelColIdx = visibleColIdx[0]
    const bodyColIdx = visibleColIdx.slice(1)
    const labelCell = (ri: number): ResolvedCell =>
      labelColIdx === undefined
        ? { text: '', align: 'txt', isSig: false, sigLevel: 'none', origRow: -1, origCol: -1 }
        : resolveCell(ri, labelColIdx)

    columns = ['', ...visibleRowIdx.map(ri => labelCell(ri).text)]
    // Each body row is one original column; its first ("label") cell is
    // synthetic — origRow: -1 (no single source row) but origCol: ci so
    // whole-column hide operations (which key on origCol) still see this
    // cell as belonging to that column's data.
    rows = bodyColIdx.map(ci => [
      {
        text: translatedCols[ci] ?? '',
        align: 'txt',
        isSig: false,
        sigLevel: 'none',
        origRow: -1,
        origCol: ci
      },
      ...visibleRowIdx.map(ri => resolveCell(ri, ci))
    ])
  } else {
    columns = visibleColIdx.map(ci => translatedCols[ci] ?? '')
    rows = visibleRowIdx.map(ri => visibleColIdx.map(ci => resolveCell(ri, ci)))
  }

  const title =
    edits.titleOverride ?? (table.titleKey ? translateOutputKey(table.titleKey, t) : null)
  const footnotes = [
    ...(table.footnoteKey ? [translateOutputKey(table.footnoteKey, t)] : []),
    ...edits.footnotes
  ]

  return { title, columns, rows, footnotes }
}

/**
 * Spreadsheet formula injection: a cell starting with = + - @ TAB CR is
 * evaluated by Excel/LibreOffice. Numbers ("-0.25", "−1,5") are left alone;
 * anything else gets a leading apostrophe.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^[+\u2212-]?\d[\d.,]*(?:[eE][+-]?\d+)?%?$/
function neutraliseFormula(text: string): string {
  return FORMULA_LEAD.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text
}

/** Tab-separated text — pastes cleanly into Excel/Sheets/SPSS. */
export function resolvedTableToTsv(resolved: ResolvedTable): string {
  const lines = [
    resolved.columns.map(neutraliseFormula).join('\t'),
    ...resolved.rows.map(row => row.map(c => neutraliseFormula(c.text)).join('\t'))
  ]
  if (resolved.footnotes.length > 0) lines.push(...resolved.footnotes)
  return lines.join('\n')
}

/** RFC 4180 CSV — commas/quotes/newlines get quoted, embedded quotes doubled. */
function csvCell(raw: string): string {
  const text = neutraliseFormula(raw)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function resolvedTableToCsv(resolved: ResolvedTable): string {
  const lines = [
    resolved.columns.map(csvCell).join(','),
    ...resolved.rows.map(row => row.map(c => csvCell(c.text)).join(','))
  ]
  if (resolved.footnotes.length > 0) lines.push(...resolved.footnotes.map(csvCell))
  return lines.join('\r\n')
}

/** GitHub-flavored Markdown pipe table. Cell text is escaped for `|` and
 *  hard line breaks only — Markdown table cells can't contain either. */
function mdCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

export function resolvedTableToMarkdown(resolved: ResolvedTable): string {
  const lines: string[] = []
  if (resolved.title) lines.push(`**${resolved.title}**`, '')
  if (resolved.columns.length > 0) {
    lines.push(`| ${resolved.columns.map(mdCell).join(' | ')} |`)
    lines.push(`| ${resolved.columns.map(() => '---').join(' | ')} |`)
  }
  for (const row of resolved.rows) {
    lines.push(`| ${row.map(c => mdCell(c.text)).join(' | ')} |`)
  }
  for (const f of resolved.footnotes) lines.push('', `*${f}*`)
  return lines.join('\n')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Real `<table>` markup with inline styles — the text/html clipboard
 *  flavor (Word/LibreOffice/Excel all prefer this over TSV) and the export
 *  HTML builder both call this so table markup is generated exactly once. */
export function resolvedTableToHtml(resolved: ResolvedTable): string {
  const thead =
    resolved.columns.length > 0
      ? `<thead><tr>${resolved.columns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}</tr></thead>`
      : ''
  const rows = resolved.rows
    .map(row => {
      const cells = row
        .map(cell => {
          const alignStyle = cell.align === 'num' ? 'text-align:right' : 'text-align:left'
          return `<td style="${alignStyle}">${escapeHtml(cell.text)}</td>`
        })
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')
  const title = resolved.title
    ? `<div class="table-title" style="font-weight:600">${escapeHtml(resolved.title)}</div>`
    : ''
  const footnotes = resolved.footnotes
    .map(
      f => `<div class="table-footnote" style="color:#666;font-size:0.75rem">${escapeHtml(f)}</div>`
    )
    .join('')
  return `<div class="table-wrapper">${title}<table style="border-collapse:collapse">${thead}<tbody>${rows}</tbody></table>${footnotes}</div>`
}
