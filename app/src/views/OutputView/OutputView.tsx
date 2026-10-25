// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OutputView — SPSS-style output window.
 *
 * Left panel: navigator tree (one item per analysis block)
 * Right panel: rendered analysis results (tables + charts)
 *
 * Also subscribes to job:progress / job:complete / job:error events to
 * show running indicators and add completed results to the store.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  useOutputStore,
  type OutputBlock,
  type OutputSelection,
  type TableFormat
} from '../../store/output-store'
import { useUIStore } from '../../store/ui-store'
import { translateOutputKey } from '../../lib/output-format'
import { cx } from '../../lib/cx'
import { useWidthResizer } from '../../lib/use-width-resizer'
import { WidthHandle } from '../../components/WidthHandle/WidthHandle'
import {
  ContextMenu,
  EyeOffIcon,
  EyeIcon,
  PlusIcon,
  SaveIcon,
  ExportIcon,
  SearchIcon,
  CopyIcon
} from '../../components/ContextMenu'
import { dispatchMenu } from '../../lib/menu-dispatch'
import { exportOutputAs, type ExportFormat } from '../../lib/output-export'
import {
  copyMultipleSelectedItems,
  copyResolvedRange,
  writeDualFlavor
} from '../../lib/output-clipboard'
import { resolveTable } from '../../lib/output-resolve'
import {
  buildSelectionClipboard,
  getActiveSelectionRange,
  hasForeignSelection,
  selectionIsConfinedTo
} from '../../lib/selection-clipboard'
import i18nInstance from '../../i18n'
import { AnalysisBlock } from './AnalysisBlock'
import { RunningBlock, type RunningJob } from './RunningBlock'
import { InsertedItemRow } from './InsertedItemRow'
import { ConfirmDialog } from '../../components/Dialogs/ConfirmDialog'
import styles from './OutputView.module.css'

/** Formats offered by the Output toolbar's export split-button (HTML lives
 *  under the save split-button as "Save Output as HTML"). */
const TOOLBAR_EXPORT_FORMATS: ExportFormat[] = ['pdf', 'word', 'excel', 'csv', 'markdown']

/** Navigator width bounds while dragging its edge (px). */
const NAV_MIN_PX = 140
const NAV_MIN_REST_PX = 320

// ─────────────────────────────────────────────────────────────
//  Main OutputView
// ─────────────────────────────────────────────────────────────

/** Works for any doc item id (a block OR an inserted heading/text/page-break
 *  row) — `OutputSelection.ids` isn't block-specific despite the field name. */
function isItemSelected(selection: OutputSelection, id: string): boolean {
  return selection?.kind === 'blocks' && selection.ids.includes(id)
}

/** Output search (easy win, high value once a session has 10+ analyses
 *  stacked up): a block matches if the query appears anywhere a user would
 *  actually look — title, the auto summary line, warnings/notes, or any
 *  table's column headers/cell values. `translateOutputKey` is safe to call
 *  on raw (non-i18n-key) strings too — it just returns them untouched. */
function blockMatchesQuery(block: OutputBlock, query: string, t: TFunction): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    translateOutputKey(block.titleKey, t),
    block.summary ?? '',
    ...block.result.warnings.map(w => translateOutputKey(w, t)),
    ...block.result.notes.map(n => translateOutputKey(n, t)),
    ...block.result.tables.flatMap(table => [
      translateOutputKey(table.titleKey, t),
      ...table.columns.map(c => translateOutputKey(c, t)),
      ...table.rows.flat().map(cell => (cell === null ? '' : String(cell)))
    ])
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

