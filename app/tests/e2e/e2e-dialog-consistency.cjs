// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies that data dialogs (DialogBase + DataDialogs) and analysis dialogs
 * (AnalysisDialogShell) render the same frame, list, target box and buttons —
 * all of them compose DialogFrame / DialogFields / DialogButtons.module.css.
 *
 * Opens Data ▸ Weight Cases and Analyze ▸ Frequencies on the bundled iris
 * sample, reads the computed style of each shared part and asserts the two
 * dialogs match. Screenshots land in tmp/dialog-*.png for a visual check.
 * Needs no fixture — sample data ships in resources/sample-data.
 */
const path = require('path')
const { _electron } = require('@playwright/test')

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
}

const FRAME_PROPS = ['borderTopLeftRadius', 'borderTopWidth', 'boxShadow', 'backgroundColor']
const HEADER_PROPS = ['paddingTop', 'paddingLeft', 'backgroundColor', 'borderBottomWidth']
const TITLE_PROPS = ['fontSize', 'fontWeight']
const LIST_PROPS = ['borderTopLeftRadius', 'borderTopWidth', 'borderTopColor', 'backgroundColor']
// No border colour: the analysis dialog's first target box opens "active"
// (accent border) by design — a state, not a style difference.
const ZONE_PROPS = ['borderTopLeftRadius', 'borderTopWidth', 'backgroundColor']
const ITEM_PROPS = ['paddingTop', 'paddingLeft', 'fontSize']
const BTN_PROPS = ['borderTopLeftRadius', 'borderTopWidth', 'paddingTop', 'paddingLeft', 'fontSize']

async function measure(win, sel) {
  return win.evaluate(
    ({ sel, props }) => {
      const dlg = document.querySelector('[role="dialog"]')
      if (!dlg) return null
      const frame = dlg.firstElementChild
      const pick = (el, keys) => {
        if (!el) return null
        const cs = getComputedStyle(el)
        return Object.fromEntries(keys.map(k => [k, cs[k]]))
      }
      const list = frame.querySelector('[role="listbox"]')
      const item = list && list.querySelector('[role="option"]')
      return {
        frame: pick(frame, props.FRAME_PROPS),
        header: pick(frame.firstElementChild, props.HEADER_PROPS),
        title: pick(frame.firstElementChild.firstElementChild, props.TITLE_PROPS),
        list: pick(list, props.LIST_PROPS),
        item: pick(item, props.ITEM_PROPS),
        zone: pick(frame.querySelector(sel.zone), props.ZONE_PROPS),
        btn: pick(frame.lastElementChild.querySelector('button'), props.BTN_PROPS)
      }
    },
    {
      sel,
      props: {
        FRAME_PROPS,
        HEADER_PROPS,
        TITLE_PROPS,
        LIST_PROPS,
        ZONE_PROPS,
        ITEM_PROPS,
        BTN_PROPS
      }
    }
  )
}

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..')
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(800)

  const iris = path.join(__dirname, '..', '..', 'resources', 'sample-data', 'iris.csv')
  await win.evaluate(async filePath => {
    const r = await window.api.file.import({ filePath })
    window.__SAI_TEST__.useDatasetStore
      .getState()
      .setDataset(
        r.dataset.id,
        r.dataset.name,
        r.dataset.filePath,
        r.variables,
        r.dataset.rowCount,
        r.styles
      )
  }, iris)
  await win.waitForTimeout(1000)

  const send = channel =>
    app.evaluate(({ BrowserWindow }, ch) => {
      BrowserWindow.getAllWindows()[0].webContents.send(ch)
    }, channel)

  // ── Data ▸ Weight Cases ──
  await send('menu:data:weight-cases')
  await win.waitForSelector('[role="dialog"] [role="listbox"] [role="option"]', { timeout: 10000 })
  await win.waitForTimeout(400) // open animation
  const data = await measure(win, { zone: '[class*="targetBox"]' })
  await win.screenshot({ path: path.join(__dirname, '..', '..', 'tmp', 'dialog-weight-cases.png') })
  await win.keyboard.press('Escape')
  await win.waitForSelector('[role="dialog"]', { state: 'detached' })

  // ── Analyze ▸ Frequencies ──
  await send('menu:analyze:frequencies')
  await win.waitForSelector('[role="dialog"] [role="listbox"] [role="option"]', { timeout: 10000 })
  await win.waitForTimeout(400)
  const analysis = await measure(win, { zone: '[class*="fieldZone"]' })
  await win.screenshot({ path: path.join(__dirname, '..', '..', 'tmp', 'dialog-frequencies.png') })
  await win.keyboard.press('Escape')

  for (const part of ['frame', 'header', 'title', 'list', 'item', 'zone', 'btn']) {
    const a = JSON.stringify(data[part])
    const b = JSON.stringify(analysis[part])
    assert(data[part] && analysis[part], `${part} found in both dialogs (data=${a}, analysis=${b})`)
    assert(a === b, `${part} differs\n  data:     ${a}\n  analysis: ${b}`)
    console.log(`PASS ${part} ${a}`)
  }

  assert(errors.length === 0, `page errors: ${errors.join(' | ')}`)
  await app.close()
  console.log('ALL PASS')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
