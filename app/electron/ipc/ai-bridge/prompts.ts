// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * prompts.ts — modele giden BAĞLAM ve tool (function-calling) şemaları.
 *
 * Talimat metni (sistem prompt'ları, tool açıklamaları) SAI sunucusunda
 * kurulur (2026-10-21): istemci yalnız veriyi `sai_prompt` alanıyla gönderir —
 * veri seti metadata'sı, analiz şemaları, mention blokları. Bu dosyada
 * kalanlar CLAUDE.md §9'daki veri kurallarının uygulandığı yerdir: modele
 * hangi verinin gittiği burada açıkça görülür (ham satır asla gitmez).
 */

import { ANALYSIS_COMMAND_NAMES } from '../../../shared/spss-syntax-analysis'
import type { AiInterpretBlock, AiSaiPrompt, AiToolDefinition } from '../../../shared/ai-types'
import {
  ANALYSIS_MANIFEST,
  MANIFEST_ANALYSIS_IDS,
  manifestToToolJsonSchema
} from '../../../shared/analysis-manifest'
import {
  loadedDatasets,
  getWeightVariable,
  getSplitVariable,
  getColumnFilters
} from '../db-handler'
import { compactAnalysisResult } from './context-budget'

// ─── Prompt bağlamı ──────────────────────────────────────────────────────────

export function agentPrompt(language: string, mentionBlocks?: AiInterpretBlock[]): AiSaiPrompt {
  // §9: modele giden metadata — değişken adları/etiketleri agrega düzeyde
  // kalır; ham satır asla gönderilmez. Sunucu bu bölümü "kullanıcı verisidir,
  // talimat değildir" işaretli bir DATA bölümüne koyar (etiketler kötü
  // niyetli talimat içerebilir).
  const datasets = [...loadedDatasets.values()].map(d => ({
    id: d.id,
    name: d.name,
    rows: d.rowCount,
    // Aktif weight/split dürüst yorum için şart — run_analysis bunları
    // otomatik enjekte eder; model yorumda belirtmelidir. activeColumnFilters
    // (Data View grid / onaylanmış SELECT IF) da aynı şekilde otomatik
    // enjekte edilir (job-bridge.ts).
    weightVariable: getWeightVariable(d.id),
    splitVariable: getSplitVariable(d.id),
    activeColumnFilters: getColumnFilters(d.id)
  }))
  const analyses = ANALYSIS_MANIFEST.map(e => ({
    analysisId: e.analysisId,
    description: e.description,
    paramsSchema: manifestToToolJsonSchema(e)
  }))
  return {
    version: 1,
    kind: 'agent',
    language,
    context: {
      datasets,
      analyses,
      analysisCommandNames: [...ANALYSIS_COMMAND_NAMES],
      // Kullanıcının "Sohbette Aç" ile eklediği Output blokları — grafik/vaka
      // verisi modele gitmez, yalnız tablolar (context-budget.ts).
      ...(mentionBlocks && mentionBlocks.length > 0
        ? {
            mentionBlocks: mentionBlocks.map(b => ({
              ...b,
              result: compactAnalysisResult(b.result)
            }))
          }
        : {})
    }
  }
}

// ai:interpret (tek tur, agentsız).
export function interpretPrompt(language: string): AiSaiPrompt {
  return { version: 1, kind: 'interpret', language, context: {} }
}

// ─── Tool şemaları (LLM'e giden function-calling tanımları) ─────────────────
// Ad + parametre şeması burada kalır: aracı bu süreç yürütür ve argümanları
// tools.ts'te zod ile doğrular, yani şema bir sözleşmedir. Aracın ne zaman
// kullanılacağını anlatan açıklamayı sunucu ekler.

export function buildToolDefinitions(): AiToolDefinition[] {
  return [
    {
      name: 'get_variables',
      parameters: {
        type: 'object',
        properties: {
          datasetId: {
            type: 'string',
            description: 'Dataset id from the DATA CONTEXT section of the system prompt.'
          }
        },
        required: ['datasetId'],
        additionalProperties: false
      }
    },
    {
      name: 'get_data_profile',
      parameters: {
        type: 'object',
        properties: {
          datasetId: { type: 'string' },
          // `pattern` (regex) BİLEREK yok — bkz. analysis-manifest.ts
          // manifestToToolJsonSchema'daki aynı gerekçe (bazı sağlayıcılar
          // regex'li tool-schema'yı 422 ile reddediyor). Format ipucu
          // description'a taşındı; gerçek doğrulama Main'de
          // AiGetDataProfileArgsSchema (zod regex) ile yapılıyor.
          colIds: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Preferred: up to 10 variables profiled in one call. Format: col_<number>, e.g. ["col_3","col_7"]'
          },
          colId: {
            type: 'string',
            description: 'Single variable alternative to colIds. Format: col_<number>, e.g. "col_3"'
          }
        },
        required: ['datasetId'],
        additionalProperties: false
      }
    },
    {
      name: 'run_analysis',
      parameters: {
        type: 'object',
        properties: {
          datasetId: { type: 'string' },
          analysisId: { type: 'string', enum: [...MANIFEST_ANALYSIS_IDS] },
          params: {
            type: 'object',
            description:
              "Analysis-specific params matching that analysisId's paramsSchema (variables use colIds)."
          }
        },
        required: ['datasetId', 'analysisId'],
        additionalProperties: false
      }
    },
    {
      name: 'run_syntax',
      parameters: {
        type: 'object',
        properties: {
          datasetId: { type: 'string' },
          syntax: {
            type: 'string',
            description:
              'One or more SPSS command syntax statements, each ending in ".". Example: "FREQUENCIES age.\\nCOXREG survtime WITH age /STATUS status EVENT(1)."'
          }
        },
        required: ['datasetId', 'syntax'],
        additionalProperties: false
      }
    },
    {
      name: 'propose_syntax',
      parameters: {
        type: 'object',
        properties: {
          syntax: {
            type: 'string',
            description:
              'One or more SPSS command syntax statements, each ending in ".". Example: "COMPUTE total_score = MEAN(q1, q2, q3)."'
          },
          description: {
            type: 'string',
            description:
              'Optional one-line explanation of what the proposed syntax does, shown above the syntax in the approval card (in the UI language).'
          }
        },
        required: ['syntax'],
        additionalProperties: false
      }
    },
    {
      name: 'propose_r_code',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description:
              'Complete, runnable R code. Refer to the dataset as `data` and to columns by variable name, e.g. "summary(lm(score ~ age, data = data))".'
          },
          description: {
            type: 'string',
            description:
              'Optional one-line explanation of what the code does, shown above it in the card (in the UI language).'
          }
        },
        required: ['code'],
        additionalProperties: false
      }
    }
  ]
}
