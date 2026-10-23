// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Options sub-dialog state of SPSS's one-sample nonparametric tests
 * (Binomial, One-Sample K-S, Runs) — read by npar_listwise() and
 * npar_descriptives_table() in r-scripts/_bootstrap.R.
 */

import type { MissingStrategy } from '../_shared/MissingValuesSection'

export interface NparOneSampleOptions {
  descriptives: boolean
  quartiles: boolean
  missing: MissingStrategy
}

export const defaultNparOneSampleOptions: NparOneSampleOptions = {
  descriptives: false,
  quartiles: false,
  missing: 'analysis'
}
