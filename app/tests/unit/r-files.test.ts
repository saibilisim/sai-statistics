// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * r-files.test.ts — the R code the Files pane writes (2026-10-21).
 */
import { describe, it, expect } from 'vitest'
import { readCodeFor, rString } from '../../src/views/TerminalView/r-files'

describe('rString', () => {
  it('writes Windows paths with / and escapes quotes', () => {
    expect(rString('C:\\Users\\Ayşe\\veri')).toBe('"C:/Users/Ayşe/veri"')
    expect(rString('a "b".csv')).toBe('"a \\"b\\".csv"')
  })
})

describe('readCodeFor', () => {
  it('reads each data format with the right call into a syntactic name', () => {
    expect(readCodeFor('veri seti.csv')).toBe('veri_seti <- read.csv("veri seti.csv")')
    expect(readCodeFor('2024.xlsx')).toBe('x2024 <- readxl::read_excel("2024.xlsx")')
    expect(readCodeFor('anket.sav')).toBe('anket <- haven::read_sav("anket.sav")')
    expect(readCodeFor('m.rds')).toBe('m <- readRDS("m.rds")')
    expect(readCodeFor('ws.RData')).toBe('load("ws.RData")')
  })

  it('leaves other files alone', () => {
    expect(readCodeFor('notlar.pdf')).toBeNull()
    expect(readCodeFor('analiz.R')).toBeNull()
  })
})
