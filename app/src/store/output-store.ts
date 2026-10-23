// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import { temporal } from 'zundo'
import type { AnalysisResult } from '@shared/analysis-types'
import type { BlockEdits, TableEdits, OutputDocItem } from '@shared/output-document'

export type TableFormat = 'standard' | 'apa' | 'compact' | 'classic'

/** AI üretimi blok yorumu (ai-entegrasyon-fizibilitesi.md §5.3/§5.4 E). */
export interface OutputAiNote {
  text: string
  createdAt: string
}

export interface OutputBlock {
  id: string
  analysisId: string
  titleKey: string
  timestamp: string
  datasetName: string
  result: AnalysisResult
  isCollapsed: boolean
  /** "✦ AI → Yorumla" ile bloğa işlenen AI yorumu. HTML/PDF export'a
   *  varsayılan olarak DAHİL EDİLMEZ — output-export.ts yalnız açık
   *  opt-in ile (includeAiNotes) ve 'AI-generated' rozetiyle basar. */
  aiNote?: OutputAiNote
  /** Auto output header: "Field label: var1, var2 | ..." — generated
   *  generically by AnalysisDialogShell from fieldDefs+assignments, always
   *  shown under the block title (see pending-run-meta.ts). */
  summary?: string
  /** Auto output header's SPSS syntax line — shown collapsed by default. */
  syntax?: string
}

/** What's currently selected in the Output tab — either a rectangular cell
 *  range inside one table, or a set of whole blocks (navigator/header
 *  ctrl-click). Never both at once; selecting one kind clears the other. */
export type OutputSelection =
  | {
      kind: 'cells'
      blockId: string
      tableIndex: number
      r1: number
      c1: number
      r2: number
      c2: number
    }
  | { kind: 'blocks'; ids: string[] }
  | null

const EMPTY_TABLE_EDITS: TableEdits = {
  hiddenRows: [],
  hiddenCols: [],
  transposed: false,
  footnotes: []
}

interface OutputState {
  blocks: OutputBlock[]
  /** Render/save/export order, oldest first — results flow top to bottom
   *  like a report, the newest at the end (2026-10-18). Decoupled from
   *  `blocks` (which stays newest-first: blocks[0] is "the latest result"
   *  for its readers) so drag-reordering and inserted headings/text/page-
   *  breaks don't require reshaping `blocks` itself. */
  items: OutputDocItem[]
  /** Per-block edit overlay — never mutates `blocks[].result` (CLAUDE.md §8:
   *  R output stays the validated source of truth). */
  edits: Record<string, BlockEdits>
  selection: OutputSelection
  globalTableFormat: TableFormat
  /** True when Output has changes not yet saved into the .sdf (output.json)
   *  — results, edits, doc order or AI notes. Cleared only by a dataset save. */
  dirty: boolean
}

interface OutputActions {
  addBlock: (block: Omit<OutputBlock, 'isCollapsed'>) => void
  removeBlock: (id: string) => void
  clearAll: () => void
  toggleCollapse: (id: string) => void
  collapseAll: () => void
  expandAll: () => void
  /** AI yorumunu bloğa işler (§5.4 E). .sdf'e kaydedildiği için dirty yapar
   *  (HTML/PDF export'a ise varsayılan girmez — includeAiNotes opt-in). */
  setAiNote: (id: string, note: OutputAiNote) => void
  /** Selects a single block, replacing any existing selection. */
  selectBlock: (id: string | null) => void
  setSelection: (selection: OutputSelection) => void
  clearSelection: () => void
  setGlobalTableFormat: (format: TableFormat) => void
  /** Called after the .sdf (with embedded output.json) was saved — clears
   *  the dirty flag. HTML/PDF/Word exports do NOT clear it: they don't
   *  persist anything into the project file. */
  markSaved: () => void
  setBlockTitle: (blockId: string, title: string | undefined) => void
  toggleBlockHidden: (blockId: string) => void
  setTableEdits: (blockId: string, tableIndex: number, patch: Partial<TableEdits>) => void
  revertTableEdits: (blockId: string, tableIndex: number) => void
  revertBlockEdits: (blockId: string) => void
  /** Moves the item `dragId` to just before/after `overId` in doc order
   *  (navigator drag-reorder). No-op if either id isn't in `items`. */
  reorderItems: (dragId: string, overId: string) => void
  /** Inserts a heading/text/page-break item right before `beforeId`
   *  (undefined = append at the end). */
  insertItem: (item: OutputDocItem, beforeId?: string) => void
  /** Removes a heading/text/page-break item. Blocks are removed via
   *  removeBlock (which also drops the matching `items` entry). */
  removeItem: (id: string) => void
  /** Edits an inserted heading/text item's content in place. */
  updateItemText: (id: string, text: string) => void
}

// Push the dirty flag to Main so the window-close guard (main.ts) can warn
// before the user loses unsaved Output changes. Only sends on a change —
// edit actions mark dirty on every keystroke-level update.
let pushedDirty: boolean | null = null
function pushDirty(dirty: boolean): void {
  if (pushedDirty === dirty) return
  pushedDirty = dirty
  void window.api.app.setOutputDirty(dirty)
}

function getTableEdits(
  edits: Record<string, BlockEdits>,
  blockId: string,
  tableIndex: number
): TableEdits {
  return edits[blockId]?.tables[String(tableIndex)] ?? EMPTY_TABLE_EDITS
}

