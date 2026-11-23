// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { AiCreditPack } from '@shared/ai-types'

/**
 * Kredi paketinin tutarı, sunucunun bildirdiği para biriminde (Türkiye
 * kanalında TL). Eski sunucu yanıtında currency/price yoksa usd.
 */
export function formatPackPrice(pack: AiCreditPack, locale: string): string {
  const currency = pack.currency ?? 'USD'
  const amount = pack.price ?? pack.usd
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    // Whole amounts without decimals (399 TL, $10); App Store prices keep
    // theirs ($9.99, ₺499,99) so the button shows what will be charged.
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2
  }).format(amount)
}
