// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * context-budget.ts — modele giden bağlamın token bütçesi (2026-09-29).
 *
 * Chat-completions API'si durumsuzdur: agent turunun HER round-trip'inde
 * sistem prompt'u + tool şemaları + geçmiş + o ana kadarki tüm tool sonuçları
 * baştan gönderilir. Tek bir kullanıcı mesajı 6 round'a kadar gidebildiği
 * için büyük bir tool sonucu (Plotly JSON'lu AnalysisResult gibi) dakikalık
 * token limitini (TPM) birkaç round'da dolduruyordu (kullanıcı geri
 * bildirimi: "komut çalışırken dakikalık limiti doldurdun"). Buradaki üç
 * kırpma da modele giden KOPYAYA uygulanır — Output'a giden tam sonuç
 * (job:complete) etkilenmez:
 *
 *   1. compactAnalysisResult — tool sonucu/mention/interpret'te grafik
 *      verisi, vaka-düzeyi değerler ve model XML'i atılır, uzun tablolar ve
 *      sayı hassasiyeti kırpılır.
 *   2. elideStaleToolResults — önceki turların büyük tool sonuçları geçmişte
 *      kısa bir özetle değiştirilir (model o sonucu zaten yorumladı).
 *   3. trimHistory — geçmiş kırpılırken tool mesajı ait olduğu tool_call'dan
 *      koparılmaz (sağlayıcılar yetim tool mesajını 400 ile reddeder).
 */

import type { AnalysisResult } from '../../../shared/analysis-types'
import type { ChatMessage } from '../../../shared/ai-types'

/** Tablo başına modele giden azami satır — uzun frekans tabloları için. */
const MAX_TABLE_ROWS = 60
/** Sayılar bu kadar anlamlı basamağa yuvarlanır (p = 1.23457e-8 korunur). */
const SIGNIFICANT_DIGITS = 6
/** Bu boyutun altındaki eski tool sonuçları olduğu gibi bırakılır. */
const STALE_RESULT_KEEP_CHARS = 600

function roundNumber(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return value
  return Number(value.toPrecision(SIGNIFICANT_DIGITS))
}

/**
 * AnalysisResult'ın modele giden kısaltılmış hâli. Yorum için gereken her
 * şey (tablolar, warnings, notes) korunur; model zaten göremeyeceği grafik
 * verisini ve vaka-düzeyi değerleri (caseVars — §9 "ham satır gönderilmez"
 * kuralının da gereği) almaz, yalnız varlıklarından haberdar edilir.
 */
export function compactAnalysisResult(result: AnalysisResult): Record<string, unknown> {
  const tables = result.tables.map(table => {
    const rows = table.rows
      .slice(0, MAX_TABLE_ROWS)
      .map(row => row.map(cell => (typeof cell === 'number' ? roundNumber(cell) : cell)))
    return {
      titleKey: table.titleKey,
      columns: table.columns,
      rows,
      ...(table.footnoteKey ? { footnoteKey: table.footnoteKey } : {}),
      ...(table.rows.length > MAX_TABLE_ROWS
        ? {
            rowsOmitted: `${String(table.rows.length - MAX_TABLE_ROWS)} more rows are shown in the Output tab but not here; do not guess their values.`
          }
        : {})
    }
  })
  return {
    success: result.success,
    tables,
    ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    ...(result.notes.length > 0 ? { notes: result.notes } : {}),
    ...(result.plots.length > 0 ? { plotsShownInOutput: result.plots.map(p => p.titleKey) } : {}),
    ...(result.caseVars.length > 0
      ? { caseVariablesAvailable: result.caseVars.map(c => c.name) }
      : {})
  }
}

/** Geçmişteki assistant tool_call'larından toolCallId → tool adı eşlemesi. */
function toolNamesById(messages: ChatMessage[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const m of messages) {
    for (const tc of m.toolCalls ?? []) names.set(tc.id, tc.name)
  }
  return names
}

function staleSummary(toolName: string, content: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    parsed = undefined
  }
  const obj =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  const summary: Record<string, unknown> = {
    elided: `Result of ${toolName} from an earlier turn, removed from the history to save tokens.`
  }
  if (toolName === 'run_analysis') {
    summary['analysisId'] = obj['analysisId']
    summary['status'] = obj['status']
    summary['note'] =
      'The full tables are in the Output tab and were interpreted in your earlier reply. Quote numbers only from that reply; if the user needs numbers that are not there, run the analysis again.'
  } else if (toolName === 'run_syntax') {
    const results = Array.isArray(obj['results']) ? (obj['results'] as unknown[]) : []
    summary['analysesRun'] = results
      .map(r =>
        typeof r === 'object' && r !== null ? (r as Record<string, unknown>)['analysisId'] : null
      )
      .filter(Boolean)
    summary['note'] =
      'The full tables are in the Output tab and were interpreted in your earlier reply. Re-run only if the user needs numbers that are not in that reply.'
  } else {
    summary['note'] = `Call ${toolName} again if you need this information.`
  }
  return JSON.stringify(summary)
}

/**
 * Önceki turların büyük tool sonuçlarını kısa bir özetle değiştirir.
 * EN SON tool bloğu (son tool mesajından geriye, ondan önceki kullanıcı
 * mesajına kadar) tam kalır: hata/iptal ile kesilen bir turun ardından
 * "devam et" dendiğinde modelin elinde yarım kalan işin sonuçları olmalı.
 */
export function elideStaleToolResults(messages: ChatMessage[]): ChatMessage[] {
  let lastTool = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'tool') {
      lastTool = i
      break
    }
  }
  if (lastTool === -1) return messages
  let blockStart = 0
  for (let i = lastTool; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      blockStart = i
      break
    }
  }
  const names = toolNamesById(messages)
  return messages.map((m, i) => {
    if (m.role !== 'tool' || i >= blockStart || m.content.length <= STALE_RESULT_KEEP_CHARS) {
      return m
    }
    const toolName = (m.toolCallId ? names.get(m.toolCallId) : undefined) ?? 'tool'
    return { ...m, content: staleSummary(toolName, m.content) }
  })
}

/**
 * Son `max` mesajı tutar; kesim noktası bir kullanıcı mesajına kaydırılır
 * ki geçmiş bir tool mesajıyla ya da tool_call'lı bir assistant mesajının
 * ortasından başlamasın.
 */
export function trimHistory(messages: ChatMessage[], max: number): ChatMessage[] {
  if (messages.length <= max) return messages
  const sliced = messages.slice(-max)
  const firstUser = sliced.findIndex(m => m.role === 'user')
  if (firstUser !== -1) return sliced.slice(firstUser)
  // Son `max` mesajın tamamı tek bir turun tool trafiği: o turun kullanıcı
  // mesajından başla (limit biraz aşılır ama geçmiş geçerli kalır).
  const lastUser = messages.findLastIndex(m => m.role === 'user')
  return lastUser === -1 ? sliced : messages.slice(lastUser)
}
