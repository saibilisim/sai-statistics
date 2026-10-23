// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* R Markdown in the R script editor (2026-10-21), against real R.
 *
 *   report  — "Build report" on an .Rmd tab: the YAML title heads the report;
 *             an include=FALSE setup chunk RUNS but is not shown; echo=FALSE
 *             shows the output without the code; eval=FALSE (and a python
 *             chunk) is shown but never runs; Markdown headings/paragraphs
 *             come through.
 *   runall  — "Run all" sends only the evaluated R chunks: no Markdown line
 *             reaches R (no "unexpected" parse error), eval=FALSE does not run.
 *
 * Usage: node tests/e2e/run-e2e.cjs terminal-rmd   (after pnpm build)
 */
const { _electron } = require('@playwright/test')
const path = require('path')

const DOC = [
  '---',
  'title: "Rmd deneme raporu"',
  '---',
  '',
  '```{r setup, include=FALSE}',
  'k <- 21',
  '```',
  '',
  '# Bulgular',
  '',
  'Ortalama **iki katı** aşağıda.',
  '',
  '```{r}',
  'cat("DOUBLE=", k * 2, "\\n", sep = "")',
  '```',
  '',
  '```{r sakli, echo=FALSE}',
  'cat("HIDDEN_CODE_OUT\\n")',
  '```',
  '',
  '```{r, eval=FALSE}',
  'cat("MUST_NOT_RUN\\n")',
  '```',
  '',
  '```{python}',
  'print("python")',
  '```'
].join('\n')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..')
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(800)
  await win.evaluate(doc => {
    const T = window.__SAI_TEST__
    T.useUIStore.getState().setActiveTab('terminal')
    T.useTerminalStore.getState().setMode('r')
    T.useTerminalStore.getState().openRScript('deneme.Rmd', doc, null)
  }, DOC)

  const term = () =>
    win.evaluate(() => {
      const s = window.__SAI_TEST__.useTerminalStore.getState()
      return {
        status: s.rStatus,
        out: s.rOutput.map(c => c.text).join(''),
        report: s.rReport
      }
    })
  const waitFor = async (pred, ms) => {
    const end = Date.now() + ms
    for (;;) {
      const st = await term()
      if (pred(st) || Date.now() > end) return st
      await win.waitForTimeout(250)
    }
  }
  const checks = {}
  checks.ready = (await waitFor(s => s.status === 'idle', 40000)).status === 'idle'

  // ── report ──
  await win.locator('button', { hasText: /^(Rapor oluştur|Build report)$/ }).click()
  let st = await waitFor(
    s =>
      s.report && s.status === 'idle' && s.report.items.some(i => /DOUBLE=/.test(i.output ?? '')),
    60000
  )
  const items = st.report?.items ?? []
  const codeItems = items.filter(i => i.kind === 'code')
  checks.title = st.report?.title === 'Rmd deneme raporu'
  checks.markdown =
    items.some(i => i.kind === 'heading' && i.text === 'Bulgular') &&
    items.some(i => i.kind === 'text' && /iki katı/.test(i.text))
  checks.setupRanHidden =
    codeItems.some(i => /DOUBLE=42/.test(i.output)) && !codeItems.some(i => /k <- 21/.test(i.code))
  checks.echoFalse = codeItems.some(i => i.hideCode === true && /HIDDEN_CODE_OUT/.test(i.output))
  checks.evalFalseShownNotRun =
    codeItems.some(i => /MUST_NOT_RUN/.test(i.code) && i.output === '') &&
    !/MUST_NOT_RUN\n/.test(st.out.replace(/cat\("MUST_NOT_RUN\\n"\)/g, ''))
  checks.pythonNotRun = codeItems.some(i => /print\("python"\)/.test(i.code) && i.output === '')

  // ── run all ──
  await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().clearROutput())
  // Building the report switched to the Report tab; Run all lives on the script's.
  await win.locator('[role="tab"]', { hasText: /^deneme\.Rmd/ }).click()
  await win.locator('button', { hasText: /^(Tümünü çalıştır|Run all)$/ }).click()
  st = await waitFor(s => s.status === 'idle' && /HIDDEN_CODE_OUT/.test(s.out), 30000)
  checks.runAllOnlyChunks =
    /DOUBLE=42/.test(st.out) &&
    /HIDDEN_CODE_OUT/.test(st.out) &&
    !/unexpected/i.test(st.out) &&
    !/MUST_NOT_RUN\n/.test(st.out.replace(/cat\("MUST_NOT_RUN\\n"\)/g, ''))

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()

  console.log('checks:', JSON.stringify(checks))
  const failed = Object.entries(checks).filter(([, ok]) => !ok)
  if (failed.length) {
    console.log('FAILED:', failed.map(([k]) => k).join(', '))
    process.exit(1)
  }
  console.log('ALL PASS')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
