// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'
import type { AiAppConfig } from '@shared/ai-types'

/**
 * Sunucudan yönetilen uygulama konfigürasyonu (ai:app-config → server
 * src/routes/config.ts GET /app/config): server provider'ın varsayılan
 * modeli. Sunucuya ulaşılamazsa null döner — çağıran taraf
 * shared/ai-types.ts'teki gömülü fallback sabite (AI_SERVER_DEFAULT_MODEL)
 * düşer.
 */
export function useAiAppConfig(): AiAppConfig | null {
  const [config, setConfig] = useState<AiAppConfig | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.ai.appConfig().then(c => {
      if (!cancelled && c) setConfig(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return config
}
