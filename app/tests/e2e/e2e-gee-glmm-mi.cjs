// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: the three procedures no reference product settles for us — GEE,
 * Generalized Linear Mixed Models and Multiple Imputation.
 *
 * tests/r-validation/test-gee-glmm-mi-2026-08.R validates the statistics.
 * This validates the half that file cannot see: the window. The SPSS parity
 * harness builds its parameters in compare.R or takes them from the syntax
 * parser — never from a dialog — so a checkbox that sends the wrong parameter
 * is invisible to all 687 comparisons. That gap is what this closes for these
 * three.
 *
 * Per dialog:
 *   1. opens from the SAME channel the native menu item pushes;
 *   2. the Run button is DISABLED until the required fields are filled — the
 *      gate is asserted before AND after, so a dialog that simply never
 *      disables it cannot pass;
 *   3. variables are assigned through the real source list and ▶ buttons;
 *   4. Run produces an Output block with the expected tables and no error;
 *   5. the setting each control holds is read back OUT OF THE RESULT — this
 *      is the step that catches a control wired to nothing: GEE's correlation
 *      structure, GLMM's family, MI's number of imputations.
 *
 * Run: node tests/e2e/e2e-gee-glmm-mi.cjs   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CSV = path.join(os.tmpdir(), 'sai-e2e-gee-glmm-mi.csv')

