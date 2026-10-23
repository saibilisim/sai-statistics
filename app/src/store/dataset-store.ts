// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import type { Variable, CustomStyles } from '@shared/data-types'

/** Captures the CURRENT view state, to be pushed onto the undo stack right
 *  before a view mutation replaces it. */
function snapshotOf(s: {
  columnSort: { colId: string; direction: 'asc' | 'desc' } | null
  columnFilters: Record<string, { operator: string; value: string }>
  dataVersion: number
}): ViewSnapshot {
  return {
    columnSort: s.columnSort,
    columnFilters: s.columnFilters,
    dataVersion: s.dataVersion
  }
}

/** A restorable snapshot of the renderer-only view state (sort + filters),
 *  stamped with the data version it was taken at. */
interface ViewSnapshot {
  columnSort: { colId: string; direction: 'asc' | 'desc' } | null
  columnFilters: Record<string, { operator: string; value: string }>
  dataVersion: number
}

/** Fire-and-forget mirror of the active column filters into Main
 *  (data:set-column-filters) — same choke-point pattern as setWeight/
 *  setSplit below, so AI-triggered analyses (run_analysis/run_syntax) see
 *  the same filters GUI dialogs already pass explicitly. Best-effort: a
 *  failed sync just means the AI path falls back to unfiltered, it doesn't
 *  affect the Data View grid (which reads columnFilters locally). */
function syncColumnFiltersToMain(
  datasetId: string | null,
  columnFilters: Record<string, { operator: string; value: string }>
): void {
  if (!datasetId) return
  window.api.data.setColumnFilters({ datasetId, columnFilters }).catch((err: unknown) => {
    console.error('setColumnFilters sync failed:', err)
  })
}

interface DatasetState {
  datasetId: string | null
  datasetName: string
  filePath: string | null
  variables: Variable[]
  rowCount: number
  isModified: boolean
  // Bumped on structural row changes (insert/delete) to force the DataView grid
  // to re-fetch from DuckDB even when the column structure is unchanged.
  dataVersion: number
  /** Bumped on EVERY confirmed change to the active dataset (Main's
   *  data:modified-changed push), cell edits included — unlike dataVersion,
   *  which only drives grid reloads. Lets derived views (Normality tab) tell
   *  their cached result is stale. */
  contentVersion: number
  /** View-state undo history (C1 follow-up): sort/filter are renderer-only
   *  view state — DuckDB never sees them, so `data:undo` (a DB snapshot
   *  restore) can't undo them. These stacks give them their own history.
   *  Each entry is stamped with the `dataVersion` it was made at, so the
   *  Ribbon can tell whether the newest change was a view change (same
   *  version) or a data change (older version) and undo the right one. */
  viewUndoStack: ViewSnapshot[]
  viewRedoStack: ViewSnapshot[]
  // DuckDB data is not stored in state — fetched on demand via IPC
  filterActive: boolean
  columnFilters: Record<string, { operator: string; value: string }>
  columnSort: { colId: string; direction: 'asc' | 'desc' } | null
  weightVariable: string | null
  splitVariable: string | null

  customStyles: CustomStyles | null
}

interface DatasetActions {
  setDataset: (
    id: string,
    name: string,
    filePath: string | null,
    variables: Variable[],
    rowCount: number,
    customStyles?: CustomStyles | null
  ) => void
  setVariables: (variables: Variable[]) => void
  updateVariable: (index: number, patch: Partial<Variable>) => void
  setRowCount: (count: number) => void
  bumpDataVersion: () => void
  bumpContentVersion: () => void
  setModified: (modified: boolean) => void
  /** After a main-process mutation of the active dataset (Transform/Data
   *  menu ops): adopt the returned variables (if any), reload the grid rows
   *  — an in-place UPDATE (Recode into Same, Replace Missing) changes no
   *  structure, so without the version bump the grid keeps stale values —
   *  and mark the dataset unsaved. */
  commitMutation: (variables?: Variable[]) => void
  setColumnFilter: (colId: string, filter: { operator: string; value: string } | null) => void
  /** True when the most recent change was a view change (sort/filter) that
   *  should be undone before falling through to the DB/cell undo chain. */
  canUndoView: () => boolean
  canRedoView: () => boolean
  undoView: () => void
  redoView: () => void
  setColumnSort: (colId: string, direction: 'asc' | 'desc' | null) => void
  clearAllFilters: () => void
  setWeight: (variable: string | null) => void
  setSplit: (variable: string | null) => void
  clearDataset: () => void

