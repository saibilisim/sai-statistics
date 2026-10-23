// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * use-formulas.ts — cell-formula orchestration for DataView (the "=A7+B7"
 * feature). The pure engine is src/lib/formula.ts; this hook is the AG-Grid /
 * store wiring around it.
 *
 * Model (decided in the roadmap thread, then upgraded to Excel-like stability):
 *  - A formula lives ONLY in `customStyles.cells[rowId][colId].formula`
 *    (local .sdf), never in DuckDB. DuckDB stores the evaluated value, so
 *    analyses/R read a plain number — the SPSS data model is untouched.
 *  - Recalc is "recompute EVERY formula cell on any edit" (v1). Formula cells
 *    are sparse, so a fixpoint pass over just them is cheap; a pass cap gives
 *    crude cycle protection without a dependency graph (deferred v2).
 *  - **Row references are bound to PERMANENT CASE IDENTITY (`__case_id`), not
 *    screen position and not the DuckDB row index** — the "true Excel
 *    behaviour" upgrade. A formula the user types as `=B2` (what they see) is
 *    stored with its row remapped to the underlying record's case id,
 *    evaluated by translating that id back to the record's current dbRow in
 *    `allRowsRef`, and displayed translated to its current visible position.
 *    So sorting/filtering — and, since case ids never get renumbered, also row
 *    insert/delete/reorder — never change which record a formula reads.
 *    Referencing a deleted case yields blank rather than silently retargeting
 *    whichever row slid into that slot (denetim raporu §2). Column references
 *    are likewise bound to the stable `col_{seq}` ordinal.
 */
import { useCallback, useRef } from 'react'
import type { TFunction } from 'i18next'
import type { GridApi } from 'ag-grid-community'
import type { CellValue, Variable, CellFormat } from '@shared/data-types'
import { useDatasetStore } from '../../store/dataset-store'
import { toDbRow } from '../../lib/data-grid'
import type { CaseIdentity } from './case-identity'
import { prepareCellEdit } from '../../lib/aggrid-data'
import {
  evaluateFormula,
  isFormula,
  remapReferences,
  type FormulaResult,
  type RefResolver
} from '../../lib/formula'

export interface UseFormulasParams {
  gridApiRef: React.RefObject<GridApi<CellValue[]> | null>
  /** All rows in DB order (index === dbRow) — formulas resolve against this so
   *  references are position-independent (survive sort/filter). Row objects are
   *  shared with rowsRef, so writing here also updates the visible grid. */
  allRowsRef: React.RefObject<CellValue[][]>
  visibleToOriginalIndexRef: React.RefObject<number[]>
  /** dbRow ↔ permanent case id translator — formulas store case ids. */
  caseIdentity: CaseIdentity
  showValueLabels: boolean
  warnCell: (message: string) => void
  t: TFunction
}

export interface CommitResult {
  ok: boolean
  /** Value to place in the row array / show in the cell (result, or the error
   *  code string like "#DIV/0!" for a failed formula). */
  display: CellValue
}

