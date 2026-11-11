// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Confirmatory Factor Analysis dialog state, the `options` payload cfa.R
 * reads, and the "import from EFA" mapping.
 */
import type { AnalysisResult } from '@shared/analysis-types'
import type { Variable } from '@shared/data-types'

export type CfaEstimator = 'auto' | 'ml' | 'mlr' | 'wlsmv'

export interface CfaOptions {
  estimator: CfaEstimator
  /** 'marker' fixes each factor's first loading at 1; 'std' fixes factor variances at 1. */
  identification: 'marker' | 'std'
  correlated: boolean
  missingMethod: 'listwise' | 'fiml'
  /** Residual covariances to free, as colId pairs. */
  errorCov: [string, string][]
  reliability: boolean
  fornell: boolean
  htmt: boolean
  mi: boolean
  miMin: string
  diagram: boolean
  invariance: boolean
}

export const defaultCfaOptions: CfaOptions = {
  estimator: 'auto',
  identification: 'marker',
  correlated: true,
  missingMethod: 'listwise',
  errorCov: [],
  reliability: true,
  fornell: true,
  htmt: true,
  mi: false,
  miMin: '3.84',
  diagram: true,
  invariance: true
}

export function cfaOptionParams(
  o: CfaOptions,
  itemIds: readonly string[]
): Record<string, unknown> {
  const miMin = Number(o.miMin)
  const items = new Set(itemIds)
  return {
    estimator: o.estimator,
    identification: o.identification,
    correlated: o.correlated,
    missingMethod: o.missingMethod,
    // A pair whose item has since left every factor would only be dropped by
    // R; leave it out here so the payload says what the model contains.
    errorCov: o.errorCov.filter(([a, b]) => items.has(a) && items.has(b)),
    reliability: o.reliability,
    fornell: o.fornell,
    htmt: o.htmt,
    mi: o.mi,
    miMin: Number.isFinite(miMin) && miMin > 0 ? miMin : 3.84,
    diagram: o.diagram,
    invariance: o.invariance
  }
}

export interface CfaFactor {
  /** Stable field key in the dialog (f1, f2 …). */
  id: string
  name: string
}

/** Loading tables of a Factor Analysis result, most useful first. */
const EFA_LOADING_TABLES = [
  'output.factor.patternMatrixTitle',
  'output.factor.rotatedFactorMatrixTitle',
  'output.factor.rotatedMatrixTitle',
  'output.factor.factorMatrixTitle',
  'output.factor.matrixTitle'
]

/**
 * Turn the newest Factor Analysis result into a CFA assignment: every
 * variable goes to the factor it loads highest on (absolute value; a loading
 * the EFA suppressed counts as zero). Factors left without items are dropped.
 * Rows are matched to variables by name, as the EFA table prints them.
 * Returns null when there is no usable EFA result.
 */
export function efaToCfaAssignment(
  blocks: readonly { analysisId: string; result: AnalysisResult }[],
  variables: readonly Variable[]
): { factorCount: number; assignment: string[][] } | null {
  const efa = blocks.find(b => b.analysisId === 'factor' && b.result.success)
  if (!efa) return null
  const table = EFA_LOADING_TABLES.map(key =>
    efa.result.tables.find(t => t.titleKey.split(':')[0] === key)
  ).find(t => t !== undefined)
  if (!table) return null
  const nFactors = table.columns.length - 1
  if (nFactors < 1) return null
  const byName = new Map(variables.map(v => [v.name, v.colId]))
  const groups: string[][] = Array.from({ length: nFactors }, () => [])
  for (const row of table.rows) {
    const colId = typeof row[0] === 'string' ? byName.get(row[0]) : undefined
    if (!colId) continue
    let best = -1
    let bestAbs = -1
    for (let j = 1; j <= nFactors; j++) {
      const v = row[j]
      const a = typeof v === 'number' ? Math.abs(v) : 0
      if (a > bestAbs) {
        bestAbs = a
        best = j - 1
      }
    }
    if (best >= 0 && bestAbs > 0) groups[best]?.push(colId)
  }
  const assignment = groups.filter(g => g.length > 0)
  return assignment.length > 0 ? { factorCount: assignment.length, assignment } : null
}
