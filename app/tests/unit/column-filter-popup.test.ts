// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import { formatFilterItemLabel, normalizeForSearch } from '../../src/lib/aggrid-data'

describe('formatFilterItemLabel', () => {
  it('formats empty values as (Empty)', () => {
    expect(formatFilterItemLabel('', undefined)).toBe('(Empty)')
    expect(formatFilterItemLabel('', 'None')).toBe('(Empty)')
  })

  it('formats value with label as "value - label"', () => {
    expect(formatFilterItemLabel('1', 'Erkek')).toBe('1 - Erkek')
    expect(formatFilterItemLabel('2', 'Kadın')).toBe('2 - Kadın')
    expect(formatFilterItemLabel('0', 'Kontrol Grubu')).toBe('0 - Kontrol Grubu')
  })

  it('returns plain value when no label is present', () => {
    expect(formatFilterItemLabel('25', undefined)).toBe('25')
    expect(formatFilterItemLabel('Ankara', undefined)).toBe('Ankara')
  })

  it('avoids double-prefixing if label already includes the value', () => {
    expect(formatFilterItemLabel('1', '1 - Erkek')).toBe('1 - Erkek')
    expect(formatFilterItemLabel('1', '1: Erkek')).toBe('1: Erkek')
    expect(formatFilterItemLabel('1', '1. Erkek')).toBe('1. Erkek')
    expect(formatFilterItemLabel('1', '1')).toBe('1')
  })

  it('does not falsely match numbers starting with the same digit', () => {
    expect(formatFilterItemLabel('1', '10 - On')).toBe('1 - 10 - On')
  })
})

describe('normalizeForSearch', () => {
  it('normalizes Turkish characters and accents for search matching', () => {
    expect(normalizeForSearch('Kadın')).toBe('kadin')
    expect(normalizeForSearch('kadin')).toBe('kadin')
    expect(normalizeForSearch('ERKEK')).toBe('erkek')
    expect(normalizeForSearch('Öğrenci')).toBe('ogrenci')
  })
})
