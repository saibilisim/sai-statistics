// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * r-editor-helpers — R betik editörünün Ctrl+Enter (ifade sınırı) ve
 * tamamlama (imleçteki kelime) yardımcıları.
 *
 * Kritik değişmez: Ctrl+Enter çok satırlı bir çağrının YARISINI R'a
 * göndermemeli — yarım ifade R'da "unexpected end of input" verir ya da
 * daha kötüsü, sonraki satırla birleşip başka bir şey çalıştırır.
 */

import { describe, it, expect } from 'vitest'
import {
  statementStarts,
  statementRangeAt,
  nextCodeLine,
  lineStartOffset,
  getRToken,
  wordAt
} from '../../src/views/TerminalView/r-editor-helpers'

describe('statementRangeAt', () => {
  const src = [
    'x <- 1', // 0
    'fit <- lm(y ~ x,', // 1
    '          data = df)', // 2
    '', // 3
    'df |>', // 4
    '  head()', // 5
    'if (x > 0) {', // 6
    '  print("a (")', // 7  bracket inside a string doesn't count
    '} else {', // 8
    '  print(2)', // 9
    '}', // 10
    'y <- 2 # comment (' // 11 bracket inside a comment doesn't count
  ].join('\n')

  it('single-line statement', () => {
    expect(statementRangeAt(src, 0)).toEqual([0, 0])
  })

  it('open bracket continues onto the next line — from either line', () => {
    expect(statementRangeAt(src, 1)).toEqual([1, 2])
    expect(statementRangeAt(src, 2)).toEqual([1, 2])
  })

  it('trailing pipe continues the statement', () => {
    expect(statementRangeAt(src, 4)).toEqual([4, 5])
  })

  it('if / else across lines is one statement; strings are ignored', () => {
    expect(statementRangeAt(src, 6)).toEqual([6, 10])
    expect(statementRangeAt(src, 9)).toEqual([6, 10])
  })

  it('a bracket inside a comment does not open a block', () => {
    expect(statementRangeAt(src, 11)).toEqual([11, 11])
  })
})

describe('statementStarts', () => {
  it('marks statement starts (console echo uses > there, + elsewhere)', () => {
    expect(statementStarts('a <- 1\nb <- f(1,\n  2)\nc <- 3')).toEqual([true, true, false, true])
  })
})

describe('nextCodeLine / lineStartOffset', () => {
  const src = 'a <- 1\n\n# note\nb <- 2'
  it('skips blank and comment lines', () => {
    expect(nextCodeLine(src, 0)).toBe(3)
    expect(nextCodeLine(src, 3)).toBe(-1)
  })
  it('offset of a line start', () => {
    expect(lineStartOffset(src, 3)).toBe(src.indexOf('b <- 2'))
    expect(lineStartOffset(src, 0)).toBe(0)
  })
})

describe('getRToken', () => {
  it('plain identifier', () => {
    expect(getRToken('x <- mea', 8)).toEqual({ start: 5, value: 'mea' })
  })
  it('keeps $ / :: accessors so R can complete them', () => {
    expect(getRToken('summary(data$ag', 15).value).toBe('data$ag')
    expect(getRToken('stats::sd', 9).value).toBe('stats::sd')
  })
  it('empty right after a bracket', () => {
    expect(getRToken('mean(', 5).value).toBe('')
  })
})

describe('wordAt', () => {
  it('word around the caret', () => {
    expect(wordAt('x <- t.test(a)', 7)).toBe('t.test')
  })
})
