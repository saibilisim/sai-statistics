// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies that the Output tab is embedded in the .sdf (output.json):
 *  1. File ▸ Save writes output.json into the .sdf and clears both dirty
 *     flags (window title loses its "*").
 *  2. File ▸ Open of that .sdf restores the Output tab (blocks + edits).
 *  3. Close guard: unsaved Output alone triggers the single "unsaved
 *     changes — save?" prompt (not the old "export as HTML?" one); Cancel
 *     keeps the window, Save persists the output and quits.
 * Builds its own fixture (a blank File ▸ New dataset) — no /tmp CSV needed.
 */
const fs = require('fs')
const path = require('path')
const AdmZip = require('adm-zip')
const { _electron } = require('@playwright/test')

const SDF_PATH = path.join(__dirname, '..', '..', 'tmp', 'e2e-sdf-output.sdf')

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
}

function readOutputJson() {
  const entry = new AdmZip(SDF_PATH).getEntry('output.json')
  return entry ? JSON.parse(entry.getData().toString('utf-8')) : null
}

const BLOCK = {
  id: 'e2e-block-1',
  analysisId: 'descriptives',
  titleKey: 'analysis.descriptives.title',
  timestamp: '2026-09-29T12:00:00.000Z',
  datasetName: 'e2e',
  result: {
    success: true,
    tables: [
      {
        titleKey: 'output.table.descriptives',
        columns: ['output.col.statistic', 'output.col.value'],
        rows: [['Mean', 42.5]],
        footnoteKey: null
      }
    ],
    plots: [],
    warnings: [],
    notes: []
  }
}

async function sendMenu(app, channel, ...args) {
  await app.evaluate(
    ({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows()[0].webContents.send(payload.channel, ...payload.args)
    },
    { channel, args }
  )
}

async function main() {
  fs.mkdirSync(path.dirname(SDF_PATH), { recursive: true })
  if (fs.existsSync(SDF_PATH)) fs.unlinkSync(SDF_PATH)

  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForFunction(() => window.__SAI_TEST__?.useDatasetStore.getState().datasetId)

  await app.evaluate(({ dialog }, sdfPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: sdfPath })
    globalThis.__e2eMsgBoxes = []
    globalThis.__e2eMsgBoxResponse = 2
    dialog.showMessageBoxSync = (_win, opts) => {
      globalThis.__e2eMsgBoxes.push(opts)
      return globalThis.__e2eMsgBoxResponse
    }
  }, SDF_PATH)

  // ── 1. Add a result + an edit, then File ▸ Save ────────────────────────
  await win.evaluate(block => {
    const out = window.__SAI_TEST__.useOutputStore.getState()
    out.addBlock(block)
    out.setTableEdits(block.id, 0, { transposed: true })
  }, BLOCK)
  assert(
    await win.evaluate(() => document.title.endsWith(' *')),
    'title shows * while Output dirty'
  )

  await sendMenu(app, 'menu:file:save')
  await win.waitForFunction(() => !window.__SAI_TEST__.useOutputStore.getState().dirty, null, {
    timeout: 15000
  })
  assert(fs.existsSync(SDF_PATH), '.sdf written')
  const saved = readOutputJson()
  assert(saved && saved.blocks.length === 1, 'output.json holds the block')
  assert(saved.edits[BLOCK.id].tables['0'].transposed === true, 'output.json holds the edit')
  assert(!(await win.evaluate(() => document.title.endsWith(' *'))), 'title clean after save')
  console.log('PASS save embeds output.json')

  // ── 2. Clear the Output, reopen the .sdf → Output restored ─────────────
  await win.evaluate(() => {
    window.__SAI_TEST__.useOutputStore.getState().clearAll()
  })
  // clearAll made Output dirty → Open asks first; answer "Discard" (1).
  await app.evaluate(() => {
    globalThis.__e2eMsgBoxResponse = 1
  })
  await sendMenu(app, 'menu:file:open', SDF_PATH)
  await win.waitForFunction(
    () => window.__SAI_TEST__.useOutputStore.getState().blocks.length === 1,
    null,
    { timeout: 15000 }
  )
  const restored = await win.evaluate(() => {
    const s = window.__SAI_TEST__.useOutputStore.getState()
    return { id: s.blocks[0].id, edits: s.edits, dirty: s.dirty }
  })
  assert(restored.id === BLOCK.id, 'restored block id')
  assert(restored.edits[BLOCK.id].tables['0'].transposed === true, 'restored edit')
  assert(restored.dirty === false, 'freshly opened Output is clean')
  console.log('PASS open restores Output')

  // ── 3. Close guard: Output-only change → single "save?" prompt ─────────
  await win.evaluate(id => {
    window.__SAI_TEST__.useOutputStore.getState().setBlockTitle(id, 'Renamed')
  }, BLOCK.id)
  await win.waitForTimeout(200) // let app:set-output-dirty reach Main
  const expected = await app.evaluate(() => globalThis.__e2eMsgBoxes.length)
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__e2eMsgBoxResponse = 2 // Cancel
    BrowserWindow.getAllWindows()[0].close()
  })
  await win.waitForTimeout(300)
  const boxes = await app.evaluate(() => globalThis.__e2eMsgBoxes)
  assert(boxes.length === expected + 1, 'close prompted once')
  const prompt = boxes[boxes.length - 1]
  assert(prompt.buttons.length === 3, 'Save/Discard/Cancel buttons')
  assert(!win.isClosed(), 'Cancel keeps the window open')
  console.log(`PASS close guard prompt: "${prompt.message}" [${prompt.buttons.join(' / ')}]`)

  // Save → renderer saves the .sdf, then quits.
  const closed = new Promise(resolve => app.on('close', resolve))
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__e2eMsgBoxResponse = 0
    BrowserWindow.getAllWindows()[0].close()
  })
  await Promise.race([
    closed,
    new Promise((_, reject) => setTimeout(() => reject(new Error('app did not quit')), 15000))
  ])
  const afterQuit = readOutputJson()
  assert(afterQuit.edits[BLOCK.id].titleOverride === 'Renamed', 'save-and-quit persisted output')
  console.log('PASS save-and-quit persists Output')

  assert(errors.length === 0, `no page errors: ${errors.join(' | ')}`)
  fs.unlinkSync(SDF_PATH)
  console.log('ALL PASS')
}

main().catch(err => {
  console.error('FAIL', err)
  process.exit(1)
})
