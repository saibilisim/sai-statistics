// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import { createCaseIdentity, caseKey } from '../../src/views/DataView/case-identity'

describe('caseKey', () => {
  it('builds the customStyles row key', () => {
    expect(caseKey(0)).toBe('r0')
    expect(caseKey(41)).toBe('r41')
  })
})

describe('createCaseIdentity', () => {
  it('is the identity map before any ids are loaded (fresh import equivalence)', () => {
    const ci = createCaseIdentity()
    expect(ci.caseOfDb(7)).toBe(7)
    expect(ci.dbOfCase(7)).toBe(7)
    expect(ci.keyOfDb(7)).toBe('r7')
  })

  it('translates both ways once ids are loaded', () => {
    const ci = createCaseIdentity()
    ci.append([10, 11, 12])
    expect(ci.caseOfDb(0)).toBe(10)
    expect(ci.caseOfDb(2)).toBe(12)
    expect(ci.dbOfCase(11)).toBe(1)
    expect(ci.keyOfDb(1)).toBe('r11')
  })

  it('reports a deleted case as gone rather than pointing at its old slot', () => {
    const ci = createCaseIdentity()
    ci.append([10, 11, 12])
    ci.setAll([10, 12]) // case 11 deleted; 12 slid up into index 1
    expect(ci.dbOfCase(11)).toBeUndefined()
    expect(ci.dbOfCase(12)).toBe(1)
  })

  it('keeps a format/formula on its record when a row is inserted above it', () => {
    // The exact regression from denetim raporu §2: a new blank row takes DB
    // index 0, but the styled record keeps case id 0 and so keeps its key.
    const ci = createCaseIdentity()
    ci.append([0, 1, 2])
    const keyBefore = ci.keyOfDb(0)

    ci.setAll([3, 0, 1, 2]) // fresh case id 3 inserted at the top

    expect(ci.keyOfDb(0)).toBe('r3') // the new blank row: its own, empty key
    expect(ci.keyOfDb(1)).toBe(keyBefore) // the original record: unchanged key
    expect(ci.dbOfCase(0)).toBe(1)
  })

  it('follows a record through a reorder', () => {
    const ci = createCaseIdentity()
    ci.append([0, 1, 2])
    ci.setAll([2, 0, 1])
    expect(ci.dbOfCase(2)).toBe(0)
    expect(ci.keyOfDb(0)).toBe('r2')
  })

  it('invalidates its cached reverse map on every mutation, automatically', () => {
    const ci = createCaseIdentity()
    ci.append([5, 6])
    expect(ci.dbOfCase(6)).toBe(1) // builds + caches the reverse map
    ci.setAll([6, 5])
    expect(ci.dbOfCase(6)).toBe(0) // owning the array is what makes this safe
    ci.reset()
    expect(ci.all()).toEqual([])
  })

  it('append accumulates chunk by chunk (progressive load)', () => {
    const ci = createCaseIdentity()
    ci.append([0, 1])
    ci.append([2, 3])
    expect(ci.all()).toEqual([0, 1, 2, 3])
    expect(ci.dbOfCase(3)).toBe(3)
  })
})
