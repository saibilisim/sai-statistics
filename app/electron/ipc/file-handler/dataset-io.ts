// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { ipcMain, dialog, app } from 'electron'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import AdmZip from 'adm-zip'
import { z } from 'zod'
import { IPC } from '../../../shared/ipc-contracts'
import type { FileOpenResult } from '../../../shared/ipc-contracts'
import {
  VariableSchema,
  clampVariableAttr,
  CustomStylesSchema,
  type Variable,
  type Dataset,
  type CustomStyles
} from '../../../shared/data-types'
import { AiChatEntrySchema, type PersistedAiChatEntry } from '../../../shared/ai-types'
import { OutputDocumentSchema, type OutputDocument } from '../../../shared/output-document'
import { FileOpenRequestSchema, FileSaveDataRequestSchema } from '../../../shared/ipc-schemas'
import {
  getDbConnection,
  loadDatasetIntoDb,
  getDatasetOrThrow,
  setDatasetModified,
  datasetCustomStyles
} from '../db-handler'
import log from 'electron-log'
import { validateSender, handleValidated } from '../security'
import { approvePath, assertApprovedPath } from '../approved-paths'
import { isRecoveryPath } from '../../recovery-path'
import {
  dialogText,
  warnIfLargeDataset,
  buildVariablesFromTempTable,
  extractZipSafely
} from './shared'

/**
 * Writes a dataset to a .sdf file at `targetPath` without mutating the
 * in-memory `Dataset` (no filePath/isModified changes) — the caller decides
 * whether this counts as "the" save. Used both by the real save handlers
 * (file:save-data / file:save-data-as) and by the P0.6 periodic recovery
 * autosave in main.ts, which must never make an unmodified dataset look saved.
 *
 * `outputDocument` embeds the Output tab (OutputDocumentSchema) as
 * `output.json`, so reopening the .sdf restores the results
 * too. Omitted/null → no output.json entry (recovery autosave, empty Output).
 */
