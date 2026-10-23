// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ai-agent-loop.test.ts — F2 agent döngüsü entegrasyon testi (§3.1, §9).
 *
 * Sahte LLM HTTP sunucusu (node:http) üzerinden uçtan uca Main akışı:
 *   tool_call get_variables → tool sonucu → tool_call run_analysis
 *   → GERÇEK enqueue yolu (parquet export + weight enjeksiyonu + job-manager
 *   FIFO; yalnız R süreç sınırı mock'lu) → job:complete Main-içi köprü
 *   → "sonuç geldi" tool mesajı → final yorum stream'i.
 *
 * Mock'lanan sınırlar: electron (IPC/safeStorage), electron-log,
 * settings-handler (getSettings), r-bridge (R süreç sınırı). DuckDB,
 * job-manager, analysis enqueue mantığı ve ai-bridge'in kendisi GERÇEK.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { createServer } from 'node:http'
import type { Server, IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { IPC } from '../../shared/ipc-contracts'
import type { Variable } from '../../shared/data-types'

// ─── Hoisted mock state ──────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, raw: unknown) => unknown>()
  return {
    handlers,
    baseUrl: '',
    runRScript: null as
      | null
      | ((opts: {
          scriptPath: string
          params: Record<string, unknown>
          signal?: AbortSignal
        }) => Promise<{ stdout: string; stderr: string; exitCode: number }>)
  }
})

const TEST_USER_DATA = join(tmpdir(), 'sai-ai-agent-loop-test')

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, raw: unknown) => unknown) => {
      mocks.handlers.set(channel, fn)
    }
  },
  app: {
    getPath: (_name: string) => TEST_USER_DATA,
    getAppPath: () => process.cwd(),
    isPackaged: false
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (_buf: Buffer) => 'sk-test'
  },
  BrowserWindow: {
    fromWebContents: (_wc: unknown) => ({ fake: 'window' })
  }
}))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

vi.mock('../../electron/ipc/settings-handler', () => ({
  getSettings: () => ({
    appearance: { language: 'tr' },
    r: { timeout: 120, consoleEnabled: false },
    ai: {
      provider: 'server',
      model: 'test-model',
      consentGiven: true
    }
  })
}))

// 'server' provider sunucuya (AI_SERVER_BASE_URL) bağlanır — testte o adres sahte
// LLM sunucusudur (her test kendi portunu mocks.baseUrl'e yazar).
vi.mock('../../shared/ai-types', async importOriginal => {
  const actual = await importOriginal<typeof import('../../shared/ai-types')>()
  return {
    ...actual,
    get AI_SERVER_BASE_URL() {
      return mocks.baseUrl
    }
  }
})

// Oturum token'ı ve sunucu kataloğu/konfigürasyonu: gerçek ağ/disk yok.
vi.mock('../../electron/ipc/ai-bridge/credentials', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/ipc/ai-bridge/credentials')>()
  return {
    ...actual,
    ensureFreshAccessToken: async () => 'test-access-token',
    hasSessionToken: () => true,
    purgeLegacyApiKey: () => undefined
  }
})
vi.mock('../../electron/ipc/ai-bridge/app-config', () => ({
  fetchAppConfig: async () => null,
  fetchModelCatalog: async () => []
}))

vi.mock('../../electron/ipc/r-bridge', () => ({
  runRScript: (opts: { scriptPath: string; params: Record<string, unknown> }) => {
    if (!mocks.runRScript) throw new Error('runRScript mock not installed')
    return mocks.runRScript(opts)
  }
}))

// Gerçek modüller (mock'lardan SONRA import edilmeli)
const { registerAiBridgeHandlers } = await import('../../electron/ipc/ai-bridge')
const { registerDbHandlers, loadDatasetIntoDb, getDbConnection } =
  await import('../../electron/ipc/db-handler')
const { setJobManagerWindow } = await import('../../electron/ipc/job-manager')

// ─── Sahte LLM HTTP sunucusu ─────────────────────────────────────────────────

interface OpenAiMessage {
  role: string
  content?: string | null
  tool_call_id?: string
  tool_calls?: { id: string; function: { name: string; arguments: string } }[]
}

interface CapturedRequest {
  body: {
    model?: string
    messages: OpenAiMessage[]
    tools?: { function: { name: string; description?: string } }[]
    sai_prompt?: {
      version: number
      kind: string
      language: string
      context: { datasets?: { id: string; weightVariable?: unknown }[]; analyses?: unknown[] }
    }
  }
}

type ScriptDecision =
  | 'get_variables'
  | 'get_data_profile'
  | 'run_analysis'
  | 'run_analysis_bad'
  | 'run_syntax'
  | 'run_syntax_many'
  | 'final'
  // Boş-cevap kurtarma testi (2026-07-28): model tool sonucundan sonra hiç
  // metin dönmüyor (bazı ücretsiz modellerde görülen gerçek davranış).
  | 'empty'

