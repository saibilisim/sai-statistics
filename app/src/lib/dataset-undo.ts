// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * dataset-undo.ts — the single undo/redo chain for DataView, shared by the
 * Ribbon's Undo/Redo buttons and the native Edit menu's Ctrl+Z/Ctrl+Y
 * (menu-builder.ts sends `menu:edit:undo`/`menu:edit:redo` instead of using
 * Electron's `role: 'undo'/'redo'`, which only drives Chromium's native
 * document-undo and never reaches here — see the Edit menu comment there).
 *
 * Three layers, tried in order:
 *  1. View state (sort/filter) — renderer-only, so a DB-snapshot restore
 *     can't touch it (dataset-store's own undoView/redoView).
 *  2. Structural changes (row/col insert-delete, sort, reorder, variable
 *     metadata) — DuckDB-snapshot restore via `data:undo`/`data:redo`.
 *  3. Cell value edits — use-cell-selection.ts's own batched undo/redo
 *     stack (grid-bridge-store's undoValueEdit/redoValueEdit — NOT AG
 *     Grid's `undoRedoCellEditing`, which never sees the bulk accelerators
 *     this app layers on top of the grid's native edit cycle: Delete-clear,
 *     Ctrl+D/R fill, Ctrl+Enter broadcast, paste all bypass it entirely).
 */
import { useDatasetStore } from '../store/dataset-store'
import { useGridBridgeStore } from '../store/grid-bridge-store'

export function performUndoRedo(dir: 'undo' | 'redo'): void {
  const id = useDatasetStore.getState().datasetId
  if (!id) return
  const store = useDatasetStore.getState()
  if (dir === 'undo' ? store.canUndoView() : store.canRedoView()) {
    if (dir === 'undo') store.undoView()
    else store.redoView()
    return
  }
  void (async () => {
    const res =
      dir === 'undo'
        ? await window.api.data.undo({ datasetId: id })
        : await window.api.data.redo({ datasetId: id })
    if (res.applied) {
      const s = useDatasetStore.getState()
      s.setVariables(res.variables)
      s.setRowCount(res.rowCount)
      s.bumpDataVersion()
    } else {
      const bridge = useGridBridgeStore.getState()
      if (dir === 'undo') bridge.undoValueEdit?.()
      else bridge.redoValueEdit?.()
    }
  })().catch((err: unknown) => {
    console.error(`Structural ${dir} failed:`, err)
  })
}