export function useFormulas(params: UseFormulasParams) {
  const {
    gridApiRef,
    allRowsRef,
    visibleToOriginalIndexRef,
    caseIdentity,
    showValueLabels,
    warnCell,
    t
  } = params

  // ── Visible ↔ permanent case-id mapping ─────────────────────────────────
  const visibleToCase = useCallback(
    (visRow: number): number =>
      caseIdentity.caseOfDb(toDbRow(visRow, visibleToOriginalIndexRef.current)),
    [visibleToOriginalIndexRef, caseIdentity]
  )

  // Cached reverse map (dbRow → visible), rebuilt only when the underlying
  // visible-order array identity changes (applyViewAndSet reassigns it), so a
  // fill of many cells reuses one build.
  const reverseCacheRef = useRef<{ src: number[]; rev: Map<number, number> } | null>(null)
  const getReverse = useCallback((): Map<number, number> => {
    const src = visibleToOriginalIndexRef.current
    if (reverseCacheRef.current?.src === src) return reverseCacheRef.current.rev
    const rev = new Map<number, number>()
    src.forEach((db, vis) => rev.set(db, vis))
    reverseCacheRef.current = { src, rev }
    return rev
  }, [visibleToOriginalIndexRef])

  const caseToVisible = useCallback(
    (caseId: number): number | undefined => {
      const dbRow = caseIdentity.dbOfCase(caseId)
      if (dbRow === undefined) return undefined // case deleted
      const map = visibleToOriginalIndexRef.current
      if (map.length === 0) return dbRow // identity view (no sort/filter)
      return getReverse().get(dbRow)
    },
    [visibleToOriginalIndexRef, getReverse, caseIdentity]
  )

  // ── Column position ↔ stable colId (via the "col_<seq>" id, db-handler.ts) ─
  // A STORED formula encodes each column as a stable column-ordinal letter
  // (getColumnLetter(colSeq-1)), so column reorder/insert/delete never repoints
  // a formula — the row-identity model's exact counterpart for columns.
  const colSeqOfIndex = useCallback((colIndex: number): number | null => {
    const v = useDatasetStore.getState().variables[colIndex]
    if (!v) return null
    const m = /^col_(\d+)$/.exec(v.colId)
    return m?.[1] ? parseInt(m[1], 10) : null
  }, [])
  const colIndexOfSeq = useCallback((seq: number): number => {
    return useDatasetStore.getState().variables.findIndex(v => v.colId === `col_${String(seq)}`)
  }, [])

  /** Resolver over permanent identity: a STORED formula's column is a colSeq-1
   *  ordinal and its row is a case id — neither moves when rows or columns are
   *  inserted, deleted, reordered or sorted. */
  const resolve = useCallback<RefResolver>(
    (storedCol, caseId) => {
      const idx = colIndexOfSeq(storedCol + 1)
      if (idx < 0) return null // column deleted → blank
      const dbRow = caseIdentity.dbOfCase(caseId)
      if (dbRow === undefined) return null // case deleted → blank
      return allRowsRef.current[dbRow]?.[idx] ?? null
    },
    [allRowsRef, colIndexOfSeq, caseIdentity]
  )

  /** Turns a formula result into the cell value (`display`) and the DuckDB
   *  value (`db`). Booleans → 1/0. Text/error in a numeric column can't be
   *  stored, so `db` is null there while `display` still shows it. */
  const materialize = useCallback(
    (res: FormulaResult, variable: Variable): { display: CellValue; db: CellValue } => {
      if (!res.ok) return { display: res.error, db: null }
      const v: CellValue = typeof res.value === 'boolean' ? (res.value ? 1 : 0) : res.value
      const dbInvalid =
        variable.type === 'numeric' && typeof v === 'string' && Number.isNaN(Number(v))
      return { display: v, db: dbInvalid ? null : v }
    },
    []
  )

  const getCellFormula = useCallback(
    (dbRow: number, colId: string): string | undefined => {
      return useDatasetStore.getState().customStyles?.cells?.[caseIdentity.keyOfDb(dbRow)]?.[colId]
        ?.formula
    },
    [caseIdentity]
  )

  /** The stored formula translated to CURRENT visible positions, for showing
   *  in the formula bar (a record now at screen row 8 shows `=B8`, Excel-style). */
  const getDisplayFormula = useCallback(
    (dbRow: number, colId: string): string | undefined => {
      const stored = getCellFormula(dbRow, colId)
      if (stored === undefined) return undefined
      return remapReferences(stored, (col, caseId) => {
        const idx = colIndexOfSeq(col + 1) // stored col is colSeq-1
        const vis = caseToVisible(caseId)
        // -1 → #REF! for a deleted column or a deleted case
        return { col: idx < 0 ? -1 : idx, row: vis ?? -1 }
      })
    },
    [getCellFormula, caseToVisible, colIndexOfSeq]
  )

  /** Writes (or clears, with `null`) a cell's formula in customStyles. */
  const setCellFormula = useCallback(
    (dbRow: number, colId: string, formula: string | null) => {
      const existing = useDatasetStore.getState().customStyles
      const cells: Record<string, Record<string, CellFormat>> = { ...(existing?.cells ?? {}) }
      const rowId = caseIdentity.keyOfDb(dbRow)
      const rowCells = { ...(cells[rowId] ?? {}) }
      const cell: CellFormat = { ...(rowCells[colId] ?? {}) }
      if (formula === null) delete cell.formula
      else cell.formula = formula
      rowCells[colId] = cell
      cells[rowId] = rowCells
      useDatasetStore.getState().setCustomStyles({ cells })
      useDatasetStore.getState().setModified(true)
    },
    [caseIdentity]
  )

  /**
   * Recomputes every formula cell against `allRowsRef` (stable), writes results
   * into the shared row objects (so the visible grid updates), persists DB-safe
   * values, and repaints (content-only — no flash). A fixpoint loop resolves
   * formula→formula chains; the pass cap stops runaway cycles.
   */
  const recomputeFormulas = useCallback(() => {
    const cellsMap = useDatasetStore.getState().customStyles?.cells
    if (!cellsMap) return
    const freshVars = useDatasetStore.getState().variables
    const colIndexById = new Map(freshVars.map((v, i) => [v.colId, i]))

    interface FC {
      dbRow: number
      colId: string
      colIndex: number
      formula: string
      variable: Variable
      db: CellValue
    }
    const fcs: FC[] = []
    for (const [rowId, cols] of Object.entries(cellsMap)) {
      const caseId = parseInt(rowId.slice(1), 10)
      if (Number.isNaN(caseId)) continue
      // The case this formula belongs to may have been deleted — skip it
      // rather than writing its result into whatever row now sits at that
      // index (the corruption path fixed in denetim raporu §2).
      const dbRow = caseIdentity.dbOfCase(caseId)
      if (dbRow === undefined) continue
      for (const [colId, fmt] of Object.entries(cols)) {
        const formula = fmt.formula
        if (!formula) continue
        const colIndex = colIndexById.get(colId)
        if (colIndex === undefined) continue
        const variable = freshVars[colIndex]
        if (!variable) continue
        fcs.push({ dbRow, colId, colIndex, formula, variable, db: null })
      }
    }
    if (fcs.length === 0) return

    const maxPasses = Math.min(Math.max(fcs.length, 1), 25)
    let changed = true
    let passes = 0
    while (changed && passes < maxPasses) {
      changed = false
      passes++
      for (const fc of fcs) {
        const res = evaluateFormula(fc.formula, resolve)
        const { display, db } = materialize(res, fc.variable)
        fc.db = db
        const rowArr = allRowsRef.current[fc.dbRow]
        if (!rowArr) continue
        if (rowArr[fc.colIndex] !== display) {
          rowArr[fc.colIndex] = display
          changed = true
        }
      }
    }

    gridApiRef.current?.refreshCells({ force: true })

    const dsId = useDatasetStore.getState().datasetId
    if (dsId) {
      const updates = fcs.map(fc => ({ rowIndex: fc.dbRow, colId: fc.colId, value: fc.db }))
      void window.api.data.updateCells({ datasetId: dsId, updates }).catch((err: unknown) => {
        console.error('Formula persist failed:', err)
      })
    }
  }, [gridApiRef, allRowsRef, resolve, materialize, caseIdentity])

  /**
   * Commits raw typed input to a cell (inline valueSetter + formula bar): a
   * leading "=" stores + evaluates a formula; anything else stores a plain
   * value and clears any formula. The typed formula's row references are
   * VISIBLE positions — they're remapped to stable dbRows before storing.
   */
  const commitCellInput = useCallback(
    (dbRow: number, colIndex: number, raw: string): CommitResult => {
      const variable = useDatasetStore.getState().variables[colIndex]
      if (!variable) return { ok: false, display: null }

      if (isFormula(raw)) {
        // Bind visible-position references (col = current index, row = visible)
        // to stable identity (col = colSeq-1, row = dbRow) before storing.
        const stored = remapReferences(raw, (col, row) => {
          const seq = colSeqOfIndex(col)
          return { col: seq === null ? col : seq - 1, row: visibleToCase(row) }
        })
        setCellFormula(dbRow, variable.colId, stored)
        const { display } = materialize(evaluateFormula(stored, resolve), variable)
        return { ok: true, display }
      }

      // Plain value. Guard the double-click→Enter-unchanged case: if the cell
      // has a formula and the typed text equals the current result's display,
      // the user didn't actually change anything — keep the formula.
      const existingFormula = getCellFormula(dbRow, variable.colId)
      if (existingFormula) {
        const currentDisplay = allRowsRef.current[dbRow]?.[colIndex] ?? null
        if (String(currentDisplay ?? '') === raw.trim()) {
          return { ok: true, display: currentDisplay }
        }
        setCellFormula(dbRow, variable.colId, null) // genuine replacement
      }

      const result = prepareCellEdit(raw, variable, showValueLabels)
      if (!result.ok) {
        warnCell(t('dataset.numericInvalid'))
        return { ok: false, display: null }
      }
      return { ok: true, display: result.value }
    },
    [
      resolve,
      materialize,
      setCellFormula,
      getCellFormula,
      allRowsRef,
      showValueLabels,
      visibleToCase,
      colSeqOfIndex,
      warnCell,
      t
    ]
  )

  /** Stores an (already stable / db-form) formula on a target cell and returns
   *  its evaluated display value — used by formula-aware fill. */
  const applyFormulaToCell = useCallback(
    (dbRow: number, colIndex: number, formula: string): CellValue => {
      const variable = useDatasetStore.getState().variables[colIndex]
      if (!variable) return null
      setCellFormula(dbRow, variable.colId, formula)
      const { display } = materialize(evaluateFormula(formula, resolve), variable)
      return display
    },
    [setCellFormula, materialize, resolve]
  )

  /**
   * Fill-shift for a STORED (db-form) formula: the relative move happens in
   * VISIBLE space (fill is a screen operation) then re-binds to stable dbRows.
   * `$`-locked rows don't move. Returns a new db-form formula.
   */
  const shiftFormulaForFill = useCallback(
    (srcFormula: string, dVisRow: number, dCol: number): string => {
      return remapReferences(srcFormula, (storedCol, caseId, colLocked, rowLocked) => {
        // Column: stored ordinal → current index → shift → new index → ordinal.
        const curIdx = colIndexOfSeq(storedCol + 1)
        if (curIdx < 0) return { col: -1, row: -1 } // deleted column → #REF!
        const nIdx = colLocked ? curIdx : curIdx + dCol
        // Row: stored case id → visible → shift → case id.
        const vis = caseToVisible(caseId)
        if (vis === undefined) return { col: -1, row: -1 } // deleted case → #REF!
        const nVis = rowLocked ? vis : vis + dVisRow
        if (nIdx < 0 || nVis < 0) return { col: -1, row: -1 }
        const seq = colSeqOfIndex(nIdx)
        if (seq === null) return { col: -1, row: -1 } // shifted past the last column
        return { col: seq - 1, row: visibleToCase(nVis) }
      })
    },
    [caseToVisible, visibleToCase, colIndexOfSeq, colSeqOfIndex]
  )

  return {
    recomputeFormulas,
    commitCellInput,
    getCellFormula,
    getDisplayFormula,
    setCellFormula,
    applyFormulaToCell,
    shiftFormulaForFill
  }
}