/** İsteğin son mesajına bakarak sahte modelin sıradaki hamlesini seçer. */
function defaultScript(messages: OpenAiMessage[]): ScriptDecision {
  const last = messages[messages.length - 1]
  if (!last || last.role === 'user') return 'get_variables'
  if (last.role === 'tool') {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m && m.role === 'assistant' && m.tool_calls) {
        const tc = m.tool_calls.find(t => t.id === last.tool_call_id)
        if (tc) return tc.function.name === 'get_variables' ? 'run_analysis' : 'final'
      }
    }
  }
  return 'final'
}

function toolCallResponse(id: string, name: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
          ]
        }
      }
    ]
  })
}

const FINAL_TEXT = 'Yorum: yaş ortalaması 42.5 (N=3); weightNotApplied uyarısı dikkate alınmalı.'

const openServers: { server: Server; sockets: Set<Socket> }[] = []

async function startMockLlm(
  script: (messages: OpenAiMessage[]) => ScriptDecision,
  captured: CapturedRequest[]
): Promise<string> {
  const sockets = new Set<Socket>()
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    req.on('end', () => {
      const parsed = JSON.parse(body) as CapturedRequest['body']
      captured.push({ body: parsed })
      const decision = script(parsed.messages)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      switch (decision) {
        case 'get_variables':
          res.end(toolCallResponse('tc_gv', 'get_variables', { datasetId: DATASET_ID }))
          break
        case 'get_data_profile':
          res.end(
            toolCallResponse('tc_dp', 'get_data_profile', { datasetId: DATASET_ID, colId: 'col_1' })
          )
          break
        case 'run_analysis':
          res.end(
            toolCallResponse('tc_ra', 'run_analysis', {
              datasetId: DATASET_ID,
              analysisId: 'descriptives',
              params: { variables: ['col_1'] }
            })
          )
          break
        case 'run_analysis_bad':
          res.end(
            toolCallResponse('tc_ra_bad', 'run_analysis', {
              datasetId: DATASET_ID,
              analysisId: 'descriptives',
              params: { variables: [] }
            })
          )
          break
        case 'run_syntax':
          res.end(
            toolCallResponse('tc_rs', 'run_syntax', {
              datasetId: DATASET_ID,
              syntax: 'RATIO STATISTICS yas WITH cinsiyet.'
            })
          )
          break
        case 'run_syntax_many':
          // 12 sub-clauses in one NPAR TESTS statement — exercises the
          // per-call analysis cap (MAX_ANALYSES_PER_RUN_SYNTAX_CALL = 10).
          res.end(
            toolCallResponse('tc_rs_many', 'run_syntax', {
              datasetId: DATASET_ID,
              syntax: `NPAR TESTS ${Array(12).fill('/CHISQUARE=yas').join(' ')}.`
            })
          )
          break
        case 'final':
          res.end(
            JSON.stringify({ choices: [{ message: { role: 'assistant', content: FINAL_TEXT } }] })
          )
          break
        case 'empty':
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '' } }] }))
          break
      }
    })
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  openServers.push({ server, sockets })
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${String(port)}`
}

const STREAMED_TEXT = 'Veri setinde 2 değişken var: yas ve cinsiyet.'

/**
 * SSE dönen sahte LLM. İlk istekte parça parça bir tool_call (get_variables)
 * akıtır — `arguments` string'i iki chunk'a bölünür, `name` yalnız ilk
 * chunk'ta gelir (OpenAI wire davranışı) — ikinci istekte metni kelime
 * kelime akıtır.
 */
async function startStreamingMockLlm(captured: CapturedRequest[]): Promise<string> {
  const sockets = new Set<Socket>()
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    req.on('end', () => {
      const parsed = JSON.parse(body) as CapturedRequest['body']
      captured.push({ body: parsed })
      const isFirst = !parsed.messages.some(m => m.role === 'tool')
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const emit = (delta: Record<string, unknown>): void => {
        res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`)
      }
      // Şema dışı satırlar (usage vb.) turu düşürmemeli.
      res.write(': ping\n\n')
      if (isFirst) {
        emit({ tool_calls: [{ index: 0, id: 'tc_stream', function: { name: 'get_variables' } }] })
        emit({ tool_calls: [{ index: 0, function: { arguments: `{"datasetId":"${DATASET_ID}` } }] })
        emit({ tool_calls: [{ index: 0, function: { arguments: '"}' } }] })
      } else {
        for (const word of STREAMED_TEXT.split(/(?<= )/)) emit({ content: word })
      }
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  openServers.push({ server, sockets })
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${String(port)}`
}

/**
 * İlk isteğe 429 (Retry-After: 0) döner, sonra get_variables tool_call'ı ve
 * final metin — dakikalık limitte turun yarıda kesilmeyip aynı round'u
 * yeniden denediğini doğrular (2026-09-29).
 */
async function startRateLimitedMockLlm(captured: CapturedRequest[]): Promise<string> {
  const sockets = new Set<Socket>()
  let calls = 0
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    req.on('end', () => {
      calls += 1
      const parsed = JSON.parse(body) as CapturedRequest['body']
      captured.push({ body: parsed })
      if (calls === 1) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' })
        res.end(JSON.stringify({ error: { message: 'rate limit exceeded' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      const hasTool = parsed.messages.some(m => m.role === 'tool')
      res.end(
        hasTool
          ? JSON.stringify({ choices: [{ message: { role: 'assistant', content: FINAL_TEXT } }] })
          : toolCallResponse('tc_gv', 'get_variables', { datasetId: DATASET_ID })
      )
    })
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  openServers.push({ server, sockets })
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${String(port)}`
}

