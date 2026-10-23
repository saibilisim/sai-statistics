// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * r-files.ts — R code the Files pane writes (2026-10-21): string literals for
 * paths and the call that reads a data file. Pure, unit-tested.
 */

/** An R string literal (JSON's escaping is valid R); Windows paths use `/`. */
export const rString = (s: string): string => JSON.stringify(s.replace(/\\/g, '/'))

export const SCRIPT_RE = /\.(r|rmd|qmd)$/i

/** `veri seti.csv` → `veri_seti` — a syntactic R name for the data read in. */
function objectName(file: string): string {
  const base = file.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._]/g, '_')
  return /^[A-Za-z]/.test(base) ? base : `x${base}`
}

/** The R call that reads a data file, or null for anything else. */
export function readCodeFor(file: string): string | null {
  const f = rString(file)
  const assign = (call: string): string => `${objectName(file)} <- ${call}`
  if (/\.csv$/i.test(file)) return assign(`read.csv(${f})`)
  if (/\.(tsv|txt)$/i.test(file)) return assign(`read.delim(${f})`)
  if (/\.xlsx?$/i.test(file)) return assign(`readxl::read_excel(${f})`)
  if (/\.z?sav$/i.test(file)) return assign(`haven::read_sav(${f})`)
  if (/\.dta$/i.test(file)) return assign(`haven::read_dta(${f})`)
  if (/\.rds$/i.test(file)) return assign(`readRDS(${f})`)
  if (/\.parquet$/i.test(file)) return assign(`arrow::read_parquet(${f})`)
  if (/\.(rdata|rda)$/i.test(file)) return `load(${f})`
  return null
}
