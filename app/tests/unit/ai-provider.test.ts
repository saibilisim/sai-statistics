// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'node:http'
import type { Server, IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Socket } from 'node:net'
import {
  chatCompletion,
  streamChatCompletion,
  AiProviderError
} from '../../electron/ai/ai-provider'
import { SettingsSchema } from '@shared/settings-types'
import { AI_SERVER_DEFAULT_MODEL, AiInterpretRequestSchema } from '@shared/ai-types'
import { AiSendRequestSchema, AiCancelRequestSchema } from '@shared/ipc-schemas'

// ─────────────────────────────────────────────────────────────
//  Yerel mock HTTP sunucusu — gerçek ağ çağrısı YOK.
// ─────────────────────────────────────────────────────────────

type MockHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void

const openServers: { server: Server; sockets: Set<Socket> }[] = []

async function startMockServer(handler: MockHandler): Promise<string> {
  const sockets = new Set<Socket>()
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    req.on('end', () => handler(req, res, body))
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
  // Açık soketleri (örn. abort testinde asılı kalan istek) önce kırp,
  // yoksa server.close beklemede kalır.
  for (const { server, sockets } of openServers.splice(0)) {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

const CONFIG = { model: 'test-model' }

describe('ai-provider: chatCompletion (non-streaming)', () => {
  it('parses the response and sends Authorization + model/messages', async () => {
    let captured: { auth?: string; body?: Record<string, unknown> } = {}
    const baseUrl = await startMockServer((req, res, body) => {
      captured = {
        auth: req.headers.authorization,
        body: JSON.parse(body) as Record<string, unknown>
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'Merhaba dünya' } }] }))
    })

    const text = await chatCompletion({ ...CONFIG, baseUrl, apiKey: 'sk-test' }, [
      { role: 'user', content: 'hi' }
    ])

    expect(text).toBe('Merhaba dünya')
    expect(captured.auth).toBe('Bearer sk-test')
    expect(captured.body?.['model']).toBe('test-model')
    expect(captured.body?.['stream']).toBe(false)
    expect(captured.body?.['messages']).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('omits the Authorization header when no apiKey is configured', async () => {
    let auth: string | undefined = 'unset'
    const baseUrl = await startMockServer((req, res) => {
      auth = req.headers.authorization
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
    })

    await chatCompletion({ ...CONFIG, baseUrl }, [{ role: 'user', content: 'hi' }])
    expect(auth).toBeUndefined()
  })

  it('rejects with AiProviderError (status attached) on HTTP errors', async () => {
    const baseUrl = await startMockServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'bad key' } }))
    })

    const promise = chatCompletion({ ...CONFIG, baseUrl }, [{ role: 'user', content: 'hi' }])
    await expect(promise).rejects.toThrow(AiProviderError)
    await expect(promise).rejects.toMatchObject({ status: 401 })
  })

  it('429 + kısa Retry-After: bekler, aynı isteği yeniden dener ve başarır', async () => {
    let calls = 0
    const baseUrl = await startMockServer((_req, res) => {
      calls += 1
      if (calls === 1) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' })
        res.end(JSON.stringify({ error: { message: 'rate limited' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
    })

    const text = await chatCompletion({ ...CONFIG, baseUrl }, [{ role: 'user', content: 'hi' }])
    expect(text).toBe('ok')
    expect(calls).toBe(2)
  })

  it('429 + bir dakikadan uzun Retry-After (kota): beklemeden status ile reddeder', async () => {
    let calls = 0
    const baseUrl = await startMockServer((_req, res) => {
      calls += 1
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '3600' })
      res.end(JSON.stringify({ error: { message: 'daily quota' } }))
    })

    const promise = chatCompletion({ ...CONFIG, baseUrl }, [{ role: 'user', content: 'hi' }])
    await expect(promise).rejects.toMatchObject({ status: 429 })
    expect(calls).toBe(1)
  })

  it('rejects on an unexpected response shape', async () => {
    const baseUrl = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ nope: true }))
    })

    await expect(
      chatCompletion({ ...CONFIG, baseUrl }, [{ role: 'user', content: 'hi' }])
    ).rejects.toThrow(AiProviderError)
  })
})

