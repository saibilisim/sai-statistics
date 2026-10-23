// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { Variable } from '../data-types'
import type { Statement } from './types'

// ─── Parsing (pure — no window/store access, safe for Main or Renderer) ────

/**
 * Splits `text` on top-level occurrences of a single-character separator,
 * skipping anything inside single or double quotes. Prevents a quoted value
 * containing the separator (e.g. `'Active/Inactive'` for `/`-subcommands, or
 * `'Done.'` for the statement-terminating `.`) from being mistaken for a
 * delimiter — SPSS strings can contain both.
 *
 * When `requireBoundaryAfter` is set, a separator only counts as a delimiter
 * if followed by whitespace or end-of-string (used for the statement `.`,
 * so `0.5` isn't split on its decimal point).
 */
export function splitTopLevel(text: string, sep: string, requireBoundaryAfter = false): string[] {
  const parts: string[] = []
  let cur = ''
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string
    if (ch === '\n') {
      // SPSS string literals never span lines, so an apostrophe that never
      // gets a partner must not leave the scanner in "inside a string" mode
      // for the rest of the file. Without this, one `don't` swallowed every
      // command after it — silently, because the resulting mega-chunk began
      // with the comment's `*` and was filtered out as a comment.
      quote = null
      cur += ch
      continue
    }
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      cur += ch
      continue
    }
    if (ch === sep) {
      if (requireBoundaryAfter) {
        const next = text[i + 1]
        if (next !== undefined && !/\s/.test(next)) {
          cur += ch
          continue
        }
      }
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return parts
}

/**
 * Split raw syntax into statements. SPSS terminates a command with a `.` at a
 * line end or before whitespace; the boundary check avoids splitting decimals
 * (e.g. `0.5`) and the quote-awareness of {@link splitTopLevel} avoids
 * splitting inside a quoted value that itself ends in `.` (e.g. a VALUE
 * LABELS label `'Tamamlandı.'` followed by a space).
 */
