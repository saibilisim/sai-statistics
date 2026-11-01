// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * project-code.ts — the Code tab's buffers as part of the project, stored in
 * the `.sdf` as code.json (2026-11-01).
 *
 * Code belongs to the data it was written for: reopening a file brings its
 * SPSS syntax and R script tabs back, and a new or imported dataset starts
 * with empty editors. Before this the buffers were one app-wide draft in
 * localStorage, so every dataset showed whatever the last one had left.
 */

import { z } from 'zod'

/** Generous for hand-written code; refuses a runaway buffer, not real work. */
const MAX_TEXT = 2_000_000

export const ProjectScriptSchema = z.object({
  name: z.string().min(1).max(260),
  source: z.string().max(MAX_TEXT),
  /** Text as last saved to `filePath`; differs from `source` = unsaved there. */
  saved: z.string().max(MAX_TEXT),
  /** Shown on the tab only: Save still asks where to write (Main writes only
   *  to paths picked in a dialog during the current session). */
  filePath: z.string().max(4096).nullable()
})

export const ProjectCodeSchema = z.object({
  syntax: z.string().max(MAX_TEXT),
  scripts: z.array(ProjectScriptSchema).min(1).max(50),
  activeScript: z.number().int().nonnegative()
})

export type ProjectScript = z.infer<typeof ProjectScriptSchema>
export type ProjectCode = z.infer<typeof ProjectCodeSchema>
