// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * r-bridge.ts — R process detection and script execution.
 *
 * Responsibilities:
 * - Find a usable Rscript binary (bundled runtime first, then system PATH)
 * - Expose `initRBridge()` for app startup
 * - Expose `runRScript()` for analysis execution (called by job-manager)
 * - Emit status events so the renderer can display R availability
 */

import { app } from 'electron'
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir, devNull, homedir } from 'os'
import { privateTmpDir } from '../private-tmp'
import { randomUUID, createHash } from 'crypto'
import log from 'electron-log'
import type { RStatus, RStatusPayload } from '../../shared/ipc-contracts'
import { ALLOWED_PACKAGE_NAMES, CRAN_SNAPSHOT } from '../../shared/optional-packages'
import {
  moveLegacyPackages,
  packagesToCarryOver,
  rMinor,
  userRLibDir as userRLibDirFor,
  userRLibRoot
} from './r-user-library'

const execFileAsync = promisify(execFile)

// ─── State ────────────────────────────────────────────────────────────────────

let rscriptPath: string | null = null
/** Root of the vendored runtime (resourcesPath/r-runtime) when bundled R is in use, else null. */
let bundledRRoot: string | null = null
let rVersion: string | undefined
let currentStatus: RStatus = 'starting'
const statusListeners = new Set<(payload: RStatusPayload) => void>()

// ─── Internal helpers ─────────────────────────────────────────────────────────

function emitStatus(status: RStatus, version?: string): void {
  currentStatus = status
  rVersion = version
  const payload: RStatusPayload = { status, version }
  for (const cb of statusListeners) {
    cb(payload)
  }
}

/**
 * Where the vendored runtime lives. Packaged: extraResources put it at
 * resourcesPath/r-runtime. Unpackaged: it is still in the source tree under
 * resources/, named per platform by scripts/vendor-r-runtime.*.
 *
 * Dev used to skip this entirely and fall through to the system PATH, so
 * `pnpm dev` reported "R is not available" on a machine without R on PATH even
 * though a complete R sat in the repo. That also meant development exercised a
 * DIFFERENT code path than the shipped app — no withBundledRPath, no bundled
 * library — which is exactly the divergence that let a runtime missing R's
 * recommended packages ship unnoticed.
 */
function bundledRRoots(): string[] {
  if (app.isPackaged) return [join(process.resourcesPath, 'r-runtime')]
  const devName =
    process.platform === 'win32'
      ? 'r-runtime-win'
      : process.platform === 'darwin'
        ? 'r-runtime-mac'
        : 'r-runtime'
  // app.getAppPath() is out/main in an electron-vite dev/build run, not the
  // app directory, so the source-tree runtime is two levels up. cwd covers
  // the usual `pnpm dev` / script invocations; both are tried because neither
  // is guaranteed on its own.
  const appPath = app.getAppPath()
  return [
    join(appPath, '..', '..', 'resources', devName),
    join(appPath, 'resources', devName),
    join(process.cwd(), 'resources', devName)
  ]
}

async function detectBundledR(): Promise<string | null> {
  for (const root of bundledRRoots()) {
    const found = await probeBundledRoot(root)
    if (found) return found
  }
  return null
}

