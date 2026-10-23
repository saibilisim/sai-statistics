// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * output-document.ts — the editable overlay applied on top of a
 * (zod-validated, immutable) AnalysisResult, plus the on-disk Output
 * document schema (stored inside the `.sdf` as output.json).
 *
 * `AnalysisResult` (analysis-types.ts) never changes shape or values — it is
 * R's validated output and the correctness guarantees (p-values, warnings)
 * live there. Deliberately structural-only overlay: hide/show rows and
 * columns, rename titles, transpose, adjust decimals. There is no per-cell
 * text override or per-cell formatting (bold/italic/color) — editing an
 * individual statistic's displayed text in a stats tool is a correctness
 * hazard (a silently hand-edited number looks identical to a real one), and
 * it made table selection fight with native text selection in practice.
 * Re-applied at render time by `src/lib/output-resolve.ts`.
 */

import { z } from 'zod'
import { AnalysisResultSchema } from './analysis-types'

export const TableEditsSchema = z
  .object({
    titleOverride: z.string().optional(),
    hiddenRows: z.array(z.number().int().nonnegative()).default([]),
    hiddenCols: z.array(z.number().int().nonnegative()).default([]),
    transposed: z.boolean().default(false),
    /** Overrides OUTPUT_DECIMALS for this table only; unset = default. */
    decimals: z.number().int().min(0).max(6).optional(),
    footnotes: z.array(z.string()).default([])
  })
  .loose()
export type TableEdits = z.infer<typeof TableEditsSchema>

export const BlockEditsSchema = z
  .object({
    titleOverride: z.string().optional(),
    hidden: z.boolean().default(false),
    userNote: z.string().optional(),
    /** Table index within the block's result.tables[] → its edits. */
    tables: z.record(z.string(), TableEditsSchema).default({})
  })
  .loose()
export type BlockEdits = z.infer<typeof BlockEditsSchema>

export const OutputDocItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('block'), id: z.string() }),
  z.object({ kind: z.literal('heading'), id: z.string(), text: z.string() }),
  z.object({ kind: z.literal('text'), id: z.string(), text: z.string() }),
  z.object({ kind: z.literal('pageBreak'), id: z.string() })
])
export type OutputDocItem = z.infer<typeof OutputDocItemSchema>

export const OutputAiNoteSchema = z.object({
  text: z.string(),
  createdAt: z.string()
})

/** Serializable counterpart of `OutputBlock` (output-store.ts) — the same
 *  shape minus the runtime-only `isCollapsed` UI flag. */
export const OutputBlockDocSchema = z.object({
  id: z.string(),
  analysisId: z.string(),
  titleKey: z.string(),
  timestamp: z.string(),
  datasetName: z.string(),
  result: AnalysisResultSchema,
  aiNote: OutputAiNoteSchema.optional(),
  /** Auto header's variable/parameter summary line and its SPSS syntax. */
  summary: z.string().optional(),
  syntax: z.string().optional()
})
export type OutputBlockDoc = z.infer<typeof OutputBlockDocSchema>

/** `.sdf`'s `output.json` — the whole Output tab, reopenable as-is
 *  (blocks + ordering + every edit made on top of them). Plot payloads
 *  (already JSON-safe: Plotly JSON or base64 png/svg per `OutputPlotSchema`)
 *  stay inlined in `result.plots` rather than split into separate zip
 *  entries — unlike `.sdf`'s columnar dataset there is no large binary
 *  payload here that would benefit from Parquet-style separation, and one
 *  JSON blob keeps open/save trivially atomic. */
export const OutputDocumentSchema = z.object({
  formatVersion: z.literal(1),
  savedAt: z.string(),
  /** 'chronological' (oldest first, since 2026-10-18); absent = an older file
   *  whose items are newest-first — reversed on load. Older app versions drop
   *  the unknown field and show such a file upside down, nothing is lost. */
  itemOrder: z.literal('chronological').optional(),
  items: z.array(OutputDocItemSchema).default([]),
  blocks: z.array(OutputBlockDocSchema).default([]),
  edits: z.record(z.string(), BlockEditsSchema).default({})
})
export type OutputDocument = z.infer<typeof OutputDocumentSchema>
