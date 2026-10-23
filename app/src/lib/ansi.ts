// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ansi.ts — turns R console output with ANSI SGR colour codes (cli, crayon,
 * tidyverse messages) into styled segments. Only the 16 basic colours + bold
 * are mapped (the console asks cli for 8 colours); the colour itself comes
 * from theme tokens via CSS classes, never from the escape code. Any other
 * escape sequence (cursor moves of progress bars, 256/true-colour) is dropped
 * rather than shown as garbage. Pure function — no DOM.
 */

export type AnsiColor = 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'grey'

export interface AnsiSegment {
  text: string
  color?: AnsiColor
  bold?: boolean
}

// 30–37 / 90–97: black, red, green, yellow, blue, magenta, cyan, white.
const COLORS: (AnsiColor | undefined)[] = [
  'grey',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  undefined
]

// ESC [ params final-byte — every CSI sequence; only "m" (SGR) is styling.
// eslint-disable-next-line no-control-regex
const CSI_RE = /\u001b\[([0-9;?]*)([@-~])/g
// Lone ESC + one char (charset switches etc.).
// eslint-disable-next-line no-control-regex
const ESC_OTHER_RE = /\u001b[^[]/g

/** Text without any escape sequences (copy, search). */
export function stripAnsi(text: string): string {
  return text.replace(CSI_RE, '').replace(ESC_OTHER_RE, '')
}

export function parseAnsi(text: string): AnsiSegment[] {
  if (!text.includes('\u001b')) return [{ text }]
  const out: AnsiSegment[] = []
  let color: AnsiColor | undefined
  let bold = false
  let last = 0
  const push = (s: string) => {
    const clean = s.replace(ESC_OTHER_RE, '')
    if (clean === '') return
    const prev = out[out.length - 1]
    if (prev && prev.color === color && !!prev.bold === bold) prev.text += clean
    else out.push({ text: clean, ...(color ? { color } : {}), ...(bold ? { bold } : {}) })
  }
  CSI_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CSI_RE.exec(text)) !== null) {
    push(text.slice(last, m.index))
    last = m.index + m[0].length
    if (m[2] !== 'm') continue
    const codes = (m[1] ?? '').split(';').map(c => (c === '' ? 0 : Number(c)))
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i] ?? 0
      if (c === 0) {
        color = undefined
        bold = false
      } else if (c === 1) bold = true
      else if (c === 22) bold = false
      else if (c === 39) color = undefined
      else if (c >= 30 && c <= 37) color = COLORS[c - 30]
      else if (c >= 90 && c <= 97) color = COLORS[c - 90]
      else if (c === 38 || c === 48) {
        // 256 / true colour: skip its arguments, keep the default colour.
        i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0
      }
    }
  }
  push(text.slice(last))
  return out
}
