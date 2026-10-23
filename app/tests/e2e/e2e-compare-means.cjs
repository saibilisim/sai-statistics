// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: injects results mirroring the four Compare Means analyses (One-Sample,
 * Independent, Paired t-tests, One-Way ANOVA) and asserts every table title,
 * column header and row label resolves (no raw output.* / col.* leaks) and that
 * label columns are left-aligned while numeric columns are right-aligned. */
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
    const mk = (id, titleKey, tables) => ({
      id,
      analysisId: id,
      titleKey: 'analysis.' + id + '.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: { success: true, tables, plots: [], warnings: [], notes: [] }
    })
    const store = T.useOutputStore.getState()

    store.addBlock(
      mk('ttest1', '', [
        {
          titleKey: 'output.ttest1.statsTitle',
          columns: [
            'output.col.variable',
            'output.col.n',
            'output.col.mean',
            'output.col.stdDeviation',
            'output.col.seMean'
          ],
          rows: [['Score', 60, 49.733392, 11.51256, 1.486265]],
          footnoteKey: null
        },
        {
          titleKey: 'output.ttest1.testTitle:50',
          columns: [
            'output.col.variable',
            'output.col.t',
            'output.col.df',
            'output.col.sigTwoTailed',
            'output.col.meanDiff',
            'output.col.ciLower95',
            'output.col.ciUpper95'
          ],
          rows: [['Score', -0.179381, 59, 0.858253, -0.266608, -3.240618, 2.707401]],
          footnoteKey: null
        }
      ])
    )
    store.addBlock(
      mk('ttestInd', '', [
        {
          titleKey: 'output.ttestInd.groupStatsTitle',
          columns: [
            'output.col.variable',
            'output.col.group',
            'output.col.n',
            'output.col.mean',
            'output.col.stdDeviation',
            'output.col.seMean'
          ],
          rows: [
            ['Score', 'Group = A', 31, 52.206183, 13.211836, 2.372916],
            ['Score', 'Group = B', 29, 47.090063, 8.845986, 1.642658]
          ],
          footnoteKey: null
        },
        {
          titleKey: 'output.ttestInd.testTitle',
          columns: [
            'output.col.variable',
            '',
            'output.col.leveneF',
            'output.col.leveneSig',
            'output.col.t',
            'output.col.df',
            'output.col.sigTwoTailed',
            'output.col.meanDiff',
            'output.col.seDiff',
            'output.col.ciLower95',
            'output.col.ciUpper95'
          ],
          rows: [
            [
              'Score',
              'output.col.equalAssumed',
              3.772133,
              0.056974,
              1.749984,
              58,
              0.08541,
              5.116119,
              2.923524,
              -0.735949,
              10.968187
            ],
            [
              '',
              'output.col.equalNotAssumed',
              null,
              null,
              1.772731,
              52.68,
              0.082055,
              5.116119,
              2.88601,
              -0.673305,
              10.905543
            ]
          ],
          footnoteKey: 'output.ttestInd.leveneFootnote'
        }
      ])
    )
    store.addBlock(
      mk('ttestPaired', '', [
        {
          titleKey: 'output.ttestPaired.corrTitle',
          columns: [
            'output.col.variable',
            'output.col.n',
            'output.col.correlation',
            'output.col.sig'
          ],
          rows: [['Pre - Post', 60, -0.048574, 0.712459]],
          footnoteKey: null
        },
        {
          titleKey: 'output.ttestPaired.testTitle',
          columns: [
            'output.col.variable',
            'output.col.mean',
            'output.col.stdDeviation',
            'output.col.seMean',
            'output.col.ciLower95',
            'output.col.ciUpper95',
            'output.col.t',
            'output.col.df',
            'output.col.sigTwoTailed'
          ],
          rows: [
            [
              'Pre - Post',
              -2.744705,
              12.993841,
              1.677498,
              -6.10137,
              0.61196,
              -1.63619,
              59,
              0.107124
            ]
          ],
          footnoteKey: null
        }
      ])
    )
    store.addBlock(
      mk('anova', '', [
        {
          titleKey: 'output.anova.title:Score',
          columns: [
            'output.col.source',
            'output.col.sumSq',
            'output.col.df',
            'output.col.meanSq',
            'output.col.f',
            'output.col.sig'
          ],
          rows: [
            ['output.col.betweenGroups', 59.313666, 2, 29.656833, 0.217826, 0.804931],
            ['output.col.withinGroups', 7760.489589, 57, 136.14894, null, null],
            ['output.col.total', 7819.803255, 59, null, null, null]
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
    // alignment: find a text label cell and a numeric cell, check computed align
    const tds = Array.from(document.querySelectorAll('[class*="outputTable"] td'))
    const txt = tds.find(
      td => td.textContent.trim() === 'Between Groups' || td.textContent.trim() === 'Gruplar Arası'
    )
    const num = tds.find(td => td.textContent.trim() === '60')
    const alignOf = el => (el ? getComputedStyle(el).textAlign : 'none')
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      hasOneSampleTest: has('One-Sample Test') || has('Tek Örneklem Testi'),
      hasGroupStats: has('Group Statistics') || has('Grup İstatistikleri'),
      hasEqualAssumed: has('Equal variances assumed') || has('Eşit varyans varsayılır'),
      hasLeveneF: has('Levene F'),
      hasPairedCorr:
        has('Paired Samples Correlations') || has('Eşleştirilmiş Örneklem Korelasyonları'),
      hasAnova: has('ANOVA'),
      hasBetween: has('Between Groups') || has('Gruplar Arası'),
      hasSig2: has('Sig. (2-tailed)') || has('Anl. (2-yönlü)'),
      labelAlign: alignOf(txt),
      numAlign: alignOf(num),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  await win.screenshot({ path: __dirname + '/../../e2e-compare-means.png', fullPage: true })

  const pass =
    info.tables === 7 &&
    info.hasOneSampleTest &&
    info.hasGroupStats &&
    info.hasEqualAssumed &&
    info.hasLeveneF &&
    info.hasPairedCorr &&
    info.hasAnova &&
    info.hasBetween &&
    info.hasSig2 &&
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
    console.error('E2E FAILED — see assertions above')
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
