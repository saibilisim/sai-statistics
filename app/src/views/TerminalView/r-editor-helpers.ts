// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure helpers for the R script editor: "which lines make up the statement
 * under the caret" (Ctrl+Enter, RStudio-style) and the identifier being typed
 * (completion). No React/DOM. Highlighting reuses `highlightCode(…, 'r')` from
 * lib/code-highlight.ts — the same tokens the AI panel's R blocks use.
 */

function readString(line: string, from: number): number {
  const quote = line[from]
  let i = from + 1
  while (i < line.length) {
    const ch = line[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    i++
  }
  return line.length
}

/** Net bracket depth change of a line, ignoring strings and comments. */
function lineShape(line: string): { depth: number; continues: boolean } {
  let depth = 0
  let i = 0
  let code = ''
  while (i < line.length) {
    const ch = line[i] as string
    if (ch === '#') break
    if (ch === '"' || ch === "'") {
      i = readString(line, i)
      code += '""'
      continue
    }
    if (ch === '`') {
      const close = line.indexOf('`', i + 1)
      i = close === -1 ? line.length : close + 1
      code += 'x'
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    code += ch
    i++
  }
  // A trailing binary operator / comma means the expression goes on.
  const continues = /(?:[+\-*/^,&|~=<>]|<-|\|>|%[^%\s]*%)\s*$/.test(code.trimEnd())
  return { depth, continues }
}

/**
 * For each line of `source`: does a new top-level statement start there?
 * A statement spans lines while brackets are open or a line ends in a binary
 * operator; `else` on its own line joins the preceding `if` block (R's parser
 * would reject it at top level otherwise).
 */
export function statementStarts(source: string): boolean[] {
  let depth = 0
  let continuing = false
  return source.split('\n').map(text => {
    const opensNew = depth <= 0 && !continuing && !/^\s*else\b/.test(text)
    const shape = lineShape(text)
    depth = Math.max(0, depth + shape.depth)
    continuing = shape.continues
    return opensNew
  })
}

/**
 * The [first, last] line range (0-based, inclusive) of the top-level
 * statement containing `lineIdx` — what Ctrl+Enter runs.
 */
export function statementRangeAt(source: string, lineIdx: number): [number, number] {
  const starts = statementStarts(source)
  let first = Math.min(lineIdx, starts.length - 1)
  while (first > 0 && !starts[first]) first--
  let last = lineIdx
  while (last + 1 < starts.length && !starts[last + 1]) last++
  return [first, last]
}

/** Index of the first non-blank, non-comment line after `line`, or -1. */
export function nextCodeLine(source: string, line: number): number {
  const lines = source.split('\n')
  for (let i = line + 1; i < lines.length; i++) {
    const t = (lines[i] ?? '').trim()
    if (t !== '' && !t.startsWith('#')) return i
  }
  return -1
}

/** Offset of the start of 0-based line `line` in `source`. */
export function lineStartOffset(source: string, line: number): number {
  let off = 0
  for (let i = 0; i < line; i++) {
    const nl = source.indexOf('\n', off)
    if (nl === -1) return source.length
    off = nl + 1
  }
  return off
}

/**
 * The identifier being typed at the caret (letters, digits, `.`, `_`, plus
 * `$`/`@`/`::` accessors so `data$ag` completes column names).
 */
export function getRToken(text: string, caret: number): { start: number; value: string } {
  const upto = text.slice(0, caret)
  const m = /(?:[A-Za-z.][A-Za-z0-9._]*(?:\$|@|:::?))*[A-Za-z0-9._]*$/.exec(upto)
  const value = m ? m[0] : ''
  return { start: caret - value.length, value }
}

/** The whole word under/around the caret — the topic F1 looks up. */
export function wordAt(text: string, caret: number): string {
  const left = /[A-Za-z0-9._]*$/.exec(text.slice(0, caret))?.[0] ?? ''
  const right = /^[A-Za-z0-9._]*/.exec(text.slice(caret))?.[0] ?? ''
  return left + right
}