describe('ai-provider: streamChatCompletion (SSE)', () => {
  it('parses data: lines, skips [DONE], and concatenates deltas', async () => {
    const baseUrl = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Sel' } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'am' } }] })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })

    const deltas: string[] = []
    const text = await streamChatCompletion(
      { ...CONFIG, baseUrl },
      [{ role: 'user', content: 'hi' }],
      {
        onDelta: d => deltas.push(d)
      }
    )

    expect(deltas).toEqual(['Sel', 'am'])
    expect(text).toBe('Selam')
  })

  it('handles SSE lines split across TCP chunks', async () => {
    const fullLine = `data: ${JSON.stringify({ choices: [{ delta: { content: 'abc' } }] })}\n\n`
    const mid = Math.floor(fullLine.length / 2)
    const baseUrl = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(fullLine.slice(0, mid))
      setTimeout(() => {
        res.write(fullLine.slice(mid))
        res.end()
      }, 10)
    })

    const text = await streamChatCompletion(
      { ...CONFIG, baseUrl },
      [{ role: 'user', content: 'hi' }],
      {
        onDelta: () => undefined
      }
    )
    expect(text).toBe('abc')
  })

  it('rejects on malformed SSE JSON', async () => {
    const baseUrl = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {not valid json}\n\n')
      res.end()
    })

    await expect(
      streamChatCompletion({ ...CONFIG, baseUrl }, [{ role: 'user', content: 'hi' }], {
        onDelta: () => undefined
      })
    ).rejects.toThrow(AiProviderError)
  })

  it('propagates the caller abort as AbortError (ai:cancel)', async () => {
    // Sunucu bilinçli olarak hiç yanıt vermiyor.
    const baseUrl = await startMockServer(() => undefined)
    const controller = new AbortController()

    const promise = streamChatCompletion(
      { ...CONFIG, baseUrl },
      [{ role: 'user', content: 'hi' }],
      {
        signal: controller.signal,
        onDelta: () => undefined
      }
    )
    setTimeout(() => controller.abort(), 20)

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('settings schema: ai section defaults', () => {
  it('parses {} into the documented F0 defaults', () => {
    const result = SettingsSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.ai.provider).toBe('server')
      expect(result.data.ai.model).toBe(AI_SERVER_DEFAULT_MODEL)
      expect(result.data.ai.consentGiven).toBe(false)
      expect('baseUrl' in result.data.ai).toBe(false) // BYOK endpoint ayarı kaldırıldı
    }
  })

  it('migrates a stored provider=free-default (removed) to server', () => {
    const result = SettingsSchema.safeParse({ ai: { provider: 'free-default' } })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.ai.provider).toBe('server')
    }
  })

  it('migrates a stored provider=byok (removed 2026-10-16) to server and drops its baseUrl', () => {
    const result = SettingsSchema.safeParse({
      ai: { provider: 'byok', baseUrl: 'https://api.openai.com/v1' }
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.ai.provider).toBe('server')
      expect('baseUrl' in result.data.ai).toBe(false)
    }
  })

  it('rejects an unknown provider and never carries an api key field', () => {
    expect(SettingsSchema.safeParse({ ai: { provider: 'ollama' } }).success).toBe(false)
    // Bilinmeyen alanlar (örn. apiKey) strip edilir — settings.json'a key girmez (§6.1).
    const parsed = SettingsSchema.safeParse({ ai: { apiKey: 'sk-secret' } })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect('apiKey' in parsed.data.ai).toBe(false)
    }
  })
})

describe('ipc-schemas: ai channels', () => {
  it('AiSendRequestSchema requires a non-empty, bounded message list', () => {
    expect(
      AiSendRequestSchema.safeParse({ messages: [{ role: 'user', content: 'hi' }] }).success
    ).toBe(true)
    expect(AiSendRequestSchema.safeParse({ messages: [] }).success).toBe(false)
    expect(
      AiSendRequestSchema.safeParse({ messages: [{ role: 'hacker', content: 'x' }] }).success
    ).toBe(false)
    expect(
      AiSendRequestSchema.safeParse({
        messages: Array.from({ length: 201 }, () => ({ role: 'user', content: 'x' }))
      }).success
    ).toBe(false)
    // toolCalls / toolCallId alanları şemada kabul edilir (F2 hazırlığı)
    expect(
      AiSendRequestSchema.safeParse({
        messages: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'tc1', name: 'run_analysis', arguments: '{}' }]
          },
          { role: 'tool', content: '{}', toolCallId: 'tc1' }
        ]
      }).success
    ).toBe(true)
  })

  it('AiCancelRequestSchema requires a UUID turnId', () => {
    expect(AiCancelRequestSchema.safeParse({ turnId: 'not-a-uuid' }).success).toBe(false)
    expect(
      AiCancelRequestSchema.safeParse({ turnId: '123e4567-e89b-12d3-a456-426614174000' }).success
    ).toBe(true)
  })

  it('AiInterpretRequestSchema validates the OutputBlock-like payload', () => {
    const validBlock = {
      analysisId: 'descriptives',
      titleKey: 'analysis.descriptives.title',
      timestamp: '2026-07-27T00:00:00.000Z',
      datasetName: 'demo.sdf',
      result: {
        success: true,
        tables: [
          {
            titleKey: 'output.table.descriptives',
            columns: ['output.col.n', 'output.col.mean'],
            rows: [['Yaş', 30, 42.5]]
          }
        ],
        plots: [],
        warnings: ['output.warn.weightNotApplied'],
        notes: []
      }
    }
    expect(AiInterpretRequestSchema.safeParse({ block: validBlock }).success).toBe(true)
    expect(
      AiInterpretRequestSchema.safeParse({ block: validBlock, question: 'Anlamlı mı?' }).success
    ).toBe(true)
    // result alanı AnalysisResultSchema — success eksikse reddedilmeli
    expect(
      AiInterpretRequestSchema.safeParse({
        block: { ...validBlock, result: { tables: [] } }
      }).success
    ).toBe(false)
    // question üst sınırı
    expect(
      AiInterpretRequestSchema.safeParse({ block: validBlock, question: 'x'.repeat(4001) }).success
    ).toBe(false)
  })
})