async function probeBundledRoot(root: string): Promise<string | null> {
  // Layouts produced by scripts/vendor-r-runtime.*: the Linux/macOS scripts
  // install a relocatable wrapper at bin/Rscript. Windows: CRAN layout since
  // 0.2.23 (bin/x64/Rscript.exe — the real binary; CRAN's bin/Rscript.exe is
  // only a launcher that starts it as a CHILD, so killing it on cancel/timeout
  // would leave the actual R running), conda layout before (lib/R/bin/x64).
  // Both x64 builds self-locate R_HOME relative to R.dll.
  const candidates =
    process.platform === 'win32'
      ? [
          join(root, 'bin', 'x64', 'Rscript.exe'),
          join(root, 'lib', 'R', 'bin', 'x64', 'Rscript.exe'),
          join(root, 'bin', 'Rscript.exe')
        ]
      : [join(root, 'bin', 'Rscript')]
  for (const candidate of candidates) {
    try {
      // Windows has no RPATH: Rscript.exe resolves its DLLs (libblas, cairo, …
      // under Library/bin) via the DLL search path, so the probe itself needs
      // PATH prepended the same way withBundledRPath() does for real runs —
      // otherwise Rscript.exe fails to even start and this candidate is
      // wrongly rejected as "not found" although it's genuinely bundled.
      const probeEnv =
        process.platform === 'win32'
          ? (() => {
              const dirs = [dirname(candidate), join(root, 'Library', 'bin')]
              const pathKey =
                Object.keys(process.env).find(k => k.toLowerCase() === 'path') ?? 'PATH'
              return {
                ...process.env,
                [pathKey]: `${dirs.join(';')};${process.env[pathKey] ?? ''}`
              }
            })()
          : process.env
      await execFileAsync(candidate, ['--version'], { env: probeEnv })
      bundledRRoot = root
      return candidate
    } catch {
      // try next candidate
    }
  }
  return null
}

async function detectSystemR(): Promise<string | null> {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  const name = 'Rscript'
  try {
    const { stdout } = await execFileAsync(cmd, [name])
    const line = stdout.trim().split('\n')[0]?.trim()
    if (line) return line
  } catch {
    // Not found in PATH
  }
  return null
}

