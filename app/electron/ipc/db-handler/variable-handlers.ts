// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { IPC } from '../../../shared/ipc-contracts'
import {
  DatasetIdRequestSchema,
  InsertColumnRequestSchema,
  ColIdRequestSchema,
  ColIdsRequestSchema,
  VariableUpdateRequestSchema,
  VariableReorderRequestSchema
} from '../../../shared/ipc-schemas'
import { isValidVariableName, namesEqual } from '../../../shared/variable-name'
import { VariableSchema, type Variable } from '../../../shared/data-types'
import log from 'electron-log'
import { handleSerialized } from './serialized-handler'
import { captureForMutation } from '../undo-manager'
import {
  getDbConnection,
  getDatasetOrThrow,
  activeWeightVariable,
  activeSplitVariable,
  activeColumnFilters,
  setDatasetModified
} from './state'

// 6. data:insert-column (and variable:add). Returns the updated variable list.
async function addColumnHandler(req: {
  datasetId: string
  variable: { colId: string } & Omit<Variable, 'colId'>
  index?: number
}): Promise<Variable[]> {
  const conn = await getDbConnection()
  const dataset = getDatasetOrThrow(req.datasetId)

  // Generate a colId when absent — without mutating the request payload.
  const colId = req.variable.colId || `col_${String(dataset.nextColSeq)}`
  if (!req.variable.colId) dataset.nextColSeq++

  // Re-validate the assembled variable against the strict schema.
  const parsedVar = VariableSchema.safeParse({ ...req.variable, colId })
  if (!parsedVar.success) {
    throw new Error(`Invalid variable object: ${parsedVar.error.message}`)
  }
  const variable = parsedVar.data

  const tableName = `dataset_${req.datasetId}`
  if (dataset.variables.some(v => namesEqual(v.name, variable.name))) {
    throw new Error(`Variable already exists: ${variable.name}`)
  }

  let dbType = 'VARCHAR'
  if (variable.type === 'numeric') {
    dbType = 'DOUBLE'
  } else if (variable.type === 'date') {
    dbType = 'TIMESTAMP'
  }

  await captureForMutation(req.datasetId)
  await conn.runAndReadAll(`ALTER TABLE ${tableName} ADD COLUMN "${variable.colId}" ${dbType}`)

  if (typeof req.index === 'number') {
    dataset.variables.splice(req.index, 0, variable)
  } else {
    dataset.variables.push(variable)
  }

  setDatasetModified(dataset, true)
  log.info(`Column added: ${variable.colId} in dataset ${req.datasetId}`)
  return dataset.variables
}

// 7. data:delete-column, variable:delete and variable:delete-many. colId
// format enforced by schema. One undo snapshot for the whole batch.
async function deleteColumnsHandler(req: { datasetId: string; colIds: string[] }): Promise<void> {
  const conn = await getDbConnection()
  const dataset = getDatasetOrThrow(req.datasetId)

  const colIds = new Set(req.colIds)
  for (const colId of colIds) {
    if (!dataset.variables.some(v => v.colId === colId)) {
      throw new Error(`Column not found in dataset variables: ${colId}`)
    }
  }
  // A dataset with zero variables breaks every read (`SELECT __case_id, FROM …`)
  // — Data View already refuses this; enforce it here for every caller.
  if (dataset.variables.every(v => colIds.has(v.colId))) {
    throw new Error('Cannot delete the last variable')
  }

  await captureForMutation(req.datasetId)
  const tableName = `dataset_${req.datasetId}`
  for (const colId of colIds) {
    await conn.runAndReadAll(`ALTER TABLE ${tableName} DROP COLUMN "${colId}"`)
  }
  dataset.variables = dataset.variables.filter(v => !colIds.has(v.colId))
  setDatasetModified(dataset, true)
  // Deleting the active weight variable must clear the registry entry too —
  // otherwise get_weights() in R would fail loudly on the next analysis run
  // ("Weight column not found") instead of the feature quietly turning off.
  const weight = activeWeightVariable.get(req.datasetId)
  if (weight && colIds.has(weight)) {
    activeWeightVariable.set(req.datasetId, null)
  }
  // Same guard for Split File — deleting the active split variable must
  // clear the registry entry too.
  const split = activeSplitVariable.get(req.datasetId)
  if (split && colIds.has(split)) {
    activeSplitVariable.set(req.datasetId, null)
  }
  // …and for column filters: the renderer drops a deleted column's filter,
  // so an entry left here would come back to life on Undo (the column
  // reappears) and silently filter every analysis while the grid shows none.
  const filters = activeColumnFilters.get(req.datasetId)
  if (filters) {
    activeColumnFilters.set(
      req.datasetId,
      Object.fromEntries(Object.entries(filters).filter(([colId]) => !colIds.has(colId)))
    )
  }
  log.info(`Columns deleted: ${[...colIds].join(', ')} in dataset ${req.datasetId}`)
}

