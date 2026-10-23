// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * use-context-menu.ts — DataView's right-click menu: state, item-building
 * (cell + column-header variants), and equal-column-width (B5). Split out of
 * DataView.tsx (which had grown past 2500 lines) — this was its single
 * largest contiguous block (~350 lines).
 */
import { useCallback, useState } from 'react'
import type { TFunction } from 'i18next'
import type { CellContextMenuEvent, GridApi } from 'ag-grid-community'
import type { CellValue, Variable } from '@shared/data-types'
import { useDatasetStore } from '../../store/dataset-store'
import { useSpecialMenuStore } from '../../store/special-menu-store'
import { normalizeRange, type CellRange } from './cell-selection'
import { publishSelectionCount } from './use-cell-selection'
import {
  type ContextMenuEntry,
  CopyIcon,
  CutIcon,
  PasteIcon,
  PasteValuesIcon,
  PasteFormatIcon,
  PasteFormulaIcon,
  TransposeIcon,
  RowInsertAboveIcon,
  RowInsertBelowIcon,
  TrashIcon,
  ColInsertLeftIcon,
  ColInsertRightIcon,
  SortAscendingIcon,
  SortDescendingIcon,
  PinIcon,
  UnpinIcon,
  EyeOffIcon,
  EyeIcon,
  EqualWidthIcon,
  ScaleIcon,
  SplitIcon,
  TagCopyIcon,
  TagPasteIcon
} from '../../components/ContextMenu'

export interface UseContextMenuParams {
  gridApiRef: React.RefObject<GridApi<CellValue[]> | null>
  rangesRef: React.RefObject<CellRange[]>
  variables: Variable[]
  warnCell: (message: string) => void
  /** Parameterized to match DataView.tsx's `useTranslation(['common', 'menu'])`
   *  — this hook is the only extracted one that calls cross-namespace keys
   *  (`t('menu:edit.cut')`); a bare `TFunction` infers the default namespace
   *  only and rejects those calls. */
  t: TFunction<['common', 'menu']>
  copySelection: () => void
  cutSelection: () => void
  pasteAtActiveCell: (visibleRow: number, colIndex: number) => void
  pasteSpecial: (
    visibleRow: number,
    colIndex: number,
    mode: 'transpose' | 'format' | 'formula'
  ) => void
  insertRow: (visibleRow: number, position: 'above' | 'below') => void
  deleteRows: (visibleRows: number[]) => void
  insertColumn: (atIndex: number) => void
  deleteColumn: (colIndex: number) => void
  frozenColCount: number
  setFrozenColCount: (count: number) => void
  hiddenColIds: Set<string>
  setHiddenColIds: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void
}