async function getRVersion(path: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(path, ['--version'], {
      env: withBundledRPath(process.env)
    })
    // Rscript --version prints to stderr on some platforms. Format also
    // varies: "R version 4.3.3 (…)" on Linux/macOS vs. the conda-forge
    // Windows build's "Rscript (R) version 4.3.3 (…)" — match on "version"
    // alone rather than the "R version" prefix so both are captured.
    const output = stdout || stderr
    const match = /version ([\d.]+)/.exec(output)
    return match?.[1] ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect R at startup. Emits status events as detection progresses.
 * Must be called once after app is ready.
 */
export async function initRBridge(): Promise<void> {
  emitStatus('starting')
  log.info('[r-bridge] Searching for Rscript…')

  const bundled = await detectBundledR()
  if (bundled) {
    rscriptPath = bundled
    const version = await getRVersion(bundled)
    log.info(`[r-bridge] Found bundled R: ${bundled} (${version})`)
    emitStatus('ready', version)
    return
  }

  const system = await detectSystemR()
  if (system) {
    rscriptPath = system
    const version = await getRVersion(system)
    log.info(`[r-bridge] Found system R: ${system} (${version})`)
    emitStatus('ready', version)
    return
  }

  log.warn('[r-bridge] Rscript not found on this system.')
  emitStatus('not-found')
}

/** Subscribe to R status changes. Returns an unsubscribe function. */
export function onRStatus(cb: (payload: RStatusPayload) => void): () => void {
  statusListeners.add(cb)
  // Immediately deliver current status to the new subscriber
  cb({ status: currentStatus, version: rVersion })
  return () => {
    statusListeners.delete(cb)
  }
}

export function isRReady(): boolean {
  return currentStatus === 'ready' && rscriptPath !== null
}

/**
 * Synchronous snapshot of the current status. `onRStatus`'s "deliver current
 * status on subscribe" only helps callers already registered in the *main*
 * process — the renderer's own subscription (App.tsx, via a `useEffect`) races
 * detection: if `initRBridge()` resolves before that effect mounts, the push
 * IPC event fires into a renderer that isn't listening yet and is lost,
 * leaving the UI on "starting" forever. Exposed as `r:get-status` (an invoke,
 * i.e. a pull) so the renderer can always fetch the true current value on
 * mount regardless of that race, in addition to subscribing for later changes.
 */
export function getCurrentRStatus(): RStatusPayload {
  return { status: currentStatus, version: rVersion }
}

export function getRscriptPath(): string | null {
  return rscriptPath
}

export function getRVersionString(): string | undefined {
  return rVersion
}

// ─── Script execution ─────────────────────────────────────────────────────────

export interface RunRScriptOptions {
  scriptPath: string
  params: Record<string, unknown>
  timeoutMs?: number
  onProgress?: (percent: number, messageKey: string) => void
  /** When aborted, the spawned Rscript process is killed immediately. */
  signal?: AbortSignal
}

export interface RunRScriptResult {
  stdout: string
  stderr: string
  exitCode: number
}

const PROGRESS_RE = /PROGRESS:(\d+):(.+)/

/**
 * Write params to a temp JSON file, spawn Rscript, collect output.
 * Rejects on timeout (killing the process).
 */
export async function runRScript(opts: RunRScriptOptions): Promise<RunRScriptResult> {
  const path = rscriptPath
  if (!path) {
    throw new Error('R is not available — Rscript not found')
  }

  const paramsFile = join(privateTmpDir(), `sai-params-${randomUUID()}.json`)

  try {
    await writeFile(paramsFile, JSON.stringify(opts.params), { encoding: 'utf8', mode: 0o600 })
    log.debug(`[r-bridge] params written to ${paramsFile}`)
  } catch (err) {
    throw new Error(`Failed to write R params file: ${String(err)}`)
  }

  return new Promise<RunRScriptResult>((resolve, reject) => {
    // --no-init-file: the user's ~/.Rprofile (R_PROFILE_USER) must not run inside
    // analyses — an options(contrasts=…)/digits change or a masked base function
    // would silently alter results (2026-10-10 audit). R_ENVIRON_USER → null device
    // does the same for ~/.Renviron while keeping the site Renviron that
    // --no-environ would also drop. The R console (r-session.ts) keeps both on
    // purpose: there the user's own profile is expected.
    const args = ['--no-save', '--no-restore', '--no-init-file', opts.scriptPath, paramsFile]
    log.info(`[r-bridge] spawn: ${path} ${args.join(' ')}`)

    const proc = spawn(path, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...rEnv(), R_ENVIRON_USER: devNull }
    })

    // Wire AbortSignal → process kill. The 'close' handler below resolves/rejects
    // normally after the process exits, so no special rejection path is needed here.
    if (opts.signal) {
      const abortHandler = (): void => {
        log.info('[r-bridge] AbortSignal fired — killing Rscript process')
        proc.kill('SIGTERM')
        setTimeout(() => {
          try {
            proc.kill('SIGKILL')
          } catch {
            /* already dead */
          }
        }, 3000)
      }
      if (opts.signal.aborted) {
        abortHandler()
      } else {
        opts.signal.addEventListener('abort', abortHandler, { once: true })
      }
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          proc.kill('SIGTERM')
          // Force kill after grace period
          setTimeout(() => {
            try {
              proc.kill('SIGKILL')
            } catch {
              // already dead
            }
          }, 3000)
        }, opts.timeoutMs)
      : null

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderr += text

      // Parse progress lines as they arrive
      if (opts.onProgress) {
        const lines = text.split('\n')
        for (const line of lines) {
          const m = PROGRESS_RE.exec(line.trim())
          if (m && m[1] !== undefined && m[2] !== undefined) {
            const percent = parseInt(m[1], 10)
            const key = m[2].trim()
            opts.onProgress(percent, key)
          }
        }
      }
    })

    proc.on('error', err => {
      if (timeout) clearTimeout(timeout)
      void unlink(paramsFile).catch(() => undefined)
      reject(new Error(`Failed to spawn Rscript: ${err.message}`))
    })

    proc.on('close', code => {
      if (timeout) clearTimeout(timeout)
      void unlink(paramsFile).catch(() => undefined)

      if (timedOut) {
        reject(new Error(`R script timed out after ${String(opts.timeoutMs)}ms`))
        return
      }

      const exitCode = code ?? 1
      log.info(`[r-bridge] script exited with code ${String(exitCode)}`)
      resolve({ stdout, stderr, exitCode })
    })
  })
}

// ─── Optional package management ──────────────────────────────────────────────

/**
 * User R library directory (writable without sudo) — install target. One
 * folder per R minor version (~/R/library/4.3), see r-user-library.ts.
 */
