// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ai-block-actions.ts — Output bloğu "✦ AI" menüsünün aksiyon mantığı
 * (ai-entegrasyon-fizibilitesi.md §5.4 E/F/G).
 *
 * Üç eylem:
 *  - Yorumla     → ai:interpret → sonuç bloğa aiNote olarak işlenir (kalıcı).
 *  - Soru sor…   → ai:interpret({ block, question }) → yanıt popover'da.
 *  - Sohbette Aç → AI paneli açılır + blok id'si chat-store.pendingMentions'a.
 *
 * Onay (consent): LLM çağıran eylemler settings.ai.consentGiven olmadan
 * çalışmaz; onay yoksa chat-store.ensureConsent() diyaloğu açar (F1'in
 * sahiplendiği akış — buradan yalnızca çağrılır, READ-ONLY).
 *
 * §6.5: sohbet/prompt içeriği burada da loglanmaz.
 */

import type { AiInterpretBlock } from '@shared/ai-types'
import { useOutputStore, type OutputBlock } from '../../store/output-store'
import { useSettingsStore } from '../../store/settings-store'
import { useChatStore } from '../../store/chat-store'
import { useUIStore } from '../../store/ui-store'

/** OutputBlock → ai:interpret payload'ı (§5.4: id/isCollapsed/aiNote gitmez,
 *  result AnalysisResultSchema'yı aynen yeniden kullanır). */
export function blockToAiPayload(block: OutputBlock): AiInterpretBlock {
  return {
    analysisId: block.analysisId,
    titleKey: block.titleKey,
    timestamp: block.timestamp,
    datasetName: block.datasetName,
    result: block.result
  }
}

/** AI panelini açar (ui-store F1'in kapsamı — yalnızca mevcut aksiyon çağrılır). */
function openAiPanel(): void {
  const { aiPanelOpen, toggleAiPanel } = useUIStore.getState()
  if (!aiPanelOpen) toggleAiPanel()
}

/** settings.ai.consentGiven false ise chat-store.ensureConsent() ile onay
 *  akışını tetikler. Onay diyaloğu AIPanel içinde render edildiği için önce
 *  panel açılır — yoksa kullanıcı diyaloğu göremez ve Promise asla çözülmez. */
export async function ensureAiConsent(): Promise<boolean> {
  if (useSettingsStore.getState().settings.ai.consentGiven) return true
  openAiPanel()
  return useChatStore.getState().ensureConsent()
}

/** ai:interpret çağrısı — onay yoksa null; IPC hatası çağırana fırlatılır. */
export async function requestBlockInterpretation(
  block: OutputBlock,
  question?: string
): Promise<string | null> {
  if (!(await ensureAiConsent())) return null
  const res = await window.api.ai.interpret({
    block: blockToAiPayload(block),
    ...(question ? { question } : {})
  })
  return res.text
}

/** "Yorumla" (§5.4 E): yorumu bloğa aiNote olarak işler. Onay reddedilirse
 *  null döner, bloğa dokunmaz. */
export async function interpretAndAttachNote(block: OutputBlock): Promise<string | null> {
  const text = await requestBlockInterpretation(block)
  if (text === null) return null
  useOutputStore.getState().setAiNote(block.id, { text, createdAt: new Date().toISOString() })
  return text
}

/** "Sohbette Aç" (§5.4 G): blok id'sini pendingMentions'a ekler + paneli açar.
 *  LLM çağırmadığı için onay gerektirmez (onay, sohbetten gönderim anında
 *  chat-store sendMessage tarafında zaten zorunlu tutuluyor). */
export function openBlockInChat(blockId: string): void {
  useChatStore.getState().addMention(blockId)
  openAiPanel()
}
