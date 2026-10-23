// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * use-find-replace.ts — Find/Replace (G6) state + wiring for DataView, split
 * out of DataView.tsx (which had grown past 2500 lines). The pure text-match
 * logic already lived in find-replace.ts; this hook is the thin, AG-Grid-
 * specific layer on top of it (same split as cell-selection.ts/
 * use-cell-selection.ts and cell-value-undo.ts/use-cell-selection.ts) — state,
 * the bar/dialog's callbacks, and the `menu:edit:find`/`menu:edit:find-replace`
 * menu-channel listener.
 *
 * NOT included here: the Ctrl+F/Ctrl+H/Shift+F4 keydown branches. Those live
 * in DataView.tsx's own shared keydown listener alongside several unrelated
 * shortcuts (Ctrl+\, Ctrl+-, Ctrl+0, …) — splitting them into a SECOND
 * `window.addEventListener('keydown', …)` here would mean two listeners
 * racing on the same bubbling DOM event, which is exactly the class of bug
 * (Ctrl+C/X/V/Delete firing twice) this codebase spent a whole round fixing
 * elsewhere. DataView.tsx's listener just calls this hook's `openFind`/
 * `goToMatch`/etc.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import type { GridApi } from 'ag-grid-community'
import type { CellValue, Variable } from '@shared/data-types'
import { useDatasetStore } from '../../store/dataset-store'
import { useUIStore } from '../../store/ui-store'
import { toDbRow } from '../../lib/data-grid'
import { formatCellDisplay, prepareCellEdit } from '../../lib/aggrid-data'
import { normalizeRange, type CellRange } from './cell-selection'
import { publishSelectionCount } from './use-cell-selection'
import {
  findMatches,
  findStartIndex,
  computeReplacement,
  type MatchPosition,
  type SearchOptions,
  type SearchScope
} from './find-replace'

export interface UseFindReplaceParams {
  gridApiRef: React.RefObject<GridApi<CellValue[]> | null>
  rangesRef: React.RefObject<CellRange[]>
  rowsRef: React.RefObject<CellValue[][]>
  visibleToOriginalIndexRef: React.RefObject<number[]>
  variables: Variable[]
  showValueLabels: boolean
  warnCell: (message: string) => void
  t: TFunction
  getCellFormula: (dbRow: number, colId: string) => string | undefined
  setCellFormula: (dbRow: number, colId: string, formula: string | null) => void
  recomputeFormulas: () => void
}

