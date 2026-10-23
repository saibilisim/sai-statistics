// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importDataset } from '../../src/lib/file-actions'

const mocks = vi.hoisted(() => ({
  state: { isModified: false, datasetId: 'old', customStyles: null, setDataset: vi.fn() },
  addRecentFile: vi.fn()
}))
vi.mock('../../src/store/dataset-store', () => ({
  useDatasetStore: {
    getState: () => mocks.state,
    setState: (patch: object) => Object.assign(mocks.state, patch)
  }
}))
vi.mock('../../src/store/settings-store', () => ({
  useSettingsStore: { getState: () => ({ addRecentFile: mocks.addRecentFile }) }
}))

describe('dataset import replacement guard', () => {
  const result = {
    dataset: { id: 'new', name: 'data.csv', filePath: null, rowCount: 2 },
    variables: [],
    styles: undefined
  }
  const importFile = vi.fn()
  const confirmUnsaved = vi.fn()
  const saveData = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.isModified = false
    importFile.mockResolvedValue(result)
    saveData.mockResolvedValue(null)
    vi.stubGlobal('window', {
      api: { file: { import: importFile, saveData }, app: { confirmUnsaved } }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('imports a dropped path and activates the returned dataset', async () => {
    await importDataset({ filePath: 'C:\\Users\\Test\\Desktop\\data.csv' })
    expect(importFile).toHaveBeenCalledWith({ filePath: 'C:\\Users\\Test\\Desktop\\data.csv' })
    expect(mocks.state.setDataset).toHaveBeenCalledWith('new', 'data.csv', null, [], 2, undefined)
    expect(confirmUnsaved).not.toHaveBeenCalled()
  })

  it('keeps current data when the user cancels replacement', async () => {
    mocks.state.isModified = true
    confirmUnsaved.mockResolvedValue(2)
    await importDataset({ filePath: 'data.csv' })
    expect(importFile).not.toHaveBeenCalled()
    expect(mocks.state.setDataset).not.toHaveBeenCalled()
  })

  it('keeps current data when saving is cancelled', async () => {
    mocks.state.isModified = true
    confirmUnsaved.mockResolvedValue(0)
    await importDataset({ filePath: 'data.csv' })
    expect(saveData).toHaveBeenCalled()
    expect(importFile).not.toHaveBeenCalled()
  })

  it('imports after the user chooses to discard changes', async () => {
    mocks.state.isModified = true
    confirmUnsaved.mockResolvedValue(1)
    await importDataset({ filePath: 'data.csv' })
    expect(mocks.state.setDataset).toHaveBeenCalled()
  })

  it('preserves the current dataset on an import error', async () => {
    importFile.mockRejectedValueOnce(new Error('Unreadable file'))
    await expect(importDataset({ filePath: 'data.csv' })).rejects.toThrow('Unreadable file')
    expect(mocks.state.setDataset).not.toHaveBeenCalled()
  })
})