export async function writeDatasetSdf(
  dataset: Dataset,
  targetPath: string,
  customStyles?: CustomStyles | null,
  chatHistory?: PersistedAiChatEntry[] | null,
  outputDocument?: OutputDocument | null
): Promise<void> {
  const conn = await getDbConnection()
  // Private per-call directory: unpredictable (no symlink pre-planting in a
  // shared /tmp) and never shared with a concurrent save or recovery checkpoint.
  const tempDir = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'sai-sdf-'))
  const tempParquetPath = path.join(tempDir, 'data.parquet')
  const tempVariablesPath = path.join(tempDir, 'variables.json')
  const tempStylesPath = path.join(tempDir, 'styles.json')
  const tempMetadataPath = path.join(tempDir, 'metadata.json')
  const tempChatPath = path.join(tempDir, 'ai-chat.json')
  const tempOutputPath = path.join(tempDir, 'output.json')
  // The zip is built next to the target and renamed over it, so a crash or a
  // full disk never leaves a truncated .sdf in place of the previous save.
  const tempTargetPath = `${targetPath}.tmp-${randomUUID()}`

  try {
    // 1. Export DuckDB table to Parquet
    const safeParquetPath = tempParquetPath.replace(/'/g, "''")

    // Exclude __row_idx (positional, rebuilt on load) but KEEP __case_id: the
    // permanent case identity that styles.json's cell keys and stored formulas
    // reference, so it has to survive the save/reopen round trip.
    await conn.runAndReadAll(
      `COPY (SELECT * EXCLUDE (__row_idx) FROM dataset_${dataset.id}) TO '${safeParquetPath}' (FORMAT PARQUET)`
    )

    // 2. Write variables.json
    await fs.promises.writeFile(
      tempVariablesPath,
      JSON.stringify(dataset.variables, null, 2),
      'utf-8'
    )

    // 3. Write styles.json
    await fs.promises.writeFile(
      tempStylesPath,
      JSON.stringify(customStyles ?? {}, null, 2),
      'utf-8'
    )

    // 4. Write metadata.json (with formatVersion)
    await fs.promises.writeFile(
      tempMetadataPath,
      JSON.stringify({ formatVersion: 1, datasetId: dataset.id }, null, 2),
      'utf-8'
    )

    // 5. Write ai-chat.json — yalnız okunabilir sohbet içeriği (id/role/
    // content/createdAt); tool kartları/syntax önerileri kasıtlı olarak
    // dışarıda (bkz. shared/ai-types.ts AiChatEntrySchema yorumu).
    await fs.promises.writeFile(tempChatPath, JSON.stringify(chatHistory ?? [], null, 2), 'utf-8')

    // 6. Write output.json — Output sekmesi (OutputDocumentSchema).
    // Eski .sdf okuyucuları tanımadıkları girdiyi yok sayar (extractZipSafely
    // allow-list'i) → formatVersion artırmaya gerek yok.
    if (outputDocument) {
      await fs.promises.writeFile(tempOutputPath, JSON.stringify(outputDocument), 'utf-8')
    }

    // 7. Zip files together
    const zip = new AdmZip()
    zip.addLocalFile(tempParquetPath, undefined, 'data.parquet')
    zip.addLocalFile(tempVariablesPath, undefined, 'variables.json')
    zip.addLocalFile(tempStylesPath, undefined, 'styles.json')
    zip.addLocalFile(tempMetadataPath, undefined, 'metadata.json')
    zip.addLocalFile(tempChatPath, undefined, 'ai-chat.json')
    if (outputDocument) zip.addLocalFile(tempOutputPath, undefined, 'output.json')
    await zip.writeZipPromise(tempTargetPath)
    await fs.promises.rename(tempTargetPath, targetPath)

    log.info(`Dataset written to: ${targetPath}`)
  } catch (err) {
    log.error('Failed to write dataset', err)
    throw err
  } finally {
    // Cleanup — errors are suppressed so one failure doesn't block the other.
    await Promise.allSettled([
      fs.promises.rm(tempDir, { recursive: true, force: true }),
      fs.promises.rm(tempTargetPath, { force: true })
    ])
  }
}

// Helper function to handle the actual saving. Delegates the on-disk write
// to writeDatasetSdf (module-level, also used by the P0.6 recovery
// autosave) then mutates the in-memory dataset to reflect the save.
async function saveDatasetToSdf(
  dataset: Dataset,
  targetPath: string,
  customStyles?: CustomStyles | null,
  chatHistory?: PersistedAiChatEntry[] | null,
  outputDocument?: OutputDocument | null
): Promise<void> {
  // The recovery snapshot is housekeeping state that Main deletes — a user
  // "save" must never land there (the only copy of their work would vanish).
  if (isRecoveryPath(targetPath)) throw new Error('Cannot save into the recovery file')
  await writeDatasetSdf(dataset, targetPath, customStyles, chatHistory, outputDocument)
  if (customStyles) datasetCustomStyles.set(dataset.id, customStyles)
  dataset.filePath = targetPath
  dataset.name = path.basename(targetPath, '.sdf')
  setDatasetModified(dataset, false)
}

