// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: AI sohbetindeki markdown SUNUMU (2026-08-14) — sağlayıcıya çağrı yok.
 *
 * Model yanıtları API'den düz markdown metni olarak gelir; biçimlendirme
 * tamamen bizde (MarkdownText.tsx + code-highlight.ts). Bu script, tipik bir
 * yanıtı (başlık, liste, GFM tablosu, R ve SPSS kod blokları, satır içi kod)
 * doğrudan chat-store'a enjekte edip render sonucunu doğrular:
 *
 *   1. Tablo gerçek <table> olur, kendi kaydırma kabuğunda durur, sayısal
 *      hücreler data-numeric="true" ile sağa yaslanır.
 *   2. Kod bloğu başlıklı karta dönüşür (dil etiketi + kopyala) ve gövdede
 *      renklendirilmiş token span'leri bulunur — birleşimleri kaynak kodun
 *      aynısıdır (kopyala/yapıştır bozulmamalı).
 *   3. Mesaj metni fare ile seçilebilir (body genelinde user-select: none).
 *
 * Gereksinim: `pnpm build`. Run: node tests/e2e/e2e-ai-markdown.cjs
 */
const { _electron } = require('@playwright/test')
const os = require('os')
const path = require('path')
const { makeClipboard } = require('./e2e-clipboard.cjs')

const R_CODE = 'library(stats)\nfit <- lm(score ~ group, data = df)  # model\nsummary(fit)'
const SPSS_CODE = '* Betimleyici istatistik.\nDESCRIPTIVES VARIABLES=score\n  /STATISTICS=MEAN SD.'

const ASSISTANT_MARKDOWN = [
  '## Bağımsız Örneklem t-Testi',
  '',
  'Gruplar arasındaki fark **istatistiksel olarak anlamlı**; etki büyüklüğü orta düzeyde.',
  '',
  '| Grup | N | Ortalama | SS | p |',
  '| --- | --- | --- | --- | --- |',
  '| Kontrol | 30 | 48.20 | 9.14 | <.001 |',
  '| Deney | 30 | 55.60 | 8.77 | <.001 |',
  '',
  '### Sonraki adımlar',
  '',
  '1. Varyans homojenliğini `car::leveneTest` ile kontrol edin',
  '2. Etki büyüklüğünü raporlayın',
  '',
  '```r',
  R_CODE,
  '```',
  '',
  'Aynı analizin SPSS syntax karşılığı:',
  '',
  '```spss',
  SPSS_CODE,
  '```',
  '',
  '> Not: p değerleri iki yönlüdür.'
].join('\n')

function fail(msg) {
  console.error('ASSERTION FAILED:', msg)
  process.exitCode = 1
}

