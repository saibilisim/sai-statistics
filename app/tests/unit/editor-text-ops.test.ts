// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * editor-text-ops.test.ts — find/replace and comment toggle behind the
 * Terminal's code editor (2026-10-21).
 */
import { describe, it, expect } from 'vitest'
import {
  findMatches,
  nextMatchIndex,
  replaceAll,
  toggleLineComment
} from '../../src/views/TerminalView/editor-text-ops'

describe('findMatches', () => {
  it('finds plain text, case-insensitive by default, without overlaps', () => {
    expect(findMatches('Data data DATA', 'data', false)).toHaveLength(3)
    expect(findMatches('Data data DATA', 'data', true)).toEqual([{ start: 5, end: 9 }])
    expect(findMatches('aaaa', 'aa', false)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 }
    ])
  })

  it('treats regex characters literally', () => {
    expect(findMatches('x$a + x$a.b', 'x$a.', false)).toEqual([{ start: 6, end: 10 }])
  })

  it('finds nothing for an empty query', () => {
    expect(findMatches('abc', '', false)).toEqual([])
  })
})

describe('nextMatchIndex', () => {
  const m = findMatches('a.a.a', 'a', false) // 0, 2, 4
  it('goes forward from the caret and wraps', () => {
    expect(nextMatchIndex(m, 1, false)).toBe(1)
    expect(nextMatchIndex(m, 5, false)).toBe(0)
  })
  it('goes backward and wraps', () => {
    expect(nextMatchIndex(m, 3, true)).toBe(1)
    expect(nextMatchIndex(m, 0, true)).toBe(2)
  })
  it('-1 without matches', () => {
    expect(nextMatchIndex([], 0, false)).toBe(-1)
  })
})

describe('replaceAll', () => {
  it('replaces every match in one pass', () => {
    const text = 'mean(x); mean(y)'
    expect(replaceAll(text, findMatches(text, 'mean', true), 'median')).toBe('median(x); median(y)')
  })
})

describe('toggleLineComment', () => {
  const apply = (text: string, s: number, e: number) => {
    const r = toggleLineComment(text, s, e)
    return { text: text.slice(0, r.from) + r.text + text.slice(r.to), sel: [r.selStart, r.selEnd] }
  }

  it('comments the selected lines at their common indent, skipping blank lines', () => {
    const text = 'f <- function() {\n  a <- 1\n\n  b <- 2\n}'
    const s = text.indexOf('  a')
    const e = text.indexOf('}') - 1
    expect(apply(text, s, e).text).toBe('f <- function() {\n  # a <- 1\n\n  # b <- 2\n}')
  })

  it('uncomments when every non-blank line is commented', () => {
    const text = '# x <- 1\n#y <- 2\nz'
    expect(apply(text, 0, text.indexOf('z') - 1).text).toBe('x <- 1\ny <- 2\nz')
  })

  it('a mixed block gets commented, not uncommented', () => {
    expect(apply('# a\nb', 0, 5).text).toBe('# # a\n# b')
  })

  it('a selection ending at a line start leaves that line out', () => {
    const text = 'a\nb\nc'
    expect(apply(text, 0, 2).text).toBe('# a\nb\nc')
  })

  it('a caret toggles just its line and stays on the same character', () => {
    const text = 'x <- 1\ny <- 2'
    const caret = text.indexOf('2')
    const on = apply(text, caret, caret)
    expect(on.text).toBe('x <- 1\n# y <- 2')
    expect(on.text[on.sel[0] as number]).toBe('2')
    const off = apply(on.text, on.sel[0] as number, on.sel[0] as number)
    expect(off.text).toBe(text)
    expect(off.text[off.sel[0] as number]).toBe('2')
  })
})
