// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import {
  chooseNumericStyle,
  deriveMeasure,
  numericValueExpr,
  quoteCol,
  type SeparatorCounts
} from '../../electron/ipc/file-handler/type-inference'

/** All-zero counts; each test sets only the fields it is about. */
function counts(over: Partial<SeparatorCounts> = {}): SeparatorCounts {
  return {
    nonNumCommaDecimal: 0,
    nonNumDotDecimal: 0,
    bothSeparators: 0,
    commaLast: 0,
    commaValues: 0,
    commaGrouped: 0,
    dotValues: 0,
    dotGrouped: 0,
    ...over
  }
}

describe('chooseNumericStyle', () => {
  it('reads "1.234,56" as comma-decimal (comma is the last separator)', () => {
    expect(chooseNumericStyle(counts({ bothSeparators: 3, commaLast: 3 }))).toBe('comma-decimal')
  })

  it('reads "1,234.56" as dot-decimal (dot is the last separator)', () => {
    expect(chooseNumericStyle(counts({ bothSeparators: 3, commaLast: 0 }))).toBe('dot-decimal')
  })

  it('refuses a column that mixes both conventions', () => {
    expect(chooseNumericStyle(counts({ bothSeparators: 4, commaLast: 2 }))).toBeNull()
  })

  it('reads "3,14" as a decimal comma', () => {
    // Two of the three comma values are not strictly grouped thousands.
    expect(chooseNumericStyle(counts({ commaValues: 3, commaGrouped: 1 }))).toBe('comma-decimal')
  })

  it('reads a column of only "1,234"-shaped values as thousands separators', () => {
    expect(chooseNumericStyle(counts({ commaValues: 5, commaGrouped: 5 }))).toBe('dot-decimal')
  })

  it('reads "1.234.567" as thousands separators', () => {
    expect(chooseNumericStyle(counts({ dotValues: 4, dotGrouped: 4 }))).toBe('comma-decimal')
  })

  it('leaves version-like "1.2.3" alone rather than turning it into 123', () => {
    expect(chooseNumericStyle(counts({ dotValues: 4, dotGrouped: 0 }))).toBeNull()
  })

  it('refuses when the rewritten values still do not cast', () => {
    expect(
      chooseNumericStyle(counts({ commaValues: 3, commaGrouped: 0, nonNumCommaDecimal: 1 }))
    ).toBeNull()
  })

  it('refuses a column with no separators at all', () => {
    expect(chooseNumericStyle(counts())).toBeNull()
  })
})

describe('deriveMeasure', () => {
  const base = { maxDistinct: 24 }

  it('calls a 1/2-coded numeric column nominal, not scale', () => {
    expect(deriveMeasure({ ...base, type: 'numeric', distinct: 2, allInteger: true })).toBe(
      'nominal'
    )
  })

  it('calls a many-valued integer column scale', () => {
    expect(deriveMeasure({ ...base, type: 'numeric', distinct: 250, allInteger: true })).toBe(
      'scale'
    )
  })

  it('calls any non-integer numeric column scale, however few distinct values', () => {
    expect(deriveMeasure({ ...base, type: 'numeric', distinct: 3, allInteger: false })).toBe(
      'scale'
    )
  })

  it('treats the threshold as inclusive', () => {
    expect(deriveMeasure({ ...base, type: 'numeric', distinct: 24, allInteger: true })).toBe(
      'nominal'
    )
    expect(deriveMeasure({ ...base, type: 'numeric', distinct: 25, allInteger: true })).toBe(
      'scale'
    )
  })

  it('restores the old everything-is-scale behaviour when the threshold is 0', () => {
    expect(deriveMeasure({ type: 'numeric', distinct: 2, allInteger: true, maxDistinct: 0 })).toBe(
      'scale'
    )
  })

  it('keeps strings nominal and dates scale', () => {
    expect(deriveMeasure({ ...base, type: 'string', distinct: 900, allInteger: false })).toBe(
      'nominal'
    )
    expect(deriveMeasure({ ...base, type: 'date', distinct: 900, allInteger: false })).toBe('scale')
  })

  it("lets a source file's own value labels outrank the count rule", () => {
    expect(
      deriveMeasure({
        ...base,
        type: 'numeric',
        distinct: 5000,
        allInteger: true,
        hasValueLabels: true
      })
    ).toBe('nominal')
  })
})

describe('SQL expression builders', () => {
  it('escapes embedded quotes in column names', () => {
    expect(quoteCol('od"d')).toBe('"od""d"')
  })

  it('rewrites each notation into SQL notation', () => {
    expect(numericValueExpr('"c"', 'comma-decimal')).toContain('REPLACE(REPLACE(')
    expect(numericValueExpr('"c"', 'dot-decimal')).toContain("', ''")
    // plain still strips the invisible characters, which is the whole point of
    // materialising even an already-plain text column.
    expect(numericValueExpr('"c"', 'plain')).toContain('CHR(65279)')
  })
})
