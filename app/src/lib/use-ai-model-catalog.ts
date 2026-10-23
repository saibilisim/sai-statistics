// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'
import type { AiServerModel } from '@shared/ai-types'

export type AiModelCatalogState =
  | { status: 'idle' | 'loading'; models: [] }
  | { status: 'ready'; models: AiServerModel[] }
  | { status: 'offline'; models: [] }

const IDLE: AiModelCatalogState = { status: 'idle', models: [] }

// Main süreç ai:models sonucunu 60 sn cache'ler (ai-bridge/index.ts
// MODELS_CACHE_TTL_MS) — burada da aynı aralıkla yeniden çekilir. PreferencesDialog
// her açılışta yeniden mount olduğu için zaten taze veri alıyordu; AIPanel ise
// uygulama boyunca tek sefer mount olan kalıcı bir panel olduğundan periyodik
// yeniden çekme olmadan yönetim panelinden (saistatistics/#/yonetim) girilen
// model değişiklikleri sohbet kutusundaki seçiciye hiç yansımıyordu (2026-09-05).
const MODEL_CATALOG_REFRESH_MS = 60_000

/**
 * 'server' sağlayıcının canlı model kataloğunu çeker (ai:models →
 * server/src/routes/models.ts GET /v1/models). `active` false iken hiç
 * istek atmaz (örn. provider !== 'server'). Sunucuya ulaşılamazsa
 * 'offline' — bu sağlayıcı zaten internet gerektirdiği için sabit bir
 * yedek listeye düşülmez, çağıran taraf "AI çevrimdışı" mesajı gösterir.
 * `active` true kaldığı sürece MODEL_CATALOG_REFRESH_MS'te bir yeniden çeker.
 */
export function useAiModelCatalog(active: boolean): AiModelCatalogState {
  const [state, setState] = useState<AiModelCatalogState>(IDLE)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const fetchModels = () => {
      void window.api.ai.models().then(models => {
        if (cancelled) return
        setState(
          models.length > 0 ? { status: 'ready', models } : { status: 'offline', models: [] }
        )
      })
    }
    fetchModels()
    const intervalId = window.setInterval(fetchModels, MODEL_CATALOG_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [active])

  return state
}
