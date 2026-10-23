// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the Output navigator's drag-to-reorder (pre-existing feature)
 * still works LIVE — the list reorders on dragover, while the drag is still
 * in progress, not only once drop fires — and that the FLIP-style slide
 * animation actually fires on the row(s) that shift position.
 *
 * No dataset/fixture needed — blocks are injected directly via
 * __SAI_TEST__.useOutputStore, same pattern as e2e-output-navigator.cjs.
 * Drag is simulated with manually-dispatched DragEvents (dragstart on the
 * source nav row, dragover on the target row) with a real DataTransfer,
 * matching what OutputView.tsx's onItemDragStart/onItemDragOver read from
 * the event — the same technique used successfully for the (now-reverted)
 * block-header drag test. dragstart/dragover and drop are dispatched in
 * separate page.evaluate() calls specifically so the order can be checked
 * mid-drag, before drop ever fires.
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
  await win.waitForTimeout(1000)

  await win.evaluate(() => {
    const T = window.__SAI_TEST__
    const mkResult = () => ({ success: true, tables: [], plots: [], warnings: [], notes: [] })
    ;['flip-test-1', 'flip-test-2', 'flip-test-3'].forEach((id, i) => {
      T.useOutputStore.getState().addBlock({
        id,
        analysisId: 'descriptives',
        titleKey: `E2E Flip Block ${i + 1}`,
        timestamp: new Date().toISOString(),
        datasetName: 'diag',
        result: mkResult()
      })
    })
    T.useUIStore.getState().setActiveTab('output')
  })
  await win.waitForTimeout(500)

  const itemOrder = () =>
    win.evaluate(() => window.__SAI_TEST__.useOutputStore.getState().items.map(it => it.id))

  const orderBefore = await itemOrder()

  // ── Step 1: dragstart + dragover onto block 1's row — drop is NOT fired
  // yet. If the reorder is live, `items` must already reflect the move here.
  await win.evaluate(() => {
    const findRow = title =>
      [...document.querySelectorAll('[class*="navItem"]')].find(
        n => n.textContent && n.textContent.includes(title)
      )
    const dragEl = findRow('E2E Flip Block 3')
    const dropEl = findRow('E2E Flip Block 1')
    if (!dragEl || !dropEl) throw new Error('nav row not found in DOM')
    window.__e2eDt = new DataTransfer()
    const fire = (type, el) => {
      el.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: window.__e2eDt })
      )
    }
    fire('dragstart', dragEl)
    fire('dragover', dropEl)
  })

  await win.waitForTimeout(40)
  const orderDuringDrag = await itemOrder()
  const idx3Before = orderBefore.indexOf('flip-test-3')
  const idx3DuringDrag = orderDuringDrag.indexOf('flip-test-3')
  const idx1DuringDrag = orderDuringDrag.indexOf('flip-test-1')
  const reorderedLiveBeforeDrop =
    idx3Before !== idx3DuringDrag && Math.abs(idx3DuringDrag - idx1DuringDrag) === 1

  // Mid-drag: at least one displaced row's wrapper should have an active
  // transform transition running — the animation's mid-flight signature.
  const animationFiredDuringDrag = await win.evaluate(() => {
    const wrappers = [...document.querySelectorAll('[class*="navItem"]')].map(
      el => el.parentElement
    )
    return wrappers.some(
      el => el && el.style.transition.includes('transform') && el.style.transform === ''
    )
  })

  // ── Step 2: now fire drop — should just finalize (no further reorder) ──
  await win.evaluate(() => {
    const dropEl = [...document.querySelectorAll('[class*="navItem"]')].find(
      n => n.textContent && n.textContent.includes('E2E Flip Block 1')
    )
    dropEl.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__e2eDt })
    )
  })
  await win.waitForTimeout(40)
  const orderAfterDrop = await itemOrder()
  const orderUnchangedByDrop = JSON.stringify(orderDuringDrag) === JSON.stringify(orderAfterDrop)

  // Let the transition finish and confirm inline styles were cleaned up
  // (transitionend handler resets them) rather than leaking permanently.
  await win.waitForTimeout(400)
  const stylesCleanedUp = await win.evaluate(() => {
    const wrappers = [...document.querySelectorAll('[class*="navItem"]')].map(
      el => el.parentElement
    )
    return wrappers.every(el => !el || el.style.transition === '')
  })

  const result = {
    orderBefore,
    orderDuringDrag,
    reorderedLiveBeforeDrop,
    animationFiredDuringDrag,
    orderAfterDrop,
    orderUnchangedByDrop,
    stylesCleanedUp,
    errors
  }
  console.log('RESULT:' + JSON.stringify(result, null, 2))

  const pass =
    reorderedLiveBeforeDrop &&
    animationFiredDuringDrag &&
    orderUnchangedByDrop &&
    stylesCleanedUp &&
    errors.length === 0

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
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
