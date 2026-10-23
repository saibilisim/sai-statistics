// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * output-ai-note.test.ts — F3: OutputBlock.aiNote + "✦ AI" menü aksiyonları
 * (ai-entegrasyon-fizibilitesi.md §5.3/§5.4).
 *
 * Kapsam: setAiNote store aksiyonu, ai:interpret payload kurulumu, onay
 * (consent) kapısı (chat-store.ensureConsent), "Sohbette Aç" mention köprüsü,
 * aiNote'un HTML export'a varsayılan girmemesi (opt-in).
 * chat-store modülü mock'lanır (F1 ajanının dosyası — burada yalnızca
 * sözleşmesi test edilir); window.api.ai.interpret mock'lanır.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TFunction } from 'i18next'
import { useOutputStore, type OutputBlock } from '../../src/store/output-store'
import { useSettingsStore } from '../../src/store/settings-store'
import { useUIStore } from '../../src/store/ui-store'
import {
  blockToAiPayload,
  ensureAiConsent,
  interpretAndAttachNote,
  openBlockInChat,
  requestBlockInterpretation
} from '../../src/views/OutputView/ai-block-actions'
import { buildOutputHtml } from '../../src/lib/output-export'
import type { AnalysisResult } from '@shared/analysis-types'

// ─────────────────────────────────────────────────────────────
//  chat-store mock (F1 ajanının modülü — yalnız sözleşme)
// ─────────────────────────────────────────────────────────────

const { ensureConsentMock, addMentionMock } = vi.hoisted(() => ({
  ensureConsentMock: vi.fn<() => Promise<boolean>>(),
  addMentionMock: vi.fn<(blockId: string) => void>()
}))

vi.mock('../../src/store/chat-store', () => ({
  useChatStore: {
    getState: () => ({
      ensureConsent: ensureConsentMock,
      addMention: addMentionMock
    })
  }
}))

// ─────────────────────────────────────────────────────────────
//  Yardımcılar
// ─────────────────────────────────────────────────────────────

const interpretMock = vi.fn<(req: unknown) => Promise<{ text: string }>>()

function makeResult(): AnalysisResult {
  return {
    success: true,
    tables: [
      {
        titleKey: 'output.table.descriptives',
        columns: ['output.col.statistic', 'output.col.value'],
        rows: [['Mean', 42.5]],
        footnoteKey: null
      }
    ],
    plots: [],
    warnings: [],
    notes: []
  }
}

function makeBlock(id: string): Omit<OutputBlock, 'isCollapsed'> {
  return {
    id,
    analysisId: 'descriptives',
    titleKey: 'analysis.descriptives.title',
    timestamp: '2026-07-27T12:00:00.000Z',
    datasetName: 'demo.sdf',
    result: makeResult()
  }
}

function setConsent(given: boolean): void {
  useSettingsStore.setState(s => ({
    settings: { ...s.settings, ai: { ...s.settings.ai, consentGiven: given } }
  }))
}

// Kimlik t fonksiyonu — export HTML'i yalnız metin içeriğiyle ilgilenir.
const tIdentity = ((key: string) => key) as unknown as TFunction

beforeEach(() => {
  interpretMock.mockReset()
  ensureConsentMock.mockReset().mockResolvedValue(false)
  addMentionMock.mockReset()
  vi.stubGlobal('window', {
    api: {
      app: { setOutputDirty: vi.fn() },
      ai: { interpret: interpretMock }
    }
  })
  useOutputStore.setState({ blocks: [], selectedBlockId: null, dirty: false })
  useUIStore.setState({ aiPanelOpen: false })
  setConsent(false)
})

// ─────────────────────────────────────────────────────────────
//  setAiNote
// ─────────────────────────────────────────────────────────────

