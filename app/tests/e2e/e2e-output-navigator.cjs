// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the Output view features added this session:
 *   1. Auto output header — a run's "summary" line always shows under the
 *      block title; "syntax" is collapsed by default behind a toggle.
 *   2. Collapse All / Expand All toolbar buttons.
 *   3. Collapsed-block warning badge (only shown while collapsed).
 *   4. Output search — filters both the navigator and the content pane.
 *   5. Navigator click-to-select (SPSS-style) — bidirectional with the
 *      content pane, single selection replaces, no toggle-off.
 *   6. Navigator right-click ▸ Copy — a block copies its resolved table(s)
 *      to the clipboard; a heading item copies its text.
 *   7. Block header "Re-run" button — dispatches the analysis's menu
 *      channel, reopening its dialog (Dialog Recall code path).
 *
 * No dataset/fixture needed — blocks are injected directly via
 * __SAI_TEST__.useOutputStore, same pattern as diag-output-selection.cjs.
 */
const { _electron } = require('@playwright/test')
const { makeClipboard } = require('./e2e-clipboard.cjs')

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
    const result1 = {
      success: true,
      tables: [
        {
          titleKey: 'E2E Table',
          columns: ['A', 'B', 'C'],
          rows: [
            ['row0', 1, 1.5],
            ['row1', 2, 2.5]
          ],
          footnoteKey: null
        }
      ],
      plots: [],
      warnings: ['This is a test warning'],
      notes: []
    }
    T.useOutputStore.getState().addBlock({
      id: 'nav-test-1',
      analysisId: 'frequencies',
      titleKey: 'E2E Nav Test Block',
      timestamp: new Date().toISOString(),
      datasetName: 'diag',
      result: result1,
      summary: 'Variable(s): age, gender',
      syntax: 'FREQUENCIES VARIABLES=age gender.'
    })
    const result2 = { success: true, tables: [], plots: [], warnings: [], notes: [] }
    T.useOutputStore.getState().addBlock({
      id: 'nav-test-2',
      analysisId: 'descriptives',
      titleKey: 'E2E Second Block',
      timestamp: new Date().toISOString(),
      datasetName: 'diag',
      result: result2
    })
    T.useOutputStore
      .getState()
      .insertItem({ kind: 'heading', id: 'h1', text: 'E2E Heading' }, 'nav-test-1')
    T.useUIStore.getState().setActiveTab('output')
  })
  await win.waitForTimeout(500)

  const navItem = title => win.locator('[class*="navItem"]', { hasText: title }).first()
  const block = id => win.locator(`#block-${id}`)

  // ── 1. Auto output header: summary always shown, syntax collapsed by default ──
  // The summary is no longer one text node: BlockSummary splits "Label: a, b"
  // into a label plus one chip per value, so a literal text match can never
  // succeed. Assert the structure it actually renders.
  const summaryBox = win.locator('#block-nav-test-1 [class*="blockSummaryContainer"]')
  const summaryVisible =
    (await summaryBox.locator('[class*="summaryLabel"]', { hasText: 'Variable(s)' }).isVisible()) &&
    (await summaryBox.locator('[class*="summaryChip"]', { hasText: /^age$/ }).count()) === 1 &&
    (await summaryBox.locator('[class*="summaryChip"]', { hasText: /^gender$/ }).count()) === 1
  const syntaxHiddenInitially =
    (await win.locator('#block-nav-test-1').locator('text=FREQUENCIES VARIABLES').count()) === 0
  const syntaxToggle = win.locator('#block-nav-test-1 button', { hasText: /Syntax|Sözdizimi/ })
  await syntaxToggle.click()
  await win.waitForTimeout(150)
  const syntaxVisibleAfterToggle = await win
    .locator('#block-nav-test-1')
    .locator('text=FREQUENCIES VARIABLES')
    .isVisible()

  // ── 2. Collapse All / Expand All ──────────────────────────────────────────
  const isCollapsed = async id =>
    win.evaluate(
      blockId =>
        window.__SAI_TEST__.useOutputStore.getState().blocks.find(b => b.id === blockId)
          ?.isCollapsed,
      id
    )
  const collapseAllBtn = win.locator('button', { hasText: /Collapse All|Daralt/ })
  await collapseAllBtn.click()
  await win.waitForTimeout(150)
  const bothCollapsed = (await isCollapsed('nav-test-1')) && (await isCollapsed('nav-test-2'))

  // ── 3. Warning badge shown only while collapsed ───────────────────────────
  const warningBadgeWhileCollapsed = await win
    .locator('#block-nav-test-1')
    .locator('text=⚠ 1')
    .isVisible()

  const expandAllBtn = win.locator('button', { hasText: /Expand All|Genişlet/ })
  await expandAllBtn.click()
  await win.waitForTimeout(150)
  const bothExpanded = !(await isCollapsed('nav-test-1')) && !(await isCollapsed('nav-test-2'))
  const warningBadgeHiddenWhenExpanded =
    (await win.locator('#block-nav-test-1').locator('text=⚠ 1').count()) === 0

  // ── 4. Search filters navigator + content ─────────────────────────────────
  // Visible only: the (hidden, still mounted) Terminal tab has search boxes too.
  const searchBox = win.locator(
    'input[placeholder*="ara" i]:visible, input[placeholder*="search" i]:visible'
  )
  await searchBox.fill('Second')
  await win.waitForTimeout(200)
  const firstBlockHiddenBySearch = (await block('nav-test-1').count()) === 0
  const secondBlockVisibleBySearch = await block('nav-test-2').isVisible()
  await searchBox.fill('')
  await win.waitForTimeout(200)
  const bothVisibleAfterClearingSearch =
    (await block('nav-test-1').isVisible()) && (await block('nav-test-2').isVisible())

  // ── 5. Navigator click-to-select (SPSS-style, bidirectional) ─────────────
  await navItem('E2E Nav Test Block').click()
  await win.waitForTimeout(150)
  let sel = await win.evaluate(() => window.__SAI_TEST__.useOutputStore.getState().selection)
  const selectFirstBlock = sel && sel.kind === 'blocks' && sel.ids.includes('nav-test-1')
  const firstBlockHasSelectedClass = /selected/.test(
    (await navItem('E2E Nav Test Block').getAttribute('class')) || ''
  )

  await navItem('E2E Heading').click()
  await win.waitForTimeout(150)
  sel = await win.evaluate(() => window.__SAI_TEST__.useOutputStore.getState().selection)
  const selectReplacesNotToggles = sel && sel.kind === 'blocks' && sel.ids.includes('h1')
  const firstBlockDeselectedAfterOtherClick = !/selected/.test(
    (await navItem('E2E Nav Test Block').getAttribute('class')) || ''
  )

  // Clicking the block's header in the CONTENT pane must select it back
  // (bidirectional) — same handleItemClick path AnalysisBlock's onSelect uses.
  await win.locator('#block-nav-test-1 [class*="blockHeader"]').click()
  await win.waitForTimeout(150)
  sel = await win.evaluate(() => window.__SAI_TEST__.useOutputStore.getState().selection)
  const contentPaneClickSelectsInNavigator =
    sel && sel.kind === 'blocks' && sel.ids.includes('nav-test-1')

  // ── 6. Navigator right-click ▸ Copy ───────────────────────────────────────
  // Clipboard is read through Electron's MAIN-process clipboard module, not
  // the renderer's navigator.clipboard: the async Clipboard API requires
  // document focus, and a window driven in the background on Windows never
  // has it — navigator.clipboard.readText() there does not fail, it never
  // settles, which hung this script indefinitely (63 minutes before it was
  // killed by hand). The main-process module reads the same OS clipboard with
  // no focus requirement. Same reason ipc-contracts' CLIPBOARD_READ_HTML
  // exists on the product side.
  const clip = makeClipboard(app, win)

  await clip.clear()
  await navItem('E2E Nav Test Block').click({ button: 'right' })
  await win.waitForTimeout(200)
  const copyMenuItem = win.locator('[role="menu"] [role="menuitem"]', {
    hasText: /Copy|Kopyala/
  })
  const copyMenuVisible = await copyMenuItem.first().isVisible()
  await copyMenuItem.first().click()
  await win.waitForTimeout(150)
  const blockCopyText = await clip.readWhenReady()
  const blockCopyHasTableContent = blockCopyText.includes('A') && blockCopyText.includes('row0')

  await clip.clear()
  await navItem('E2E Heading').click({ button: 'right' })
  await win.waitForTimeout(200)
  const copyHeadingItem = win.locator('[role="menu"] [role="menuitem"]', {
    hasText: /Copy|Kopyala/
  })
  await copyHeadingItem.first().click()
  await win.waitForTimeout(150)
  const headingCopyText = await clip.readWhenReady()
  const headingCopyIsExactText = headingCopyText.trim() === 'E2E Heading'

  // ── 7. Block header "Re-run" dispatches the analysis's menu channel ──────
  const rerunBtn = win.locator(
    '#block-nav-test-1 button[aria-label*="Re-run" i], #block-nav-test-1 button[aria-label*="Tekrar" i]'
  )
  await rerunBtn.click()
  await win.waitForTimeout(400)
  const dialogOpened = await win.locator('[role="dialog"]').count()
  const rerunOpensDialog = dialogOpened > 0

  const result = {
    summaryVisible,
    syntaxHiddenInitially,
    syntaxVisibleAfterToggle,
    bothCollapsed,
    warningBadgeWhileCollapsed,
    bothExpanded,
    warningBadgeHiddenWhenExpanded,
    firstBlockHiddenBySearch,
    secondBlockVisibleBySearch,
    bothVisibleAfterClearingSearch,
    selectFirstBlock,
    firstBlockHasSelectedClass,
    selectReplacesNotToggles,
    firstBlockDeselectedAfterOtherClick,
    contentPaneClickSelectsInNavigator,
    copyMenuVisible,
    blockCopyHasTableContent,
    headingCopyIsExactText,
    rerunOpensDialog,
    errors
  }
  console.log('RESULT:' + JSON.stringify(result, null, 2))

  const pass =
    summaryVisible &&
    syntaxHiddenInitially &&
    syntaxVisibleAfterToggle &&
    bothCollapsed &&
    warningBadgeWhileCollapsed &&
    bothExpanded &&
    warningBadgeHiddenWhenExpanded &&
    firstBlockHiddenBySearch &&
    secondBlockVisibleBySearch &&
    bothVisibleAfterClearingSearch &&
    selectFirstBlock &&
    firstBlockHasSelectedClass &&
    selectReplacesNotToggles &&
    firstBlockDeselectedAfterOtherClick &&
    contentPaneClickSelectsInNavigator &&
    copyMenuVisible &&
    blockCopyHasTableContent &&
    headingCopyIsExactText &&
    rerunOpensDialog &&
    errors.length === 0

  // This script adds Output blocks, so the app quits with unsaved output and
  // the guard opens a NATIVE modal. Playwright's app.close() then waits on it:
  // measured at 115s before force-kill, which made the script look like it
  // hung after printing its result and, with no per-script timeout in the
  // runner, blocked the whole suite. Every other script that dirties state
  // stubs this; this one did not.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1 // "Discard"
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
