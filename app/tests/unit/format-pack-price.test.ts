// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import { AiCreditPackSchema } from '../../shared/ai-types'
import { formatPackPrice } from '../../src/lib/format-pack-price'

describe('formatPackPrice', () => {
  it('shows whole amounts without decimals (site checkout: $10, 399 TL)', () => {
    expect(formatPackPrice({ variantId: 'credits-10', usd: 10, credits: 1000 }, 'en-US')).toBe(
      '$10'
    )
    const tr = formatPackPrice(
      { variantId: 'credits-10', usd: 10, currency: 'TRY', price: 399, credits: 1000 },
      'tr-TR'
    )
    expect(tr).toContain('399')
    expect(tr).not.toContain(',')
  })

  it('keeps App Store decimals so the button matches the charge ($9.99, ₺499,99)', () => {
    expect(
      formatPackPrice(
        {
          variantId: 'com.saibilisim.saistatistics.credits10',
          usd: 9.99,
          currency: 'USD',
          price: 9.99,
          credits: 1000
        },
        'en-US'
      )
    ).toBe('$9.99')
    expect(
      formatPackPrice(
        { variantId: 'x', usd: 499.99, currency: 'TRY', price: 499.99, credits: 1000 },
        'tr-TR'
      )
    ).toContain('499,99')
  })
})

describe('AiCreditPackSchema currency', () => {
  it('accepts any StoreKit ISO 4217 code and rejects junk', () => {
    const base = { variantId: 'p', usd: 1, price: 1, credits: 1 }
    expect(AiCreditPackSchema.safeParse({ ...base, currency: 'EUR' }).success).toBe(true)
    expect(AiCreditPackSchema.safeParse({ ...base, currency: 'eur' }).success).toBe(false)
    expect(AiCreditPackSchema.safeParse({ ...base, currency: 'EURO' }).success).toBe(false)
  })
})
