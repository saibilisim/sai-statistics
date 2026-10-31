// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * chat-store.ts — AI sohbet paneli state'i (Faz F1, ai-entegrasyon-fizibilitesi.md §5.1).
 *
 * Sohbet artık projeyle birlikte kalıcı (2026-09-26, kullanıcı isteği):
 * `.sdf` dosyasına `ai-chat.json` olarak yazılır/okunur (dataset-io.ts),
 * `toPersistedChat`/`loadPersistedChat` bu dönüşümü yapar — yalnız
 * id/role/content/createdAt (+ modele dönen tool izi `trace`) saklanır, tool kartları/syntax önerileri hâlâ
 * session-only (bkz. shared/ai-types.ts AiChatEntrySchema yorumu). LLM
 * trafiği yalnız Main'de akar (§3); bu store yalnız `window.api.ai`
 * sözleşmesini bilir. §6.5: sohbet içeriği sunucuya/loglara YAZILMAZ — bu
 * yalnız kullanıcının kendi `.sdf` dosyasına, kendi diskine kaydıdır.
 */

import { create } from 'zustand'
import type {
  ChatMessage,
  AiToolEvent,
  AiSyntaxProposal,
  AiTurnTrace,
  AiInterpretBlock,
  AiErrorCode,
  AiStreamNotice,
  PersistedAiChatEntry
} from '@shared/ai-types'
import { blockToAiPayload } from '../lib/ai-block-payload'
import { resolveAiErrorCode } from '../lib/ai-errors'
import { runSpssSyntax } from '../lib/spss-syntax'
import { useSettingsStore } from './settings-store'
import { useOutputStore } from './output-store'
import { useTerminalStore } from './terminal-store'
import { useUIStore } from './ui-store'

/**
 * propose_syntax onay kartının store'daki hâli (F2). Main syntax'ı asla
 * kendisi çalıştırmaz — kullanıcı ✓ derse acceptSyntaxProposal runSpssSyntax
 * (Terminal ile aynı hat) üzerinden yürütür.
 */
export interface AiSyntaxProposalEntry {
  id: string
  syntax: string
  description?: string
  /** 'r' = propose_r_code: "accept" only sends the code to the R script
   *  editor, it never runs it. Absent = SPSS syntax. */
  language?: 'r'
  status: 'pending' | 'accepted' | 'rejected'
  /**
   * Kabul sonrası çalıştırma hataları: i18n anahtarı + interpolasyon
   * değerleri (terminal.log.* — AiChatEntry.error ile aynı ilke: store ham
   * anahtarı taşır, görünür metni SyntaxProposalCard t() ile üretir). Durum
   * 'pending' kalır, kullanıcı syntax'ı düzeltip yeniden deneyebilir.
   *
   * TÜM hata satırları tutulur (eskiden yalnız ilki): çok ifadeli bir
   * öneride hangi satırların düştüğü görünmüyordu, kullanıcı hatayı
   * düzeltemiyordu (2026-08-14 geri bildirimi).
   */
  errors?: { key: string; params?: Record<string, unknown> }[]
}

/** Panelde gösterilen tek bir sohbet girdisi (user veya assistant). */
export interface AiChatEntry {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** Mesajın oluşturulma zamanı (epoch ms) — ChatMessageList footer'ında
   * saat olarak gösterilir. Sohbet session-only olduğu için tarih değil
   * yalnız saat gösterilir, ayrıca kalıcı depolama/i18n formatı gerekmez. */
  createdAt: number
  /** Streaming sırasında/sorasında gelen tool olayları (ToolCallCard, F2). */
  toolEvents: AiToolEvent[]
  /** Bu mesajla gönderilen Output blok referansları (mention, §5.4/F3). */
  mentions: string[]
  /** propose_syntax onay kartları (AiSyntaxProposalEntry, F2). */
  syntaxProposals?: AiSyntaxProposalEntry[]
  /**
   * Bu asistan mesajı bir hatayla sonuçlandıysa: ham mesaj + sınıfı. Chat
   * balonunda DOĞRUDAN görünür metin olarak render edilir (hover değil) —
   * yerelleştirme burada değil, ChatMessageList'te `t()` ile yapılır (store
   * i18n'e bağımlı olmamalı, bkz. lib/ai-errors.ts başlığı).
   */
  error?: { message: string; code: AiErrorCode }
  /**
   * Hata olmayan tur-sonu bilgisi (örn. adım sınırı — model yapılanı özetledi,
   * kullanıcı "devam et" ile sürdürebilir). Görünür metni ChatMessageList
   * t() ile üretir; oturumluk UI durumu, `.sdf`'e yazılmaz.
   */
  notice?: AiStreamNotice
  /**
   * Asistan turunun tool trafiği (ai:turn-trace): tool_call'lı assistant
   * mesajları + role:'tool' sonuçları. Ekranda gösterilmez; toHistory ile
   * sonraki ai:send geçmişine geri konur. API durumsuz olduğundan bu olmadan
   * model önceki turda neyi çalıştırdığını bilmiyor, hata/iptal sonrası
   * "devam et" denince işi baştan yapıyordu (2026-09-29).
   */
  trace?: ChatMessage[]
}

