// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * case-identity.ts — permanent per-row identity for DataView metadata.
 *
 * Why this exists (dataview-denetim-raporu-2026-07-26.md §2): per-cell
 * metadata (formats and formulas in `customStyles`, stored in the .sdf, never
 * in DuckDB) used to be keyed by `r{dbRow}` — the row's POSITION in the DuckDB
 * table. But `data:insert-row`, `data:delete-rows`, `data:reorder-rows`,
 * `data:sort` and `data:sort-multi` all renumber `__row_idx`, so after any of
 * them a cell's bold/currency/formula belonged to whatever record had slid
 * into that slot. Worse, the formula recompute then wrote its result into that
 * wrong record's DuckDB cell — silent data corruption an analysis would read
 * as real.
 *
 * The fix is the row counterpart of the `col_{seq}` scheme columns already
 * use: a hidden `__case_id` column assigned once at import and never
 * renumbered (db-handler.ts). This module is the renderer's view of it — a
 * dbRow ↔ caseId translator plus the `r{caseId}` key builder, so every
 * metadata read/write in DataView goes through one place.
 *
 * Case ids equal row indices on a freshly imported dataset, which is exactly
 * what makes pre-__case_id .sdf files (whose keys are old row indices) reopen
 * with their formatting intact.
 */

export interface CaseIdentity {
  /** dbRow → permanent case id. Falls back to the row index itself when the
   *  map isn't populated (identity — matches a fresh import). */
  caseOfDb: (dbRow: number) => number
  /** Permanent case id → its current dbRow, or undefined if that case is no
   *  longer in the dataset (deleted row → a formula referencing it is #REF!). */
  dbOfCase: (caseId: number) => number | undefined
  /** `customStyles.cells` / AG-Grid row key for a dbRow. */
  keyOfDb: (dbRow: number) => string
  /** `customStyles.cells` key for a case id. */
  keyOfCase: (caseId: number) => string
  /** Drops every id — start of a full (re)load. */
  reset: () => void
  /** Appends one chunk's worth of ids, in dbRow order. */
  append: (ids: number[]) => void
  /** Replaces the whole map (row drag applies a permutation in one step). */
  setAll: (ids: number[]) => void
  /** Current ids, indexed by dbRow. */
  all: () => number[]
}

export function caseKey(caseId: number): string {
  return `r${String(caseId)}`
}

/**
 * Builds a CaseIdentity that OWNS its id array. Callers used to hand in a ref
 * and remember to invalidate the cached reverse map after every mutation —
 * one forgotten call and lookups go quietly stale. Keeping the array in here
 * makes invalidation automatic, and means no ref is touched during render.
 */
export function createCaseIdentity(): CaseIdentity {
  let ids: number[] = []
  let reverse: Map<number, number> | null = null

  const getReverse = (): Map<number, number> => {
    if (reverse) return reverse
    const m = new Map<number, number>()
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      if (id !== undefined) m.set(id, i)
    }
    reverse = m
    return m
  }

  const caseOfDb = (dbRow: number): number => ids[dbRow] ?? dbRow

  const dbOfCase = (caseId: number): number | undefined => {
    // Nothing loaded yet → identity view (case ids are row indices at import).
    if (ids.length === 0) return caseId
    return getReverse().get(caseId)
  }

  return {
    caseOfDb,
    dbOfCase,
    keyOfDb: dbRow => caseKey(caseOfDb(dbRow)),
    keyOfCase: caseKey,
    reset: () => {
      ids = []
      reverse = null
    },
    append: chunk => {
      ids.push(...chunk)
      reverse = null
    },
    setAll: next => {
      ids = next
      reverse = null
    },
    all: () => ids
  }
}
