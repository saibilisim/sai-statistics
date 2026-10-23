// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Option shapes for Bivariate Correlations (SPSS's main Correlate dialog +
 * its Options sub-dialog).
 *
 * Lives in shared/ for the same reason as regression-types.ts: the dialog
 * that collects these, the SPSS-syntax builder that pastes them, and the
 * syntax dispatcher that parses pasted syntax back into an `analysis:run`
 * payload all have to agree on the shape. correlation.R reads the same field
 * names off `params.options`.
 */

export interface CorrelateOptions {
  missing: 'pairwise' | 'listwise'
  /** One-tailed halves the two-tailed p (assumes the observed sign is the
   *  hypothesised direction) — SPSS's own convention, not a directional test. */
  oneTailed: boolean
  /** Appends *(p<.05)/**(p<.01) to the printed correlation value. */
  flagSignificant: boolean
  meansAndSD: boolean
  /** Sum-of-squares-and-cross-products + Covariance rows — Pearson only
   *  (rank coefficients have no cross-product-deviation concept). */
  crossProduct: boolean
}

export const defaultCorrelateOptions: CorrelateOptions = {
  missing: 'pairwise',
  oneTailed: false,
  flagSignificant: true,
  meansAndSD: false,
  crossProduct: false
}