interface ChatState {
  messages: AiChatEntry[]
  isStreaming: boolean
  /** Aktif agent turu — ai:cancel bununla çağrılır. */
  activeTurnId: string | null
  /** Stream delta'larının aktığı assistant mesajı. */
  streamingMessageId: string | null
  /** Mention bekleyen blok id'leri (spec §5.4 — F3 "Sohbette Aç" bunu doldurur). */
  pendingMentions: string[]
  /** İlk-aktivasyon onay diyaloğu (§4/§6) görünür mü. */
  consentDialogOpen: boolean
}

interface ChatActions {
  /**
   * Kullanıcı mesajı gönderir. Önce ensureConsent() — onay yoksa diyalog
   * açılır, reddedilirse hiçbir şey gönderilmez (§4: zorunlu ilk-aktivasyon).
   */
  sendMessage: (text: string) => Promise<void>
  /** Aktif turu iptal eder (ai:cancel). Kısmi yanıt korunur. */
  cancelStreaming: () => void
  /**
   * Onay kapısı — Output AI aksiyonları (yorumla/soru sor) gibi chat dışı
   * çağrıcılar da gönderimden ÖNCE bunu çağırmalı. Onay zaten verilmişse
   * anında true; değilse diyalog açar ve kullanıcının kararını bekler.
   */
  ensureConsent: () => Promise<boolean>
  acceptConsent: () => void
  declineConsent: () => void
  /** Tercihler ▸ AI'dan: onay diyaloğunu bekleyen bir istek olmadan açar. */
  openConsentReview: () => void
  /** Onayı geri çeker — sonraki AI isteği diyaloğu yeniden açar. */
  revokeConsent: () => void
  addMention: (blockId: string) => void
  removeMention: (blockId: string) => void
  clearMentions: () => void
  clearChat: () => void
  deleteMessage: (id: string) => void
  /**
   * Bir asistan yanıtını yeniden ürettirir (modern sohbet istemcilerindeki
   * "regenerate" düğmesi, 2026-08-25). Yalnız listenin SON mesajında
   * gösterilir (ChatMessageList) — ara bir mesajı yeniden üretmek sonrasını
   * geçersiz kılar, o karmaşıklık v1'de yok. Eski asistan mesajı silinir,
   * aynı geçmişle (ondan önceki kullanıcı mesajına kadar) yeni bir tur başlar.
   */
  regenerateMessage: (assistantId: string) => Promise<void>
  /**
   * Onay kartı ✓ — syntax'ı runSpssSyntax ile çalıştırır. Başarılıysa
   * 'accepted'; hata varsa 'pending' kalır + error anahtarı işlenir
   * (kullanıcı yeniden deneyebilir).
   */
  acceptSyntaxProposal: (messageId: string, proposalId: string) => Promise<void>
  /** Onay kartı ✗ — kartı 'rejected' olarak işaretler. */
  rejectSyntaxProposal: (messageId: string, proposalId: string) => void
  /**
   * Kart üzerinde düzenlenen syntax'ı saklar (yalnız 'pending' kartlarda).
   * Model hatalı bir öneri ürettiğinde kullanıcı düzeltip aynı kartla
   * çalıştırabilsin diye (2026-08-14 geri bildirimi: "değiştiremedim").
   */
  updateSyntaxProposal: (messageId: string, proposalId: string, syntax: string) => void
}

