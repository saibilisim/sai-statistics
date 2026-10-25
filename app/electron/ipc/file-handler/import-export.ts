// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { dialog } from 'electron'
import path from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { unlink } from 'fs/promises'
import { z } from 'zod'
import { isRReady, runRScript } from '../r-bridge'
import { IPC } from '../../../shared/ipc-contracts'
import type { FileOpenResult } from '../../../shared/ipc-contracts'
import { FileImportRequestSchema, FileExportRequestSchema } from '../../../shared/ipc-schemas'
import { getDbConnection, loadDatasetIntoDb, getDatasetOrThrow } from '../db-handler'
import log from 'electron-log'
import { handleValidated } from '../security'
import { approvePath, assertApprovedPath, testOnlyPath } from '../approved-paths'
import { quoteCol } from './type-inference'
import { getSettings } from '../settings-handler'
import { dialogText, warnIfLargeDataset, buildVariablesFromTempTable, rScriptsDir } from './shared'
import {
  readStatFileMetadata,
  importStatFileWithHaven,
  type StatFileVariableMeta
} from './stat-metadata'

const STAT_EXTENSIONS = ['.sav', '.zsav', '.por', '.dta', '.sas7bdat', '.xpt']

/**
 * read_xlsx(all_varchar) hands Excel date cells over as their serial number
 * ("37712" for 2003-04-01), which type inference then took for a plain
 * number. The typed sniff (DESCRIBE never fails on mixed columns, unlike a
 * typed read) tells which columns Excel stores as dates; rewrite their serials
 * as ISO text so inference recognises them as dates. Text cells in the same
 * column (e.g. "unknown") are left alone. Best-effort: on failure the column
 * simply stays as imported.
 */
async function restoreExcelDates(
  conn: Awaited<ReturnType<typeof getDbConnection>>,
  tableName: string,
  safePath: string
): Promise<void> {
  try {
    const desc = await conn.runAndReadAll(
      `DESCRIBE SELECT * FROM read_xlsx('${safePath}', header=true)`
    )
    for (const [name, type] of desc.getRows() as [string, string][]) {
      const isTimestamp = type.startsWith('TIMESTAMP')
      if (type !== 'DATE' && !isTimestamp) continue
      const col = quoteCol(name)
      const serial = `TRY_CAST(${col} AS DOUBLE)`
      const iso = isTimestamp
        ? `strftime(TIMESTAMP '1899-12-30' + to_microseconds(CAST(round(${serial} * 86400000000) AS BIGINT)), '%Y-%m-%d %H:%M:%S')`
        : `strftime(DATE '1899-12-30' + CAST(floor(${serial}) AS INTEGER), '%Y-%m-%d')`
      await conn.runAndReadAll(
        `UPDATE ${tableName} SET ${col} = ${iso} WHERE ${serial} IS NOT NULL`
      )
    }
  } catch (err) {
    log.warn('Excel date restoration skipped:', err)
  }
}

/** Defaults to on; tolerates the settings store not being ready yet. */
function readStatLabelsEnabled(): boolean {
  try {
    return getSettings().dataImport.readStatLabels
  } catch {
    return true
  }
}

/**
 * A Parquet file + per-variable metadata → a new (unsaved) dataset, through
 * the same variable derivation and loader as every import. Used by the R
 * console's sai_commit() (r-session.ts); the caller owns the Parquet file.
 */