export function registerDatasetHandlers(): void {
  // 1. file:new
  // In dev mode (unpackaged) auto-import the test dataset so every app reload
  // starts with real data.  Production builds always get a blank dataset.
  ipcMain.handle(IPC.FILE_NEW, async (event): Promise<FileOpenResult> => {
    validateSender(event)

    // ── Dev auto-import ────────────────────────────────────────────────────
    // Opt-in via SAI_DEV_DATASET (absolute path to a local .xlsx) so no
    // developer's personal file path or data ships in the repo.
    if (!app.isPackaged) {
      const devDataset = process.env['SAI_DEV_DATASET']
      if (devDataset && fs.existsSync(devDataset)) {
        try {
          log.info(`[dev] Auto-importing test dataset: ${devDataset}`)
          const conn = await getDbConnection()
          const datasetId = `ds_${String(Date.now())}`
          const tempTableName = `temp_import_${datasetId}`
          const safePath = devDataset.replace(/'/g, "''")

          try {
            await conn.runAndReadAll('INSTALL excel; LOAD excel;')
          } catch {
            // extension may already be loaded — ignore
          }
          await conn.runAndReadAll(
            `CREATE TABLE ${tempTableName} AS SELECT * FROM read_xlsx('${safePath}', header=true, all_varchar=true)`
          )

          const { variables, sourceColumns } = await buildVariablesFromTempTable(
            conn,
            tempTableName
          )
          const dataset = await loadDatasetIntoDb(
            datasetId,
            path.basename(devDataset, path.extname(devDataset)),
            null,
            variables,
            tempTableName,
            sourceColumns
          )
          return { dataset, variables }
        } catch (devErr) {
          log.warn('[dev] Auto-import failed, falling back to blank dataset:', devErr)
          // fall through to the normal blank-dataset path below
        }
      }
    }
    // ── Normal blank dataset ───────────────────────────────────────────────
    const datasetId = `ds_${String(Date.now())}`
    const conn = await getDbConnection()
    const tableName = `dataset_${datasetId}`

    // Create a default table with 3 columns (col_1, col_2, col_3)
    await conn.runAndReadAll(`DROP TABLE IF EXISTS ${tableName}`)
    await conn.runAndReadAll(
      `CREATE TABLE ${tableName} (col_1 DOUBLE, col_2 VARCHAR, col_3 VARCHAR)`
    )

    // Insert 20 empty rows (SPSS-style default blank grid)
    await conn.runAndReadAll(`INSERT INTO ${tableName} SELECT NULL, NULL, NULL FROM range(20)`)

    const defaultVariables: Variable[] = [
      {
        colId: 'col_1',
        name: 'var1',
        type: 'numeric',
        width: 8,
        decimals: 2,
        label: 'Variable 1',
        valueLabels: {},
        missing: null,
        columns: 8,
        align: 'right',
        measure: 'scale',
        role: 'none',
        numfmtPattern: '0.00'
      },
      {
        colId: 'col_2',
        name: 'var2',
        type: 'string',
        width: 20,
        decimals: 0,
        label: 'Variable 2',
        valueLabels: {},
        missing: null,
        columns: 8,
        align: 'left',
        measure: 'nominal',
        role: 'none'
      },
      {
        colId: 'col_3',
        name: 'var3',
        type: 'string',
        width: 20,
        decimals: 0,
        label: 'Variable 3',
        valueLabels: {},
        missing: null,
        columns: 8,
        align: 'left',
        measure: 'nominal',
        role: 'none'
      }
    ]

    const tempTableName = `temp_new_${datasetId}`
    await conn.runAndReadAll(`ALTER TABLE ${tableName} RENAME TO ${tempTableName}`)

    const dataset = await loadDatasetIntoDb(
      datasetId,
      dialogText().untitledDataset,
      null,
      defaultVariables,
      tempTableName
    )

    return {
      dataset,
      variables: defaultVariables
    }
  })

  // 2. file:open
  handleValidated(
    IPC.FILE_OPEN,
    FileOpenRequestSchema,
    async (filePathArg): Promise<FileOpenResult | null> => {
      let filePath = filePathArg

      if (!filePath) {
        const result = await dialog.showOpenDialog({
          title: dialogText().openData,
          filters: [{ name: 'SAI Data Files (*.sdf)', extensions: ['sdf'] }],
          properties: ['openFile']
        })

        if (result.canceled || result.filePaths.length === 0) {
          return null
        }
        filePath = result.filePaths[0]
        if (filePath) approvePath(filePath)
      }

      if (!filePath) return null
      assertApprovedPath(filePath)

      log.info(`Opening SDF file: ${filePath}`)
      const tempExtractPath = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'sai-sdf-'))

      try {
        extractZipSafely(
          filePath,
          [
            'variables.json',
            'data.parquet',
            'styles.json',
            'metadata.json',
            'ai-chat.json',
            'output.json'
          ],
          tempExtractPath,
          '.sdf'
        )

        const variablesPath = path.join(tempExtractPath, 'variables.json')
        const parquetPath = path.join(tempExtractPath, 'data.parquet')
        const stylesPath = path.join(tempExtractPath, 'styles.json')
        const metadataPath = path.join(tempExtractPath, 'metadata.json')
        const chatPath = path.join(tempExtractPath, 'ai-chat.json')
        const outputPath = path.join(tempExtractPath, 'output.json')

        if (!fs.existsSync(variablesPath) || !fs.existsSync(parquetPath)) {
          throw new Error('Invalid .sdf file format: missing variables.json or data.parquet')
        }

        // Parse and validate format version from metadata
        let formatVersion = 1
        if (fs.existsSync(metadataPath)) {
          try {
            const metadataContent = await fs.promises.readFile(metadataPath, 'utf-8')
            const metadata: unknown = JSON.parse(metadataContent)
            if (
              metadata &&
              typeof metadata === 'object' &&
              'formatVersion' in metadata &&
              typeof metadata.formatVersion === 'number'
            ) {
              formatVersion = metadata.formatVersion
            }
          } catch (metadataErr) {
            log.warn('Failed to parse metadata.json', metadataErr)
          }
        }

        if (formatVersion > 1) {
          throw new Error(
            `Unsupported .sdf file format version (${String(formatVersion)}). Please update the app.`
          )
        }

        // Validate variables.json payload via Zod to prevent SQL injection or type corruption
        const variablesContent = await fs.promises.readFile(variablesPath, 'utf-8')
        const rawVariables: unknown = JSON.parse(variablesContent)
        // Files saved before import clamping could carry an out-of-range
        // width/columns/decimals (long SPSS strings) — clamp instead of
        // refusing to open the user's own project.
        if (Array.isArray(rawVariables)) {
          for (const v of rawVariables as unknown[]) {
            if (typeof v !== 'object' || v === null) continue
            const rec = v as Record<string, unknown>
            for (const attr of ['width', 'decimals', 'columns'] as const) {
              const n = rec[attr]
              if (typeof n === 'number') rec[attr] = clampVariableAttr(attr, n)
            }
          }
        }
        const parsedVariables = z.array(VariableSchema).safeParse(rawVariables)
        if (!parsedVariables.success) {
          throw new Error(`Invalid variables.json schema: ${parsedVariables.error.message}`)
        }
        const variables = parsedVariables.data

        // Validate styles.json payload
        let styles: CustomStyles | null = null
        if (fs.existsSync(stylesPath)) {
          try {
            const stylesContent = await fs.promises.readFile(stylesPath, 'utf-8')
            const rawStyles: unknown = JSON.parse(stylesContent)
            const parsedStyles = CustomStylesSchema.safeParse(rawStyles)
            if (parsedStyles.success) {
              styles = parsedStyles.data
            } else {
              log.warn('Invalid styles.json schema ignored')
            }
          } catch (stylesErr) {
            log.warn('Failed to parse styles.json', stylesErr)
          }
        }

        // ai-chat.json — eski .sdf dosyalarında yok (2026-09-26 öncesi),
        // yoksa boş geçmişle devam edilir (yeni özellik, geriye dönük uyumlu).
        let chatHistory: PersistedAiChatEntry[] = []
        if (fs.existsSync(chatPath)) {
          try {
            const chatContent = await fs.promises.readFile(chatPath, 'utf-8')
            const rawChat: unknown = JSON.parse(chatContent)
            const parsedChat = z.array(AiChatEntrySchema).safeParse(rawChat)
            if (parsedChat.success) {
              chatHistory = parsedChat.data
            } else {
              log.warn('Invalid ai-chat.json schema ignored')
            }
          } catch (chatErr) {
            log.warn('Failed to parse ai-chat.json', chatErr)
          }
        }

        // output.json — gömülü Output sekmesi (2026-09-29 öncesi .sdf'lerde
        // yok → null). Bozuk/uyumsuz çıktı veriyi açmayı engellemez.
        let outputDocument: OutputDocument | null = null
        if (fs.existsSync(outputPath)) {
          try {
            const rawOutput: unknown = JSON.parse(await fs.promises.readFile(outputPath, 'utf-8'))
            const parsedOutput = OutputDocumentSchema.safeParse(rawOutput)
            if (parsedOutput.success) {
              outputDocument = parsedOutput.data
            } else {
              log.warn('Invalid output.json schema ignored', parsedOutput.error.message)
            }
          } catch (outputErr) {
            log.warn('Failed to parse output.json', outputErr)
          }
        }

        const conn = await getDbConnection()
        const datasetId = `ds_${String(Date.now())}`
        const tempTableName = `temp_open_${datasetId}`

        const safeParquetPath = parquetPath.replace(/'/g, "''")
        await conn.runAndReadAll(
          `CREATE TABLE ${tempTableName} AS SELECT * FROM read_parquet('${safeParquetPath}')`
        )

        // A crash-recovery copy opens as an untitled dataset: Save then has to go
        // through Save As, and Main deleting the recovery file loses nothing.
        const isRecovery = isRecoveryPath(filePath)
        const fileName = isRecovery ? dialogText().untitledDataset : path.basename(filePath, '.sdf')
        const dataset = await loadDatasetIntoDb(
          datasetId,
          fileName,
          isRecovery ? null : filePath,
          variables,
          tempTableName
        )

        // Recovered work has no saved home yet — keep it "modified" so the
        // unsaved-changes guard and the recovery checkpoint protect it.
        if (isRecovery) setDatasetModified(dataset, true)

        warnIfLargeDataset(dataset)
        if (styles) datasetCustomStyles.set(datasetId, styles)

        return {
          dataset,
          variables,
          styles,
          chatHistory,
          outputDocument
        }
      } catch (err) {
        log.error('Failed to open file', err)
        throw err
      } finally {
        // Cleanup extracted temp files
        try {
          await fs.promises.rm(tempExtractPath, { recursive: true, force: true })
        } catch (cleanupErr) {
          log.warn('Failed to cleanup extraction folder', cleanupErr)
        }
      }
    }
  )

  // 3. file:save-data
  handleValidated(
    IPC.FILE_SAVE_DATA,
    FileSaveDataRequestSchema,
    async ({ datasetId, customStyles, chatHistory, outputDocument }): Promise<string | null> => {
      const dataset = getDatasetOrThrow(datasetId)

      if (dataset.filePath) {
        await saveDatasetToSdf(dataset, dataset.filePath, customStyles, chatHistory, outputDocument)
        return dataset.filePath
      } else {
        // If never saved before, trigger Save As dialog
        const result = await dialog.showSaveDialog({
          title: dialogText().saveData,
          defaultPath: `${dataset.name}.sdf`,
          filters: [{ name: 'SAI Data Files (*.sdf)', extensions: ['sdf'] }]
        })

        if (result.canceled || !result.filePath) {
          return null
        }

        approvePath(result.filePath)
        await saveDatasetToSdf(dataset, result.filePath, customStyles, chatHistory, outputDocument)
        return result.filePath
      }
    }
  )

  // 4. file:save-data-as
  handleValidated(
    IPC.FILE_SAVE_DATA_AS,
    FileSaveDataRequestSchema,
    async ({ datasetId, customStyles, chatHistory, outputDocument }): Promise<string | null> => {
      const dataset = getDatasetOrThrow(datasetId)

      const result = await dialog.showSaveDialog({
        title: dialogText().saveDataAs,
        defaultPath: dataset.filePath || `${dataset.name}.sdf`,
        filters: [{ name: 'SAI Data Files (*.sdf)', extensions: ['sdf'] }]
      })

      if (result.canceled || !result.filePath) {
        return null
      }

      approvePath(result.filePath)
      await saveDatasetToSdf(dataset, result.filePath, customStyles, chatHistory, outputDocument)
      return result.filePath
    }
  )
}
