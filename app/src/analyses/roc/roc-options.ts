// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Options-sub-dialog state shared by ROC Curve and ROC Analysis, and the
 * payload both R scripts read through roc_read_options() in _bootstrap.R.
 */

export interface RocOptions {
  cutoff: 'include' | 'exclude'
  direction: 'larger' | 'smaller'
  distribution: 'free' | 'negexpo'
  /** Confidence level in percent, as typed (SPSS asks for "95", not 0.95). */
  ciLevel: string
  userMissing: 'exclude' | 'include'
}

export const defaultRocOptions: RocOptions = {
  cutoff: 'include',
  direction: 'larger',
  distribution: 'free',
  ciLevel: '95',
  userMissing: 'exclude'
}

/** The confidence level as a 0–1 fraction; anything outside (0, 100) is 95%. */
export function rocCiFraction(o: RocOptions): number {
  const pct = Number(o.ciLevel)
  return pct > 0 && pct < 100 ? pct / 100 : 0.95
}

/** The `options` keys both R scripts read through roc_read_options(). */
export function rocOptionParams(o: RocOptions) {
  return {
    cutoff: o.cutoff,
    direction: o.direction,
    distribution: o.distribution,
    ciLevel: rocCiFraction(o),
    userMissingValid: o.userMissing === 'include'
  }
}
