// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * app-config.ts — GET /app/config (server/src/routes/config.ts) üzerinden
 * sunucudan yönetilen canlı uygulama konfigürasyonu: server provider'ın
 * varsayılan modeli.
 *
 * 60 sn bellek-içi cache (ai:models ile aynı desen). Ağ/sunucu hatasında ya
 * da şema uyuşmazlığında null döner — çağıran taraf shared/ai-types.ts'teki
 * gömülü fallback sabite (AI_SERVER_DEFAULT_MODEL) düşer; böylece eski client'lar ve çevrimdışı açılışlar çalışmaya devam eder.
 */

import {
  AI_SERVER_BASE_URL,
  AiAppConfigSchema,
  AiServerModelCatalogSchema
} from '../../../shared/ai-types'
import type { AiAppConfig, AiServerModel } from '../../../shared/ai-types'

const MODELS_CACHE_TTL_MS = 60_000
let modelsCache: { models: AiServerModel[]; at: number } | null = null

/**
 * Canlı model kataloğu (GET /v1/models, public). 60 sn cache; ağ/şema hatasında
 * boş dizi — çağıran "katalog bilinmiyor" diye yorumlar.
 */
export async function fetchModelCatalog(): Promise<AiServerModel[]> {
  const now = Date.now()
  if (modelsCache && now - modelsCache.at < MODELS_CACHE_TTL_MS) return modelsCache.models
  try {
    const res = await fetch(`${AI_SERVER_BASE_URL}/v1/models`, {
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return []
    const json = (await res.json()) as { models?: unknown }
    const parsed = AiServerModelCatalogSchema.safeParse(json.models)
    if (!parsed.success) return []
    modelsCache = { models: parsed.data, at: now }
    return parsed.data
  } catch {
    return []
  }
}

const APP_CONFIG_CACHE_TTL_MS = 60_000
let appConfigCache: { config: AiAppConfig; at: number } | null = null

export async function fetchAppConfig(): Promise<AiAppConfig | null> {
  const now = Date.now()
  if (appConfigCache && now - appConfigCache.at < APP_CONFIG_CACHE_TTL_MS) {
    return appConfigCache.config
  }
  try {
    const res = await fetch(`${AI_SERVER_BASE_URL}/app/config`, {
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return null
    const parsed = AiAppConfigSchema.safeParse(await res.json())
    if (!parsed.success) return null
    appConfigCache = { config: parsed.data, at: now }
    return parsed.data
  } catch {
    return null
  }
}
