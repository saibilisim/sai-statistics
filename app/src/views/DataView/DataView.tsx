// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AgGridReact } from 'ag-grid-react'
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community'
import type { GridApi } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'

import { buildStructuralKey } from '../../lib/data-grid'
import type { CellValue } from '@shared/data-types'
import { useDatasetStore } from '../../store/dataset-store'
import { useGridBridgeStore } from '../../store/grid-bridge-store'
import { useUIStore } from '../../store/ui-store'
import { useSettingsStore } from '../../store/settings-store'
import { useResolvedTheme } from '../../theme/ThemeProvider'
import { ColumnFilterPopup } from '../../components/Dialogs/ColumnFilterPopup'
import { createCaseIdentity } from './case-identity'
import { useCellSelection } from './use-cell-selection'
import { useFormulas } from './use-formulas'
import { useFindReplace } from './use-find-replace'
import { useColumnDefs } from './use-column-defs'
import { useContextMenu } from './use-context-menu'
import { useStructuralOps } from './use-structural-ops'
import { useLoadingIndicators } from './use-loading-indicators'
import { useCellFormat } from './use-cell-format'
import { useCellFocus } from './use-cell-focus'
import { useDataViewShortcuts } from './use-data-view-shortcuts'
import { useGridEvents } from './use-grid-events'
import { useDataLoader } from './use-data-loader'
import { DataFileDropZone } from './DataFileDropZone'
import { NameBoxBar } from './NameBoxBar'
import {
  ContextMenu,
  PasteValuesIcon,
  PasteFormatIcon,
  PasteFormulaIcon,
  TransposeIcon
} from '../../components/ContextMenu'
import { FindReplaceDialog } from './FindReplaceDialog'
import { FindReplaceBar } from './FindReplaceBar'
import { cx } from '../../lib/cx'
import styles from './DataView.module.css'

ModuleRegistry.registerModules([AllCommunityModule])

/**
 * DataView.tsx — AG Grid Community port (aggrid-gecis-roadmap.md G1-G3).
 *
 * Replaces the previous grid engine. Design decisions this file follows are
 * documented in the roadmap's T1-T10 table; the short version:
 *  - Client-Side Row Model, `rowData` fed straight from `rowsRef`/
 *    `allRowsRef` (T1/T2) — no per-cell object conversion, no command
 *    pipeline, so the ~190s prior chunk-paint cost has no equivalent here.
 *  - Row identity via a WeakMap from row-array reference → DB row index
 *    (T3) — sort/filter reorder the *outer* array but reuse the same row
 *    array objects, so identity survives reordering for free.
 *  - `applyColumnFilters`/`applySortInMemory`/`toDbRow`/`buildStructuralKey`
 *    are unchanged imports from data-grid.ts — that module was always
 *    grid-engine-agnostic.
 *
 * Cell formatting (bold/italic/underline/fonts/colors/alignment) is wired
 * via `applyCellFormat` (grid-bridge-store.ts) — the Ribbon calls it against
 * the current selection, this file merges the patch into dataset-store's
 * `customStyles` (keyed by stable row id) and reads it back in each data
 * column's `cellStyle`. Text-wrap is deliberately not included yet (variable
 * row-height across 500K rows needs its own perf-aware design).
 *
 * This file is the orchestrator: the self-contained pieces live in sibling
 * modules — use-loading-indicators.ts (overlay + warning toast),
 * use-cell-format.ts (Ribbon formatting), use-cell-focus.ts (focus/Name
 * Box/formula bar), use-data-view-shortcuts.ts (window keybindings),
 * use-grid-events.ts (AG Grid event wiring), use-data-loader.ts (chunked
 * load + filter/sort view), NameBoxBar.tsx / DataViewStatusBar.tsx (JSX).
 */

