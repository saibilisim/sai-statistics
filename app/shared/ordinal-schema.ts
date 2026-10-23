// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod'
import type { OrdinalSettings } from './ordinal-types'

const terms = z.array(
  z
    .array(z.string())
    .min(1)
    .refine(term => new Set(term).size === term.length)
)
export const OrdinalSettingsSchema = z.object({
  location: z
    .object({ mode: z.enum(['main', 'custom']), terms })
    .default({ mode: 'main', terms: [] }),
  scale: z.object({ terms }).default({ terms: [] }),
  options: z
    .object({
      maxIterations: z.number().int().min(0),
      maxStepHalving: z.number().int().min(1),
      logLikelihood: z.number().min(0),
      parameter: z.number().min(0),
      ciLevel: z.number().min(0).lt(100),
      delta: z.number().min(0).lt(1),
      singularity: z.number().positive(),
      link: z.enum(['logit', 'probit', 'cloglog', 'loglog', 'cauchit'])
    })
    .default({
      maxIterations: 100,
      maxStepHalving: 5,
      logLikelihood: 0,
      parameter: 1e-6,
      ciLevel: 95,
      delta: 0,
      singularity: 1e-8,
      link: 'logit'
    }),
  output: z
    .object({
      history: z.boolean(),
      historyEvery: z.number().int().min(1),
      goodnessOfFit: z.boolean(),
      summary: z.boolean(),
      estimates: z.boolean(),
      correlations: z.boolean(),
      covariances: z.boolean(),
      cellInfo: z.boolean(),
      parallelLines: z.boolean(),
      includeConstant: z.boolean()
    })
    .default({
      history: false,
      historyEvery: 1,
      goodnessOfFit: true,
      summary: true,
      estimates: true,
      correlations: false,
      covariances: false,
      cellInfo: false,
      parallelLines: false,
      includeConstant: true
    })
})

export const defaultOrdinalSettings: OrdinalSettings = OrdinalSettingsSchema.parse({})

/** Schema plus context-dependent predictor references. */
export function validOrdinalSettings(s: OrdinalSettings, predictors?: string[]): boolean {
  if (!OrdinalSettingsSchema.safeParse(s).success) return false
  const activeTerms = [...(s.location.mode === 'custom' ? s.location.terms : []), ...s.scale.terms]
  return !predictors || activeTerms.every(term => term.every(id => predictors.includes(id)))
}
