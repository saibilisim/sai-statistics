// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { registerDataHandlers } from './data-handlers'
import { registerCellRowHandlers } from './cell-row-handlers'
import { registerVariableHandlers } from './variable-handlers'
import { registerSortHandlers } from './sort-handlers'
import { registerRestructureHandlers } from './restructure-handlers'
import { registerUndoRedoHandlers } from './undo-handlers'
import { registerTransformHandlers } from './transform-handlers'
import { registerCaseVarHandlers } from './case-var-handlers'

export {
  loadedDatasets,
  getDatasetOrThrow,
  hasUnsavedDatasets,
  getWeightVariable,
  getSplitVariable,
  getSplitVariableName,
  getSplitValueLabels,
  getColumnFilters,
  getMissingValuesMap,
  getVariableDecimalsMap,
  getDbConnection,
  loadDatasetIntoDb,
  setDatasetModified,
  setModifiedNotifier,
  datasetCustomStyles
} from './state'
export { exportDatasetToParquet, exportDatasetForConsole } from './parquet-export'

export function registerDbHandlers(): void {
  registerDataHandlers()
  registerCellRowHandlers()
  registerVariableHandlers()
  registerSortHandlers()
  registerRestructureHandlers()
  registerUndoRedoHandlers()
  registerTransformHandlers()
  registerCaseVarHandlers()
}
