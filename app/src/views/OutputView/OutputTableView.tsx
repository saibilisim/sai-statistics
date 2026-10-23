// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutputStore, type OutputSelection } from '../../store/output-store'
import { useSettingsStore } from '../../store/settings-store'
import type { OutputTable } from '@shared/analysis-types'
import type { TableEdits } from '@shared/output-document'
import { OUTPUT_DECIMALS, resolveDecimalSeparator } from '../../lib/output-format'
import { resolveTable } from '../../lib/output-resolve'
import { copyResolvedRange, copyResolvedTable, writeDualFlavor } from '../../lib/output-clipboard'
import { buildSelectionClipboard, selectionIsConfinedTo } from '../../lib/selection-clipboard'
import { cx } from '../../lib/cx'
import {
  ContextMenu,
  type ContextMenuEntry,
  CopyIcon,
  TransposeIcon,
  EyeOffIcon,
  EyeIcon,
  TrashIcon
} from '../../components/ContextMenu'
import styles from './OutputView.module.css'

/** True when `sel` is a cell-range selection inside this exact table. */
function isThisTableSelected(
  sel: OutputSelection,
  blockId: string,
  tableIndex: number
): sel is Extract<OutputSelection, { kind: 'cells' }> {
  return sel?.kind === 'cells' && sel.blockId === blockId && sel.tableIndex === tableIndex
}

