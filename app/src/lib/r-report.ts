// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * r-report.ts — the R script editor's lightweight report format (Faz T3 P2).
 *
 * The script stays a plain .R file, written the knitr::spin way, so it runs
 * as-is anywhere and knitr can render it too:
 *   #' prose          → text (Markdown subset: # headings, paragraphs, - / 1.
 *                       lists, `code`, **bold**, *italic*)
 *   # %% Title        → a new chunk (VS Code / Jupyter cell marker), the title
 *                       as a heading
 *   # Title ----      → a new chunk (RStudio section), the title as a heading
 *   #+ options        → a new chunk (knitr chunk options; ignored)
 *   anything else     → R code, run chunk by chunk in the live session
 *
 * This file is pure (no React, no IPC): parsing, inline Markdown and the
 * self-contained HTML export. Running the chunks lives in RConsole.
 *
 * R Markdown / Quarto (.Rmd / .qmd, 2026-10-21) is read too — see parseRmd:
 * YAML `title:`, ```{r} chunks with eval / echo / include (header options or
 * Quarto `#|` lines), Markdown between them. Not supported: inline `r expr`
 * (shown as code), other engines (shown, not run), params, child documents.
 */

export interface ChunkOptions {
  /** false: show the code, do not run it. */
  eval: boolean
  /** false: run it, leave the code out of the report. */
  echo: boolean
  /** false: run it, leave everything out of the report. */
  include: boolean
}

export type ReportPart =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'code'; code: string; opts?: ChunkOptions }

const PROSE = /^#'\s?(.*)$/
const CELL = /^#\s*%%\s*(.*)$/
const SECTION = /^#\s*(.*?)\s*(?:-{4,}|={4,}|#{4,})\s*$/
const CHUNK_OPTS = /^#\+/
const MD_HEADING = /^(#{1,6})\s+(.*)$/

export function parseRReport(source: string): ReportPart[] {
  const parts: ReportPart[] = []
  let code: string[] = []
  let prose: string[] = []

  const flushCode = () => {
    // Blank lines around a chunk are layout, not code.
    while (code.length > 0 && (code[0] ?? '').trim() === '') code.shift()
    while (code.length > 0 && (code[code.length - 1] ?? '').trim() === '') code.pop()
    if (code.length > 0) parts.push({ kind: 'code', code: code.join('\n') })
    code = []
  }
  const flushProse = () => {
    const text = prose.join('\n').trim()
    if (text !== '') parts.push({ kind: 'text', text })
    prose = []
  }
  const heading = (text: string, level: number) => {
    if (text.trim() !== '') parts.push({ kind: 'heading', level, text: text.trim() })
  }

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const p = PROSE.exec(raw)
    if (p) {
      flushCode()
      const body = p[1] ?? ''
      const h = MD_HEADING.exec(body)
      if (h) {
        flushProse()
        heading(h[2] ?? '', (h[1] ?? '#').length)
      } else if (body.trim() === '') {
        flushProse() // blank prose line = paragraph break
      } else {
        prose.push(body)
      }
      continue
    }
    const cell = CELL.exec(raw) ?? SECTION.exec(raw)
    if (cell || CHUNK_OPTS.test(raw)) {
      flushProse()
      flushCode()
      if (cell) heading(cell[1] ?? '', 2)
      continue
    }
    if (prose.length > 0 && raw.trim() === '') continue // gap after prose
    flushProse()
    code.push(raw)
  }
  flushProse()
  flushCode()
  return parts
}

// ── R Markdown / Quarto ─────────────────────────────────────────────────────

const FENCE_OPEN = /^\s*(`{3,})\s*\{\s*([A-Za-z0-9_]+)\b([^}]*)\}\s*$/
const FENCE_CLOSE = /^\s*(`{3,})\s*$/
const QUARTO_OPT = /^\s*#\|\s*([A-Za-z.]+)\s*:\s*(.*?)\s*$/

