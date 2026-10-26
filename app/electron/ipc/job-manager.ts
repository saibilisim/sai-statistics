// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * job-manager.ts — FIFO job queue for R analyses.
 *
 * One job runs at a time. Jobs are pushed to a queue and drained sequentially.
 * Results and errors are pushed to the renderer via BrowserWindow.webContents.send.
 */

import { BrowserWindow } from 'electron'
import log from 'electron-log'
import { IPC } from '../../shared/ipc-contracts'
import type {
  JobProgressPayload,
  JobCompletePayload,
  JobErrorPayload
} from '../../shared/ipc-contracts'
import { AnalysisResultSchema, type AnalysisResult } from '../../shared/analysis-types'
import { runRScript } from './r-bridge'
import { getSettings } from './settings-handler'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Job {
  jobId: string
  analysisId: string
  scriptPath: string
  params: Record<string, unknown>
  cancelled: boolean
  /** See JobCompletePayload.source — set for AI-agent-initiated jobs. */
  source?: 'ai'
  /** See JobCompletePayload.summary/syntax — auto output header passthrough. */
  summary?: string
  syntax?: string
  /** Called once the job finishes (success, error, or cancel). */
  onResult?: (result: AnalysisResult) => Promise<void>
  onFinally?: () => void
}

// ─── State ────────────────────────────────────────────────────────────────────

let win: BrowserWindow | null = null
const queue: Job[] = []
let running = false

// Track the running job so cancelJob() can flag AND abort it mid-execution.
// (Previously only the id was kept — cancelJob could abort the process but
// never set job.cancelled, so a killed run surfaced as rScriptFailed instead
// of analysisCancelled.)
let runningJob: Job | null = null
let runningAbortController: AbortController | null = null

const RESULT_RE = /\n__SAI_RESULT__\n?([\s\S]+?)\n?__END_RESULT__\n/