export async function importParquetAsDataset(
  parquetPath: string,
  name: string,
  meta: Record<string, StatFileVariableMeta>
): Promise<FileOpenResult> {
  const conn = await getDbConnection()
  const datasetId = `ds_${String(Date.now())}`
  const tempTableName = `temp_import_${datasetId}`
  const literal = parquetPath.replace(/\\/g, '/').replace(/'/g, "''")
  await conn.runAndReadAll(
    `CREATE TABLE ${tempTableName} AS SELECT * FROM read_parquet('${literal}')`
  )
  // R declared the column types (a factor's codes are numbers, text is text).
  const { variables, sourceColumns } = await buildVariablesFromTempTable(
    conn,
    tempTableName,
    meta,
    true
  )
  const dataset = await loadDatasetIntoDb(
    datasetId,
    name,
    null,
    variables,
    tempTableName,
    sourceColumns
  )
  warnIfLargeDataset(dataset)
  return { dataset, variables }
}

export function registerImportExportHandlers(): void {
  // 5. file:import
  // Triggers dialog if no arguments are passed, or imports directly if parameters are provided.
  handleValidated(
    IPC.FILE_IMPORT,
    FileImportRequestSchema,
    async (req): Promise<FileOpenResult | null> => {
      let filePath = req?.filePath

      if (!filePath) {
        const dlg = dialogText()
        let title = dlg.importData
        let filters: { name: string; extensions: string[] }[] = []

        if (req?.fileType === 'excel') {
          title = dlg.importExcel
          filters = [{ name: 'Excel Files (*.xlsx)', extensions: ['xlsx'] }]
        } else if (req?.fileType === 'spss') {
          title = dlg.importSpss
          filters = [
            { name: 'SPSS Data Files (*.sav, *.zsav, *.por)', extensions: ['sav', 'zsav', 'por'] }
          ]
        } else if (req?.fileType === 'stata') {
          title = dlg.importStata
          filters = [{ name: 'Stata Data Files (*.dta)', extensions: ['dta'] }]
        } else if (req?.fileType === 'sas') {
          title = dlg.importSas
          filters = [
            { name: 'SAS Data Files (*.sas7bdat, *.xpt)', extensions: ['sas7bdat', 'xpt'] }
          ]
        } else {
          title = dlg.importData
          filters = [
            {
              name: 'All Supported Formats (*.csv, *.txt, *.xlsx, *.sav, *.zsav, *.por, *.dta, *.sas7bdat, *.xpt)',
              extensions: ['csv', 'txt', 'xlsx', 'sav', 'zsav', 'por', 'dta', 'sas7bdat', 'xpt']
            },
            { name: 'CSV & Text Files (*.csv, *.txt)', extensions: ['csv', 'txt'] },
            { name: 'Excel Files (*.xlsx)', extensions: ['xlsx'] },
            {
              name: 'Statistical Files (*.sav, *.zsav, *.por, *.dta, *.sas7bdat, *.xpt)',
              extensions: ['sav', 'zsav', 'por', 'dta', 'sas7bdat', 'xpt']
            },
            { name: 'All Files (*.*)', extensions: ['*'] }
          ]
        }

        const dialogResult = await dialog.showOpenDialog({
          title,
          filters,
          properties: ['openFile']
        })

        if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
          return null
        }
        filePath = dialogResult.filePaths[0]
        if (filePath) approvePath(filePath)
      }

      if (!filePath) return null
      assertApprovedPath(filePath)

      log.info(`Importing file: ${filePath}`)
      const conn = await getDbConnection()
      const datasetId = `ds_${String(Date.now())}`
      const tempTableName = `temp_import_${datasetId}`

      const safePath = filePath.replace(/'/g, "''")
      const ext = path.extname(filePath).toLowerCase()
      let havenMeta: Record<string, StatFileVariableMeta> | null = null

      try {
        if (ext === '.xlsx') {
          // Load Excel extension
          try {
            await conn.runAndReadAll('INSTALL excel; LOAD excel;')
          } catch (extErr) {
            log.error('Could not install/load DuckDB excel extension', extErr)
            throw new Error('Excel extension is required to import .xlsx files.')
          }
          // all_varchar: a typed read aborts on the first mixed column ("abc"
          // under a numeric first row) — text in, types inferred below.
          const query = `CREATE TABLE ${tempTableName} AS SELECT * FROM read_xlsx('${safePath}', header=true, all_varchar=true)`
          await conn.runAndReadAll(query)
          await restoreExcelDates(conn, tempTableName, safePath)
        } else if (STAT_EXTENSIONS.includes(ext)) {
          // Preferred: haven (bundled R) — keeps user-missing codes + their
          // definitions, labels, formats in one read, works offline.
          const parquetPath = path.join(tmpdir(), `sai-import-${randomUUID()}.parquet`)
          try {
            havenMeta = await importStatFileWithHaven(
              filePath,
              parquetPath,
              readStatLabelsEnabled()
            )
            if (havenMeta) {
              await conn.runAndReadAll(
                `CREATE TABLE ${tempTableName} AS SELECT * FROM read_parquet('${parquetPath.replace(/\\/g, '/').replace(/'/g, "''")}')`
              )
            }
          } finally {
            void unlink(parquetPath).catch(() => undefined)
          }
          if (!havenMeta) {
            // Fallback: DuckDB read_stat community extension (downloaded on
            // first use; loses SPSS user-missing codes — see import-stat.R).
            try {
              await conn.runAndReadAll('INSTALL read_stat FROM community; LOAD read_stat;')
            } catch (extErr) {
              log.error('Could not install/load DuckDB read_stat extension', extErr)
              throw new Error(
                'read_stat extension is required to import statistical files (SAV, DTA, SAS).'
              )
            }
            const query = `CREATE TABLE ${tempTableName} AS SELECT * FROM read_stat('${safePath}')`
            await conn.runAndReadAll(query)
          }
        } else {
          // Default to CSV
          const delim = req?.options?.delimiter ?? ','
          const headerStr = req?.options?.header !== false ? 'true' : 'false'
          const encoding = req?.options?.encoding ?? 'utf-8'

          if (![',', ';', '\t', ' ', '|'].includes(delim)) {
            throw new Error(`Unsupported delimiter: ${delim}`)
          }
          if (!/^[a-zA-Z0-9_-]+$/.test(encoding)) {
            throw new Error(`Unsupported encoding: ${encoding}`)
          }

          // Optionally load encodings extension if requested encoding is non-standard
          if (encoding !== 'utf-8' && encoding !== 'latin-1') {
            try {
              await conn.runAndReadAll('INSTALL encodings; LOAD encodings;')
            } catch (extErr) {
              log.warn('Could not load DuckDB encodings extension, falling back to default', extErr)
            }
          }

          const query = `CREATE TABLE ${tempTableName} AS SELECT * FROM read_csv_auto('${safePath}', header=${headerStr}, delim='${delim}', encoding='${encoding}')`
          await conn.runAndReadAll(query)
        }

        // Labels the source file declares about itself. Only SPSS/Stata carry
        // any, and the pass is best-effort — an empty map just means inference
        // decides everything, as it does for CSV/Excel.
        const fileMeta =
          havenMeta ?? (readStatLabelsEnabled() ? await readStatFileMetadata(filePath, ext) : {})

        // Single source of truth for header → variable derivation (all formats).
        const { variables, sourceColumns } = await buildVariablesFromTempTable(
          conn,
          tempTableName,
          fileMeta,
          STAT_EXTENSIONS.includes(ext)
        )

        const fileName = path.basename(filePath)
        const dataset = await loadDatasetIntoDb(
          datasetId,
          fileName,
          null, // imports start unsaved (no .sdf path)
          variables,
          tempTableName,
          sourceColumns
        )

        warnIfLargeDataset(dataset)

        return {
          dataset,
          variables
        }
      } catch (err) {
        log.error('File import failed', err)
        throw err
      }
    }
  )

  // 6. file:export-csv
  handleValidated(
    IPC.FILE_EXPORT_CSV,
    FileExportRequestSchema,
    async (req): Promise<string | null> => {
      const dataset = getDatasetOrThrow(req.datasetId)

      let targetPath = testOnlyPath(req.filePath)
      if (!targetPath) {
        const dialogResult = await dialog.showSaveDialog({
          title: dialogText().exportCsv,
          defaultPath: `${dataset.name}.csv`,
          filters: [{ name: 'CSV Files (*.csv)', extensions: ['csv'] }]
        })

        if (dialogResult.canceled || !dialogResult.filePath) {
          return null
        }
        targetPath = dialogResult.filePath
      }

      if (!targetPath) return null

      log.info(`Exporting dataset ${req.datasetId} to CSV: ${targetPath}`)
      const conn = await getDbConnection()
      const safeExportPath = targetPath.replace(/'/g, "''")

      await conn.runAndReadAll(
        `COPY (${userFacingSelect(dataset)}) TO '${safeExportPath}' (HEADER, DELIMITER ',')`
      )

      log.info('CSV export completed successfully.')
      return targetPath
    }
  )

  // 7. file:export-xlsx
  handleValidated(
    IPC.FILE_EXPORT_XLSX,
    FileExportRequestSchema,
    async (req): Promise<string | null> => {
      const dataset = getDatasetOrThrow(req.datasetId)

      let targetPath = testOnlyPath(req.filePath)
      if (!targetPath) {
        const dialogResult = await dialog.showSaveDialog({
          title: dialogText().exportExcel,
          defaultPath: `${dataset.name}.xlsx`,
          filters: [{ name: 'Excel Files (*.xlsx)', extensions: ['xlsx'] }]
        })

        if (dialogResult.canceled || !dialogResult.filePath) {
          return null
        }
        targetPath = dialogResult.filePath
      }

      if (!targetPath) return null

      log.info(`Exporting dataset ${req.datasetId} to Excel: ${targetPath}`)
      const conn = await getDbConnection()
      const safeExportPath = targetPath.replace(/'/g, "''")

      try {
        await conn.runAndReadAll('INSTALL excel; LOAD excel;')
        // The excel extension's COPY format is `xlsx` (`EXCEL` was dropped —
        // "Copy Function with name excel does not exist"), and it writes no
        // header row unless asked.
        await conn.runAndReadAll(
          `COPY (${userFacingSelect(dataset)}) TO '${safeExportPath}' (FORMAT xlsx, HEADER true)`
        )
        log.info('Excel export completed successfully.')
        return targetPath
      } catch (err) {
        log.error('Excel export failed:', err)
        throw err
      }
    }
  )

  // 8. file:export-sav — DuckDB can't write .sav, so the rows go out as a
  // temp Parquet file and r-scripts/export-sav.R writes the .sav with
  // haven::write_sav (labels, value labels, user-missing, formats).
  handleValidated(
    IPC.FILE_EXPORT_SAV,
    FileExportRequestSchema,
    async (req): Promise<string | null> => {
      const dataset = getDatasetOrThrow(req.datasetId)
      const dlg = dialogText()

      const fail = async (message: string): Promise<null> => {
        await dialog.showMessageBox({
          type: 'error',
          title: dlg.exportSavTitle,
          message,
          buttons: [dlg.ok]
        })
        return null
      }
      if (!isRReady()) return fail(dlg.exportSavNoR)

      let targetPath = testOnlyPath(req.filePath)
      if (!targetPath) {
        const dialogResult = await dialog.showSaveDialog({
          title: dlg.exportSavTitle,
          defaultPath: `${dataset.name.replace(/\.[^.]+$/, '')}.sav`,
          filters: [{ name: 'SPSS Data Files (*.sav)', extensions: ['sav'] }]
        })
        if (dialogResult.canceled || !dialogResult.filePath) return null
        targetPath = dialogResult.filePath
      }

      // Case order + colId-named columns; the path is ours (tmpdir + UUID).
      const parquetPath = path.join(tmpdir(), `sai-sav-${randomUUID()}.parquet`)
      const conn = await getDbConnection()
      const cols = dataset.variables.map(v => `"${v.colId}"`).join(', ')
      await conn.runAndReadAll(
        `COPY (SELECT ${cols} FROM dataset_${req.datasetId} ORDER BY __row_idx) ` +
          `TO '${parquetPath.replace(/\\/g, '/').replace(/'/g, "''")}' (FORMAT PARQUET)`
      )

      log.info(`Exporting dataset ${req.datasetId} to SPSS: ${targetPath}`)
      try {
        const { stdout } = await runRScript({
          scriptPath: path.join(rScriptsDir(), 'export-sav.R'),
          params: {
            parquet: parquetPath,
            out: targetPath,
            variables: dataset.variables.map(v => ({
              colId: v.colId,
              name: v.name,
              label: v.label,
              type: v.type,
              width: v.width,
              decimals: v.decimals,
              columns: v.columns,
              valueLabels: v.valueLabels,
              missing: v.missing
            }))
          },
          timeoutMs: 10 * 60_000
        })
        const match = /__SAI_RESULT__\s*([\s\S]+?)\s*__END_RESULT__/.exec(stdout)
        const parsed = SavExportResultSchema.safeParse(match ? JSON.parse(match[1] ?? '') : null)
        if (!parsed.success) return await fail(dlg.exportSavFailed.replace('{{error}}', ''))
        if (!parsed.data.ok) {
          return await fail(
            parsed.data.error === 'haven_missing'
              ? dlg.exportSavNoHaven
              : dlg.exportSavFailed.replace('{{error}}', parsed.data.detail ?? '')
          )
        }
        log.info(`SPSS export completed: ${String(parsed.data.rows)} rows`)
        return targetPath
      } catch (err) {
        log.error('SPSS export failed:', err)
        return await fail(dlg.exportSavFailed.replace('{{error}}', String(err)))
      } finally {
        void unlink(parquetPath).catch(() => undefined)
      }
    }
  )
}

/**
 * The rows as the user sees them: physical columns are internal colIds
 * (col_1, …), so name each one after its variable, and keep case order
 * (Sort Cases rewrites __row_idx, not necessarily the physical order).
 */
function userFacingSelect(dataset: {
  id: string
  variables: { colId: string; name: string }[]
}): string {
  const cols = dataset.variables
    .map(v => `"${v.colId}" AS "${v.name.replace(/"/g, '""')}"`)
    .join(', ')
  return `SELECT ${cols} FROM dataset_${dataset.id} ORDER BY __row_idx`
}

const SavExportResultSchema = z.object({
  ok: z.boolean(),
  rows: z.number().optional(),
  error: z.string().optional(),
  detail: z.string().optional()
})
