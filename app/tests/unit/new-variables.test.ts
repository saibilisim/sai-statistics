// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * New variables from an analysis (roadmap ★11).
 *
 * Two layers are covered here because they are the two places a bad column can
 * be stopped without a database: the dialog-side name filter, and the zod
 * payload contract that the main-process handler validates against.
 */
import { describe, it, expect } from 'vitest'
import { cleanNewVarSelection, hasNewVars } from '../../src/lib/new-var-names'
import { CaseVarSchema, AnalysisResultSchema } from '../../shared/analysis-types'
import { CreateVariablesRequestSchema } from '../../shared/ipc-schemas'

describe('cleanNewVarSelection', () => {
  it('keeps valid names and trims them', () => {
    expect(cleanNewVarSelection({ survival: '  sur  ' }, [])).toEqual({ survival: 'sur' })
  })

  it('drops a name that collides with an existing variable, case-insensitively', () => {
    // The handler would reject the whole batch; dropping it here means the rest
    // of the user's request still goes through.
    expect(cleanNewVarSelection({ survival: 'AGE' }, ['age'])).toEqual({})
  })

  it('drops the second of two slots that were given the same name', () => {
    const out = cleanNewVarSelection({ survival: 'x', hazard: 'x' }, [])
    expect(Object.keys(out)).toEqual(['survival'])
  })

  it('rejects names R and SPSS syntax could not use', () => {
    for (const bad of ['', '   ', '1st', 'has space', 'weird-dash', 'a'.repeat(65)]) {
      expect(cleanNewVarSelection({ survival: bad }, [])).toEqual({})
    }
  })

  it('hasNewVars is false when nothing survives the filter', () => {
    expect(hasNewVars({ survival: '1bad' }, [])).toBe(false)
    expect(hasNewVars({ survival: 'ok' }, [])).toBe(true)
  })
})

describe('CaseVar contract', () => {
  const base = { name: 'sur', values: [0.9, 0.8], rowIndex: [0, 3] }

  it('fills the display defaults so R only has to send the numbers', () => {
    const parsed = CaseVarSchema.parse(base)
    expect(parsed).toMatchObject({ label: '', type: 'numeric', measure: 'scale', decimals: 3 })
  })

  it('accepts nulls in values — a case the model could not score', () => {
    expect(() => CaseVarSchema.parse({ ...base, values: [0.9, null] })).not.toThrow()
  })

  it('refuses a negative row index', () => {
    // __row_idx is 0-based and never negative; a negative one means the vector
    // is not indexed over this dataset at all.
    expect(() => CaseVarSchema.parse({ ...base, rowIndex: [0, -1] })).toThrow()
  })

  it('refuses a fractional row index', () => {
    expect(() => CaseVarSchema.parse({ ...base, rowIndex: [0, 1.5] })).toThrow()
  })

  it('defaults caseVars to empty so every pre-existing R script still parses', () => {
    const r = AnalysisResultSchema.parse({ success: true, tables: [], plots: [] })
    expect(r.caseVars).toEqual([])
  })
})

describe('transform:create-variables payload', () => {
  const cv = { name: 'sur', values: [1], rowIndex: [0] }

  it('accepts a well-formed batch', () => {
    expect(() =>
      CreateVariablesRequestSchema.parse({ datasetId: 'ds_1', variables: [cv] })
    ).not.toThrow()
  })

  it('refuses an empty batch — nothing to do is a caller bug, not a no-op', () => {
    expect(() => CreateVariablesRequestSchema.parse({ datasetId: 'ds_1', variables: [] })).toThrow()
  })
})
