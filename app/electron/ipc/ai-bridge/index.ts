// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ai-bridge — AI entegrasyonu: ai:* IPC handler'ları + F2 agent döngüsü
 * (ai-entegrasyon-fizibilitesi.md §3/§4/§5.2/§6/§7).
 *
 * - LLM ile konuşan tek yer Main'dir; Renderer sağlayıcıya hiç HTTP çağrısı
 *   yapmaz (CSP `connect-src 'self'` dokunulmadan kalır, §6.2).
 * - SAI hesabı oturum token'ı settings.json'a GİRMEZ — safeStorage.encryptString
 *   ile userData/ai-session.bin'e şifreli yazılır; geri okuyan kanal YOK (§6.1).
 * - Log'a sohbet içeriği/prompt yazılmaz — yalnız metadata (§6.5).
 * - F2 agent döngüsü (§3.1): model ⇄ tool_call, max 6 tur. Tool yüzeyi §6.3
 *   sınırlarında: get_variables (metadata), get_data_profile (allow-list'li
 *   agregat SQL — ham satır YOK, serbest SQL YOK), run_analysis (manifest'teki
 *   9 analiz; params manifest zod şemasıyla doğrulanır, şema uymazsa hata
 *   modele tool result olarak döner → retry turu), run_syntax (Faz T3 —
 *   shared/spss-syntax-analysis.ts'teki ~30 analiz komutunun TAMAMI; model
 *   serbest metin SPSS syntax'ı yazar ama metin yalnızca deterministik regex
 *   parser'dan geçer, R'a/shell'e asla ulaşmaz — keyfi kod yürütme değil.
 *   Mutasyon komutları (RENAME/RECODE/WEIGHT/SELECT IF/FILTER/...) Renderer
 *   store'una ihtiyaç duyduğu için run_syntax'ta YOKTUR, tanınmaz).
 * - run_analysis/run_syntax mevcut analiz hunisini (enqueueAiAnalysis) paylaşır:
 *   parquet export + weight/split/missing/decimals enjeksiyonu
 *   analysis-handler.ts'deki choke point'in birebir aynasıdır
 *   (analysis-handler'a dokunulmaması gerektiği için mantık burada
 *   çoğaltıldı — tek-kaynak refactor'u koordinatör notu). run_syntax'ın
 *   syntax→params ayrıştırma mantığı ise Terminal sekmesiyle (Renderer)
 *   shared/spss-syntax-analysis.ts üzerinden TEK kaynaktan paylaşılır — DRY.
 * - job:complete köprüsü: job-manager yalnız Renderer'a push eder; Main içinde
 *   sonucu yakalamak için turn'ün WebContents.send'i tap'lenir (salt-okur
 *   gözlem — Renderer akışı hiç değişmez). R script ayrı bir süreçte koştuğu
 *   için tur süresince tek LLM round-trip'i ile "sonuç geldi" mesajı beslenir.
 *
 * Modül haritası (eski tek dosya ai-bridge.ts'in bölünmüş hâli):
 *   credentials.ts     — safeStorage kimlik/token saklama + token yenileme
 *   google-login.ts    — 'server' provider Google OAuth (loopback redirect)
 *   provider-config.ts — provider çözümleme, consent guard, hata indirgeme
 *   app-config.ts      — GET /app/config canlı konfigürasyonu (60 sn cache)
 *   prompts.ts         — sistem prompt'ları + tool şemaları
 *   job-bridge.ts      — job:complete köprüsü + enqueueAiAnalysis hunisi
 *   tools.ts           — tool yürütücüler (get_variables / get_data_profile /
 *                        run_analysis / run_syntax)
 *   agent-loop.ts      — tool'lu round-trip + runAgentTurn + activeTurns
 *   index.ts (bu dosya)— ai:* IPC handler kaydı (registerAiBridgeHandlers)
 */

import { ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'crypto'
import log from 'electron-log'
import { IPC } from '../../../shared/ipc-contracts'
import type { AiSendResult } from '../../../shared/ipc-contracts'
import {
  AiSendRequestSchema,
  AiCancelRequestSchema,
  AiAccountRegisterRequestSchema,
  AiAccountLoginRequestSchema,
  AiAccountResendVerificationRequestSchema,
  AiAccountForgotRequestSchema,
  AiAccountChangePasswordRequestSchema,
  AiAccountChangeEmailRequestSchema,
  AiAccountDeleteRequestSchema,
  AiCheckoutRequestSchema
} from '../../../shared/ipc-schemas'
import { AiInterpretRequestSchema, AI_SERVER_BASE_URL } from '../../../shared/ai-types'
import type {
  AiSetupInfo,
  AiAccountStatus,
  AiAccountAuthResult,
  AiCreditPack,
  AiCheckoutResult,
  AiServerModel,
  AiAppConfig
} from '../../../shared/ai-types'
import { handleValidated, validateSender, openExternalHttps } from '../security'
import { getSettings } from '../settings-handler'
import { chatCompletion } from '../../ai/ai-provider'
import {
  purgeLegacyApiKey,
  hasSessionToken,
  saveSessionTokens,
  readSessionTokens,
  deleteSessionToken,
  ensureFreshAccessToken,
  consumeDeleteReauth
} from './credentials'
import { performGoogleLogin } from './google-login'
import { authErrorFromResponse, authErrorFromException, authErrorDetail } from './auth-errors'
import { requireProviderConfig, checkReachable } from './provider-config'
import { fetchAppConfig, fetchModelCatalog } from './app-config'
import { interpretPrompt } from './prompts'
import { compactAnalysisResult } from './context-budget'
import { activeTurns, runAgentTurn } from './agent-loop'

// ─── IPC kaydı ───────────────────────────────────────────────────────────────

/**
 * Bir AI çağrısı bittiğinde (başarılı, hatalı ya da iptal — sunucu kısmi
 * kullanımı da düşebilir) kalan bakiyeyi gösteren yerlere "tazele" der. Sohbet
 * panelinin bakiye etiketi önceden yalnız açılışta soruyordu ve harcamadan
 * sonra eski değerde kalıyordu; Tercihler doğruyu gösteriyordu (2026-10-11).
 * Yalnız SAI hesabı (server) bakiye taşır.
 */
function notifyCreditsSpent(sender: WebContents): void {
  if (getSettings().ai.provider !== 'server' || sender.isDestroyed()) return
  sender.send(IPC.AI_ACCOUNT_CHANGED)
}

export function registerAiBridgeHandlers(): void {
  // BYOK kaldırıldı (2026-10-16): eski sürümlerden kalan şifreli anahtar dosyasını sil.
  purgeLegacyApiKey()

  // ai:send — turn başlatır, { turnId } hemen döner; metin ai:stream-chunk ile akar.
  handleValidated(IPC.AI_SEND, AiSendRequestSchema, (req, event): AiSendResult => {
    const turnId = randomUUID()
    const controller = new AbortController()
    activeTurns.set(turnId, controller)
    void runAgentTurn({
      turnId,
      messages: req.messages,
      ...(req.mentionBlocks ? { mentionBlocks: req.mentionBlocks } : {}),
      sender: event.sender,
      signal: controller.signal
    }).finally(() => {
      activeTurns.delete(turnId)
      notifyCreditsSpent(event.sender)
    })
    return { turnId }
  })

  // ai:cancel — turn'e ait AbortController'ı tetikler.
  handleValidated(IPC.AI_CANCEL, AiCancelRequestSchema, (req): void => {
    activeTurns.get(req.turnId)?.abort()
  })

  // ai:interpret — tek tur, agentsız (§7). Blok JSON'u Renderer'dan payload
  // olarak gelir; Main'de blok state'i tutulmaz (§5.4).
  handleValidated(
    IPC.AI_INTERPRET,
    AiInterpretRequestSchema,
    async (req, event): Promise<{ text: string }> => {
      const config = await requireProviderConfig()
      const language = getSettings().appearance.language
      // TODO(F1/F2): electron/i18n.ts Main'de yalnız `dialogs` namespace'ini
      // çözümlüyor — titleKey/columns/warnings/notes şimdilik ham i18n anahtarı
      // olarak modele gidiyor (§5.3). Main-side analiz/output namespace
      // çözümleyicisi eklenince burada kullanıcı diline çözümlenmeli.
      const userContent = [
        'Output block JSON (i18n keys unresolved):',
        // Grafik/vaka verisi modele gitmez — yalnız tablolar (context-budget.ts).
        JSON.stringify({ ...req.block, result: compactAnalysisResult(req.block.result) }),
        req.question ? `\nUser question: ${req.question}` : ''
      ]
        .filter(Boolean)
        .join('\n')
      // Sistem prompt'unu sunucu kurar (interpretPrompt yalnız dili taşır).
      const text = await chatCompletion(config, [{ role: 'user', content: userContent }], {
        maxTokens: 1500,
        saiPrompt: interpretPrompt(language)
      }).finally(() => {
        notifyCreditsSpent(event.sender)
      })
      log.info(`[ai-bridge] interpret completed (${String(text.length)} chars)`)
      return { text }
    }
  )

  // ai:get-setup — panelin kurulum durumunu göstermesi için (§7).
  // Payload'suz kanal: settings:get deseni (handleValidated zod ister).
  ipcMain.handle(IPC.AI_GET_SETUP, async (event): Promise<AiSetupInfo> => {
    validateSender(event)
    const ai = getSettings().ai
    const reachable = ai.provider === 'off' ? false : await checkReachable(AI_SERVER_BASE_URL)
    return { provider: ai.provider, hasKey: hasSessionToken(), model: ai.model, reachable }
  })

  // ─── 'server' provider: hesap kanalları ───────────────────────────────────
  // Bu kanallar AI_SERVER_BASE_URL'e (server/src/routes/auth.ts) HTTP isteği
  // atan TEK yer — CSP/§6.2 kuralı burada da geçerli: yalnız Main ağa çıkar,
  // Renderer bu sunucuya da doğrudan hiç bağlanmaz.

  ipcMain.handle(IPC.AI_ACCOUNT_GOOGLE_LOGIN, async (event): Promise<AiAccountAuthResult> => {
    validateSender(event)
    return performGoogleLogin()
  })

  // ai:account:delete-reauth-google — Google ile bağlı hesabın silme öncesi
  // yeniden doğrulaması: sistem tarayıcısında Google girişi, AYNI hesap şart;
  // başarıda Main kısa ömürlü tek kullanımlık bayrağı kurar (silme bunu tüketir).
  ipcMain.handle(
    IPC.AI_ACCOUNT_DELETE_REAUTH_GOOGLE,
    async (event): Promise<AiAccountAuthResult> => {
      validateSender(event)
      return performGoogleLogin('reauth')
    }
  )

  // ai:account:register — 2026-08-15: kayıt artık OTURUM AÇMAYABİLİR. Sunucu
  // e-posta doğrulaması zorunluyken token yerine `verificationRequired: true`
  // döner; bu durumda yerelde hiçbir token saklanmaz ve pencere "e-postanı
  // kontrol et" ekranına geçer. Token'lı yanıt hâlâ kabul edilir (doğrulamayı
  // henüz açmamış bir sunucu sürümüyle geriye dönük uyum) — kararı sunucu
  // verir, client onu yalnız görüntüler: güvenlik sınırı Main'de değil, uçta.
  handleValidated(
    IPC.AI_ACCOUNT_REGISTER,
    AiAccountRegisterRequestSchema,
    async (req): Promise<AiAccountAuthResult> => {
      try {
        const res = await fetch(`${AI_SERVER_BASE_URL}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
          signal: AbortSignal.timeout(15_000)
        })
        const json = (await res.json().catch(() => ({}))) as {
          token?: string
          refreshToken?: string
          verificationRequired?: boolean
          error?: string
        }
        if (!res.ok) {
          return {
            ok: false,
            error: authErrorFromResponse(res.status, json.error),
            detail: authErrorDetail(json.error)
          }
        }
        if (json.verificationRequired ?? !json.token) {
          return { ok: true, pendingVerification: true }
        }
        if (!json.token || !json.refreshToken) {
          return { ok: false, error: 'server_error' }
        }
        const saved = saveSessionTokens({
          accessToken: json.token,
          refreshToken: json.refreshToken
        })
        return saved ? { ok: true } : { ok: false, error: 'storage_unavailable' }
      } catch (err) {
        return { ok: false, error: authErrorFromException(), detail: authErrorDetail(err) }
      }
    }
  )

  handleValidated(
    IPC.AI_ACCOUNT_LOGIN,
    AiAccountLoginRequestSchema,
    async (req): Promise<AiAccountAuthResult> => {
      try {
        const res = await fetch(`${AI_SERVER_BASE_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
          signal: AbortSignal.timeout(15_000)
        })
        const json = (await res.json().catch(() => ({}))) as {
          token?: string
          refreshToken?: string
          error?: string
        }
        if (!res.ok || !json.token || !json.refreshToken) {
          return {
            ok: false,
            error: authErrorFromResponse(res.status, json.error),
            detail: authErrorDetail(json.error)
          }
        }
        const saved = saveSessionTokens({
          accessToken: json.token,
          refreshToken: json.refreshToken
        })
        return saved ? { ok: true } : { ok: false, error: 'storage_unavailable' }
      } catch (err) {
        return { ok: false, error: authErrorFromException(), detail: authErrorDetail(err) }
      }
    }
  )

  // ai:account:resend-verification — doğrulama bağlantısını yeniden yollar.
  // Yanıt hesabın varlığına göre DEĞİŞMEZ (enumeration engeli): sunucu 2xx
  // döndüğü sürece burada { ok: true } üretilir. Tek istisna 429 — sunucunun
  // rate-limit'i kullanıcıya "biraz bekle" olarak gösterilmeli, yoksa düğmeye
  // basmaya devam eder.
  handleValidated(
    IPC.AI_ACCOUNT_RESEND_VERIFICATION,
    AiAccountResendVerificationRequestSchema,
    async (req): Promise<AiAccountAuthResult> => {
      try {
        const res = await fetch(`${AI_SERVER_BASE_URL}/auth/verify/resend`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
          signal: AbortSignal.timeout(15_000)
        })
        if (res.ok) return { ok: true, pendingVerification: true }
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        return {
          ok: false,
          error: authErrorFromResponse(res.status, json.error),
          detail: authErrorDetail(json.error)
        }
      } catch (err) {
        return { ok: false, error: authErrorFromException(), detail: authErrorDetail(err) }
      }
    }
  )

  // ai:account:forgot — şifremi unuttum. Oturumsuz; sunucu enumeration-dirençli
  // (her durumda 200), bu yüzden yalnız ağ/5xx hatasını yansıtırız.
  handleValidated(
    IPC.AI_ACCOUNT_FORGOT,
    AiAccountForgotRequestSchema,
    async (req): Promise<AiAccountAuthResult> => {
      try {
        const res = await fetch(`${AI_SERVER_BASE_URL}/auth/forgot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
          signal: AbortSignal.timeout(15_000)
        })
        if (res.ok) return { ok: true }
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        return {
          ok: false,
          error: authErrorFromResponse(res.status, json.error),
          detail: authErrorDetail(json.error)
        }
      } catch (err) {
        return { ok: false, error: authErrorFromException(), detail: authErrorDetail(err) }
      }
    }
  )

  // ai:account:change-password — oturum gerektirir. Başarıda sunucu YENİ token
  // çifti döner (diğer tüm oturumlar düştü); onu safeStorage'a yazarız ki bu
  // cihaz açık kalsın.
  handleValidated(
    IPC.AI_ACCOUNT_CHANGE_PASSWORD,
    AiAccountChangePasswordRequestSchema,
    async (req): Promise<AiAccountAuthResult> => {
      const token = await ensureFreshAccessToken()
      if (!token) return { ok: false, error: 'invalid_credentials' }
      try {
        const res = await fetch(`${AI_SERVER_BASE_URL}/auth/change-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(req),
          signal: AbortSignal.timeout(15_000)
        })
        const json = (await res.json().catch(() => ({}))) as {
          token?: string
          refreshToken?: string
          error?: string
        }
        if (!res.ok) {
          return {
            ok: false,
            error: authErrorFromResponse(res.status, json.error),
            detail: authErrorDetail(json.error)
          }
        }
        if (json.token && json.refreshToken) {
          const saved = saveSessionTokens({
            accessToken: json.token,
            refreshToken: json.refreshToken
          })
          if (!saved) return { ok: false, error: 'storage_unavailable' }
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: authErrorFromException(), detail: authErrorDetail(err) }
      }
    }
  )

  // ai:account:change-email — oturum gerektirir. Sunucu yeni adrese doğrulama
  // maili yollar; asıl adres kullanıcı onaylayana kadar değişmez.
  handleValidated(
    IPC.AI_ACCOUNT_CHANGE_EMAIL,
    AiAccountChangeEmailRequestSchema,
    async (req): Promise<AiAccountAuthResult> => {
      const token = await ensureFreshAccessToken()
      if (!token) return { ok: false, error: 'invalid_credentials' }
      try {
        const res = await fetch(`${AI_SERVER_BASE_URL}/auth/change-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(req),
          signal: AbortSignal.timeout(15_000)
        })
        const json = (await res.json().catch(() => ({}))) as {
          pendingEmail?: string
          error?: string
        }
        if (!res.ok) {
          return {
            ok: false,
            error: authErrorFromResponse(res.status, json.error),
            detail: authErrorDetail(json.error)
          }
        }
        return { ok: true, pendingEmail: json.pendingEmail }
      } catch (err) {
        return { ok: false, error: authErrorFromException(), detail: authErrorDetail(err) }
      }
    }
  )

  // ai:account:delete — oturum gerektirir. Başarıda yerel oturum da silinir.
  handleValidated(
    IPC.AI_ACCOUNT_DELETE,
    AiAccountDeleteRequestSchema,
    async (req): Promise<AiAccountAuthResult> => {
      // Kanıt: parola (sunucuya iletilir) YA DA Main'in tuttuğu yakın zamanlı
      // Google doğrulaması (tek kullanımlık, 5 dk). Renderer'ın kendi beyanı yetmez.
      if ('googleReauth' in req && !consumeDeleteReauth()) {
        return { ok: false, error: 'google_failed', detail: 'reauth_required' }
      }
      const token = await ensureFreshAccessToken()
      if (!token) return { ok: false, error: 'invalid_credentials' }
      try {
        const res = await fetch(`${AI_SERVER_BASE_URL}/auth/delete-account`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify('password' in req ? { password: req.password } : {}),
          signal: AbortSignal.timeout(15_000)
        })
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          return {
            ok: false,
            error: authErrorFromResponse(res.status, json.error),
            detail: authErrorDetail(json.error)
          }
        }
        deleteSessionToken()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: authErrorFromException(), detail: authErrorDetail(err) }
      }
    }
  )

  // ai:account:logout — yerel oturum token'larını siler VE refresh token'ı
  // sunucuda da iptal eder (best-effort — ağ hatası olsa bile yerel temizlik
  // her zaman uygulanır, kullanıcı yerelde "çıkış yapmış" görür).
  ipcMain.handle(IPC.AI_ACCOUNT_LOGOUT, async (event): Promise<boolean> => {
    validateSender(event)
    const stored = readSessionTokens()
    if (stored) {
      try {
        await fetch(`${AI_SERVER_BASE_URL}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: stored.refreshToken }),
          signal: AbortSignal.timeout(10_000)
        })
      } catch (err) {
        log.warn('[ai-bridge] server-side logout failed (local session cleared anyway)', err)
      }
    }
    return deleteSessionToken()
  })

  // ai:account:status — oturum varsa /auth/me'den plan/limit bilgisini çeker.
  // ensureFreshAccessToken süresi dolmuş access token'ı sessizce yeniler.
  ipcMain.handle(IPC.AI_ACCOUNT_STATUS, async (event): Promise<AiAccountStatus> => {
    validateSender(event)
    const token = await ensureFreshAccessToken()
    if (!token) return { loggedIn: false }
    try {
      const res = await fetch(`${AI_SERVER_BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000)
      })
      if (!res.ok) {
        // 401 burada yalnız "refresh de geçti ama sunucu yine reddetti" gibi
        // beklenmedik bir durumda düşer (normal süre-dolma zaten yukarıda
        // ensureFreshAccessToken tarafından yenilendi) — güvenlik payı olarak
        // kayıtlı token'ı temizle, kullanıcı tekrar login olmalı.
        if (res.status === 401) deleteSessionToken()
        return { loggedIn: false }
      }
      const json = (await res.json()) as {
        email: string
        plan: string
        status: string
        credit_balance_usd: number
        email_verified?: boolean
      }
      return {
        loggedIn: true,
        email: json.email,
        plan: json.plan,
        status: json.status,
        creditBalanceUsd: json.credit_balance_usd,
        // Alan yoksa (doğrulama öncesi sunucu sürümü) `undefined` bırakılır —
        // UI "bilinmiyor"u "doğrulanmadı" gibi göstermez.
        emailVerified: json.email_verified
      }
    } catch {
      return { loggedIn: false }
    }
  })

  // ai:account:packs — kredi paketlerini listeler (server/src/billing/
  // catalog.ts CREDIT_PACKS; TR'de TL fiyatla). Oturum yoksa boş liste (panel zaten
  // giriş kartını gösteriyor olur, bu kanal ayrıca hata üretmez).
  ipcMain.handle(IPC.AI_ACCOUNT_PACKS, async (event): Promise<AiCreditPack[]> => {
    validateSender(event)
    const token = await ensureFreshAccessToken()
    if (!token) return []
    try {
      const res = await fetch(`${AI_SERVER_BASE_URL}/billing/packs`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000)
      })
      if (!res.ok) return []
      const json = (await res.json()) as { packs: AiCreditPack[] }
      return json.packs
    } catch {
      return []
    }
  })

  // ai:account:checkout — ödeme sayfası URL'ini (Lemon Squeezy / PayTR) alır ve Main içinde
  // shell.openExternal ile varsayılan tarayıcıda açar (ödeme sayfası hiçbir
  // zaman Electron içinde render edilmez, main.ts'teki setWindowOpenHandler/
  // will-navigate kısıtlamalarıyla aynı desen).
  handleValidated(
    IPC.AI_ACCOUNT_CHECKOUT,
    AiCheckoutRequestSchema,
    async (req): Promise<AiCheckoutResult> => {
      const token = await ensureFreshAccessToken()
      if (!token) return { ok: false, error: 'not_logged_in' }
      try {
        const res = await fetch(`${AI_SERVER_BASE_URL}/billing/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ variantId: req.variantId }),
          signal: AbortSignal.timeout(15_000)
        })
        const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
        if (!res.ok || !json.url) {
          return { ok: false, error: json.error ?? `HTTP ${String(res.status)}` }
        }
        if (!openExternalHttps(json.url)) return { ok: false, error: 'Invalid checkout URL' }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ai:models — canlı model kataloğu (server/src/routes/models.ts GET
  // /v1/models, public/oturumsuz). Sabit AI_SERVER_MODEL_CATALOG (2026-08-05'te
  // kaldırıldı) yerine geçti — yeni model eklemek artık yalnız server deploy'u
  // ister, client'ın yeniden dağıtılmasına gerek yok. Ağ yoksa boş dizi döner;
  // Renderer bunu "çevrimdışı" mesajı olarak gösterir (server provider zaten
  // internet gerektirdiği için offline fallback listesi anlamsız).
  ipcMain.handle(IPC.AI_MODELS, async (event): Promise<AiServerModel[]> => {
    validateSender(event)
    return fetchModelCatalog()
  })

  // ai:app-config — sunucudan yönetilen konfigürasyon (server/src/routes/
  // config.ts GET /app/config, public/oturumsuz): server provider varsayılan
  // modeli. 60 sn cache (app-config.ts). Ağ yoksa null döner — Renderer/Main
  // shared/ai-types.ts'teki gömülü fallback sabite (AI_SERVER_DEFAULT_MODEL)
  // düşer.
  ipcMain.handle(IPC.AI_APP_CONFIG, async (event): Promise<AiAppConfig | null> => {
    validateSender(event)
    return fetchAppConfig()
  })
}
