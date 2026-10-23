// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ansi — R konsolundaki cli/crayon renk kodlarının çözümü.
 * Değişmez: segment metinleri birleşince kaçış dizileri hariç metnin aynısı.
 */
import { describe, it, expect } from 'vitest'
import { parseAnsi, stripAnsi } from '../../src/lib/ansi'

const ESC = '\u001b'

describe('parseAnsi', () => {
  it('plain text is one segment', () => {
    expect(parseAnsi('hello')).toEqual([{ text: 'hello' }])
  })

  it('colour + bold + reset', () => {
    const s = `${ESC}[1m${ESC}[31mError${ESC}[39m${ESC}[22m: x`
    expect(parseAnsi(s)).toEqual([{ text: 'Error', color: 'red', bold: true }, { text: ': x' }])
  })

  it('bright colours map to the same palette', () => {
    expect(parseAnsi(`${ESC}[92mok${ESC}[0m`)).toEqual([{ text: 'ok', color: 'green' }])
  })

  it('256-colour arguments are skipped, not misread', () => {
    expect(parseAnsi(`${ESC}[38;5;31mx${ESC}[0m`)).toEqual([{ text: 'x' }])
  })

  it('non-SGR sequences (cursor moves) are dropped', () => {
    expect(parseAnsi(`a${ESC}[2Kb${ESC}[1Gc`)).toEqual([{ text: 'abc' }])
  })

  it('joined text equals stripAnsi', () => {
    const s = `${ESC}[33m✔${ESC}[39m done ${ESC}[1mbold${ESC}[22m`
    expect(
      parseAnsi(s)
        .map(x => x.text)
        .join('')
    ).toBe(stripAnsi(s))
    expect(stripAnsi(s)).toBe('✔ done bold')
  })
})
