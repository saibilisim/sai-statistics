// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Yeni eklenen 8 SPSS syntax komutunu (BAYES TTEST/ANOVA/CORRELATION/REGRESSION,
 * PROPORTIONS, PROBIT, GENLIN [+/REPEATED→GEE], MVA) gerçek Terminal (Ctrl+5,
 * SPSS modu) üzerinden çalıştırır — gerçek dispatcher kodu, gerçek R.
 * Run: xvfb-run -a node tests/e2e/test-new-syntax-commands.cjs
 */
const { _electron } = require('@playwright/test')
const path = require('path')

const MASTER_CSV = '/tmp/sai-ai-test/master_dataset.csv'
const PANEL_CSV = '/tmp/sai-ai-test/panel_dataset.csv'

async function runSyntax(win, text) {
  await win.fill('textarea.editor, [class*="editor"]', text)
  await win.click('[class*="button"][class*="primary"]')
  await win.waitForTimeout(400)
}

async function waitForBlock(win, analysisId, timeoutMs = 30000) {
  const start = Date.now()
  for (;;) {
    const found = await win.evaluate(
      id => window.__SAI_TEST__.useOutputStore.getState().blocks.some(b => b.analysisId === id),
      analysisId
    )
    if (found) return true
    if (Date.now() - start > timeoutMs) return false
    await win.waitForTimeout(300)
  }
}

async function getTable(win, analysisId) {
  return win.evaluate(id => {
    const blocks = window.__SAI_TEST__.useOutputStore.getState().blocks
    const block = [...blocks].reverse().find(b => b.analysisId === id)
    return block ? block.result.tables : null
  }, analysisId)
}

async function getConsoleText(win) {
  return win.evaluate(() => document.querySelector('[class*="console"]')?.textContent ?? '')
}

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..')
  })
  const win = await app.firstWindow()
  win.on('pageerror', err => console.log('[pageerror]', err.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)

  const importDataset = async filePath =>
    win.evaluate(async fp => {
      const result = await window.api.file.import({ filePath: fp })
      window.__SAI_TEST__.useDatasetStore
        .getState()
        .setDataset(
          result.dataset.id,
          result.dataset.name,
          result.dataset.filePath,
          result.variables,
          result.dataset.rowCount,
          result.styles
        )
      return { datasetId: result.dataset.id, variables: result.variables }
    }, filePath)

  const results = {}

  // ── Master dataset session ──────────────────────────────────────────
  await importDataset(MASTER_CSV)
  await win.click('[role="tab"][title*="Ctrl+5"]')
  await win.waitForSelector('textarea.editor, [class*="editor"]', { timeout: 5000 })

  const masterTests = [
    {
      name: 'BAYES TTEST (ind)',
      analysisId: 'bayesTTestInd',
      syntax: 'BAYES TTEST /VARIABLES=score /GROUPS=group2("A","B") /CRITERIA RSCALE=MEDIUM.'
    },
    {
      name: 'BAYES TTEST (paired)',
      analysisId: 'bayesTTestPaired',
      syntax: 'BAYES TTEST /PAIRS=pretest WITH posttest /CRITERIA RSCALE=MEDIUM.'
    },
    {
      name: 'BAYES TTEST (one)',
      analysisId: 'bayesTTest1',
      syntax: 'BAYES TTEST /TESTVAL=50 /VARIABLES=score /CRITERIA RSCALE=MEDIUM.'
    },
    {
      name: 'BAYES ANOVA',
      analysisId: 'bayesAnova',
      syntax: 'BAYES ANOVA DEPENDENT=score /DESIGN=group3 /CRITERIA RSCALE=MEDIUM.'
    },
    {
      name: 'BAYES CORRELATION',
      analysisId: 'bayesCorrelate',
      syntax: 'BAYES CORRELATION VARIABLES=score score2 /CRITERIA RSCALE=MEDIUM.'
    },
    {
      name: 'BAYES REGRESSION',
      analysisId: 'bayesRegression',
      syntax:
        'BAYES REGRESSION DEPENDENT=score /METHOD=ENTER score2 score3 /CRITERIA RSCALE=MEDIUM.'
    },
    {
      name: 'PROPORTIONS one',
      analysisId: 'proportions',
      syntax:
        'PROPORTIONS /ONESAMPLE outcome01 TESTVAL=0.3 /SUCCESS VALUE=LEVEL(1) /CRITERIA CILEVEL=95.'
    },
    { name: 'PROBIT', analysisId: 'probit', syntax: 'PROBIT outcome01 WITH score.' },
    {
      name: 'GENLIN (plain)',
      analysisId: 'genlin',
      syntax: 'GENLIN count_var WITH score /MODEL score DISTRIBUTION=POISSON LINK=LOG.'
    },
    { name: 'MVA', analysisId: 'missing', syntax: 'MVA VARIABLES=score_miss score2.' }
  ]

  for (const t of masterTests) {
    await runSyntax(win, t.syntax)
    const ok = await waitForBlock(win, t.analysisId)
    const table = ok ? await getTable(win, t.analysisId) : null
    results[t.name] = { ok, table }
    console.log(`${t.name}: ${ok ? 'OK' : 'FAILED (timeout)'}`)
    if (!ok) {
      const consoleText = await getConsoleText(win)
      console.log('  console tail:', consoleText.slice(-400))
    }
  }

  // ── Panel dataset session (GEE via GENLIN /REPEATED) ────────────────
  await importDataset(PANEL_CSV)
  await runSyntax(
    win,
    'GENLIN y_bin WITH time x /MODEL time x DISTRIBUTION=BINOMIAL LINK=LOGIT /REPEATED SUBJECT=subject CORRTYPE=EXCHANGEABLE.'
  )
  const geeOk = await waitForBlock(win, 'gee')
  const geeTable = geeOk ? await getTable(win, 'gee') : null
  results['GENLIN /REPEATED (GEE)'] = { ok: geeOk, table: geeTable }
  console.log(`GENLIN /REPEATED (GEE): ${geeOk ? 'OK' : 'FAILED (timeout)'}`)
  if (!geeOk) console.log('  console tail:', (await getConsoleText(win)).slice(-400))

  console.log('\n=== FULL RESULTS ===')
  console.log(JSON.stringify(results, null, 2))

  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 1
    })
    await app.close()
  } catch (err) {
    console.error('app close failed:', err)
  }

  const allOk = Object.values(results).every(r => r.ok)
  console.log(allOk ? '\nALL PASSED' : '\nSOME FAILED')
  if (!allOk) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
