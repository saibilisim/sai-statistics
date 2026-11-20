// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * apple-iap.ts — Mac App Store build's credit purchase (StoreKit via Electron
 * `inAppPurchase`). App Review 3.1.1: digital credits spent inside the app
 * must be sold through In-App Purchase in the MAS build, so there the
 * ai:account:packs / ai:account:checkout channels route here instead of the
 * Paddle/PayTR checkout page. Every other build is untouched.
 *
 * Flow:
 *  1. packs: the server (GET /billing/apple/products) says which product IDs
 *     exist and how many credits each loads; StoreKit supplies the localized
 *     price. A product StoreKit does not return is not offered.
 *  2. checkout: purchaseProduct with `username` = account ID (UUID). StoreKit
 *     carries it as appAccountToken, which the server checks, so a receipt
 *     cannot be redeemed on another account.
 *  3. 'transactions-updated' → purchased: POST /billing/apple/transactions with
 *     the transaction ID. The server fetches and verifies the transaction from
 *     Apple itself (the client is not trusted) and credits it once. Only after
 *     the server has answered is the transaction finished; on a network error
 *     it stays in the StoreKit queue and is delivered again on next launch.
 */
import { inAppPurchase, type Transaction } from 'electron'
import log from 'electron-log/main'
import { z } from 'zod'
import {
  AI_SERVER_BASE_URL,
  type AiCheckoutResult,
  type AiCreditPack
} from '../../../shared/ai-types'
import { ensureFreshAccessToken } from './credentials'

/** True only in the Mac App Store build (Electron's MAS flavour). */
export const IAP_ENABLED: boolean = process.mas

const ServerProductsSchema = z.object({
  products: z.array(z.object({ productId: z.string(), credits: z.number().int().positive() }))
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Account ID (`sub`) from our own access token — used only as appAccountToken. */
function accountIdOf(token: string): string | null {
  try {
    const payload = token.split('.')[1] ?? ''
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: unknown }
    return typeof json.sub === 'string' && UUID_RE.test(json.sub) ? json.sub : null
  } catch {
    return null
  }
}

export async function listApplePacks(): Promise<AiCreditPack[]> {
  if (!inAppPurchase.canMakePayments()) return []
  try {
    const res = await fetch(`${AI_SERVER_BASE_URL}/billing/apple/products`, {
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return []
    const server = ServerProductsSchema.parse(await res.json())
    const credits = new Map(server.products.map(p => [p.productId, p.credits]))
    const products = await inAppPurchase.getProducts([...credits.keys()])
    return products
      .filter(p => credits.has(p.productIdentifier))
      .sort((a, b) => a.price - b.price)
      .map(p => ({
        variantId: p.productIdentifier,
        usd: p.price,
        currency: p.currencyCode,
        price: p.price,
        credits: credits.get(p.productIdentifier) ?? 0
      }))
  } catch (err) {
    log.warn('[apple-iap] product list failed', err)
    return []
  }
}

export async function startApplePurchase(productId: string): Promise<AiCheckoutResult> {
  const token = await ensureFreshAccessToken()
  if (!token) return { ok: false, error: 'not_logged_in' }
  const accountId = accountIdOf(token)
  if (!accountId) return { ok: false, error: 'not_logged_in' }
  if (!inAppPurchase.canMakePayments()) return { ok: false, error: 'payments_disabled' }
  try {
    const queued = await inAppPurchase.purchaseProduct(productId, {
      quantity: 1,
      username: accountId
    })
    return queued ? { ok: true } : { ok: false, error: 'invalid_product' }
  } catch (err) {
    log.warn('[apple-iap] purchaseProduct failed', err)
    return { ok: false, error: 'purchase_failed' }
  }
}

type ClaimOutcome = 'credited' | 'retry_later' | 'rejected'

async function claim(transactionId: string): Promise<ClaimOutcome> {
  const token = await ensureFreshAccessToken()
  if (!token) return 'retry_later' // signed out: keep it queued until next sign-in/launch
  try {
    const res = await fetch(`${AI_SERVER_BASE_URL}/billing/apple/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ transactionId }),
      signal: AbortSignal.timeout(20_000)
    })
    if (res.ok) return 'credited'
    // 4xx: Apple's record says this transaction cannot be credited to this
    // account (wrong account, refunded, unknown product). Retrying will not
    // change that; it is logged server-side and handled by support.
    if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) {
      log.warn(
        `[apple-iap] server rejected transaction ${transactionId}: HTTP ${String(res.status)}`
      )
      return 'rejected'
    }
    return 'retry_later'
  } catch (err) {
    log.warn('[apple-iap] claim failed, will retry', err)
    return 'retry_later'
  }
}

let listening = false

/**
 * Starts the StoreKit queue listener (MAS build only). `onCredited` is called
 * after the server accepted a purchase so the balance shown refreshes.
 */
export function initAppleIap(onCredited: () => void): void {
  if (!IAP_ENABLED || listening) return
  listening = true
  inAppPurchase.on('transactions-updated', (_event, transactions: Transaction[]) => {
    for (const tx of transactions) {
      switch (tx.transactionState) {
        case 'purchased':
          void claim(tx.transactionIdentifier).then(outcome => {
            if (outcome === 'retry_later') return
            inAppPurchase.finishTransactionByDate(tx.transactionDate)
            if (outcome === 'credited') onCredited()
          })
          break
        case 'failed':
          // Cancelled or declined: nothing was charged; clear it from the queue.
          inAppPurchase.finishTransactionByDate(tx.transactionDate)
          break
        default:
          // purchasing / deferred (Ask to Buy) / restored (not used for consumables)
          break
      }
    }
  })
}
