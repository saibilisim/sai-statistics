// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * win-console-interrupt.ts — a real Ctrl+C for the R console on Windows.
 *
 * Node's `proc.kill('SIGINT')` terminates a Windows process outright (there
 * are no POSIX signals), so Stop used to restart R and lose every object in
 * the session. R itself handles Ctrl+C like SIGINT — it interrupts the running
 * call, and `.sai_run` (r-scripts/_r_console.R) turns that into "Interrupted."
 * and keeps the session. The R session (Rscript.exe, no Rterm child — checked
 * 2026-10-21 with R 4.6.1) owns a hidden console, so a CTRL_C_EVENT can reach
 * it: a helper process attaches to that console and raises the event there.
 *
 * The helper is the system's own Windows PowerShell (Microsoft-signed, always
 * present) with a few kernel32 P/Invokes — no extra executable, which would be
 * unsigned and blocked by Smart App Control. It ignores the event itself
 * (SetConsoleCtrlHandler(NULL, TRUE)) before raising it.
 */

import { spawn } from 'child_process'
import { join } from 'path'
import log from 'electron-log'

const HELPER_TIMEOUT_MS = 8000

const script = (pid: number): string =>
  [
    "$sig = '",
    '[DllImport("kernel32.dll")] public static extern bool FreeConsole();',
    '[DllImport("kernel32.dll")] public static extern bool AttachConsole(uint p);',
    '[DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(System.IntPtr h, bool add);',
    '[DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint e, uint g);',
    "'",
    '$k = Add-Type -MemberDefinition $sig -Name K -Namespace SaiCtrlC -PassThru',
    '[void]$k::FreeConsole()',
    `if (-not $k::AttachConsole(${String(pid)})) { exit 2 }`,
    '[void]$k::SetConsoleCtrlHandler([System.IntPtr]::Zero, $true)',
    'if (-not $k::GenerateConsoleCtrlEvent(0, 0)) { exit 3 }',
    'Start-Sleep -Milliseconds 200',
    '[void]$k::FreeConsole()',
    'exit 0'
  ].join('\n')

/** Raises Ctrl+C in the console of `pid`. Resolves true when it was sent. */
export function sendConsoleCtrlC(pid: number): Promise<boolean> {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) {
    return Promise.resolve(false)
  }
  const exe = join(
    process.env['SystemRoot'] ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  // A PowerShell 7 parent's module path breaks 5.1's built-in modules
  // (Add-Type "not recognized") — let 5.1 build its own.
  const env = { ...process.env }
  delete env['PSModulePath']
  return new Promise(resolve => {
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    try {
      const helper = spawn(
        exe,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script(pid)],
        { shell: false, windowsHide: true, env, stdio: 'ignore' }
      )
      const timer = setTimeout(() => {
        helper.kill()
        finish(false)
      }, HELPER_TIMEOUT_MS)
      helper.on('error', err => {
        clearTimeout(timer)
        log.warn('[r-session] Ctrl+C helper failed to start:', err)
        finish(false)
      })
      helper.on('exit', code => {
        clearTimeout(timer)
        if (code !== 0) log.warn(`[r-session] Ctrl+C helper exited with ${String(code)}`)
        finish(code === 0)
      })
    } catch (err) {
      log.warn('[r-session] Ctrl+C helper failed:', err)
      finish(false)
    }
  })
}
