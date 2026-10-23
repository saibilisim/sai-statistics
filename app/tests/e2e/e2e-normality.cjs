// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: the Normality View (4th tab).
 *
 * Imports a CSV with three numeric (scale) columns so the dataset has real
 * scale-measure variables, then injects a deterministic normality result into
 * `normality-store` (keyed to the imported dataset so the view does NOT kick off
 * a real R run) and switches to the Normality tab. Asserts the AG Grid renders
 * one row per scale variable with translated headers + decision badges + inline
 * sparklines (no raw output.normality.* key leaks), and that clicking a row
 * renders the four detail plots (histogram / Q-Q / detrended / boxplot).
 *
 * Mirrors the inject-into-store pattern of e2e-compare-means / e2e-crosstabs so
 * it doesn't depend on the R toolchain being present. R correctness for
 * normality.R is validated separately.
 *
 * Run: xvfb-run -a node tests/e2e/e2e-normality.cjs   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')

function makeCsv() {
  // Non-integer values on purpose: import infers whole-number columns with few
  // distinct values as Nominal codes (SPSS's rule, type-inference.ts
  // deriveMeasure), which would leave only `skewed` as a scale variable.
  const lines = ['approx_normal,skewed,constant']
  for (let i = 0; i < 40; i++) {
    lines.push(`${100.5 + (i % 7)},${i * i * 0.1},5.5`)
  }
  const file = path.join(os.tmpdir(), 'sai-normality-e2e.csv')
  fs.writeFileSync(file, lines.join('\n'))
  return file
}

