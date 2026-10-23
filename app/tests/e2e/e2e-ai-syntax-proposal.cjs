// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: propose_syntax onay kartının kurtarma yolları (2026-08-14).
 *
 * Model hatalı bir syntax önerdiğinde kart çıkmaz sokak olmamalı: kullanıcı
 * (1) hata satırlarının TAMAMINI görmeli, (2) syntax'ı kart üzerinde
 * düzenleyip yeniden çalıştırabilmeli, (3) kopyalayabilmeli, (4) tek
 * düğmeyle Sözdizimi (Terminal) sekmesine aktarabilmeli.
 *
 * Sağlayıcıya çağrı yok — öneri doğrudan chat-store'a enjekte edilir.
 * Gereksinim: `pnpm build`. Run: node tests/e2e/e2e-ai-syntax-proposal.cjs
 */
const { _electron } = require('@playwright/test')
const path = require('path')
const { makeClipboard } = require('./e2e-clipboard.cjs')

const SYNTAX = 'COMPUTE toplam = q1 + q2.\nEXECUTE.'
const EDITED = 'COMPUTE toplam = q1 + q2 + q3.\nEXECUTE.'

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
    const clipboard = makeClipboard(app, win)

    await win.click('[role="tab"][title*="Ctrl+6"]')
    await win.waitForSelector('aside textarea', { timeout: 5000 })

    // Hatayla dönmüş, bekleyen bir öneri kartı.
    await win.evaluate(syntax => {
      window.__SAI_TEST__.useChatStore.setState({
        messages: [
          {
            id: 'u1',
            role: 'user',
            content: 'toplam puanı hesapla',
            createdAt: Date.now(),
            toolEvents: [],
            mentions: []
          },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            createdAt: Date.now(),
            toolEvents: [],
            mentions: [],
            syntaxProposals: [
              {
                id: 'p1',
                syntax,
                description: 'Toplam puan değişkeni oluşturur',
                status: 'pending',
                errors: [
                  { key: 'terminal.log.unknownCommand', params: { command: 'FOO' } },
                  { key: 'terminal.log.runFailed', params: { detail: 'boom' } }
                ]
              }
            ]
          }
        ],
        isStreaming: false,
        activeTurnId: null,
        streamingMessageId: null
      })
    }, SYNTAX)
    await win.waitForSelector('aside [class*="syntaxProposal"]', { timeout: 5000 })

    const initial = await win.evaluate(() => {
      const card = document.querySelector('aside [class*="syntaxProposal"]')
      const err = card.querySelector('[role="alert"]')
      return {
        errorLines: err ? err.children.length : 0,
        buttons: card.querySelectorAll('button').length,
        titles: [...card.querySelectorAll('button')].map(b => b.title)
      }
    })
    console.log('card:', JSON.stringify(initial))

    // (2) Düzenle → textarea; yazılan metin store'a işlenir.
    const editBtn = await win.$(
      `aside [class*="syntaxProposal"] button[title="${initial.titles[1]}"]`
    )
    await editBtn.click()
    await win.waitForSelector('aside textarea[class*="syntaxProposalEditor"]', { timeout: 3000 })
    await win.fill('aside textarea[class*="syntaxProposalEditor"]', EDITED)
    const afterEdit = await win.evaluate(
      () => window.__SAI_TEST__.useChatStore.getState().messages.at(-1).syntaxProposals[0].syntax
    )

    // (3) Kopyala → pano düzenlenmiş syntax'ı taşır.
    await clipboard.clear()
    await win.click(`aside [class*="syntaxProposal"] button[title="${initial.titles[2]}"]`)
    // Windows panosu satır sonlarını CRLF'e çevirir — karşılaştırma öncesi normalize.
    const copied = (await clipboard.readWhenReady()).replace(/\r\n/g, '\n')
    console.log('clipboard:', JSON.stringify(copied))

    // (4) Sözdizimi sekmesine aktar.
    await win.click(`aside [class*="syntaxProposal"] button[title="${initial.titles[3]}"]`)
    await win.waitForTimeout(400)
    const transferred = await win.evaluate(() => ({
      source: window.__SAI_TEST__.useTerminalStore.getState().source,
      tab: window.__SAI_TEST__.useUIStore.getState().activeTab
    }))

    // (5) R kodu önerisi (propose_r_code): çalıştırma yok, yalnız R betiğine gönder.
    const R_CODE = 'fit <- lm(q1 ~ q2, data = data)\nsummary(fit)'
    // The AI tab toggles the panel — open it only if step (4) closed it.
    if ((await win.$('aside textarea')) === null) await win.click('[role="tab"][title*="Ctrl+6"]')
    await win.evaluate(code => {
      const s = window.__SAI_TEST__.useChatStore.getState()
      window.__SAI_TEST__.useTerminalStore.setState({ rSource: '', mode: 'spss' })
      window.__SAI_TEST__.useChatStore.setState({
        messages: [
          ...s.messages,
          {
            id: 'a2',
            role: 'assistant',
            content: '',
            createdAt: Date.now(),
            toolEvents: [],
            mentions: [],
            syntaxProposals: [
              { id: 'pr', syntax: code, description: 'Regresyon', status: 'pending', language: 'r' }
            ]
          }
        ]
      })
    }, R_CODE)
    const rCard = win.locator('aside [class*="syntaxProposal"][data-status]').last()
    await rCard.waitFor({ timeout: 5000 })
    const rInfo = await rCard.evaluate(card => ({
      titles: [...card.querySelectorAll('button')].map(b => b.title),
      // R renklendirmesi: `lm` / `summary` fonksiyon token'ı olarak boyanır.
      fnTokens: card.querySelectorAll('pre span[class*="tok_function"]').length
    }))
    console.log('r card:', JSON.stringify(rInfo))
    await rCard.locator('button').first().click()
    await win.waitForTimeout(400)
    const rSent = await win.evaluate(() => {
      const t = window.__SAI_TEST__.useTerminalStore.getState()
      return {
        rSource: t.rSource,
        mode: t.mode,
        ran: t.rOutput.some(c => c.stream === 'input'),
        tab: window.__SAI_TEST__.useUIStore.getState().activeTab,
        status: window.__SAI_TEST__.useChatStore.getState().messages.at(-1).syntaxProposals[0]
          .status
      }
    })
    console.log('r sent:', JSON.stringify(rSent))

    const checks = {
      // gönder · düzenle · kopyala · reddet — "kabul et ve çalıştır" yok
      rCardFourActions: rInfo.titles.length === 4 && !rInfo.titles.some(t => /çalıştır/i.test(t)),
      rHighlighted: rInfo.fnTokens >= 2,
      rSentToScript: rSent.rSource === R_CODE && rSent.mode === 'r' && rSent.tab === 'terminal',
      rNotRun: !rSent.ran,
      rCardMarkedSent: rSent.status === 'accepted',
      allErrorsShown: initial.errorLines === 2,
      // kabul · düzenle · kopyala · aktar · reddet
      fiveActions: initial.buttons === 5,
      editApplied: afterEdit === EDITED,
      copyIsEditedSyntax: copied.trim() === EDITED,
      sentToSyntaxTab: transferred.source.includes(EDITED) && transferred.tab === 'terminal'
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
