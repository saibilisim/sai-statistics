// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import { parseCellInput } from '../../src/lib/aggrid-data'
import type { Variable } from '../../shared/data-types'

function makeVar(overrides: Partial<Variable> = {}): Variable {
  return {
    colId: 'col_1',
    name: 'v',
    type: 'numeric',
    width: 12,
    decimals: 2,
    label: '',
    valueLabels: {},
    missing: null,
    columns: 12,
    align: 'right',
    measure: 'scale',
    role: 'both',
    ...overrides
  }
}

describe('parseCellInput — numeric formatting round-trip (numberFormat is display-only)', () => {
  const v = makeVar()

  it('parses a plain number unchanged', () => {
    expect(parseCellInput('1234.56', v, false)).toBe(1234.56)
  })

  it('strips a currency symbol ($, ₺, €, £)', () => {
    expect(parseCellInput('$1234.56', v, false)).toBe(1234.56)
    expect(parseCellInput('₺1234.56', v, false)).toBe(1234.56)
    expect(parseCellInput('€1234.56', v, false)).toBe(1234.56)
    expect(parseCellInput('£1234.56', v, false)).toBe(1234.56)
  })

  it('strips a "TL" / "TRY" currency suffix', () => {
    expect(parseCellInput('1234.56 TL', v, false)).toBe(1234.56)
    expect(parseCellInput('1234.56 TRY', v, false)).toBe(1234.56)
  })

  it('strips a trailing percent sign WITHOUT dividing by 100 (SPSS convention)', () => {
    expect(parseCellInput('50%', v, false)).toBe(50)
    expect(parseCellInput('12.5%', v, false)).toBe(12.5)
  })

  it('resolves US-grouped currency with decimals (comma=thousands, dot=decimal)', () => {
    expect(parseCellInput('$1,234.56', v, false)).toBe(1234.56)
    expect(parseCellInput('12,345,678.9', v, false)).toBe(12345678.9)
  })

  it('resolves Turkish/European-grouped currency (dot=thousands, comma=decimal)', () => {
    expect(parseCellInput('₺1.234,56', v, false)).toBe(1234.56)
    expect(parseCellInput('12.345.678,9', v, false)).toBe(12345678.9)
  })

  it('collapses repeated thousands separators with no decimal part', () => {
    expect(parseCellInput('1,234,567', v, false)).toBe(1234567)
    expect(parseCellInput('1.234.567', v, false)).toBe(1234567)
  })

  it('still treats a single lone comma as a decimal separator (existing convention, unchanged)', () => {
    expect(parseCellInput('12,5', v, false)).toBe(12.5)
  })

  it('strips thousands-separator whitespace (e.g. "1 234,56")', () => {
    expect(parseCellInput('1 234,56', v, false)).toBe(1234.56)
  })

  it('leaves non-numeric variables untouched', () => {
    const strVar = makeVar({ type: 'string' })
    expect(parseCellInput('$1,234.56', strVar, false)).toBe('$1,234.56')
  })

  it('falls back to the raw string when it still fails to parse as a number', () => {
    expect(parseCellInput('not a number', v, false)).toBe('not a number')
  })
})
