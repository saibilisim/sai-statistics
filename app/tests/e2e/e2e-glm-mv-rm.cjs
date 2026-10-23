// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: GLM Multivariate (Multivariate Tests + Between-Subjects) and Repeated
 * Measures (Mauchly + Within-Subjects). Asserts labels resolve, alignment, no
 * raw key leaks. */
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
      mk('glmMulti', [
        {
          titleKey: 'output.glmMulti.mvTitle',
          columns: [
            'output.col.source',
            'output.col.statistic',
            'output.col.value',
            'output.col.f',
            'output.col.hypDf',
            'output.col.errorDf',
            'output.col.sig'
          ],
          rows: [
            ['F1', 'output.col.pillai', 0.224, 8.25, 2, 57, 0.000713],
            ['', 'output.col.wilks', 0.776, 8.25, 2, 57, 0.000713],
            ['', 'output.col.hotelling', 0.289, 8.25, 2, 57, 0.000713],
            ['', 'output.col.roy', 0.289, 8.25, 2, 57, 0.000713]
          ],
          footnoteKey: null
        },
        {
          titleKey: 'output.glmMulti.bsTitle',
          columns: [
            'output.col.variable',
            'output.col.source',
            'output.col.typeIIISS',
            'output.col.df',
            'output.col.meanSq',
            'output.col.f',
            'output.col.sig'
          ],
          rows: [
            ['Y1', 'F1', 6.85, 1, 6.85, 6.385, 0.014256],
            ['', 'output.col.error', 62.221, 58, 1.073, null, null]
          ],
          footnoteKey: null
        }
      ])
    )

    store.addBlock(
      mk('glmRep', [
        {
          titleKey: 'output.glmRep.mauchlyTitle:time',
          columns: [
            'output.col.mauchlyW',
            'output.col.chiSquare',
            'output.col.df',
            'output.col.sig',
            'output.col.greenhouse',
            'output.col.huynh',
            'output.col.lowerBound'
          ],
          rows: [[0.855, 3.594, 2, 0.165818, 0.874, 0.937, 0.5]],
          footnoteKey: null
        },
        {
          titleKey: 'output.glmRep.withinTitle:time',
          columns: [
            'output.col.source',
            'output.col.typeIIISS',
            'output.col.df',
            'output.col.meanSq',
            'output.col.f',
            'output.col.sig'
          ],
          rows: [
            ['output.col.sphericityAssumed', 51.953, 2, 25.976, 33.658, 0],
            ['output.col.error', 37.045, 48, 0.772, null, null],
            ['output.col.greenhouse', 51.953, 1.747, 29.734, 33.658, 0]
          ],
          footnoteKey: null
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
      td =>
        td.textContent.trim() === 'Sphericity Assumed' ||
        td.textContent.trim() === 'Küresellik Varsayıldı'
    )
    const num = tds.find(td => td.textContent.trim() === '51.953')
    const alignOf = el => (el ? getComputedStyle(el).textAlign : 'none')
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      hasMvTests: has('Multivariate Tests') || has('Çok Değişkenli Testler'),
      hasPillai: has('Pillai') || has('Pillai İzi'),
      hasMauchly: has('Mauchly') || has('Mauchly'),
      hasGG: has('Greenhouse-Geisser'),
      hasWithin: has('Within-Subjects Effects') || has('Denek-İçi Etkiler'),
      hasSphericity: has('Sphericity Assumed') || has('Küresellik Varsayıldı'),
      labelAlign: alignOf(txt),
      numAlign: alignOf(num),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  const pass =
    info.tables === 4 &&
    info.hasMvTests &&
    info.hasPillai &&
    info.hasMauchly &&
    info.hasGG &&
    info.hasWithin &&
    info.hasSphericity &&
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