export function useFindReplace(params: UseFindReplaceParams) {
  const {
    gridApiRef,
    rangesRef,
    rowsRef,
    visibleToOriginalIndexRef,
    variables,
    showValueLabels,
    warnCell,
    t,
    getCellFormula,
    setCellFormula,
    recomputeFormulas
  } = params

  const [findOpen, setFindOpen] = useState<{ showReplace: boolean } | null>(null)
  const [matches, setMatches] = useState<MatchPosition[]>([])
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  // Search refinements (B6) — kept in a ref too so Shift+F4 (which runs while
  // the bar is closed) and the search callbacks read the live value.
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({})
  const searchOptionsRef = useRef<SearchOptions>({})
  // Full Bul ve Değiştir dialog (the ⋯ button on the bar) — the inline bar
  // stays the quick path; this is the power path (scope, direction, find all).
  const [findDialogOpen, setFindDialogOpen] = useState(false)
  const [replaceTermState, setReplaceTermState] = useState('')
  // Rendered copies of ref-held values (React Compiler forbids reading refs
  // during render): the live term, and whether a scopeable selection exists
  // (computed when the dialog opens).
  const [searchTermState, setSearchTermState] = useState('')
  const [canScopeToSelection, setCanScopeToSelection] = useState(false)
  /** Selection captured when Find opened. Searching moves the selection
   *  (goToMatch highlights the current match), so "only in selection" has to
   *  remember the rectangle from before the first search ran. */
  const scopeAtOpenRef = useRef<SearchScope | null>(null)
  // Mirrors the FindReplaceBar's current search term so replaceOne's re-search
  // (which needs the term, not just the match list) doesn't require lifting
  // the bar's own input state up into this component.
  const searchTermRef = useRef('')

  const goToMatch = useCallback(
    (index: number, matchList: MatchPosition[]) => {
      const match = matchList[index]
      if (!match) return
      const api = gridApiRef.current
      if (!api) return
      api.ensureIndexVisible(match.row)
      const colId = variables[match.col]?.colId
      if (colId) api.ensureColumnVisible(colId)
      // Deliberately NOT api.setFocusedCell() here: this runs on every
      // keystroke while the user is still typing in the search box
      // (onSearch → runSearch → goToMatch), and setFocusedCell steals real
      // DOM focus to the grid cell — the next keystroke would land in a
      // cell edit instead of the search input. ensureIndexVisible +
      // range-highlight is enough feedback (matches Chrome/Excel's own
      // Ctrl+F, which doesn't yank focus out of the search box either).
      rangesRef.current = [
        { anchorRow: match.row, anchorCol: match.col, focusRow: match.row, focusCol: match.col }
      ]
      api.refreshCells({ force: true })
      publishSelectionCount(rangesRef.current)
    },
    [gridApiRef, rangesRef, variables]
  )

  const runSearch = useCallback(
    (term: string, jumpFrom?: MatchPosition) => {
      const found = findMatches(
        term,
        rowsRef.current,
        variables,
        showValueLabels,
        searchOptionsRef.current
      )
      setMatches(found)
      if (found.length === 0) {
        setCurrentMatchIndex(0)
        return
      }
      const startIdx = jumpFrom ? findStartIndex(found, jumpFrom.row, jumpFrom.col) : 0
      setCurrentMatchIndex(startIdx)
      goToMatch(startIdx, found)
    },
    [rowsRef, variables, showValueLabels, goToMatch]
  )

  /** Search-bar callbacks (B6) kept out of JSX so the refs they write to
   *  aren't mutated during render (React Compiler rejects that inline). */
  const applySearchOptions = useCallback(
    (next: SearchOptions) => {
      setSearchOptions(next)
      searchOptionsRef.current = next
      // Re-run with the new mode so counts/highlights update at once.
      runSearch(searchTermRef.current)
    },
    [runSearch]
  )

  const applySearchTerm = useCallback(
    (term: string) => {
      searchTermRef.current = term
      setSearchTermState(term)
      runSearch(term)
    },
    [runSearch]
  )

  /** The current selection as a search scope, or null when it's a single cell
   *  (nothing meaningful to restrict to). */
  const selectionScope = useCallback((): SearchScope | null => {
    const ranges = rangesRef.current
    if (ranges.length === 0) return null
    let top = Infinity
    let bottom = -1
    let left = Infinity
    let right = -1
    for (const r of ranges) {
      const n = normalizeRange(r)
      top = Math.min(top, n.top)
      bottom = Math.max(bottom, n.bottom)
      left = Math.min(left, n.left)
      right = Math.max(right, n.right)
    }
    if (top === bottom && left === right) return null
    return { top, bottom, left, right }
  }, [rangesRef])

  /** Options changes coming from the dialog: `scope: undefined` means "scope
   *  to the current selection" (the dialog can't know the rectangle), which is
   *  resolved here. */
  const applyDialogOptions = useCallback(
    (next: SearchOptions) => {
      const resolved: SearchOptions = {
        ...next,
        scope:
          'scope' in next && next.scope === undefined
            ? scopeAtOpenRef.current
            : (next.scope ?? null)
      }
      applySearchOptions(resolved)
    },
    [applySearchOptions]
  )

  /** "Tümünü Bul" — select every match at once (the closest thing to
   *  LibreOffice's Find All, and the natural bridge to Go-To Special). */
  const findAllMatches = useCallback(() => {
    if (matches.length === 0) return
    rangesRef.current = matches.map(m => ({
      anchorRow: m.row,
      anchorCol: m.col,
      focusRow: m.row,
      focusCol: m.col
    }))
    const first = matches[0]
    if (first) {
      gridApiRef.current?.ensureIndexVisible(first.row)
      const colId = variables[first.col]?.colId
      if (colId) gridApiRef.current?.ensureColumnVisible(colId)
    }
    gridApiRef.current?.refreshCells({ force: true })
    publishSelectionCount(rangesRef.current)
    warnCell(t('findReplace.selectedCount', { count: matches.length }))
  }, [matches, rangesRef, gridApiRef, warnCell, t, variables])

  const openFind = useCallback(
    (showReplace: boolean) => {
      if (useUIStore.getState().activeTab !== 'data') return
      scopeAtOpenRef.current = selectionScope()
      setFindOpen({ showReplace })
    },
    [selectionScope]
  )

  const closeFind = useCallback(() => {
    setFindOpen(null)
    setMatches([])
  }, [])

  /** The bar's "…" button opens the full dialog, carrying over its current
   *  term/replace-term and whether the selection at Find-open time can be
   *  offered as a search scope. */
  const openDialogFromBar = useCallback(
    (term: string, replaceTerm: string) => {
      applySearchTerm(term)
      setReplaceTermState(replaceTerm)
      setCanScopeToSelection(scopeAtOpenRef.current !== null)
      setFindDialogOpen(true)
    },
    [applySearchTerm]
  )

  const goToNext = useCallback(() => {
    if (matches.length === 0) return
    const next = (currentMatchIndex + 1) % matches.length
    setCurrentMatchIndex(next)
    goToMatch(next, matches)
  }, [matches, currentMatchIndex, goToMatch])

  const goToPrevious = useCallback(() => {
    if (matches.length === 0) return
    const prev = (currentMatchIndex - 1 + matches.length) % matches.length
    setCurrentMatchIndex(prev)
    goToMatch(prev, matches)
  }, [matches, currentMatchIndex, goToMatch])

  const replaceOne = useCallback(
    (replaceTerm: string) => {
      const match = matches[currentMatchIndex]
      if (!match) return
      const dsId = useDatasetStore.getState().datasetId
      const variable = variables[match.col]
      if (!dsId || !variable) return
      const rowArr = rowsRef.current[match.row]
      if (!rowArr) return
      // Replace WITHIN the cell's text (so a substring/regex match swaps just
      // the matched part, and regex `$1` back-refs work) — B6.
      const currentText = formatCellDisplay(rowArr[match.col] ?? null, variable, showValueLabels)
      const newText = computeReplacement(
        currentText,
        searchTermRef.current,
        replaceTerm,
        searchOptionsRef.current
      )
      const result = prepareCellEdit(newText, variable, showValueLabels)
      if (!result.ok) {
        warnCell(t('dataset.numericInvalid'))
        return
      }
      rowArr[match.col] = result.value
      const dbRow = toDbRow(match.row, visibleToOriginalIndexRef.current)
      // Replacing a formula cell's text is a genuine overwrite — drop the
      // formula, or the recompute below would immediately undo the replace
      // (same rule the paste path already applies).
      if (getCellFormula(dbRow, variable.colId)) setCellFormula(dbRow, variable.colId, null)
      void window.api.data
        .updateCell({
          datasetId: dsId,
          rowIndex: dbRow,
          colId: variable.colId,
          value: result.value
        })
        .catch((err: unknown) => {
          console.error('Replace failed:', err)
        })
      gridApiRef.current?.refreshCells({ force: true })
      // The replaced cell may be a precedent of a formula elsewhere — every
      // other write path recomputes, Find & Replace used to be the one that
      // forgot (denetim raporu §4.2).
      recomputeFormulas()
      // Re-search: the replaced cell may no longer match, shifting indices.
      runSearch(searchTermRef.current, match)
    },
    [
      matches,
      currentMatchIndex,
      variables,
      showValueLabels,
      rowsRef,
      visibleToOriginalIndexRef,
      gridApiRef,
      getCellFormula,
      setCellFormula,
      recomputeFormulas,
      warnCell,
      t,
      runSearch
    ]
  )

  const replaceAll = useCallback(
    (replaceTerm: string) => {
      const dsId = useDatasetStore.getState().datasetId
      if (!dsId || matches.length === 0) return
      const updates: { rowIndex: number; colId: string; value: CellValue }[] = []
      let rejected = 0
      for (const match of matches) {
        const variable = variables[match.col]
        const rowArr = rowsRef.current[match.row]
        if (!variable || !rowArr) continue
        const currentText = formatCellDisplay(rowArr[match.col] ?? null, variable, showValueLabels)
        const newText = computeReplacement(
          currentText,
          searchTermRef.current,
          replaceTerm,
          searchOptionsRef.current
        )
        const result = prepareCellEdit(newText, variable, showValueLabels)
        if (!result.ok) {
          rejected++
          continue
        }
        rowArr[match.col] = result.value
        const dbRow = toDbRow(match.row, visibleToOriginalIndexRef.current)
        if (getCellFormula(dbRow, variable.colId)) setCellFormula(dbRow, variable.colId, null)
        updates.push({ rowIndex: dbRow, colId: variable.colId, value: result.value })
      }
      if (rejected > 0) warnCell(t('dataset.numericInvalid'))
      if (updates.length > 0) {
        gridApiRef.current?.refreshCells({ force: true })
        void window.api.data.updateCells({ datasetId: dsId, updates }).catch((err: unknown) => {
          console.error('Replace all failed:', err)
        })
        recomputeFormulas() // see replaceOne — §4.2
        warnCell(t('findReplace.replacedCount', { count: updates.length }))
      }
      setMatches([])
    },
    [
      matches,
      variables,
      showValueLabels,
      rowsRef,
      visibleToOriginalIndexRef,
      gridApiRef,
      getCellFormula,
      setCellFormula,
      recomputeFormulas,
      warnCell,
      t
    ]
  )

  useEffect(() => {
    return window.api.on.menuCommand(channel => {
      if (channel === 'menu:edit:find') openFind(false)
      else if (channel === 'menu:edit:find-replace') openFind(true)
    })
  }, [openFind])

  return {
    findOpen,
    matches,
    currentMatchIndex,
    searchOptions,
    findDialogOpen,
    replaceTermState,
    searchTermState,
    canScopeToSelection,
    searchTermRef,
    searchOptionsRef,
    setFindDialogOpen,
    setReplaceTermState,
    setCurrentMatchIndex,
    setMatches,
    goToMatch,
    runSearch,
    applySearchOptions,
    applySearchTerm,
    selectionScope,
    applyDialogOptions,
    findAllMatches,
    openFind,
    closeFind,
    openDialogFromBar,
    goToNext,
    goToPrevious,
    replaceOne,
    replaceAll
  }
}