export function OutputTableView({
  table,
  blockId,
  tableIndex
}: {
  table: OutputTable
  blockId: string
  tableIndex: number
}) {
  const { t } = useTranslation(['common', 'analysis'])
  // Subscribed, not read from output-format's module state: a module-level
  // mutation is invisible to React, so changing the setting in Preferences
  // would leave already-rendered tables showing the old format until some
  // unrelated re-render happened to refresh them.
  const separatorSetting = useSettingsStore(s => s.settings.output.decimalSeparator)
  const dropLeadingZero = useSettingsStore(s => s.settings.output.dropLeadingZero)
  const numberFormat = { separator: resolveDecimalSeparator(separatorSetting), dropLeadingZero }
  const globalTableFormat = useOutputStore(s => s.globalTableFormat)
  const tableEdits = useOutputStore(s => s.edits[blockId]?.tables[String(tableIndex)])
  const setTableEdits = useOutputStore(s => s.setTableEdits)
  const revertTableEdits = useOutputStore(s => s.revertTableEdits)
  const selection = useOutputStore(s => s.selection)
  const setSelection = useOutputStore(s => s.setSelection)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    /** A native mouse-drag selection active at right-click time that extends
     *  beyond this table (e.g. it also covers another table or some
     *  narrative text) — null when there's no selection or it's fully
     *  confined to this table (the usual "Copy Table"/"Copy Selection" items
     *  already cover that case). */
    broadRange: Range | null
  } | null>(null)
  const [copied, setCopied] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const dragOriginRef = useRef<{ r: number; c: number } | null>(null)
  const tableRef = useRef<HTMLTableElement>(null)

  const resolved = resolveTable(table, t, tableEdits, numberFormat)
  const sel = isThisTableSelected(selection, blockId, tableIndex) ? selection : null

  // Matches DataView's own cell-range drag (use-cell-selection.ts): a
  // window-level mouseup ends the drag reliably even when the mouse is
  // released outside the table (fast drags routinely overshoot it), unlike
  // a container-scoped onMouseUp which simply never fires in that case.
  useEffect(() => {
    function onWindowMouseUp() {
      dragOriginRef.current = null
    }
    window.addEventListener('mouseup', onWindowMouseUp)
    return () => {
      window.removeEventListener('mouseup', onWindowMouseUp)
    }
  }, [])

  function patch(p: Partial<TableEdits>) {
    setTableEdits(blockId, tableIndex, p)
  }

  function selectRange(r1: number, c1: number, r2: number, c2: number) {
    setSelection({ kind: 'cells', blockId, tableIndex, r1, c1, r2, c2 })
  }

  function cellSelected(r: number, c: number): boolean {
    if (!sel) return false
    const rTop = Math.min(sel.r1, sel.r2)
    const rBot = Math.max(sel.r1, sel.r2)
    const cLeft = Math.min(sel.c1, sel.c2)
    const cRight = Math.max(sel.c1, sel.c2)
    return r >= rTop && r <= rBot && c >= cLeft && c <= cRight
  }

  const handleCopyTable = () => {
    void copyResolvedTable(resolved)
    setCopied(true)
    setContextMenu(null)
    setTimeout(() => {
      setCopied(false)
    }, 1200)
  }

  const handleCopySelection = () => {
    if (!sel) return
    void copyResolvedRange(resolved, sel.r1, sel.c1, sel.r2, sel.c2)
    setCopied(true)
    setContextMenu(null)
    setTimeout(() => {
      setCopied(false)
    }, 1200)
  }

  const handleCopyBroadSelection = () => {
    const range = contextMenu?.broadRange
    setContextMenu(null)
    if (!range) return
    const { html, text } = buildSelectionClipboard(range)
    void writeDualFlavor(html, text)
  }

  // A display row/col does not always map onto the same-numbered original
  // row/col (hidden rows shift things, and a transposed table swaps the two
  // axes entirely) — these read the ORIGIN off the actual resolved cells
  // rather than assuming display index === original index.
  function origRowOfDisplayRow(r: number): number | undefined {
    return resolved.rows[r]?.find(c => c.origRow >= 0)?.origRow
  }
  function origColOfDisplayRow(r: number): number | undefined {
    return resolved.rows[r]?.find(c => c.origCol >= 0)?.origCol
  }
  function origColOfDisplayCol(c: number): number | undefined {
    for (const row of resolved.rows) {
      const cell = row[c]
      if (cell && cell.origCol >= 0) return cell.origCol
    }
    return undefined
  }
  function origRowOfDisplayCol(c: number): number | undefined {
    for (const row of resolved.rows) {
      const cell = row[c]
      if (cell && cell.origRow >= 0) return cell.origRow
    }
    return undefined
  }

  const transposed = tableEdits?.transposed ?? false

  function hideSelectedRows() {
    if (!sel) return
    const rTop = Math.min(sel.r1, sel.r2)
    const rBot = Math.max(sel.r1, sel.r2)
    // Transposed: a display row IS one original column — hide it as a column.
    if (transposed) {
      const toHide = new Set(tableEdits?.hiddenCols ?? [])
      for (let r = rTop; r <= rBot; r++) {
        const c = origColOfDisplayRow(r)
        if (c !== undefined) toHide.add(c)
      }
      patch({ hiddenCols: [...toHide] })
    } else {
      const toHide = new Set(tableEdits?.hiddenRows ?? [])
      for (let r = rTop; r <= rBot; r++) {
        const rr = origRowOfDisplayRow(r)
        if (rr !== undefined) toHide.add(rr)
      }
      patch({ hiddenRows: [...toHide] })
    }
  }

  function hideSelectedCols() {
    if (!sel) return
    const cLeft = Math.min(sel.c1, sel.c2)
    const cRight = Math.max(sel.c1, sel.c2)
    // Transposed: a display column IS one original row — hide it as a row.
    if (transposed) {
      const toHide = new Set(tableEdits?.hiddenRows ?? [])
      for (let c = cLeft; c <= cRight; c++) {
        const r = origRowOfDisplayCol(c)
        if (r !== undefined) toHide.add(r)
      }
      patch({ hiddenRows: [...toHide] })
    } else {
      const toHide = new Set(tableEdits?.hiddenCols ?? [])
      for (let c = cLeft; c <= cRight; c++) {
        const cc = origColOfDisplayCol(c)
        if (cc !== undefined) toHide.add(cc)
      }
      patch({ hiddenCols: [...toHide] })
    }
  }

  function adjustDecimals(delta: number) {
    const current = tableEdits?.decimals ?? OUTPUT_DECIMALS
    patch({ decimals: Math.min(6, Math.max(0, current + delta)) })
  }

  const hasHidden =
    (tableEdits?.hiddenRows.length ?? 0) > 0 || (tableEdits?.hiddenCols.length ?? 0) > 0
  const hasAnyEdits = tableEdits !== undefined

  const menuItems: ContextMenuEntry[] = [
    ...(contextMenu?.broadRange
      ? [
          {
            key: 'copyBroadSelection',
            label: t('output.edit.copySelectionAll'),
            icon: <CopyIcon />,
            onClick: handleCopyBroadSelection
          } satisfies ContextMenuEntry,
          'separator' as const
        ]
      : []),
    {
      key: 'copyTable',
      label: copied ? t('common.copied') : t('output.edit.copyTable'),
      icon: <CopyIcon />,
      onClick: handleCopyTable
    },
    ...(sel
      ? [
          {
            key: 'copySelection',
            label: t('output.edit.copySelection'),
            icon: <CopyIcon />,
            onClick: handleCopySelection
          } satisfies ContextMenuEntry,
          'separator' as const,
          {
            key: 'hideRows',
            label: t('output.edit.hideSelectedRows'),
            icon: <EyeOffIcon />,
            onClick: hideSelectedRows
          } satisfies ContextMenuEntry,
          {
            key: 'hideCols',
            label: t('output.edit.hideSelectedCols'),
            icon: <EyeOffIcon />,
            onClick: hideSelectedCols
          } satisfies ContextMenuEntry
        ]
      : []),
    'separator',
    {
      key: 'decimalsMore',
      label: t('output.edit.decimalsIncrease'),
      onClick: () => {
        adjustDecimals(1)
      }
    },
    {
      key: 'decimalsLess',
      label: t('output.edit.decimalsDecrease'),
      onClick: () => {
        adjustDecimals(-1)
      }
    },
    ...(hasHidden
      ? [
          {
            key: 'showAll',
            label: t('output.edit.showAllHidden'),
            icon: <EyeIcon />,
            onClick: () => {
              patch({ hiddenRows: [], hiddenCols: [] })
            }
          } satisfies ContextMenuEntry
        ]
      : []),
    'separator',
    {
      key: 'transpose',
      label: t('output.edit.transpose'),
      icon: <TransposeIcon />,
      onClick: () => {
        patch({ transposed: !(tableEdits?.transposed ?? false) })
      }
    },
    ...(hasAnyEdits
      ? [
          'separator' as const,
          {
            key: 'revert',
            label: t('output.edit.revertTable'),
            icon: <TrashIcon />,
            danger: true,
            onClick: () => {
              revertTableEdits(blockId, tableIndex)
            }
          } satisfies ContextMenuEntry
        ]
      : [])
  ]

  const tableClassName = cx(
    styles.outputTable,
    globalTableFormat === 'apa' && styles.tableApa,
    globalTableFormat === 'classic' && styles.tableClassic,
    globalTableFormat === 'compact' && styles.tableCompact
  )

  return (
    <div className={styles.tableWrapper} id={`table-${blockId}-${String(tableIndex)}`}>
      {resolved.title &&
        (editingTitle ? (
          <input
            className={styles.tableTitle}
            autoFocus
            defaultValue={resolved.title}
            onBlur={e => {
              patch({ titleOverride: e.target.value })
              setEditingTitle(false)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setEditingTitle(false)
            }}
          />
        ) : (
          <div
            className={styles.tableTitle}
            onDoubleClick={() => {
              setEditingTitle(true)
            }}
          >
            {resolved.title}
          </div>
        ))}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => {
            setContextMenu(null)
          }}
        />
      )}
      <table
        ref={tableRef}
        className={tableClassName}
        onContextMenu={e => {
          e.preventDefault()
          let broadRange: Range | null = null
          const winSel = window.getSelection()
          if (winSel && winSel.rangeCount > 0 && !winSel.isCollapsed && tableRef.current) {
            const range = winSel.getRangeAt(0)
            if (!selectionIsConfinedTo(range, tableRef.current)) broadRange = range
          }
          setContextMenu({ x: e.clientX, y: e.clientY, broadRange })
        }}
      >
        <thead>
          <tr>
            {resolved.columns.map((col, i) => (
              <th
                key={i}
                onMouseDown={e => {
                  if (e.button !== 0 && sel) return
                  selectRange(0, i, resolved.rows.length - 1, i)
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {resolved.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={cx(
                    cell.align === 'num' ? styles.numCell : styles.txtCell,
                    cell.sigLevel === 'vsig' && styles.pVSig,
                    cell.sigLevel === 'sig' && styles.pSig,
                    cellSelected(ri, ci) && styles.cellSelected
                  )}
                  // Range selection (hide-rows/cols, transpose) coexists with
                  // native text selection now — not calling preventDefault()
                  // here matches DataView's own onCellMouseDown, leaving the
                  // browser's mouse event dispatch alone so drags keep firing
                  // mouseenter reliably across the whole table.
                  onMouseDown={e => {
                    // Right-click inside the current range keeps it (Excel
                    // behavior) so the menu's "Copy Selection" copies what
                    // Ctrl+C would; it used to shrink the range to this cell.
                    if (e.button !== 0) {
                      if (!cellSelected(ri, ci)) selectRange(ri, ci, ri, ci)
                      return
                    }
                    dragOriginRef.current = { r: ri, c: ci }
                    if (e.shiftKey && sel) {
                      selectRange(sel.r1, sel.c1, ri, ci)
                    } else {
                      selectRange(ri, ci, ri, ci)
                    }
                  }}
                  onMouseEnter={() => {
                    const origin = dragOriginRef.current
                    if (origin) selectRange(origin.r, origin.c, ri, ci)
                  }}
                >
                  {cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {resolved.footnotes.map((f, i) => (
        <div key={i} className={styles.tableFootnote}>
          {f}
        </div>
      ))}
    </div>
  )
}
