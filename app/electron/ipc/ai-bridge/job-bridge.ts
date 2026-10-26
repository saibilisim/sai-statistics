// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * job-bridge.ts — job:complete Main-içi köprüsü (§3.1 adım 3) ve run_analysis
 * için mevcut analiz hunisinin (analysis-handler aynası) Main-içi karşılığı.
 */

import { app } from 'electron'
import { join, basename } from 'path'
import { unlinkSync } from 'fs'
import { randomUUID } from 'crypto'
import log from 'electron-log'
import type { WebContents } from 'electron'
import { IPC } from '../../../shared/ipc-contracts'
import type { JobCompletePayload, JobErrorPayload } from '../../../shared/ipc-contracts'
import type { AnalysisResult } from '../../../shared/analysis-types'
import { isAnalysisScriptAllowed } from '../../../shared/analysis-scripts'
import { getSettings } from '../settings-handler'
import {
  exportDatasetToParquet,
  getWeightVariable,
  getSplitVariable,
  getSplitVariableName,
  getSplitValueLabels,
  getColumnFilters,
  getMissingValuesMap,
  getVariableDecimalsMap
} from '../db-handler'
import { enqueueJob, cancelJob } from '../job-manager'

// ─── job:complete köprüsü (Main içi, §3.1 adım 3) ───────────────────────────
// job-manager sonucu yalnız Renderer'a push eder (win.webContents.send). Agent
// döngüsünün AnalysisResult'a Main içinde ihtiyacı var; job-manager'a
// dokunulmadığı için turn'ün WebContents'inin send metodu bir kez tap'lenir.
// Tap salt-okur gözlemcidir: payload'ı ilgili waiter'a iletir ve orijinal
// send'i HER ZAMAN çağırır — Renderer'ın job:complete → output-store akışı
// birebir aynen çalışmaya devam eder.

interface JobWaiter {
  resolve: (result: AnalysisResult) => void
  reject: (err: Error) => void
}

const jobWaiters = new Map<string, JobWaiter>()
const tappedContents = new WeakSet<WebContents>()

function tapJobEvents(sender: WebContents): void {
  if (tappedContents.has(sender)) return
  tappedContents.add(sender)
  const original = sender.send.bind(sender)
  sender.send = ((channel: string, payload?: unknown): void => {
    if (channel === IPC.JOB_COMPLETE) {
      const p = payload as JobCompletePayload
      const waiter = jobWaiters.get(p.jobId)
      if (waiter) {
        jobWaiters.delete(p.jobId)
        waiter.resolve(p.result)
      }
    } else if (channel === IPC.JOB_ERROR) {
      const p = payload as JobErrorPayload
      const waiter = jobWaiters.get(p.jobId)
      if (waiter) {
        jobWaiters.delete(p.jobId)
        const details = 'details' in p && p.details ? `: ${p.details}` : ''
        waiter.reject(new Error(`Analysis job failed (${p.errorKey})${details}`))
      }
    }
    original(channel, payload)
  }) as WebContents['send']
}

