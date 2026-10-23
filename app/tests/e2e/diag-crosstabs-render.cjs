// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Diagnostic: injects a crosstabs.R-shaped result (count crosstab with dynamic
 * data-string column headers + an i18n "Total" key, plus a Chi-Square Tests
 * table) and asserts it renders with translated labels and no raw key leaks. */
const { _electron } = require('@playwright/test')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)

  await win.evaluate(async () => {
    const T = window.__SAI_TEST__
    const result = {
      success: true,
      tables: [
        {
          // columns mix the row-var name (data), col levels (data) and a Total key
          titleKey: 'output.crosstabs.countTitle:gender × passed',
          columns: ['gender', 'No', 'Yes', 'output.col.total'],
          rows: [
            ['female', 7, 3, 10],
            ['male', 4, 6, 10],
            ['output.col.total', 11, 9, 20]
          ],
          footnoteKey: null
        },
        {
          titleKey: 'output.crosstabs.chiSqTitle:gender × passed',
          columns: ['output.col.statistic', 'output.col.value', 'output.col.df', 'output.col.sig'],
          rows: [
            ['output.col.pearsonChiSq', 1.818182, 1, 0.177499],
            ['output.col.likelihoodRatio', 1.84798, 1, 0.174022],
            ['output.col.nValidCases', 20, null, null]
          ],
          footnoteKey: null
        }
      ],
      plots: [],
      warnings: [],
      notes: []
    }
    T.useOutputStore.getState().addBlock({
      id: 'xtab-diag',
      analysisId: 'crosstabs',
      titleKey: 'analysis.crosstabs.title',
      timestamp: new Date().toISOString(),
      datasetName: 'diag',
      result
    })
    T.useUIStore.getState().setActiveTab('output')
  })

  await win.waitForTimeout(800)

  const info = await win.evaluate(() => {
    const bodyText = document.querySelector('[class*="content"]')?.textContent ?? ''
    const leaks = (bodyText.match(/output\.[a-zA-Z.]+/g) || []).slice(0, 8)
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      // Pearson row label translates (EN "Pearson Chi-Square" / TR "Pearson Ki-Kare")
      hasPearson: bodyText.includes('Pearson'),
      // dynamic data headers render verbatim
      hasGenderHeader: bodyText.includes('gender'),
      hasYesNo: bodyText.includes('Yes') && bodyText.includes('No'),
      // "Total" i18n key resolves (EN Total / TR Toplam)
      hasTotal: bodyText.includes('Total') || bodyText.includes('Toplam'),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  await win.screenshot({ path: __dirname + '/../../diag-crosstabs-render.png' })
  await app.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