/** A .Rmd / .qmd file — by name, or by an ```{r} chunk in the text. */
export function isRMarkdown(name: string, source: string): boolean {
  return /\.(rmd|qmd)$/i.test(name) || /^\s*```+\s*\{r\b/im.test(source)
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  const v = value
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase()
  if (v === 'false' || v === 'f') return false
  if (v === 'true' || v === 't') return true
  return fallback
}

/** `{r label, echo=FALSE, eval = F}` → options; unknown ones are ignored. */
function headerOptions(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const piece of header.split(',')) {
    const m = /^\s*([A-Za-z.]+)\s*=\s*(.+?)\s*$/.exec(piece)
    if (m) out[(m[1] as string).toLowerCase()] = m[2] as string
  }
  return out
}

/** YAML front matter `title:` (quoted or not), if any. */
function yamlTitle(lines: string[]): { title: string | null; bodyStart: number } {
  if ((lines[0] ?? '').trim() !== '---') return { title: null, bodyStart: 0 }
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l))
  if (end < 0) return { title: null, bodyStart: 0 }
  const t = lines.slice(1, end).find(l => /^title\s*:/.test(l))
  const title = t
    ? t
        .replace(/^title\s*:\s*/, '')
        .replace(/^["']|["']$/g, '')
        .trim()
    : null
  return { title: title || null, bodyStart: end + 1 }
}

/**
 * An R Markdown / Quarto document as report parts. Markdown `#` headings
 * become headings, other text paragraphs; ```{r} chunks become code with
 * their eval / echo / include options. A chunk in another engine is shown
 * but not run (eval = false).
 */
export function parseRmd(source: string): { title: string | null; parts: ReportPart[] } {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const { title, bodyStart } = yamlTitle(lines)
  const parts: ReportPart[] = []
  let prose: string[] = []
  const flushProse = () => {
    const text = prose.join('\n').trim()
    if (text !== '') parts.push({ kind: 'text', text })
    prose = []
  }

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i] as string
    const open = FENCE_OPEN.exec(line)
    if (open) {
      flushProse()
      const ticks = (open[1] as string).length
      const isR = (open[2] as string).toLowerCase() === 'r'
      const opts = headerOptions(open[3] ?? '')
      const code: string[] = []
      let j = i + 1
      for (; j < lines.length; j++) {
        const close = FENCE_CLOSE.exec(lines[j] as string)
        if (close && (close[1] as string).length >= ticks) break
        const q = QUARTO_OPT.exec(lines[j] as string)
        if (q && code.length === 0) {
          opts[(q[1] as string).toLowerCase()] = q[2] as string
          continue
        }
        code.push(lines[j] as string)
      }
      i = j
      while (code.length > 0 && (code[code.length - 1] ?? '').trim() === '') code.pop()
      if (code.length > 0) {
        parts.push({
          kind: 'code',
          code: code.join('\n'),
          opts: {
            eval: isR && flag(opts['eval'], true),
            echo: flag(opts['echo'], true),
            include: flag(opts['include'], true)
          }
        })
      }
      continue
    }
    const h = MD_HEADING.exec(line)
    if (h) {
      flushProse()
      parts.push({ kind: 'heading', level: (h[1] as string).length, text: (h[2] as string).trim() })
      continue
    }
    if (line.trim() === '') {
      flushProse() // blank line = paragraph break
      continue
    }
    prose.push(line)
  }
  flushProse()
  return { title, parts }
}

/**
 * The document with everything that is not runnable R code blanked to spaces
 * — same length, same line breaks, so caret offsets keep meaning. The editor's
 * Run line / Run all work on this text unchanged and so only ever send code
 * from R chunks that are evaluated.
 */
export function rmdRunnableText(source: string): string {
  const lines = source.split('\n')
  const keep = new Array<boolean>(lines.length).fill(false)
  const { bodyStart } = yamlTitle(lines.map(l => l.replace(/\r$/, '')))
  for (let i = bodyStart; i < lines.length; i++) {
    const open = FENCE_OPEN.exec((lines[i] as string).replace(/\r$/, ''))
    if (!open) continue
    const ticks = (open[1] as string).length
    let evaluate =
      (open[2] as string).toLowerCase() === 'r' && flag(headerOptions(open[3] ?? '')['eval'], true)
    let j = i + 1
    const body: number[] = []
    for (; j < lines.length; j++) {
      const l = (lines[j] as string).replace(/\r$/, '')
      const close = FENCE_CLOSE.exec(l)
      if (close && (close[1] as string).length >= ticks) break
      const q = QUARTO_OPT.exec(l)
      if (q && body.length === 0 && (q[1] as string).toLowerCase() === 'eval') {
        evaluate = flag(q[2], true)
      }
      if (!q) body.push(j)
    }
    if (evaluate) for (const k of body) keep[k] = true
    i = j
  }
  return lines.map((l, i) => (keep[i] ? l : l.replace(/[^\r]/g, ' '))).join('\n')
}

// ── Markdown subset ─────────────────────────────────────────────────────────

/** A paragraph's blocks: plain paragraphs and lists (one level). */
export type MdBlock = { kind: 'p'; text: string } | { kind: 'ul' | 'ol'; items: string[] }

const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/

export function mdBlocks(text: string): MdBlock[] {
  const out: MdBlock[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length > 0) out.push({ kind: 'p', text: para.join(' ') })
    para = []
  }
  for (const line of text.split('\n')) {
    const b = BULLET.exec(line)
    const n = b ? null : NUMBERED.exec(line)
    const item = b?.[1] ?? n?.[1]
    if (item !== undefined) {
      flush()
      const kind = b ? 'ul' : 'ol'
      const last = out[out.length - 1]
      if (last && last.kind === kind) last.items.push(item)
      else out.push({ kind, items: [item] })
    } else if (line.trim() !== '') {
      // A continuation line of a list item stays in that item.
      const last = out[out.length - 1]
      if (para.length === 0 && last && last.kind !== 'p') {
        const i = last.items.length - 1
        last.items[i] = `${last.items[i] ?? ''} ${line.trim()}`
      } else {
        para.push(line.trim())
      }
    }
  }
  flush()
  return out
}

export type InlineSpan = { kind: 'text' | 'code' | 'bold' | 'italic'; text: string }

/** `code`, **bold**, *italic* / _italic_ — no nesting, no links/HTML. */
export function mdInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|\b_([^_\s][^_]*)_\b/g
  let last = 0
  for (const m of text.matchAll(re)) {
    const at = m.index
    if (at > last) spans.push({ kind: 'text', text: text.slice(last, at) })
    if (m[1] !== undefined) spans.push({ kind: 'code', text: m[1] })
    else if (m[2] !== undefined || m[3] !== undefined)
      spans.push({ kind: 'bold', text: m[2] ?? m[3] ?? '' })
    else spans.push({ kind: 'italic', text: m[4] ?? m[5] ?? '' })
    last = at + m[0].length
  }
  if (last < text.length) spans.push({ kind: 'text', text: text.slice(last) })
  return spans
}

// ── Report document (after running) ─────────────────────────────────────────

export interface ReportTable {
  title?: string
  columns: string[]
  rows: (string | number | null)[][]
}

export type ReportItem =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'text'; text: string }
  | {
      kind: 'code'
      code: string
      /** R Markdown `echo = FALSE`: the code itself is left out. */
      hideCode?: boolean
      /** Console text the chunk printed (stdout + messages/errors), ANSI-free. */
      output: string
      /** True when the chunk's output contains an R error. */
      error: boolean
      plots: string[] // base64 PNG
      tables: ReportTable[]
    }

export interface RReport {
  title: string
  createdAt: string
  datasetName: string
  items: ReportItem[]
  /** Chunks not run because the session stopped (or the user stopped it). */
  incomplete: boolean
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inlineHtml(text: string): string {
  return mdInline(text)
    .map(s =>
      s.kind === 'code'
        ? `<code>${esc(s.text)}</code>`
        : s.kind === 'bold'
          ? `<strong>${esc(s.text)}</strong>`
          : s.kind === 'italic'
            ? `<em>${esc(s.text)}</em>`
            : esc(s.text)
    )
    .join('')
}

function cellHtml(v: string | number | null): string {
  if (v === null) return '<td></td>'
  return typeof v === 'number' ? `<td class="num">${esc(String(v))}</td>` : `<td>${esc(v)}</td>`
}

// A standalone file opened outside the app — theme tokens don't exist there,
// so (like output-export.ts) the export carries its own fixed colours.
const REPORT_CSS = `
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 52rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; line-height: 1.5; }
  h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.25rem; margin-top: 2rem; } h3, h4, h5, h6 { font-size: 1.05rem; margin-top: 1.5rem; }
  .meta { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
  pre { font-family: Consolas, "Courier New", monospace; font-size: 0.82rem; white-space: pre-wrap; padding: 8px 12px; border-radius: 4px; margin: 0.5rem 0; }
  pre.code { background: #f5f5f5; border-left: 3px solid #999; }
  pre.out { border: 1px solid #ddd; }
  pre.out.err { border-color: #d33; }
  code { font-family: Consolas, "Courier New", monospace; background: #f0f0f0; padding: 0 3px; border-radius: 3px; }
  img { max-width: 100%; height: auto; border: 1px solid #ddd; margin: 0.5rem 0; }
  table { border-collapse: collapse; margin: 0.5rem 0 1rem; }
  th, td { border: 1px solid #ccc; padding: 3px 8px; font-size: 0.85rem; }
  th { background: #f0f0f0; text-align: left; } td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .caption { font-weight: 600; margin-top: 0.75rem; }
  .incomplete { color: #9a6700; }
`

export interface ReportLabels {
  generated: string
  incomplete: string
}

/** The report as one self-contained HTML file (plots inlined). */
export function buildReportHtml(report: RReport, labels: ReportLabels): string {
  const body = report.items
    .map(item => {
      if (item.kind === 'heading') {
        const level = Math.min(6, item.level + 1) // the report title is the h1
        return `<h${String(level)}>${inlineHtml(item.text)}</h${String(level)}>`
      }
      if (item.kind === 'text') {
        return mdBlocks(item.text)
          .map(b =>
            b.kind === 'p'
              ? `<p>${inlineHtml(b.text)}</p>`
              : `<${b.kind}>${b.items.map(i => `<li>${inlineHtml(i)}</li>`).join('')}</${b.kind}>`
          )
          .join('\n')
      }
      const parts = item.hideCode ? [] : [`<pre class="code">${esc(item.code)}</pre>`]
      if (item.output !== '') {
        parts.push(`<pre class="out${item.error ? ' err' : ''}">${esc(item.output)}</pre>`)
      }
      for (const tbl of item.tables) {
        if (tbl.title) parts.push(`<div class="caption">${esc(tbl.title)}</div>`)
        parts.push(
          `<table><thead><tr>${tbl.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>` +
            `<tbody>${tbl.rows.map(r => `<tr>${r.map(cellHtml).join('')}</tr>`).join('')}</tbody></table>`
        )
      }
      for (const png of item.plots) {
        // base64 only ([A-Za-z0-9+/=]) — guaranteed by the session (Buffer.toString).
        parts.push(
          `<img alt="" src="data:image/png;base64,${png.replace(/[^A-Za-z0-9+/=]/g, '')}" />`
        )
      }
      return parts.join('\n')
    })
    .join('\n')
  const meta = [labels.generated, report.datasetName].filter(s => s !== '').join(' · ')
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(report.title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<h1>${esc(report.title)}</h1>
<div class="meta">${esc(meta)}</div>
${body}
${report.incomplete ? `<p class="incomplete">${esc(labels.incomplete)}</p>` : ''}
</body>
</html>`
}
