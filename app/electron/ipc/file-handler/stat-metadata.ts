// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * stat-metadata.ts — recovers variable/value labels from SPSS and Stata files.
 *
 * The DuckDB `read_stat` extension the importer uses returns data only; it
 * registers one table function and no metadata accessor, so a .sav file's
 * labels never reached us. R's `foreign` package (bundled with every R
 * installation, no new dependency) can read them, so this module runs
 * r-scripts/import-metadata.R as a side pass over the same file.
 *
 * Every failure path is silent by design — no R, no `foreign`, an unsupported
 * file version, a timeout: the import continues on values-based inference
 * (type-inference.ts) instead of failing. Labels are a bonus, not a
 * precondition.
 */

import { join, basename } from 'path'
import { z } from 'zod'
import log from 'electron-log'
import { MissingValuesSchema, type MissingValues } from '../../../shared/data-types'
import { isRReady, runRScript } from '../r-bridge'
import { rScriptsDir } from './shared'

/** What a source file tells us about one of its variables. */
export interface StatFileVariableMeta {
  /** The file's own variable label (SPSS "Label" column). */
  label?: string
  /** code → label, e.g. { "1": "Kadın", "2": "Erkek" }. */
  valueLabels?: Record<string, string>
  /** User-missing definition (SPSS "Missing" column). haven path only. */
  missing?: MissingValues
  /** Print format width/decimals (SPSS "F8.2"). haven path only. */
  width?: number
  decimals?: number
  /** Data View column width (SPSS "Columns"). haven path only. */
  columns?: number
}

/** Reading a whole .sav twice is not free; cap it rather than hang an import. */
const METADATA_TIMEOUT_MS = 60_000

const MetaResultSchema = z.object({
  variables: z
    .array(
      z.object({
        name: z.string(),
        label: z.string().optional(),
        // jsonlite writes an empty named list as {}, but a defensive [] from
        // an older/odd R build must not fail the whole parse.
        valueLabels: z.union([z.record(z.string(), z.string()), z.array(z.unknown())]).optional()
      })
    )
    .default([])
})

// Same markers as the analysis scripts (job-manager.ts owns the analysis-side
// copy of this regex; duplicated rather than exported because the two parse
// different payloads and should be free to diverge).
const RESULT_RE = /\n__SAI_RESULT__\n?([\s\S]+?)\n?__END_RESULT__\n/

/**
 * R on Windows writes CRLF, which the marker pattern's bare \n does not match —
 * the same normalisation job-manager.ts applies to analysis output, and for the
 * same reason. The padding covers a marker sitting at the very start or end of
 * the stream.
 */
function extractResultJson(stdout: string): string | null {
  const match = RESULT_RE.exec(`\n${stdout.replace(/\r\n/g, '\n')}\n`)
  return match?.[1]?.trim() ?? null
}

function statFormatFor(ext: string): 'spss' | 'stata' | null {
  if (ext === '.sav' || ext === '.zsav' || ext === '.por') return 'spss'
  if (ext === '.dta') return 'stata'
  // .sas7bdat / .xpt carry no value labels inside the data file itself
  // (SAS keeps them in a separate format catalog), so there is nothing to read.
  return null
}

/**
 * Returns a map keyed by the source variable name. Empty map = "nothing
 * recovered", which every caller must treat as normal.
 */
export async function readStatFileMetadata(
  filePath: string,
  ext: string
): Promise<Record<string, StatFileVariableMeta>> {
  const format = statFormatFor(ext)
  if (!format) return {}
  if (!isRReady()) {
    log.info('[stat-metadata] R unavailable — importing without file labels')
    return {}
  }

  try {
    const { stdout } = await runRScript({
      scriptPath: join(rScriptsDir(), 'import-metadata.R'),
      params: { file: filePath, format },
      timeoutMs: METADATA_TIMEOUT_MS
    })
    const json = extractResultJson(stdout)
    if (!json) {
      log.warn('[stat-metadata] no result marker in import-metadata.R output')
      return {}
    }
    const parsed = MetaResultSchema.safeParse(JSON.parse(json))
    if (!parsed.success) {
      log.warn('[stat-metadata] unexpected metadata shape', parsed.error)
      return {}
    }

    const out: Record<string, StatFileVariableMeta> = {}
    for (const v of parsed.data.variables) {
      const valueLabels = v.valueLabels && !Array.isArray(v.valueLabels) ? v.valueLabels : undefined
      const label = v.label && v.label.trim() !== '' ? v.label : undefined
      if (!label && !valueLabels) continue
      out[v.name] = { label, valueLabels }
    }
    log.info(
      `[stat-metadata] ${String(Object.keys(out).length)} labelled variable(s) recovered from ${basename(filePath)}`
    )
    return out
  } catch (err) {
    log.warn(`[stat-metadata] metadata pass failed for ${basename(filePath)}: ${String(err)}`)
    return {}
  }
}