/** Clustered data with a binary outcome and one column carrying blanks. */
function writeFixture() {
  const rows = ['y,x,b,subj,miss1,miss2']
  let seed = 20260810
  const rnd = () => {
    // Deterministic LCG: the same fixture every run, so a failure is the app's.
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  for (let s = 1; s <= 40; s++) {
    const u = (rnd() - 0.5) * 3 // cluster effect
    for (let i = 0; i < 6; i++) {
      const x = Math.round((rnd() * 10 - 5) * 1000) / 1000
      const y = Math.round((2 + 0.8 * x + u + (rnd() - 0.5)) * 1000) / 1000
      const b = 2 + 0.8 * x + u > 2 ? 1 : 0
      const m1 = rnd() < 0.2 ? '' : Math.round(rnd() * 100) / 10
      const m2 = Math.round(rnd() * 100) / 10
      rows.push(`${y},${x},${b},${s},${m1},${m2}`)
    }
  }
  fs.writeFileSync(CSV, rows.join('\n') + '\n')
}

async function main() {
  writeFixture()

  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..')
  })
  const win = await app.firstWindow()
  const pageErrors = []
  win.on('pageerror', e => pageErrors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
    dialog.showMessageBoxSync = () => 1
  })

  const fails = []
  const check = (cond, msg) => {
    if (!cond) fails.push(msg)
    else console.log('   ok  ' + msg)
  }

  // Import the fixture through the real IPC path, then install it in the
  // renderer store exactly as use-menu-commands.ts does after a File > Open —
  // file.import() only returns the dataset, it does not mount it, and a test
  // that skips this step runs against the app's default var1/var2/var3 scratch
  // sheet while looking like it loaded data.
  const imported = await win.evaluate(async f => {
    const r = await window.api.file.import({ filePath: f })
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
    return { names: (r.variables ?? []).map(v => v.name) }
  }, CSV)
  await win.waitForTimeout(1200)
  // Assert the variables the dialogs will offer, not merely that a call
  // returned something: the first version of this checked `success !== false`
  // on an object with no `success` field, which is true for every outcome.
  const mounted = await win.evaluate(() =>
    (window.__SAI_TEST__.useDatasetStore.getState().variables ?? []).map(v => v.name)
  )
  check(
    ['y', 'x', 'b', 'subj', 'miss1', 'miss2'].every(n => mounted.includes(n)),
    `fixture mounted with its own variables (${mounted.join(', ')})`
  )
  void imported

  /**
   * Open a dialog and wait for its REAL body.
   *
   * All three gate on an optional R package (usePackageGate), and while the
   * check is in flight — it spawns Rscript, which is slow on Windows — the
   * dialog renders PackageNeededDialog instead, with a different set of
   * buttons and no variable list. A fixed sleep made this test assert against
   * that placeholder: "Run stays disabled" was reading the Install button.
   * Poll for the source listbox instead, and say so plainly when it never
   * arrives rather than carrying on against the wrong dialog.
   */
  const openDialog = async (channel, label) => {
    await app.evaluate(({ BrowserWindow }, ch) => {
      BrowserWindow.getAllWindows()[0].webContents.send(ch)
    }, channel)
    const t0 = Date.now()
    for (;;) {
      const ready = await win.evaluate(() =>
        Boolean(document.querySelector('[role="dialog"] [role="listbox"]'))
      )
      if (ready) return true
      if (Date.now() - t0 > 30000) {
        const what = await win.evaluate(() => {
          const d = document.querySelector('[role="dialog"]')
          return d ? (d.textContent || '').trim().slice(0, 120) : '(dialog yok)'
        })
        fails.push(
          `${label}: the dialog body never appeared — package gate still blocking? [${what}]`
        )
        return false
      }
      await win.waitForTimeout(400)
    }
  }

  /** Select a source variable by name, then push it into the nth field. */
  const assign = async (varName, fieldIndex) => {
    await win.evaluate(
      ({ name }) => {
        const box = document.querySelector('[role="dialog"] [role="listbox"]')
        const item = Array.from(box?.querySelectorAll('*') ?? []).find(
          el => el.children.length === 0 && (el.textContent || '').trim() === name
        )
        if (item) item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      },
      { name: varName }
    )
    await win.waitForTimeout(150)
    await win.evaluate(idx => {
      const btns = Array.from(document.querySelectorAll('[role="dialog"] button')).filter(
        b => (b.textContent || '').trim() === '▶'
      )
      btns[idx]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }, fieldIndex)
    await win.waitForTimeout(200)
  }

  /** The dialog's primary (Run/OK) button — the last enabled-or-not footer button. */
  const runButtonState = async () =>
    await win.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="dialog"] button'))
      // The footer ends with [Reset, OK, Cancel] and OK is the only one bound
      // to canSubmit, so it is second from last once the transfer arrows and
      // the close × are filtered out. Indexing from the end rather than by
      // class because CSS-module class names are hashed at build time.
      const cand = btns.filter(b => {
        const t = (b.textContent || '').trim()
        return t && t !== '▶' && t !== '◀' && t !== '×'
      })
      const ok = cand[cand.length - 2]
      return { text: (ok?.textContent || '').trim(), disabled: Boolean(ok?.disabled) }
    })

  const clickRun = async () => {
    await win.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="dialog"] button'))
      const cand = btns.filter(b => {
        const t = (b.textContent || '').trim()
        return t && t !== '▶' && t !== '◀' && t !== '×'
      })
      const btn = cand[cand.length - 2]
      if (btn && !btn.disabled) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  const lastBlock = async () =>
    await win.evaluate(() => {
      // NEWEST FIRST: output-store prepends (blocks: [new, ...old]). Reading
      // the end of the array gives the oldest block, so after the first
      // analysis every later one looks like "no new block" — or worse, like a
      // success that was actually the previous run's result.
      const blocks = window.__SAI_TEST__.useOutputStore.getState().blocks
      const b = blocks[0]
      if (!b) return null
      return {
        id: b.id,
        titleKey: b.titleKey,
        error: b.error ?? null,
        running: Boolean(b.running),
        tables: (b.result?.tables ?? []).map(t => ({
          titleKey: t.titleKey,
          footnoteKey: t.footnoteKey ?? null,
          rows: (t.rows ?? []).map(r => r.map(c => (c == null ? '' : String(c))))
        }))
      }
    })

  /**
   * Wait for a NEW output block. Returns null on timeout rather than the block
   * that was already there: returning the stale one made every downstream
   * assertion read the previous analysis's result, so "ran without error"
   * passed for a run that never happened.
   */
  const waitForBlock = async (before, ms = 60000) => {
    const t0 = Date.now()
    for (;;) {
      const b = await lastBlock()
      if (b && b.id !== before && !b.running) return b
      if (Date.now() - t0 > ms) return null
      await win.waitForTimeout(400)
    }
  }

  // ── GEE ───────────────────────────────────────────────────────────────────
  console.log('\n== GEE ==')
  {
    const open = await openDialog('menu:analyze:gee', 'GEE')
    check(open, 'GEE dialog opened from the menu channel with its variable list')

    const before = await runButtonState()
    check(before.disabled, `Run is disabled with nothing assigned (button: "${before.text}")`)

    await assign('y', 0) // dependent
    await assign('x', 1) // predictors
    await assign('subj', 2) // subject
    const after = await runButtonState()
    check(!after.disabled, 'Run becomes enabled once dependent, predictor and subject are set')

    const prev = (await lastBlock())?.id ?? null
    await clickRun()
    const block = await waitForBlock(prev)
    check(
      Boolean(block) && !block.error,
      `GEE produced a new output block without error (${block ? (block.error ?? 'ok') : 'blok olusmadi'})`
    )
    check(
      Boolean(block?.tables?.some(t => t.titleKey.includes('gee.paramTitle'))),
      'GEE output carries the Parameter Estimates table'
    )
    // The panel's settings must actually reach the analysis. Checked through
    // the RESULT rather than the request: the Model Information table echoes
    // the working correlation and the family the script was given, so a radio
    // wired to nothing shows up as the script's own default instead.
    const info = block?.tables?.find(t => t.titleKey.includes('gee.infoTitle'))
    const infoText = JSON.stringify(info?.rows ?? [])
    check(
      infoText.includes('exchangeable') && infoText.includes('gaussian'),
      `GEE's correlation structure and family reached the analysis (${infoText.slice(0, 90)})`
    )
  }

  // ── GLMM ──────────────────────────────────────────────────────────────────
  console.log('\n== GLMM ==')
  {
    const open = await openDialog('menu:analyze:glmm', 'GLMM')
    check(open, 'GLMM dialog opened from the menu channel with its variable list')

    const before = await runButtonState()
    check(before.disabled, 'Run is disabled with nothing assigned')

    await assign('b', 0) // binary dependent, matching the default binomial family
    await assign('x', 1)
    await assign('subj', 2)
    const after = await runButtonState()
    check(!after.disabled, 'Run becomes enabled once the three fields are set')

    const prev = (await lastBlock())?.id ?? null
    await clickRun()
    const block = await waitForBlock(prev)
    check(
      Boolean(block) && !block.error,
      `GLMM produced a new output block without error (${block ? (block.error ?? 'ok') : 'blok olusmadi'})`
    )
    check(
      Boolean(block?.tables?.some(t => t.titleKey.includes('glmm.fixedTitle'))),
      'GLMM output carries the Fixed Effects table'
    )
    check(
      Boolean(block?.tables?.some(t => t.titleKey.includes('glmm.randomTitle'))),
      'GLMM output carries the Random Effects table'
    )
    // The binomial family is what puts an Exp(B) column on the table; a
    // gaussian fit has none. So the column's presence is evidence the family
    // radio reached the script.
    const fixed = block?.tables?.find(t => t.titleKey.includes('glmm.fixedTitle'))
    check(
      (fixed?.rows?.[0]?.length ?? 0) >= 6,
      `GLMM's binomial family reached the analysis — Exp(B) column present (${fixed?.rows?.[0]?.length} columns)`
    )
  }

  // ── Multiple Imputation ───────────────────────────────────────────────────
  console.log('\n== Multiple Imputation ==')
  {
    const open = await openDialog('menu:analyze:mi', 'MI')
    check(open, 'MI dialog opened from the menu channel with its variable list')

    const before = await runButtonState()
    check(before.disabled, 'Run is disabled with nothing assigned')

    await assign('miss1', 0)
    const oneVar = await runButtonState()
    check(oneVar.disabled, 'Run stays disabled with only one variable (MI needs two)')

    await assign('miss2', 0)
    const after = await runButtonState()
    check(!after.disabled, 'Run becomes enabled with two variables')

    // Change the imputation count away from its default, so the box is proven
    // to be connected rather than decorative.
    await win.evaluate(() => {
      const inp = document.querySelector('[role="dialog"] input[type="number"]')
      if (!inp) return
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(inp, '3')
      inp.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await win.waitForTimeout(200)

    const prev = (await lastBlock())?.id ?? null
    await clickRun()
    const block = await waitForBlock(prev, 60000)
    check(
      Boolean(block) && !block.error,
      `MI produced a new output block without error (${block ? (block.error ?? 'ok') : 'blok olusmadi'})`
    )
    check(
      Boolean(block?.tables?.some(t => t.titleKey.includes('mi.pooledTitle'))),
      'MI output carries the Pooled Statistics table'
    )
    // The spec table's footnote carries m, so the number typed in the box is
    // read back out of the analysis's own output.
    const spec = block?.tables?.find(t => t.titleKey.includes('mi.specTitle'))
    check(
      String(spec?.footnoteKey ?? '').endsWith(':3'),
      `the imputation count reached the analysis (footnote: ${spec?.footnoteKey})`
    )
  }

  check(pageErrors.length === 0, `no page errors (${pageErrors.join(' | ') || 'none'})`)

  await app.close()
  try {
    fs.unlinkSync(CSV)
  } catch {
    /* the fixture is in the OS temp dir; leaving it behind is harmless */
  }

  if (fails.length) {
    console.error('\nFAILED:\n  - ' + fails.join('\n  - '))
    process.exit(1)
  }
  console.log('\nPASSED: GEE / GLMM / MI dialogs drive their analyses end to end')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
