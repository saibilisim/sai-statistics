// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  AiStreamChunk,
  AiToolEvent,
  AiSyntaxProposal,
  AiTurnTrace,
  ChatMessage
} from '@shared/ai-types'
import { useChatStore, initChatListeners } from '@/store/chat-store'
import { useOutputStore, type OutputBlock } from '@/store/output-store'
import { useSettingsStore } from '@/store/settings-store'
import { useTerminalStore } from '@/store/terminal-store'
import { useUIStore } from '@/store/ui-store'
import { SettingsSchema } from '@shared/settings-types'

// acceptSyntaxProposal'ın tek dış bağımlılığı — gerçek parser/IPC yerine sahte.
vi.mock('@/lib/spss-syntax', () => ({
  runSpssSyntax: vi.fn()
}))
import { runSpssSyntax } from '@/lib/spss-syntax'
const runSpssSyntaxMock = vi.mocked(runSpssSyntax)

// ─── window.api mock ─────────────────────────────────────────────────────────
// Node ortamında window yok; store yalnız preload sözleşmesini bilir.

let chunkCb: (chunk: AiStreamChunk) => void = () => {}
let toolCb: (event: AiToolEvent) => void = () => {}
let proposalCb: (proposal: AiSyntaxProposal) => void = () => {}
let traceCb: (trace: AiTurnTrace) => void = () => {}

const aiSendMock =
  vi.fn<(req: { messages: unknown[]; mentionBlocks?: unknown[] }) => Promise<{ turnId: string }>>()
const aiCancelMock = vi.fn<(req: { turnId: string }) => Promise<void>>()
const settingsSetMock = vi.fn<() => Promise<void>>()

function installWindowMock(): void {
  ;(globalThis as Record<string, unknown>).window = {
    api: {
      ai: {
        send: aiSendMock,
        cancel: aiCancelMock,
        interpret: vi.fn(),
        getSetup: vi.fn()
      },
      on: {
        aiStreamChunk: (cb: (chunk: AiStreamChunk) => void) => {
          chunkCb = cb
          return () => {}
        },
        aiToolEvent: (cb: (event: AiToolEvent) => void) => {
          toolCb = cb
          return () => {}
        },
        aiSyntaxProposal: (cb: (proposal: AiSyntaxProposal) => void) => {
          proposalCb = cb
          return () => {}
        },
        aiTurnTrace: (cb: (trace: AiTurnTrace) => void) => {
          traceCb = cb
          return () => {}
        }
      },
      settings: { set: settingsSetMock }
    }
  }
}

let removeListeners: (() => void) | null = null

function resetStores(consentGiven: boolean): void {
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    activeTurnId: null,
    streamingMessageId: null,
    pendingMentions: [],
    consentDialogOpen: false
  })
  const settings = SettingsSchema.parse({})
  settings.ai.consentGiven = consentGiven
  useSettingsStore.setState({ settings, isLoaded: true })
  useOutputStore.setState({ blocks: [], selectedBlockId: null, dirty: false })
}

function makeBlock(id: string): OutputBlock {
  return {
    id,
    analysisId: 'descriptives',
    titleKey: 'output.descriptives.title',
    timestamp: '2026-07-27T00:00:00.000Z',
    datasetName: 'Test Veri',
    result: {
      success: true,
      tables: [
        {
          titleKey: 'output.descriptives.title',
          columns: ['output.col.variable', 'output.col.n'],
          rows: [['yas', 3]]
        }
      ],
      plots: [],
      warnings: [],
      notes: []
    },
    isCollapsed: false,
    aiNote: { text: 'gizli not', createdAt: '2026-07-27T00:00:00.000Z' }
  }
}

async function sendWithConsent(text = 'merhaba'): Promise<void> {
  await useChatStore.getState().sendMessage(text)
}