describe('output-store: setAiNote', () => {
  it('attaches the note to the target block only', () => {
    const store = useOutputStore.getState()
    store.addBlock(makeBlock('a'))
    store.addBlock(makeBlock('b'))

    const note = { text: 'Ortalama beklenenden yüksek.', createdAt: '2026-07-27T12:05:00.000Z' }
    useOutputStore.getState().setAiNote('a', note)

    const blocks = useOutputStore.getState().blocks
    expect(blocks.find(b => b.id === 'a')?.aiNote).toEqual(note)
    expect(blocks.find(b => b.id === 'b')?.aiNote).toBeUndefined()
  })

  it('is a no-op for an unknown block id', () => {
    useOutputStore.getState().addBlock(makeBlock('a'))
    const before = useOutputStore.getState().blocks

    useOutputStore.getState().setAiNote('missing', { text: 'x', createdAt: 'now' })

    expect(useOutputStore.getState().blocks).toEqual(before)
  })

  it('marks Output dirty (aiNote is saved inside the .sdf)', () => {
    useOutputStore.getState().addBlock(makeBlock('a'))
    useOutputStore.getState().markSaved()
    expect(useOutputStore.getState().dirty).toBe(false)

    useOutputStore.getState().setAiNote('a', { text: 'not', createdAt: 'now' })

    expect(useOutputStore.getState().dirty).toBe(true)
  })

  it('overwrites an existing note on re-interpretation', () => {
    useOutputStore.getState().addBlock(makeBlock('a'))
    useOutputStore.getState().setAiNote('a', { text: 'eski', createdAt: 't1' })
    useOutputStore.getState().setAiNote('a', { text: 'yeni', createdAt: 't2' })

    expect(useOutputStore.getState().blocks[0].aiNote).toEqual({ text: 'yeni', createdAt: 't2' })
  })
})

// ─────────────────────────────────────────────────────────────
//  ai-block-actions — payload + onay kapısı + mention köprüsü
// ─────────────────────────────────────────────────────────────

