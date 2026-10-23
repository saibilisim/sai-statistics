// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: advanced procedures (Mixed Models, MDS, Life Tables, Ratio, Multiple
 * Response, Missing Values, GEE, Power). Injects representative tables and
 * asserts all i18n keys resolve (no raw output / analysis key leaks) and that
 * SPSS-style alignment holds. Render-only — does not execute R. */
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
    const add = (id, titleKey, tables) =>
      T.useOutputStore.getState().addBlock({
        id,
        analysisId: id,
        titleKey,
        timestamp: new Date().toISOString(),
        datasetName: 'e2e',
        result: { success: true, plots: [], warnings: [], notes: [], tables }
      })

    add('mixed', 'analysis.mixed.title', [
      {
        titleKey: 'output.mixed.fitTitle',
        columns: ['output.col.statistic', 'output.col.value'],
        rows: [
          ['output.mixed.m2ll', 166.756],
          ['output.col.aic', 176.756],
          ['output.col.bic', 184.811]
        ],
        footnoteKey: 'output.mixed.depFootnote:score'
      },
      {
        titleKey: 'output.mixed.fixedTitle',
        columns: [
          'output.col.model',
          'output.col.b',
          'output.col.stdError',
          'output.col.df',
          'output.col.t',
          'output.col.sig',
          'output.col.ciLower95',
          'output.col.ciUpper95'
        ],
        rows: [
          ['output.col.constant', 2.265, 1.696, 30, 1.335, 0.192, -1.2, 5.73],
          ['x1', 0.8, 0.108, 30, 7.436, 0, 0.58, 1.02]
        ],
        footnoteKey: null
      },
      {
        titleKey: 'output.mixed.covTitle',
        columns: ['output.col.parameter', 'output.col.variance', 'output.col.stdDev'],
        rows: [
          ['output.mixed.residualVar', 2.251, 1.5],
          ['output.mixed.interceptVar', 6.04, 2.458]
        ],
        footnoteKey: null
      }
    ])

    add('mds', 'analysis.mds.title', [
      {
        titleKey: 'output.mds.fitTitle',
        columns: ['output.col.statistic', 'output.col.value'],
        rows: [
          ['output.mds.stress1', 0.042],
          ['output.mds.rsq', 0.985]
        ],
        footnoteKey: null
      },
      {
        titleKey: 'output.mds.coordTitle',
        columns: ['output.col.object', 'output.mds.dim:1', 'output.mds.dim:2'],
        rows: [
          ['VarA', 0.55, -0.24],
          ['VarB', -0.16, 0.22]
        ],
        footnoteKey: null
      }
    ])

    add('lifetab', 'analysis.lifetab.title', [
      {
        titleKey: 'output.lifetab.title',
        columns: [
          'output.lifetab.intervalStart',
          'output.lifetab.entering',
          'output.lifetab.withdrawn',
          'output.lifetab.exposed',
          'output.lifetab.terminal',
          'output.lifetab.propTerm',
          'output.lifetab.propSurv',
          'output.lifetab.cumSurv'
        ],
        rows: [
          ['0', 20, 0, 20, 3, 0.15, 0.85, 1.0],
          ['3', 17, 3, 15.5, 3, 0.1935, 0.8065, 0.85]
        ],
        footnoteKey: null
      }
    ])

    add('ratio', 'analysis.ratio.title', [
      {
        titleKey: 'output.ratio.title',
        columns: [
          'output.ratio.group',
          'output.col.n',
          'output.ratio.median',
          'output.ratio.mean',
          'output.ratio.wmean',
          'output.col.min',
          'output.col.max',
          'output.col.range',
          'output.ratio.cod',
          'output.ratio.prd',
          'output.ratio.cov'
        ],
        rows: [
          [
            'output.ratio.overall',
            8,
            2.0,
            2.0176,
            1.9869,
            1.875,
            2.1818,
            0.3068,
            4.493,
            1.0155,
            5.656
          ]
        ],
        footnoteKey: null
      }
    ])

    add('mr', 'analysis.mr.title', [
      {
        titleKey: 'output.mr.title',
        columns: [
          'output.mr.category',
          'output.col.n',
          'output.mr.pctResponses',
          'output.mr.pctCases'
        ],
        rows: [
          ['Q1', 3, 30.0, 50.0],
          ['Q2', 3, 30.0, 50.0],
          ['output.mr.total', 10, 100.0, 166.7]
        ],
        footnoteKey: 'output.mr.casesFootnote:6'
      }
    ])

    add('missing', 'analysis.missing.title', [
      {
        titleKey: 'output.missing.uniTitle',
        columns: [
          'output.missing.variable',
          'output.col.n',
          'output.col.mean',
          'output.col.stdDeviation',
          'output.missing.count',
          'output.missing.percent'
        ],
        rows: [['A', 102, 0.05, 0.98, 18, 15.0]],
        footnoteKey: null
      },
      {
        titleKey: 'output.missing.mcarTitle',
        columns: ['output.col.chiSquare', 'output.col.df', 'output.col.sig'],
        rows: [[11.076, 9, 0.2705]],
        footnoteKey: null
      }
    ])

    add('gee', 'analysis.gee.title', [
      {
        titleKey: 'output.gee.infoTitle',
        columns: ['output.gee.item', 'output.col.value'],
        rows: [
          ['output.gee.depVar', 'y'],
          ['output.gee.distribution', 'poisson'],
          ['output.gee.corstr', 'exchangeable'],
          ['output.gee.subjects', '20']
        ],
        footnoteKey: null
      },
      {
        titleKey: 'output.gee.paramTitle',
        columns: [
          'output.col.model',
          'output.col.b',
          'output.col.stdError',
          'output.col.wald',
          'output.col.df',
          'output.col.sig',
          'output.col.expB'
        ],
        rows: [
          ['output.col.constant', 0.92, 0.06, 221.6, 1, 0, 2.51],
          ['x1', 0.54, 0.05, 100.3, 1, 0, 1.72]
        ],
        footnoteKey: null
      }
    ])

    add('glmm', 'analysis.glmm.title', [
      {
        titleKey: 'output.glmm.fitTitle',
        columns: ['output.col.statistic', 'output.col.value'],
        rows: [
          ['output.col.aic', 210.4],
          ['output.col.bic', 222.1],
          ['output.glmm.m2ll', 200.4],
          ['output.col.deviance', 198.2]
        ],
        footnoteKey: 'output.glmm.depFootnote:event'
      },
      {
        titleKey: 'output.glmm.fixedTitle',
        columns: [
          'output.col.model',
          'output.col.b',
          'output.col.stdError',
          'output.col.z',
          'output.col.sig',
          'output.col.expB'
        ],
        rows: [
          ['output.col.constant', -0.85, 0.21, -4.05, 0, 0.427],
          ['x1', 0.62, 0.14, 4.43, 0, 1.859]
        ],
        footnoteKey: null
      },
      {
        titleKey: 'output.glmm.randomTitle',
        columns: ['output.col.parameter', 'output.col.variance', 'output.col.stdDev'],
        rows: [['output.glmm.interceptVar', 0.48, 0.693]],
        footnoteKey: null
      }
    ])

    add('mi', 'analysis.mi.title', [
      {
        titleKey: 'output.mi.specTitle',
        columns: ['output.mi.variable', 'output.missing.count', 'output.mi.method'],
        rows: [
          ['A', 18, 'pmm'],
          ['B', 9, 'pmm']
        ],
        footnoteKey: 'output.mi.imputationsFootnote:5'
      },
      {
        titleKey: 'output.mi.pooledTitle',
        columns: [
          'output.mi.variable',
          'output.col.mean',
          'output.col.stdError',
          'output.col.ciLower95',
          'output.col.ciUpper95'
        ],
        rows: [['A', 0.512, 0.094, 0.328, 0.696]],
        footnoteKey: null
      }
    ])

    add('bayesTTestInd', 'analysis.bayesTTestInd.title', [
      {
        titleKey: 'output.bayes.bfTitle',
        columns: [
          'output.col.variable',
          'output.bayes.bf10',
          'output.bayes.bf01',
          'output.bayes.errorPct'
        ],
        rows: [['score', 151571.5063, 0, 0]],
        footnoteKey: 'output.bayes.priorFootnote:medium'
      },
      {
        titleKey: 'output.bayes.postTitle',
        columns: [
          'output.col.variable',
          'output.col.mean',
          'output.col.stdDeviation',
          'output.col.ciLower95',
          'output.col.ciUpper95'
        ],
        rows: [['score', -1.258, 0.2518, -1.7636, -0.7618]],
        footnoteKey: 'output.bayes.deltaFootnote'
      }
    ])

    add('power', 'analysis.power.title', [
      {
        titleKey: 'output.power.title',
        columns: ['output.power.parameter', 'output.col.value'],
        rows: [
          ['output.power.lblTest', 'output.power.test.tTwo'],
          ['output.power.effectSize', 0.5],
          ['output.power.alpha', 0.05],
          ['output.power.nPerGroup', 30],
          ['output.power.achieved', 0.4778],
          ['output.power.target', 0.8],
          ['output.power.reqNPerGroup', 64]
        ],
        footnoteKey: 'output.power.perGroupFootnote'
      }
    ])

    T.useUIStore.getState().setActiveTab('output')
  })

  await win.waitForTimeout(900)
  const info = await win.evaluate(() => {
    const bodyText = document.querySelector('[class*="content"]')?.textContent ?? ''
    const has = s => bodyText.includes(s)
    const leaks = (bodyText.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 12)
    const tds = Array.from(document.querySelectorAll('[class*="outputTable"] td'))
    const txt = tds.find(
      td => td.textContent.trim() === 'Residual' || td.textContent.trim() === 'Artık (Residual)'
    )
    const num = tds.find(td => td.textContent.trim() === '176.756')
    const alignOf = el => (el ? getComputedStyle(el).textAlign : 'none')
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      hasFixed: has('Estimates of Fixed Effects') || has('Sabit Etki Tahminleri'),
      hasMDS: has('Final Coordinates') || has('Nihai Koordinatlar'),
      hasLifeTable: has('Life Table') || has('Yaşam Tablosu'),
      hasRatio: has('Coefficient of Dispersion') || has('Dağılım Katsayısı'),
      hasMR: has('Percent of Responses') || has('Yanıt Yüzdesi'),
      hasMCAR: has("Little's MCAR Test") || has('Little MCAR Testi'),
      hasGEE: has('Working Correlation') || has('Çalışma Korelasyonu'),
      hasPower: has('Achieved Power') || has('Elde Edilen Güç'),
      hasPowerTest: has('Independent-Samples t Test') || has('Bağımsız Örneklem t Testi'),
      hasGLMM: has('Random Effect Covariances') || has('Rastgele Etki Kovaryansları'),
      hasMI: has('Pooled Univariate Statistics') || has('Havuzlanmış Tek Değişkenli'),
      hasBayes: has('Bayes Factors') || has('Bayes Faktörleri'),
      hasPosterior: has('Posterior Summary') || has('Sonsal'),
      hasDim: has('Dimension 1') || has('Boyut 1'),
      labelAlign: alignOf(txt),
      numAlign: alignOf(num),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  const pass =
    info.tables === 20 &&
    info.hasFixed &&
    info.hasMDS &&
    info.hasLifeTable &&
    info.hasRatio &&
    info.hasMR &&
    info.hasMCAR &&
    info.hasGEE &&
    info.hasPower &&
    info.hasPowerTest &&
    info.hasGLMM &&
    info.hasMI &&
    info.hasBayes &&
    info.hasPosterior &&
    info.hasDim &&
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
