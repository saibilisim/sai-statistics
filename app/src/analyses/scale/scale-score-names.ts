// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { makeUniqueVariableName, sanitizeVariableName } from '@shared/variable-name'

/** createVars slot -> a valid, unused variable name derived from the subscale name. */
export function scoreVarNames(
  names: { slot: string; base: string }[],
  existing: readonly string[]
): Record<string, string> {
  const used = [...existing]
  const out: Record<string, string> = {}
  names.forEach((n, i) => {
    const name = makeUniqueVariableName(sanitizeVariableName(n.base, i + 1), used)
    used.push(name)
    out[n.slot] = name
  })
  return out
}

/** Optional whole-number response range; empty = taken from the data. */
export function parseRange(min: string, max: string): Record<string, number> {
  const out: Record<string, number> = {}
  const lo = Number(min)
  const hi = Number(max)
  if (min.trim() !== '' && Number.isFinite(lo)) out.scaleMin = lo
  if (max.trim() !== '' && Number.isFinite(hi)) out.scaleMax = hi
  return out
}
