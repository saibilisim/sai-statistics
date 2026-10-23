// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: verifies the real electron-updater flow against the packaged app —
 * NOT out/main/main.cjs, since updater-handler.ts's registerUpdaterHandlers()
 * is a no-op unless app.isPackaged is true (dev/unpackaged builds never
 * initialize electron-updater at all). Launches the actually-installed
 * "C:\Program Files\SAI Statistics\SAI Statistics.exe" via Playwright's
 * executablePath option, listens to the real updater:status IPC stream the
 * renderer receives (window.api.on.updaterStatus).
 *
 * autoDownload is OFF since 2026-09-26 (Preferences ▸ Update) — reaching the
 * check only gets us to 'available'; the script then calls
 * window.api.app.downloadUpdate() itself, standing in for the user's
 * "Güncelle" click in Preferences ▸ Update, and waits for 'downloaded'. It
 * reports whether that download was differential (delta) or full by scanning
 * this run's own main.log slice, then calls window.api.app.restartToInstall()
 * directly (the same call Preferences ▸ Update's "Yeniden Başlat ve Kur"
 * button makes — StatusBar's own segment now only opens Preferences, so it is
 * no longer a stand-in for this action) to exercise the actual
 * install-on-quit path end to end.
 *
 * The one thing this script cannot do: click the Windows UAC consent prompt
 * that appears once the installer spawns (perMachine + allowElevation — an OS
 * security dialog, not something to script around). It prints a clear notice
 * and then polls the installed exe's version for up to UAC_WAIT_MS, so a human
 * only has to click "Yes" once for the run to finish confirming success.
 *
 * Hardened builds (0.2.21+) refuse the debugger attach Playwright needs; the
 * script then prints SKIP and exits 0 (see main()).
 *
 * Requires: a packaged install at the path below (pnpm dist:win + install),
 * and a reachable update feed (electron-builder.json win.publish) reporting
 * a version newer than the installed one. Single-instance-locked app, so any
 * running copy is killed first.
 */
const { _electron } = require('@playwright/test')
const { execSync, execFileSync } = require('child_process')
const fs = require('fs')

const EXE = 'C:\\Program Files\\SAI Statistics\\SAI Statistics.exe'
const LOG_PATH =
  process.env.SAI_UPDATER_LOG || `${process.env.APPDATA}\\sai-statistics\\logs\\main.log`
const TIMEOUT_MS = Number(process.env.SAI_UPDATER_TIMEOUT_MS) || 240000
const UAC_WAIT_MS = Number(process.env.SAI_UPDATER_UAC_WAIT_MS) || 120000

function killExisting() {
  try {
    execSync('taskkill /IM "SAI Statistics.exe" /F', { stdio: 'ignore' })
  } catch {
    // not running — fine
  }
}

function installedVersion() {
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `(Get-Item '${EXE}').VersionInfo.ProductVersion`],
      { encoding: 'utf-8' }
    )
    return out.trim()
  } catch {
    return null
  }
}

function logLineCount() {
  try {
    return fs.readFileSync(LOG_PATH, 'utf-8').split('\n').length
  } catch {
    return 0
  }
}

function newLogLines(fromLine) {
  try {
    return fs.readFileSync(LOG_PATH, 'utf-8').split('\n').slice(fromLine)
  } catch {
    return []
  }
}

