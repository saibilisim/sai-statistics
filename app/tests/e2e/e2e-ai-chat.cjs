// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: AI entegrasyonu uçtan uca (spec §9 e2e satırı) — GERÇEK API ÇAĞRISI YOK.
 *
 * Script içinde node:http ile OpenAI-compatible bir mock LLM sunucusu kalkar
 * (senaryo kuyruğu: istek başına sıradaki yanıt). Uygulama 'server' provider'ı
 * (SAI hesabı) ile açılır; sunucu adresi koda gömülü olduğundan main
 * process'in global fetch'i bu mock'a yönlendirilir, oturum token'ı sahte bir
 * JWT'dir (yalnız exp okunur), /auth/me mock'tan yanıtlanır:
 *
 *   1. AI sekmesiyle panel açılır, ilk gönderim onay diyaloğunu açar → kabul.
 *   2. Mock 1. turda run_analysis(descriptives) tool_call'ı döner → agent
 *      döngüsü GERÇEK R işini koşturur → tool-event kartı "done" olur, Output
 *      bloğu oluşur, mock'un final yorumu sohbete akar.
 *   3. O blokta ✦AI → Yorumla → aiNote bandı mock'un yanıtıyla görünür.
 *   4. Mock'a gelen istekler de doğrulanır: Bearer oturum token'ı, tools yüzeyi,
 *      tool-result mesajı (AnalysisResult), interpret'te max_tokens.
 *
 * Ortam notları (probe ile saptandı):
 * - Derlenmiş uygulama app name "Electron" ile koşar → userData
 *   $XDG_CONFIG_HOME/Electron (mevcut e2e script'leri de aynı dosyayı yazar).
 * - Bu makinede safeStorage backend'i basic_text → isEncryptionAvailable()
 *   false ve encryptString/decryptString throw eder; ai-bridge'in
 *   şifreli-oturum koruması (§6.1) prod'da doğru davranıştır ama e2e'de
 *   oturum token'ını okumayı engeller. Test, main process'te
 *   isEncryptionAvailable + decryptString'i patch'ler (yalnız bu process'te,
 *   üretim koduna dokunulmaz); ai-session.bin'e yalnız hasSessionToken'ın
 *   stat() kontrolünü geçmek için boş-olmayan bir yer tutucu yazılır.
 * - Her iki dosya da (settings.json, ai-session.bin) önce yedeklenir,
 *   finally'de birebir geri yüklenir.
 *
 * Gereksinimler: `pnpm build` (out/main/main.cjs), çalışan R (descriptives.R
 * gerçekten koşar). Run: node tests/e2e/e2e-ai-chat.cjs
 */
const { _electron } = require('@playwright/test')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { electronUserDataDir } = require('./e2e-userdata.cjs')

const MOCK_CHAT_TEXT = 'MOCK_CHAT_INTERPRETATION: Score ortalaması ~50, dağılım simetrik.'
const MOCK_NOTE_TEXT = 'MOCK_BLOCK_NOTE: Tablo N=60, mean ve sd beklenen aralıkta.'
// Sahte oturum access token'ı: imzasız JWT, exp = +1 saat (ensureFreshAccessToken
// yalnız exp'e bakar). Mock'a gelen Authorization başlığı bununla doğrulanır.
const MOCK_ACCESS_TOKEN = [
  Buffer.from('{"alg":"none"}').toString('base64url'),
  Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
  'sig'
].join('.')
const MOCK_SESSION = JSON.stringify({
  accessToken: MOCK_ACCESS_TOKEN,
  refreshToken: 'e2e-mock-refresh'
})

// ─── Mock OpenAI-compatible sunucu ──────────────────────────────────────────
// scenarioQueue: istek başına bir yanıt spec'i ({content} | {toolCalls:[..]}).
// requests: gelen isteklerin {body, headers} kaydı (doğrulama için).
function startMockProvider() {
  const scenarioQueue = []
  const requests = []
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      if (req.url === '/auth/me') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            email: 'e2e@example.com',
            plan: 'free',
            status: 'active',
            credit_balance_usd: 5,
            email_verified: true
          })
        )
        return
      }
      if (req.url.startsWith('/v1/models') || req.url.startsWith('/app/config')) {
        res.writeHead(404)
        res.end()
        return
      }
      // ai:get-setup reachability ping'i — ayakta olduğumuzun kanıtı yeterli.
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('mock-llm')
      return
    }
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      res.writeHead(404)
      res.end()
      return
    }
    let raw = ''
    req.on('data', c => {
      raw += c
    })
    req.on('end', () => {
      let body
      try {
        body = JSON.parse(raw)
      } catch {
        res.writeHead(400)
        res.end('bad json')
        return
      }
      requests.push({ body, authorization: req.headers.authorization ?? null })
      const spec = scenarioQueue.shift()
      if (!spec) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'mock scenario queue exhausted' } }))
        return
      }
      const message = { role: 'assistant', content: spec.content ?? null }
      if (spec.toolCalls) {
        message.tool_calls = spec.toolCalls.map((tc, i) => ({
          id: tc.id ?? `call_mock_${String(i)}`,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }))
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          choices: [{ index: 0, message, finish_reason: spec.toolCalls ? 'tool_calls' : 'stop' }]
        })
      )
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, scenarioQueue, requests, port: server.address().port })
    })
  })
}

