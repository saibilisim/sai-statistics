// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Output reads top to bottom (2026-10-18): results from every source land at
 * the END of the document, in the order they were produced, and the view
 * scrolls to them. A heading from the toolbar's Insert menu goes to the end
 * too. Uses the R console (sai_show) and an SPSS-syntax run as sources.
 */
const path = require('path')
const { _electron } = require('@playwright/test')

const results = []
function check(cond, msg) {
  results.push({ ok: !!cond, msg })
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`)
}

async function main() {
  const appDir = path.join(__dirname, '..', '..')
  const app = await _electron.launch({ args: ['out/main/main.cjs', '--no-sandbox'], cwd: appDir })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(800)

  const iris = path.join(appDir, 'resources', 'sample-data', 'iris.csv')
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
    window.__SAI_TEST__.useUIStore.getState().setActiveTab('terminal')
    window.__SAI_TEST__.useTerminalStore.getState().setMode('r')
  }, iris)

  const store = () =>
    win.evaluate(() => {
      const o = window.__SAI_TEST__.useOutputStore.getState()
      return {
        status: window.__SAI_TEST__.useTerminalStore.getState().rStatus,
        items: o.items.map(i => i.id),
        newest: o.blocks[0] ? o.blocks[0].id : null
      }
    })
  const until = async (fn, ms) => {
    const end = Date.now() + ms
    for (;;) {
      const v = await fn()
      if (v || Date.now() > end) return v
      await win.waitForTimeout(250)
    }
  }
  check(await until(async () => (await store()).status === 'idle', 40000), 'R session ready')

  const sendR = async code => {
    const before = (await store()).items.length
    await win.evaluate(c => window.api.terminal.rWrite({ code: c }), code)
    await until(async () => (await store()).items.length > before, 15000)
  }
  await sendR('sai_show(head(iris, 2), "birinci")')
  await sendR('sai_show(tail(iris, 2), "ikinci")')
  const afterR = await store()
  check(afterR.items.length === 2, `two R tables in Output (${afterR.items.length})`)

  // An SPSS-syntax analysis afterwards.
  const beforeSyntax = afterR.items.length
  await win.evaluate(() => {
    const t = window.__SAI_TEST__.useTerminalStore.getState()
    t.setMode('spss')
    t.setSource('DESCRIPTIVES VARIABLES=Sepal_Length.')
  })
  await win.waitForTimeout(300)
  await win.locator('[class*="subToolbar"]').first().locator('button[class*="primary"]').click()
  check(
    await until(async () => (await store()).items.length > beforeSyntax, 30000),
    'SPSS-syntax analysis added to Output'
  )
  const s = await store()
  // Newest (blocks[0]) is the LAST document item: the document is chronological.
  check(s.items[s.items.length - 1] === s.newest, 'the newest result is at the end of the document')

  await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('output'))
  await win.waitForTimeout(600)
  // DOM order of the rendered items equals the store's (chronological) order.
  const domIds = await win.$$eval('[id^="block-"], [id^="item-"]', els =>
    els.map(e => e.id.replace(/^(block|item)-/, ''))
  )
  const blockIds = domIds.filter(id => s.items.includes(id))
  check(
    JSON.stringify(blockIds) === JSON.stringify(s.items),
    `view shows results top to bottom (${blockIds.join(',')})`
  )
  const titles = await win.$$eval('[id^="block-"]', els => els.map(e => e.textContent || ''))
  const iFirst = titles.findIndex(t => t.includes('birinci'))
  const iSecond = titles.findIndex(t => t.includes('ikinci'))
  check(iFirst >= 0 && iFirst < iSecond, 'the earlier R table is above the later one')

  // Insert ▸ Heading from the toolbar → at the end.
  await win
    .locator('button', { hasText: /^\s*(Ekle|Insert)\s*$/ })
    .first()
    .click()
  await win.locator('[role="menuitem"]', { hasText: /^(Başlık|Heading)$/ }).click()
  await win.waitForTimeout(300)
  const withHeading = await store()
  const last = withHeading.items[withHeading.items.length - 1]
  check(
    last !== s.newest && withHeading.items.length === s.items.length + 1,
    'Insert ▸ Heading goes to the end'
  )
  await win.screenshot({ path: path.join(appDir, 'tmp', 'output-order.png') })

  check(errors.length === 0, `no page errors ${errors.join(' | ')}`)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  const failed = results.filter(r => !r.ok)
  console.log(failed.length === 0 ? 'ALL PASS' : `${failed.length} FAILED`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