/**
 * Model hiç durmadan get_variables çağırır; yalnız tool_choice:'none'
 * gelince metin döner — adım sınırı özet turunu doğrular (2026-09-29).
 */
async function startEndlessToolMockLlm(captured: CapturedRequest[]): Promise<string> {
  const sockets = new Set<Socket>()
  let calls = 0
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    req.on('end', () => {
      calls += 1
      const parsed = JSON.parse(body) as CapturedRequest['body'] & { tool_choice?: string }
      captured.push({ body: parsed })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        parsed.tool_choice === 'none'
          ? JSON.stringify({
              choices: [{ message: { role: 'assistant', content: 'Özet: X yapıldı, Y kaldı.' } }]
            })
          : toolCallResponse(`tc_${String(calls)}`, 'get_variables', { datasetId: DATASET_ID })
      )
    })
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  openServers.push({ server, sockets })
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${String(port)}`
}

afterEach(async () => {
  for (const { server, sockets } of openServers.splice(0)) {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

// ─── Ortak kurulum ───────────────────────────────────────────────────────────

const DATASET_ID = 'ds_9001'

const FAKE_RESULT = {
  success: true,
  tables: [
    {
      titleKey: 'output.descriptives.title',
      columns: ['output.col.variable', 'output.col.n', 'output.col.mean'],
      rows: [['yas', 3, 42.5]]
    }
  ],
  plots: [],
  warnings: ['output.warn.weightNotApplied'],
  notes: []
}

interface SentEvent {
  channel: string
  payload: Record<string, unknown>
}

/** Sahte WebContents — job-manager'ın win'i ve ai:send'in sender'ı aynı nesne. */
function makeFakeWindow(): { wc: Record<string, unknown>; sent: SentEvent[] } {
  const sent: SentEvent[] = []
  const wc: Record<string, unknown> = {
    isDestroyed: () => false,
    send: (channel: string, payload: Record<string, unknown>) => {
      sent.push({ channel, payload })
    }
  }
  wc['mainFrame'] = { wc }
  return { wc, sent }
}

function fakeEvent(wc: Record<string, unknown>): unknown {
  return { sender: wc, senderFrame: wc['mainFrame'] }
}

async function invoke(channel: string, event: unknown, raw: unknown): Promise<unknown> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return handler(event, raw)
}

async function waitForDone(sent: SentEvent[], timeoutMs = 20_000): Promise<SentEvent> {
  const start = Date.now()
  for (;;) {
    const done = sent.find(e => e.channel === IPC.AI_STREAM_CHUNK && e.payload['done'] === true)
    if (done) return done
    if (Date.now() - start > timeoutMs) {
      throw new Error(`stream done timeout; channels=${sent.map(e => e.channel).join(',')}`)
    }
    await new Promise(r => setTimeout(r, 25))
  }
}

beforeAll(async () => {
  mkdirSync(TEST_USER_DATA, { recursive: true })

  // Dataset: col_1 numeric/scale 'yas' (10,20,30,NULL), col_2 numeric/nominal 'cinsiyet'
  const conn = await getDbConnection()
  await conn.runAndReadAll(`CREATE TABLE temp_ai_agent (yas VARCHAR, cinsiyet VARCHAR)`)
  await conn.runAndReadAll(
    `INSERT INTO temp_ai_agent VALUES ('10','0'),('20','1'),('30','0'),(NULL,'1')`
  )
  const variables: Variable[] = [
    {
      colId: 'col_1',
      name: 'yas',
      type: 'numeric',
      width: 8,
      decimals: 1,
      label: 'Yaş',
      valueLabels: {},
      missing: null,
      columns: 8,
      align: 'right',
      measure: 'scale',
      role: 'both'
    },
    {
      colId: 'col_2',
      name: 'cinsiyet',
      type: 'numeric',
      width: 8,
      decimals: 0,
      label: 'Cinsiyet',
      valueLabels: { '0': 'Kadın', '1': 'Erkek' },
      missing: null,
      columns: 8,
      align: 'right',
      measure: 'nominal',
      role: 'both'
    }
  ]
  await loadDatasetIntoDb(DATASET_ID, 'AI Agent Test', null, variables, 'temp_ai_agent')

  registerDbHandlers()
  registerAiBridgeHandlers()
})

// ─── Testler ─────────────────────────────────────────────────────────────────

describe('ai agent loop (sahte LLM + gerçek enqueue yolu)', () => {
  it('get_variables → run_analysis → job:complete köprüsü → final yorum', async () => {
    const captured: CapturedRequest[] = []
    mocks.baseUrl = await startMockLlm(defaultScript, captured)

    // R sınırı: gerçek R yerine şema-geçerli sonuç döner; çağrıyı kaydet.
    let rCall: { scriptPath: string; params: Record<string, unknown> } | null = null
    mocks.runRScript = opts => {
      rCall = opts
      return Promise.resolve({
        exitCode: 0,
        stdout: `\n__SAI_RESULT__${JSON.stringify(FAKE_RESULT)}__END_RESULT__\n`,
        stderr: ''
      })
    }

    const { wc, sent } = makeFakeWindow()
    setJobManagerWindow({
      isDestroyed: () => false,
      webContents: wc
    } as unknown as import('electron').BrowserWindow)

    // Weight Cases choke point'i AI çağrısında da devrede olmalı (§3 ilke).
    await invoke(IPC.DATA_SET_WEIGHT, fakeEvent(wc), { datasetId: DATASET_ID, colId: 'col_1' })

    const sendResult = (await invoke(IPC.AI_SEND, fakeEvent(wc), {
      messages: [{ role: 'user', content: 'yaş için descriptives çalıştır' }]
    })) as { turnId: string }
    expect(sendResult.turnId).toBeTruthy()

    const done = await waitForDone(sent)
    expect(done.payload['error']).toBeUndefined()

    // 1) LLM 3 kez çağrıldı: get_variables → run_analysis → final.
    expect(captured).toHaveLength(3)
    expect(captured[0]?.body.tools?.map(t => t.function.name).sort()).toEqual([
      'get_data_profile',
      'get_variables',
      'propose_r_code',
      'propose_syntax',
      'run_analysis',
      'run_syntax'
    ])

    // Talimat metni sunucuda kurulur (CLAUDE.md §9): istemci sistem mesajı
    // ve tool açıklaması göndermez, yalnız `sai_prompt` bağlamını gönderir —
    // aktif weight dahil (sunucu bunu DATA CONTEXT'e koyar).
    for (const req of captured) {
      expect(req.body.messages.some(m => m.role === 'system')).toBe(false)
      expect(req.body.tools?.every(t => t.function.description === undefined)).toBe(true)
      expect(req.body.sai_prompt?.version).toBe(1)
      expect(req.body.sai_prompt?.kind).toBe('agent')
    }
    const ctx = captured[0]?.body.sai_prompt?.context
    expect(ctx?.datasets?.find(d => d.id === DATASET_ID)?.weightVariable).toBe('col_1')
    expect(ctx?.analyses?.length).toBeGreaterThan(0)

    // 2) run_analysis GERÇEK enqueue yoluna doğru şemayla ulaştı.
    expect(rCall).not.toBeNull()
    const { scriptPath, params } = rCall as unknown as {
      scriptPath: string
      params: Record<string, unknown>
    }
    expect(scriptPath).toMatch(/descriptives\.R$/)
    expect(params['datasetId']).toBe(DATASET_ID)
    expect(params['variables']).toEqual(['col_1'])
    // Companion params manifest'ten türetildi (model bunları kurmadı).
    expect(params['varNames']).toEqual({ col_1: 'yas' })
    // Choke point enjeksiyonu: weight + pipeline sabitleri.
    expect(params['weightVariable']).toBe('col_1')
    expect(params['parquetPath']).toContain('sai-export')
    expect(params['rScriptsDir']).toContain('r-scripts')
    // Manifest default'ları uygulandı.
    expect(params['options']).toMatchObject({ mean: true, sd: true })
    expect(params['saveZScores']).toBe(false)

    // 3) Renderer akışı değişmedi: job:complete Output bloğuna gidecek payload ile gitti.
    const jobComplete = sent.find(e => e.channel === IPC.JOB_COMPLETE)
    expect(jobComplete).toBeDefined()
    expect(jobComplete?.payload['analysisId']).toBe('descriptives')
    // FAKE_RESULT is what R writes to stdout; `caseVars` is optional there and
    // AnalysisResultSchema fills in its [] default on parse, so the payload the
    // renderer sees carries the key even when the script never emitted it.
    expect(jobComplete?.payload['result']).toEqual({ ...FAKE_RESULT, caseVars: [] })

    // 4) Tool event'leri: her iki tool için running → done.
    const toolEvents = sent.filter(e => e.channel === IPC.AI_TOOL_EVENT)
    expect(toolEvents).toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({ tool: 'get_variables', status: 'running' })
      })
    )
    expect(toolEvents).toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({ tool: 'run_analysis', status: 'done' })
      })
    )

    // 5) "Sonuç geldi" tool mesajı modele geri gitti (3. isteğin son mesajı).
    const thirdMessages = captured[2]?.body.messages ?? []
    const lastTool = thirdMessages[thirdMessages.length - 1]
    expect(lastTool?.role).toBe('tool')
    expect(lastTool?.content).toContain('42.5')
    expect(lastTool?.content).toContain('weightNotApplied')

    // 6) Final yorum stream-chunk olarak aktı.
    const textChunk = sent.find(
      e => e.channel === IPC.AI_STREAM_CHUNK && e.payload['delta'] === FINAL_TEXT
    )
    expect(textChunk).toBeDefined()

    // Temizlik: weight'i sıfırla (sonraki testler etkilenmesin).
    await invoke(IPC.DATA_SET_WEIGHT, fakeEvent(wc), { datasetId: DATASET_ID, colId: null })
  }, 30_000)

  it("data:set-column-filters → run_analysis GERÇEK filtrelenmiş parquet'i R'a verir (2026-09-04 destek talebi)", async () => {
    // Regresyon: job-bridge.ts eskiden exportDatasetToParquet(datasetId, {})
    // çağırıyordu — AI'dan tetiklenen her analiz kullanıcının onayladığı
    // SELECT IF'ten bağımsız DAİMA tam veri kümesi üzerinde koşuyordu. Artık
    // getColumnFilters(datasetId) (data:set-column-filters ile Renderer'dan
    // aynalanan choke-point) okunuyor — bu test parquet'in GERÇEKTEN
    // filtrelendiğini (mock R'a ulaşmadan önce DuckDB ile geri okuyarak)
    // doğrular, sadece iletilen param şeklini değil.
    const captured: CapturedRequest[] = []
    mocks.baseUrl = await startMockLlm(defaultScript, captured)

    let parquetRowCount: number | null = null
    let parquetYasValues: unknown[] = []
    mocks.runRScript = async opts => {
      // Parquet columns keep colId, not the display name (parquet-export.ts) —
      // col_1 is 'yas' here (see beforeAll's Variable list).
      const conn = await getDbConnection()
      const parquetPath = String(opts.params['parquetPath']).replace(/\\/g, '/')
      const reader = await conn.runAndReadAll(
        `SELECT col_1 FROM read_parquet('${parquetPath}') ORDER BY col_1`
      )
      const rows = reader.getRows() as [number][]
      parquetRowCount = rows.length
      parquetYasValues = rows.map(r => r[0])
      return {
        exitCode: 0,
        stdout: `\n__SAI_RESULT__${JSON.stringify(FAKE_RESULT)}__END_RESULT__\n`,
        stderr: ''
      }
    }

    const { wc, sent } = makeFakeWindow()
    setJobManagerWindow({
      isDestroyed: () => false,
      webContents: wc
    } as unknown as import('electron').BrowserWindow)

    // Terminal'in SELECT IF'inin ürettiği state'in Renderer→Main aynası:
    // yas > 15 → col_1 = {10,20,30,NULL} içinden yalnızca 20 ve 30 kalmalı.
    await invoke(IPC.DATA_SET_COLUMN_FILTERS, fakeEvent(wc), {
      datasetId: DATASET_ID,
      columnFilters: { col_1: { operator: 'greater_than', value: '15' } }
    })

    const sendResult = (await invoke(IPC.AI_SEND, fakeEvent(wc), {
      messages: [{ role: 'user', content: 'yaş için descriptives çalıştır' }]
    })) as { turnId: string }
    expect(sendResult.turnId).toBeTruthy()

    const done = await waitForDone(sent)
    expect(done.payload['error']).toBeUndefined()

    expect(parquetRowCount).toBe(2)
    expect(parquetYasValues).toEqual([20, 30])

    // Temizlik: filtreyi sıfırla (sonraki testler etkilenmesin).
    await invoke(IPC.DATA_SET_COLUMN_FILTERS, fakeEvent(wc), {
      datasetId: DATASET_ID,
      columnFilters: {}
    })
  }, 30_000)

  it('get_variables → run_syntax (RATIO STATISTICS) → aynı enqueue yoluna ulaşır', async () => {
    const captured: CapturedRequest[] = []
    mocks.baseUrl = await startMockLlm(messages => {
      const last = messages[messages.length - 1]
      if (!last || last.role === 'user') return 'get_variables'
      if (last.role === 'tool') {
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i]
          if (m && m.role === 'assistant' && m.tool_calls) {
            const tc = m.tool_calls.find(t => t.id === last.tool_call_id)
            if (tc?.function.name === 'get_variables') return 'run_syntax'
          }
        }
      }
      return 'final'
    }, captured)

    let rCall: { scriptPath: string; params: Record<string, unknown> } | null = null
    mocks.runRScript = opts => {
      rCall = opts
      return Promise.resolve({
        exitCode: 0,
        stdout: `\n__SAI_RESULT__${JSON.stringify(FAKE_RESULT)}__END_RESULT__\n`,
        stderr: ''
      })
    }

    const { wc, sent } = makeFakeWindow()
    setJobManagerWindow({
      isDestroyed: () => false,
      webContents: wc
    } as unknown as import('electron').BrowserWindow)

    const sendResult = (await invoke(IPC.AI_SEND, fakeEvent(wc), {
      messages: [{ role: 'user', content: 'yas/cinsiyet için oran istatistikleri çalıştır' }]
    })) as { turnId: string }
    expect(sendResult.turnId).toBeTruthy()

    const done = await waitForDone(sent)
    expect(done.payload['error']).toBeUndefined()

    // run_syntax, spss-syntax-analysis.ts'in parsing'iyle 'ratio.R'ı doğru
    // colId'lerle enqueue etti — Terminal'in RATIO STATISTICS handler'ıyla
    // AYNI kod yolu (shared/spss-syntax-analysis.ts).
    expect(rCall).not.toBeNull()
    const { scriptPath, params } = rCall as unknown as {
      scriptPath: string
      params: Record<string, unknown>
    }
    expect(scriptPath).toMatch(/ratio\.R$/)
    expect(params['numerator']).toBe('col_1')
    expect(params['denominator']).toBe('col_2')

    const toolEvents = sent.filter(e => e.channel === IPC.AI_TOOL_EVENT)
    expect(toolEvents).toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({ tool: 'run_syntax', status: 'done' })
      })
    )
  }, 30_000)

  it('run_syntax bir çağrıda en fazla MAX analiz çalıştırır (kaynak-tüketimi üst sınırı)', async () => {
    const captured: CapturedRequest[] = []
    mocks.baseUrl = await startMockLlm(messages => {
      const last = messages[messages.length - 1]
      if (!last || last.role === 'user') return 'get_variables'
      if (last.role === 'tool') {
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i]
          if (m && m.role === 'assistant' && m.tool_calls) {
            const tc = m.tool_calls.find(t => t.id === last.tool_call_id)
            if (tc?.function.name === 'get_variables') return 'run_syntax_many'
          }
        }
      }
      return 'final'
    }, captured)

    let rCallCount = 0
    mocks.runRScript = () => {
      rCallCount++
      return Promise.resolve({
        exitCode: 0,
        stdout: `\n__SAI_RESULT__${JSON.stringify(FAKE_RESULT)}__END_RESULT__\n`,
        stderr: ''
      })
    }

    const { wc, sent } = makeFakeWindow()
    setJobManagerWindow({
      isDestroyed: () => false,
      webContents: wc
    } as unknown as import('electron').BrowserWindow)

    const sendResult = (await invoke(IPC.AI_SEND, fakeEvent(wc), {
      messages: [{ role: 'user', content: 'yas için 12 kere ki-kare testi çalıştır' }]
    })) as { turnId: string }
    expect(sendResult.turnId).toBeTruthy()

    const done = await waitForDone(sent)
    expect(done.payload['error']).toBeUndefined()

    // 12 /CHISQUARE alt-komutu istendi ama tek çağrıda en fazla 10 R işi
    // kuyruklandı — kaynak-tüketimi amplifikasyonuna karşı üst sınır.
    expect(rCallCount).toBe(10)

    const thirdMessages = captured[2]?.body.messages ?? []
    const lastTool = thirdMessages[thirdMessages.length - 1]
    expect(lastTool?.role).toBe('tool')
    expect(lastTool?.content).toContain('Stopped after 10 analyses')
  }, 30_000)

  it('tool sonrası boş content → bir kez özet dürtmesi → hâlâ boşsa sabit bilgilendirme metni (2026-07-28 geri bildirimi: chat boş kalıyordu)', async () => {
    const captured: CapturedRequest[] = []
    // Bazı (özellikle ücretsiz) modeller run_analysis'in tool sonucunu aldıktan
    // sonra hiç metin döndürmüyor — analiz Output'a düşüyor ama sohbette hiçbir
    // şey görünmüyordu. Bu script hem ilk boş cevabı hem de dürtme sonrası
    // hâlâ boş cevabı simüle eder.
    mocks.baseUrl = await startMockLlm(messages => {
      const last = messages[messages.length - 1]
      if (!last) return 'final'
      if (last.role === 'user' && last.content?.includes('Briefly summarize')) return 'empty'
      if (last.role === 'user') return 'run_analysis'
      if (last.role === 'tool') return 'empty'
      return 'final'
    }, captured)

    mocks.runRScript = () =>
      Promise.resolve({
        exitCode: 0,
        stdout: `\n__SAI_RESULT__${JSON.stringify(FAKE_RESULT)}__END_RESULT__\n`,
        stderr: ''
      })

    const { wc, sent } = makeFakeWindow()
    setJobManagerWindow({
      isDestroyed: () => false,
      webContents: wc
    } as unknown as import('electron').BrowserWindow)

    await invoke(IPC.AI_SEND, fakeEvent(wc), {
      messages: [{ role: 'user', content: 'cinsiyete göre yaş arasında fark var mı' }]
    })

    const done = await waitForDone(sent)
    expect(done.payload['error']).toBeUndefined()

    // run_analysis isteği + tool-sonrası boş cevap + bir kez dürtme = 3 istek.
    expect(captured).toHaveLength(3)
    const nudgeRequest = captured[2]?.body.messages ?? []
    expect(nudgeRequest[nudgeRequest.length - 1]?.content).toContain('Briefly summarize')

    // Analiz gerçekten Output'a düştü (job:complete).
    expect(sent.find(e => e.channel === IPC.JOB_COMPLETE)).toBeDefined()

    // Chat balonu boş KALMADI — sabit bilgilendirme metni göründü (uydurma
    // istatistik yok, yalnız "sonuçları Output'ta görebilirsiniz" notu).
    const textChunk = sent.find(
      e => e.channel === IPC.AI_STREAM_CHUNK && typeof e.payload['delta'] === 'string'
    )
    expect(textChunk?.payload['delta']).toBeTruthy()
    expect(textChunk?.payload['delta']).toContain('Output')
  }, 30_000)

  it('get_data_profile allow-list agregatları doğru hesaplar (ham satır yok)', async () => {
    const captured: CapturedRequest[] = []
    mocks.baseUrl = await startMockLlm(messages => {
      const last = messages[messages.length - 1]
      return last && last.role === 'tool' ? 'final' : 'get_data_profile'
    }, captured)
    mocks.runRScript = () => Promise.reject(new Error('R should not run in this test'))

    const { wc, sent } = makeFakeWindow()
    setJobManagerWindow({
      isDestroyed: () => false,
      webContents: wc
    } as unknown as import('electron').BrowserWindow)

    await invoke(IPC.AI_SEND, fakeEvent(wc), {
      messages: [{ role: 'user', content: 'yaş değişkenini profille' }]
    })
    const done = await waitForDone(sent)
    expect(done.payload['error']).toBeUndefined()

    expect(captured).toHaveLength(2)
    const profileMessage = captured[1]?.body.messages[captured[1].body.messages.length - 1]
    expect(profileMessage?.role).toBe('tool')
    const profile = JSON.parse(profileMessage?.content ?? '{}') as Record<string, unknown>
    // Veri: 10, 20, 30, NULL → total 4, valid 3, missing 1
    expect(profile['colId']).toBe('col_1')
    expect(profile['total']).toBe(4)
    expect(profile['valid']).toBe(3)
    expect(profile['missing']).toBe(1)
    expect(profile['mean']).toBeCloseTo(20)
    expect(profile['sd']).toBeCloseTo(10)
    expect(profile['min']).toBe(10)
    expect(profile['max']).toBe(30)
    // Scale değişkende topValues YOK (agrega yüzeyi minimal).
    expect(profile['topValues']).toBeUndefined()
  }, 30_000)

  it("şema ihlali R'a ulaşmaz — hata tool result olarak döner (retry turu)", async () => {
    const captured: CapturedRequest[] = []
    mocks.baseUrl = await startMockLlm(messages => {
      const last = messages[messages.length - 1]
      return last && last.role === 'tool' ? 'final' : 'run_analysis_bad'
    }, captured)
    mocks.runRScript = () => Promise.reject(new Error('R must not run on schema violation'))

    const { wc, sent } = makeFakeWindow()
    setJobManagerWindow({
      isDestroyed: () => false,
      webContents: wc
    } as unknown as import('electron').BrowserWindow)

    await invoke(IPC.AI_SEND, fakeEvent(wc), {
      messages: [{ role: 'user', content: 'descriptives çalıştır' }]
    })
    const done = await waitForDone(sent)
    expect(done.payload['error']).toBeUndefined()

    // 2 tur: kötü run_analysis → final. R hiç çağrılmadı.
    expect(captured).toHaveLength(2)
    const errMessage = captured[1]?.body.messages[captured[1].body.messages.length - 1]
    expect(errMessage?.role).toBe('tool')
    const errPayload = JSON.parse(errMessage?.content ?? '{}') as { error?: string }
    expect(errPayload.error).toContain('Invalid params for analysis "descriptives"')
    expect(errPayload.error).toContain('variables')

    // Tool event'i error status ile kapandı; job:complete YOK.
    const toolEvents = sent.filter(e => e.channel === IPC.AI_TOOL_EVENT)
    expect(toolEvents).toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({ tool: 'run_analysis', status: 'error' })
      })
    )
    expect(sent.find(e => e.channel === IPC.JOB_COMPLETE)).toBeUndefined()
  }, 30_000)

  it('ai:cancel job beklemesini de iptal eder (turn cancelled ile kapanır)', async () => {
    const captured: CapturedRequest[] = []
    mocks.baseUrl = await startMockLlm(messages => {
      const last = messages[messages.length - 1]
      return last && last.role === 'tool' ? 'final' : 'run_analysis'
    }, captured)
    // R sınırı asılı kalır; yalnız job iptali (signal abort) ile düşer.
    mocks.runRScript = opts =>
      new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new Error('R aborted')), {
          once: true
        })
      })

    const { wc, sent } = makeFakeWindow()
    setJobManagerWindow({
      isDestroyed: () => false,
      webContents: wc
    } as unknown as import('electron').BrowserWindow)

    const sendResult = (await invoke(IPC.AI_SEND, fakeEvent(wc), {
      messages: [{ role: 'user', content: 'descriptives çalıştır' }]
    })) as { turnId: string }

    // Job kuyruğa düşüp runRScript asılana kadar bekle, sonra iptal et.
    await new Promise(r => setTimeout(r, 200))
    await invoke(IPC.AI_CANCEL, fakeEvent(wc), { turnId: sendResult.turnId })

    const done = await waitForDone(sent)
    expect(done.payload['error']).toBe('cancelled')
    // Final tur için LLM'e ikinci istek GİTMEDİ (iptal bütün döngüyü kapsar).
    expect(captured).toHaveLength(1)
  }, 30_000)

  // 2026-08-14: turlar artık SSE ile akıyor (yavaş modelde ilk token'ı
  // beklemek yerine metin geldikçe sohbete düşsün). Tool çağrıları da
  // parça parça gelir — arguments string'i karakter karakter birikir.
  it('SSE akışı: metin parça parça iletilir, parçalı tool_call birleştirilip çalıştırılır', async () => {
    const captured: CapturedRequest[] = []
    mocks.baseUrl = await startStreamingMockLlm(captured)
    mocks.runRScript = () => Promise.reject(new Error('R should not run in this test'))

    const { wc, sent } = makeFakeWindow()
    const done = await (async () => {
      await invoke(IPC.AI_SEND, fakeEvent(wc), {
        messages: [{ role: 'user', content: 'değişkenleri özetle' }]
      })
      return waitForDone(sent)
    })()
    expect(done.payload['error']).toBeUndefined()

    // İlk tur parçalı bir get_variables tool_call'ı döndü → tool çalıştı.
    expect(captured).toHaveLength(2)
    const toolMessage = captured[1]?.body.messages[captured[1].body.messages.length - 1]
    expect(toolMessage?.role).toBe('tool')
    expect(JSON.parse(toolMessage?.content ?? '{}')).toHaveProperty('variables')
    // İstek gerçekten streaming açıldı.
    expect((captured[0]?.body as unknown as { stream?: boolean }).stream).toBe(true)

    // Metin TEK parça değil, delta delta geldi (algılanan hız için asıl kazanç).
    const deltas = sent
      .filter(e => e.channel === IPC.AI_STREAM_CHUNK && e.payload['delta'] !== '')
      .map(e => e.payload['delta'] as string)
    expect(deltas.length).toBeGreaterThan(1)
    expect(deltas.join('')).toBe(STREAMED_TEXT)
  }, 30_000)

  it("429 → bekle + aynı round'u yeniden dene; tamamlanan round'un tool izi Renderer'a gider", async () => {
    const captured: CapturedRequest[] = []
    mocks.baseUrl = await startRateLimitedMockLlm(captured)
    mocks.runRScript = () => Promise.reject(new Error('R should not run in this test'))

    const { wc, sent } = makeFakeWindow()
    await invoke(IPC.AI_SEND, fakeEvent(wc), {
      messages: [{ role: 'user', content: 'değişkenleri listele' }]
    })
    const done = await waitForDone(sent)
    expect(done.payload['error']).toBeUndefined()

    // 429'lu istek + aynı round'un tekrarı + tool sonrası final round.
    expect(captured).toHaveLength(3)
    expect(captured[1]?.body.messages).toEqual(captured[0]?.body.messages)

    const waitEvents = sent
      .filter(e => e.channel === IPC.AI_TOOL_EVENT && e.payload['tool'] === 'rate_limit_wait')
      .map(e => e.payload['status'])
    expect(waitEvents).toEqual(['running', 'done'])

    const traces = sent.filter(e => e.channel === IPC.AI_TURN_TRACE)
    expect(traces).toHaveLength(1)
    const traceMessages = traces[0]?.payload['messages'] as {
      role: string
      content: string
      toolCalls?: { name: string }[]
      toolCallId?: string
    }[]
    expect(traceMessages.map(m => m.role)).toEqual(['assistant', 'tool'])
    expect(traceMessages[0]?.toolCalls?.[0]?.name).toBe('get_variables')
    expect(traceMessages[1]?.toolCallId).toBe('tc_gv')
    expect(JSON.parse(traceMessages[1]?.content ?? '{}')).toHaveProperty('variables')
  }, 30_000)

  it('adım sınırında hata yerine araçsız özet turu + tool-round-limit bildirimi', async () => {
    const captured: CapturedRequest[] = []
    mocks.baseUrl = await startEndlessToolMockLlm(captured)
    mocks.runRScript = () => Promise.reject(new Error('R should not run in this test'))

    const { wc, sent } = makeFakeWindow()
    await invoke(IPC.AI_SEND, fakeEvent(wc), {
      messages: [{ role: 'user', content: 'her şeyi analiz et' }]
    })
    const done = await waitForDone(sent)
    expect(done.payload['error']).toBeUndefined()
    expect(done.payload['notice']).toBe('tool-round-limit')

    // 10 tool round'u + 1 araçsız özet round'u.
    expect(captured).toHaveLength(11)
    const last = captured[10]?.body as CapturedRequest['body'] & { tool_choice?: string }
    expect(last.tool_choice).toBe('none')
    expect(last.messages.at(-1)?.role).toBe('user')
    // Her tamamlanan round'un izi Renderer'a gitti ("devam et" tekrarlamasın).
    expect(sent.filter(e => e.channel === IPC.AI_TURN_TRACE)).toHaveLength(10)

    const text = sent
      .filter(e => e.channel === IPC.AI_STREAM_CHUNK)
      .map(e => e.payload['delta'] as string)
      .join('')
    expect(text).toContain('Özet: X yapıldı, Y kaldı.')
  }, 30_000)
})
