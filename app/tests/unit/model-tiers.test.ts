// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { modelCostTier, modelSpeedTier } from '@shared/ai-types'

const tier = (prompt: number, completion: number) =>
  modelCostTier({ promptPriceUsdPerMTok: prompt, completionPriceUsdPerMTok: completion })

describe('modelCostTier', () => {
  // OpenRouter fiyatları, 2026-10-06 (USD / 1M token)
  it('ucuz modeller 1. seviyede', () => {
    expect(tier(0.3, 1.2)).toBe(1) // DeepSeek V4.1 Flash
    expect(tier(0.435, 0.87)).toBe(1) // MiMo-V2.6-Pro
  })

  it('orta ve pahalı modeller ayrışır', () => {
    expect(tier(0.75, 3.75)).toBe(2) // Gemini 3.8 Flash
    expect(tier(2, 10)).toBe(3) // Claude Sonnet 5.5
    expect(tier(5, 25)).toBe(4)
  })

  it('sınır değerde bir üst seviyeye geçer', () => {
    // 20k × 0.5 / 1M = 0.01 $ → 0.01 sınırı "küçüktür" ile karşılaştırılır
    expect(tier(0.5, 0)).toBe(2)
  })
})

describe('modelSpeedTier', () => {
  it('bilinmeyen hız için null döner', () => {
    expect(modelSpeedTier(null)).toBeNull()
    expect(modelSpeedTier(undefined)).toBeNull()
  })

  it('token/sn eşiklerine göre seviyelendirir', () => {
    expect(modelSpeedTier(25)).toBe(1)
    expect(modelSpeedTier(40)).toBe(2)
    expect(modelSpeedTier(100)).toBe(3)
    expect(modelSpeedTier(200)).toBe(4)
  })
})
