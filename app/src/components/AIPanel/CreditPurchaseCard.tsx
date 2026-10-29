// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AiCreditPack } from '@shared/ai-types'
import { formatPackPrice } from '../../lib/format-pack-price'
import styles from './AIPanel.module.css'

/**
 * CreditPurchaseCard — 402 (kredi/free kota bitti) hatasında ChatMessageList'in
 * gösterdiği satın alma kartı (2026-08-04). Paket listesi server/src/routes/
 * billing.ts GET /billing/packs'ten gelir; tıklanan paket ai:account:checkout
 * ile ödeme sayfasının URL'ini (Lemon Squeezy; Türkiye'de sitenin PayTR
 * sayfası) Main'de shell.openExternal ile açtırır (bu bileşen URL görmez,
 * yalnız ok/error sonucunu gösterir). Tutar sunucunun bildirdiği para
 * biriminde gösterilir (TR → TL).
 */
export function CreditPurchaseCard() {
  const { t, i18n } = useTranslation(['common'])
  const [packs, setPacks] = useState<AiCreditPack[] | null>(null)
  const [pendingVariant, setPendingVariant] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState(false)

  useEffect(() => {
    void window.api.ai.account.packs().then(setPacks)
  }, [])

  const handleBuy = (variantId: string) => {
    setPendingVariant(variantId)
    setCheckoutError(false)
    void window.api.ai.account
      .checkout({ variantId })
      .then(res => {
        if (!res.ok) setCheckoutError(true)
      })
      .finally(() => {
        setPendingVariant(null)
      })
  }

  return (
    <div className={styles.creditCard} role="note">
      <p className={styles.creditCardStatus}>{t('ai.credit.exhaustedHint')}</p>
      {packs && packs.length > 0 && (
        <div className={styles.creditCardPacks}>
          {packs.map(pack => (
            <button
              key={pack.variantId}
              type="button"
              className={styles.creditCardPackBtn}
              disabled={pendingVariant !== null}
              onClick={() => {
                handleBuy(pack.variantId)
              }}
            >
              {pendingVariant === pack.variantId
                ? t('ai.credit.opening')
                : t('ai.credit.buyPack', {
                    price: formatPackPrice(pack, i18n.language),
                    tokens: pack.credits.toLocaleString()
                  })}
            </button>
          ))}
        </div>
      )}
      {checkoutError && <p className={styles.creditCardStatus}>{t('ai.credit.checkoutError')}</p>}
    </div>
  )
}
