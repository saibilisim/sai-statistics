// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { AiCreditPack } from '@shared/ai-types'

/**
 * Kredi paketinin tutarı, sunucunun bildirdiği para biriminde (Türkiye
 * kanalında TL). Eski sunucu yanıtında currency/price yoksa usd.
 */
export function formatPackPrice(pack: AiCreditPack, locale: string): string {
  const currency = pack.currency ?? 'USD'
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: currency === 'TRY' ? 0 : 2
  }).format(pack.price ?? pack.usd)
}
