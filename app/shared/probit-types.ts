// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Option shapes for Probit Analysis (SPSS's real PROBIT procedure — grouped
 * dose-response data, not a per-case binary model). Lives in shared/ for the
 * same reason as logistic-types.ts / survival-types.ts: the dialog, the
 * SPSS-syntax builder and the syntax dispatcher all have to agree on it.
 * regression-probit.R reads the same field names off `params`/`params.options`.
 *
 * NOT modelled here (documented omissions, not oversights):
 *   - "Relative median potency" — pairwise ED50-ratio comparison across
 *     Factor levels. A secondary elaboration on top of the fiducial ED table
 *     this file already computes; left out of this pass.
 *   - "Step limit" / "Optimality tolerance" (Criteria) — SPSS's own
 *     Newton-Raphson step-halving/line-search internals. R's glm()/optim()
 *     solvers have no equivalent knob, so a checkbox for them would be dead
 *     UI (same reasoning as skipping Logistic Regression's "Conserve memory").
 *     Maximum Iterations is the one Criteria field that maps onto something
 *     real (glm.control(maxit=) / optim()'s maxit).
 */

/** The single Transform applied uniformly to every listed covariate — SPSS's
 *  Probit dialog has one Transform dropdown under the whole Covariate(s) list,
 *  not one per covariate. */
export const PROBIT_TRANSFORMS = ['none', 'ln', 'log10', 'inverse', 'square', 'sqrt'] as const
export type ProbitTransform = (typeof PROBIT_TRANSFORMS)[number]

export const PROBIT_MODELS = ['probit', 'logit'] as const
export type ProbitModel = (typeof PROBIT_MODELS)[number]

export const PROBIT_NATURAL_RESPONSE_MODES = ['none', 'calculate', 'value'] as const
export type ProbitNaturalResponseMode = (typeof PROBIT_NATURAL_RESPONSE_MODES)[number]

export interface ProbitOptions {
  frequencies: boolean
  /** Only meaningful with a Factor of 2+ levels and at least one covariate. */
  parallelism: boolean
  fiducialCI: boolean
  /** SPSS's "significance level for use of heterogeneity factor" — the
   *  Pearson chi-square's own p-value threshold below which the fiducial
   *  limits are widened by a heterogeneity correction factor. */
  heterogeneitySig: number
  naturalResponseMode: ProbitNaturalResponseMode
  /** Only read when naturalResponseMode === 'value'. */
  naturalResponseValue: number | null
  maxIterations: number
}

export const defaultProbitOptions: ProbitOptions = {
  frequencies: true,
  parallelism: false,
  fiducialCI: true,
  heterogeneitySig: 0.15,
  naturalResponseMode: 'none',
  naturalResponseValue: null,
  maxIterations: 20
}