async function main() {
  let app = null
  try {
    app = await _electron.launch({
      args: ['out/main/main.cjs', '--no-sandbox'],
      cwd: path.join(__dirname, '..', '..')
    })
    const win = await app.firstWindow()
    win.on('pageerror', err => console.log('[pageerror]', err.message))
    await win.waitForLoadState('domcontentloaded')
    await win.waitForTimeout(1500)

    // AI sekmesi → panel açılır.
    await win.click('[role="tab"][title*="Ctrl+6"]')
    await win.waitForSelector('aside[data-ai-panel-min] textarea', { timeout: 5000 })

    // Sağlayıcıya gitmeden mesajları doğrudan store'a koy (debug kancası).
    await win.evaluate(markdown => {
      window.__SAI_TEST__.useChatStore.setState({
        messages: [
          {
            id: 'u1',
            role: 'user',
            content: 'Gruplar arasında fark var mı?',
            createdAt: Date.now(),
            toolEvents: []
          },
          {
            id: 'a1',
            role: 'assistant',
            content: markdown,
            createdAt: Date.now(),
            toolEvents: []
          }
        ],
        isStreaming: false,
        streamingMessageId: null
      })
    }, ASSISTANT_MARKDOWN)
    await win.waitForSelector('aside[data-ai-panel-min] table', { timeout: 5000 })

    const result = await win.evaluate(
      ({ rCode, spssCode }) => {
        const panel = document.querySelector('aside[data-ai-panel-min]')
        const table = panel.querySelector('table')
        const wrap = table.parentElement
        const codeBlocks = Array.from(panel.querySelectorAll('pre'))
        const assistantText = table.closest('div[class*="markdown"]')
        const numericCells = Array.from(table.querySelectorAll('td[data-numeric="true"]'))
        const headerLabels = codeBlocks
          .map(pre => pre.previousElementSibling)
          .filter(Boolean)
          .map(h => h.textContent.trim())
        return {
          // (1) tablo
          headerCount: table.querySelectorAll('thead th').length,
          bodyRows: table.querySelectorAll('tbody tr').length,
          wrapScrolls: getComputedStyle(wrap).overflowX === 'auto',
          numericCount: numericCells.length,
          numericRightAligned: numericCells.every(td => getComputedStyle(td).textAlign === 'right'),
          groupCellNotNumeric: table.querySelector('tbody td').dataset.numeric,
          // (2) kod blokları
          codeBlockCount: codeBlocks.length,
          headerLabels,
          tokenSpanCounts: codeBlocks.map(pre => pre.querySelectorAll('code > span').length),
          codeTextsIntact:
            codeBlocks[0].textContent === rCode && codeBlocks[1].textContent === spssCode,
          tokensColored: codeBlocks.every(pre =>
            Array.from(pre.querySelectorAll('code > span')).some(
              s => getComputedStyle(s).color !== getComputedStyle(pre).color
            )
          ),
          // (3) seçilebilirlik
          selectable: getComputedStyle(assistantText).userSelect,
          bodySelectable: getComputedStyle(document.body).userSelect
        }
      },
      { rCode: R_CODE, spssCode: SPSS_CODE }
    )
    console.log('render:', JSON.stringify(result, null, 2))

    // Fare ile seçim gerçekten çalışıyor mu (computed style + canlı deneme).
    const selection = await win.evaluate(() => {
      const p = document.querySelector('aside[data-ai-panel-min] div[class*="markdown"] p')
      const range = document.createRange()
      range.selectNodeContents(p)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      return {
        target: p ? p.textContent.slice(0, 40) : null,
        targetUserSelect: p ? getComputedStyle(p).userSelect : null,
        selected: window.getSelection().toString().trim()
      }
    })
    console.log('selection:', JSON.stringify(selection))
    const selectedText = selection.selected

    // Tabloyu kopyala → pano TSV taşır (Excel/Data View'a hücre hücre yapışır).
    const clipboard = makeClipboard(app, win)
    await clipboard.clear()
    await win.click('aside[data-ai-panel-min] [class*="tableCopyBtn"]', { force: true })
    // Windows panosu satır sonlarını CRLF'e çevirir — karşılaştırma öncesi normalize.
    const tsv = (await clipboard.readWhenReady()).replace(/\r\n/g, '\n')
    const tsvLines = tsv.split('\n')
    console.log('tsv:', JSON.stringify(tsvLines))

    // Panel görseli her iki temada (token'lar tema başına tanımlı — §7);
    // light üstten, dark aşağı kaydırılmış hâlde → iki kare birlikte mesajın
    // tamamını (tablo + iki kod kartı + alıntı) gösterir.
    const shotDir = os.tmpdir()
    const aside = await win.$('aside[data-ai-panel-min]')
    for (const theme of ['light', 'dark']) {
      await win.evaluate(
        ({ t, scroll }) => {
          window.__SAI_TEST__.useSettingsStore.getState().setTheme(t)
          const list = document.querySelector('aside[data-ai-panel-min] div[class*="messageList"]')
          if (list) list.scrollTop = scroll ? list.scrollHeight : 0
        },
        { t: theme, scroll: theme === 'dark' }
      )
      await win.waitForTimeout(400)
      await aside.screenshot({ path: path.join(shotDir, `sai-ai-markdown-${theme}.png`) })
    }
    console.log('screenshots →', shotDir)

    const checks = {
      tableRendered: result.headerCount === 5 && result.bodyRows === 2,
      tableScrollShell: result.wrapScrolls,
      numericAligned: result.numericCount === 8 && result.numericRightAligned,
      labelCellNotNumeric: result.groupCellNotNumeric === 'false',
      twoCodeCards: result.codeBlockCount === 2,
      codeLabels:
        JSON.stringify(result.headerLabels.map(l => l.replace(/\s+/g, ''))) ===
        JSON.stringify(['R', 'SPSS']),
      codeHighlighted: result.tokenSpanCounts.every(n => n >= 2) && result.tokensColored,
      codeTextIntact: result.codeTextsIntact,
      messageSelectable: result.selectable === 'text' && result.bodySelectable === 'none',
      selectionWorks: selectedText.length > 0,
      tableCopiedAsTsv:
        tsvLines.length === 3 &&
        tsvLines[0] === 'Grup\tN\tOrtalama\tSS\tp' &&
        tsvLines[1] === 'Kontrol\t30\t48.20\t9.14\t<.001'
    }
    console.log('checks:', JSON.stringify(checks))
    if (!Object.values(checks).every(Boolean)) fail('see checks above')
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  } finally {
    if (app) {
      try {
        await app.evaluate(({ dialog }) => {
          dialog.showMessageBoxSync = () => 1
        })
        await app.close()
      } catch (err) {
        console.error('app close failed:', err)
      }
    }
  }

  if (process.exitCode) process.exit(process.exitCode)
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
