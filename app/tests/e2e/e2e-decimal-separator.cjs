// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the output number format end to end, through the real Preferences
 * settings rather than the formatter:
 *
 *   - output.decimalSeparator 'dot' (the default) renders "0.848" / ".031",
 *     'comma' renders "0,848" / ",031";
 *   - the setting is INDEPENDENT of the UI language, in both directions:
 *     switching to Turkish leaves a dot setting alone, and switching to
 *     English leaves a comma setting alone. This is the regression that
 *     matters — the first implementation derived the separator from the
 *     language, so changing language silently reformatted existing output;
 *   - output.dropLeadingZero toggles ".031" vs "0.031" on p-values while
 *     leaving ordinary statistics ("0.848") alone.
 *
 * Driving the settings store covers the use-app-effects wiring too — that hook
 * is what pushes the format into output-format.ts.
 *
 * Run: node tests/e2e/e2e-decimal-separator.cjs   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)

  // A block with a plain statistic and a significance cell.
  await win.evaluate(() => {
    const T = window.__SAI_TEST__
    T.useOutputStore.getState().addBlock({
      id: 'dec-sep-1',
      analysisId: 'descriptives',
      titleKey: 'Decimal Separator Probe',
      timestamp: new Date().toISOString(),
      datasetName: 'probe',
      result: {
        success: true,
        tables: [
          {
            titleKey: 'Probe Table',
            columns: ['output.col.statistic', 'output.col.value', 'output.col.sig'],
            rows: [['Mean', 0.848, 0.031]],
            footnoteKey: null
          }
        ],
        plots: [],
        warnings: [],
        notes: []
      }
    })
    T.useUIStore.getState().setActiveTab('output')
  })
  await win.waitForTimeout(400)

  // Both settings persist, so leaving them changed would hand the next e2e
  // script a different UI — cross-test contamination this script would be the
  // cause of. Capture and restore.
  const original = await win.evaluate(() => {
    const s = window.__SAI_TEST__.useSettingsStore.getState().settings
    return {
      language: s.appearance.language,
      decimalSeparator: s.output.decimalSeparator,
      dropLeadingZero: s.output.dropLeadingZero
    }
  })

  /** Apply a language + output format, then read the rendered cells back. */
  const cellsFor = async (language, decimalSeparator, dropLeadingZero) => {
    await win.evaluate(
      cfg => {
        const store = window.__SAI_TEST__.useSettingsStore.getState()
        store.setLanguage(cfg.language)
        store.setSetting('output', {
          decimalSeparator: cfg.decimalSeparator,
          dropLeadingZero: cfg.dropLeadingZero
        })
      },
      { language, decimalSeparator, dropLeadingZero }
    )
    await win.waitForTimeout(600)
    return win.evaluate(() =>
      Array.from(document.querySelectorAll('#block-dec-sep-1 tbody tr td')).map(td =>
        (td.textContent || '').trim()
      )
    )
  }

  const dotEn = await cellsFor('en', 'dot', true)
  const commaEn = await cellsFor('en', 'comma', true)
  // The same two settings under a comma-locale UI: the language must not move
  // them. dotInTr is the case that failed before the setting existed.
  const dotInTr = await cellsFor('tr', 'dot', true)
  const commaInTr = await cellsFor('tr', 'comma', true)
  const keepZero = await cellsFor('en', 'dot', false)

  await win.evaluate(cfg => {
    const store = window.__SAI_TEST__.useSettingsStore.getState()
    store.setLanguage(cfg.language)
    store.setSetting('output', {
      decimalSeparator: cfg.decimalSeparator,
      dropLeadingZero: cfg.dropLeadingZero
    })
  }, original)
  await win.waitForTimeout(400)

  console.log('RESULT:' + JSON.stringify({ dotEn, commaEn, dotInTr, commaInTr, keepZero, errors }))

  const hasDotDecimal = cells => cells.some(c => /\d\.\d/.test(c))
  const hasCommaDecimal = cells => cells.some(c => /\d,\d/.test(c))

  const pass =
    // The setting alone decides the mark...
    dotEn.includes('0.848') &&
    dotEn.includes('.031') &&
    !hasCommaDecimal(dotEn) &&
    commaEn.includes('0,848') &&
    commaEn.includes(',031') &&
    !hasDotDecimal(commaEn) &&
    // ...and the language does not move it, either way round.
    dotInTr.includes('0.848') &&
    dotInTr.includes('.031') &&
    !hasCommaDecimal(dotInTr) &&
    commaInTr.includes('0,848') &&
    commaInTr.includes(',031') &&
    !hasDotDecimal(commaInTr) &&
    // dropLeadingZero off restores the zero on the p-value, and the ordinary
    // statistic is unaffected either way.
    keepZero.includes('0.031') &&
    keepZero.includes('0.848') &&
    errors.length === 0

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

main().catch(e => {
  console.error(e)
  process.exit(1)
})
