// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * fetch-all-rows.ts — every row of a dataset (columns in variable order),
 * read through data:get-chunk in schema-sized pieces. A single
 * `getChunk({ limit: rowCount })` is rejected by the schema for an empty
 * dataset (limit 0) and for anything over MAX_CHUNK_ROWS — which broke
 * Compute Variable and the row-wise syntax commands (COMPUTE / IF / COUNT /
 * DO IF) on large datasets.
 */
import type { CellValue } from '@shared/data-types'
import { MAX_CHUNK_ROWS } from '@shared/ipc-schemas'

export async function fetchAllRows(datasetId: string, rowCount: number): Promise<CellValue[][]> {
  const rows: CellValue[][] = []
  for (let offset = 0; offset < rowCount; offset += MAX_CHUNK_ROWS) {
    const chunk = await window.api.data.getChunk({
      datasetId,
      offset,
      limit: Math.min(MAX_CHUNK_ROWS, rowCount - offset)
    })
    rows.push(...chunk.rows)
    if (chunk.rows.length === 0) break
  }
  return rows
}
