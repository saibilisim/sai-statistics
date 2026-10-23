// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the fill handle now drags in ALL FOUR directions (Excel parity) —
 * up, right, and left (down is covered by e2e-fill-shortcuts). Each uses a
 * single-cell source (plain copy) dragged past the source edge.
 *
 * Fixture: /tmp/sai-30.csv (ad[text], yas[num], puan[num]; 30 rows).
 */
const { _electron } = require('@playwright/test')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(800)

  const varInfo = await win.evaluate(async () => {
    const r = await window.api.file.import({ filePath: '/tmp/sai-30.csv' })
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
    return r.variables.map(v => v.colId)
  })
  await win.waitForTimeout(1200)

  const cell = (r, c) =>
    win.locator(`.ag-row[row-index="${r}"] .ag-cell[col-id="${varInfo[c]}"]`).first()
  const cellNum = async (r, c) => parseFloat((await cell(r, c).innerText()).trim())

  // Drag the fill handle of (fromR,fromC) to the centre of (toR,toC).
  const fillDrag = async (fromR, fromC, toR, toC) => {
    await cell(fromR, fromC).click()
    await win.waitForTimeout(120)
    const from = await cell(fromR, fromC).boundingBox()
    const to = await cell(toR, toC).boundingBox()
    await win.mouse.move(from.x + from.width - 3, from.y + from.height - 3)
    await win.mouse.down()
    await win.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 })
    await win.mouse.up()
    await win.waitForTimeout(350)
  }

  // ── UP: B5 (row4, yas=23) → drag handle up to B2 → B2..B4 = 23 ──────────
  await fillDrag(4, 1, 1, 1)
  const up = (await cellNum(1, 1)) === 23 && (await cellNum(3, 1)) === 23

  // ── RIGHT: B1 (row0, yas=19) → drag handle right to C1 → C1 = 19 ────────
  await fillDrag(0, 1, 0, 2)
  const right = (await cellNum(0, 2)) === 19

  // ── LEFT: C3 (row2, puan=71) → drag handle left to B3 → B3 = 71 ─────────
  await fillDrag(2, 2, 2, 1)
  const left = (await cellNum(2, 1)) === 71

  // ── TYPE GUARD: dragging a text cell (ad, A7) right into a numeric column
  //    (yas, B7) must be rejected — B7 keeps its value, not the string. ─────
  const b7before = await cellNum(6, 1) // yas row6 = 18 + (7%40) = 25
  await fillDrag(6, 0, 6, 1) // A7 (text "Kisi07") → B7 (numeric)
  const typeGuard = (await cellNum(6, 1)) === b7before

  const result = { up, right, left, typeGuard, b7before, errors }
  console.log('RESULT:' + JSON.stringify(result))
  const pass = up && right && left && typeGuard && errors.length === 0

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  if (!pass) {
    console.error('E2E FAILED')
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
