// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GLM option state shared by the Univariate and Multivariate dialogs — the
 * types, SPSS defaults, and the options payload glm_univariate_core() reads
 * (r-scripts/_glm_univariate_core.R). The sub-dialog components live in
 * GlmSubDialogs.tsx.
 */

import type { NewVarSlot } from '../../components/Dialogs/NewVariablesPanel'

export type SSType = 'I' | 'II' | 'III' | 'IV'
export type CiAdjust = 'none' | 'bonferroni' | 'sidak'
export type ContrastType =
  | 'none'
  | 'deviation'
  | 'simple'
  | 'difference'
  | 'helmert'
  | 'repeated'
  | 'polynomial'
export type ContrastRef = 'first' | 'last'

export interface ModelOptions {
  ssType: SSType
  includeIntercept: boolean
}
export interface PostHocOptions {
  factors: string[]
  lsd: boolean
  bonferroni: boolean
  sidak: boolean
  scheffe: boolean
  tukey: boolean
  gamesHowell: boolean
  tamhaneT2: boolean
  dunnettT3: boolean
  dunnettC: boolean
  snk: boolean
  duncan: boolean
  regwQ: boolean
  wallerDuncan: boolean
  wallerK: string
  dunnett: boolean
  dunnettControl: ContrastRef
}
export interface EmMeansOptions {
  terms: string[]
  compareMainEffects: boolean
  ciAdjust: CiAdjust
}
export interface GlmOptions {
  descriptives: boolean
  effectSize: boolean
  power: boolean
  paramEstimates: boolean
  homogeneity: boolean
  sigLevel: string
}
export interface ContrastSpec {
  type: ContrastType
  reference: ContrastRef
}
export type ContrastsOptions = Record<string, ContrastSpec>

export const GLM_NEW_VARS: NewVarSlot[] = [
  { key: 'predicted', labelKey: 'analysis:regression.newVar.predicted', defaultName: 'pre' },
  { key: 'residual', labelKey: 'analysis:regression.newVar.residual', defaultName: 'res' },
  { key: 'standardized', labelKey: 'analysis:regression.newVar.standardized', defaultName: 'zre' },
  { key: 'studentized', labelKey: 'analysis:regression.newVar.studentized', defaultName: 'sre' },
  { key: 'deleted', labelKey: 'analysis:regression.newVar.deleted', defaultName: 'sdr' },
  { key: 'leverage', labelKey: 'analysis:regression.newVar.leverage', defaultName: 'lev' },
  { key: 'cooks', labelKey: 'analysis:regression.newVar.cooks', defaultName: 'coo' }
]

export const defaultModel: ModelOptions = { ssType: 'III', includeIntercept: true }
export const defaultPostHoc: PostHocOptions = {
  factors: [],
  lsd: false,
  bonferroni: false,
  sidak: false,
  scheffe: false,
  tukey: false,
  gamesHowell: false,
  tamhaneT2: false,
  dunnettT3: false,
  dunnettC: false,
  snk: false,
  duncan: false,
  regwQ: false,
  wallerDuncan: false,
  wallerK: '100',
  dunnett: false,
  dunnettControl: 'last'
}
export const defaultEmMeans: EmMeansOptions = {
  terms: [],
  compareMainEffects: false,
  ciAdjust: 'none'
}
export const defaultOptions: GlmOptions = {
  descriptives: false,
  effectSize: false,
  power: false,
  paramEstimates: false,
  homogeneity: false,
  sigLevel: '0.05'
}
export const defaultContrastSpec: ContrastSpec = { type: 'none', reference: 'last' }
export const CONTRAST_TYPE_LABEL_KEYS = {
  none: 'analysis:glmUni.contrastNone',
  deviation: 'analysis:glmUni.contrastDeviation',
  simple: 'analysis:glmUni.contrastSimple',
  difference: 'analysis:glmUni.contrastDifference',
  helmert: 'analysis:glmUni.contrastHelmert',
  repeated: 'analysis:glmUni.contrastRepeated',
  polynomial: 'analysis:glmUni.contrastPolynomial'
} as const satisfies Record<ContrastType, string>

export interface GlmDialogState {
  model: ModelOptions
  postHoc: PostHocOptions
  emMeans: EmMeansOptions
  options: GlmOptions
  contrasts: ContrastsOptions
}

/** The params.options object glm_univariate_core() reads — one builder for
 *  every GLM dialog, so they cannot drift in what they send. */
export function glmOptionsPayload(
  { model, postHoc, emMeans, options, contrasts }: GlmDialogState,
  facs: { colId: string }[]
) {
  return {
    ssType: model.ssType,
    includeIntercept: model.includeIntercept,
    sigLevel: options.sigLevel,
    descriptives: options.descriptives,
    effectSize: options.effectSize,
    power: options.power,
    paramEstimates: options.paramEstimates,
    homogeneity: options.homogeneity,
    ...(postHoc.factors.length > 0
      ? {
          postHoc: {
            factors: postHoc.factors,
            lsd: postHoc.lsd,
            bonferroni: postHoc.bonferroni,
            sidak: postHoc.sidak,
            scheffe: postHoc.scheffe,
            tukey: postHoc.tukey,
            gamesHowell: postHoc.gamesHowell,
            tamhaneT2: postHoc.tamhaneT2,
            dunnettT3: postHoc.dunnettT3,
            dunnettC: postHoc.dunnettC,
            snk: postHoc.snk,
            duncan: postHoc.duncan,
            regwQ: postHoc.regwQ,
            wallerDuncan: postHoc.wallerDuncan,
            wallerK: postHoc.wallerK,
            dunnett: postHoc.dunnett,
            dunnettControl: postHoc.dunnettControl
          }
        }
      : {}),
    ...(emMeans.terms.length > 0
      ? {
          emMeans: {
            terms: emMeans.terms,
            compareMainEffects: emMeans.compareMainEffects,
            ciAdjust: emMeans.ciAdjust
          }
        }
      : {}),
    ...(Object.keys(contrasts).length > 0
      ? {
          contrasts: Object.fromEntries(
            facs
              .map(v => [v.colId, contrasts[v.colId]] as const)
              .filter(
                (entry): entry is [string, ContrastSpec] =>
                  entry[1] !== undefined && entry[1].type !== 'none'
              )
          )
        }
      : {})
  }
}
