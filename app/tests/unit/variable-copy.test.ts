// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import { formatVariablesForCopy } from '../../src/lib/variable-copy'

const vars = [
  { name: 'age', label: 'Age in years' },
  { name: 'sex', label: '' },
  { name: 'note', label: 'free\ttext\nwith breaks' }
]

describe('formatVariablesForCopy', () => {
  it('lines: one name per line', () => {
    expect(formatVariablesForCopy(vars, 'lines')).toBe('age\nsex\nnote')
  })

  it('inline: space-separated for syntax', () => {
    expect(formatVariablesForCopy(vars, 'inline')).toBe('age sex note')
  })

  it('labels: name TAB label rows, label whitespace flattened', () => {
    expect(formatVariablesForCopy(vars, 'labels')).toBe(
      'age\tAge in years\nsex\t\nnote\tfree text with breaks'
    )
  })

  it('empty selection gives empty text', () => {
    expect(formatVariablesForCopy([], 'lines')).toBe('')
  })
})