export function OutputView() {
  const { t } = useTranslation(['common', 'analysis', 'dialogs'])
  const blocks = useOutputStore(s => s.blocks)
  const items = useOutputStore(s => s.items)
  const edits = useOutputStore(s => s.edits)
  const selection = useOutputStore(s => s.selection)
  const removeBlock = useOutputStore(s => s.removeBlock)
  const removeItem = useOutputStore(s => s.removeItem)
  const clearAll = useOutputStore(s => s.clearAll)
  const selectBlock = useOutputStore(s => s.selectBlock)
  const setSelection = useOutputStore(s => s.setSelection)
  const toggleBlockHidden = useOutputStore(s => s.toggleBlockHidden)
  const reorderItems = useOutputStore(s => s.reorderItems)
  const insertItem = useOutputStore(s => s.insertItem)
  const globalTableFormat = useOutputStore(s => s.globalTableFormat)
  const setGlobalTableFormat = useOutputStore(s => s.setGlobalTableFormat)
  const collapseAll = useOutputStore(s => s.collapseAll)
  const expandAll = useOutputStore(s => s.expandAll)
  const toggleCollapse = useOutputStore(s => s.toggleCollapse)
  const {
    panelRef: navRef,
    panelStyle: navStyle,
    handleProps: navHandleProps
  } = useWidthResizer<HTMLDivElement>({
    storageKey: 'sai.output.navigatorWidth',
    edge: 'right',
    minPx: NAV_MIN_PX,
    minRestPx: NAV_MIN_REST_PX
  })

  const blocksById = new Map(blocks.map(b => [b.id, b]))

  // Output search — non-block items (headings/text/page-breaks) always pass
  // through since they're structural, not analysis results to filter out.
  const [searchQuery, setSearchQuery] = useState('')
  const visibleItems = items.filter(item => {
    if (item.kind !== 'block') return true
    const block = blocksById.get(item.id)
    return block ? blockMatchesQuery(block, searchQuery, t) : true
  })

  // Build flattened list of all visible navigator tree items (including table sub-items)
  const allNavItems: string[] = []
  visibleItems.forEach(item => {
    if (item.kind === 'block') {
      allNavItems.push(item.id)
      const block = blocksById.get(item.id)
      if (block && !block.isCollapsed) {
        block.result.tables.forEach((_, i) => {
          allNavItems.push(`table-${block.id}-${String(i)}`)
        })
      }
    } else {
      allNavItems.push(item.id)
    }
  })

  // Explorer/Finder-style multi-select for the navigator
  const selectionAnchorRef = useRef<string | null>(null)

  function handleItemClick(
    id: string,
    e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
  ) {
    // Picking blocks makes them the copy target; a leftover text highlight
    // would otherwise win Ctrl+C (native selection has priority, see below).
    window.getSelection()?.removeAllRanges()
    if (e.shiftKey && selectionAnchorRef.current) {
      const anchorIdx = allNavItems.indexOf(selectionAnchorRef.current)
      const clickIdx = allNavItems.indexOf(id)
      if (anchorIdx !== -1 && clickIdx !== -1) {
        const [start, end] = anchorIdx < clickIdx ? [anchorIdx, clickIdx] : [clickIdx, anchorIdx]
        setSelection({ kind: 'blocks', ids: allNavItems.slice(start, end + 1) })
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const current = selection?.kind === 'blocks' ? selection.ids : []
      const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
      setSelection(next.length > 0 ? { kind: 'blocks', ids: next } : null)
      selectionAnchorRef.current = id
      return
    }
    selectBlock(id)
    selectionAnchorRef.current = id
  }

  // Navigator right-click ▸ Copy
  const [navContextMenu, setNavContextMenu] = useState<{
    x: number
    y: number
    itemId: string
  } | null>(null)

  function handleNavContextMenu(e: React.MouseEvent, itemId: string) {
    e.preventDefault()
    e.stopPropagation()

    // If right-clicked item is not already selected, select it
    if (selection?.kind !== 'blocks' || !selection.ids.includes(itemId)) {
      setSelection({ kind: 'blocks', ids: [itemId] })
      selectionAnchorRef.current = itemId
    }
    setNavContextMenu({ x: e.clientX, y: e.clientY, itemId })
  }

  const handleCopySelected = useCallback(
    async (targetItemId?: string) => {
      let idsToCopy: string[] = []
      if (selection?.kind === 'blocks' && selection.ids.length > 0) {
        if (targetItemId && !selection.ids.includes(targetItemId)) {
          idsToCopy = [targetItemId]
        } else {
          idsToCopy = selection.ids
        }
      } else if (targetItemId) {
        idsToCopy = [targetItemId]
      }
      if (idsToCopy.length === 0) return

      await copyMultipleSelectedItems(idsToCopy, blocks, items, edits, t, translateOutputKey)
    },
    [selection, blocks, items, edits, t]
  )

  // Ctrl+C for a table's own cell-range selection (the click/shift-drag
  // range used for hide-rows/transpose, distinct from both the navigator's
  // block selection above and a free native mouse-drag text selection below)
  // — mirrors what that table's own "Copy Selection" context-menu item does.
  const handleCopyCellsSelection = useCallback(
    async (sel: Extract<OutputSelection, { kind: 'cells' }>) => {
      const block = blocks.find(b => b.id === sel.blockId)
      const table = block?.result.tables[sel.tableIndex]
      if (!table) return
      const tableEdit = edits[sel.blockId]?.tables[String(sel.tableIndex)]
      const resolved = resolveTable(table, t, tableEdit)
      await copyResolvedRange(resolved, sel.r1, sel.c1, sel.r2, sel.c2)
    },
    [blocks, edits, t]
  )

  // Navigator drag-reorder — live, AG Grid-style: the list actually reorders
  // as you drag over a new row (not just on drop), so the row you lifted
  // from visibly closes up while you're still dragging. `drop` only clears
  // drag state; the order is already correct from the last dragover.
  const dragIdRef = useRef<string | null>(null)
  const dragOverIdRef = useRef<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  // FLIP-style slide animation for the reordered rows (and, for a block row,
  // its table sub-items move as one unit with it) — a plain CSS transition
  // driven from measured before/after positions, not an animation library
  // (none is part of this project's stack; see CLAUDE.md §2).
  const navItemRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const prevNavRectsRef = useRef<Map<string, DOMRect> | null>(null)

  function setNavItemRef(id: string) {
    return (el: HTMLDivElement | null) => {
      if (el) navItemRefs.current.set(id, el)
      else navItemRefs.current.delete(id)
    }
  }

  function captureNavRectsForFlip() {
    const rects = new Map<string, DOMRect>()
    navItemRefs.current.forEach((el, id) => {
      rects.set(id, el.getBoundingClientRect())
    })
    prevNavRectsRef.current = rects
  }

  // Runs after every `items`-order-affecting render. Only actually animates
  // when a dragover/drop just captured "before" positions — inserts/removals
  // of other items also change `items` but have no captured rects, so this
  // no-ops for those (each id looked up in `prevRects` returns undefined and
  // is skipped). The actively-dragged row is skipped too: the browser's own
  // drag ghost already represents it following the cursor, so sliding the
  // real (left-behind) element under it would just fight that ghost.
  useLayoutEffect(() => {
    const prevRects = prevNavRectsRef.current
    if (!prevRects) return
    prevNavRectsRef.current = null // consume once — don't replay on the next unrelated render
    navItemRefs.current.forEach((el, id) => {
      if (id === dragIdRef.current) return
      const prevRect = prevRects.get(id)
      if (!prevRect) return
      const deltaY = prevRect.top - el.getBoundingClientRect().top
      if (Math.abs(deltaY) < 1) return
      el.style.transition = 'none'
      el.style.transform = `translateY(${String(deltaY)}px)`
      void el.getBoundingClientRect() // force reflow so the jump above commits before animating away
      el.style.transition = 'transform 220ms ease'
      el.style.transform = ''
      const onDone = () => {
        el.style.transition = ''
        el.style.transform = ''
        el.removeEventListener('transitionend', onDone)
      }
      el.addEventListener('transitionend', onDone)
    })
  }, [items])

  function onItemDragStart(e: DragEvent<HTMLDivElement>, id: string) {
    dragIdRef.current = id
    dragOverIdRef.current = null
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  function onItemDragOver(e: DragEvent<HTMLDivElement>, overId: string) {
    const dragId = dragIdRef.current
    if (dragId === null || dragId === overId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIdRef.current === overId) return // already previewed here this pass
    dragOverIdRef.current = overId
    setDragOverId(overId)
    captureNavRectsForFlip()
    reorderItems(dragId, overId)
  }
  function onItemDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    dragIdRef.current = null
    dragOverIdRef.current = null
    setDragOverId(null)
  }
  // Fires on the drag source regardless of whether a drop landed anywhere
  // (e.g. released outside the navigator) — without this, a cancelled drag
  // could leave the last-hovered row stuck with its highlight class.
  function onItemDragEnd() {
    dragIdRef.current = null
    dragOverIdRef.current = null
    setDragOverId(null)
  }

  // Navigate to a specific table
  function handleTableNavClick(block: OutputBlock, tableIndex: number) {
    if (block.isCollapsed) {
      toggleCollapse(block.id)
    }
    requestAnimationFrame(() => {
      const el = document.getElementById(`table-${block.id}-${String(tableIndex)}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const flashClass = styles.navHighlightFlash
      if (el && flashClass) {
        el.classList.add(flashClass)
        setTimeout(() => {
          el.classList.remove(flashClass)
        }, 1200)
      }
    })
  }

  // Clear All/Remove confirm
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false)
  const [itemToRemove, setItemToRemove] = useState<string | null>(null)

  const [insertMenuPos, setInsertMenuPos] = useState<{ x: number; y: number } | null>(null)
  function handleInsert(kind: 'heading' | 'text' | 'pageBreak') {
    // At the end, where the next result will follow it (drag to move it).
    const id = crypto.randomUUID()
    if (kind === 'pageBreak') {
      insertItem({ kind, id })
    } else {
      insertItem({ kind, id, text: '' })
    }
    setInsertMenuPos(null)
  }

  // Save/Export split-buttons
  const [saveMenuPos, setSaveMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [exportMenuPos, setExportMenuPos] = useState<{ x: number; y: number } | null>(null)

  function handleToolbarExport(format: ExportFormat) {
    setExportMenuPos(null)
    void exportOutputAs(format, i18nInstance.t).catch((err: unknown) => {
      console.error('Failed to export output:', err)
    })
  }

  // Keyboard shortcuts
  const activeTab = useUIStore(s => s.activeTab)
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (activeTab !== 'output') return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const target = e.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if (e.key.toLowerCase() === 'c') {
        const content = contentRef.current
        // Text highlighted OUTSIDE the output pane (e.g. the AI chat) — not
        // ours to copy; a stale table cell selection used to win here.
        if (content && hasForeignSelection(content)) return
        // A native text selection inside the pane is what the user just
        // highlighted, so it beats an older navigator/cell selection — except
        // when it lies within the table that owns the cell selection (a drag
        // across cells makes both), where the cell copy is the richer form.
        const nativeRange = content ? getActiveSelectionRange(content) : null
        if (nativeRange) {
          const cellSel = selection?.kind === 'cells' ? selection : null
          const cellTable = cellSel
            ? document.querySelector(
                `#table-${cellSel.blockId}-${String(cellSel.tableIndex)} table`
              )
            : null
          if (
            cellSel &&
            cellTable instanceof HTMLElement &&
            selectionIsConfinedTo(nativeRange, cellTable)
          ) {
            e.preventDefault()
            void handleCopyCellsSelection(cellSel)
          }
          // Otherwise fall through to the browser's copy → handleContentCopy.
          return
        }
        if (selection?.kind === 'blocks' && selection.ids.length > 0) {
          e.preventDefault()
          void handleCopySelected()
        } else if (selection?.kind === 'cells') {
          e.preventDefault()
          void handleCopyCellsSelection(selection)
        }
        // Otherwise: no navigator/cell-range selection is active, so leave
        // this key event alone — the browser's default Ctrl+C fires, which
        // dispatches the 'copy' event the content pane's onCopy handles
        // below (a free native mouse-drag text/table selection, if any).
      } else if (e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) useOutputStore.temporal.getState().redo()
        else useOutputStore.temporal.getState().undo()
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault()
        useOutputStore.temporal.getState().redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeTab, selection, handleCopySelected, handleCopyCellsSelection])

  const [runningJobs, setRunningJobs] = useState<RunningJob[]>([])

  // Free mouse-drag selection across the output content (spanning several
  // tables and/or narrative text, e.g. a warning line + two result tables) —
  // as opposed to the navigator's own block/table-level Ctrl+C
  // (handleCopySelected), a table's own cell-range Ctrl+C
  // (handleCopyCellsSelection) and a single table's own "Copy Table" context
  // menu item. Always builds from the live selection (rather than only
  // stepping in once 2+ tables are involved and otherwise trusting the
  // browser's own default 'copy' serialization) — the whole point of a
  // "just select and copy always works" contract is not depending on the
  // browser's own HTML-selection-to-clipboard behavior at all here, since
  // that is exactly the path that was silently producing nothing to paste.
  const handleContentCopy = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!contentRef.current) return
    const range = getActiveSelectionRange(contentRef.current)
    if (!range) return
    const { html, text } = buildSelectionClipboard(range)
    e.clipboardData.setData('text/html', html)
    e.clipboardData.setData('text/plain', text)
    e.preventDefault()
  }, [])

  // Right-click ▸ Copy fallback for a free mouse-drag selection that isn't
  // (fully) inside one table — e.g. a warning line plus two result tables,
  // or plain narrative text between blocks. Our own context menus replace
  // the browser's native one everywhere in this view, so without this,
  // right-clicking a selection that lands outside any single table's own
  // "Copy Table" menu would have no way to be copied at all. Skips whenever
  // a nested handler (a table's own onContextMenu, the navigator's) already
  // claimed the event.
  const [contentContextMenu, setContentContextMenu] = useState<{
    x: number
    y: number
    range: Range
  } | null>(null)

  function handleContentContextMenu(e: React.MouseEvent<HTMLDivElement>) {
    if (e.defaultPrevented || !contentRef.current) return
    const range = getActiveSelectionRange(contentRef.current)
    if (!range) return
    e.preventDefault()
    setContentContextMenu({ x: e.clientX, y: e.clientY, range })
  }

  // Subscribe to job events from Main process
  useEffect(() => {
    const unsubProgress = window.api.on.jobProgress(payload => {
      setRunningJobs(prev => {
        const existing = prev.find(j => j.jobId === payload.jobId)
        if (existing) {
          return prev.map(j =>
            j.jobId === payload.jobId
              ? { ...j, percent: payload.percent, messageKey: payload.messageKey }
              : j
          )
        }
        return [
          ...prev,
          {
            jobId: payload.jobId,
            analysisId: payload.analysisId ?? '',
            percent: payload.percent,
            messageKey: payload.messageKey
          }
        ]
      })
    })

    const unsubComplete = window.api.on.jobComplete(payload => {
      setRunningJobs(prev => prev.filter(j => j.jobId !== payload.jobId))
      if (payload.analysisId === 'normality') return
      setTimeout(() => {
        // The new result is at the end of the document.
        if (contentRef.current) {
          contentRef.current.scrollTo({
            top: contentRef.current.scrollHeight,
            behavior: 'smooth'
          })
        }
      }, 100)
    })

    const unsubError = window.api.on.jobError(payload => {
      setRunningJobs(prev => prev.filter(j => j.jobId !== payload.jobId))
    })

    return () => {
      unsubProgress()
      unsubComplete()
      unsubError()
    }
  }, [])

  const hasContent = blocks.length > 0 || runningJobs.length > 0
  const allExpanded = blocks.length > 0 && blocks.every(b => !b.isCollapsed)

  return (
    <div className={styles.root}>
      {/* Left navigator */}
      <div className={styles.navigator} ref={navRef} style={navStyle}>
        <div className={styles.navigatorHeader}>{t('output.navigator')}</div>
        {hasContent && (
          <div className={styles.navSearchBox}>
            <SearchIcon size={13} />
            <input
              className={styles.navSearchInput}
              type="text"
              value={searchQuery}
              placeholder={t('output.searchPlaceholder')}
              onChange={e => {
                setSearchQuery(e.target.value)
              }}
            />
            {searchQuery && (
              <button
                className={styles.navSearchClear}
                onClick={() => {
                  setSearchQuery('')
                }}
                aria-label={t('common.clear')}
              >
                ×
              </button>
            )}
          </div>
        )}
        <div className={styles.navList}>
          {runningJobs.map(job => (
            <div key={job.jobId} className={styles.navItem}>
              <span className={styles.navItemIcon}>⟳</span>
              <div className={styles.navItemText}>
                <div className={styles.navItemTitle}>
                  {t(`analysis:${job.analysisId}.title`, { defaultValue: job.analysisId })}
                </div>
                <div className={styles.navItemMeta}>{job.percent}%</div>
              </div>
            </div>
          ))}
          {visibleItems.map(item => {
            if (item.kind !== 'block') {
              const label =
                item.kind === 'heading'
                  ? item.text || t('output.headingPlaceholder')
                  : item.kind === 'text'
                    ? item.text || t('output.textPlaceholder')
                    : t('output.pageBreak')
              return (
                <div
                  key={item.id}
                  ref={setNavItemRef(item.id)}
                  className={cx(
                    styles.navItem,
                    isItemSelected(selection, item.id) && styles.selected,
                    dragOverId === item.id && styles.navItemDragOver
                  )}
                  draggable
                  onDragStart={e => {
                    onItemDragStart(e, item.id)
                  }}
                  onDragOver={e => {
                    onItemDragOver(e, item.id)
                  }}
                  onDrop={onItemDrop}
                  onDragEnd={onItemDragEnd}
                  onClick={e => {
                    handleItemClick(item.id, e)
                    document
                      .getElementById(`item-${item.id}`)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  onContextMenu={e => {
                    handleNavContextMenu(e, item.id)
                  }}
                >
                  <span className={styles.navItemIcon}>
                    {item.kind === 'heading' ? 'H' : item.kind === 'text' ? '¶' : '⊐'}
                  </span>
                  <div className={styles.navItemText}>
                    <div className={styles.navItemTitle}>{label}</div>
                  </div>
                  <div className={styles.navItemActions}>
                    <button
                      className={styles.navActionBtn}
                      onClick={e => {
                        e.stopPropagation()
                        setItemToRemove(item.id)
                      }}
                      aria-label={t('output.removeItem')}
                      title={t('output.removeItem')}
                    >
                      ×
                    </button>
                  </div>
                </div>
              )
            }
            const block = blocksById.get(item.id)
            if (!block) return null
            const isHidden = edits[block.id]?.hidden === true
            return (
              <div key={block.id} ref={setNavItemRef(block.id)}>
                <div
                  className={cx(
                    styles.navItem,
                    isItemSelected(selection, block.id) && styles.selected,
                    dragOverId === block.id && styles.navItemDragOver,
                    isHidden && styles.navItemHidden
                  )}
                  draggable
                  onDragStart={e => {
                    onItemDragStart(e, block.id)
                  }}
                  onDragOver={e => {
                    onItemDragOver(e, block.id)
                  }}
                  onDrop={onItemDrop}
                  onDragEnd={onItemDragEnd}
                  onClick={e => {
                    handleItemClick(block.id, e)
                    document
                      .getElementById(`block-${block.id}`)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  onContextMenu={e => {
                    handleNavContextMenu(e, block.id)
                  }}
                >
                  <button
                    className={styles.blockCollapseBtn}
                    onClick={e => {
                      e.stopPropagation()
                      toggleCollapse(block.id)
                    }}
                    aria-label={block.isCollapsed ? t('output.expand') : t('output.collapse')}
                    title={block.isCollapsed ? t('output.expand') : t('output.collapse')}
                  >
                    {block.isCollapsed ? '▶' : '▼'}
                  </button>
                  <span className={styles.navItemIcon}>{block.result.success ? '📊' : '⚠'}</span>
                  <div className={styles.navItemText}>
                    <div className={styles.navItemTitle}>
                      {edits[block.id]?.titleOverride ?? translateOutputKey(block.titleKey, t)}
                    </div>
                    <div className={styles.navItemMeta}>
                      {new Date(block.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  <div className={styles.navItemActions}>
                    <button
                      className={styles.navActionBtn}
                      onClick={e => {
                        e.stopPropagation()
                        toggleBlockHidden(block.id)
                      }}
                      aria-label={isHidden ? t('output.showBlock') : t('output.hideBlock')}
                      title={isHidden ? t('output.showBlock') : t('output.hideBlock')}
                    >
                      {isHidden ? <EyeIcon size={12} /> : <EyeOffIcon size={12} />}
                    </button>
                    <button
                      className={styles.navActionBtn}
                      onClick={e => {
                        e.stopPropagation()
                        setItemToRemove(block.id)
                      }}
                      aria-label={t('output.removeBlock')}
                      title={t('output.removeBlock')}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {/* Per-table sub-items (SPSS Viewer outline style) — togglable via block.isCollapsed */}
                {!block.isCollapsed &&
                  block.result.tables.map((table, i) => {
                    const subItemId = `table-${block.id}-${String(i)}`
                    return (
                      <div
                        key={i}
                        className={cx(
                          styles.navSubItem,
                          isItemSelected(selection, subItemId) && styles.selected
                        )}
                        onClick={e => {
                          e.stopPropagation()
                          handleItemClick(subItemId, e)
                          handleTableNavClick(block, i)
                        }}
                        onContextMenu={e => {
                          handleNavContextMenu(e, subItemId)
                        }}
                      >
                        <span className={styles.navItemIcon}>▤</span>
                        <div className={styles.navItemText}>
                          <div className={styles.navSubItemTitle}>
                            {edits[block.id]?.tables[String(i)]?.titleOverride ??
                              translateOutputKey(table.titleKey, t)}
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            )
          })}
          {(!hasContent || (searchQuery && visibleItems.length === 0)) && (
            <div
              style={{
                padding: 'var(--space-sm)',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-disabled)'
              }}
            >
              {t('output.noResults')}
            </div>
          )}
        </div>
        {navContextMenu && (
          <ContextMenu
            x={navContextMenu.x}
            y={navContextMenu.y}
            items={[
              {
                key: 'copy',
                label: t('common.copy'),
                icon: <CopyIcon size={14} />,
                onClick: () => {
                  const itemId = navContextMenu.itemId
                  setNavContextMenu(null)
                  void handleCopySelected(itemId)
                }
              }
            ]}
            onClose={() => {
              setNavContextMenu(null)
            }}
          />
        )}
      </div>

      <WidthHandle label={t('output.resizeNavigator')} {...navHandleProps} />

      {/* Right content */}
      <div className={styles.rightPanel}>
        {/* Toolbar — save/export split-buttons stay visible even when the
            output is empty so "Open Output Document" remains reachable. */}
        <div className={styles.toolbar}>
          <button
            className={styles.toolbarBtn}
            title={t('output.save')}
            aria-label={t('output.save')}
            onClick={e => {
              setSaveMenuPos({ x: e.clientX, y: e.clientY })
            }}
          >
            <SaveIcon size={14} />
          </button>
          {saveMenuPos && (
            <ContextMenu
              x={saveMenuPos.x}
              y={saveMenuPos.y}
              items={[
                {
                  key: 'html',
                  label: t('file.saveOutput', { ns: 'menu' }),
                  onClick: () => {
                    setSaveMenuPos(null)
                    dispatchMenu('menu:file:save-output')
                  }
                }
              ]}
              onClose={() => {
                setSaveMenuPos(null)
              }}
            />
          )}
          <button
            className={styles.toolbarBtn}
            title={t('output.export')}
            aria-label={t('output.export')}
            onClick={e => {
              setExportMenuPos({ x: e.clientX, y: e.clientY })
            }}
          >
            <ExportIcon size={14} />
          </button>
          {exportMenuPos && (
            <ContextMenu
              x={exportMenuPos.x}
              y={exportMenuPos.y}
              items={TOOLBAR_EXPORT_FORMATS.map(fmt => ({
                key: fmt,
                label: t(`dialogs:outputExport.formats.${fmt}`),
                onClick: () => {
                  handleToolbarExport(fmt)
                }
              }))}
              onClose={() => {
                setExportMenuPos(null)
              }}
            />
          )}
          {hasContent && (
            <>
              <button
                className={styles.toolbarBtn}
                onClick={() => {
                  setClearAllConfirmOpen(true)
                }}
              >
                {t('output.clearAll')}
              </button>
              <button
                className={styles.toolbarBtn}
                title={t('output.collapseExpandToggle')}
                onClick={allExpanded ? collapseAll : expandAll}
              >
                {allExpanded ? t('output.collapseAll') : t('output.expandAll')}
              </button>
              <button
                className={styles.toolbarBtn}
                onClick={e => {
                  setInsertMenuPos({ x: e.clientX, y: e.clientY })
                }}
              >
                <PlusIcon size={14} /> {t('output.insert')}
              </button>
              {insertMenuPos && (
                <ContextMenu
                  x={insertMenuPos.x}
                  y={insertMenuPos.y}
                  items={[
                    {
                      key: 'heading',
                      label: t('output.insertHeading'),
                      onClick: () => {
                        handleInsert('heading')
                      }
                    },
                    {
                      key: 'text',
                      label: t('output.insertText'),
                      onClick: () => {
                        handleInsert('text')
                      }
                    },
                    {
                      key: 'pageBreak',
                      label: t('output.insertPageBreak'),
                      onClick: () => {
                        handleInsert('pageBreak')
                      }
                    }
                  ]}
                  onClose={() => {
                    setInsertMenuPos(null)
                  }}
                />
              )}
              <div className={styles.toolbarGroup}>
                <label htmlFor="tableFormatSelect" className={styles.toolbarLabel}>
                  {t('output.tableFormatLabel')}
                </label>
                <select
                  id="tableFormatSelect"
                  value={globalTableFormat}
                  onChange={e => {
                    setGlobalTableFormat(e.target.value as TableFormat)
                  }}
                  className={styles.toolbarSelect}
                >
                  <option value="standard">{t('output.tableFormat.standard')}</option>
                  <option value="apa">{t('output.tableFormat.apa')}</option>
                  <option value="compact">{t('output.tableFormat.compact')}</option>
                  <option value="classic">{t('output.tableFormat.classic')}</option>
                </select>
              </div>
            </>
          )}
        </div>

        <div
          className={styles.content}
          ref={contentRef}
          onCopy={handleContentCopy}
          onContextMenu={handleContentContextMenu}
          onMouseDown={e => {
            // Starting a new (text) selection outside any table drops the old
            // table cell range, so it can't linger as a stale copy target.
            if (
              selection?.kind === 'cells' &&
              e.button === 0 &&
              !(e.target instanceof Element && e.target.closest('table'))
            ) {
              setSelection(null)
            }
          }}
        >
          {!hasContent ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>📊</div>
              <div className={styles.emptyText}>{t('output.empty')}</div>
              <div className={styles.emptyHint}>{t('output.emptyHint')}</div>
            </div>
          ) : (
            <>
              {runningJobs.map(job => (
                <RunningBlock key={job.jobId} job={job} />
              ))}
              {searchQuery && visibleItems.length === 0 && (
                <div className={styles.emptyState}>
                  <div className={styles.emptyHint}>{t('output.noResults')}</div>
                </div>
              )}
              {visibleItems.map(item => {
                if (item.kind !== 'block') {
                  return (
                    <InsertedItemRow
                      key={item.id}
                      item={item}
                      isSelected={isItemSelected(selection, item.id)}
                      onSelect={e => {
                        handleItemClick(item.id, e)
                      }}
                    />
                  )
                }
                const block = blocksById.get(item.id)
                if (!block) return null
                return (
                  <AnalysisBlock
                    key={block.id}
                    block={block}
                    isSelected={isItemSelected(selection, block.id)}
                    onSelect={e => {
                      handleItemClick(block.id, e)
                    }}
                    onRemove={() => {
                      removeBlock(block.id)
                    }}
                  />
                )
              })}
            </>
          )}
        </div>
      </div>
      {contentContextMenu && (
        <ContextMenu
          x={contentContextMenu.x}
          y={contentContextMenu.y}
          items={[
            {
              key: 'copySelection',
              label: t('output.edit.copySelection'),
              icon: <CopyIcon size={14} />,
              onClick: () => {
                const { html, text } = buildSelectionClipboard(contentContextMenu.range)
                setContentContextMenu(null)
                void writeDualFlavor(html, text)
              }
            }
          ]}
          onClose={() => {
            setContentContextMenu(null)
          }}
        />
      )}
      {clearAllConfirmOpen && (
        <ConfirmDialog
          titleKey="output.clearAllConfirmTitle"
          messageKey="output.clearAllConfirmMessage"
          danger
          onConfirm={() => {
            clearAll()
            setClearAllConfirmOpen(false)
          }}
          onCancel={() => {
            setClearAllConfirmOpen(false)
          }}
        />
      )}
      {itemToRemove && (
        <ConfirmDialog
          titleKey="output.removeConfirmTitle"
          messageKey="output.removeConfirmMessage"
          danger
          onConfirm={() => {
            const id = itemToRemove
            setItemToRemove(null)
            const block = blocksById.get(id)
            if (block) {
              removeBlock(id)
            } else {
              removeItem(id)
            }
          }}
          onCancel={() => {
            setItemToRemove(null)
          }}
        />
      )}
    </div>
  )
}
