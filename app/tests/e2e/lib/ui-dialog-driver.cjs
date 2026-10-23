// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Shared dialog driver for the menu -> dialog e2e scripts.
 *
 * e2e-ui-syntax.cjs (SPSS parity: Paste Syntax + OK payloads) and
 * e2e-analysis-pyparity.cjs (results checked against Python) drive the same
 * dialogs the same way: open through the real menu channel, push variables
 * into fields with the ▶ buttons, tick sub-dialog options, fill text fields.
 * Selections are keyed by i18n label keys, not literal text, so the scripts
 * survive relabeling and run under any UI language.
 */
const fs = require('node:fs')
const path = require('node:path')

const APP_DIR = path.join(__dirname, '..', '..', '..')

const SCENARIOS = [
  {
    id: 'frequencies-age',
    channel: 'menu:analyze:frequencies',
    vars: [['age', 0]],
    subs: [
      {
        button: 'analysis:shell.btnStatistics',
        check: [
          'analysis:frequencies.stats.mean',
          'analysis:frequencies.stats.sd',
          'analysis:frequencies.stats.min',
          'analysis:frequencies.stats.max'
        ]
      }
    ]
  },
  {
    id: 'crosstabs-grp3-disease',
    channel: 'menu:analyze:crosstabs',
    vars: [
      ['grp3', 0],
      ['disease', 1]
    ],
    subs: [
      // Chi-square is on by default; add Phi/Cramer and Expected counts.
      { button: 'analysis:shell.btnStatistics', check: ['analysis:crosstabs.stats.phiCramer'] },
      { button: 'analysis:shell.btnCells', check: ['analysis:crosstabs.cells.expected'] }
    ]
  },
  {
    id: 'ttest-ind-score-income',
    channel: 'menu:analyze:independent-ttest',
    vars: [
      ['score', 0],
      ['income', 0],
      ['grp2', 1]
    ],
    texts: ['1', '2'] // Define Groups: group1, group2
  },
  {
    id: 'ttest1-score-income',
    channel: 'menu:analyze:onesample-ttest',
    vars: [
      ['score', 0],
      ['income', 0]
    ],
    texts: ['50'] // Test Value
  },
  {
    id: 'ttest-paired',
    channel: 'menu:analyze:paired-ttest',
    vars: [
      ['pre', 0],
      ['post', 1],
      ['score', 0],
      ['income', 1]
    ]
  },
  {
    id: 'means-score-income-grp3',
    channel: 'menu:analyze:means',
    vars: [
      ['score', 0],
      ['income', 0],
      ['grp3', 1]
    ],
    subs: [
      // Default cells are N/Mean/SD; add median/min/max → /CELLS.
      {
        button: 'analysis:means.btnCells',
        check: ['analysis:col.median', 'analysis:col.min', 'analysis:col.max']
      }
    ]
  },
  {
    id: 'descriptives-score-income',
    channel: 'menu:analyze:descriptives',
    vars: [
      ['score', 0],
      ['income', 0]
    ],
    subs: [
      // Defaults are mean/sd/min/max; add variance + range → /STATISTICS.
      {
        button: 'analysis:shell.btnOptions',
        check: ['analysis:descriptives.options.variance', 'analysis:descriptives.options.range']
      }
    ]
  },
  {
    id: 'correlate-spearman',
    channel: 'menu:analyze:correlate-bivariate',
    vars: [
      ['score', 0],
      ['income', 0],
      ['age', 0]
    ],
    // Spearman alone: the dialog then pastes NONPAR CORR, SPSS's own command
    // for rank correlations (CORRELATIONS covers Pearson only).
    mainUnchecks: ['analysis:correlate.pearson'],
    mainChecks: ['analysis:correlate.spearman']
  },
  {
    id: 'oneway-score-income-grp3',
    channel: 'menu:analyze:oneway-anova',
    vars: [
      ['score', 0],
      ['income', 0],
      ['grp3', 1]
    ],
    subs: [
      { button: 'analysis:shell.btnPostHoc', check: ['analysis:anova.tukey'] },
      {
        button: 'analysis:shell.btnOptions',
        check: ['analysis:anova.homogeneity', 'analysis:anova.welch']
      }
    ]
  },
  {
    id: 'regression-linear',
    channel: 'menu:analyze:regression-linear',
    vars: [
      ['income', 0],
      ['score', 1],
      ['age', 1]
    ],
    subs: [
      {
        button: 'analysis:shell.btnStatistics',
        check: ['analysis:regression.collinearity', 'analysis:regression.durbinWatson']
      }
    ]
  },
  // ── Nonparametric family: one NPAR TESTS sub-command per dialog ─────────
  {
    id: 'npar-chisquare-grp3',
    channel: 'menu:analyze:npar-chisquare',
    vars: [['grp3', 0]]
  },
  {
    id: 'npar-binomial-disease',
    channel: 'menu:analyze:npar-binomial',
    vars: [['disease', 0]],
    texts: ['0.5'] // Test Proportion
  },
  {
    id: 'npar-ks-score',
    channel: 'menu:analyze:npar-ks',
    vars: [['score', 0]]
  },
  {
    id: 'npar-runs-score',
    channel: 'menu:analyze:npar-runs',
    vars: [['score', 0]]
  },
  {
    id: 'npar-mw-score-income',
    channel: 'menu:analyze:npar-2indep',
    vars: [
      ['score', 0],
      ['income', 0],
      ['grp2', 1]
    ],
    texts: ['1', '2'] // Define Groups
  },
  {
    id: 'npar-wilcoxon-pairs',
    channel: 'menu:analyze:npar-2related',
    vars: [
      ['pre', 0],
      ['score', 0],
      ['post', 1],
      ['income', 1]
    ]
  },
  {
    id: 'npar-kw-score-income',
    channel: 'menu:analyze:npar-kindep',
    vars: [
      ['score', 0],
      ['income', 0],
      ['grp3', 1]
    ]
  },
  {
    id: 'npar-friedman-q1-q5',
    channel: 'menu:analyze:npar-krelated',
    vars: [
      ['q1', 0],
      ['q2', 0],
      ['q3', 0],
      ['q4', 0],
      ['q5', 0]
    ]
  },
  // ── Scale / Reports / Correlate / Regression ────────────────────────────
  {
    id: 'reliability-q1-q5',
    channel: 'menu:analyze:reliability',
    vars: [
      ['q1', 0],
      ['q2', 0],
      ['q3', 0],
      ['q4', 0],
      ['q5', 0]
    ]
  },
  {
    id: 'partial-corr-score-income-age',
    channel: 'menu:analyze:correlate-partial',
    vars: [
      ['score', 0],
      ['income', 0],
      ['age', 1]
    ]
  },
  {
    id: 'case-summaries-score-income-grp3',
    channel: 'menu:analyze:case-summaries',
    vars: [
      ['score', 0],
      ['income', 0],
      ['grp3', 1]
    ]
  },
  {
    id: 'olap-cubes-score-income-grp3',
    channel: 'menu:analyze:olap-cubes',
    vars: [
      ['score', 0],
      ['income', 0],
      ['grp3', 1]
    ]
  },
  {
    id: 'ratio-income-score-grp3',
    channel: 'menu:analyze:ratio',
    vars: [
      ['income', 0],
      ['score', 1],
      ['grp3', 2]
    ]
  },
  {
    id: 'roc-score-disease',
    channel: 'menu:analyze:roc',
    vars: [
      ['score', 0],
      ['disease', 1]
    ],
    texts: ['1'] // State Variable value
  },
  {
    id: 'curve-income-score',
    channel: 'menu:analyze:regression-curve',
    vars: [
      ['income', 0],
      ['score', 1]
    ]
  },
  {
    id: 'logistic-disease-score-age',
    channel: 'menu:analyze:regression-logistic',
    vars: [
      ['disease', 0],
      ['score', 1],
      ['age', 1]
    ]
  },
  // ── GLM / Dimension / Classify / Survival ───────────────────────────────
  {
    id: 'glm-uni-score-grp3',
    channel: 'menu:analyze:glm-univariate',
    vars: [
      ['score', 0],
      ['grp3', 1]
    ]
  },
  {
    id: 'factor-q1-q5',
    channel: 'menu:analyze:factor',
    vars: [
      ['q1', 0],
      ['q2', 0],
      ['q3', 0],
      ['q4', 0],
      ['q5', 0]
    ]
  },
  {
    id: 'discriminant-grp2-score-age',
    channel: 'menu:analyze:discriminant',
    vars: [
      ['grp2', 0],
      ['score', 1],
      ['age', 1]
    ]
  },
  {
    id: 'kmeans-score-age',
    channel: 'menu:analyze:kmeans',
    vars: [
      ['score', 0],
      ['age', 0]
    ]
  },
  {
    id: 'hierarchical-q1-q3',
    channel: 'menu:analyze:hierarchical',
    vars: [
      ['q1', 0],
      ['q2', 0],
      ['q3', 0]
    ]
  },
  {
    id: 'distances-q1-q3',
    channel: 'menu:analyze:distances',
    vars: [
      ['q1', 0],
      ['q2', 0],
      ['q3', 0]
    ]
  },
  {
    id: 'km-surv-evt-grp2',
    channel: 'menu:analyze:survival-km',
    vars: [
      ['surv', 0],
      ['evt', 1],
      ['grp2', 2]
    ],
    texts: ['1'] // event value
  },
  {
    id: 'cox-surv-evt-score-age',
    channel: 'menu:analyze:survival-cox',
    vars: [
      ['surv', 0],
      ['evt', 1],
      ['score', 2],
      ['age', 2]
    ],
    texts: ['1'] // event value
  },
  // ── The rest of the Analyze menu ────────────────────────────────────────
  {
    id: 'glm-multi-score-income-grp3',
    channel: 'menu:analyze:glm-multivariate',
    vars: [
      ['score', 0],
      ['income', 0],
      ['grp3', 1]
    ]
  },
  {
    id: 'glm-repeated-q1-q3',
    channel: 'menu:analyze:glm-repeated',
    vars: [
      ['q1', 0],
      ['q2', 0],
      ['q3', 0]
    ]
  },
  {
    id: 'mult-response-d1-d3',
    channel: 'menu:analyze:multiple-response',
    vars: [
      ['d1', 0],
      ['d2', 0],
      ['d3', 0]
    ],
    texts: ['1'] // counted value
  },
  {
    id: 'multinomial-grp3-score-age',
    channel: 'menu:analyze:regression-multinomial',
    vars: [
      ['grp3', 0],
      ['score', 1],
      ['age', 1]
    ]
  },
  {
    id: 'ordinal-grp3-score-age',
    channel: 'menu:analyze:regression-ordinal',
    vars: [
      ['grp3', 0],
      ['score', 2],
      ['age', 2]
    ]
  },
  {
    id: 'probit-disease-score',
    channel: 'menu:analyze:regression-probit',
    vars: [
      ['disease', 0],
      ['score', 1],
      // buildSyntax.probit (spss-syntax.ts) requires at least one covariate —
      // Response Frequency + Total Observed alone paste nothing (PROBIT's own
      // dose-response covariate is not optional), which left the dialog open
      // after Paste and cascaded into "a previous dialog was still open" on
      // every scenario that followed.
      ['age', 3]
    ]
  },
  {
    id: 'lifetables-surv-evt',
    channel: 'menu:analyze:life-tables',
    vars: [
      ['surv', 0],
      ['evt', 1]
    ],
    texts: ['5'] // interval width
  },
  {
    id: 'mixed-score-age-grp3',
    channel: 'menu:analyze:mixed-models',
    vars: [
      // fields: Dependent(0), Factors(1), Covariates(2), Subjects(3)
      ['score', 0],
      ['age', 2],
      ['grp3', 3]
    ]
  },
  {
    id: 'genlin-evt-score-age',
    channel: 'menu:analyze:genlin',
    vars: [
      ['evt', 0],
      ['score', 1],
      ['age', 1]
    ]
  },
  {
    id: 'mva-score-income-post',
    channel: 'menu:analyze:missing-values',
    vars: [
      ['score', 0],
      ['income', 0],
      ['post', 0]
    ]
  },
  // ── SPSS 27+ procedures: these go into ui-job32.sps and run on SPSS 32 ──
  {
    id: 'proportions-one-disease',
    channel: 'menu:analyze:proportions-one',
    spss32: true,
    vars: [['disease', 0]],
    texts: ['1'] // success value (test value .5 and CI 95 are the sub-dialog defaults)
  },
  {
    id: 'glmm-disease-score-grp3',
    channel: 'menu:analyze:glmm',
    spss32: true,
    vars: [
      ['disease', 0],
      ['score', 1],
      ['grp3', 2]
    ]
  },
  // ── The dialogs whose SPSS command had to be taught to the parser first ──
  {
    id: 'knn-disease-score-age',
    channel: 'menu:analyze:knn',
    vars: [
      ['disease', 0],
      ['score', 1],
      ['age', 1]
    ],
    texts: ['5'] // neighbours
  },
  {
    id: 'tree-disease-score-age',
    channel: 'menu:analyze:tree',
    vars: [
      ['disease', 0],
      ['score', 1],
      ['age', 1]
    ],
    texts: ['20', '3'] // minimum cases, maximum depth
  },
  {
    id: 'gee-score-age-grp3',
    channel: 'menu:analyze:gee',
    vars: [
      ['score', 0],
      ['age', 1],
      ['grp3', 2]
    ]
  },
  {
    id: 'mds-q1-q3',
    channel: 'menu:analyze:mds',
    vars: [
      ['q1', 0],
      ['q2', 0],
      ['q3', 0]
    ]
  },
  {
    id: 'mi-score-income',
    channel: 'menu:analyze:mi',
    vars: [
      ['score', 0],
      ['income', 0]
    ],
    texts: ['5'] // imputations
  },
  {
    id: 'report-rows-score-grp3',
    channel: 'menu:analyze:report-summaries',
    vars: [
      ['score', 0],
      ['grp3', 1]
    ]
  },
  {
    id: 'report-columns-score-grp3',
    channel: 'menu:analyze:report-columns',
    vars: [
      ['score', 0],
      ['grp3', 1]
    ]
  },
  {
    id: 'chart-histogram-score',
    channel: 'menu:graphs:histogram',
    vars: [['score', 0]]
  },
  {
    id: 'roc-analysis-score-disease',
    channel: 'menu:analyze:roc-analysis',
    spss32: true,
    vars: [
      ['score', 0],
      ['disease', 1]
    ],
    texts: ['1'] // state value
  },
  {
    id: 'power-onesample',
    channel: 'menu:analyze:power',
    spss32: true,
    // No variables at all: the only data-free procedure in the menu.
    texts: []
  },
  {
    id: 'explore-score-income-grp3',
    channel: 'menu:analyze:explore',
    vars: [
      ['score', 0],
      ['income', 0],
      ['grp3', 1]
    ],
    subs: [
      {
        button: 'analysis:shell.btnStatistics',
        check: ['analysis:explore.stats.percentiles', 'analysis:explore.stats.outliers']
      },
      { button: 'analysis:shell.btnPlots', check: ['analysis:explore.plots.histogram'] }
    ]
  }
]