/** Bir job'un job:complete/job:error'ını bekler; iptal/timeout'ta reddeder. */
function waitForJob(jobId: string, signal: AbortSignal): Promise<AnalysisResult> {
  return new Promise<AnalysisResult>((resolve, reject) => {
    const timeoutMs = getSettings().r.timeout * 1000 + 30_000
    const timer = setTimeout(() => {
      jobWaiters.delete(jobId)
      reject(new Error(`Analysis job ${jobId} timed out`))
    }, timeoutMs)
    const onAbort = (): void => {
      clearTimeout(timer)
      jobWaiters.delete(jobId)
      // ai:cancel işi de iptal eder — mevcut job iptal akışıyla birleşir (§7).
      cancelJob(jobId)
      reject(new Error('cancelled'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    jobWaiters.set(jobId, {
      resolve: result => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      },
      reject: err => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        reject(err)
      }
    })
  })
}

// ─── run_analysis: mevcut analiz hunisi (analysis-handler aynası) ────────────

/**
 * analysis-handler.ts'deki analysis:run akışının Main-içi karşılığı: parquet
 * export + weight/split/filter/missing/decimals enjeksiyonu + enqueueJob.
 * columnFilters artık data:set-column-filters ile Main'e aynalanan choke-point
 * kaynağından (getColumnFilters) okunuyor — 2026-09-04'e kadar burada hep {}
 * geçiliyordu, yani AI'dan tetiklenen her analiz (run_analysis/run_syntax)
 * kullanıcının onayladığı SELECT IF'ten bağımsız olarak DAİMA tam veri kümesi
 * üzerinde koşuyordu (destek talebi). Artık weight/split ile aynı choke point.
 */
/**
 * §9: raw data rows never reach the model. Case-level listings (SUMMARIZE /
 * REPORT case lists, EXAMINE extreme values) are switched off for every
 * AI-initiated job, whatever the model's syntax asked for.
 */
function withoutCaseLevelOutput(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params, displayCases: false }
  const options = out['options']
  if (options && typeof options === 'object' && !Array.isArray(options)) {
    const o = options as Record<string, unknown>
    const stats = o['stats']
    out['options'] = {
      ...o,
      ...(stats && typeof stats === 'object' && !Array.isArray(stats)
        ? { stats: { ...(stats as Record<string, unknown>), outliers: false } }
        : {})
    }
  }
  return out
}

export async function enqueueAiAnalysis(args: {
  datasetId: string
  analysisId: string
  scriptFile: string
  params: Record<string, unknown>
  sender: WebContents
  signal: AbortSignal
}): Promise<{ jobId: string; result: AnalysisResult }> {
  // analysis-handler ile aynı kural: bare .R dosya adı (path traversal yok).
  // scriptFile manifest sabitinden gelir ama savunma derinliği korunur.
  const safeFile = basename(args.scriptFile)
  if (safeFile !== args.scriptFile || !safeFile.endsWith('.R')) {
    throw new Error(`Invalid scriptFile: ${args.scriptFile}`)
  }
  if (!isAnalysisScriptAllowed(safeFile)) {
    throw new Error(`Script not allowed: ${args.scriptFile}`)
  }
  const rScriptsDir = !app.isPackaged
    ? join(app.getAppPath(), 'r-scripts')
    : join(process.resourcesPath, 'r-scripts')
  const scriptPath = join(rScriptsDir, safeFile)

  const parquetPath = await exportDatasetToParquet(args.datasetId, getColumnFilters(args.datasetId))

  // Choke point enjeksiyonu — analysis-handler.ts ile birebir aynı kaynaklar.
  const weightVariable = getWeightVariable(args.datasetId)
  const splitVariable = getSplitVariable(args.datasetId)
  const splitVariableName = getSplitVariableName(args.datasetId)
  const splitValueLabels = getSplitValueLabels(args.datasetId)
  const missingValues = getMissingValuesMap(args.datasetId)
  const variableDecimals = getVariableDecimalsMap(args.datasetId)

  const enrichedParams: Record<string, unknown> = {
    ...withoutCaseLevelOutput(args.params),
    parquetPath,
    rScriptsDir,
    datasetId: args.datasetId,
    ...(weightVariable ? { weightVariable } : {}),
    ...(splitVariable
      ? { splitVariable, splitVariableName, ...(splitValueLabels ? { splitValueLabels } : {}) }
      : {}),
    ...(Object.keys(missingValues).length > 0 ? { missingValues } : {}),
    ...(Object.keys(variableDecimals).length > 0 ? { variableDecimals } : {})
  }

  const jobId = randomUUID()
  tapJobEvents(args.sender)
  const resultPromise = waitForJob(jobId, args.signal)
  enqueueJob({
    jobId,
    analysisId: args.analysisId,
    scriptPath,
    params: enrichedParams,
    source: 'ai',
    onFinally: () => {
      // Sync: also fired from cancelAllJobs() while the app is quitting.
      try {
        unlinkSync(parquetPath)
      } catch (err) {
        log.warn(`[ai-bridge] Failed to delete parquet ${parquetPath}: ${String(err)}`)
      }
    }
  })
  const result = await resultPromise
  return { jobId, result }
}