/** Normalize Windows CRLF line endings so marker parsing is platform-agnostic. */
function normalizeOutput(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * `job.cancelled` is mutated by `cancelJob()` from a *different* call while
 * this job's async function is suspended at an `await` — a real race the
 * type checker can't see across function boundaries, so it narrows
 * `job.cancelled` to `false` after the first guard and flags later re-checks
 * as "always falsy". Routing the read through a function breaks that
 * (incorrect) narrowing without changing behavior.
 */
function isCancelled(job: Job): boolean {
  return job.cancelled
}

function send(
  channel: string,
  payload: JobProgressPayload | JobCompletePayload | JobErrorPayload
): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

function pushProgress(payload: JobProgressPayload): void {
  send(IPC.JOB_PROGRESS, payload)
}

function pushComplete(payload: JobCompletePayload): void {
  send(IPC.JOB_COMPLETE, payload)
}

function pushError(payload: JobErrorPayload): void {
  send(IPC.JOB_ERROR, payload)
}

async function processJob(job: Job): Promise<void> {
  if (job.cancelled) {
    log.info(`[job-manager] job ${job.jobId} was cancelled before start`)
    pushError({ jobId: job.jobId, errorKey: 'common.analysisCancelled' })
    job.onFinally?.()
    return
  }

  log.info(`[job-manager] running job ${job.jobId} (${job.analysisId})`)

  runningJob = job
  runningAbortController = new AbortController()

  try {
    const resultRaw = await runRScript({
      scriptPath: job.scriptPath,
      params: job.params,
      timeoutMs: getSettings().r.timeout * 1000,
      signal: runningAbortController.signal,
      onProgress: (percent, messageKey) => {
        if (!job.cancelled) {
          pushProgress({ jobId: job.jobId, percent, messageKey })
        }
      }
    })
    // Windows Rscript can emit CRLF line endings, which breaks the LF-based
    // marker regex below. Normalize before parsing so the protocol is robust
    // across platforms.
    const result = {
      ...resultRaw,
      stdout: normalizeOutput(resultRaw.stdout),
      stderr: normalizeOutput(resultRaw.stderr)
    }

    if (isCancelled(job)) {
      log.info(`[job-manager] job ${job.jobId} was cancelled during execution`)
      pushError({ jobId: job.jobId, errorKey: 'common.analysisCancelled' })
      return
    }

    if (result.exitCode !== 0) {
      log.error(
        `[job-manager] job ${job.jobId} failed (exitCode=${String(result.exitCode)}): ${result.stderr}`
      )
      // stderr carries PROGRESS:<pct>:<key> protocol lines alongside the real R
      // error — strip them so the error block shows only the actual message.
      const errText = result.stderr
        .split('\n')
        .filter(line => !line.trimStart().startsWith('PROGRESS:'))
        .join('\n')
        .trim()
      // sai_error() reports handled errors by writing the failure JSON
      // ({success:false, error:msg}) to stdout and quitting with status 1 —
      // so on non-zero exit the REAL message is in the stdout marker, not
      // stderr (which then holds only PROGRESS lines). Parse the marker first
      // and prefer its `error` field; fall back to stderr for hard crashes
      // (unhandled stop() before the script's tryCatch, missing marker, …).
      let details = errText
      const errMatch = RESULT_RE.exec('\n' + result.stdout + '\n')
      if (errMatch && errMatch[1] !== undefined) {
        try {
          const errRaw = JSON.parse(errMatch[1].trim()) as { error?: unknown }
          if (typeof errRaw.error === 'string' && errRaw.error.length > 0) {
            details = errRaw.error
          }
        } catch {
          // Marker content wasn't JSON — keep the stderr fallback.
        }
      }
      pushError({
        jobId: job.jobId,
        errorKey: 'error.rScriptFailed',
        // Empty details would render as a blank error block in the Output
        // view (the renderer only falls back to errorKey on null/undefined) —
        // send undefined instead so the generic translated message shows.
        details: details.slice(0, 2000) || undefined
      })
      return
    }

    // Parse result JSON from stdout
    const match = RESULT_RE.exec('\n' + result.stdout + '\n')
    if (!match || match[1] === undefined) {
      log.error(`[job-manager] job ${job.jobId}: no result marker in stdout`)
      // Surface any stderr content alongside the generic marker message so the
      // user (and support logs) can see the real R crash reason instead of a
      // blank "marker not found" block.
      const stderrHint = result.stderr
        .split('\n')
        .filter(line => !line.trimStart().startsWith('PROGRESS:'))
        .join('\n')
        .trim()
      pushError({
        jobId: job.jobId,
        errorKey: 'error.rScriptFailed',
        details:
          'No __SAI_RESULT__ marker found in R script output' +
          (stderrHint ? `\n\n${stderrHint.slice(0, 1800)}` : '')
      })
      return
    }

    let raw: unknown
    try {
      raw = JSON.parse(match[1].trim()) as unknown
    } catch (parseErr) {
      log.error(`[job-manager] job ${job.jobId}: JSON parse error: ${String(parseErr)}`)
      pushError({
        jobId: job.jobId,
        errorKey: 'error.rScriptFailed',
        details: `JSON parse error: ${String(parseErr)}`
      })
      return
    }

    const parsed = AnalysisResultSchema.safeParse(raw)
    if (!parsed.success) {
      log.error(
        `[job-manager] job ${job.jobId}: result schema validation failed: ${parsed.error.message}`
      )
      pushError({
        jobId: job.jobId,
        errorKey: 'error.rScriptFailed',
        details: `Result schema invalid: ${parsed.error.message}`
      })
      return
    }

    await job.onResult?.(parsed.data)
    delete parsed.data.modelXml
    log.info(`[job-manager] job ${job.jobId} completed successfully`)
    pushComplete({
      jobId: job.jobId,
      analysisId: job.analysisId,
      result: parsed.data,
      ...(typeof job.params['datasetId'] === 'string'
        ? { datasetId: job.params['datasetId'] }
        : {}),
      ...(job.source ? { source: job.source } : {}),
      ...(job.summary ? { summary: job.summary } : {}),
      ...(job.syntax ? { syntax: job.syntax } : {})
    })
  } catch (err) {
    if (isCancelled(job)) {
      log.info(`[job-manager] job ${job.jobId} was cancelled (error suppressed)`)
      pushError({ jobId: job.jobId, errorKey: 'common.analysisCancelled' })
      return
    }
    log.error(`[job-manager] job ${job.jobId} threw: ${String(err)}`)
    pushError({
      jobId: job.jobId,
      errorKey: 'error.rScriptFailed',
      details: String(err)
    })
  } finally {
    runningJob = null
    runningAbortController = null
    job.onFinally?.()
  }
}

async function drainQueue(): Promise<void> {
  if (running) return
  const next = queue.shift()
  if (!next) return

  running = true
  try {
    await processJob(next)
  } finally {
    running = false
    // Schedule next tick so call stack can unwind
    if (queue.length > 0) {
      setImmediate(() => {
        void drainQueue()
      })
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Store the BrowserWindow reference so we can push events to the renderer. */
export function setJobManagerWindow(browserWin: BrowserWindow): void {
  win = browserWin
}

/** Enqueue a job and start draining if idle. */
export function enqueueJob(opts: {
  jobId: string
  analysisId: string
  scriptPath: string
  params: Record<string, unknown>
  source?: 'ai'
  summary?: string
  syntax?: string
  onResult?: (result: AnalysisResult) => Promise<void>
  onFinally?: () => void
}): void {
  const job: Job = {
    jobId: opts.jobId,
    analysisId: opts.analysisId,
    scriptPath: opts.scriptPath,
    params: opts.params,
    cancelled: false,
    source: opts.source,
    summary: opts.summary,
    syntax: opts.syntax,
    onResult: opts.onResult,
    onFinally: opts.onFinally
  }
  queue.push(job)
  log.info(`[job-manager] enqueued job ${job.jobId} (queue length: ${String(queue.length)})`)
  // Push an immediate progress event so a job waiting behind an already-running
  // one shows up in the Output queue right away instead of appearing to hang
  // silently until its turn comes (P1.10 — single-worker queue feedback).
  pushProgress({
    jobId: job.jobId,
    analysisId: job.analysisId,
    percent: 0,
    messageKey: 'progress.queued'
  })
  void drainQueue()
}

/** Mark a queued or running job as cancelled and kill the OS process if active. */
export function cancelJob(jobId: string): void {
  // Cancel if still in queue
  const queuedJob = queue.find(j => j.jobId === jobId)
  if (queuedJob) {
    queuedJob.cancelled = true
    log.info(`[job-manager] marked queued job ${jobId} as cancelled`)
  }
  // Flag + abort if it is the currently running job
  if (runningJob?.jobId === jobId) {
    runningJob.cancelled = true
    if (runningAbortController) {
      log.info(`[job-manager] aborting running job ${jobId}`)
      runningAbortController.abort()
    }
  }
  if (!queuedJob && runningJob?.jobId !== jobId) {
    log.warn(`[job-manager] cancelJob: job ${jobId} not found`)
  }
}

/**
 * App shutdown: abort the running analysis (kills its Rscript) and drop the
 * queue. The running job's cleanup is fired now — the process is about to exit,
 * so the async `finally` in processJob may never get to run it.
 */
export function cancelAllJobs(): void {
  for (const job of queue) job.cancelled = true
  if (runningJob) {
    runningJob.cancelled = true
    runningAbortController?.abort()
    const cleanup = runningJob.onFinally
    runningJob.onFinally = undefined
    cleanup?.()
  }
}