/** The user library for the detected R version (installs land here). */
export function userRLibDir(): string {
  return userRLibDirFor(rVersion)
}

/**
 * R_LIBS for every R child process (scripts, package checks/installs, console).
 *
 * Order matters: R searches R_LIBS entries before its own .Library, so with
 * ~/R/library/<ver> first a package the user installed there (older/newer version,
 * or a planted one) silently replaced the bundled copy that tests/r-validation
 * verified. The bundled runtime's library therefore goes first (2026-10-10
 * audit); ~/R/library still follows so packages the user installed there (R
 * terminal Packages pane) stay visible. R_LIBS, not R_LIBS_USER — R_LIBS_USER would *replace* R's default
 * personal library (~/R/<platform>-library/<version>), hiding packages the
 * user installed via plain R (e.g. nortest → Normality silently loses its
 * Lilliefors correction). With system R (no bundled root) only the user
 * library is prepended, as before.
 */
export function rLibsValue(): string {
  const sep = process.platform === 'win32' ? ';' : ':'
  const existing = process.env['R_LIBS'] ?? ''
  return [
    ...(bundledRRoot ? [bundledRLibrary(bundledRRoot)] : []),
    userRLibDir(),
    ...(existing ? [existing] : [])
  ].join(sep)
}

/** The runtime's own library: CRAN layout <root>/library (Windows since
 *  0.2.23), conda layout <root>/lib/R/library (Linux/macOS, older Windows). */
function bundledRLibrary(root: string): string {
  const cran = join(root, 'library')
  return existsSync(join(cran, 'base')) ? cran : join(root, 'lib', 'R', 'library')
}

/**
 * Environment for every R child process (scripts, package checks/installs,
 * console): library order (rLibsValue), the bundled runtime's DLL dirs, and a
 * fixed text collation. LC_COLLATE=C keeps sort order — category order in
 * tables, a string variable's minimum/maximum — the same on every machine:
 * CRAN R otherwise follows the Windows region setting (Turkish: "Şerife" <
 * "zeki", C: "zeki" < "Şerife"), so one dataset gave different tables on two
 * PCs. C is also what the conda runtimes used until 0.2.22, so results did not
 * change with the runtime switch (roadmap.md 2026-10-10).
 */
export function rChildEnv(): NodeJS.ProcessEnv {
  return withBundledRPath({ ...process.env, R_LIBS: rLibsValue(), LC_COLLATE: 'C' })
}

/**
 * rChildEnv + the home folder for non-interactive R (analyses, package
 * checks/installs). Without R_USER, Windows R works out "~" itself from the
 * Documents folder; on a customer PC under R 4.6.1 the result could not be
 * decoded and every analysis died in _bootstrap.R with "file name conversion
 * problem -- name too long?" (2026-10-11). Node's homedir() reaches R intact
 * (tested with a Turkish-character path) and is the same root
 * r-user-library.ts uses, so "~/R/library/<x.y>" now means one folder on both
 * sides. The R console (r-session.ts) keeps R's own "~": a user's .Rprofile
 * and history live there.
 */
function rEnv(): NodeJS.ProcessEnv {
  const env = rChildEnv()
  return process.platform === 'win32' ? { ...env, R_USER: homedir() } : env
}

/**
 * On Windows with the vendored conda runtime, prepend the runtime's DLL dirs
 * to PATH: Windows has no RPATH, so Rscript.exe finds its dependencies
 * (libblas, cairo, … under Library/bin) only via the DLL search path. No-op
 * for system R and on Linux/macOS, where the vendor scripts bake library
 * paths into their bin/Rscript wrapper instead.
 */
export function withBundledRPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (process.platform !== 'win32' || !bundledRRoot || !rscriptPath) return env
  const dirs = [dirname(rscriptPath), join(bundledRRoot, 'Library', 'bin')]
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH'
  return { ...env, [pathKey]: `${dirs.join(';')};${env[pathKey] ?? ''}` }
}

/**
 * Return installed-status for each package name (true = available to require).
 * Package names come from the shared allow-list; still passed via a temp R
 * expression with no shell interpolation.
 */