/**
 * Per-variable metadata as _stat_columns.R `column_meta()` writes it — shared
 * by import-stat.R (haven) and the R console's sai_commit().
 */
export const StatVariablesSchema = z.array(
  z.object({
    name: z.string(),
    label: z.string().optional(),
    valueLabels: z.union([z.record(z.string(), z.string()), z.array(z.unknown())]).optional(),
    missing: MissingValuesSchema.nullable().optional(),
    width: z.number().int().positive().nullable().optional(),
    decimals: z.number().int().min(0).nullable().optional(),
    columns: z.number().int().positive().nullable().optional()
  })
)

/** Variable metadata list → map keyed by source column name. */
export function toStatMetaMap(
  variables: z.infer<typeof StatVariablesSchema>,
  includeLabels: boolean
): Record<string, StatFileVariableMeta> {
  const out: Record<string, StatFileVariableMeta> = {}
  for (const v of variables) {
    const valueLabels =
      includeLabels && v.valueLabels && !Array.isArray(v.valueLabels) ? v.valueLabels : undefined
    const label = includeLabels && v.label && v.label.trim() !== '' ? v.label : undefined
    out[v.name] = {
      label,
      valueLabels,
      missing: v.missing ?? undefined,
      width: v.width ?? undefined,
      decimals: v.decimals ?? undefined,
      columns: v.columns ?? undefined
    }
  }
  return out
}

const HavenImportResultSchema = z.union([
  z.object({ ok: z.literal(true), rows: z.number(), variables: StatVariablesSchema }),
  z.object({ ok: z.literal(false), error: z.string(), detail: z.string().optional() })
])

/** Import timeout: haven reads ~1M-row .sav files in seconds; this only
 *  guards against a hung R process. */
const HAVEN_IMPORT_TIMEOUT_MS = 10 * 60_000

/**
 * Reads a statistical file (SPSS/Stata/SAS) through r-scripts/import-stat.R
 * (haven), writing the rows to `parquetOut` and returning the file's own
 * variable metadata keyed by source column name. Returns null when the haven
 * path is unavailable (no R, no haven) or fails — the caller then falls back
 * to DuckDB's read_stat extension, the pre-haven importer.
 *
 * Unlike read_stat this keeps SPSS user-missing codes as values (9 stays 9)
 * together with their missing-value definitions, so a .sav round-trips.
 */
export async function importStatFileWithHaven(
  filePath: string,
  parquetOut: string,
  includeLabels: boolean
): Promise<Record<string, StatFileVariableMeta> | null> {
  if (!isRReady()) return null
  try {
    const { stdout } = await runRScript({
      scriptPath: join(rScriptsDir(), 'import-stat.R'),
      params: { file: filePath, out: parquetOut, rScriptsDir: rScriptsDir() },
      timeoutMs: HAVEN_IMPORT_TIMEOUT_MS
    })
    const json = extractResultJson(stdout)
    const parsed = HavenImportResultSchema.safeParse(json ? JSON.parse(json) : null)
    if (!parsed.success) {
      log.warn('[stat-import] unexpected import-stat.R result', parsed.error)
      return null
    }
    if (!parsed.data.ok) {
      log.warn(
        `[stat-import] haven import unavailable: ${parsed.data.error} ${parsed.data.detail ?? ''}`
      )
      return null
    }
    const out = toStatMetaMap(parsed.data.variables, includeLabels)
    log.info(`[stat-import] ${basename(filePath)}: ${String(parsed.data.rows)} rows via haven`)
    return out
  } catch (err) {
    log.warn(`[stat-import] haven import failed for ${basename(filePath)}: ${String(err)}`)
    return null
  }
}
