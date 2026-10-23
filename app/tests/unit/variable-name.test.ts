// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import {
  isValidVariableName,
  namesEqual,
  sanitizeVariableName,
  makeUniqueVariableName
} from '../../shared/variable-name'

describe('isValidVariableName', () => {
  it('accepts letter/underscore-led alphanumeric names', () => {
    expect(isValidVariableName('age')).toBe(true)
    expect(isValidVariableName('_tmp')).toBe(true)
    expect(isValidVariableName('Var_1')).toBe(true)
  })

  it('rejects spaces, leading digits and special characters', () => {
    expect(isValidVariableName('1var')).toBe(false)
    expect(isValidVariableName('gelir düzeyi')).toBe(false)
    expect(isValidVariableName('a-b')).toBe(false)
    expect(isValidVariableName('')).toBe(false)
  })
})

describe('namesEqual', () => {
  it('compares case-insensitively (SPSS-style)', () => {
    expect(namesEqual('Yas', 'yas')).toBe(true)
    expect(namesEqual('AGE', 'age')).toBe(true)
    expect(namesEqual('age', 'gender')).toBe(false)
  })
})

describe('sanitizeVariableName', () => {
  it('transliterates Turkish letters for readability', () => {
    expect(sanitizeVariableName('Gelir Düzeyi')).toBe('Gelir_Duzeyi')
    expect(sanitizeVariableName('Katılımcının Yaşı')).toBe('Katilimcinin_Yasi')
    expect(sanitizeVariableName('ŞŞŞ çöğü')).toBe('SSS_cogu')
  })

  it('replaces invalid characters and collapses underscores', () => {
    expect(sanitizeVariableName('Gelir Düzeyi (₺)')).toBe('Gelir_Duzeyi')
    expect(sanitizeVariableName('a  -  b')).toBe('a_b')
  })

  it('prefixes names that would start with a digit', () => {
    expect(sanitizeVariableName('1. Soru')).toBe('V1_Soru')
    expect(sanitizeVariableName('2024')).toBe('V2024')
  })

  it('falls back to V{index} when nothing valid remains', () => {
    expect(sanitizeVariableName('   ', 4)).toBe('V4')
    expect(sanitizeVariableName('₺€', 7)).toBe('V7')
  })

  it('leaves already-valid names untouched', () => {
    expect(sanitizeVariableName('age')).toBe('age')
    expect(sanitizeVariableName('col_1')).toBe('col_1')
  })

  it('always returns a structurally valid name', () => {
    for (const raw of ['Gelir Düzeyi (₺)', '1. Soru', '   ', 'ŞŞŞ', '!!!', 'a-b-c']) {
      expect(isValidVariableName(sanitizeVariableName(raw))).toBe(true)
    }
  })
})

describe('makeUniqueVariableName', () => {
  it('returns the candidate when there is no collision', () => {
    expect(makeUniqueVariableName('age', [])).toBe('age')
    expect(makeUniqueVariableName('age', ['gender', 'income'])).toBe('age')
  })

  it('suffixes to avoid collisions, case-insensitively', () => {
    expect(makeUniqueVariableName('yas', ['Yas'])).toBe('yas_1')
    expect(makeUniqueVariableName('yas', ['Yas', 'yas_1'])).toBe('yas_2')
  })

  it('produces unique names across a duplicate-heavy header row', () => {
    const used: string[] = []
    const headers = ['Soru', 'Soru', 'soru', 'Soru']
    const out = headers.map((h, i) => {
      const name = makeUniqueVariableName(sanitizeVariableName(h, i + 1), used)
      used.push(name)
      return name
    })
    expect(new Set(out.map(n => n.toLowerCase())).size).toBe(out.length)
    // Casing follows each candidate, not the colliding name → the lowercase
    // "soru" header keeps its casing in the suffixed result.
    expect(out).toEqual(['Soru', 'Soru_1', 'soru_2', 'Soru_3'])
  })
})
