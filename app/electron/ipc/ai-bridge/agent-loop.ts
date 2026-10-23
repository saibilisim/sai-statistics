// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * agent-loop.ts — F2 agent döngüsü (§3.1): tool'lu provider round-trip'i,
 * turn yönetimi (activeTurns) ve runAgentTurn.
 */

import log from 'electron-log'
import type { WebContents } from 'electron'
import { z } from 'zod'
import { IPC } from '../../../shared/ipc-contracts'
import type {
  ChatMessage,
  AiProviderConfig,
  AiSaiPrompt,
  AiToolDefinition,
  AiInterpretBlock,
  AiErrorCode,
  AiStreamNotice,
  ToolCall
} from '../../../shared/ai-types'
import { getSettings } from '../settings-handler'
import { AiProviderError, AiTimeoutError, abortableSleep, retryDelayMs } from '../../ai/ai-provider'
import { requireProviderConfig, toAiError } from './provider-config'
import { agentPrompt, buildToolDefinitions } from './prompts'
import { executeToolCall } from './tools'
import { elideStaleToolResults, trimHistory } from './context-budget'

// ─── Agent provider round-trip (tool'lu, streaming) ─────────────────────────
// ai-provider.ts F0 kapsamında tool'suz yazıldı ve bu fazın dosya sınırı
// dışında — tool çağrılı tur burada kendi kendine yeterli (self-contained)
// tutulur; hata sınıfı ve abort deseni ai-provider ile aynıdır.
//
// 2026-08-14: turlar `stream: false` idi — model yanıtın TAMAMINI üretene
// kadar (yavaş/ücretsiz modellerde dakikalarca) tek bayt gelmiyordu ve
// 120 sn'lik TOPLAM zaman aşımı, ilerlemekte olan bir üretimi de kesiyordu
// ("Sağlayıcıya ulaşılamadı" hatası aslında buydu). Artık:
//   - SSE ile akış: token'lar geldikçe sohbete düşer (algılanan hız),
//   - zaman aşımı TOPLAM değil BOŞTA-KALMA süresi: akış ilerledikçe sıfırlanır,
//   - üstte yine de bir mutlak tavan var (sonsuz akışa karşı).
// Sağlayıcı `stream`'i yok sayıp tek parça JSON dönerse (bazı yerel/uyumlu
// uçlar ve testlerdeki sahte sunucu) eski yol aynen çalışır.

/** İki veri parçası arasındaki azami sessizlik. */
const STREAM_IDLE_TIMEOUT_MS = 60_000
/** Tek turun mutlak tavanı (akış ilerlese bile). */
const ROUND_HARD_TIMEOUT_MS = 600_000

const RoundResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                function: z.object({ name: z.string(), arguments: z.string() })
              })
            )
            .optional()
        })
      })
    )
    .min(1)
})

// SSE parçası: content ve tool_call'lar PARÇA PARÇA gelir (arguments string'i
// karakter karakter birikir), bu yüzden alanların hepsi opsiyonel.
const StreamRoundChunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullish(),
            tool_calls: z
              .array(
                z.object({
                  index: z.number().int().nonnegative().optional(),
                  id: z.string().nullish(),
                  function: z
                    .object({ name: z.string().nullish(), arguments: z.string().nullish() })
                    .optional()
                })
              )
              .optional()
          })
          .optional()
      })
    )
    .optional()
})

// OpenAI wire formatı: assistant tool_calls + role:'tool' tool_call_id.
function toOpenAiMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map(m => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments }
        }))
      }
    }
    return { role: m.role, content: m.content }
  })
}

/** Parça parça gelen tool_call'ı biriktirir (index → kısmi çağrı). */
interface PartialToolCall {
  id: string
  name: string
  arguments: string
}

function collectStreamedToolCalls(partials: Map<number, PartialToolCall>): ToolCall[] {
  return [...partials.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, tc]) => ({
      // id'yi atlayan sağlayıcılar var; tool sonucu mesajıyla eşleşmesi
      // yeterli olduğu için yerel bir id üretmek güvenli.
      id: tc.id !== '' ? tc.id : `call_${String(index)}`,
      name: tc.name,
      arguments: tc.arguments !== '' ? tc.arguments : '{}'
    }))
    .filter(tc => tc.name !== '')
}