let msgSeq = 0
function nextId(prefix: string): string {
  msgSeq += 1
  return `${prefix}-${String(msgSeq)}`
}

// ensureConsent() diyalog açıkken dönen Promise'in resolver'ı (tek diyalog).
let consentResolver: ((granted: boolean) => void) | null = null

// AiSendRequestSchema.messages max(200) — aşılırsa Main bütün ai:send'i
// reddeder. Main zaten son 100 mesajı kullanıyor (agent-loop.ts); fazlası
// burada, bir kullanıcı mesajından başlayacak şekilde kırpılır.
const MAX_SENT_HISTORY = 180

/**
 * Store girdilerini modele giden ChatMessage geçmişine çevirir. Asistan
 * girdisinin tool izi (trace) metninden ÖNCE açılır — sağlayıcının gördüğü
 * sıra: user → assistant(tool_calls) → tool … → assistant(yanıt metni).
 */
function toHistory(messages: AiChatEntry[]): ChatMessage[] {
  const history: ChatMessage[] = []
  for (const m of messages) {
    if (m.role === 'assistant' && m.trace && m.trace.length > 0) {
      history.push(...m.trace)
      // Kesilen turda metin olmayabilir; boş assistant mesajı gönderilmez.
      if (m.content !== '') history.push({ role: 'assistant', content: m.content })
      continue
    }
    history.push({ role: m.role, content: m.content })
  }
  if (history.length <= MAX_SENT_HISTORY) return history
  const sliced = history.slice(-MAX_SENT_HISTORY)
  const firstUser = sliced.findIndex(m => m.role === 'user')
  return firstUser === -1 ? sliced : sliced.slice(firstUser)
}

/** `.sdf` kaydında `ai-chat.json`'a yazılacak alt küme (bkz. AiChatEntrySchema). */
export function toPersistedChat(messages: AiChatEntry[]): PersistedAiChatEntry[] {
  return messages.map(m => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
    ...(m.trace && m.trace.length > 0 ? { trace: m.trace } : {})
  }))
}

/**
 * `.sdf` açılırken kaydedilmiş sohbeti yükler — devam eden bir tur varsa
 * önce iptal edilir (file:open zaten ensureCanReplaceDataset ile bunu
 * engeller ama file:new/açılış sırası garanti değil, savunma amaçlı).
 */
export function loadPersistedChat(entries: PersistedAiChatEntry[]): void {
  useChatStore.getState().cancelStreaming()
  useChatStore.setState({
    messages: entries.map(e => ({ ...e, toolEvents: [], mentions: [] })),
    pendingMentions: []
  })
}

/**
 * Mention'lanan blok id'lerini ai:send payload'ına çözümler (§5.4). Blok
 * verisi Main'de yaşamadığı için AnalysisResult Renderer'dan gider.
 * Çözülemeyen id'ler (blok silinmiş olabilir) sessizce atlanır.
 */
function resolveMentionBlocks(blockIds: string[]): AiInterpretBlock[] {
  if (blockIds.length === 0) return []
  const blocks = useOutputStore.getState().blocks
  // AiSendRequestSchema.mentionBlocks max(5) ile aynı sınır — aşılırsa Main
  // bütün ai:send'i reddeder; fazlası burada kırpılır.
  return blockIds
    .slice(0, 5)
    .map(id => blocks.find(b => b.id === id))
    .filter(b => b !== undefined)
    .map(blockToAiPayload)
}