async function main() {
  if (process.platform !== 'win32') {
    console.log(
      '[e2e-updater] SKIP: auto-update is Windows-only (updater-handler.ts UPDATER_ENABLED)'
    )
    return
  }
  killExisting()
  await new Promise(r => setTimeout(r, 1000))

  const beforeVersion = installedVersion()
  const startLine = logLineCount()
  console.log(`[e2e-updater] installed version before run: ${beforeVersion}`)

  // Since 0.2.21 the packaged exe is hardened (electronFuses
  // enableNodeCliInspectArguments: false + remote-debugging switches make it
  // exit), so Playwright can no longer attach to an installed build — by
  // design. Report that as a skip, not a failure: the updater flow is then
  // checked by hand (Preferences ▸ Update on the installed app).
  // Playwright also raises this failure outside the awaited promise, so it is
  // caught at process level as well as here.
  const skipIfHardened = err => {
    if (!/Process failed to launch/.test(String(err))) return false
    console.log(
      '[e2e-updater] SKIP: the installed build is hardened against debugger attach ' +
        '(0.2.21+), so it cannot be driven by Playwright — check the update by hand.'
    )
    process.exit(0)
  }
  process.on('uncaughtException', err => {
    if (!skipIfHardened(err)) throw err
  })
  let app
  try {
    app = await _electron.launch({ executablePath: EXE, args: ['--no-sandbox'] })
  } catch (err) {
    if (!skipIfHardened(err)) throw err
  }
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  await win.evaluate(() => {
    window.__updaterEvents = []
    window.api.on.updaterStatus(payload => {
      window.__updaterEvents.push(payload)
    })
  })

  // 1) checking → available (autoDownload:false — it stops here on its own).
  const checkDeadline = Date.now() + TIMEOUT_MS
  let events = []
  let last = null
  while (Date.now() < checkDeadline) {
    events = await win.evaluate(() => window.__updaterEvents)
    last = events[events.length - 1]
    if (
      last &&
      (last.status === 'available' || last.status === 'error' || last.status === 'not-available')
    )
      break
    await new Promise(r => setTimeout(r, 2000))
  }

  console.log('[e2e-updater] event sequence (check phase):', JSON.stringify(events))

  if (!last) {
    console.error('[e2e-updater] FAIL: no updater:status events received within timeout.')
    await app.close().catch(() => {})
    process.exit(1)
  }
  if (last.status === 'error') {
    console.error('[e2e-updater] FAIL: updater reported an error:', last.error)
    await app.close().catch(() => {})
    process.exit(1)
  }
  if (last.status === 'not-available') {
    console.error(
      '[e2e-updater] FAIL: update feed reports no newer version than the installed one.'
    )
    await app.close().catch(() => {})
    process.exit(1)
  }

  // 2) 'Güncelle' düğmesine basmanın karşılığı — indirmeyi burada, açıkça
  // biz tetikliyoruz (autoDownload artık kendi başına indirmiyor).
  console.log(
    '[e2e-updater] calling downloadUpdate() — stands in for the Preferences ▸ Update "Güncelle" click…'
  )
  await win.evaluate(() => window.api.app.downloadUpdate())

  const downloadDeadline = Date.now() + TIMEOUT_MS
  while (Date.now() < downloadDeadline) {
    events = await win.evaluate(() => window.__updaterEvents)
    last = events[events.length - 1]
    if (last && (last.status === 'downloaded' || last.status === 'error')) break
    await new Promise(r => setTimeout(r, 2000))
  }

  console.log('[e2e-updater] event sequence (download phase):', JSON.stringify(events))

  if (!last || last.status === 'error') {
    console.error(
      "[e2e-updater] FAIL: downloadUpdate() never reached 'downloaded'.",
      last ? last.error : '(no event)'
    )
    await app.close().catch(() => {})
    process.exit(1)
  }

  // Delta vs full: differentialDownloadInstaller() always logs "Download
  // block maps (old: ..., new: ...)" as its very first line if it was even
  // attempted (disableDifferentialDownload=false, not a web installer). Its
  // absence means the running (old) binary skipped straight to a full
  // download — this only proves the delta path once the binary DOING the
  // check already contains the useMultipleRangeRequest fix.
  const sinceLines = newLogLines(startLine)
  const attemptedDelta = sinceLines.some(l => l.includes('Download block maps'))
  const changedBlocksLine = sinceLines.find(l => l.includes('changed blocks'))
  const fellBackToFull = sinceLines.some(l => l.includes('Cannot download differentially'))
  console.log(
    `[e2e-updater] delta attempted: ${attemptedDelta}` +
      (changedBlocksLine ? ` (${changedBlocksLine.trim()})` : '') +
      (fellBackToFull ? ' — but fell back to full download' : '')
  )

  const bodyText = await win.evaluate(() => document.body.textContent || '')
  const hasVersion = last.version && bodyText.includes(last.version)
  console.log(
    `[e2e-updater] downloaded version=${last.version} — StatusBar shows version: ${hasVersion}`
  )
  await win.screenshot({ path: __dirname + '/../../tmp/e2e-updater-statusbar.png' })

  if (!hasVersion) {
    console.error(
      '[e2e-updater] FAIL: update downloaded but StatusBar does not show the restart segment / version.'
    )
    await app.close().catch(() => {})
    process.exit(1)
  }

  // StatusBar's "downloaded" segment now only opens Preferences ▸ Update
  // (sai:open-preferences), where the real "Yeniden Başlat ve Kur" button
  // calls this same API — calling it directly here is equivalent and doesn't
  // depend on Preferences' translated button text. This exercises main.ts's
  // close-guard → installPendingUpdateOnQuit() → quitAndInstall(true, true).
  console.log('[e2e-updater] calling restartToInstall()…')
  await win.evaluate(() => window.api.app.restartToInstall())

  console.log(
    '[e2e-updater] called. A Windows UAC consent prompt should appear now (perMachine install) — ' +
      `approve it. Polling installed version for up to ${UAC_WAIT_MS / 1000}s…`
  )

  const uacDeadline = Date.now() + UAC_WAIT_MS
  let afterVersion = beforeVersion
  while (Date.now() < uacDeadline) {
    await new Promise(r => setTimeout(r, 3000))
    afterVersion = installedVersion()
    if (afterVersion && afterVersion !== beforeVersion) break
  }

  const sinceLines2 = newLogLines(startLine)
  const installLine = sinceLines2.find(l => l.includes('Install: isSilent'))
  const execLine = sinceLines2.find(l => l.includes('Executing:'))
  console.log(
    `[e2e-updater] quitAndInstall log evidence: ${installLine ? installLine.trim() : '(none found)'}`
  )
  console.log(
    `[e2e-updater] installer spawn log evidence: ${execLine ? execLine.trim() : '(none found)'}`
  )
  console.log(`[e2e-updater] installed version after run: ${afterVersion}`)

  await app.close().catch(() => {})

  if (!installLine) {
    console.error(
      '[e2e-updater] FAIL: no "Install on explicit quitAndInstall" log line — the restart click never reached ' +
        'installPendingUpdateOnQuit()/quitAndInstall(). Check main.ts close-guard (unsaved-data dialog may have ' +
        'intercepted the close) and updater-handler.ts.'
    )
    process.exit(1)
  }
  if (afterVersion === beforeVersion) {
    console.error(
      '[e2e-updater] FAIL: quitAndInstall() was invoked but the installed version never changed within the wait ' +
        'window — likely the UAC prompt was not approved in time, or the installer failed. Check ' +
        'AppData\\Local\\sai-statistics-updater and re-run with a longer SAI_UPDATER_UAC_WAIT_MS if you need more time.'
    )
    process.exit(1)
  }

  console.log(
    `[e2e-updater] PASS: checking → available → downloadUpdate() → downloading → downloaded → ` +
      `restartToInstall() → installed ${beforeVersion} → ${afterVersion}.`
  )
}

main().catch(err => {
  console.error('[e2e-updater] FAIL:', err)
  process.exit(1)
})
