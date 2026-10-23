// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ai-provider.ts — OpenAI-compatible chat-completions HTTP client (Faz F0).
 *
 * Saf Node (global fetch, Node 24) — Electron import'u YOK, bu yüzden vitest'te
 * yerel mock HTTP sunucusuna karşı doğrudan test edilir
 * (tests/unit/ai-provider.test.ts). Tek OpenAI-compatible arayüz
 * (ai-entegrasyon-fizibilitesi.md §4.1).
 */

import { z } from 'zod'
import type { ChatMessage, AiProviderConfig, AiSaiPrompt } from '../../shared/ai-types'

export class AiProviderError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AiProviderError'
    this.status = status
  }
}

/**
 * Bağlantı kuruldu ama yanıt/akış zamanında gelmedi. Ağ hatasından AYRI bir
 * sınıf: yavaş bir modeli "Sağlayıcıya ulaşılamadı, internet bağlantınızı
 * kontrol edin" diye raporlamak kullanıcıyı yanlış yere yönlendiriyordu
 * (2026-08-14 kullanıcı geri bildirimi).
 */
export class AiTimeoutError extends AiProviderError {
  constructor(message: string) {
    super(message)
    this.name = 'AiTimeoutError'
  }
}

// İstek zaman aşımı üst sınırı.
const REQUEST_TIMEOUT_MS = 120_000

// ─── Geçici hata (429/5xx) için bekle-ve-yeniden-dene ──────────────────────
// Dakikalık istek/token limiti (429) ya da sağlayıcının anlık aşırı yükü
// (502/503/529) genelde birkaç saniye içinde düzelir. Eskiden hata doğrudan
// kullanıcıya düşüyor, agent turu yarıda kalıyordu (2026-09-29 kullanıcı
// geri bildirimi). Retry-After'a uyulur; sağlayıcı bir dakikadan uzun
// bekleme isterse bu dakikalık değil günlük/kota sınırıdır — beklemeden
// hatayı göster (kullanıcıyı dakikalarca spinner'la bekletme).
const RETRYABLE_STATUS = new Set([429, 502, 503, 529])
const RETRY_BACKOFF_MS = [5_000, 15_000, 30_000]
const MAX_RETRY_WAIT_MS = 60_000

function retryAfterHeaderMs(res: Response): number | undefined {
  const ms = Number(res.headers.get('retry-after-ms') ?? Number.NaN)
  if (Number.isFinite(ms)) return ms
  const header = res.headers.get('retry-after')
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return seconds * 1000
  const date = Date.parse(header)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

/**
 * Başarısız yanıt yeniden denenmeli mi, ne kadar sonra? `attempt` 0'dan
 * başlayan deneme sırası; undefined = yeniden deneme, hatayı fırlat.
 */
export function retryDelayMs(res: Response, attempt: number): number | undefined {
  if (!RETRYABLE_STATUS.has(res.status) || attempt >= RETRY_BACKOFF_MS.length) return undefined
  const requested = retryAfterHeaderMs(res)
  if (requested === undefined) return RETRY_BACKOFF_MS[attempt]
  return requested > MAX_RETRY_WAIT_MS ? undefined : Math.max(requested, 1_000)
}

/** İptal edilebilir bekleme — signal tetiklenince reason ile reddeder. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error)
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason as Error)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const ChatCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish()
        })
      })
    )
    .min(1)
})

const StreamChunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z.object({
        content: z.string().nullish()
      })
    })
  )
})

async function postChatCompletions(
  config: AiProviderConfig,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Response> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }
  // İstemcinin AbortSignal'ı + kendi timeout'umuz birleşir; istemci iptali
  // (ai:cancel) fetch'in AbortError'u olarak aynen yukarı taşınır.
  const combined = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
    : AbortSignal.timeout(REQUEST_TIMEOUT_MS)

  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: combined
      })
    } catch (err) {
      if (signal?.aborted) throw err
      throw new AiProviderError(
        `Provider request failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    if (res.ok) return res

    // Hata gövdesi provider'a ait metadata; içerik loglanmaz (§6.5) — sadece
    // renderer'a hata mesajı olarak kısa bir kesit döner.
    const detail = (await res.text().catch(() => '')).slice(0, 500)
    const wait = retryDelayMs(res, attempt)
    if (wait === undefined) {
      throw new AiProviderError(`Provider HTTP ${String(res.status)}: ${detail}`, res.status)
    }
    try {
      await abortableSleep(wait, combined)
    } catch (err) {
      if (signal?.aborted) throw err
      throw new AiTimeoutError('Provider request timed out while waiting to retry')
    }
  }
}

/**
 * Tek tur, streaming'siz completion — ai:interpret bunu kullanır.
 * `saiPrompt` verilirse sistem prompt'unu SAI sunucusu kurar.
 */
export async function chatCompletion(
  config: AiProviderConfig,
  messages: ChatMessage[],
  opts?: { signal?: AbortSignal; maxTokens?: number; saiPrompt?: AiSaiPrompt }
): Promise<string> {
  const res = await postChatCompletions(
    config,
    {
      model: config.model,
      messages,
      stream: false,
      ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      ...(opts?.saiPrompt ? { sai_prompt: opts.saiPrompt } : {})
    },
    opts?.signal
  )
  const parsed = ChatCompletionResponseSchema.safeParse(await res.json())
  if (!parsed.success) {
    throw new AiProviderError('Provider returned an unexpected response shape')
  }
  return parsed.data.choices[0]?.message.content ?? ''
}

/**
 * Streaming (SSE) completion — ai:send bunu kullanır. Her `data:` satırındaki
 * delta `onDelta`'ya akar; dönen string tüm deltaların birleşimidir.
 */
export async function streamChatCompletion(
  config: AiProviderConfig,
  messages: ChatMessage[],
  opts: { signal?: AbortSignal; onDelta: (delta: string) => void; maxTokens?: number }
): Promise<string> {
  const res = await postChatCompletions(
    config,
    {
      model: config.model,
      messages,
      stream: true,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {})
    },
    opts.signal
  )
  if (!res.body) {
    throw new AiProviderError('Provider returned no response body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  const handleLine = (rawLine: string): void => {
    const line = rawLine.trim()
    // Keep-alive yorumları (": ping") ve boş satırlar SSE'de normaldir.
    if (!line || !line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (data === '[DONE]') return
    let json: unknown
    try {
      json = JSON.parse(data)
    } catch {
      throw new AiProviderError('Malformed SSE data from provider')
    }
    const chunk = StreamChunkSchema.safeParse(json)
    if (!chunk.success) {
      throw new AiProviderError('Malformed SSE chunk from provider')
    }
    const delta = chunk.data.choices[0]?.delta.content
    if (delta) {
      text += delta
      opts.onDelta(delta)
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        handleLine(line)
      }
    }
    // Akış newline'sız biterse kalan tamponu da işle.
    if (buffer.trim()) handleLine(buffer)
  } finally {
    reader.releaseLock()
  }
  return text
}