export async function checkRPackages(names: string[]): Promise<Record<string, boolean>> {
  const probed = await probeRPackages(names)
  return probed ?? Object.fromEntries(names.map(n => [n, false]))
}

/**
 * Like checkRPackages, but null when R's answer could not be read (R failed,
 * or printed nothing / something else). An unreadable answer used to count as
 * "every package missing": right after the 0.2.23 auto-update a user got the
 * setup dialog listing all 13 required packages — MASS included, which ships
 * inside R itself — while R itself was fine. Callers that act on "missing"
 * (setup dialog, carry-over reinstall) use this and do nothing on null.
 * One retry: the first R start after an install can stumble while the
 * antivirus is still scanning the freshly written runtime.
 */
export async function probeRPackages(names: string[]): Promise<Record<string, boolean> | null> {
  const path = rscriptPath
  // Build a safe R vector literal — names are allow-listed [a-zA-Z0-9.] only.
  const vec = names.filter(n => /^[A-Za-z][A-Za-z0-9.]*$/.test(n))
  if (!path || vec.length === 0) return null
  const expr =
    `cat("SAI_PKGS:", paste(sapply(c(${vec.map(n => `"${n}"`).join(',')}),` +
    ` function(p) requireNamespace(p, quietly=TRUE)), collapse=","), "\\n", sep="")`
  for (let attempt = 1; attempt <= 2; attempt++) {
    let out = ''
    try {
      const { stdout, stderr } = await execFileAsync(path, ['--vanilla', '-e', expr], {
        env: rEnv()
      })
      out = `${stdout}\n${stderr}`
      const flags = (/SAI_PKGS:([A-Z,]*)/.exec(stdout)?.[1] ?? '').split(',')
      if (flags.length === vec.length && flags.every(f => f === 'TRUE' || f === 'FALSE')) {
        return Object.fromEntries(vec.map((n, i) => [n, flags[i] === 'TRUE']))
      }
    } catch (err) {
      out = String(err)
    }
    log.warn(
      `[r-bridge] package check unreadable (attempt ${String(attempt)}): ${out.trim().slice(0, 1000)}`
    )
    if (attempt === 1) await new Promise(r => setTimeout(r, 3000))
  }
  return null
}

/** True when R comes from the runtime shipped inside the app (not a system R). */
export function isBundledR(): boolean {
  return bundledRRoot !== null && rscriptPath !== null
}

/** Is a command resolvable on PATH? */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [cmd])
    return true
  } catch {
    return false
  }
}

const CMAKE_VERSION = '3.28.3'
const CMAKE_SHA256: Record<'x86_64' | 'aarch64', string> = {
  x86_64: '804d231460ab3c8b556a42d2660af4ac7a0e21c98a7f8ee3318a74b4a9a187a6',
  aarch64: 'bbf023139f944cefe731d944f2864d8ea3ea0c4f9310b46ac72b3cb4e314b023'
}

/**
 * Ensure a CMake binary is reachable when building from source on Linux.
 * Several CRAN packages (e.g. nloptr → lme4) require CMake, which Linux boxes
 * often lack and which cannot be apt-installed without root. We drop a portable
 * official CMake build into the app's userData dir and return its bin path so
 * the install subprocess can find it. macOS/Windows install precompiled binary
 * packages and need no build tools at all.
 */