// hasSessionToken() yalnız statSync().size > 0 ister — içerik test patch'lenen
// decryptString tarafından sağlanır; dosya yalnız yer tutucudur.
const CREDS_PLACEHOLDER = Buffer.from('e2e-mock-session-placeholder')

function makeCsv() {
  const lines = ['score,group']
  for (let i = 0; i < 60; i++) lines.push(`${String(35 + (i % 31))},${i % 2 === 0 ? 'A' : 'B'}`)
  const file = path.join(os.tmpdir(), 'sai-ai-chat-e2e.csv')
  fs.writeFileSync(file, lines.join('\n'))
  return file
}

async function main() {
  const mock = await startMockProvider()
  const csvPath = makeCsv()

  // userData: derlenmiş uygulama "Electron" adıyla koşar (probe ile doğrulandı).
  // Konum platforma göre değişir — burası sabit ~/.config/Electron (Linux)
  // yazıyordu, dolayısıyla Windows'ta ayarlar uygulamanın hiç bakmadığı bir
  // yola gidiyor, uygulama varsayılanlarla açılıyor (ai.provider = 'off') ve
  // sohbet kutusu disabled kaldığı için test "element is not enabled" ile
  // zaman aşımına uğruyordu.
  const userData = electronUserDataDir()
  const settingsPath = path.join(userData, 'settings.json')
  const credsPath = path.join(userData, 'ai-session.bin')
  const settingsBackup = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath) : null
  const credsBackup = fs.existsSync(credsPath) ? fs.readFileSync(credsPath) : null

  const fail = msg => {
    console.error(`E2E FAILED — ${msg}`)
    process.exitCode = 1
  }

  let app = null
  try {
    // 'server' provider (istekler mock'a yönlendirilir). Onay akışını da test
    // etmek için consentGiven: false.
    const seeded = settingsBackup ? JSON.parse(settingsBackup.toString('utf8')) : {}
    seeded.ai = {
      provider: 'server',
      model: 'mock-llm-1',
      shareRawRows: false,
      consentGiven: false
    }
    fs.mkdirSync(userData, { recursive: true })
    fs.writeFileSync(settingsPath, JSON.stringify(seeded, null, 2))
    fs.writeFileSync(credsPath, CREDS_PLACEHOLDER)

    app = await _electron.launch({
      args: ['out/main/main.cjs', '--no-sandbox'],
      cwd: path.join(__dirname, '..', '..')
    })

    const win = await app.firstWindow()
    win.on('pageerror', err => console.log('[pageerror]', err.message))
    await win.waitForLoadState('domcontentloaded')

    // basic_text backend'inde ai-bridge'in oturum guard'ı token'ı okuyamaz
    // (encrypt/decrypt throw eder); yalnızca bu test process'inde guard'ı aşarız
    // (dosya başlığına bak). Şifreleme burada test edilmiyor — AI akışı testte.
    // Ayrıca 'server' adresi (https://api.saistatistics.com) koda gömülü: main
    // process'in global fetch'i mock sunucuya yönlendirilir.
    // Uygulama açılırken main'in evaluate context'i bir kez yıkılabilir
    // ("Execution context was destroyed") — kısa retry ile aşılır.
    let patched = false
    for (let attempt = 0; attempt < 5 && !patched; attempt++) {
      try {
        await app.evaluate(
          ({ safeStorage }, args) => {
            safeStorage.isEncryptionAvailable = () => true
            safeStorage.decryptString = () => args.session
            if (!globalThis.__saiFetchPatched) {
              const orig = globalThis.fetch
              globalThis.fetch = (input, init) => {
                const url =
                  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
                const to = url.replace(
                  'https://api.saistatistics.com',
                  `http://127.0.0.1:${args.port}`
                )
                return orig(to === url ? input : to, init)
              }
              globalThis.__saiFetchPatched = true
            }
          },
          { session: MOCK_SESSION, port: mock.port }
        )
        patched = true
      } catch (err) {
        console.log(`safeStorage patch attempt ${String(attempt + 1)} failed: ${String(err)}`)
        await win.waitForTimeout(500)
      }
    }
    if (!patched) throw new Error('safeStorage patch could not be applied')

    await win.waitForTimeout(1500)

    // Fixture yükle (e2e-terminal-rconsole.cjs deseni).
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
      return { datasetId: result.dataset.id, variables: result.variables }
    }, csvPath)
    const scoreVar = setup.variables.find(v => v.name === 'score')
    console.log('dataset:', setup.datasetId, 'score colId:', scoreVar && scoreVar.colId)
    if (!scoreVar) {
      fail('fixture variable "score" not found after import')
      return
    }

    // Senaryo: (1) run_analysis tool_call → (2) final sohbet yorumu → (3) interpret yanıtı.
    mock.scenarioQueue.push(
      {
        toolCalls: [
          {
            name: 'run_analysis',
            arguments: {
              datasetId: setup.datasetId,
              analysisId: 'descriptives',
              params: { variables: [scoreVar.colId] }
            }
          }
        ]
      },
      { content: MOCK_CHAT_TEXT },
      { content: MOCK_NOTE_TEXT }
    )

    // (1) AI sekmesi → panel açılır.
    await win.click('[role="tab"][title*="Ctrl+6"]')
    await win.waitForSelector('aside textarea', { timeout: 5000 })

    // (2) İlk gönderim → onay diyaloğu → kabul.
    await win.fill('aside textarea', 'Score değişkeninin tanımlayıcı istatistiklerini çalıştır.')
    await win.click('aside button[class*="sendBtn"]')
    await win.waitForSelector('[aria-labelledby="ai-consent-title"]', { timeout: 5000 })
    await win.click('[aria-labelledby="ai-consent-title"] button[class*="primary"]')

    // (3) Agent turu: tool kartı done + Output bloğu + final metin (R işi sürebilir).
    const waitFor = async (pred, timeoutMs, label) => {
      const start = Date.now()
      for (;;) {
        if (await win.evaluate(pred)) return true
        if (Date.now() - start > timeoutMs) {
          console.error(`timeout waiting for: ${label}`)
          return false
        }
        await win.waitForTimeout(400)
      }
    }
    const toolCardDone = await waitFor(
      () => document.querySelectorAll('[class*="toolCard"][data-status="done"]').length > 0,
      120000,
      'tool card done (run_analysis through real R pipeline)'
    )
    const outputBlockCreated = await waitFor(
      () =>
        window.__SAI_TEST__.useOutputStore
          .getState()
          .blocks.some(b => b.analysisId === 'descriptives'),
      30000,
      'descriptives Output block'
    )
    const chatTextArrived = await waitFor(
      () =>
        // The AI panel's own <aside> — the Terminal tab mounts asides of its own.
        (document.querySelector('aside[data-ai-panel-min]')?.textContent ?? '').includes(
          'MOCK_CHAT_INTERPRETATION'
        ),
      30000,
      'final interpretation text in chat'
    )
    const streamError = await win.evaluate(
      () => document.querySelector('aside [class*="errorBanner"]')?.textContent ?? null
    )
    if (streamError) console.log('chat stream error banner:', streamError)

    // (4) ✦AI → Yorumla → aiNote bandı.
    let noteBandShown = false
    if (outputBlockCreated) {
      await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('output'))
      await win.waitForTimeout(500)
      await win.click('[class*="aiBtn"]')
      await win.waitForSelector('[role="menu"] [role="menuitem"]', { timeout: 5000 })
      // İlk menü öğesi "Yorumla" (AiBlockControls items sırası: interpret, ask, openInChat).
      await win.click('[role="menu"] [role="menuitem"] >> nth=0')
      noteBandShown = await waitFor(
        () => {
          const band = document.querySelector('[class*="aiNoteBand"]')
          return !!band && (band.textContent ?? '').includes('MOCK_BLOCK_NOTE')
        },
        30000,
        'aiNote band with mock answer'
      )
    }

    // (5) Mock'a giden isteklerin sözleşme doğrulaması.
    const reqInfo = mock.requests.map(r => ({
      hasAuth: r.authorization === `Bearer ${MOCK_ACCESS_TOKEN}`,
      toolNames: Array.isArray(r.body.tools)
        ? r.body.tools
            .map(t => t?.function?.name ?? t?.name)
            .filter(Boolean)
            .sort()
        : [],
      hasMaxTokens: typeof r.body.max_tokens === 'number',
      toolResultOk: (r.body.messages ?? []).some(m => {
        if (m.role !== 'tool') return false
        try {
          const c = JSON.parse(m.content)
          return c.status === 'completed' && c.result && c.result.success === true
        } catch {
          return false
        }
      })
    }))
    console.log('mock requests:', JSON.stringify(reqInfo))
    // When a tool round fails, the booleans above say nothing about WHY. Dump
    // the tool messages the app actually sent — the agent loop puts its error
    // text there, so this is the difference between "toolResultOk: false" and
    // a readable cause.
    const toolMsgs = mock.requests.flatMap((r, i) =>
      (r.body.messages ?? [])
        .filter(m => m.role === 'tool')
        .map(m => `  req#${i} tool: ${String(m.content).slice(0, 400)}`)
    )
    console.log(toolMsgs.length ? 'tool messages:\n' + toolMsgs.join('\n') : 'tool messages: NONE')
    const requestChecks =
      mock.requests.length === 3 &&
      reqInfo.every(r => r.hasAuth) &&
      // Asserts the exact tool surface, not a count. CLAUDE.md §9 keeps this
      // surface deliberately narrow (no R console, no file writes), so adding
      // a tool must be a conscious act that updates this list — which is the
      // point of pinning it. The count-based check that used to live here read
      // "=== 3" and silently went stale when run_syntax and propose_syntax
      // were added.
      JSON.stringify(reqInfo[0].toolNames) ===
        JSON.stringify(
          [
            'get_data_profile',
            'get_variables',
            'propose_r_code', // proposes only — never runs R (CLAUDE.md §9, 2026-10-18)
            'propose_syntax',
            'run_analysis',
            'run_syntax'
          ].sort()
        ) &&
      reqInfo[1].toolResultOk && // R sonucu modele tool mesajı olarak döndü
      reqInfo[2].hasMaxTokens // ai:interpret tek tur (max_tokens: 1500)

    await win.screenshot({
      path: path.join(__dirname, '..', '..', 'e2e-ai-chat.png'),
      fullPage: true
    })

    const checks = {
      toolCardDone,
      outputBlockCreated,
      chatTextArrived,
      noteBandShown,
      requestChecks
    }
    console.log('checks:', JSON.stringify(checks))
    if (!Object.values(checks).every(Boolean)) {
      fail('see assertions above')
    }
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  } finally {
    if (app) {
      try {
        // Analiz sonuçları Output'u kirletir — kapanış guard'ının native
        // dialogu headless'ta sonsuza dek bekler (diğer e2e script'leriyle aynı desen).
        await app.evaluate(({ dialog }) => {
          dialog.showMessageBoxSync = () => 1
        })
        await app.close()
      } catch (err) {
        console.error('app close failed:', err)
      }
    }
    // Tohumlanan dosyaları birebir geri yükle.
    if (settingsBackup) fs.writeFileSync(settingsPath, settingsBackup)
    else fs.rmSync(settingsPath, { force: true })
    if (credsBackup) fs.writeFileSync(credsPath, credsBackup)
    else fs.rmSync(credsPath, { force: true })
    await new Promise(resolve => {
      mock.server.close(() => resolve())
    })
  }

  if (process.exitCode) process.exit(process.exitCode)
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