async function chatCompletionRound(
  config: AiProviderConfig,
  messages: ChatMessage[],
  opts: {
    tools: AiToolDefinition[]
    /** Sistem prompt'unun bağlamı — talimat metnini sunucu bundan kurar. */
    saiPrompt: AiSaiPrompt
    signal?: AbortSignal
    onDelta: (delta: string) => void
    /** 429/5xx sonrası beklemeye girilirken (true) ve bekleme bitince (false). */
    onRetryWait?: (waiting: boolean) => void
    /**
     * 'none' = model bu round'da tool çağıramaz (adım sınırı özet turu).
     * Tool tanımları yine gönderilir: geçmişte tool_call varken tanımları
     * düşürmek bazı sağlayıcılarda (Anthropic/OpenRouter) 400 döndürür.
     */
    toolChoice?: 'none'
  }
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }

  // Boşta-kalma zaman aşımı: her veri parçasında sıfırlanır, dolarsa turu
  // kendimiz iptal ederiz (fetch'in kendi AbortSignal.timeout'u toplam süreyi
  // ölçer — yavaş ama ilerleyen bir akışı haksız yere keserdi).
  const idleController = new AbortController()
  let idleTimedOut = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const resetIdle = (): void => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimedOut = true
      idleController.abort()
    }, STREAM_IDLE_TIMEOUT_MS)
  }
  const signals = [idleController.signal, AbortSignal.timeout(ROUND_HARD_TIMEOUT_MS)]
  if (opts.signal) signals.push(opts.signal)
  const combined = AbortSignal.any(signals)

  const toProviderError = (err: unknown): Error => {
    if (opts.signal?.aborted) return err instanceof Error ? err : new Error(String(err))
    if (idleTimedOut) {
      return new AiTimeoutError(
        `Provider sent no data for ${String(STREAM_IDLE_TIMEOUT_MS / 1000)}s (request timed out)`
      )
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return new AiTimeoutError('Provider request timed out')
    }
    return new AiProviderError(
      `Provider request failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  // reasoning_effort artık kullanıcı tercihi (settings.ai.reasoningEffort,
  // AIPanel'deki düşünme seçici) — model ailesine göre otomatik tahmin ETMİYOR.
  // 'off' alanı hiç göndermez (Gemini 3.7 gibi reasoning'i zorunlu kılan
  // modellerle çakışmaz, bkz. 2026-08-25 "Reasoning is mandatory for this
  // endpoint and cannot be disabled." 400'ü); low/medium/high seçiliyse aynen
  // gönderilir. Reasoning token'ları upstream'de completion_tokens'a dahil
  // gelir (sai-ai-server costCredits zaten bunu kullanır) — ayrı bir
  // ücretlendirme mantığı gerekmez, kullanıcı ne kadar "düşünme" isterse o
  // kadar completion token'ı (ve maliyeti) oluşur.
  const reasoningEffort = getSettings().ai.reasoningEffort

  const body = JSON.stringify({
    model: config.model,
    messages: toOpenAiMessages(messages),
    tools: opts.tools.map(t => ({ type: 'function', function: t })),
    ...(opts.toolChoice ? { tool_choice: opts.toolChoice } : {}),
    sai_prompt: opts.saiPrompt,
    stream: true,
    ...(reasoningEffort !== 'off' ? { reasoning_effort: reasoningEffort } : {})
  })

  // 429 (dakikalık limit) / 5xx (anlık aşırı yük): Retry-After'a uyarak
  // bekle ve AYNI round'u tekrar dene — tur yarıda kesilip kullanıcıya hata
  // olarak düşmez (bkz. ai-provider.ts retryDelayMs). Bekleme boyunca
  // boşta-kalma sayacı durdurulur; iptal (ai:cancel) beklemeyi de keser.
  const fetchWithRetry = async (): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      resetIdle()
      let res: Response
      try {
        res = await fetch(url, { method: 'POST', headers, body, signal: combined })
      } catch (err) {
        throw toProviderError(err)
      }
      if (res.ok) return res
      const detail = (await res.text().catch(() => '')).slice(0, 500)
      const wait = retryDelayMs(res, attempt)
      if (wait === undefined) {
        throw new AiProviderError(`Provider HTTP ${String(res.status)}: ${detail}`, res.status)
      }
      log.info(
        `[ai-bridge] provider HTTP ${String(res.status)}, retrying in ${String(Math.round(wait / 1000))}s (attempt ${String(attempt + 1)})`
      )
      clearTimeout(idleTimer)
      opts.onRetryWait?.(true)
      try {
        await abortableSleep(wait, combined)
      } catch (err) {
        throw toProviderError(err)
      } finally {
        opts.onRetryWait?.(false)
      }
    }
  }

  try {
    const res = await fetchWithRetry()

    // Sağlayıcı `stream: true`'yu yok saydıysa tek parça JSON gelir — eski yol.
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream') || !res.body) {
      let payload: unknown
      try {
        payload = await res.json()
      } catch (err) {
        throw toProviderError(err)
      }
      const parsed = RoundResponseSchema.safeParse(payload)
      if (!parsed.success) {
        throw new AiProviderError('Provider returned an unexpected response shape')
      }
      const message = parsed.data.choices[0]?.message
      const content = message?.content ?? ''
      if (content !== '') opts.onDelta(content)
      return {
        content,
        toolCalls: (message?.tool_calls ?? []).map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments
        }))
      }
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const partials = new Map<number, PartialToolCall>()
    let buffer = ''
    let content = ''

    const handleLine = (rawLine: string): void => {
      const line = rawLine.trim()
      // Keep-alive yorumları (": ping") ve boş satırlar SSE'de normaldir.
      if (!line.startsWith('data:')) return
      const data = line.slice(5).trim()
      if (data === '' || data === '[DONE]') return
      let json: unknown
      try {
        json = JSON.parse(data)
      } catch {
        // Tek bozuk parça yüzünden turu düşürme — sağlayıcılar arada
        // şema dışı ("usage", hata sarmalayıcı vb.) satır gönderebiliyor.
        return
      }
      const chunk = StreamRoundChunkSchema.safeParse(json)
      if (!chunk.success) return
      const delta = chunk.data.choices?.[0]?.delta
      if (!delta) return
      if (delta.content) {
        content += delta.content
        opts.onDelta(delta.content)
      }
      for (const [i, tc] of (delta.tool_calls ?? []).entries()) {
        const index = tc.index ?? i
        const current = partials.get(index) ?? { id: '', name: '', arguments: '' }
        if (tc.id) current.id = tc.id
        if (tc.function?.name) current.name = tc.function.name
        if (tc.function?.arguments) current.arguments += tc.function.arguments
        partials.set(index, current)
      }
    }

    try {
      for (;;) {
        const { done, value } = await reader.read()
        resetIdle()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newlineIndex: number
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          handleLine(buffer.slice(0, newlineIndex))
          buffer = buffer.slice(newlineIndex + 1)
        }
      }
      if (buffer.trim()) handleLine(buffer)
    } catch (err) {
      throw toProviderError(err)
    } finally {
      reader.releaseLock()
    }

    return { content, toolCalls: collectStreamedToolCalls(partials) }
  } finally {
    clearTimeout(idleTimer)
  }
}

// ─── Turn yönetimi (ai:send / ai:cancel) ─────────────────────────────────────

export const activeTurns = new Map<string, AbortController>()

// §3.1: tool turu üst sınırı (sonsuz döngü koruması + maliyet sınırı, §10).
// 2026-09-29: 6'dan 10'a — normallik → test → post-hoc gibi zincirler 6'ya
// sığmıyordu (main.log'da sık "hit the tool round limit"). Bağlam artık
// kırpıldığı için (context-budget.ts) ek round'ların maliyeti eskisinden az.
const MAX_TOOL_ROUNDS = 10
// §10 context kırpma: yalnız son N mesaj modele gider (şema zaten 200'le sınırlar).
// Geçmiş artık önceki turların tool trafiğini de taşıdığı için (ai:turn-trace)
// sayı 60'tan yükseltildi; token'ı asıl sınırlayan elideStaleToolResults'tır.
const MAX_HISTORY_MESSAGES = 100

// ai:tool-event label'ları i18n ANAHTARI olarak gider — Renderer (ToolCallCard)
// t() ile çözümler; locale dosyalarına bu fazda dokunulmaz (çeviriler ayrı).
function toolLabelKey(call: ToolCall): string {
  return call.name === 'run_analysis' ? 'ai.tool.runAnalysis' : `ai.tool.${call.name}`
}

// Bazı (özellikle küçük/ücretsiz) modeller run_analysis'ten sonra tool
// çağrısı olmayan turda BOŞ content dönüyor — analiz Output'a düşüyor ama
// sohbette hiçbir şey görünmüyor (kullanıcı geri bildirimi, 2026-07-28).
// Tek seferlik "özetle" dürtmesi (nudge) — modelin kendi yorumunu üretmesi
// için bir şans daha; hâlâ boşsa NUDGE değil, sabit bir bilgilendirme metni
// gösterilir (uydurma istatistik YOK, yalnız "sonuçlar Output'ta" notu).
const SUMMARY_NUDGE =
  'Your previous turn produced tool results but no reply text. Briefly summarize the analysis result above for the user now (per the honesty rules), in the UI language. Do not call any more tools.'

// Adım sınırına gelindiğinde tur hata ile kesilmez: araçsız son bir round'da
// model o ana kadar yapılanı özetler, Renderer "devam et" ipucunu gösterir.
// İz (ai:turn-trace) zaten gönderildiği için devamda iş tekrarlanmaz.
const ROUND_LIMIT_NUDGE =
  'You have reached the maximum number of tool steps for this reply. Do not call any tools now. In the UI language, briefly summarize what you have done and found so far (per the honesty rules) and state what remains; the user can say "continue" to let you finish in a new reply.'

const EMPTY_RESPONSE_FALLBACK: Record<string, string> = {
  tr: 'Analiz tamamlandı ancak model ek bir yorum döndürmedi — sonuçları Output sekmesinde görebilirsiniz.',
  en: 'The analysis completed, but the model did not return additional commentary — check the Output tab for the results.',
  es: 'El análisis se completó, pero el modelo no devolvió comentarios adicionales — consulta los resultados en la pestaña Output.',
  fr: "L'analyse est terminée, mais le modèle n'a renvoyé aucun commentaire supplémentaire — consultez les résultats dans l'onglet Output.",
  it: "L'analisi è stata completata, ma il modello non ha restituito ulteriori commenti — controlla i risultati nella scheda Output.",
  pt: 'A análise foi concluída, mas o modelo não retornou comentários adicionais — veja os resultados na aba Output.'
}

function emptyResponseFallback(language: string): string {
  return EMPTY_RESPONSE_FALLBACK[language] ?? EMPTY_RESPONSE_FALLBACK['en'] ?? ''
}

/**
 * F2 agent döngüsü (§3.1): kullanıcı mesajı + geçmiş + sistem prompt'u + tool
 * şemaları → model. Model tool_call döndürürse Main tool'u çalıştırır, sonucu
 * role:'tool' mesajı olarak ekler, modele geri döner (max MAX_TOOL_ROUNDS tur).
 * run_analysis işini job:complete köprüsü bekler; biten AnalysisResult "sonuç
 * geldi" tool mesajıyla döngüyü sürdürür → model yorumu üretir. Nihai metin
 * ai:stream-chunk event'leriyle Renderer'a akar.
 */
export async function runAgentTurn(args: {
  turnId: string
  messages: ChatMessage[]
  mentionBlocks?: AiInterpretBlock[]
  sender: WebContents
  signal: AbortSignal
}): Promise<void> {
  const { turnId, messages, mentionBlocks, sender, signal } = args
  const sendChunk = (
    delta: string,
    done: boolean,
    error?: string,
    errorCode?: AiErrorCode,
    notice?: AiStreamNotice
  ): void => {
    if (!sender.isDestroyed()) {
      sender.send(IPC.AI_STREAM_CHUNK, {
        turnId,
        delta,
        done,
        ...(error ? { error } : {}),
        ...(errorCode ? { errorCode } : {}),
        ...(notice ? { notice } : {})
      })
    }
  }
  // Round'un tool trafiği Renderer'a gider ve asistan mesajına eklenir —
  // sonraki ai:send geçmişinde geri gelir (API durumsuz; bkz. AiTurnTraceSchema).
  const sendTrace = (traceMessages: ChatMessage[]): void => {
    if (!sender.isDestroyed()) {
      sender.send(IPC.AI_TURN_TRACE, { turnId, messages: traceMessages })
    }
  }
  const sendToolEvent = (
    tool: string,
    status: 'running' | 'done' | 'error',
    label: string
  ): void => {
    if (!sender.isDestroyed()) {
      sender.send(IPC.AI_TOOL_EVENT, { turnId, tool, status, label })
    }
  }
  try {
    const config = await requireProviderConfig()
    const language = getSettings().appearance.language
    // Sistem mesajı yok: sunucu onu `saiPrompt` bağlamından kurup başa ekler.
    // Bağlam tur başında bir kez alınır (o anki veri seti/filtre durumu).
    const saiPrompt = agentPrompt(language, mentionBlocks)
    const conversation: ChatMessage[] = [
      ...elideStaleToolResults(trimHistory(messages, MAX_HISTORY_MESSAGES))
    ]
    const tools = buildToolDefinitions()
    // Boş-cevap kurtarma dürtmesi en fazla bir kez denenir (sonsuz döngü
    // koruması + maliyet) — yalnız bu turda gerçekten bir tool çalıştıysa
    // (aksi halde sıradan boş yanıt, tool-sonrası "sessizlik" değil).
    let sawToolCall = false
    let nudged = false
    // Akan metin doğrudan Renderer'a gider; tur sonunda İKİNCİ kez
    // gönderilmemeli (renderer delta'ları kümülatif birleştirir). Sayaç
    // response.content'ten beslenir: onDelta tam olarak o metin için çağrılır
    // (akış yolunda parça parça, JSON yolunda tek seferde).
    let streamedChars = 0

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await chatCompletionRound(config, conversation, {
        tools,
        saiPrompt,
        signal,
        onDelta: delta => {
          sendChunk(delta, false)
        },
        onRetryWait: waiting => {
          sendToolEvent('rate_limit_wait', waiting ? 'running' : 'done', 'ai.tool.rateLimitWait')
        }
      })
      streamedChars += response.content.length

      if (response.toolCalls.length === 0) {
        if (response.content.trim() === '' && sawToolCall && !nudged) {
          // Model tool sonucunu aldı ama yorum yazmadı (bazı ücretsiz/küçük
          // modellerde görülüyor, 2026-07-28 kullanıcı geri bildirimi) — bir
          // kez "özetle" dürtmesiyle tekrar dene.
          nudged = true
          conversation.push({ role: 'assistant', content: response.content, toolCalls: [] })
          conversation.push({ role: 'user', content: SUMMARY_NUDGE })
          continue
        }
        // Metin akış sırasında zaten gönderildi. Tur boyunca HİÇ metin
        // akmadıysa (sağlayıcı stream'i yok saydı ve içerik boş, ya da
        // dürtmeden sonra da sessiz kaldı) uydurma yapmadan sabit bir not
        // gösterilir — sonuç zaten Output'a düştü, sessiz kalmak yanlış.
        if (streamedChars === 0) sendChunk(emptyResponseFallback(language), false)
        // §6.5: yalnız metadata — içerik/prompt asla loglanmaz.
        log.info(
          `[ai-bridge] turn ${turnId} completed after ${String(round)} tool rounds (${String(streamedChars)} chars streamed)`
        )
        sendChunk('', true)
        return
      }

      sawToolCall = true
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls
      }
      conversation.push(assistantMessage)
      const roundMessages: ChatMessage[] = [{ ...assistantMessage, content: '' }]

      for (const call of response.toolCalls) {
        const label = toolLabelKey(call)
        sendToolEvent(call.name, 'running', label)
        const result = await executeToolCall(call, sender, signal, turnId)
        const isError = typeof result === 'object' && result !== null && 'error' in result
        sendToolEvent(call.name, isError ? 'error' : 'done', label)
        const toolMessage: ChatMessage = {
          role: 'tool',
          content: JSON.stringify(result),
          toolCallId: call.id
        }
        conversation.push(toolMessage)
        roundMessages.push(toolMessage)
      }
      // Yalnız TAMAMLANMIŞ round gönderilir: her tool_call'ın sonucu hazır —
      // yarım round geçmişe girerse sağlayıcı eşleşmeyen tool_call'ı reddeder.
      // Metin zaten akışla asistan mesajına yazıldı; iz içinde tekrarlanmaz.
      sendTrace(roundMessages)
    }

    // Tur limiti aşıldı — model hâlâ tool çağırıyor (§3.1 sonsuz döngü
    // koruması). Hata yerine araçsız bir özet round'u: yapılan iş kaybolmaz,
    // kullanıcı "devam et" ile sürdürebilir. Bu round'da gelen tool_call'lar
    // (tool_choice'u yok sayan sağlayıcılar) çalıştırılmaz.
    log.warn(`[ai-bridge] turn ${turnId} hit the tool round limit (${String(MAX_TOOL_ROUNDS)})`)
    if (streamedChars > 0) sendChunk('\n\n', false)
    conversation.push({ role: 'user', content: ROUND_LIMIT_NUDGE })
    const wrapUp = await chatCompletionRound(config, conversation, {
      tools,
      saiPrompt,
      toolChoice: 'none',
      signal,
      onDelta: delta => {
        sendChunk(delta, false)
      },
      onRetryWait: waiting => {
        sendToolEvent('rate_limit_wait', waiting ? 'running' : 'done', 'ai.tool.rateLimitWait')
      }
    })
    streamedChars += wrapUp.content.length
    sendChunk('', true, undefined, undefined, 'tool-round-limit')
  } catch (err) {
    if (signal.aborted) {
      sendChunk('', true, 'cancelled')
      return
    }
    log.warn(`[ai-bridge] turn ${turnId} failed:`, err)
    const { message, code } = toAiError(err)
    sendChunk('', true, message, code)
  }
}
