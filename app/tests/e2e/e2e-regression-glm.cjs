// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Multinomial Logistic, Ordinal, Probit regression. Asserts model-fitting +
 * parameter-estimate tables resolve, alignment, no raw key leaks. */
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
    const store = T.useOutputStore.getState()
    const mk = (id, tables) => ({
      id,
      analysisId: id,
      titleKey: 'analysis.' + id + '.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: { success: true, plots: [], warnings: [], notes: [], tables }
    })

    store.addBlock(
      mk('multinom', [
        {
          titleKey: 'output.multinom.fitTitle',
          columns: [
            'output.col.model',
            'output.col.neg2LL',
            'output.col.chiSquare',
            'output.col.df',
            'output.col.sig'
          ],
          rows: [['output.col.final', 260.728, 80.5, 4, 0]],
          footnoteKey: null
        },
        {
          titleKey: 'output.multinom.paramTitle',
          columns: [
            'output.col.category',
            'output.col.model',
            'output.col.b',
            'output.col.stdError',
            'output.col.wald',
            'output.col.df',
            'output.col.sig',
            'output.col.expB'
          ],
          rows: [
            ['high', 'output.col.intercept', 0.5, 0.3, 2.78, 1, 0.095, 1.649],
            ['', 'X1', 1.2, 0.4, 9, 1, 0.0027, 3.32]
          ],
          footnoteKey: 'output.multinom.refFootnote'
        }
      ])
    )
    store.addBlock(
      mk('ordinal', [
        {
          titleKey: 'output.ordinal.fitTitle',
          columns: [
            'output.col.model',
            'output.col.neg2LL',
            'output.col.chiSquare',
            'output.col.df',
            'output.col.sig'
          ],
          rows: [['output.col.final', 318.379, 11.165, 2, 0.003764]],
          footnoteKey: null
        },
        {
          titleKey: 'output.ordinal.paramTitle',
          columns: [
            'output.col.category',
            'output.col.model',
            'output.col.estimate',
            'output.col.stdError',
            'output.col.wald',
            'output.col.df',
            'output.col.sig'
          ],
          rows: [
            ['output.col.location', 'X1', -0.549, 0.17, 10.387, 1, 0.001269],
            ['output.col.threshold', 'low|mid', 0.758, 0.179, 17.89, 1, 0.00002]
          ],
          footnoteKey: null
        }
      ])
    )
    store.addBlock(
      mk('probit', [
        {
          titleKey: 'output.probit.fitTitle',
          columns: [
            'output.col.model',
            'output.col.neg2LL',
            'output.col.chiSquare',
            'output.col.df',
            'output.col.sig'
          ],
          rows: [['output.col.final', 180.913, 26.924, 2, 0.000001]],
          footnoteKey: null
        },
        {
          titleKey: 'output.probit.paramTitle',
          columns: [
            'output.col.model',
            'output.col.b',
            'output.col.stdError',
            'output.col.zVal',
            'output.col.sig'
          ],
          rows: [
            ['output.col.constant', -0.019, 0.11, -0.171, 0.864],
            ['X1', 0.445, 0.123, 3.603, 0.000314]
          ],
          footnoteKey: 'output.probit.depFootnote:YB (1 = 1)'
        }
      ])
    )
    T.useUIStore.getState().setActiveTab('output')
  })

  await win.waitForTimeout(800)
  const info = await win.evaluate(() => {
    const bodyText = document.querySelector('[class*="content"]')?.textContent ?? ''
    const has = s => bodyText.includes(s)
    const leaks = (bodyText.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 10)
    const tds = Array.from(document.querySelectorAll('[class*="outputTable"] td'))
    const txt = tds.find(
      td => td.textContent.trim() === 'Location' || td.textContent.trim() === 'Konum'
    )
    const num = tds.find(td => td.textContent.trim() === '318.379')
    const alignOf = el => (el ? getComputedStyle(el).textAlign : 'none')
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      hasMulti: has('Multinomial') || has('Model Fitting Information') || has('Model Uyum'),
      hasParam: has('Parameter Estimates') || has('Parametre Tahminleri'),
      hasExpB: has('Exp(B)'),
      hasThreshold: has('Threshold') || has('Eşik'),
      hasLocation: has('Location') || has('Konum'),
      hasZ: bodyText.includes('Z'),
      hasPLt001: has('<.001'),
      labelAlign: alignOf(txt),
      numAlign: alignOf(num),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  const pass =
    info.tables === 6 &&
    info.hasParam &&
    info.hasExpB &&
    info.hasThreshold &&
    info.hasLocation &&
    info.hasPLt001 &&
    info.labelAlign === 'left' &&
    info.numAlign === 'right' &&
    info.rawKeyLeaks.length === 0
  // Analiz sonuçları Output'u kirletir (outputDirty) — headless'ta kapanış
  // guard'ının native dialogu sonsuza dek bekler. Otomatik "kaydetme/dışa
  // aktarma yok" (1) seçilir (e2e-value-labels.cjs ile aynı desen).
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
main().catch(err => {
  console.error(err)
  process.exit(1)
})
