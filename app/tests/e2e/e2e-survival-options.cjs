// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: the Kaplan-Meier and Cox Regression option surfaces (Compare Factor,
 * Options, Categorical, Plots).
 *
 * This renders one block per NEW output shape those sub-dialogs can produce —
 * the survival table, percentiles, per-stratum and pairwise comparisons, the
 * stepwise history, the correlation matrix, the baseline table, the
 * proportional-hazards test, the four plot types on each side — together with
 * every note and warning key they emit.
 *
 * The point is the raw-key leak check. Those options introduced ~120 i18n
 * keys across seven locales, and a single typo in a key name renders as the
 * literal "output.cox.stepsTitle" in the user's output. Nothing else in the
 * suite would catch that: the R validation suite asserts numbers and never
 * translates, and the unit i18n test only checks that the locales agree with
 * each other — two locales can agree perfectly on a key the code never asks
 * for. Only rendering the real payload through the real translator does.
 *
 * Needs no fixture: results are pushed straight into the output store, the
 * same way e2e-roc-survival.cjs does.
 */
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
    const mk = (id, tables, plots = [], warnings = [], notes = []) => ({
      id,
      analysisId: id,
      titleKey: 'analysis.' + id + '.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: { success: true, tables, plots, warnings, notes }
    })
    const plot = titleKey => ({
      titleKey,
      type: 'plotly',
      data: {
        data: [{ type: 'scatter', mode: 'lines', line: { shape: 'hv' }, x: [0, 1], y: [1, 0.6] }],
        layout: {}
      }
    })

    store.addBlock(
      mk(
        'survivalKM',
        [
          {
            titleKey: 'output.survival.tableTitle',
            columns: [
              'group',
              'output.col.case',
              'output.col.time',
              'output.col.status',
              'output.col.cumSurvival',
              'output.col.stdError',
              'output.col.cumEvents',
              'output.col.nRemaining'
            ],
            rows: [
              ['A', 1, 4.2, 'output.col.event', 0.95, 0.049, 1, 19],
              ['A', 2, 6.7, 'output.col.censored', '', '', 1, 18]
            ],
            footnoteKey: null
          },
          {
            titleKey: 'output.survival.medianTitle',
            columns: [
              'group',
              'output.col.meanEst',
              'output.col.stdError',
              'output.col.meanCiLower',
              'output.col.meanCiUpper',
              'output.col.medianEst',
              'output.col.ciLower95',
              'output.col.ciUpper95'
            ],
            rows: [['A', 15.452, 1.223, 13.055, 17.849, 13.26, 9.4, 18.1]],
            footnoteKey: null
          },
          {
            titleKey: 'output.survival.percentilesTitle',
            columns: [
              'group',
              'output.col.p25',
              'output.col.p25Lower',
              'output.col.p25Upper',
              'output.col.median',
              'output.col.medianLower',
              'output.col.medianUpper',
              'output.col.p75',
              'output.col.p75Lower',
              'output.col.p75Upper'
            ],
            rows: [['A', 6.7, 4.2, 9.1, 13.26, 9.4, 18.1, 22.4, 18.2, 30.5]],
            footnoteKey: null
          },
          {
            titleKey: 'output.survival.logrankTitle',
            columns: [
              'output.col.statistic',
              'output.col.chiSquare',
              'output.col.df',
              'output.col.sig'
            ],
            rows: [
              ['output.col.logRank', 8.923, 1, 0.002816],
              ['output.col.breslow', 7.441, 1, 0.006381],
              ['output.col.taroneWare', 8.155, 1, 0.004297]
            ],
            footnoteKey: null
          },
          {
            titleKey: 'output.survival.logrankPerStratumTitle',
            columns: [
              'site',
              'output.col.statistic',
              'output.col.chiSquare',
              'output.col.df',
              'output.col.sig'
            ],
            rows: [['s1', 'output.col.logRank', 4.112, 1, 0.042601]],
            footnoteKey: null
          },
          {
            titleKey: 'output.survival.pairwiseTitle',
            columns: [
              'output.col.groupI',
              'output.col.groupJ',
              'output.col.statistic',
              'output.col.chiSquare',
              'output.col.df',
              'output.col.sig'
            ],
            rows: [['A', 'B', 'output.col.logRank', 4.626, 1, 0.031477]],
            footnoteKey: null
          }
        ],
        [
          plot('output.survival.kmPlotTitle'),
          plot('output.survival.oneMinusPlotTitle'),
          plot('output.survival.hazardPlotTitle'),
          plot('output.survival.logPlotTitle')
        ],
        ['output.survival.tableTruncated', 'output.survival.noStrataForMode'],
        [
          'output.survival.medianCiNote',
          'output.survival.meanRestrictedNote',
          'output.survival.pairwiseNoAdjustNote'
        ]
      )
    )

    store.addBlock(
      mk(
        'survivalCox',
        [
          {
            titleKey: 'output.cox.stepsTitle',
            columns: [
              'output.col.step',
              'output.col.stepAction',
              'output.col.variable',
              'output.col.chiSquare',
              'output.col.df',
              'output.col.sig'
            ],
            rows: [
              [1, 'output.col.entered', 'signal', 42.118, 1, 0.000001],
              [2, 'output.col.removed', 'noise1', 0.104, 1, 0.747102]
            ],
            footnoteKey: null
          },
          {
            titleKey: 'output.cox.stepOmnibusTitle',
            columns: [
              'output.col.step',
              'output.col.neg2LL',
              'output.col.chiSquare',
              'output.col.df',
              'output.col.sig'
            ],
            rows: [[1, 244.868, 42.118, 1, 0.000001]],
            footnoteKey: null
          },
          {
            titleKey: 'output.cox.notInEquationTitle',
            columns: [
              'output.col.variable',
              'output.col.chiSquare',
              'output.col.df',
              'output.col.sig'
            ],
            rows: [['noise2', 0.512, 1, 0.474211]],
            footnoteKey: null
          },
          {
            // Categorical covariate: header row with the multi-df Wald, then
            // one row per contrast — the shape the Categorical sub-dialog adds.
            titleKey: 'output.cox.equationTitle',
            columns: [
              'output.col.model',
              'output.col.b',
              'output.col.stdError',
              'output.col.wald',
              'output.col.df',
              'output.col.sig',
              'output.col.expB',
              'output.col.expBLower',
              'output.col.expBUpper'
            ],
            rows: [
              ['grade', '', '', 17.086, 2, 0.000195, '', '', ''],
              ['grade(1)', 0.716773, 0.231847, 9.558, 1, 0.001991, 2.048, 1.3, 3.226],
              ['grade(2)', -0.234342, 0.231759, 1.022, 1, 0.311948, 0.791, 0.502, 1.246]
            ],
            footnoteKey: null
          },
          {
            titleKey: 'output.cox.correlationTitle',
            columns: ['output.col.variable', 'grade(1)', 'grade(2)'],
            rows: [
              ['grade(1)', 1, -0.502],
              ['grade(2)', -0.502, 1]
            ],
            footnoteKey: null
          },
          {
            titleKey: 'output.cox.baselineTitle',
            columns: [
              'output.col.time',
              'output.col.cumHazard',
              'output.col.cumSurvival',
              'output.col.stdError'
            ],
            rows: [[4.2, 0.0513, 0.95, 0.0487]],
            footnoteKey: null
          },
          {
            titleKey: 'output.cox.phTestTitle',
            columns: [
              'output.col.variable',
              'output.col.chiSquare',
              'output.col.df',
              'output.col.sig'
            ],
            rows: [
              ['grade(1)', 0.884, 1, 0.347102],
              ['output.col.global', 1.912, 2, 0.384419]
            ],
            footnoteKey: null
          }
        ],
        [
          plot('output.cox.survPlotTitle'),
          plot('output.cox.oneMinusPlotTitle'),
          plot('output.cox.hazardPlotTitle'),
          plot('output.cox.logMinusLogPlotTitle')
        ],
        ['output.cox.epvWarn:24|3', 'output.cox.separateNotCategorical'],
        [
          // Three pipe-separated parameters, the middle one itself a key that
          // has to resolve recursively into the contrast's translated name.
          'output.cox.contrastNote:grade|output.cox.contrast.indicator|mid',
          'output.cox.refModalNote',
          'output.cox.stepLRNote',
          'output.cox.phNote',
          'output.cox.tiesEfronNote:7'
        ]
      )
    )
    T.useUIStore.getState().setActiveTab('output')
  })

  await win.waitForTimeout(2000)

  const info = await win.evaluate(() => {
    const bodyText = document.querySelector('[class*="content"]')?.textContent ?? ''
    const has = s => bodyText.includes(s)
    // Any surviving "output.*" / "analysis.*" token is an untranslated key.
    const leaks = [...new Set(bodyText.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z0-9.]+/g) || [])]
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      plots: document.querySelectorAll('.js-plotly-plot').length,
      // Cell VALUES that are keys, not just headers — these travel a different
      // path through the renderer than column labels do.
      hasEventCell: has('Olay') || has('Event'),
      hasCensoredCell: has('Sansürlü') || has('Censored'),
      hasBreslow: has('Breslow'),
      hasTaroneWare: has('Tarone-Ware'),
      hasGlobal: has('GENEL') || has('GLOBAL'),
      hasEntered: has('Girdi') || has('Entered'),
      // Multi-parameter notes must interpolate, not print "{{p0}}".
      hasContrastParams: has('grade') && (has('Gösterge') || has('Indicator')) && has('mid'),
      hasEpvNumbers: has('24') && has('3'),
      unresolvedPlaceholders: (bodyText.match(/\{\{[a-zA-Z0-9]+\}\}/g) || []).slice(0, 5),
      rawKeyLeaks: leaks.slice(0, 10)
    }
  })
  console.log(JSON.stringify(info, null, 2))

  const pass =
    info.tables === 13 &&
    info.plots === 8 &&
    info.hasEventCell &&
    info.hasCensoredCell &&
    info.hasBreslow &&
    info.hasTaroneWare &&
    info.hasGlobal &&
    info.hasEntered &&
    info.hasContrastParams &&
    info.hasEpvNumbers &&
    info.unresolvedPlaceholders.length === 0 &&
    info.rawKeyLeaks.length === 0

  // Pushing result blocks marks the Output dirty, so quitting raises the
  // "save your output?" guard — a native dialog that never returns headless.
  // Answer it with 1 ("don't save"), the same stub e2e-roc-survival.cjs uses.
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
