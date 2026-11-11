// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Design of Experiments dialog helpers kept out of the components so they can
 * be unit-tested: how many factor rows each design takes, and the validation
 * of a design spec before it is built.
 */
import type { Variable } from '@shared/data-types'
import type { DoeDesignSpec, DoeDesignType } from './doe-designs'

export interface FactorSlots {
  count: number
  /** Whether the user picks the number of factors (factorial 2-3, 2^k 2-6). */
  variable: boolean
  min: number
  max: number
  labelKeys: string[]
}

export function factorSlots(design: DoeDesignType, n: number): FactorSlots {
  switch (design) {
    case 'crd':
    case 'rcbd':
    case 'latin':
      return {
        count: 1,
        variable: false,
        min: 1,
        max: 1,
        labelKeys: ['analysis:doe.treatmentLabel']
      }
    case 'splitplot':
      return {
        count: 2,
        variable: false,
        min: 2,
        max: 2,
        labelKeys: ['analysis:doe.mainLabel', 'analysis:doe.subLabel']
      }
    case 'factorial': {
      const c = Math.min(3, Math.max(2, n))
      return { count: c, variable: true, min: 2, max: 3, labelKeys: [] }
    }
    case 'twok': {
      const c = Math.min(6, Math.max(2, n))
      return { count: c, variable: true, min: 2, max: 6, labelKeys: [] }
    }
  }
}

/** i18n key of the first problem with the spec, or null when it can be built. */
export function designSpecError(spec: DoeDesignSpec): string | null {
  const names = spec.factors.map(f => f.name)
  if (names.some(n => n === '') || new Set(names).size !== names.length)
    return 'analysis:doe.errFactorNames'
  if (!spec.responseName || names.includes(spec.responseName)) return 'analysis:doe.errResponseName'
  if (!Number.isInteger(spec.seed)) return 'analysis:doe.errSeed'
  if (spec.type === 'twok') {
    if (spec.factors.some(f => f.levels.length !== 2)) return 'analysis:doe.errTwoLevels'
  } else if (
    spec.factors.some(f => f.levels.length < 2 || new Set(f.levels).size !== f.levels.length)
  ) {
    return 'analysis:doe.errLevels'
  }
  if (spec.type === 'latin') {
    const t = spec.factors[0]?.levels.length ?? 0
    if (t < 3 || t > 12) return 'analysis:doe.errLatin'
    return null
  }
  if (!Number.isInteger(spec.replicates) || spec.replicates < 1 || spec.replicates > 100)
    return 'analysis:doe.errReplicates'
  if (spec.type === 'crd' && spec.replicates < 2) return 'analysis:doe.errReplicates'
  if (spec.type === 'rcbd' && spec.replicates < 2) return 'analysis:doe.errReplicates'
  if (spec.type === 'splitplot' && spec.replicates < 2) return 'analysis:doe.errReplicates'
  return null
}

/** Field keys each design needs (beyond the response), and which are single. */
export const DOE_ROLES: Record<
  DoeDesignType,
  { key: string; single: boolean; optional?: boolean }[]
> = {
  crd: [{ key: 'treatment', single: true }],
  rcbd: [
    { key: 'treatment', single: true },
    { key: 'block', single: true }
  ],
  latin: [
    { key: 'treatment', single: true },
    { key: 'row', single: true },
    { key: 'column', single: true }
  ],
  factorial: [
    { key: 'factors', single: false },
    { key: 'block', single: true, optional: true }
  ],
  splitplot: [
    { key: 'mainFactor', single: true },
    { key: 'subFactor', single: true },
    { key: 'block', single: true }
  ],
  twok: [{ key: 'factors', single: false }]
}

export function doeAnalysisParams(
  design: DoeDesignType,
  a: Record<string, Variable[]>
): Record<string, unknown> | null {
  const one = (k: string) => (a[k] ?? [])[0]?.colId
  const resp = one('response')
  if (!resp) return null
  const p: Record<string, unknown> = { response: resp, design }
  for (const r of DOE_ROLES[design]) {
    if (r.single) {
      const c = one(r.key)
      if (!c && !r.optional) return null
      if (c) p[r.key] = c
    } else {
      const cs = (a[r.key] ?? []).map(v => v.colId)
      if (cs.length < 2 || cs.length > (design === 'twok' ? 6 : 3)) return null
      p[r.key] = cs
    }
  }
  return p
}