async function main() {
  const csvPath = makeCsv()

  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  win.on('pageerror', err => {
    console.log('[pageerror]', err.message)
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)

  // Import the CSV → numeric columns become scale-measure variables.
  const setup = await win.evaluate(async filePath => {
    const result = await window.api.file.import({ filePath })
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
    const scale = result.variables.filter(v => v.measure === 'scale')
    return { datasetId: result.dataset.id, colIds: scale.map(v => v.colId) }
  }, csvPath)
  console.log('setup:', JSON.stringify(setup))
  await win.waitForTimeout(800)

  // Inject a deterministic normality result keyed to the imported dataset, so
  // the auto-run sees a fresh result and never spawns R.
  await win.evaluate(({ datasetId, colIds }) => {
    const spark = JSON.stringify([1, 3, 6, 9, 12, 9, 6, 3, 1])
    const plotFor = colId => {
      const mk = kind => ({
        titleKey: `${colId}|${kind}`,
        type: 'plotly',
        data: {
          data: [{ type: 'scatter', x: [1, 2, 3], y: [1, 2, 3] }],
          layout: {}
        }
      })
      return [mk('histogram'), mk('qq'), mk('detrended'), mk('boxplot')]
    }
    // Row layout MUST match FIELDS in NormalityView.tsx / NORMALITY_COLUMNS in normality.R.
    const row = (name, colId, dec, ksSig, swSig) => [
      name,
      40,
      0,
      102.5,
      102,
      2.1,
      100,
      106,
      6,
      0.12,
      0.37,
      0.32,
      -0.8,
      0.73,
      -1.1,
      0.09,
      40,
      ksSig,
      0.97,
      40,
      swSig,
      dec,
      colId,
      spark
    ]
    const [c0, c1, c2] = colIds
    const result = {
      success: true,
      tables: [
        {
          titleKey: 'output.normality.title',
          columns: [
            'output.normality.col.variable',
            'output.normality.col.n',
            'output.normality.col.missing',
            'output.normality.col.mean',
            'output.normality.col.median',
            'output.normality.col.sd',
            'output.normality.col.min',
            'output.normality.col.max',
            'output.normality.col.range',
            'output.normality.col.skewness',
            'output.normality.col.seSkewness',
            'output.normality.col.zSkewness',
            'output.normality.col.kurtosis',
            'output.normality.col.seKurtosis',
            'output.normality.col.zKurtosis',
            'output.normality.col.ksStat',
            'output.normality.col.ksDf',
            'output.normality.col.ksSig',
            'output.normality.col.swStat',
            'output.normality.col.swDf',
            'output.normality.col.swSig',
            'output.normality.col.decision',
            '__colId',
            '__spark'
          ],
          rows: [
            row('approx_normal', c0, 'normal', 0.2, 0.21),
            row('skewed', c1, 'notNormal', 0.0008, 0.0001),
            row('constant', c2, 'na', null, null)
          ],
          footnoteKey: null
        }
      ],
      plots: [...plotFor(c0), ...plotFor(c1)],
      warnings: [],
      notes: []
    }
    window.__SAI_TEST__.useNormalityStore.getState().setResult(datasetId, result)
  }, setup)

  // Open the Normality tab.
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().setActiveTab('normality')
  })
  await win.waitForTimeout(1500)

  // IMPORTANT: DataView stays MOUNTED (just hidden) across tab switches and is
  // now an AG Grid too, so bare `.ag-row` / `.ag-header-cell-text` selectors
  // match BOTH grids — that's what made this script read DataView's 40 rows
  // and scroll the wrong viewport (denetim raporu §5). Every query below is
  // scoped to NormalityView's own root via its data-testid.
  const SCOPE = '[data-testid="normality-view"]'

  const grid = await win.evaluate(scope => {
    const root = document.querySelector(scope)
    const has = s => (root?.textContent ?? '').includes(s)
    const headerText = Array.from(root?.querySelectorAll('.ag-header-cell-text') ?? [])
      .map(e => e.textContent?.trim())
      .filter(Boolean)
    const dataRows = root?.querySelectorAll('.ag-center-cols-container .ag-row').length ?? 0
    const sparkBars = root?.querySelectorAll('[class*="sparkBar"]').length ?? 0
    const badges = root?.querySelectorAll('[class*="badge"]').length ?? 0
    const paneText = root?.textContent ?? ''
    const leaks = (paneText.match(/output\.normality\.[a-zA-Z.]+/g) || []).slice(0, 10)
    return {
      dataRows,
      sparkBars,
      badges,
      headerText,
      hasMean: has('Mean') || has('Ortalama'),
      hasDecision: has('Decision') || has('Karar'),
      hasKsSig: has('K-S Sig.') || has('K-S Anlm.'),
      hasSwSig: has('S-W Sig.') || has('S-W Anlm.'),
      hasNormal: has('Normal'),
      hasNotNormal: has('Not normal') || has('Normal değil'),
      hasNa: has('N/A') || has('Yok'),
      leaks
    }
  }, SCOPE)
  console.log('grid:', JSON.stringify(grid, null, 2))

  // AG Grid virtualizes off-screen columns, so the wide stats columns only enter
  // the DOM when scrolled into view. Sweep the horizontal range and union every
  // header label we observe, then assert the key stats columns all resolve.
  const allHeaders = new Set(grid.headerText)
  for (const frac of [0.33, 0.66, 1]) {
    await win.evaluate(
      ([f, scope]) => {
        const vp = document.querySelector(scope)?.querySelector('.ag-center-cols-viewport')
        if (vp) vp.scrollLeft = vp.scrollWidth * f
      },
      [frac, SCOPE]
    )
    await win.waitForTimeout(500)
    const hs = await win.evaluate(
      scope =>
        Array.from(document.querySelector(scope)?.querySelectorAll('.ag-header-cell-text') ?? [])
          .map(e => e.textContent?.trim())
          .filter(Boolean),
      SCOPE
    )
    hs.forEach(h => allHeaders.add(h))
  }
  const headers = [...allHeaders]
  const hh = s => headers.includes(s)
  const scrolled = {
    headers,
    hasKsSig: hh('K-S Sig.') || hh('K-S Anlm.'),
    hasSwSig: hh('S-W Sig.') || hh('S-W Anlm.'),
    hasSkew: hh('Skewness') || hh('Çarpıklık'),
    hasKurt: hh('Kurtosis') || hh('Basıklık')
  }
  console.log('union headers:', JSON.stringify(scrolled, null, 2))

  // Click the first data row → detail plots should render.
  await win.evaluate(scope => {
    const cell = document
      .querySelector(scope)
      ?.querySelector('.ag-center-cols-container .ag-row[row-index="0"] .ag-cell')
    if (cell) cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, SCOPE)
  await win.waitForTimeout(2500)

  const detail = await win.evaluate(scope => {
    const root = document.querySelector(scope)
    return {
      plotCards: root?.querySelectorAll('[class*="plotCard"]').length ?? 0,
      plotlyCharts: root?.querySelectorAll('.js-plotly-plot').length ?? 0
    }
  }, SCOPE)
  console.log('detail:', JSON.stringify(detail))

  await win.screenshot({ path: __dirname + '/../../e2e-normality.png', fullPage: true })

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })

  const pass =
    setup.colIds.length === 3 &&
    grid.dataRows === 3 &&
    grid.sparkBars > 0 &&
    grid.badges >= 3 &&
    grid.hasMean &&
    grid.hasDecision &&
    scrolled.hasKsSig &&
    scrolled.hasSwSig &&
    scrolled.hasSkew &&
    scrolled.hasKurt &&
    grid.hasNormal &&
    grid.hasNotNormal &&
    grid.hasNa &&
    grid.leaks.length === 0 &&
    detail.plotCards === 4 &&
    detail.plotlyCharts === 4

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