export function splitStatements(text: string): string[] {
  // Strip Markdown code-fence lines (``` or ```spss) so syntax pasted from an
  // AI chat reply — which wraps code in fences — doesn't surface as an
  // "Unrecognized command" statement or get merged into an adjacent one.
  const withoutFences = text
    .split('\n')
    .filter(line => !/^\s*```/.test(line))
    .join('\n')
  return splitTopLevel(stripComments(withoutFences), '.', true)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('*'))
}

/**
 * Remove SPSS comments before anything else looks at the text.
 *
 * A `*` comment is a COMMAND: it runs to the terminating `.`, which may be
 * several lines down. Filtering statements that merely *start* with `*` (the
 * previous approach) is not the same thing — a comment containing a sentence
 * ending in `.` is split into pieces, and every piece after the first no
 * longer starts with `*`, so it surfaced as an "Unrecognized command" line.
 * Real SPSS syntax files are full of these; job.sps produced
 * `DOT also makes` as a bogus statement.
 *
 * Comments are also the one place apostrophes appear as punctuation rather
 * than as string delimiters ("SPSS's", "don't"), which is why they have to go
 * before the quote-aware splitter runs. `/ * … * /` inline comments go too.
 */
function stripComments(text: string): string {
  const out: string[] = []
  let inComment = false
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!inComment && trimmed.startsWith('*')) {
      // Ends on this line only if the line itself carries the terminator.
      if (!/\.\s*$/.test(trimmed)) inComment = true
      out.push('')
      continue
    }
    if (inComment) {
      if (/\.\s*$/.test(trimmed)) inComment = false
      out.push('')
      continue
    }
    out.push(line.replace(/\/\*[^]*?\*\//g, ' '))
  }
  return out.join('\n')
}

/**
 * Parses the leading command keyword off a raw statement. `commandNames`
 * must be sorted longest (most words) first so multi-word commands match
 * before their single-word prefixes (e.g. "NPAR TESTS" before a bare "NPAR").
 * Callers pass whatever command set is relevant to them — the Renderer's
 * full combined list, or (from Main) just `ANALYSIS_COMMAND_NAMES`.
 */
export function parseStatement(raw: string, commandNames: string[]): Statement {
  const exact = matchCommand(raw, commandNames)
  if (exact) return exact
  // SPSS accepts a command's first word truncated to 3+ letters when that is
  // unambiguous (FREQ, DESC, CORR, CROSS, VAR LABELS) — pasted logs use them.
  const first = /^[A-Za-z]+/.exec(raw)?.[0].toUpperCase() ?? ''
  if (first.length >= 3) {
    const words = new Set(
      commandNames.map(n => n.split(' ')[0] as string).filter(w => w.startsWith(first))
    )
    if (words.size === 1) {
      const st = matchCommand(`${[...words][0] as string}${raw.slice(first.length)}`, commandNames)
      if (st) return { ...st, raw }
    }
  }
  // Unrecognised: keep the bare first word so we can report it specifically.
  const firstWord = raw.toUpperCase().split(/\s+/)[0] ?? ''
  return { command: firstWord, body: raw, raw }
}

function matchCommand(raw: string, commandNames: string[]): Statement | null {
  const upper = raw.toUpperCase()
  for (const name of commandNames) {
    // Any whitespace counts as the separator, not just a space: a multi-word
    // command whose body starts on the next line ("NPAR TESTS\n  /M-W= …")
    // used to fall through here and come back as the bare first word "NPAR".
    if (upper === name || (upper.startsWith(name) && /[\s=]/.test(upper.charAt(name.length)))) {
      return { command: name, body: raw.slice(name.length).replace(/^=/, '').trim(), raw }
    }
  }
  return null
}

/** Extract the `VARIABLES=…` list (up to the next `/` subcommand or end). */
export function parseVariablesList(body: string): string[] {
  const m = /VARIABLES\s*=\s*([^/]*)/i.exec(body)
  const list = m?.[1] ?? body // tolerate `FREQUENCIES age sex` without VARIABLES=
  return list
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

/**
 * Split a raw token list on whitespace/commas. Each token has one layer of
 * surrounding quotes stripped, so string group/level codes (e.g.
 * `GROUPS=sex('m','f')`) resolve to their raw value rather than a
 * quote-wrapped one. The SPSS `TO` keyword is kept — {@link resolveVars}
 * expands `a TO d` into every variable from a to d in file order (it used to
 * be dropped, so `score1 TO score4` silently ran on score1 and score4 only).
 */
export function parseList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map(s => stripQuotes(s.trim()))
    .filter(s => s.length > 0)
}

/**
 * The variable-list part of a command that accepts either `VARIABLES=a b c` or
 * a bare leading list (`ONEWAY score income BY grp3`).
 *
 * The bare-list form must still stop at the first subcommand: reading the whole
 * body meant `ONEWAY score BY grp3 /STATISTICS HOMOGENEITY` tried to resolve
 * `/STATISTICS` and `HOMOGENEITY` as variable names and failed the command
 * outright with "unknown variables".
 */
export function variableListPart(body: string, key = 'VARIABLES'): string {
  if (new RegExp(`${key}\\s*=`, 'i').test(body)) return afterEquals(body, key)
  return splitTopLevel(body, '/')[0] ?? body
}

/**
 * Predictors declared on `/METHOD=ENTER a b c`.
 *
 * COXREG and LOGISTIC REGRESSION both accept covariates either as `WITH a b c`
 * or on /METHOD — and SPSS's own dialogs paste the /METHOD form, omitting WITH
 * entirely. Handlers that only looked for WITH rejected the syntax SPSS itself
 * produces.
 */
export function methodVarList(body: string): string[] {
  const m = /\/METHOD\s*=?\s*(?:ENTER|FSTEP|BSTEP|REMOVE)?\s*([^/]*)/i.exec(body)
  return m ? parseList(m[1] as string) : []
}

/** Grab the value after `KEY=` up to the next top-level `/` subcommand (or end). */
export function afterEquals(body: string, key: string): string {
  const m = new RegExp(`${key}\\s*=\\s*([^]*)`, 'i').exec(body)
  const tail = m?.[1] ?? body
  return splitTopLevel(tail, '/')[0] ?? tail
}

/**
 * Grab the values of a subcommand after `/KEY=` up to the next top-level `/`
 * subcommand (or end). Returns null if not present. Only the match position
 * comes from a regex — the value itself is sliced out via {@link splitTopLevel}
 * so a quoted value containing `/` (e.g. a label `'Active/Inactive'`) isn't
 * mistaken for the next subcommand.
 */
export function parseSubcommand(body: string, key: string): string[] | null {
  const m = new RegExp(`\\/${key}(?:\\s*=\\s*|\\s+)`, 'i').exec(body)
  if (!m) return null
  const tail = body.slice(m.index + m[0].length)
  const captured = splitTopLevel(tail, '/')[0] ?? tail
  return captured
    .trim()
    .toUpperCase()
    .split(/[\s,]+/)
    .filter(Boolean)
}

/**
 * `/MISSING=LISTWISE|ANALYSIS|PAIRWISE` — the missing-values strategy shared
 * by T-TEST, ONEWAY, MEANS, CORRELATIONS, EXAMINE and NPAR TESTS. Returns
 * 'listwise' only for LISTWISE; ANALYSIS/PAIRWISE are the procedures' own
 * defaults and add no key, matching what the dialogs send (their payload
 * normalizes to the same thing). Used to go silently undigested — a pasted
 * `/MISSING=LISTWISE` ran analysis-wise with a success message.
 */
export function parseMissingStrategy(body: string): 'listwise' | undefined {
  const words = parseSubcommand(body, 'MISSING')
  return words?.includes('LISTWISE') ? 'listwise' : undefined
}

/** Split a list expression around the SPSS `BY` keyword. */
export function splitOnBy(s: string): { left: string[]; right: string[] } {
  const parts = s.split(/\bBY\b/i)
  return { left: parseList(parts[0] ?? ''), right: parseList(parts[1] ?? '') }
}

/** Split a list expression around the SPSS `WITH` keyword (paired t-test). */
export function splitOnWith(s: string): { left: string[]; right: string[] } {
  const parts = s.split(/\bWITH\b/i)
  return { left: parseList(parts[0] ?? ''), right: parseList(parts[1] ?? '') }
}

/** Strip SPSS `(min,max)`-style range specs, e.g. "REGION(1,9)" → "REGION". */
export function stripRanges(s: string): string {
  return s.replace(/\([^)]*\)/g, ' ')
}

/** Strip a single layer of surrounding quotes from an SPSS token. */
export function stripQuotes(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && ((t[0] === "'" && t.endsWith("'")) || (t[0] === '"' && t.endsWith('"')))) {
    return t.slice(1, -1)
  }
  return t
}

/** Resolve names → Variable[]; unknown names are collected separately. */
export function resolveVars(
  names: string[],
  variables: Variable[]
): { resolved: Variable[]; unknown: string[] } {
  const byName = new Map(variables.map(v => [v.name.toLowerCase(), v]))
  const resolved: Variable[] = []
  const unknown: string[] = []
  for (let i = 0; i < names.length; i++) {
    const n = names[i] as string
    if (n.toUpperCase() === 'TO') {
      // `a TO d`: every variable after a, through d, in file order.
      const from = byName.get((names[i - 1] ?? '').toLowerCase())
      const to = byName.get((names[i + 1] ?? '').toLowerCase())
      if (!from || !to) {
        // An unknown bound is reported on its own; a dangling TO is not a variable.
        if (i === 0 || i === names.length - 1) unknown.push(n)
        continue
      }
      const a = variables.indexOf(from)
      const b = variables.indexOf(to)
      if (b < a) {
        unknown.push(`${from.name} TO ${to.name}`)
        i++
        continue
      }
      resolved.push(...variables.slice(a + 1, b + 1))
      i++
      continue
    }
    const v = byName.get(n.toLowerCase())
    if (v) resolved.push(v)
    else unknown.push(n)
  }
  return { resolved, unknown }
}
