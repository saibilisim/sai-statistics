// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { registerDatasetHandlers } from './dataset-io'
import { registerOutputHandlers } from './output-io'
import { registerImportExportHandlers } from './import-export'

export { writeDatasetSdf } from './dataset-io'

export function registerFileHandlers(): void {
  registerDatasetHandlers()
  registerOutputHandlers()
  registerImportExportHandlers()
}