export function useContextMenu(params: UseContextMenuParams) {
  const {
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
  } = params

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    items: ContextMenuEntry[]
  } | null>(null)

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  /** Equal column width (B5): sizes every column spanned by the selection to
   *  the width of the one that was right-clicked — Excel's "select several
   *  columns, drag one edge, they all match". Persists like a manual resize. */
  const equalizeColumnWidths = useCallback(
    (refColIndex: number) => {
      const api = gridApiRef.current
      const dsId = useDatasetStore.getState().datasetId
      const freshVars = useDatasetStore.getState().variables
      const refVar = freshVars[refColIndex]
      if (!api || !dsId || !refVar) return
      const width = api.getColumn(refVar.colId)?.getActualWidth()
      if (!width) return

      const cols = new Set<number>()
      for (const r of rangesRef.current) {
        const { left, right } = normalizeRange(r)
        for (let c = left; c <= right; c++) cols.add(c)
      }
      cols.add(refColIndex)
      if (cols.size < 2) return

      const newColumns = Math.max(1, Math.round(width / 9))
      api.setColumnWidths(
        [...cols].flatMap(c => {
          const v = freshVars[c]
          return v ? [{ key: v.colId, newWidth: width }] : []
        })
      )
      for (const c of cols) {
        const v = freshVars[c]
        if (!v || v.columns === newColumns) continue
        useDatasetStore.getState().updateVariable(c, { columns: newColumns })
        void window.api.variable
          .update({ datasetId: dsId, colId: v.colId, updates: { columns: newColumns } })
          .catch((err: unknown) => {
            console.error('Failed to persist equalized column width:', err)
          })
      }
    },
    [gridApiRef, rangesRef]
  )

  const buildContextMenuItems = useCallback(
    (visibleRow: number, colIndex: number, fromHeader = false): ContextMenuEntry[] => {
      const items: ContextMenuEntry[] = []

      // How many distinct columns the current selection spans (drives the
      // "equal width" item's enabled state).
      const colSpanSet = new Set<number>()
      for (const r of rangesRef.current) {
        const { left, right } = normalizeRange(r)
        for (let c = left; c <= right; c++) colSpanSet.add(c)
      }
      const selectedColSpan = colSpanSet.size

      const selectedRowSet = new Set<number>()
      for (const r of rangesRef.current) {
        const { top, bottom } = normalizeRange(r)
        for (let row = top; row <= bottom; row++) selectedRowSet.add(row)
      }
      if (selectedRowSet.size === 0) selectedRowSet.add(visibleRow)
      const selectedRows = [...selectedRowSet].sort((a, b) => a - b)

      const variable = colIndex >= 0 ? variables[colIndex] : null
      const targetCol = colIndex >= 0 ? colIndex : 0

      // Value-label copy/paste handlers (shared by the row-2 icons here and the
      // header menu's text items below).
      const copyValueLabels = () => {
        if (!variable) return
        const count = Object.keys(variable.valueLabels).length
        if (count === 0) {
          warnCell(t('specialMenu.noLabelsToCopy'))
          return
        }
        useSpecialMenuStore.getState().setLabelClipboard({
          sourceColId: variable.colId,
          sourceName: variable.name,
          valueLabels: { ...variable.valueLabels }
        })
        warnCell(t('specialMenu.labelsCopied', { count, name: variable.name }))
      }
      const pasteValueLabels = () => {
        if (!variable) return
        const clip = useSpecialMenuStore.getState().labelClipboard
        if (!clip) {
          warnCell(t('specialMenu.noClipboard'))
          return
        }
        const dsId = useDatasetStore.getState().datasetId
        if (!dsId) return
        useDatasetStore
          .getState()
          .updateVariable(colIndex, { valueLabels: { ...clip.valueLabels } })
        void window.api.variable
          .update({
            datasetId: dsId,
            colId: variable.colId,
            updates: { valueLabels: { ...clip.valueLabels } }
          })
          .catch((err: unknown) => {
            console.error('Failed to paste value labels:', err)
          })
        warnCell(t('specialMenu.labelsPasted', { count: 1 }))
      }

      // A header right-click isn't tied to any one row — skip the clipboard
      // icon toolbar and insert/delete-row (P1.4).
      if (!fromHeader) {
        // Row 1: cut / copy / paste (icon-only, hover tooltip).
        items.push({
          type: 'iconRow',
          key: 'clip-row1',
          buttons: [
            {
              key: 'cut',
              icon: <CutIcon size={20} />,
              title: t('menu:edit.cut'),
              onClick: cutSelection
            },
            {
              key: 'copy',
              icon: <CopyIcon size={20} />,
              title: t('menu:edit.copy'),
              onClick: copySelection
            },
            {
              key: 'paste',
              icon: <PasteIcon size={20} />,
              title: t('menu:edit.paste'),
              disabled: visibleRow < 0,
              onClick: () => {
                pasteAtActiveCell(visibleRow, targetCol)
              }
            }
          ]
        })
        // Row 2: paste-special — values / format / formula / transpose.
        // (Arithmetic paste was dropped: the formula system covers it, e.g.
        // "=A1*2", and four extra icons crowded the menu.)
        items.push({
          type: 'iconRow',
          key: 'clip-row2',
          buttons: [
            {
              key: 'ps-values',
              icon: <PasteValuesIcon size={20} />,
              title: t('menu:edit.pasteSpecialValues'),
              disabled: visibleRow < 0,
              onClick: () => {
                pasteAtActiveCell(visibleRow, targetCol)
              }
            },
            {
              key: 'ps-format',
              icon: <PasteFormatIcon size={20} />,
              title: t('menu:edit.pasteSpecialFormat'),
              disabled: visibleRow < 0,
              onClick: () => {
                pasteSpecial(visibleRow, targetCol, 'format')
              }
            },
            {
              key: 'ps-formula',
              icon: <PasteFormulaIcon size={20} />,
              title: t('menu:edit.pasteSpecialFormula'),
              disabled: visibleRow < 0,
              onClick: () => {
                pasteSpecial(visibleRow, targetCol, 'formula')
              }
            },
            {
              key: 'ps-transpose',
              icon: <TransposeIcon size={20} />,
              title: t('menu:edit.pasteSpecialTranspose'),
              disabled: visibleRow < 0,
              onClick: () => {
                pasteSpecial(visibleRow, targetCol, 'transpose')
              }
            }
          ]
        })
        items.push(
          'separator',
          {
            key: 'insertRowAbove',
            label: t('menu:edit.insertRowAbove'),
            icon: <RowInsertAboveIcon />,
            onClick: () => {
              insertRow(visibleRow, 'above')
            }
          },
          {
            key: 'insertRowBelow',
            label: t('menu:edit.insertRowBelow'),
            icon: <RowInsertBelowIcon />,
            onClick: () => {
              insertRow(visibleRow, 'below')
            }
          },
          {
            key: 'deleteRows',
            label: t('menu:edit.deleteRows'),
            icon: <TrashIcon />,
            onClick: () => {
              deleteRows(selectedRows)
            },
            danger: true
          }
        )
      }

      if (colIndex >= 0) {
        if (items.length > 0) items.push('separator')
        items.push(
          {
            key: 'insertColLeft',
            label: t('menu:edit.insertColumnLeft'),
            icon: <ColInsertLeftIcon />,
            onClick: () => {
              insertColumn(colIndex)
            }
          },
          {
            key: 'insertColRight',
            label: t('menu:edit.insertColumnRight'),
            icon: <ColInsertRightIcon />,
            onClick: () => {
              insertColumn(colIndex + 1)
            }
          },
          {
            key: 'deleteCol',
            label: t('menu:edit.deleteColumn'),
            icon: <TrashIcon />,
            onClick: () => {
              deleteColumn(colIndex)
            },
            danger: true
          },
          'separator',
          {
            key: 'sortAsc',
            label: t('dataset.sortAscending'),
            icon: <SortAscendingIcon />,
            onClick: () => {
              if (variable) useDatasetStore.getState().setColumnSort(variable.colId, 'asc')
            }
          },
          {
            key: 'sortDesc',
            label: t('dataset.sortDescending'),
            icon: <SortDescendingIcon />,
            onClick: () => {
              if (variable) useDatasetStore.getState().setColumnSort(variable.colId, 'desc')
            }
          },
          'separator',
          {
            key: 'freezeUpToHere',
            label: t('dataset.freezeUpToHere'),
            icon: <PinIcon />,
            onClick: () => {
              setFrozenColCount(colIndex + 1)
            }
          },
          ...(frozenColCount > 0
            ? ([
                {
                  key: 'unfreezeColumns',
                  label: t('dataset.unfreezeColumns'),
                  icon: <UnpinIcon />,
                  onClick: () => {
                    setFrozenColCount(0)
                  }
                }
              ] as ContextMenuEntry[])
            : []),
          'separator',
          {
            key: 'equalColumnWidth',
            label: t('dataset.equalColumnWidth'),
            icon: <EqualWidthIcon />,
            onClick: () => {
              equalizeColumnWidths(colIndex)
            },
            // Needs at least two columns spanned by the selection.
            disabled: selectedColSpan < 2
          },
          {
            key: 'hideColumn',
            label: t('dataset.hideColumn'),
            icon: <EyeOffIcon />,
            onClick: () => {
              if (!variable) return
              setHiddenColIds(prev => new Set(prev).add(variable.colId))
            },
            // Hiding the LAST visible column would leave nothing to
            // right-click to bring it back (no column manager UI yet) —
            // block it the same way deleting the last column already is.
            disabled: variables.length - hiddenColIds.size <= 1
          },
          ...(hiddenColIds.size > 0
            ? ([
                {
                  key: 'showAllColumns',
                  label: t('dataset.showAllColumns'),
                  icon: <EyeIcon />,
                  onClick: () => {
                    setHiddenColIds(new Set())
                  }
                }
              ] as ContextMenuEntry[])
            : []),
          'separator',
          {
            key: 'toggleWeight',
            label: t('specialMenu.toggleWeight'),
            icon: <ScaleIcon />,
            onClick: () => {
              if (!variable) return
              const current = useDatasetStore.getState().weightVariable
              if (current === variable.colId) {
                useDatasetStore.getState().setWeight(null)
                warnCell(t('specialMenu.weightCleared'))
              } else if (variable.type !== 'numeric') {
                warnCell(t('specialMenu.weightNotNumeric'))
              } else {
                useDatasetStore.getState().setWeight(variable.colId)
                warnCell(t('specialMenu.weightSet', { name: variable.name }))
              }
            }
          },
          {
            key: 'toggleSplit',
            label: t('specialMenu.toggleSplit'),
            icon: <SplitIcon />,
            onClick: () => {
              if (!variable) return
              const current = useDatasetStore.getState().splitVariable
              if (current === variable.colId) {
                useDatasetStore.getState().setSplit(null)
                warnCell(t('specialMenu.splitCleared'))
              } else {
                useDatasetStore.getState().setSplit(variable.colId)
                warnCell(t('specialMenu.splitSet', { name: variable.name }))
              }
            }
          },
          // Value labels are a COLUMN-level concept (they describe the whole
          // variable, not one cell), so they live only in the column-header
          // menu — as regular icon + label items, like the rest of that menu.
          ...(fromHeader
            ? ([
                'separator',
                {
                  key: 'copyValueLabels',
                  label: t('specialMenu.copyValueLabels'),
                  icon: <TagCopyIcon />,
                  onClick: copyValueLabels
                },
                {
                  key: 'pasteValueLabels',
                  label: t('specialMenu.pasteValueLabels'),
                  icon: <TagPasteIcon />,
                  onClick: pasteValueLabels
                }
              ] as ContextMenuEntry[])
            : [])
        )
      }

      return items
    },
    [
      rangesRef,
      variables,
      copySelection,
      cutSelection,
      pasteAtActiveCell,
      pasteSpecial,
      equalizeColumnWidths,
      insertRow,
      deleteRows,
      insertColumn,
      deleteColumn,
      frozenColCount,
      hiddenColIds,
      setFrozenColCount,
      setHiddenColIds,
      warnCell,
      t
    ]
  )

  const onCellContextMenu = useCallback(
    (e: CellContextMenuEvent<CellValue[]>) => {
      const mouseEvent = e.event as MouseEvent | null
      const rowIndex = e.rowIndex
      if (!mouseEvent || rowIndex === null) return
      mouseEvent.preventDefault()
      const colIndex = (e.colDef as { dataColIndex?: number }).dataColIndex ?? -1
      // Right-clicking outside the current selection resets it to just this
      // cell (Excel convention) — otherwise a stale selection from earlier
      // would drive "delete rows"/"delete column" against the wrong target.
      const inSelection = rangesRef.current.some(r => {
        const { top, bottom, left, right } = normalizeRange(r)
        return rowIndex >= top && rowIndex <= bottom && colIndex >= left && colIndex <= right
      })
      if (!inSelection && colIndex >= 0) {
        rangesRef.current = [
          { anchorRow: rowIndex, anchorCol: colIndex, focusRow: rowIndex, focusCol: colIndex }
        ]
        gridApiRef.current?.refreshCells({ force: true })
        publishSelectionCount(rangesRef.current)
      }
      setContextMenu({
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
        items: buildContextMenuItems(rowIndex, colIndex)
      })
    },
    [rangesRef, gridApiRef, buildContextMenuItems]
  )

  // Column-header right-click (P1.4) — AG Grid's onCellContextMenu never
  // fires for header cells (only body cells), so ColumnHeader.tsx wires this
  // separately. Selection was already replaced to the clicked column by
  // ColumnHeader's onContextMenu before this runs, so `buildContextMenuItems`
  // reads a consistent selection.
  const onHeaderContextMenu = useCallback(
    (colIndex: number, x: number, y: number) => {
      setContextMenu({ x, y, items: buildContextMenuItems(0, colIndex, true) })
    },
    [buildContextMenuItems]
  )

  return {
    contextMenu,
    closeContextMenu,
    onCellContextMenu,
    onHeaderContextMenu
  }
}