/** Resolve 'namespace:a.b.c' against the locale files the app ships. */
function makeT(lang) {
  const read = ns =>
    JSON.parse(
      fs.readFileSync(path.join(APP_DIR, 'src', 'i18n', 'locales', lang, `${ns}.json`), 'utf8')
    )
  const catalogs = { analysis: read('analysis'), common: read('common') }
  return key => {
    const [ns, ...rest] = key.split(':')
    let node = catalogs[ns]
    for (const part of rest.join(':').split('.')) node = node?.[part]
    if (typeof node !== 'string') throw new Error(`label key missing: ${key} (${lang})`)
    return node
  }
}

/**
 * Dialog helpers bound to one app window. Problems that should fail the run
 * (a dialog that never opened, a checkbox that is not there) go to `fails`.
 */
function createDriver({ app, win, t, fails }) {
  const openDialog = async (channel, label, needsList = true) => {
    // Wait for the previous dialog to be gone first. Without this a scenario
    // whose dialog is still up would have its selections made on the OLD
    // dialog — and every later scenario would cascade off it.
    const tClose = Date.now()
    for (;;) {
      const open = await win.evaluate(() => Boolean(document.querySelector('[role="dialog"]')))
      if (!open) break
      if (Date.now() - tClose > 10000) {
        // Report it once, then force it shut. Leaving it up meant every later
        // scenario made its selections on the STALE dialog — one wedged dialog
        // used to surface as ~20 failures across unrelated procedures, which
        // is how the real cause stayed hidden. Escape unwinds sub-dialogs too,
        // so keep pressing while anything is still open.
        fails.push(`${label}: a previous dialog was still open (forced closed)`)
        for (let i = 0; i < 5; i++) {
          const stillOpen = await win.evaluate(
            () => document.querySelectorAll('[role="dialog"]').length
          )
          if (!stillOpen) break
          await win.keyboard.press('Escape')
          await win.waitForTimeout(300)
        }
        break
      }
      await win.waitForTimeout(200)
    }
    await app.evaluate(({ BrowserWindow }, ch) => {
      BrowserWindow.getAllWindows()[0].webContents.send(ch)
    }, channel)
    const t0 = Date.now()
    for (;;) {
      // Power Analysis has no variable list at all (it computes from numbers),
      // so for it "the dialog is up" cannot mean "a listbox exists".
      const ready = await win.evaluate(
        wantList =>
          wantList
            ? Boolean(document.querySelector('[role="dialog"] [role="listbox"]'))
            : Boolean(document.querySelector('[role="dialog"]')),
        needsList
      )
      if (ready) return true
      if (Date.now() - t0 > 30000) {
        fails.push(`${label}: dialog body never appeared`)
        return false
      }
      await win.waitForTimeout(400)
    }
  }

  /** Select a source variable by name, then push it into the nth field. */
  const assign = async (varName, fieldIndex) => {
    await win.evaluate(name => {
      const box = document.querySelector('[role="dialog"] [role="listbox"]')
      const item = Array.from(box?.querySelectorAll('*') ?? []).find(
        el => el.children.length === 0 && (el.textContent || '').trim() === name
      )
      if (item) item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }, varName)
    await win.waitForTimeout(150)
    await win.evaluate(idx => {
      const btns = Array.from(document.querySelectorAll('[role="dialog"] button')).filter(
        b => (b.textContent || '').trim() === '▶'
      )
      btns[idx]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }, fieldIndex)
    await win.waitForTimeout(200)
  }

  /** Click the one main-dialog button with this exact label. */
  const clickMainButton = async text =>
    await win.evaluate(txt => {
      const main = document.querySelectorAll('[role="dialog"]')[0]
      const btn = Array.from(main?.querySelectorAll('button') ?? []).find(
        b => (b.textContent || '').trim() === txt
      )
      if (!btn) return false
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    }, text)

  /** Open a side-button sub-dialog and wait for the nested [role=dialog]. */
  const openSub = async buttonText => {
    const clicked = await clickMainButton(buttonText)
    if (!clicked) return false
    const t0 = Date.now()
    for (;;) {
      const n = await win.evaluate(() => document.querySelectorAll('[role="dialog"]').length)
      if (n >= 2) return true
      if (Date.now() - t0 > 5000) return false
      await win.waitForTimeout(200)
    }
  }

  /** Tick a checkbox row in the innermost dialog by its label text. */
  const checkOption = async labelText => await setOption(labelText, true)

  /** Untick a checkbox row (e.g. turning Pearson off before Spearman). */
  const uncheckOption = async labelText => await setOption(labelText, false)

  const setOption = async (labelText, want) =>
    await win.evaluate(
      ([txt, w]) => {
        const dialogs = document.querySelectorAll('[role="dialog"]')
        const sub = dialogs[dialogs.length - 1]
        const label = Array.from(sub.querySelectorAll('label')).find(l =>
          (l.textContent || '').replace(/\s+/g, ' ').trim().includes(txt)
        )
        // A radio row (e.g. a reference-category choice) is "checked" by selecting it.
        const input = label?.querySelector('input[type="checkbox"], input[type="radio"]')
        if (!input) return false
        if (Boolean(input.checked) !== Boolean(w))
          input.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return true
      },
      [labelText, want]
    )

  /** Close the innermost sub-dialog via its Continue button. */
  const continueSub = async continueText => {
    const clicked = await win.evaluate(txt => {
      const dialogs = document.querySelectorAll('[role="dialog"]')
      const sub = dialogs[dialogs.length - 1]
      const btn = Array.from(sub.querySelectorAll('button')).find(
        b => (b.textContent || '').trim() === txt
      )
      if (!btn) return false
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    }, continueText)
    if (!clicked) return false
    const t0 = Date.now()
    for (;;) {
      const n = await win.evaluate(() => document.querySelectorAll('[role="dialog"]').length)
      if (n === 1) return true
      if (Date.now() - t0 > 5000) return false
      await win.waitForTimeout(200)
    }
  }

  /** Fill the dialog's text/number inputs (Define Groups, Test Value), in DOM order. */
  const fillTexts = async values => {
    await win.evaluate(vals => {
      const inputs = Array.from(
        document.querySelectorAll(
          // An input with no type attribute is a text input but does NOT match
          // [type="text"] — Proportions' success-value field was invisible here
          // and every later value landed one field early.
          '[role="dialog"] input:not([type]), [role="dialog"] input[type="text"], [role="dialog"] input[type="number"]'
        )
        // ...but the shell's own chrome is not a dialog field. The source-list
        // search box is a text input that renders BEFORE every field a
        // scenario wants to fill, so counting it shifts every value one field
        // early and leaves the last field empty — which turns canSubmit false
        // and wedges the dialog open, poisoning every later scenario.
      ).filter(el => !el.closest('[class*="searchBox"]'))
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      vals.forEach((v, i) => {
        const inp = inputs[i]
        if (!inp) return
        setter?.call(inp, v)
        inp.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }, values)
    await win.waitForTimeout(200)
  }

  const applySelections = async scn => {
    for (const [name, field] of scn.vars ?? []) await assign(name, field)
    for (const sub of scn.subs ?? []) {
      const opened = await openSub(t(sub.button))
      if (!opened) {
        fails.push(`${scn.id}: sub-dialog "${sub.button}" did not open`)
        continue
      }
      for (const key of sub.check ?? []) {
        const done = await checkOption(t(key))
        if (!done) fails.push(`${scn.id}: checkbox "${key}" not found in sub-dialog`)
      }
      for (const key of sub.uncheck ?? []) {
        const done = await uncheckOption(t(key))
        if (!done) fails.push(`${scn.id}: checkbox "${key}" not found in sub-dialog`)
      }
      if (!(await continueSub(t('common:common.continue')))) {
        fails.push(`${scn.id}: sub-dialog "${sub.button}" did not close with Continue`)
      }
    }
    // Main-dialog checkboxes (e.g. the correlation coefficients live in the
    // dialog body, not in a sub-dialog).
    for (const key of scn.mainUnchecks ?? []) {
      const done = await uncheckOption(t(key))
      if (!done) fails.push(`${scn.id}: main checkbox "${key}" not found`)
    }
    for (const key of scn.mainChecks ?? []) {
      const done = await checkOption(t(key))
      if (!done) fails.push(`${scn.id}: main checkbox "${key}" not found`)
    }
    if (scn.texts) await fillTexts(scn.texts)
  }

  const lastBlockId = async () =>
    await win.evaluate(() => window.__SAI_TEST__.useOutputStore.getState().blocks[0]?.id ?? null)

  const waitForBlock = async (before, ms = 60000) => {
    const t0 = Date.now()
    for (;;) {
      const b = await win.evaluate(() => {
        const b0 = window.__SAI_TEST__.useOutputStore.getState().blocks[0]
        return b0 ? { id: b0.id, error: b0.error ?? null, running: Boolean(b0.running) } : null
      })
      if (b && b.id !== before && !b.running) return b
      if (Date.now() - t0 > ms) return null
      await win.waitForTimeout(400)
    }
  }

  return {
    openDialog,
    assign,
    clickMainButton,
    openSub,
    checkOption,
    uncheckOption,
    continueSub,
    fillTexts,
    applySelections,
    lastBlockId,
    waitForBlock
  }
}

module.exports = { SCENARIOS, makeT, createDriver }
