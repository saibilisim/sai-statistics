// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AiCreditPack } from '@shared/ai-types'
import styles from './AIPanel.module.css'

/**
 * CreditPurchaseCard — 402 (kredi/free kota bitti) hatasında ChatMessageList'in
 * gösterdiği satın alma kartı (2026-08-04). Paket listesi server/src/routes/
 * billing.ts GET /billing/packs'ten gelir; tıklanan paket ai:account:checkout
 * ile Lemon Squeezy URL'ini Main'de shell.openExternal ile açtırır (bu bileşen
 * URL görmez, yalnız ok/error sonucunu gösterir).
 */
export function CreditPurchaseCard() {
  const { t } = useTranslation(['common'])
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
                    amount: pack.usd,
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