export const useOutputStore = create<OutputState & OutputActions>()(
  temporal(
    (set, get) => {
      /** `set` for persisted edits (overlay/order): marks Output dirty when
       *  the updater actually changed something (empty object = no-op). */
      const setDirty = (fn: (s: OutputState & OutputActions) => Partial<OutputState>): void => {
        const patch = fn(get())
        if (Object.keys(patch).length === 0) return
        set({ ...patch, dirty: true })
        pushDirty(true)
      }

      return {
        blocks: [],
        items: [],
        edits: {},
        selection: null,
        globalTableFormat: 'standard',
        dirty: false,

        addBlock: block => {
          set(s => ({
            blocks: [{ ...block, isCollapsed: false }, ...s.blocks],
            // The document reads top to bottom: a new result goes at the end.
            items: [...s.items, { kind: 'block', id: block.id }],
            selection: { kind: 'blocks', ids: [block.id] },
            dirty: true
          }))
          pushDirty(true)
        },

        removeBlock: id => {
          set(s => {
            const blocks = s.blocks.filter(b => b.id !== id)
            const items = s.items.filter(it => !(it.kind === 'block' && it.id === id))
            const edits = { ...s.edits }
            Reflect.deleteProperty(edits, id)
            return { blocks, items, edits, dirty: true }
          })
          pushDirty(true)
        },

        clearAll: () => {
          const s = get()
          // Clearing an already-empty Output isn't a change to save.
          const dirty = s.dirty || s.blocks.length > 0 || s.items.length > 0
          set({ blocks: [], items: [], edits: {}, selection: null, dirty })
          pushDirty(dirty)
        },

        markSaved: () => {
          set({ dirty: false })
          pushDirty(false)
        },

        toggleCollapse: id => {
          set(s => ({
            blocks: s.blocks.map(b => (b.id === id ? { ...b, isCollapsed: !b.isCollapsed } : b))
          }))
        },

        collapseAll: () => {
          set(s => ({ blocks: s.blocks.map(b => ({ ...b, isCollapsed: true })) }))
        },

        expandAll: () => {
          set(s => ({ blocks: s.blocks.map(b => ({ ...b, isCollapsed: false })) }))
        },

        setAiNote: (id, note) => {
          set(s => ({
            blocks: s.blocks.map(b => (b.id === id ? { ...b, aiNote: note } : b)),
            dirty: true
          }))
          pushDirty(true)
        },

        selectBlock: id => {
          set({ selection: id === null ? null : { kind: 'blocks', ids: [id] } })
        },

        setSelection: selection => {
          set({ selection })
        },

        clearSelection: () => {
          set({ selection: null })
        },

        setGlobalTableFormat: globalTableFormat => {
          set({ globalTableFormat })
        },

        setBlockTitle: (blockId, title) => {
          setDirty(s => {
            const current = s.edits[blockId] ?? { hidden: false, tables: {} }
            return {
              edits: {
                ...s.edits,
                [blockId]: { ...current, titleOverride: title === undefined ? undefined : title }
              }
            }
          })
        },

        toggleBlockHidden: blockId => {
          setDirty(s => {
            const current = s.edits[blockId] ?? { hidden: false, tables: {} }
            return {
              edits: { ...s.edits, [blockId]: { ...current, hidden: !current.hidden } }
            }
          })
        },

        setTableEdits: (blockId, tableIndex, patch) => {
          setDirty(s => {
            const currentBlock = s.edits[blockId] ?? { hidden: false, tables: {} }
            const currentTable = getTableEdits(s.edits, blockId, tableIndex)
            return {
              edits: {
                ...s.edits,
                [blockId]: {
                  ...currentBlock,
                  tables: {
                    ...currentBlock.tables,
                    [String(tableIndex)]: { ...currentTable, ...patch }
                  }
                }
              }
            }
          })
        },

        revertTableEdits: (blockId, tableIndex) => {
          setDirty(s => {
            const currentBlock = s.edits[blockId]
            if (!currentBlock) return {}
            const tables = { ...currentBlock.tables }
            Reflect.deleteProperty(tables, String(tableIndex))
            return { edits: { ...s.edits, [blockId]: { ...currentBlock, tables } } }
          })
        },

        revertBlockEdits: blockId => {
          setDirty(s => {
            const edits = { ...s.edits }
            Reflect.deleteProperty(edits, blockId)
            return { edits }
          })
        },

        reorderItems: (dragId, overId) => {
          setDirty(s => {
            if (dragId === overId) return {}
            const next = [...s.items]
            const from = next.findIndex(it => it.id === dragId)
            const to = next.findIndex(it => it.id === overId)
            if (from === -1 || to === -1) return {}
            const [moved] = next.splice(from, 1)
            if (!moved) return {}
            next.splice(to, 0, moved)
            return { items: next }
          })
        },

        insertItem: (item, beforeId) => {
          setDirty(s => {
            if (beforeId === undefined) return { items: [...s.items, item] }
            const idx = s.items.findIndex(it => it.id === beforeId)
            if (idx === -1) return { items: [...s.items, item] }
            const next = [...s.items]
            next.splice(idx, 0, item)
            return { items: next }
          })
        },

        removeItem: id => {
          setDirty(s => ({ items: s.items.filter(it => it.id !== id) }))
        },

        updateItemText: (id, text) => {
          setDirty(s => ({
            items: s.items.map(it =>
              it.id === id && (it.kind === 'heading' || it.kind === 'text') ? { ...it, text } : it
            )
          }))
        }
      }
    },
    {
      limit: 50,
      // Only edit overlays + doc ordering are undoable — `blocks` (the R
      // results themselves) and ephemeral UI state (`selection`, `dirty`)
      // never enter undo history.
      partialize: s => ({ items: s.items, edits: s.edits })
    }
  )
)
