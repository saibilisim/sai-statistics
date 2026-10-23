// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * output-clipboard-html.ts — shared low-level HTML-table row builders for the
 * two clipboard code paths that fold several logical tables into ONE
 * <table> (see each caller's own doc comment for why: output-clipboard.ts's
 * navigator Ctrl+C/right-click ▸ Copy on structured OutputTable data, and
 * selection-clipboard.ts's free mouse-drag DOM selection). Kept in one place
 * so the "which colspan is wide enough" number and the escaping rules can't
 * drift between the two.
 */

export const CLIPBOARD_WIDE_COLSPAN = '20'

export function escapeClipboardHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A single row whose one cell spans every column — used for a table's own
 *  title/footnote, or for narrative text (headings, notes, warnings) sitting
 *  between tables in a combined copy. */
export function clipboardWideRowHtml(text: string, bold = false): string {
  const style = bold ? ' style="font-weight:600"' : ''
  return `<tr><td colspan="${CLIPBOARD_WIDE_COLSPAN}"${style}>${escapeClipboardHtml(text)}</td></tr>`
}

/** Blank separator row between two combined logical tables/text blocks. */
export function clipboardSpacerRowHtml(): string {
  return `<tr><td colspan="${CLIPBOARD_WIDE_COLSPAN}">&nbsp;</td></tr>`
}
