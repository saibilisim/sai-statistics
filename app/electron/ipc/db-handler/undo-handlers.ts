// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { IPC } from '../../../shared/ipc-contracts'
import type { DataUndoResult } from '../../../shared/ipc-contracts'
import { DatasetIdRequestSchema } from '../../../shared/ipc-schemas'
import { handleSerialized } from './serialized-handler'
import { applyUndo, applyRedo } from '../undo-manager'

export function registerUndoRedoHandlers(): void {
  // 11. data:undo / data:redo — structural-only (cell value undo is the grid's own).
  handleSerialized(IPC.DATA_UNDO, DatasetIdRequestSchema, (req): Promise<DataUndoResult> => {
    return applyUndo(req.datasetId)
  })
  handleSerialized(IPC.DATA_REDO, DatasetIdRequestSchema, (req): Promise<DataUndoResult> => {
    return applyRedo(req.datasetId)
  })
}