export const useChatStore = create<ChatState & ChatActions>()((set, get) => ({
  messages: [],
  isStreaming: false,
  activeTurnId: null,
  streamingMessageId: null,
  pendingMentions: [],
  consentDialogOpen: false,

  sendMessage: async text => {
    const trimmed = text.trim()
    if (trimmed === '' || get().isStreaming) return
    const granted = await get().ensureConsent()
    if (!granted) return

    const mentions = get().pendingMentions
    const userEntry: AiChatEntry = {
      id: nextId('user'),
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
      toolEvents: [],
      mentions
    }
    const assistantEntry: AiChatEntry = {
      id: nextId('assistant'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      toolEvents: [],
      mentions: []
    }
    const history = toHistory([...get().messages, userEntry])
    const mentionBlocks = resolveMentionBlocks(mentions)
    set(s => ({
      messages: [...s.messages, userEntry, assistantEntry],
      pendingMentions: [],
      isStreaming: true,
      streamingMessageId: assistantEntry.id
    }))

    await startTurn(history, mentionBlocks, assistantEntry.id)
  },

  regenerateMessage: async assistantId => {
    if (get().isStreaming) return
    const messages = get().messages
    const idx = messages.findIndex(m => m.id === assistantId)
    if (idx === -1 || messages[idx]?.role !== 'assistant') return
    // Bu mesajdan ÖNCEKİ geçmiş (kullanıcı mesajına kadar dahil) korunur;
    // eski asistan mesajı yeni boş bir mesajla değiştirilir.
    const kept = messages.slice(0, idx)
    const mentions = kept.length > 0 ? (kept[kept.length - 1]?.mentions ?? []) : []
    const assistantEntry: AiChatEntry = {
      id: nextId('assistant'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      toolEvents: [],
      mentions: []
    }
    const history = toHistory(kept)
    const mentionBlocks = resolveMentionBlocks(mentions)
    set({
      messages: [...kept, assistantEntry],
      isStreaming: true,
      streamingMessageId: assistantEntry.id
    })

    await startTurn(history, mentionBlocks, assistantEntry.id)
  },

  cancelStreaming: () => {
    const { activeTurnId } = get()
    if (activeTurnId) {
      void window.api.ai.cancel({ turnId: activeTurnId })
    }
    set({ isStreaming: false, activeTurnId: null, streamingMessageId: null })
  },

  ensureConsent: () => {
    if (useSettingsStore.getState().settings.ai.consentGiven) {
      return Promise.resolve(true)
    }
    // Diyalog zaten açıkken ikinci bir Promise zincirlemek yerine reddetme;
    // ilk çağrının diyalogu kullanıcıyı bekliyor.
    if (consentResolver) return Promise.resolve(false)
    set({ consentDialogOpen: true })
    return new Promise<boolean>(resolve => {
      consentResolver = resolve
    })
  },

  acceptConsent: () => {
    useSettingsStore.getState().setSetting('ai', { consentGiven: true })
    set({ consentDialogOpen: false })
    consentResolver?.(true)
    consentResolver = null
  },

  declineConsent: () => {
    set({ consentDialogOpen: false })
    consentResolver?.(false)
    consentResolver = null
  },

  openConsentReview: () => {
    set({ consentDialogOpen: true })
  },

  revokeConsent: () => {
    useSettingsStore.getState().setSetting('ai', { consentGiven: false })
    set({ consentDialogOpen: false })
    consentResolver?.(false)
    consentResolver = null
  },

  addMention: blockId => {
    set(s =>
      s.pendingMentions.includes(blockId) ? s : { pendingMentions: [...s.pendingMentions, blockId] }
    )
  },
  removeMention: blockId => {
    set(s => ({ pendingMentions: s.pendingMentions.filter(id => id !== blockId) }))
  },
  clearMentions: () => {
    set({ pendingMentions: [] })
  },

  clearChat: () => {
    get().cancelStreaming()
    set({ messages: [] })
  },
  deleteMessage: id => {
    set(s => ({ messages: s.messages.filter(m => m.id !== id) }))
  },

  acceptSyntaxProposal: async (messageId, proposalId) => {
    const message = get().messages.find(m => m.id === messageId)
    const proposal = message?.syntaxProposals?.find(p => p.id === proposalId)
    if (!proposal) return
    // R code: into the R script editor, never run (CLAUDE.md §9). Can be
    // sent again later (the card stays a usable record).
    if (proposal.language === 'r') {
      useTerminalStore.getState().appendRCode(proposal.syntax)
      useUIStore.getState().setActiveTab('terminal')
      set(s => ({
        messages: s.messages.map(m =>
          m.id === messageId
            ? {
                ...m,
                syntaxProposals: (m.syntaxProposals ?? []).map(p =>
                  p.id === proposalId ? { ...p, status: 'accepted' as const } : p
                )
              }
            : m
        )
      }))
      return
    }
    if (proposal.status !== 'pending') return

    const patchProposal = (patch: Partial<AiSyntaxProposalEntry>): void => {
      set(s => ({
        messages: s.messages.map(m =>
          m.id === messageId
            ? {
                ...m,
                syntaxProposals: (m.syntaxProposals ?? []).map(p =>
                  p.id === proposalId ? { ...p, ...patch } : p
                )
              }
            : m
        )
      }))
    }

    try {
      const log = await runSpssSyntax(proposal.syntax)
      const toEntry = (e: { key: string; params?: Record<string, unknown> }) => ({
        key: e.key,
        ...(e.params ? { params: e.params } : {})
      })
      const failures = log.filter(e => e.level === 'error')
      if (failures.length > 0) {
        patchProposal({ errors: failures.map(toEntry) })
      } else if (!log.some(e => e.level === 'success')) {
        // Hata yok ama başarı da yok: komut yalnızca bir yönlendirme
        // (IF → Transform ▸ Compute) ya da no-op (EXECUTE) olabilir. Kartı
        // "Çalıştırıldı" diye işaretlemek yanıltıcı olur — veri değişmedi;
        // log satırlarını göster, kart pending kalsın (2026-08-14).
        patchProposal({
          errors: log.filter(e => e.key !== 'terminal.log.echo').map(toEntry)
        })
      } else {
        patchProposal({ status: 'accepted', errors: undefined })
      }
    } catch (err) {
      patchProposal({
        errors: [{ key: 'terminal.log.runFailed', params: { detail: String(err) } }]
      })
    }
  },
  updateSyntaxProposal: (messageId, proposalId, syntax) => {
    set(s => ({
      messages: s.messages.map(m =>
        m.id === messageId
          ? {
              ...m,
              syntaxProposals: (m.syntaxProposals ?? []).map(p =>
                // Çalıştırılmış/reddedilmiş kart bir kayıttır, değiştirilmez.
                p.id === proposalId && p.status === 'pending' ? { ...p, syntax } : p
              )
            }
          : m
      )
    }))
  },
  rejectSyntaxProposal: (messageId, proposalId) => {
    set(s => ({
      messages: s.messages.map(m =>
        m.id === messageId
          ? {
              ...m,
              syntaxProposals: (m.syntaxProposals ?? []).map(p =>
                p.id === proposalId ? { ...p, status: 'rejected' as const } : p
              )
            }
          : m
      )
    }))
  }
}))

/**
 * sendMessage/regenerateMessage'ın ortak kuyruğa-koyma adımı: ai:send çağırır,
 * turnId'yi saklar; reddedilirse (provider kapalı, şema hatası vb.) hatayı
 * balonu düşürmeden ham metin+kod olarak assistantId'li mesaja işler —
 * görünür yerelleştirilmiş metni ChatMessageList render eder.
 */
async function startTurn(
  history: ChatMessage[],
  mentionBlocks: AiInterpretBlock[],
  assistantId: string
): Promise<void> {
  try {
    const { turnId } = await window.api.ai.send({
      messages: history,
      ...(mentionBlocks.length > 0 ? { mentionBlocks } : {})
    })
    useChatStore.setState({ activeTurnId: turnId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code = resolveAiErrorCode(undefined, message) ?? 'unknown'
    useChatStore.setState(s => ({
      messages: s.messages.map(m =>
        m.id === assistantId ? { ...m, error: { message, code } } : m
      ),
      isStreaming: false,
      streamingMessageId: null,
      activeTurnId: null
    }))
  }
}

// ─── Main → Renderer streaming aboneliği ────────────────────────────────────
// Modül-import yan etkisi yerine açık init: App.tsx bir kez çağırır; testler
// kendi mock window.api'siyle çağırabilir.

let unsubscribeListeners: (() => void) | null = null

export function initChatListeners(): () => void {
  if (unsubscribeListeners) return unsubscribeListeners

  const handleChunk = (chunk: {
    turnId: string
    delta: string
    done: boolean
    error?: string
    errorCode?: string
    notice?: AiStreamNotice
  }): void => {
    const { activeTurnId, streamingMessageId, isStreaming } = useChatStore.getState()
    // Bilinmeyen/iptal edilmiş tur parçaları yok sayılır (turnId namespacing, §10).
    if (!isStreaming || !activeTurnId || chunk.turnId !== activeTurnId) return

    if (chunk.delta !== '' && streamingMessageId) {
      useChatStore.setState(s => ({
        messages: s.messages.map(m =>
          m.id === streamingMessageId ? { ...m, content: m.content + chunk.delta } : m
        )
      }))
    }
    if (chunk.done) {
      if (chunk.notice && streamingMessageId) {
        const notice = chunk.notice
        useChatStore.setState(s => ({
          messages: s.messages.map(m => (m.id === streamingMessageId ? { ...m, notice } : m))
        }))
      }
      if (chunk.error && streamingMessageId) {
        // Ham mesaj + kod mesaja işlenir; görünür yerelleştirilmiş metni
        // ChatMessageList render eder (hover değil, doğrudan chat cevabı).
        const code = resolveAiErrorCode(chunk.errorCode, chunk.error) ?? 'unknown'
        useChatStore.setState(s => ({
          messages: s.messages.map(m =>
            m.id === streamingMessageId ? { ...m, error: { message: chunk.error ?? '', code } } : m
          )
        }))
      }
      useChatStore.setState({
        isStreaming: false,
        activeTurnId: null,
        streamingMessageId: null
      })
    }
  }

  const handleToolEvent = (event: AiToolEvent): void => {
    const { activeTurnId, streamingMessageId } = useChatStore.getState()
    if (!activeTurnId || event.turnId !== activeTurnId || !streamingMessageId) return
    useChatStore.setState(s => ({
      messages: s.messages.map(m => {
        if (m.id !== streamingMessageId) return m
        // Aynı tool'un tekrarları tek karta indirgenir: running→done/error
        // çifti ve agent döngüsündeki yinelemeli çağrılar listede yığılmaz,
        // kart yerinde güncellenir (durum ikonu son hali gösterir).
        const idx = m.toolEvents.findIndex(ev => ev.tool === event.tool)
        if (idx === -1) return { ...m, toolEvents: [...m.toolEvents, event] }
        // Güncellenen olay listenin SONUNA taşınır: ChatMessageList son
        // elemanı gösterir, dolayısıyla "son eleman = en güncel olay"
        // değişmezi korunmalı. Yerinde güncellemekle (eski davranış)
        // get_variables → run_analysis → get_variables sırasında kart
        // bitmiş run_analysis'te kalıyor, çalışan tool görünmüyordu.
        const toolEvents = m.toolEvents.filter((_, i) => i !== idx)
        toolEvents.push(event)
        return { ...m, toolEvents }
      })
    }))
  }

  const handleSyntaxProposal = (proposal: AiSyntaxProposal): void => {
    const { activeTurnId, streamingMessageId } = useChatStore.getState()
    // Tool olaylarıyla aynı korelasyon: aktif turun o an akan asistan mesajı.
    if (!activeTurnId || proposal.turnId !== activeTurnId || !streamingMessageId) return
    useChatStore.setState(s => ({
      messages: s.messages.map(m =>
        m.id === streamingMessageId
          ? {
              ...m,
              syntaxProposals: [
                ...(m.syntaxProposals ?? []),
                {
                  id: proposal.proposalId,
                  syntax: proposal.syntax,
                  ...(proposal.description ? { description: proposal.description } : {}),
                  ...(proposal.language === 'r' ? { language: 'r' as const } : {}),
                  status: 'pending' as const
                }
              ]
            }
          : m
      )
    }))
  }

  // Main izi her round tamamlanınca, done chunk'ından ÖNCE gönderir;
  // korelasyon tool olaylarıyla aynı (aktif tur + akan asistan mesajı).
  const handleTurnTrace = (trace: AiTurnTrace): void => {
    const { activeTurnId, streamingMessageId } = useChatStore.getState()
    if (!activeTurnId || trace.turnId !== activeTurnId || !streamingMessageId) return
    useChatStore.setState(s => ({
      messages: s.messages.map(m =>
        m.id === streamingMessageId ? { ...m, trace: [...(m.trace ?? []), ...trace.messages] } : m
      )
    }))
  }

  const offChunk = window.api.on.aiStreamChunk(handleChunk)
  const offTool = window.api.on.aiToolEvent(handleToolEvent)
  const offProposal = window.api.on.aiSyntaxProposal(handleSyntaxProposal)
  const offTrace = window.api.on.aiTurnTrace(handleTurnTrace)
  unsubscribeListeners = () => {
    offChunk()
    offTool()
    offProposal()
    offTrace()
    unsubscribeListeners = null
  }
  return unsubscribeListeners
}