async function ensureLinuxBuildTools(): Promise<{ extraPath: string | null; warning?: string }> {
  if (process.platform !== 'linux') return { extraPath: null }

  // gcc / gfortran / make cannot be auto-installed without root — detect & warn.
  const missing: string[] = []
  for (const c of ['gcc', 'gfortran', 'make']) {
    if (!(await commandExists(c))) missing.push(c)
  }
  const warning = missing.length ? `missing-build-tools:${missing.join(',')}` : undefined

  if (await commandExists('cmake')) return { extraPath: null, warning }

  try {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
    const root = join(app.getPath('userData'), 'r-build-tools', `cmake-${CMAKE_VERSION}`)
    const binDir = join(root, 'bin')
    if (existsSync(join(binDir, 'cmake'))) return { extraPath: binDir, warning }

    await mkdir(root, { recursive: true })
    const releaseBase = `https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/`
    const fileName = `cmake-${CMAKE_VERSION}-linux-${arch}.tar.gz`
    const url = releaseBase + fileName
    log.info(`[r-bridge] bootstrapping portable CMake from ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`CMake download HTTP ${String(res.status)}`)
    const tarBuf = Buffer.from(await res.arrayBuffer())

    // Verify against the pinned hash before extracting anything (taken from
    // Kitware's cmake-<ver>-SHA-256.txt; update it together with
    // CMAKE_VERSION). Pinned rather than fetched, so a compromised release
    // host can't serve matching bad files for both. Fail closed: a mismatch
    // aborts the bootstrap (caught below → cmake stays "unavailable" rather
    // than silently trusting an unverified binary).
    const expectedHash = CMAKE_SHA256[arch]
    const actualHash = createHash('sha256').update(tarBuf).digest('hex')
    if (actualHash !== expectedHash) {
      throw new Error(
        `CMake tarball checksum mismatch (expected ${expectedHash}, got ${actualHash}) — aborting`
      )
    }

    const tarPath = join(tmpdir(), `cmake-${randomUUID()}.tar.gz`)
    await writeFile(tarPath, tarBuf)
    await execFileAsync('tar', ['xzf', tarPath, '-C', root, '--strip-components=1'])
    await unlink(tarPath).catch(() => undefined)
    if (!existsSync(join(binDir, 'cmake'))) throw new Error('CMake extraction failed')
    return { extraPath: binDir, warning }
  } catch (err) {
    log.warn(`[r-bridge] CMake bootstrap failed: ${String(err)}`)
    return { extraPath: null, warning: warning ? `${warning};cmake` : 'cmake' }
  }
}

/**
 * Install one package into the user's R library. Requires internet.
 *   - macOS / Windows: install.packages downloads precompiled binaries (no tools)
 *   - Linux: builds from source; we first bootstrap a portable CMake so heavy
 *     deps (nloptr/lme4) compile without manual setup.
 * Caller must ensure `name` is allow-listed (validated at the IPC boundary).
 */
// One install at a time: the background carry-over after an R upgrade
// (migrateUserRLibrary), a runtime repair and an install the user starts (R
// terminal Packages pane, setup dialog) would otherwise write the same library
// concurrently and trip over each other's 00LOCK directories.
let installQueue: Promise<unknown> = Promise.resolve()

export function installRPackage(name: string): Promise<{ success: boolean; detail?: string }> {
  const run = installQueue.then(() => installRPackageNow(name))
  installQueue = run.catch(() => undefined)
  return run
}

async function installRPackageNow(name: string): Promise<{ success: boolean; detail?: string }> {
  const path = rscriptPath
  if (!path) return { success: false, detail: 'Rscript not found' }
  if (!/^[A-Za-z][A-Za-z0-9.]*$/.test(name))
    return { success: false, detail: 'Invalid package name' }

  const tools = await ensureLinuxBuildTools()
  const env = rEnv()
  if (tools.extraPath) {
    env['PATH'] = `${tools.extraPath}:${env['PATH'] ?? process.env['PATH'] ?? ''}`
  }

  // R string literals treat backslash as an escape char, so a raw Windows path
  // (C:\Users\...) embedded here can throw "invalid \U escape" — forward
  // slashes work fine in R on Windows too (same fix as db-handler.ts's
  // parquetPath-in-R-expr sites).
  const userLib = userRLibDir().replace(/\\/g, '/')
  // type="binary" forces precompiled binaries on Windows/macOS (alias for
  // win.binary / mac.binary; on Linux it is equivalent to "source"). Without
  // it the default "both" prefers a newer SOURCE version of any pure-R
  // dependency whenever the binary repo lags CRAN — which is the permanent
  // state of the frozen binary repos for older R minor versions — and the
  // source build then fails without Rtools or on unresolved recursive deps
  // (observed 2026-08-10: broom/stringr/Rdpack/reformulas source builds broke
  // the geepack/lme4/mice installs).
  // Repository: the dated snapshot first (the versions the runtime was tested
  // with), live CRAN only if that fails — e.g. a platform/R version the
  // snapshot carries no binaries for — so an install never does worse than
  // before the snapshot existed.
  // Dependencies: every missing package in the WHOLE dependency tree is
  // requested explicitly. install.packages() only fills in the missing direct
  // dependencies of what it installs, so when one download failed earlier
  // (seen 2026-10-10: stringi, ~15 MB, lost to a network error while stringr
  // made it) every later install treated stringr as complete and BayesFactor
  // stayed unloadable for good. Listing the tree also repairs that state.
  const expr =
    `dir.create("${userLib}", recursive=TRUE, showWarnings=FALSE);` +
    // R drops library dirs that did not exist at startup, so a first install
    // into a fresh version folder must put it on the path itself.
    `.libPaths(c("${userLib}", .libPaths()));` +
    `for (repo in c("${CRAN_SNAPSHOT}", "https://cloud.r-project.org")) {` +
    ` ap <- tryCatch(available.packages(repos=repo, type="binary"), error=function(e) NULL);` +
    ` if (is.null(ap) || !("${name}" %in% rownames(ap))) next;` +
    ` deps <- tools::package_dependencies("${name}", db=ap, recursive=TRUE,` +
    `   which=c("Depends","Imports","LinkingTo"))[[1]];` +
    ` need <- intersect(c(setdiff(deps, rownames(installed.packages())), "${name}"), rownames(ap));` +
    ` try(install.packages(need, lib="${userLib}", repos=repo, type="binary"));` +
    ` if (requireNamespace("${name}", quietly=TRUE)) break };` +
    `if (!requireNamespace("${name}", quietly=TRUE)) quit(status=1)`
  log.info(
    `[r-bridge] installing R package "${name}" into ${userLib} (platform=${process.platform})`
  )
  try {
    await execFileAsync(path, ['--vanilla', '-e', expr], {
      env,
      timeout: 20 * 60 * 1000, // source builds (Linux) can be slow
      maxBuffer: 64 * 1024 * 1024
    })
    return { success: true, detail: tools.warning }
  } catch (err) {
    log.warn(`[r-bridge] installRPackage("${name}") failed: ${String(err)}`)
    const prefix = tools.warning ? `${tools.warning}; ` : ''
    return { success: false, detail: prefix + String(err) }
  }
}

/**
 * Keep the packages the user installed across an R version change, silently.
 * Runs once per launch after R detection, in the background:
 *   1. pre-0.2.22 flat ~/R/library → per-version folders (a rename, no download);
 *   2. allow-listed packages the user had under the previous R version but not
 *      under this one are reinstalled for this version, one by one.
 * Offline or a failed install is only logged — the package stays "not
 * installed" (the same state as before it was ever installed) and the next
 * launch tries again.
 */
export async function migrateUserRLibrary(): Promise<void> {
  const current = rMinor(rVersion)
  if (!rscriptPath || !current) return
  const root = userRLibRoot()
  try {
    const moved = await moveLegacyPackages(root)
    if (moved > 0)
      log.info(
        `[r-bridge] user library: moved ${String(moved)} package(s) into per-version folders`
      )
    const candidates = await packagesToCarryOver(root, current, ALLOWED_PACKAGE_NAMES)
    if (candidates.length === 0) return
    // Skip what this R already has elsewhere (bundled runtime, system/site library).
    const present = await probeRPackages(candidates)
    if (!present) return // unreadable answer — try again next launch, never reinstall all
    const missing = candidates.filter(p => !present[p])
    if (missing.length === 0) return
    log.info(`[r-bridge] user library: reinstalling for R ${current}: ${missing.join(', ')}`)
    for (const pkg of missing) {
      const r = await installRPackage(pkg)
      log.info(`[r-bridge] user library: ${pkg} → ${r.success ? 'ok' : 'failed'}`)
    }
  } catch (err) {
    log.warn(`[r-bridge] user library migration failed: ${String(err)}`)
  }
}
