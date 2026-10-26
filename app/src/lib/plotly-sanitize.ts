// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only

// Plotly renders a subset of HTML in every text field (titles, axis labels,
// legend names, annotations, hover text), including clickable <a> links and
// <span style>. Variable/value labels come from data files we did not write,
// so only plain formatting tags survive; every other tag is dropped (its inner
// text stays).
const ALLOWED_TAG = /^<\/?(?:br|b|i|em|strong|sub|sup|s)\s*\/?>$/i

export function sanitizePlotlyText(text: string): string {
  if (!text.includes('<')) return text
  return text.replace(/<[^>]*>?/g, tag => (ALLOWED_TAG.test(tag) ? tag : ''))
}

/** Deep copy of a Plotly figure part with every string passed through sanitizePlotlyText. */
export function sanitizePlotlyFigure<T>(value: T): T {
  if (typeof value === 'string') return sanitizePlotlyText(value) as T
  if (Array.isArray(value)) {
    const items = value as unknown[]
    // Numeric series can be huge and carry no text — skip the copy.
    if (typeof items[0] === 'number') return value
    return items.map(v => sanitizePlotlyFigure(v)) as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizePlotlyFigure(v)
    }
    return out as T
  }
  return value
}
