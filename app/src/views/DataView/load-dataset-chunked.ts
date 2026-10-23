// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * loadDatasetChunked — fetches a full dataset via a series of bounded
 * data:get-chunk requests instead of one data:get-all round trip
 * (chunked-load-roadmap.md C1/C2). Yields to the event loop between chunks
 * so the Renderer's UI thread never blocks for more than one chunk's worth
 * of structured-clone deserialization + processing — a 500K-row dataset
 * used to freeze the app for ~51s on a single data:get-all; this trades
 * total load time (somewhat higher, chunk-request overhead) for a UI that
 * never stops responding.
 */
import type { CellValue } from '@shared/data-types'

// UI decision, not main's concern (main only sees offset/limit) — see
// chunked-load-roadmap.md C1.5. Sized by CELL count, not row count, so a
// wide dataset doesn't produce a proportionally bigger per-chunk UI block.
// Measured empirically (chunked-load-roadmap.md C5, against the previous
// grid engine): 100K cells/chunk took ~850ms of synchronous per-chunk work
// (buildCellData + setValues), well past the <500ms-per-block target — cell
// processing here costs more than a bare structured-clone. 50K keeps chunks
// under that budget. NOTE: this benchmark predates the AG Grid migration
// (aggrid-gecis-roadmap.md), which removed most of that per-chunk paint
// cost — the constant hasn't been re-measured against AG Grid since.
const CHUNK_TARGET_CELLS = 50_000
const MIN_CHUNK_ROWS = 1_000
const MAX_CHUNK_ROWS = 50_000

interface ChunkTestOverride {
  chunkRowsOverride?: number
}

/** Exported for the e2e test hook (chunked-load-roadmap.md C5) — a real
 *  10-variable dataset would need 10K+ rows to exercise multiple chunks,
 *  impractical for a fast, deterministic e2e fixture. */
export function computeChunkRows(colCount: number): number {
  const override = (window as unknown as { __SAI_TEST__?: ChunkTestOverride }).__SAI_TEST__
    ?.chunkRowsOverride
  if (override) return override
  const target = Math.ceil(CHUNK_TARGET_CELLS / Math.max(1, colCount))
  return Math.min(MAX_CHUNK_ROWS, Math.max(MIN_CHUNK_ROWS, target))
}

/** NOT requestAnimationFrame — rAF throttles to near-zero in a backgrounded
 *  tab/window, which would stall the load indefinitely rather than just
 *  slow it down. setTimeout(0) yields exactly once to the event loop
 *  regardless of visibility. */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

export interface ChunkedLoadResult {
  rows: CellValue[][]
  totalRows: number
  aborted: boolean
}

/** Permanent case ids for a chunk, parallel to its rows (case-identity.ts).
 *  Absent only if main didn't send them (shouldn't happen; callers fall back
 *  to positional identity). */
export type ChunkCaseIds = number[] | undefined

export interface LoadDatasetChunkedOptions {
  datasetId: string
  colCount: number
  /** Called once per chunk, after it arrives and before the next chunk is
   *  requested — the caller does its own painting/accumulation here. */
  onChunk: (
    chunk: CellValue[][],
    offset: number,
    totalRows: number,
    caseIds: ChunkCaseIds
  ) => void | Promise<void>
  /** Checked before requesting each chunk (and once right after each
   *  response) — when true, fetching stops immediately without painting
   *  further. Callers pass their existing "is this init still current"
   *  check (activeInitIdRef) — no new staleness mechanism invented. */
  isStale: () => boolean
}

export async function loadDatasetChunked(
  opts: LoadDatasetChunkedOptions
): Promise<ChunkedLoadResult> {
  const { datasetId, colCount, onChunk, isStale } = opts
  const chunkRows = computeChunkRows(colCount)
  const allRows: CellValue[][] = []
  let offset = 0
  let totalRows = Number.POSITIVE_INFINITY

  while (offset < totalRows) {
    if (isStale()) {
      return { rows: allRows, totalRows: allRows.length, aborted: true }
    }

    const result = await window.api.data.getChunk({ datasetId, offset, limit: chunkRows })
    totalRows = result.totalRows

    if (isStale()) {
      return { rows: allRows, totalRows: allRows.length, aborted: true }
    }

    allRows.push(...result.rows)
    await onChunk(result.rows, offset, totalRows, result.caseIds)

    // Empty dataset, or a server-side inconsistency (fewer rows than
    // expected) — stop rather than looping forever on offset arithmetic.
    if (result.rows.length === 0) break

    offset += chunkRows
    await yieldToEventLoop()
  }

  return { rows: allRows, totalRows, aborted: false }
}