export function registerVariableHandlers(): void {
  handleSerialized(IPC.DATA_INSERT_COLUMN, InsertColumnRequestSchema, req => addColumnHandler(req))
  handleSerialized(IPC.VARIABLE_ADD, InsertColumnRequestSchema, req => addColumnHandler(req))

  handleSerialized(IPC.DATA_DELETE_COLUMN, ColIdRequestSchema, req =>
    deleteColumnsHandler({ datasetId: req.datasetId, colIds: [req.colId] })
  )
  handleSerialized(IPC.VARIABLE_DELETE, ColIdRequestSchema, req =>
    deleteColumnsHandler({ datasetId: req.datasetId, colIds: [req.colId] })
  )
  handleSerialized(IPC.VARIABLE_DELETE_MANY, ColIdsRequestSchema, req => deleteColumnsHandler(req))

  // 8. variable:get-all
  handleSerialized(IPC.VARIABLE_GET_ALL, DatasetIdRequestSchema, (req): Variable[] => {
    const dataset = getDatasetOrThrow(req.datasetId)
    return dataset.variables
  })

  // 9. variable:update
  handleSerialized(IPC.VARIABLE_UPDATE, VariableUpdateRequestSchema, async (req): Promise<void> => {
    const conn = await getDbConnection()
    const dataset = getDatasetOrThrow(req.datasetId)

    const varIndex = dataset.variables.findIndex(v => v.colId === req.colId)
    if (varIndex === -1) {
      throw new Error(`Variable not found: ${req.colId}`)
    }

    const variable = dataset.variables[varIndex]
    if (!variable) {
      throw new Error(`Variable not found at index: ${String(varIndex)}`)
    }
    await captureForMutation(req.datasetId)
    const tableName = `dataset_${req.datasetId}`

    // 1. Rename column in metadata if requested
    if (req.updates.name && req.updates.name !== variable.name) {
      if (!isValidVariableName(req.updates.name)) {
        throw new Error(`Invalid variable name structure: ${req.updates.name}`)
      }
      // Case-insensitive collision check, but exclude the variable itself so a
      // pure case change (e.g. "yas" → "Yas") is allowed.
      if (
        dataset.variables.some(
          v => v.colId !== variable.colId && namesEqual(v.name, req.updates.name as string)
        )
      ) {
        throw new Error(`Variable with name ${req.updates.name} already exists`)
      }
    }

    // 2. Cast column type in DB if requested
    if (req.updates.type && req.updates.type !== variable.type) {
      let dbType = 'VARCHAR'
      if (req.updates.type === 'numeric') {
        dbType = 'DOUBLE'
      } else if (req.updates.type === 'date') {
        dbType = 'TIMESTAMP'
      }
      await conn.runAndReadAll(
        `ALTER TABLE ${tableName} ALTER COLUMN "${variable.colId}" TYPE ${dbType}`
      )
      variable.type = req.updates.type
    }

    // 3. Update all metadata fields (name included) only now that the ALTER, the
    // one step that can fail, has succeeded — a failed cast must not leave a
    // renamed-in-memory variable behind.
    Object.assign(variable, req.updates)
    setDatasetModified(dataset, true)
    log.info(`Variable metadata updated for column: ${req.colId} in dataset ${req.datasetId}`)
  })

  // 9b. variable:reorder
  handleSerialized(
    IPC.VARIABLE_REORDER,
    VariableReorderRequestSchema,
    async (req): Promise<void> => {
      const dataset = getDatasetOrThrow(req.datasetId)

      await captureForMutation(req.datasetId)
      const reordered: Variable[] = []
      req.colIds.forEach(colId => {
        const found = dataset.variables.find(v => v.colId === colId)
        if (found) {
          reordered.push(found)
        }
      })

      // Keep any missing ones just in case
      dataset.variables.forEach(v => {
        if (!reordered.some(r => r.colId === v.colId)) {
          reordered.push(v)
        }
      })

      dataset.variables = reordered
      setDatasetModified(dataset, true)
      log.info(`Variables reordered for dataset ${req.datasetId}`)
    }
  )
}