describe('ai-block-actions', () => {
  it('blockToAiPayload strips renderer-only fields (id/isCollapsed/aiNote)', () => {
    useOutputStore.getState().addBlock(makeBlock('a'))
    useOutputStore.getState().setAiNote('a', { text: 'not', createdAt: 'now' })
    const block = useOutputStore.getState().blocks[0]

    const payload = blockToAiPayload(block)

    expect(payload).toEqual({
      analysisId: 'descriptives',
      titleKey: 'analysis.descriptives.title',
      timestamp: '2026-07-27T12:00:00.000Z',
      datasetName: 'demo.sdf',
      result: makeResult()
    })
    expect('id' in payload).toBe(false)
    expect('isCollapsed' in payload).toBe(false)
    expect('aiNote' in payload).toBe(false)
  })

  it('without consent delegates to chat-store.ensureConsent and refuses on decline', async () => {
    setConsent(false)
    ensureConsentMock.mockResolvedValue(false)
    const block = { ...makeBlock('a'), isCollapsed: false }

    const text = await requestBlockInterpretation(block)

    expect(text).toBeNull()
    expect(ensureConsentMock).toHaveBeenCalledTimes(1)
    expect(interpretMock).not.toHaveBeenCalled()
  })

  it('proceeds when the consent dialog grants consent', async () => {
    setConsent(false)
    ensureConsentMock.mockResolvedValue(true)
    interpretMock.mockResolvedValue({ text: 'Onay sonrası yorum.' })
    const block = { ...makeBlock('a'), isCollapsed: false }

    const text = await requestBlockInterpretation(block)

    expect(text).toBe('Onay sonrası yorum.')
    expect(interpretMock).toHaveBeenCalledTimes(1)
  })

  it('ensureAiConsent short-circuits when settings.ai.consentGiven (no dialog)', async () => {
    setConsent(true)
    await expect(ensureAiConsent()).resolves.toBe(true)
    expect(ensureConsentMock).not.toHaveBeenCalled()
  })

  it('sends the block payload + question to ai:interpret when consent is given', async () => {
    setConsent(true)
    interpretMock.mockResolvedValue({ text: 'Yanıt metni.' })
    const block = { ...makeBlock('a'), isCollapsed: false }

    const text = await requestBlockInterpretation(block, 'p-değeri anlamlı mı?')

    expect(text).toBe('Yanıt metni.')
    expect(interpretMock).toHaveBeenCalledTimes(1)
    expect(interpretMock).toHaveBeenCalledWith({
      block: blockToAiPayload(block),
      question: 'p-değeri anlamlı mı?'
    })
  })

  it('omits the question key when no question is given', async () => {
    setConsent(true)
    interpretMock.mockResolvedValue({ text: 'Yorum.' })
    const block = { ...makeBlock('a'), isCollapsed: false }

    await requestBlockInterpretation(block)

    const req = interpretMock.mock.calls[0][0] as Record<string, unknown>
    expect('question' in req).toBe(false)
  })

  it('interpretAndAttachNote persists the interpretation onto the block', async () => {
    setConsent(true)
    interpretMock.mockResolvedValue({ text: 'Blok yorumu.' })
    useOutputStore.getState().addBlock(makeBlock('a'))
    const block = useOutputStore.getState().blocks[0]

    const text = await interpretAndAttachNote(block)

    expect(text).toBe('Blok yorumu.')
    const stored = useOutputStore.getState().blocks[0].aiNote
    expect(stored?.text).toBe('Blok yorumu.')
    expect(stored?.createdAt).toBeTruthy()
  })

  it('interpretAndAttachNote leaves the block untouched without consent', async () => {
    setConsent(false)
    ensureConsentMock.mockResolvedValue(false)
    useOutputStore.getState().addBlock(makeBlock('a'))
    const block = useOutputStore.getState().blocks[0]

    const text = await interpretAndAttachNote(block)

    expect(text).toBeNull()
    expect(useOutputStore.getState().blocks[0].aiNote).toBeUndefined()
    expect(interpretMock).not.toHaveBeenCalled()
  })

  it('openBlockInChat pushes the block id as a mention and opens the AI panel', () => {
    openBlockInChat('a')

    expect(addMentionMock).toHaveBeenCalledTimes(1)
    expect(addMentionMock).toHaveBeenCalledWith('a')
    expect(useUIStore.getState().aiPanelOpen).toBe(true)
  })

  it('openBlockInChat leaves an already-open panel open', () => {
    useUIStore.setState({ aiPanelOpen: true })

    openBlockInChat('a')

    expect(useUIStore.getState().aiPanelOpen).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
//  Export — aiNote varsayılan DIŞARDA (§5.3)
// ─────────────────────────────────────────────────────────────

describe('output-export: aiNote', () => {
  it('excludes aiNote from HTML export by default', async () => {
    const block: OutputBlock = {
      ...makeBlock('a'),
      isCollapsed: false,
      aiNote: { text: 'GİZLİ-AI-NOTU', createdAt: '2026-07-27T12:05:00.000Z' }
    }

    const html = await buildOutputHtml([block], tIdentity)

    expect(html).not.toContain('GİZLİ-AI-NOTU')
    expect(html).not.toContain('class="ai-note"')
  })

  it('includes aiNote with the AI-generated badge when explicitly opted in', async () => {
    const block: OutputBlock = {
      ...makeBlock('a'),
      isCollapsed: false,
      aiNote: { text: 'AÇIK-AI-NOTU', createdAt: '2026-07-27T12:05:00.000Z' }
    }

    const html = await buildOutputHtml([block], tIdentity, { includeAiNotes: true })

    expect(html).toContain('AÇIK-AI-NOTU')
    expect(html).toContain('ai.output.generatedBadge')
    expect(html).toContain('class="ai-note"')
  })

  it('escapes HTML in the opted-in aiNote text', async () => {
    const block: OutputBlock = {
      ...makeBlock('a'),
      isCollapsed: false,
      aiNote: { text: '<script>alert(1)</script>', createdAt: 'now' }
    }

    const html = await buildOutputHtml([block], tIdentity, { includeAiNotes: true })

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
