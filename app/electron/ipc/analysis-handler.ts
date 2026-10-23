// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * analysis-handler.ts — IPC handlers for analysis:run and analysis:cancel.
 *
 * Validates incoming requests, exports the filtered dataset to Parquet,
 * resolves the R script path, and enqueues the job.
 */

import { app, dialog } from 'electron'
import { z } from 'zod'
import { join, basename } from 'path'
import { unlink, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import log from 'electron-log'
import { IPC } from '../../shared/ipc-contracts'
import { AnalysisRunRequestSchema, AnalysisCancelRequestSchema } from '../../shared/ipc-schemas'
import { handleValidated } from './security'
import {
  exportDatasetToParquet,
  getWeightVariable,
  getSplitVariable,
  getSplitVariableName,
  getSplitValueLabels,
  getColumnFilters,
  getMissingValuesMap,
  getVariableDecimalsMap
} from './db-handler'
import { enqueueJob, cancelJob } from './job-manager'

const isDev = !app.isPackaged

function getRScriptsDir(): string {
  if (isDev) {
    // In dev, app.getAppPath() is the app/ directory (where package.json lives)
    return join(app.getAppPath(), 'r-scripts')
  }
  // In production, r-scripts are bundled in resources/
  return join(process.resourcesPath, 'r-scripts')
}

export function registerAnalysisHandlers(): void {
  const approvedModelPaths = new Map<number, Set<string>>()
  handleValidated(IPC.FILE_MODEL_EXPORT_PATH, z.undefined(), async (_, event) => {
    const result = await dialog.showSaveDialog({
      defaultPath: 'multinomial-model.xml',
      filters: [{ name: 'PMML XML', extensions: ['xml'] }]
    })
    if (result.canceled || !result.filePath) return null
    const paths = approvedModelPaths.get(event.sender.id) ?? new Set<string>()
    paths.add(result.filePath)
    approvedModelPaths.set(event.sender.id, paths)
    return result.filePath
  })
  // ── analysis:run ────────────────────────────────────────────────────────────
  handleValidated(
    IPC.ANALYSIS_RUN,
    AnalysisRunRequestSchema,
    async (req, event): Promise<{ jobId: string }> => {
      // Security: only allow bare .R filenames — no path traversal
      const safeFile = basename(req.scriptFile)
      if (safeFile !== req.scriptFile || !safeFile.endsWith('.R')) {
        throw new Error(`Invalid scriptFile: ${req.scriptFile}`)
      }

      let modelExportPath: string | undefined
      if (req.scriptFile === 'regression-multinomial.R') {
        const exportModel = z
          .object({ path: z.string(), covariance: z.boolean() })
          .optional()
          .parse(req.params.exportModel)
        if (exportModel?.path && !approvedModelPaths.get(event.sender.id)?.has(exportModel.path)) {
          const result = await dialog.showSaveDialog({
            defaultPath: exportModel.path,
            filters: [{ name: 'PMML XML', extensions: ['xml'] }]
          })
          if (result.canceled || !result.filePath)
            throw new Error('output.multinom.extra.exportCancelled')
          req.params.exportModel = { ...exportModel, path: result.filePath }
        }
      }

      if (req.scriptFile === 'regression-multinomial.R') {
        const spec = z
          .object({ path: z.string(), covariance: z.boolean() })
          .optional()
          .parse(req.params.exportModel)
        if (spec?.path) {
          modelExportPath = spec.path
          // Paths stay in Main; the R process only returns model content.
          req.params.exportModel = { enabled: true, covariance: spec.covariance }
        } else delete req.params.exportModel
      }

      const rScriptsDir = getRScriptsDir()
      const scriptPath = join(rScriptsDir, safeFile)

      log.info(`[analysis-handler] analysis:run analysisId=${req.analysisId} script=${scriptPath}`)

      // Export filtered dataset to a temp Parquet file. Merge the Main-side
      // filter mirror (data:set-column-filters — same choke point as
      // weight/split below) with any filters the caller passed explicitly;
      // the request's own values win per-column so a dialog can still filter
      // by something the Data View grid doesn't currently show.
      const columnFilters = { ...getColumnFilters(req.datasetId), ...(req.columnFilters ?? {}) }
      const parquetPath = await exportDatasetToParquet(req.datasetId, columnFilters)

      // Weight Cases (W1): inject the active weight-variable colId from a
      // single main-process choke point so every analysis picks it up
      // without each dialog/spss-syntax call site needing to know about it.
      // R scripts that don't opt in fall through _bootstrap.R's automatic
      // "weight not applied" warning (see get_weights()/sai_output()).
      const weightVariable = getWeightVariable(req.datasetId)

      // Split File (B2): same choke point as weightVariable — inject the
      // active split-variable colId so scripts that opt in (via
      // get_split_groups() in _bootstrap.R) repeat their tables per group.
      // Scripts that don't opt in fall through sai_output()'s automatic
      // "split not applied" warning, same honesty pattern as weight/missing.
      const splitVariable = getSplitVariable(req.datasetId)
      const splitVariableName = getSplitVariableName(req.datasetId)
      const splitValueLabels = getSplitValueLabels(req.datasetId)

      // Missing Values (M1): inject the dataset's colId -> MissingValues map
      // from the same main-process choke point as weightVariable, so every
      // analysis picks up user-defined missing values without each
      // dialog/spss-syntax call site needing to know about them. R scripts
      // opt in by calling apply_user_missing() (see _bootstrap.R); scripts
      // that don't fall through sai_output()'s automatic
      // "missing not applied" warning.
      const missingValues = getMissingValuesMap(req.datasetId)

      // Decimals (M2): colId -> decimals map, same choke point, so scripts
      // that opt in (via format_decimals() in _bootstrap.R) can display a
      // numeric variable's own raw values using its Variable View precision.
      const variableDecimals = getVariableDecimalsMap(req.datasetId)

      const enrichedParams: Record<string, unknown> = {
        ...req.params,
        parquetPath,
        rScriptsDir,
        datasetId: req.datasetId,
        ...(weightVariable ? { weightVariable } : {}),
        ...(splitVariable
          ? { splitVariable, splitVariableName, ...(splitValueLabels ? { splitValueLabels } : {}) }
          : {}),
        ...(Object.keys(missingValues).length > 0 ? { missingValues } : {}),
        ...(Object.keys(variableDecimals).length > 0 ? { variableDecimals } : {})
      }

      const jobId = randomUUID()

      enqueueJob({
        jobId,
        analysisId: req.analysisId,
        scriptPath,
        params: enrichedParams,
        summary: req.summary,
        syntax: req.syntax,
        // Delete the temp Parquet file as soon as the job finishes (success,
        // error, or cancel) — no need for an arbitrary timeout.
        onResult: async result => {
          if (!modelExportPath) return
          if (!result.modelXml) throw new Error('output.multinom.extra.xmlMissing')
          await writeFile(modelExportPath, result.modelXml, 'utf8')
        },
        onFinally: () => {
          void unlink(parquetPath).catch((err: unknown) => {
            log.warn(`[analysis-handler] Failed to delete parquet ${parquetPath}: ${String(err)}`)
          })
        }
      })

      return { jobId }
    }
  )

  // ── analysis:cancel ─────────────────────────────────────────────────────────
  handleValidated(IPC.ANALYSIS_CANCEL, AnalysisCancelRequestSchema, (req): void => {
    log.info(`[analysis-handler] analysis:cancel jobId=${req.jobId}`)
    cancelJob(req.jobId)
  })
}
