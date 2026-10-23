// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod'

// --- Standard output shapes ---

export const OutputTableSchema = z.object({
  titleKey: z.string(), // i18n key — Renderer çevirir
  columns: z.array(z.string()), // column i18n keys
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
  footnoteKey: z.string().nullish() // R NULL → JSON null → optional in TS
})
export type OutputTable = z.infer<typeof OutputTableSchema>

export const OutputPlotSchema = z.object({
  titleKey: z.string(),
  type: z.enum(['plotly', 'png', 'svg']),
  // Plotly JSON veya base64 encoded image
  data: z.unknown()
})
export type OutputPlot = z.infer<typeof OutputPlotSchema>

// Case-level output an analysis can turn into a new dataset column (Cox XBeta,
// KM S(t), regression residuals, cluster membership...). This is the ONLY
// per-case channel in the result contract; everything else here is display-only.
//
// `rowIndex` is not decoration. An analysis drops cases — listwise missing plus
// the weight/split/user-missing filters analysis-handler injects — so `values`
// is indexed over the ANALYSIS's rows, not the dataset's. Each value therefore
// carries the dataset row it came from (`__row_idx`, which R already receives
// in the Parquet export). Without it the column lands on the wrong cases and
// nothing in the output looks wrong.
//
// Note this is NOT SPSS's "Save": nothing is written to disk. The column is
// added to the active dataset exactly like Transform > Compute Variable, is
// undoable, and the user saves the file separately if they want to.
export const CaseVarSchema = z.object({
  name: z.string().min(1), // the user's chosen variable name
  label: z.string().default(''),
  type: z.enum(['numeric', 'string']).default('numeric'),
  measure: z.enum(['scale', 'nominal', 'ordinal']).default('scale'),
  decimals: z.number().int().min(0).max(16).default(3),
  values: z.array(z.union([z.string(), z.number(), z.null()])),
  rowIndex: z.array(z.number().int().min(0))
})
export type CaseVar = z.infer<typeof CaseVarSchema>

export const AnalysisResultSchema = z.object({
  modelXml: z.string().optional(),
  success: z.boolean(),
  tables: z.array(OutputTableSchema).default([]),
  plots: z.array(OutputPlotSchema).default([]),
  caseVars: z.array(CaseVarSchema).default([]),
  warnings: z.array(z.string()).default([]), // i18n keys
  notes: z.array(z.string()).default([]) // i18n keys
})
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>

// --- Base analysis params ---

export const BaseAnalysisParamsSchema = z.object({
  datasetId: z.string(),
  analysisId: z.string()
})
export type BaseAnalysisParams = z.infer<typeof BaseAnalysisParamsSchema>
