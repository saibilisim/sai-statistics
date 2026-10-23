// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: 200K-row soft-limit warning (K5.3, faz8-kalite-roadmap.md). Imports a
 * minimal (2-column) CSV just over the threshold and asserts the honest
 * info-box fires — title/message translated, row count interpolated, no
 * raw key leaks — and that importing does NOT block on it (the dialog is
 * fire-and-forget; file:import already resolved by the time we check). Also
 * checks a dataset AT the threshold does NOT trigger the warning. */
const fs = require('fs')
const { _electron } = require('@playwright/test')

const OVER_PATH = '/tmp/sai-e2e-200001.csv'
const AT_PATH = '/tmp/sai-e2e-200000.csv'

function writeCsv(path, rows) {
  const lines = ['a,b']
  for (let i = 0; i < rows; i++) lines.push(`${String(i)},${String(i * 2)}`)
  fs.writeFileSync(path, lines.join('\n') + '\n')
}

async function main() {
  writeCsv(OVER_PATH, 200_001)
  writeCsv(AT_PATH, 200_000)

  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  win.on('pageerror', err => {
    console.log('[pageerror]', err.message)
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)

  // Capture native message-box calls instead of letting them actually pop
  // (headless/xvfb) — records what would have been shown.
  const calls = await app.evaluateHandle(({ dialog }) => {
    const calls = []
    dialog.showMessageBox = async opts => {
      calls.push(opts)
      return { response: 0 }
    }
    return calls
  })

  // Just over the threshold: should warn.
  const overResult = await win.evaluate(
    path => window.api.file.import({ filePath: path }),
    OVER_PATH
  )
  await win.waitForTimeout(300)

  // At the threshold exactly: should NOT warn (rowCount > 200_000, not >=).
  const atResult = await win.evaluate(path => window.api.file.import({ filePath: path }), AT_PATH)
  await win.waitForTimeout(300)

  const callsSnapshot = await calls.jsonValue()
  console.log(JSON.stringify(callsSnapshot, null, 2))

  const overWarned = callsSnapshot.some(c => /200.?001|200,001/.test(c.message))
  const atWarned = callsSnapshot.some(c => /200.?000|200,000/.test(c.message))
  const noRawKeyLeak = callsSnapshot.every(
    c => !/^dialogs?\./.test(c.title) && !/^dialogs?\./.test(c.message)
  )
  const hasCount = callsSnapshot.some(c => !c.message.includes('{{count}}'))

  const pass =
    overResult.dataset.rowCount === 200_001 &&
    atResult.dataset.rowCount === 200_000 &&
    overWarned &&
    !atWarned &&
    noRawKeyLeak &&
    hasCount &&
    callsSnapshot.length === 1

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  fs.unlinkSync(OVER_PATH)
  fs.unlinkSync(AT_PATH)
  if (!pass) {
    console.error('E2E FAILED', {
      overWarned,
      atWarned,
      noRawKeyLeak,
      hasCount,
      callCount: callsSnapshot.length
    })
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