describe('chat-store', () => {
  beforeEach(() => {
    aiSendMock.mockReset()
    aiCancelMock.mockReset()
    settingsSetMock.mockReset()
    runSpssSyntaxMock.mockReset()
    aiSendMock.mockResolvedValue({ turnId: 'turn-1' })
    aiCancelMock.mockResolvedValue(undefined)
    installWindowMock()
    removeListeners = initChatListeners()
  })

  afterEach(() => {
    removeListeners?.()
    removeListeners = null
  })

  describe('consent gating (spec §4/§6)', () => {
    it('onay verilmemişse diyalog açar ve göndermez; reddedilince gönderim olmaz', async () => {
      resetStores(false)
      const promise = useChatStore.getState().sendMessage('test sorusu')
      // ensureConsent diyalogu açmalı, ai:send henüz çağrılmamalı
      expect(useChatStore.getState().consentDialogOpen).toBe(true)
      expect(aiSendMock).not.toHaveBeenCalled()

      useChatStore.getState().declineConsent()
      await promise
      expect(useChatStore.getState().consentDialogOpen).toBe(false)
      expect(aiSendMock).not.toHaveBeenCalled()
      expect(useChatStore.getState().messages).toHaveLength(0)
    })

    it('kabul edilince consentGiven kalıcılaşır ve gönderim devam eder', async () => {
      resetStores(false)
      const promise = useChatStore.getState().sendMessage('test sorusu')
      expect(useChatStore.getState().consentDialogOpen).toBe(true)

      useChatStore.getState().acceptConsent()
      await promise

      expect(useSettingsStore.getState().settings.ai.consentGiven).toBe(true)
      expect(settingsSetMock).toHaveBeenCalledWith({ path: 'ai.consentGiven', value: true })
      expect(aiSendMock).toHaveBeenCalledTimes(1)
      expect(useChatStore.getState().messages).toHaveLength(2) // user + pending assistant
    })

    it('onay zaten verilmişse diyalogsuz gönderir (ensureConsent anında true)', async () => {
      resetStores(true)
      const granted = await useChatStore.getState().ensureConsent()
      expect(granted).toBe(true)
      expect(useChatStore.getState().consentDialogOpen).toBe(false)

      await sendWithConsent()
      expect(aiSendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('streaming accumulation', () => {
    beforeEach(() => {
      resetStores(true)
    })

    it('delta parçalarını pending assistant mesajında biriktirir, done ile bitirir', async () => {
      await sendWithConsent('yaş için descriptives')
      expect(useChatStore.getState().isStreaming).toBe(true)
      expect(aiSendMock).toHaveBeenCalledTimes(1)
      // Geçmiş, user mesajını içerir
      const sentMessages = aiSendMock.mock.calls[0]?.[0].messages as { role: string }[]
      expect(sentMessages[sentMessages.length - 1]?.role).toBe('user')

      chunkCb({ turnId: 'turn-1', delta: 'Ortalama ', done: false })
      chunkCb({ turnId: 'turn-1', delta: '42.3', done: false })

      let state = useChatStore.getState()
      const assistant = state.messages[state.messages.length - 1]
      expect(assistant?.role).toBe('assistant')
      expect(assistant?.content).toBe('Ortalama 42.3')
      expect(state.isStreaming).toBe(true)

      chunkCb({ turnId: 'turn-1', delta: '', done: true })
      state = useChatStore.getState()
      expect(state.isStreaming).toBe(false)
      expect(state.activeTurnId).toBeNull()
      expect(state.streamingMessageId).toBeNull()
      expect(state.messages.at(-1)?.error).toBeUndefined()
    })

    it('hatayla kesilen turun tool izini sonraki ai:send geçmişine geri koyar', async () => {
      await sendWithConsent('yaşı analiz et')
      const trace: ChatMessage[] = [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'get_variables', arguments: '{"datasetId":"d1"}' }]
        },
        { role: 'tool', content: '{"variables":[]}', toolCallId: 'c1' }
      ]
      traceCb({ turnId: 'turn-1', messages: trace })
      traceCb({ turnId: 'baska-turn', messages: [{ role: 'tool', content: 'x', toolCallId: 'z' }] })
      chunkCb({
        turnId: 'turn-1',
        delta: '',
        done: true,
        error: 'HTTP 429',
        errorCode: 'rate-limit'
      })
      expect(useChatStore.getState().messages.at(-1)?.trace).toEqual(trace)

      aiSendMock.mockResolvedValue({ turnId: 'turn-2' })
      await useChatStore.getState().sendMessage('devam et')
      const sent = aiSendMock.mock.calls[1]?.[0].messages as ChatMessage[]
      // Kesilen turda metin yoktu → boş assistant mesajı gönderilmez.
      expect(sent).toEqual([
        { role: 'user', content: 'yaşı analiz et' },
        ...trace,
        { role: 'user', content: 'devam et' }
      ])
    })

    it('bilinmeyen/iptal edilmiş turnId parçalarını yok sayar', async () => {
      await sendWithConsent()
      chunkCb({ turnId: 'baska-turn', delta: 'sizinti', done: false })
      const assistant = useChatStore.getState().messages.at(-1)
      expect(assistant?.content).toBe('')
    })

    it('done chunk error taşıyorsa asistan mesajına ham hata+kod işlenir', async () => {
      await sendWithConsent()
      chunkCb({ turnId: 'turn-1', delta: '', done: true, error: 'provider unreachable' })
      const state = useChatStore.getState()
      expect(state.isStreaming).toBe(false)
      const assistant = state.messages.at(-1)
      expect(assistant?.error?.message).toBe('provider unreachable')
      expect(assistant?.error?.code).toBe('unknown')
    })

    it('tool event aktif assistant mesajına eklenir', async () => {
      await sendWithConsent()
      toolCb({ turnId: 'turn-1', tool: 'run_analysis', status: 'running', label: 'Çalışıyor' })
      const assistant = useChatStore.getState().messages.at(-1)
      expect(assistant?.toolEvents).toHaveLength(1)
      expect(assistant?.toolEvents[0]?.tool).toBe('run_analysis')
    })

    it('aynı tool tekrar çağrılınca kart yığılmaz ve listenin sonuna taşınır', async () => {
      await sendWithConsent()
      toolCb({ turnId: 'turn-1', tool: 'get_variables', status: 'running', label: 'L1' })
      toolCb({ turnId: 'turn-1', tool: 'get_variables', status: 'done', label: 'L1' })
      toolCb({ turnId: 'turn-1', tool: 'run_analysis', status: 'done', label: 'L2' })
      // Model ikinci turda tekrar get_variables çağırıyor: kart sayısı artmaz
      // ama EN GÜNCEL olay sonda olmalı — ChatMessageList son elemanı gösterir,
      // aksi halde panel bitmiş run_analysis kartında donuyordu.
      toolCb({ turnId: 'turn-1', tool: 'get_variables', status: 'running', label: 'L1' })

      const events = useChatStore.getState().messages.at(-1)?.toolEvents
      expect(events).toHaveLength(2)
      expect(events?.at(-1)?.tool).toBe('get_variables')
      expect(events?.at(-1)?.status).toBe('running')
    })

    it('ai:send reddedilirse asistan mesajı kalır, ham hata+kod içerir', async () => {
      aiSendMock.mockRejectedValue(new Error('provider off'))
      await sendWithConsent()
      const state = useChatStore.getState()
      expect(state.messages).toHaveLength(2) // user + hata taşıyan asistan
      expect(state.isStreaming).toBe(false)
      const assistant = state.messages.at(-1)
      expect(assistant?.role).toBe('assistant')
      expect(assistant?.error?.message).toBe('provider off')
      expect(assistant?.error?.code).toBe('unknown')
    })
  })

  describe('cancel', () => {
    beforeEach(() => {
      resetStores(true)
    })

    it('aktif turnId ile ai:cancel çağırır ve streaming durur', async () => {
      await sendWithConsent()
      useChatStore.getState().cancelStreaming()
      expect(aiCancelMock).toHaveBeenCalledWith({ turnId: 'turn-1' })
      expect(useChatStore.getState().isStreaming).toBe(false)

      // İptal sonrası gelen parçalar yok sayılır
      chunkCb({ turnId: 'turn-1', delta: 'gecikmiş', done: false })
      expect(useChatStore.getState().messages.at(-1)?.content).toBe('')
    })

    it('streaming yokken cancel no-op', () => {
      useChatStore.getState().cancelStreaming()
      expect(aiCancelMock).not.toHaveBeenCalled()
    })
  })

  describe('pendingMentions (spec §5.4)', () => {
    beforeEach(() => {
      resetStores(true)
    })

    it('add/remove/clear ve tekil tutma', () => {
      const s = useChatStore.getState()
      s.addMention('block-1')
      s.addMention('block-1') // tekrar eklenemez
      s.addMention('block-2')
      expect(useChatStore.getState().pendingMentions).toEqual(['block-1', 'block-2'])

      useChatStore.getState().removeMention('block-1')
      expect(useChatStore.getState().pendingMentions).toEqual(['block-2'])

      useChatStore.getState().clearMentions()
      expect(useChatStore.getState().pendingMentions).toEqual([])
    })

    it('gönderimde mentionlar user mesajına işlenir ve liste temizlenir', async () => {
      useChatStore.getState().addMention('block-9')
      await sendWithConsent()
      const state = useChatStore.getState()
      expect(state.pendingMentions).toEqual([])
      expect(state.messages[0]?.mentions).toEqual(['block-9'])
    })

    it('gönderimde mention blokları output-store üzerinden ai:send payloadına çözümlenir (§5.4)', async () => {
      useOutputStore.setState({ blocks: [makeBlock('block-1'), makeBlock('block-2')] })
      useChatStore.getState().addMention('block-2')
      useChatStore.getState().addMention('block-1')
      await sendWithConsent('bu iki tabloyu karşılaştır')

      const req = aiSendMock.mock.calls[0]?.[0]
      expect(req?.mentionBlocks).toHaveLength(2)
      // blockToAiPayload ile aynı şekil: id/isCollapsed/aiNote payload'a GİRMEZ
      expect(req?.mentionBlocks?.[0]).toEqual({
        analysisId: 'descriptives',
        titleKey: 'output.descriptives.title',
        timestamp: '2026-07-27T00:00:00.000Z',
        datasetName: 'Test Veri',
        result: expect.objectContaining({ success: true }),
        labels: expect.objectContaining({ 'output.descriptives.title': 'Descriptive Statistics' })
      })
      expect(req?.mentionBlocks?.[0]).not.toHaveProperty('id')
      expect(req?.mentionBlocks?.[0]).not.toHaveProperty('aiNote')
      // Mention sırası korunur (block-2 önce eklendi)
      expect((req?.mentionBlocks?.[0] as { titleKey: string }).titleKey).toBe(
        'output.descriptives.title'
      )
    })

    it("output-store'da artık bulunmayan mention id'leri sessizce atlanır", async () => {
      useOutputStore.setState({ blocks: [makeBlock('block-1')] })
      useChatStore.getState().addMention('block-1')
      useChatStore.getState().addMention('silinmis-blok')
      await sendWithConsent()

      const req = aiSendMock.mock.calls[0]?.[0]
      expect(req?.mentionBlocks).toHaveLength(1)
      // User mesajında mention id'leri yine de görünür (UI rozetleri için)
      expect(useChatStore.getState().messages[0]?.mentions).toEqual(['block-1', 'silinmis-blok'])
    })

    it('hiçbir mention çözülemezse mentionBlocks alanı gönderilmez', async () => {
      useChatStore.getState().addMention('yok-boyle-blok')
      await sendWithConsent()
      const req = aiSendMock.mock.calls[0]?.[0]
      expect(req && 'mentionBlocks' in req).toBe(false)
    })
  })

  describe('sendMessage korumaları', () => {
    beforeEach(() => {
      resetStores(true)
    })

    it('boş mesaj gönderilmez', async () => {
      await useChatStore.getState().sendMessage('   ')
      expect(aiSendMock).not.toHaveBeenCalled()
    })

    it('streaming sırasında ikinci gönderim engellenir', async () => {
      await sendWithConsent('ilk')
      await sendWithConsent('ikinci')
      expect(aiSendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('syntax proposals (propose_syntax)', () => {
    beforeEach(() => {
      resetStores(true)
    })

    const emitProposal = (): void => {
      proposalCb({
        turnId: 'turn-1',
        proposalId: 'prop-1',
        syntax: 'COMPUTE toplam = a + b.',
        description: 'Toplam değişkeni'
      })
    }

    it('onay önerisi aktif asistan mesajına pending olarak eklenir', async () => {
      await sendWithConsent()
      emitProposal()
      const assistant = useChatStore.getState().messages.at(-1)
      expect(assistant?.syntaxProposals).toHaveLength(1)
      expect(assistant?.syntaxProposals?.[0]).toMatchObject({
        id: 'prop-1',
        syntax: 'COMPUTE toplam = a + b.',
        description: 'Toplam değişkeni',
        status: 'pending'
      })
    })

    it('bilinmeyen turnId önerileri yok sayılır', async () => {
      await sendWithConsent()
      proposalCb({ turnId: 'baska-turn', proposalId: 'prop-x', syntax: 'COMPUTE x = 1.' })
      expect(useChatStore.getState().messages.at(-1)?.syntaxProposals).toBeUndefined()
    })

    it('reject kartı rejected işaretler, syntax çalıştırılmaz', async () => {
      await sendWithConsent()
      emitProposal()
      const messageId = useChatStore.getState().messages.at(-1)?.id ?? ''
      useChatStore.getState().rejectSyntaxProposal(messageId, 'prop-1')
      const proposal = useChatStore.getState().messages.at(-1)?.syntaxProposals?.[0]
      expect(proposal?.status).toBe('rejected')
      expect(runSpssSyntaxMock).not.toHaveBeenCalled()
    })

    it('accept başarılı çalıştırmada kartı accepted işaretler', async () => {
      runSpssSyntaxMock.mockResolvedValue([
        { level: 'success', key: 'terminal.log.computed', params: { name: 'toplam' } }
      ])
      await sendWithConsent()
      emitProposal()
      const messageId = useChatStore.getState().messages.at(-1)?.id ?? ''
      await useChatStore.getState().acceptSyntaxProposal(messageId, 'prop-1')
      expect(runSpssSyntaxMock).toHaveBeenCalledWith('COMPUTE toplam = a + b.')
      const proposal = useChatStore.getState().messages.at(-1)?.syntaxProposals?.[0]
      expect(proposal?.status).toBe('accepted')
      expect(proposal?.errors).toBeUndefined()
    })

    it('R kodu önerisi (propose_r_code) çalıştırılmaz, yalnız R betiğine gönderilir', async () => {
      useTerminalStore.setState({ rSource: '', mode: 'spss' })
      await sendWithConsent()
      proposalCb({
        turnId: 'turn-1',
        proposalId: 'prop-r',
        syntax: 'summary(data$age)',
        language: 'r'
      })
      const messageId = useChatStore.getState().messages.at(-1)?.id ?? ''
      expect(useChatStore.getState().messages.at(-1)?.syntaxProposals?.[0]?.language).toBe('r')
      await useChatStore.getState().acceptSyntaxProposal(messageId, 'prop-r')
      expect(runSpssSyntaxMock).not.toHaveBeenCalled()
      expect(useTerminalStore.getState().rSource).toBe('summary(data$age)')
      expect(useTerminalStore.getState().mode).toBe('r')
      expect(useUIStore.getState().activeTab).toBe('terminal')
      expect(useChatStore.getState().messages.at(-1)?.syntaxProposals?.[0]?.status).toBe('accepted')
      // A sent card can be sent again (it stays a usable record).
      await useChatStore.getState().acceptSyntaxProposal(messageId, 'prop-r')
      expect(useTerminalStore.getState().rSource).toBe('summary(data$age)\n\nsummary(data$age)')
    })

    it('accept çalıştırma hatasında pending kalır ve TÜM hata anahtarları işlenir', async () => {
      runSpssSyntaxMock.mockResolvedValue([
        { level: 'info', key: 'terminal.log.echo', params: { line: 'COMPUTE toplam = a + b.' } },
        { level: 'error', key: 'terminal.log.runFailed', params: { detail: 'boom' } },
        { level: 'error', key: 'terminal.log.unknownCommand', params: { command: 'FOO' } }
      ])
      await sendWithConsent()
      emitProposal()
      const messageId = useChatStore.getState().messages.at(-1)?.id ?? ''
      await useChatStore.getState().acceptSyntaxProposal(messageId, 'prop-1')
      const proposal = useChatStore.getState().messages.at(-1)?.syntaxProposals?.[0]
      expect(proposal?.status).toBe('pending')
      // Yalnız ilk hata değil, hepsi (kullanıcı neyi düzelteceğini görsün).
      expect(proposal?.errors).toEqual([
        { key: 'terminal.log.runFailed', params: { detail: 'boom' } },
        { key: 'terminal.log.unknownCommand', params: { command: 'FOO' } }
      ])
    })

    it('hiçbir şey uygulanmadıysa (yalnız yönlendirme/no-op) kart accepted olmaz', async () => {
      runSpssSyntaxMock.mockResolvedValue([
        { level: 'info', key: 'terminal.log.echo', params: { line: 'SELECT CASE a > 5.' } },
        { level: 'info', key: 'terminal.log.useFilter', params: { command: 'SELECT CASE' } }
      ])
      await sendWithConsent()
      emitProposal()
      const messageId = useChatStore.getState().messages.at(-1)?.id ?? ''
      await useChatStore.getState().acceptSyntaxProposal(messageId, 'prop-1')
      const proposal = useChatStore.getState().messages.at(-1)?.syntaxProposals?.[0]
      expect(proposal?.status).toBe('pending')
      // Echo satırı gösterilmez; yönlendirme satırı kullanıcıya iletilir.
      expect(proposal?.errors).toEqual([
        { key: 'terminal.log.useFilter', params: { command: 'SELECT CASE' } }
      ])
    })

    it('pending kart düzenlenebilir; çalıştırma düzenlenmiş syntax ile yapılır', async () => {
      runSpssSyntaxMock.mockResolvedValue([{ level: 'success', key: 'terminal.log.computed' }])
      await sendWithConsent()
      emitProposal()
      const messageId = useChatStore.getState().messages.at(-1)?.id ?? ''
      useChatStore.getState().updateSyntaxProposal(messageId, 'prop-1', 'COMPUTE toplam = a * b.')
      await useChatStore.getState().acceptSyntaxProposal(messageId, 'prop-1')
      expect(runSpssSyntaxMock).toHaveBeenCalledWith('COMPUTE toplam = a * b.')

      // Çalıştırılmış kart bir kayıttır — artık değiştirilemez.
      useChatStore.getState().updateSyntaxProposal(messageId, 'prop-1', 'COMPUTE x = 1.')
      expect(useChatStore.getState().messages.at(-1)?.syntaxProposals?.[0]?.syntax).toBe(
        'COMPUTE toplam = a * b.'
      )
    })

    it('accepted/rejected kart yeniden kabul edilemez', async () => {
      runSpssSyntaxMock.mockResolvedValue([{ level: 'success', key: 'terminal.log.computed' }])
      await sendWithConsent()
      emitProposal()
      const messageId = useChatStore.getState().messages.at(-1)?.id ?? ''
      await useChatStore.getState().acceptSyntaxProposal(messageId, 'prop-1')
      await useChatStore.getState().acceptSyntaxProposal(messageId, 'prop-1')
      expect(runSpssSyntaxMock).toHaveBeenCalledTimes(1)
    })
  })
})