// Stable reference (never a fresh `[]` literal on re-render) — after mount,
// all row data flows through the imperative `gridApi.setGridOption('rowData',
// …)`/`applyTransactionAsync` calls in loadData(), never through this prop
// again, so it must never change identity or AG Grid would treat every
// unrelated re-render as "the dataset just became empty".
const EMPTY_ROWS: CellValue[][] = []

export function DataView() {
  return (
    <DataFileDropZone>
      <DataViewContent />
    </DataFileDropZone>
  )
}

function DataViewContent() {
  const { t } = useTranslation(['common', 'menu'])
  const gridApiRef = useRef<GridApi<CellValue[]> | null>(null)

  // Flips true once onGridReady fires. Exists so loadData's useCallback
  // (and the effect watching it) is FORCED to recreate/refire at that exact
  // moment — see onGridReady's comment for the stale-closure bug this
  // fixes (real root cause of "no rows to show" on first open).
  const [gridReady, setGridReady] = useState(false)
  // Freeze panes (P1.4/P1.1, spreadsheet-ozellikleri-envanteri.md §3) —
  // number of DATA columns (current display order, after the pinned
  // row-num column) pinned left. View-only, like showColumnFilterIcons;
  // doesn't need to survive a reload the way filters/sort do. AG Grid's own
  // `pinned` colDef property already stacks correctly for multiple columns
  // (proven by the row-num column, which has used it since G1) — true
  // *row* freezing has no equivalent (AG Grid's pinned-row API is for
  // static extra rows like a totals row, not "keep scrolling past the
  // first N data rows" — so only column freeze is offered here).
  const [frozenColCount, setFrozenColCount] = useState(0)
  // Column hide/unhide (P1.8, spreadsheet-ozellikleri-envanteri.md §3) — AG
  // Grid Community's own `hide` colDef property (also used natively for
  // this exact purpose by `columnApi.setColumnVisible()`, so no custom
  // rendering/filtering needed, unlike a hypothetical row-hide which has no
  // AG Grid equivalent and was scoped out — see the doc). View-only state,
  // same lifecycle as frozenColCount.
  const [hiddenColIds, setHiddenColIds] = useState<Set<string>>(new Set())
  const { loading, beginLoading, endLoading, cellWarning, warnCell } = useLoadingIndicators()

  // ── Refs mirroring the previous grid's design (chunked-load-roadmap.md +
  // hibrit/aggrid roadmaps) — same names, same semantics, so the mental
  // model carries over even though the paint mechanism underneath changed. ──
  /** Currently displayed rows (post filter/sort), in display order. Row
   *  array objects are SHARED with allRowsRef — editing mutates them in
   *  place, so both stay in sync with no explicit copy-back step (T2). */
  const rowsRef = useRef<CellValue[][]>([])
  /** All fetched rows in DB order — the source `applyColumnFilters`/
   *  `applySortInMemory` recompute a view from whenever filter/sort/
   *  value-label-toggle changes without a re-fetch. */
  const allRowsRef = useRef<CellValue[][]>([])
  /** Permanent case id per dbRow (`__case_id`), owned by this translator.
   *  All per-cell metadata (customStyles: formats + formulas) keys on it,
   *  never on the row's position, so insert/delete/reorder/sort can't slide a
   *  format or a formula onto a different record (denetim raporu §2). */
  const caseIdentity = useMemo(() => createCaseIdentity(), [])
  const visibleToOriginalIndexRef = useRef<number[]>([])
  /** True while a background chunk fetch is still filling allRowsRef in
   *  after the grid is already interactive — mirrors chunked-load-roadmap.md
   *  C3's isChunkLoadingRef. Structural mutations aren't wired yet (G5), so
   *  today this only gates re-entrant loads. */
  const isChunkLoadingRef = useRef(false)
  /** Row identity (T3): DB row index, keyed by the row's array *reference*
   *  (not its current position). Rebuilt from scratch on every full re-fetch;
   *  survives in-place sort/filter reordering because the row array objects
   *  themselves aren't recreated. */
  const rowIdMapRef = useRef(new WeakMap<CellValue[], string>())

  const datasetId = useDatasetStore(s => s.datasetId)
  const variables = useDatasetStore(s => s.variables)
  const dataVersion = useDatasetStore(s => s.dataVersion)
  const showValueLabels = useUIStore(s => s.showValueLabels)
  const decimalSeparator = useSettingsStore(s => s.settings.editor.decimalSeparator)
  const headerMode = useUIStore(s => s.headerMode)
  const showColumnFilterIcons = useUIStore(s => s.showColumnFilterIcons)
  const showGridLines = useUIStore(s => s.showGridLines)
  const focusCellHighlight = useUIStore(s => s.focusCellHighlight)
  const resolvedTheme = useResolvedTheme()
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const columnSort = useDatasetStore(s => s.columnSort)

  const isDark = resolvedTheme !== 'light'

  const [filterPopup, setFilterPopup] = useState<{
    opened: boolean
    colIndex: number | null
    x: number
    y: number
    allRows: CellValue[][]
  }>({ opened: false, colIndex: null, x: 0, y: 0, allRows: [] })

  const structuralKey = useMemo(() => buildStructuralKey(variables), [variables])

  const onFilterClick = useCallback(
    (colIndex: number, anchor: DOMRect) => {
      setFilterPopup({
        opened: true,
        colIndex,
        x: anchor.left,
        y: anchor.bottom + 4,
        allRows: allRowsRef.current
      })
    },
    [setFilterPopup]
  )

  // ── Row identity (T3) ──────────────────────────────────────────────────
  const getRowId = useCallback(
    (params: { data: CellValue[] }) => rowIdMapRef.current.get(params.data) ?? 'unresolved',
    []
  )

  // AG Grid's row id — the permanent case id, not the position, so a reload
  // after insert/delete/reorder matches records rather than slots.
  const assignRowId = useCallback(
    (row: CellValue[], caseId: number): void => {
      rowIdMapRef.current.set(row, caseIdentity.keyOfCase(caseId))
    },
    [caseIdentity]
  )

  // ── Cell formulas ("=A7+B7", stored in customStyles / .sdf) ─────────────
  const {
    recomputeFormulas,
    commitCellInput,
    getCellFormula,
    getDisplayFormula,
    applyFormulaToCell,
    setCellFormula,
    shiftFormulaForFill
  } = useFormulas({
    gridApiRef,
    allRowsRef,
    visibleToOriginalIndexRef,
    caseIdentity,
    showValueLabels,
    warnCell,
    t
  })

  // ── Range selection + copy/paste (G4/T5/T6) ────────────────────────────
  const {
    rangesRef,
    isCellSelected,
    isFillHandleAnchor,
    onCellClicked,
    onCellMouseDown,
    onCellMouseOver,
    stopDragging,
    onCellKeyDown,
    copySelection,
    pasteAtActiveCell,
    pasteSpecial,
    selectColumn,
    clearSelection,
    navigateToAddress,
    tryAutoFillFromHandle,
    cutSelection,
    copiedEdgeClass,
    selectedCellClass,
    fillHandleAnchorClass,
    recordCellEdit,
    undoLastEdit,
    redoLastEdit
  } = useCellSelection({
    gridApiRef,
    rowsRef,
    visibleToOriginalIndexRef,
    caseIdentity,
    variables,
    showValueLabels,
    isChunkLoadingRef,
    warnCell,
    t,
    formulaOps: {
      getCellFormula,
      setCellFormula,
      applyFormulaToCell,
      shiftFormulaForFill,
      recomputeFormulas
    }
  })

  useEffect(() => {
    window.addEventListener('mouseup', stopDragging)
    return () => {
      window.removeEventListener('mouseup', stopDragging)
    }
  }, [stopDragging])

  // ── Structural operations + context menu (G5) ──────────────────────────
  const { insertRow, deleteRows, insertColumn, deleteColumn } = useStructuralOps({
    visibleToOriginalIndexRef,
    isChunkLoadingRef,
    warnCell,
    t
  })

  // ── Cell formatting (Ribbon → current selection, use-cell-format.ts) ────
  const { publishActiveCellFormat, clearFormatOnSelection } = useCellFormat({
    gridApiRef,
    rangesRef,
    visibleToOriginalIndexRef,
    caseIdentity
  })

  // ── Context menu (use-context-menu.tsx) ────────────────────────────────
  const { contextMenu, closeContextMenu, onCellContextMenu, onHeaderContextMenu } = useContextMenu({
    gridApiRef,
    rangesRef,
    variables,
    warnCell,
    t,
    copySelection,
    cutSelection,
    pasteAtActiveCell,
    pasteSpecial,
    insertRow,
    deleteRows,
    insertColumn,
    deleteColumn,
    frozenColCount,
    setFrozenColCount,
    hiddenColIds,
    setHiddenColIds
  })

  // ── Find / Replace (G6) — use-find-replace.ts ──────────────────────────
  const {
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
    applySearchTerm,
    applyDialogOptions,
    findAllMatches,
    openFind,
    closeFind,
    openDialogFromBar,
    goToNext,
    goToPrevious,
    replaceOne,
    replaceAll
  } = useFindReplace({
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
  })

  // ── Focus tracking + Name Box + formula bar (use-cell-focus.ts) ─────────
  const {
    activeCell,
    focusRCRef,
    nameBoxValue,
    setNameBoxValue,
    formulaBarValue,
    setFormulaBarValue,
    onNameBoxKeyDown,
    onFormulaBarKeyDown,
    onCellFocused,
    applyCommittedValue
  } = useCellFocus({
    gridApiRef,
    rowsRef,
    visibleToOriginalIndexRef,
    variables,
    navigateToAddress,
    publishActiveCellFormat,
    getDisplayFormula,
    getCellFormula,
    commitCellInput,
    recomputeFormulas,
    warnCell,
    t
  })

  // ── Window-level keyboard shortcuts (use-data-view-shortcuts.ts) ───────
  const {
    valueDropdown,
    setValueDropdown,
    pasteSpecialMenu,
    setPasteSpecialMenu,
    selectDropdownValue
  } = useDataViewShortcuts({
    gridApiRef,
    allRowsRef,
    rowsRef,
    rangesRef,
    visibleToOriginalIndexRef,
    variables,
    showValueLabels,
    setHiddenColIds,
    openFind,
    clearFormatOnSelection,
    insertRow,
    deleteRows,
    goToMatch,
    searchTermRef,
    searchOptionsRef,
    setCurrentMatchIndex,
    setMatches,
    commitCellInput,
    applyCommittedValue
  })

  // ── AG Grid event wiring (use-grid-events.ts) ──────────────────────────
  const {
    onGridReady,
    onCellValueChanged,
    onColumnResized,
    onColumnMoved,
    onRowDragEnd,
    onCellDoubleClicked,
    getRowClass,
    rowSelection
  } = useGridEvents({
    gridApiRef,
    gridReady,
    setGridReady,
    variables,
    frozenColCount,
    isChunkLoadingRef,
    rowsRef,
    allRowsRef,
    visibleToOriginalIndexRef,
    caseIdentity,
    clearSelection,
    tryAutoFillFromHandle,
    getCellFormula,
    recomputeFormulas,
    warnCell,
    t
  })

  // ── Column definitions (use-column-defs.ts) ────────────────────────────
  const columnDefs = useColumnDefs({
    variables,
    caseIdentity,
    headerMode,
    showValueLabels,
    decimalSeparator,
    showColumnFilterIcons,
    columnFilters,
    columnSort,
    onFilterClick,
    selectColumn,
    onHeaderContextMenu,
    frozenColCount,
    hiddenColIds,
    isCellSelected,
    selectedCellClass,
    isFillHandleAnchor,
    fillHandleAnchorClass,
    copiedEdgeClass,
    focusCellHighlight,
    focusRCRef,
    rangesRef,
    visibleToOriginalIndexRef,
    commitCellInput,
    getCellFormula,
    recordCellEdit
  })

  // Focus Cell toggled (View menu) while a cell is already focused: the
  // crosshair position is only recorded on focus MOVES, so without this the
  // highlight stayed invisible until the user moved the cursor. Re-run the
  // focus handler once per toggle (ref'd, so its identity churn can't loop).
  const onCellFocusedRef = useRef(onCellFocused)
  useEffect(() => {
    onCellFocusedRef.current = onCellFocused
  })
  useEffect(() => {
    onCellFocusedRef.current()
  }, [focusCellHighlight])

  // ── Data loading (use-data-loader.ts) ──────────────────────────────────
  useDataLoader({
    gridApiRef,
    gridReady,
    datasetId,
    variables,
    structuralKey,
    dataVersion,
    columnFilters,
    columnSort,
    caseIdentity,
    assignRowId,
    beginLoading,
    endLoading,
    rowsRef,
    allRowsRef,
    visibleToOriginalIndexRef,
    isChunkLoadingRef,
    rowIdMapRef
  })

  useEffect(() => {
    useGridBridgeStore.getState().setOpenFind(openFind)
    return () => {
      useGridBridgeStore.getState().setOpenFind(null)
    }
  }, [openFind])

  useEffect(() => {
    useGridBridgeStore.getState().setUndoValueEdit(undoLastEdit)
    useGridBridgeStore.getState().setRedoValueEdit(redoLastEdit)
    return () => {
      useGridBridgeStore.getState().setUndoValueEdit(null)
      useGridBridgeStore.getState().setRedoValueEdit(null)
    }
  }, [undoLastEdit, redoLastEdit])

  const theme = isDark ? 'ag-theme-quartz-dark' : 'ag-theme-quartz'

  // ── Render ────────────────────────────────────────────────────────────
  if (!datasetId || variables.length === 0) {
    return (
      <div className={styles.placeholderContainer}>
        <h2 className={styles.placeholderTitle}>{t('tabs.dataView')}</h2>
        <p className={styles.placeholderText}>{t('dataset.noActive')}</p>
        <p className={styles.placeholderText}>{t('fileDrop.hint')}</p>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {loading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.loadingSpinner} />
          <span>{t('common.loading')}</span>
        </div>
      )}

      {cellWarning && (
        <div className={styles.cellWarning} role="alert">
          {cellWarning}
        </div>
      )}

      <NameBoxBar
        nameBoxValue={nameBoxValue}
        setNameBoxValue={setNameBoxValue}
        onNameBoxKeyDown={onNameBoxKeyDown}
        formulaBarValue={formulaBarValue}
        setFormulaBarValue={setFormulaBarValue}
        onFormulaBarKeyDown={onFormulaBarKeyDown}
        activeCell={activeCell}
      />

      <div className={styles.gridArea}>
        <div className={cx(theme, styles.agGridHost, !showGridLines && styles.noGridLines)}>
          <AgGridReact<CellValue[]>
            theme="legacy"
            columnDefs={columnDefs}
            rowData={EMPTY_ROWS}
            getRowId={getRowId}
            rowBuffer={12}
            animateRows={true}
            rowSelection={rowSelection}
            rowDragMultiRow={true}
            rowDragManaged={true}
            onRowDragEnd={onRowDragEnd}
            suppressCellFocus={false}
            undoRedoCellEditing={true}
            undoRedoCellEditingLimit={50}
            singleClickEdit={false}
            stopEditingWhenCellsLoseFocus={true}
            onGridReady={onGridReady}
            onCellValueChanged={onCellValueChanged}
            onColumnResized={onColumnResized}
            onColumnMoved={onColumnMoved}
            onCellFocused={onCellFocused}
            onCellClicked={onCellClicked}
            onCellMouseDown={onCellMouseDown}
            onCellMouseOver={onCellMouseOver}
            onCellKeyDown={onCellKeyDown}
            onCellContextMenu={onCellContextMenu}
            onCellDoubleClicked={onCellDoubleClicked}
            getRowClass={getRowClass}
          />
        </div>
        {findOpen && (
          <FindReplaceBar
            showReplace={findOpen.showReplace}
            matchCount={matches.length}
            currentMatchIndex={currentMatchIndex}
            onSearch={applySearchTerm}
            onOpenDialog={openDialogFromBar}
            onNext={goToNext}
            onPrevious={goToPrevious}
            onReplace={replaceOne}
            onReplaceAll={replaceAll}
            onClose={closeFind}
          />
        )}
      </div>

      {findDialogOpen && (
        <FindReplaceDialog
          term={searchTermState}
          replaceTerm={replaceTermState}
          options={searchOptions}
          matchCount={matches.length}
          currentMatchIndex={currentMatchIndex}
          canScopeToSelection={canScopeToSelection}
          onTermChange={applySearchTerm}
          onReplaceTermChange={setReplaceTermState}
          onOptionsChange={applyDialogOptions}
          onFindAll={findAllMatches}
          onNext={goToNext}
          onPrevious={goToPrevious}
          onReplace={() => {
            replaceOne(replaceTermState)
          }}
          onReplaceAll={() => {
            replaceAll(replaceTermState)
          }}
          onClose={() => {
            setFindDialogOpen(false)
          }}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={closeContextMenu}
        />
      )}

      {valueDropdown && (
        <ContextMenu
          x={valueDropdown.x}
          y={valueDropdown.y}
          items={valueDropdown.items.map((it, i) => ({
            key: `val${String(i)}`,
            label: it.display,
            onClick: () => {
              selectDropdownValue(valueDropdown.dbRow, valueDropdown.col, it.raw)
            }
          }))}
          onClose={() => {
            setValueDropdown(null)
          }}
        />
      )}

      {pasteSpecialMenu && (
        <ContextMenu
          x={pasteSpecialMenu.x}
          y={pasteSpecialMenu.y}
          items={[
            {
              key: 'ps-values',
              label: t('menu:edit.pasteSpecialValues'),
              icon: <PasteValuesIcon />,
              onClick: () => {
                pasteAtActiveCell(pasteSpecialMenu.row, pasteSpecialMenu.col)
              }
            },
            {
              key: 'ps-format',
              label: t('menu:edit.pasteSpecialFormat'),
              icon: <PasteFormatIcon />,
              onClick: () => {
                pasteSpecial(pasteSpecialMenu.row, pasteSpecialMenu.col, 'format')
              }
            },
            {
              key: 'ps-formula',
              label: t('menu:edit.pasteSpecialFormula'),
              icon: <PasteFormulaIcon />,
              onClick: () => {
                pasteSpecial(pasteSpecialMenu.row, pasteSpecialMenu.col, 'formula')
              }
            },
            {
              key: 'ps-transpose',
              label: t('menu:edit.pasteSpecialTranspose'),
              icon: <TransposeIcon />,
              onClick: () => {
                pasteSpecial(pasteSpecialMenu.row, pasteSpecialMenu.col, 'transpose')
              }
            }
          ]}
          onClose={() => {
            setPasteSpecialMenu(null)
          }}
        />
      )}

      {filterPopup.opened && filterPopup.colIndex !== null && (
        <ColumnFilterPopup
          key={filterPopup.colIndex}
          colIndex={filterPopup.colIndex}
          x={filterPopup.x}
          y={filterPopup.y}
          allRows={filterPopup.allRows}
          onClose={() => {
            setFilterPopup({ opened: false, colIndex: null, x: 0, y: 0, allRows: [] })
          }}
        />
      )}
    </div>
  )
}
