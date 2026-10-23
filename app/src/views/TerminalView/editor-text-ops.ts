// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * editor-text-ops.ts — pure text operations behind CodeEditor's find/replace
 * and comment toggle (2026-10-21, "RStudio habits"). Kept free of DOM/React
 * so they are unit-tested directly.
 */

export interface TextMatch {
  start: number
  end: number
}

/** Every non-overlapping occurrence of `query` (plain text, not a regex). */
export function findMatches(text: string, query: string, matchCase: boolean): TextMatch[] {
  if (query === '') return []
  const hay = matchCase ? text : text.toLowerCase()
  const needle = matchCase ? query : query.toLowerCase()
  const out: TextMatch[] = []
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
    out.push({ start: i, end: i + needle.length })
  }
  return out
}

/** The match to go to from `caret`: the first at/after it (or before it, backwards), wrapping. */
export function nextMatchIndex(matches: TextMatch[], caret: number, backwards: boolean): number {
  if (matches.length === 0) return -1
  if (backwards) {
    for (let i = matches.length - 1; i >= 0; i--) {
      if ((matches[i] as TextMatch).end <= caret) return i
    }
    return matches.length - 1
  }
  const i = matches.findIndex(m => m.start >= caret)
  return i === -1 ? 0 : i
}

/** `text` with every match replaced — Replace All as one edit (one undo step). */
export function replaceAll(text: string, matches: TextMatch[], replacement: string): string {
  let out = ''
  let last = 0
  for (const m of matches) {
    out += text.slice(last, m.start) + replacement
    last = m.end
  }
  return out + text.slice(last)
}

export interface CommentToggle {
  /** Replace [from, to) with `text` … */
  from: number
  to: number
  text: string
  /** … then select this range. */
  selStart: number
  selEnd: number
}

/**
 * RStudio's Ctrl+Shift+C on the lines the selection touches: when every
 * non-blank line is already commented, one `#` (and one space after it) is
 * removed from each; otherwise `# ` goes in at the block's common indent.
 * Blank lines are left alone. A selection ending at the very start of a line
 * does not include that line (as in RStudio/VS Code).
 */
export function toggleLineComment(
  text: string,
  selStart: number,
  selEnd: number,
  prefix = '#'
): CommentToggle {
  const from = text.lastIndexOf('\n', selStart - 1) + 1
  const effEnd = selEnd > selStart && text[selEnd - 1] === '\n' ? selEnd - 1 : selEnd
  const nl = text.indexOf('\n', effEnd)
  const to = nl === -1 ? text.length : nl
  const lines = text.slice(from, to).split('\n')
  const nonBlank = lines.filter(l => l.trim() !== '')
  const isCommented = (l: string): boolean => l.trimStart().startsWith(prefix)
  const uncomment = nonBlank.length > 0 && nonBlank.every(isCommented)

  // Per line: how many characters were added (+) or removed (−) at which column.
  const edits: { col: number; delta: number }[] = []
  let out: string[]
  if (uncomment) {
    out = lines.map(l => {
      if (!isCommented(l)) {
        edits.push({ col: 0, delta: 0 })
        return l
      }
      const col = l.length - l.trimStart().length
      const cut = l.startsWith(`${prefix} `, col) ? prefix.length + 1 : prefix.length
      edits.push({ col, delta: -cut })
      return l.slice(0, col) + l.slice(col + cut)
    })
  } else {
    const blankBlock = nonBlank.length === 0
    const indent = blankBlock ? 0 : Math.min(...nonBlank.map(l => l.length - l.trimStart().length))
    out = lines.map(l => {
      if (!blankBlock && l.trim() === '') {
        edits.push({ col: 0, delta: 0 })
        return l
      }
      edits.push({ col: indent, delta: prefix.length + 1 })
      return `${l.slice(0, indent)}${prefix} ${l.slice(indent)}`
    })
  }
  const newBlock = out.join('\n')

  if (selStart === selEnd) {
    // Caret on one line: keep it on the same character.
    const e = edits[0] as { col: number; delta: number }
    const colInLine = selStart - from
    const moved = colInLine < e.col ? selStart : Math.max(from + e.col, selStart + e.delta)
    return { from, to, text: newBlock, selStart: moved, selEnd: moved }
  }
  return { from, to, text: newBlock, selStart: from, selEnd: from + newBlock.length }
}