  setCustomStyles: (styles: CustomStyles | null) => void
}

const empty: DatasetState = {
  datasetId: null,
  datasetName: '',
  filePath: null,
  variables: [],
  rowCount: 0,
  isModified: false,
  dataVersion: 0,
  contentVersion: 0,
  viewUndoStack: [],
  viewRedoStack: [],
  filterActive: false,
  columnFilters: {},
  columnSort: null,
  weightVariable: null,
  splitVariable: null,

  customStyles: null
}

export const useDatasetStore = create<DatasetState & DatasetActions>()((set, get) => ({
  ...empty,

  setDataset: (id, name, filePath, variables, rowCount, customStyles = null) => {
    // Every replacement (New/Open/Import/Aggregate/Merge/…) lands here: free
    // what Main still holds for the outgoing dataset, or it lingers in DuckDB
    // with its undo snapshots and keeps counting as unsaved for the close
    // guard and the recovery checkpoint long after the user discarded it.
    const previousId = get().datasetId
    if (previousId && previousId !== id) {
      window.api.data.releaseDataset({ datasetId: previousId }).catch((err: unknown) => {
        console.error('releaseDataset failed:', err)
      })
    }
    set({
      datasetId: id,
      datasetName: name,
      filePath,
      variables,
      rowCount,
      customStyles,
      isModified: false,
      filterActive: false,
      columnFilters: {},
      columnSort: null,
      // The view history belongs to the previous dataset — undoing into it
      // would apply that dataset's sort/filter here.
      viewUndoStack: [],
      viewRedoStack: [],
      weightVariable: null,
      splitVariable: null
    })
  },

  setVariables: variables => {
    set(s => {
      // A deleted column can be the active weight/split variable or have a
      // column filter attached; without this, the store (and the main-process
      // weight registry via setWeight) would keep pointing at a colId that no
      // longer exists — analysis would fail loudly ("Weight column not
      // found") instead of the feature simply turning back off.
      const ids = new Set(variables.map(v => v.colId))
      const columnFilters = Object.fromEntries(
        Object.entries(s.columnFilters).filter(([colId]) => ids.has(colId))
      )
      const filterActive = Object.keys(columnFilters).length > 0
      const weightVariable = s.weightVariable && ids.has(s.weightVariable) ? s.weightVariable : null
      const splitVariable = s.splitVariable && ids.has(s.splitVariable) ? s.splitVariable : null
      if (s.datasetId) {
        const datasetId = s.datasetId
        const resetFailed = (err: unknown): void => {
          console.error('Main registry reset failed:', err)
        }
        if (s.weightVariable && !weightVariable) {
          window.api.data.setWeight({ datasetId, colId: null }).catch(resetFailed)
        }
        if (s.splitVariable && !splitVariable) {
          window.api.data.setSplit({ datasetId, colId: null }).catch(resetFailed)
        }
        // Main's copy must lose the dropped filter too — otherwise analyses
        // keep filtering on it (the column comes back on Undo) while the grid
        // shows no filter at all.
        if (Object.keys(columnFilters).length !== Object.keys(s.columnFilters).length) {
          syncColumnFiltersToMain(datasetId, columnFilters)
        }
      }
      return { variables, columnFilters, filterActive, weightVariable, splitVariable }
    })
  },

  updateVariable: (index, patch) => {
    set(s => {
      const variables = [...s.variables]
      const existing = variables[index]
      if (existing) {
        variables[index] = { ...existing, ...patch }
      }
      return { variables, isModified: true }
    })
  },

  setRowCount: rowCount => {
    set({ rowCount })
  },

  bumpDataVersion: () => {
    set(s => ({ dataVersion: s.dataVersion + 1 }))
  },

  bumpContentVersion: () => {
    set(s => ({ contentVersion: s.contentVersion + 1 }))
  },

  setModified: isModified => {
    set({ isModified })
  },

  commitMutation: variables => {
    if (variables) get().setVariables(variables)
    set(s => ({ dataVersion: s.dataVersion + 1, isModified: true }))
  },

  canUndoView: () => {
    const s = get()
    const top = s.viewUndoStack[s.viewUndoStack.length - 1]
    // Only "newer than the last data change" view edits win over DB undo.
    return !!top && top.dataVersion === s.dataVersion
  },

  canRedoView: () => {
    const s = get()
    const top = s.viewRedoStack[s.viewRedoStack.length - 1]
    return !!top && top.dataVersion === s.dataVersion
  },

  undoView: () => {
    set(s => {
      const prev = s.viewUndoStack[s.viewUndoStack.length - 1]
      if (!prev) return {}
      const current: ViewSnapshot = {
        columnSort: s.columnSort,
        columnFilters: s.columnFilters,
        dataVersion: s.dataVersion
      }
      syncColumnFiltersToMain(s.datasetId, prev.columnFilters)
      return {
        columnSort: prev.columnSort,
        columnFilters: prev.columnFilters,
        filterActive: Object.keys(prev.columnFilters).length > 0,
        viewUndoStack: s.viewUndoStack.slice(0, -1),
        viewRedoStack: [...s.viewRedoStack, current]
      }
    })
  },

  redoView: () => {
    set(s => {
      const next = s.viewRedoStack[s.viewRedoStack.length - 1]
      if (!next) return {}
      const current: ViewSnapshot = {
        columnSort: s.columnSort,
        columnFilters: s.columnFilters,
        dataVersion: s.dataVersion
      }
      syncColumnFiltersToMain(s.datasetId, next.columnFilters)
      return {
        columnSort: next.columnSort,
        columnFilters: next.columnFilters,
        filterActive: Object.keys(next.columnFilters).length > 0,
        viewRedoStack: s.viewRedoStack.slice(0, -1),
        viewUndoStack: [...s.viewUndoStack, current]
      }
    })
  },

  setColumnFilter: (colId, filter) => {
    set(s => {
      const columnFilters: Record<string, { operator: string; value: string }> = filter
        ? { ...s.columnFilters, [colId]: filter }
        : Object.fromEntries(Object.entries(s.columnFilters).filter(([k]) => k !== colId))
      const filterActive = Object.keys(columnFilters).length > 0
      syncColumnFiltersToMain(s.datasetId, columnFilters)
      return {
        columnFilters,
        filterActive,
        viewUndoStack: [...s.viewUndoStack, snapshotOf(s)],
        viewRedoStack: []
      }
    })
  },

  setColumnSort: (colId, direction) => {
    set(s => ({
      columnSort: direction === null ? null : { colId, direction },
      viewUndoStack: [...s.viewUndoStack, snapshotOf(s)],
      viewRedoStack: []
    }))
  },

  clearAllFilters: () => {
    set(s => {
      syncColumnFiltersToMain(s.datasetId, {})
      return {
        columnFilters: {},
        filterActive: false,
        viewUndoStack: [...s.viewUndoStack, snapshotOf(s)],
        viewRedoStack: []
      }
    })
  },

  setWeight: weightVariable => {
    const previous = get().weightVariable
    set(s => {
      if (s.datasetId) {
        const dsId = s.datasetId
        window.api.data
          .setWeight({ datasetId: dsId, colId: weightVariable })
          .catch((err: unknown) => {
            console.error('setWeight failed, reverting:', err)
            // Only revert if nothing else changed the field in the meantime.
            set(cur => (cur.weightVariable === weightVariable ? { weightVariable: previous } : {}))
          })
      }
      return { weightVariable }
    })
  },

  setSplit: splitVariable => {
    const previous = get().splitVariable
    set(s => {
      if (s.datasetId) {
        const dsId = s.datasetId
        window.api.data
          .setSplit({ datasetId: dsId, colId: splitVariable })
          .catch((err: unknown) => {
            console.error('setSplit failed, reverting:', err)
            set(cur => (cur.splitVariable === splitVariable ? { splitVariable: previous } : {}))
          })
      }
      return { splitVariable }
    })
  },

  clearDataset: () => {
    set({ ...empty })
  },

  setCustomStyles: customStyles => {
    set({ customStyles })
    // Mirror to Main: a format-only edit changes no DuckDB data, so without
    // this the close guard wouldn't see it and crash recovery would drop it.
    const datasetId = get().datasetId
    if (datasetId) {
      window.api.data.setCustomStyles({ datasetId, customStyles }).catch((err: unknown) => {
        console.error('setCustomStyles sync failed:', err)
      })
    }
  }
}))
