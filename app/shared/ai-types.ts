// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ai-types.ts — AI alt sisteminin zod şemaları + tipleri (Faz F0,
 * ai-entegrasyon-fizibilitesi.md §3/§4/§7).
 *
 * Güvenlik sınırı: API anahtarı HİÇBİR şemada/tipte yer almaz — anahtar
 * safeStorage ile Main'de tutulur (§6.1), settings.json'a girmez.
 */

import { z } from 'zod'
import { AnalysisResultSchema } from './analysis-types'

// ─── 'server' provider sabiti (bizim kotamız, SAI hesabı) ────────────────────
// server/ (ayrı repo, aynı klasör altında) — /v1/chat/completions OpenAI
// şemasını birebir konuşur (bkz. server/src/routes/ai.ts), tek fark
// Authorization: Bearer <oturum token'ı>.
export const AI_SERVER_BASE_URL = 'https://api.saistatistics.com'

// Google OAuth "Desktop app" client ID (2026-08-02) — native/masaüstü istemciler
// RFC 8252'ye göre gizli tutulamaz (client secret PKCE ile birlikte yalnız
// server/src/routes/auth.ts'te kalır, Electron'a hiç gömülmez); bu yüzden
// buradaki client ID'nin herkese açık/kod içinde olması güvenlik sorunu değil.
// Google Cloud Console → APIs & Services → Credentials → OAuth client ID →
// Desktop app'ten alınır. Boş bırakılırsa LoginWindow'daki Google düğmesi
// devre dışı ("Yakında") kalır — ai-bridge.ts performGoogleLogin bunu kontrol eder.
export const AI_GOOGLE_CLIENT_ID: string =
  '1098121392481-f4kmfbbqiit4q7daf2cbdkssmqos0c4q.apps.googleusercontent.com'

// Model kataloğu (2026-08-05'ten itibaren CANLI çekilir) — server/src/models.ts
// MODEL_CATALOG artık `GET /v1/models` (routes/models.ts) ile public olarak
// yayınlanıyor; client `ai:models` IPC kanalı üzerinden Main'de bunu çeker
// (ai-bridge/index.ts). Önceden burada elle-senkron tutulan sabit dizi
// (AI_SERVER_MODEL_CATALOG) KALDIRILDI — yeni model eklemek/çıkarmak artık
// yalnız server deploy'u gerektirir, client'ın yeniden derlenip
// dağıtılmasına gerek kalmaz. AI_SERVER_DEFAULT_MODEL artık yalnız FALLBACK:
// gerçek varsayılan sunucudan canlı gelir (GET /app/config → defaultModelId,
// bkz. ai-bridge/app-config.ts); bu sabit sunucuya ulaşılamadığında ve
// settings.json ilk-kurulum tohumu için devreye girer.
export const AI_SERVER_DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash'

export const AiServerModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  promptPriceUsdPerMTok: z.number().nonnegative(),
  completionPriceUsdPerMTok: z.number().nonnegative(),
  // Model kartı (2026-10-06) — sunucu OpenRouter'dan saatlik çeker
  // (server/src/model-pricing.ts). Henüz bilinmiyorsa null; eski sunucu
  // sürümü hiç göndermeyebilir → optional.
  intelligenceIndex: z.number().nullable().optional(),
  speedTps: z.number().nullable().optional()
})
export type AiServerModel = z.infer<typeof AiServerModelSchema>

export const AiServerModelCatalogSchema = z.array(AiServerModelSchema)

// Model kartı (2026-10-06 kararı): zeka gerçek puan (Artificial Analysis
// Intelligence Index), maliyet ve hız 4'lük kutu ölçeği. $/1M token rakamı
// kullanıcıya anlamsız — ve sunucu bunun üstüne bindirim uyguladığı için
// yanıltıcı; maliyet seviyesi yalnız "bakiyeyi ne hızlı bitirir" sorusunu
// cevaplar. Ölçüt tipik bir AI paneli turu: ~20k girdi (değişken metadata +
// tablolar) + ~1k çıktı token'ı. Fiyat ve hız sunucuda OpenRouter'dan
// otomatik geldiği için seviyeler elle bakım gerektirmez.
export type AiModelTier = 1 | 2 | 3 | 4
const COST_TIER_LIMITS_USD = [0.01, 0.025, 0.06] as const

export function modelCostTier(
  m: Pick<AiServerModel, 'promptPriceUsdPerMTok' | 'completionPriceUsdPerMTok'>
): AiModelTier {
  const usd = (20_000 * m.promptPriceUsdPerMTok + 1_000 * m.completionPriceUsdPerMTok) / 1_000_000
  const idx = COST_TIER_LIMITS_USD.findIndex(limit => usd < limit)
  return (idx === -1 ? 4 : idx + 1) as AiModelTier
}

// Çıktı hızı (token/sn, sağlayıcıların p50 medyanı). Bilinmiyorsa null.
const SPEED_TIER_LIMITS_TPS = [40, 80, 140] as const

export function modelSpeedTier(speedTps: number | null | undefined): AiModelTier | null {
  if (speedTps === null || speedTps === undefined) return null
  const idx = SPEED_TIER_LIMITS_TPS.findIndex(limit => speedTps < limit)
  return (idx === -1 ? 4 : idx + 1) as AiModelTier
}

// GET /app/config (server/src/routes/config.ts) — sunucudan yönetilen küçük
// konfigürasyon: server provider varsayılan modeli. Main 60 sn cache'ler
// (ai-bridge/app-config.ts), ağ yoksa null döner ve çağıran taraf gömülü
// fallback sabite (AI_SERVER_DEFAULT_MODEL) düşer. Sunucu yanıtındaki
// bilinmeyen alanlar (eski byokProviders listesi dahil) zod tarafından atılır.
export const AiAppConfigSchema = z.object({
  defaultModelId: z.string().min(1)
})
export type AiAppConfig = z.infer<typeof AiAppConfigSchema>

// ─── Chat mesajları ──────────────────────────────────────────────────────────

// No 'system': instructions live on the server (§9). A client/disk-supplied
// system message would reach the model as authoritative context.
export const ChatRoleSchema = z.enum(['user', 'assistant', 'tool'])
export type ChatRole = z.infer<typeof ChatRoleSchema>

// OpenAI tool-calling konvansiyonu: arguments JSON-encoded string.
// F2'de agent döngüsü bunu kullanacak; F0 üretmez ama şema hazır.
export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.string()
})
export type ToolCall = z.infer<typeof ToolCallSchema>

export const ChatMessageSchema = z.object({
  role: ChatRoleSchema,
  content: z.string(),
  toolCalls: z.array(ToolCallSchema).optional(),
  // role:'tool' mesajlarında hangi tool_call'a yanıt olduğu (OpenAI konvansiyonu)
  toolCallId: z.string().optional()
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

// ─── Provider yapılandırması ─────────────────────────────────────────────────
// OpenAI-compatible arayüz (§4.1). apiKey = SAI hesabı oturum access token'ı;
// asla IPC'ye taşınmaz — yalnız Main içinde safeStorage'dan okunup config'e
// yerleştirilir.
export const AiProviderConfigSchema = z.object({
  baseUrl: z.url(),
  apiKey: z.string().optional(),
  model: z.string().min(1)
})
export type AiProviderConfig = z.infer<typeof AiProviderConfigSchema>

// ai:get-setup yanıtı (§7)
export const AiSetupInfoSchema = z.object({
  provider: z.enum(['server', 'off']),
  hasKey: z.boolean(), // 'server': SAI hesabı oturumu var mı
  model: z.string(),
  reachable: z.boolean()
})
export type AiSetupInfo = z.infer<typeof AiSetupInfoSchema>

// ─── Şifre politikası — yalnız KAYIT (ve ileride şifre sıfırlama) ───────────
// 2026-08-15, e-posta doğrulama katmanıyla birlikte sertleştirildi; önceki tek
// kural "en az 8 karakter"di. NIST SP 800-63B çizgisi izleniyor: ağırlık
// UZUNLUK + yaygın-şifre engelinde, zorunlu karakter kompozisyonunda değil.
// `noVariety` kuralı bilinçli olarak zayıf tutuldu (tek karakter sınıfı ya da
// 5'ten az farklı karakter) — "aaaaaaaaaa" / "1234567890" gibi uzun ama sıfır
// entropili girdileri eler, kullanıcıyı sembol kullanmaya zorlamaz.
//
// Bu kontrol bir GÜVENLİK SINIRI DEĞİLDİR, yalnız anında geri bildirimdir:
// aynı politikayı sunucu (sai-ai-server, POST /auth/register) bağımsız olarak
// tekrar uygular. Politika değişirse iki repoda birden güncellenmeli.
export const AI_PASSWORD_MIN_LENGTH = 10
export const AI_PASSWORD_MAX_LENGTH = 200

// Kısa, sık kullanılan parola listesi. Kapsamlı bir liste (ör. rockyou türevi)
// sunucu tarafının işi — client'a MB'lık sözlük gömmenin anlamı yok.
const AI_COMMON_PASSWORDS = new Set([
  '123456789',
  '1234567890',
  '12345678',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'qwertyuiop',
  'qwerty123',
  'qwerty12345',
  'iloveyou',
  'admin123',
  'administrator',
  'letmein123',
  'welcome123',
  'abc123456',
  'monkey123',
  'football',
  'baseball',
  'superman',
  'trustno1',
  'dragon123',
  'sunshine',
  'princess',
  'starwars',
  'whatever',
  'computer',
  'internet',
  'sifre123',
  'parola123',
  'sifrem123',
  'galatasaray',
  'fenerbahce',
  'besiktas1903',
  'turkiye123',
  'istanbul34',
  'ankara06',
  'deneme123'
])

export type PasswordPolicyViolation =
  | 'tooShort'
  | 'tooLong'
  | 'common'
  | 'containsEmail'
  | 'noVariety'

/**
 * Kayıt parolasını politikaya karşı denetler. Boş dizi = geçti. Sıra, UI'da
 * gösterim sırasıdır (en somut/en düzeltilebilir kural önce).
 */
export function checkPasswordPolicy(password: string, email = ''): PasswordPolicyViolation[] {
  const violations: PasswordPolicyViolation[] = []
  if (password.length < AI_PASSWORD_MIN_LENGTH) violations.push('tooShort')
  if (password.length > AI_PASSWORD_MAX_LENGTH) violations.push('tooLong')

  const lower = password.toLowerCase()
  if (AI_COMMON_PASSWORDS.has(lower)) violations.push('common')

  // E-postanın yerel kısmı ("ahmet@x.com" → "ahmet") parolanın içinde geçiyorsa
  // parola fiilen tahmin edilebilir; 3 karakterden kısa yerel kısımlar (rastgele
  // eşleşme üretir) hariç tutulur.
  const localPart = email.split('@')[0]?.toLowerCase() ?? ''
  if (localPart.length >= 3 && lower.includes(localPart)) violations.push('containsEmail')

  const classes = [/[a-zçğıöşü]/i, /[0-9]/, /[^a-zçğıöşü0-9]/i].filter(re =>
    re.test(password)
  ).length
  const distinct = new Set(password).size
  if (classes < 2 || distinct < 5) violations.push('noVariety')

  return violations
}

// ─── 'server' provider: hesap durumu (ai:account:status) ────────────────────
// creditBalanceUsd — kalan KULLANILABİLİR bakiye (server/src/routes/auth.ts
// /auth/me, 2026-08-05'te düzeltildi): aylık limitten harcanmamış kısım +
// satın alınmış kredi paketleri toplamı. Önceden ayrı bir "free_queries_used/
// free_query_limit" sayaç kavramı vardı ama server bunu hiç doldurmuyordu
// (her zaman undefined → UI hep "$0.00 bakiye" gösteriyordu) — kaldırıldı,
// tek bir dolar bakiyesi gösteriliyor.
// emailVerified — /auth/me'nin `email_verified` alanı (2026-08-15). Eski bir
// sunucu sürümü bu alanı hiç göndermeyebilir → `undefined` = "bilinmiyor",
// UI bunu "doğrulanmadı" gibi göstermez (yalnız açıkça `false` ise uyarır).
export const AiAccountStatusSchema = z.object({
  loggedIn: z.boolean(),
  email: z.string().optional(),
  plan: z.string().optional(),
  status: z.string().optional(),
  creditBalanceUsd: z.number().optional(),
  emailVerified: z.boolean().optional()
})

// Kullanıcıya kalan bakiye dolar yerine "SAI Token" birimiyle gösterilir
// (2026-09-05 karar) — server yalnız creditBalanceUsd döndürüyor, ayrı bir
// token alanı yok; dönüşüm tamamen UI-tarafı bir gösterim kararı. Kredi
// paketi SATIN ALMA fiyatları ($X) bundan etkilenmez, gerçek para birimiyle
// kalır — yalnız "kalan kullanım" bakiyesi bu birimle sunulur.
export const SAI_TOKEN_PER_USD = 100

export function usdToSaiTokens(usd: number): number {
  return Math.round(usd * SAI_TOKEN_PER_USD)
}
export type AiAccountStatus = z.infer<typeof AiAccountStatusSchema>

// Sıra önemli: `.trim()` biçim kontrolünden ÖNCE çalışmalı, aksi hâlde
// kopyala-yapıştırdan gelen baştaki/sondaki boşluk geçerli bir adresi reddettirir.
const AiEmailSchema = z.string().trim().max(254).pipe(z.email())

// Giriş kimlik bilgileri. E-posta yalnız BİÇİM olarak doğrulanır ve trim'lenir;
// büyük/küçük harf normalizasyonu bilinçli olarak sunucuya bırakıldı (mevcut
// hesapların hangi biçimde saklandığı burada bilinmiyor, client'ta lowercase'e
// çevirmek eski kayıtlarda girişi bozabilir). Şifre alt sınırı GİRİŞTE 8'de
// bırakıldı — kayıt politikası (aşağıda) 10'a çıktı ama eski hesapların şifresi
// bunu sağlamayabilir; login'i sertleştirmek saldırganı değil kullanıcıyı durdurur.
export const AiAccountCredentialsSchema = z.object({
  email: AiEmailSchema,
  password: z.string().min(8).max(AI_PASSWORD_MAX_LENGTH)
})
export type AiAccountCredentials = z.infer<typeof AiAccountCredentialsSchema>

// Kayıt kimlik bilgileri — giriş şemasının şifre politikasıyla sertleştirilmiş hâli.
export const AiAccountRegisterCredentialsSchema = AiAccountCredentialsSchema.refine(
  ({ password, email }) => checkPasswordPolicy(password, email).length === 0,
  { error: 'weak_password', path: ['password'] }
)

// ai:account:resend-verification — doğrulama e-postasını yeniden gönderir.
// Şifre İSTEMEZ: kullanıcı "kayıt oldum, mail gelmedi" durumunda oturumsuzdur.
// Hesap sayımı (enumeration) riskine karşı sunucu bu uçta her zaman aynı yanıtı
// döndürür (hesap yoksa da 200), gerçek gönderim yalnız doğrulanmamış hesap için olur.
export const AiAccountResendVerificationSchema = z.object({
  email: AiEmailSchema
})
export type AiAccountResendVerification = z.infer<typeof AiAccountResendVerificationSchema>

// Kredi paketleri (server/src/routes/billing.ts GET /billing/packs) — free
// kota bitince PreferencesDialog/AIPanel'in $10/$20/$50 düğmelerini bundan üretir.
export const AiCreditPackSchema = z.object({
  variantId: z.string(),
  usd: z.number(),
  // Kaç SAI Token yükleneceği — üst paketlerde hediye kredi yüzünden usd*100
  // ile birebir örtüşmez (örn. $20 pakette 2400 token = $24 değerinde bakiye).
  credits: z.number()
})
export type AiCreditPack = z.infer<typeof AiCreditPackSchema>

// ai:account:checkout sonucu — ok:true ise Main zaten checkout URL'ini
// shell.openExternal ile varsayılan tarayıcıda açmış demektir (ödeme sayfası
// Electron içinde render edilmez); Renderer yalnız başarı/hata durumunu gösterir.
export const AiCheckoutResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional()
})
export type AiCheckoutResult = z.infer<typeof AiCheckoutResultSchema>

// Hesap işlemlerinin (register/login/resend) normalize hata kodları — Renderer
// ham sunucu metnini DEĞİL bu kodu i18n'e çevirir (§6). Bilinmeyen kod →
// 'unknown' + ham metin yalnız `detail` içinde (log/destek için).
// `email_taken` bilinçli olarak YOK: doğrulama zorunluyken kayıt ucu, adres
// kayıtlı olsa da olmasa da aynı "e-postanı kontrol et" yanıtını döndürür
// (hesap sayımı/enumeration engeli) — sunucu bu durumda gerçek sahibe
// "birisi adresinle kayıt olmayı denedi" bilgisi yollar.
export const AiAccountErrorCodeSchema = z.enum([
  'email_not_verified', // 403 — hesap var, e-posta doğrulanmamış
  'invalid_credentials', // 401 — e-posta/şifre tutmuyor
  'weak_password', // 400 — kayıt/şifre-sıfırlama politikayı geçmedi
  'invalid_email', // 400 — e-posta biçimi geçersiz
  'rate_limited', // 429 — @fastify/rate-limit (5/dk auth uçlarında)
  'account_locked', // 423 — çok fazla hatalı giriş → geçici kilit
  'wrong_password', // 401 — mevcut parola yanlış (change-password/email/delete)
  'invalid_or_expired_token', // 400 — sıfırlama/onay token'ı geçersiz veya süresi dolmuş
  'no_password_set', // 400 — yalnız-Google hesap; bu işlem için parola yok
  'same_email', // 400 — yeni e-posta mevcutla aynı
  'email_taken', // 409 — yeni e-posta başka bir hesapta
  'network', // sunucuya ulaşılamadı / timeout
  'storage_unavailable', // safeStorage şifreleme yok → token saklanamaz
  'server_error', // 5xx
  'google_failed', // OAuth akışı tamamlanamadı (iptal/timeout/geçersiz callback)
  'unknown'
])
export type AiAccountErrorCode = z.infer<typeof AiAccountErrorCodeSchema>

// pendingVerification: true → kayıt kabul edildi ama OTURUM AÇILMADI; kullanıcı
// e-postasındaki bağlantıya tıklayana kadar token yok (CLAUDE.md §9 hattı:
// güvenlik kararını sunucu verir, client yalnız bu bayrağı görüntüler).
export const AiAccountAuthResultSchema = z.object({
  ok: z.boolean(),
  error: AiAccountErrorCodeSchema.optional(),
  detail: z.string().optional(),
  pendingVerification: z.boolean().optional(),
  // change-email başarısında, doğrulama bağlantısının gönderildiği yeni adres.
  pendingEmail: z.string().optional()
})
export type AiAccountAuthResult = z.infer<typeof AiAccountAuthResultSchema>

// ─── Streaming event'leri (Main → Renderer) ─────────────────────────────────

// Sağlayıcı/yapılandırma hata sınıfları — renderer bu koda göre yerelleştirilmiş,
// eyleme yönlendiren mesaj gösterir (ham sağlayıcı metni `error` alanında kalır).
export const AiErrorCodeSchema = z.enum([
  'auth', // 401/403 — oturum eksik/geçersiz
  'payment', // 402 — bakiye/ödeme
  'rate-limit', // 429 — kota/sınır
  'network', // sağlayıcıya ulaşılamadı (DNS/TLS/bağlantı reddi)
  'timeout', // bağlantı var ama model yanıtı zamanında gelmedi (yavaş model)
  'not-signed-in', // SAI hesabı oturumu yok (giriş yapılmamış)
  'provider-off', // settings.ai.provider = 'off'
  'consent-required', // settings.ai.consentGiven = false (Main-side guard, denetim #1)
  'unknown'
])
export type AiErrorCode = z.infer<typeof AiErrorCodeSchema>

// ai:stream-chunk — done:true son chunk; error yalnız hata bitişinde dolu.
// Hata OLMAYAN, kullanıcıya gösterilecek tur-sonu bilgisi (done chunk'ında).
// 'tool-round-limit': adım sınırına gelindi, model yapılanı özetledi —
// kullanıcı "devam et" ile sürdürebilir (2026-09-29; önceden hata idi).
export const AiStreamNoticeSchema = z.enum(['tool-round-limit'])
export type AiStreamNotice = z.infer<typeof AiStreamNoticeSchema>

export const AiStreamChunkSchema = z.object({
  turnId: z.string(),
  delta: z.string(),
  done: z.boolean(),
  error: z.string().optional(),
  errorCode: AiErrorCodeSchema.optional(),
  notice: AiStreamNoticeSchema.optional()
})
export type AiStreamChunk = z.infer<typeof AiStreamChunkSchema>

// ai:tool-event — F2 tool kartları için; F0 üretmez, kanal/sözleşme hazır.
export const AiToolEventSchema = z.object({
  turnId: z.string(),
  tool: z.string(),
  status: z.enum(['running', 'done', 'error']),
  label: z.string()
})
export type AiToolEvent = z.infer<typeof AiToolEventSchema>

// ai:syntax-proposal — propose_syntax tool'unun kullanıcı onayına sunduğu
// veri-değiştirici syntax (COMPUTE, RECODE, ...). Main asla kendisi
// çalıştırmaz; Renderer'daki onay kartı ✓ ile runSpssSyntax'ı tetikler.
//
// propose_r_code aynı kartı kullanır (language 'r'): R kodu ASLA çalıştırılmaz,
// kart yalnız R betik editörüne gönderir — kullanıcı orada kendisi çalıştırır
// (CLAUDE.md §9 AI kuralları, 2026-10-18).
export const AiSyntaxProposalSchema = z.object({
  turnId: z.string(),
  proposalId: z.string(),
  syntax: z.string(),
  description: z.string().optional(),
  /** 'spss' when absent. */
  language: z.enum(['spss', 'r']).optional()
})
export type AiSyntaxProposal = z.infer<typeof AiSyntaxProposalSchema>

// ai:turn-trace — bir agent round'unun tool trafiği (assistant tool_calls +
// role:'tool' sonuçları, sonuçlar context-budget.ts ile kısaltılmış hâlde).
// API durumsuz olduğu için bu mesajlar Renderer'da asistan mesajına eklenip
// sonraki ai:send geçmişine geri konur; yoksa hata/iptalle kesilen bir tur
// "devam et" denince her şeyi baştan yapıyordu (2026-09-29).
export const AiTurnTraceSchema = z.object({
  turnId: z.string(),
  messages: z.array(ChatMessageSchema)
})
export type AiTurnTrace = z.infer<typeof AiTurnTraceSchema>

// ─── Sohbet geçmişi kalıcılığı (.sdf içine ai-chat.json, 2026-09-26) ─────────
// Kullanıcı isteğiyle sohbet artık projeyle birlikte kaydediliyor — önceden
// "session-only" idi (chat-store.ts başlığı). Yalnız okunabilir içerik
// (id/role/content/createdAt; 2026-09-29 itibarıyla modele dönen tool
// trafiği `trace` de) tutulur: tool kartları, propose_syntax onay
// kartları ve hata durumları kasıtlı olarak DIŞARIDA — bunlar bir tur'a
// (turnId) bağlı geçici UI durumu, dosya yeniden açıldığında anlamsız/
// tehlikeli olurdu (örn. "pending" bir COMPUTE önerisi farklı bir veri
// setinde yanlışlıkla çalıştırılabilirdi). chat-store.ts bu şemayı
// AiChatEntry'den türetir (toPersistedChat/fromPersistedChat).
export const AiChatEntrySchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.number(),
  // Asistan turunun tool trafiği (AiTurnTraceSchema) — yeniden açılan
  // projede "devam et" de kaldığı yerden sürsün diye saklanır. Yalnız
  // agregat tablolar içerir (ham satır yok, bkz. context-budget.ts).
  trace: z.array(ChatMessageSchema).optional()
})
export type PersistedAiChatEntry = z.infer<typeof AiChatEntrySchema>

// ─── F2: tool calling (§3.1, §6.3) ───────────────────────────────────────────

// Agent döngüsünün modele sunduğu tool yüzeyi — v1 sınırları (§6.3):
// serbest SQL YOK, R çalıştırma YOK (propose_r_code yalnız ÖNERİR), dosya
// yazma YOK.
export const AiToolNameSchema = z.enum([
  'get_variables',
  'get_data_profile',
  'run_analysis',
  'run_syntax',
  'propose_syntax',
  'propose_r_code'
])
export type AiToolName = z.infer<typeof AiToolNameSchema>

// OpenAI function-calling tool tanımı — `tools` istek alanına birebir girer.
// parameters: JSON Schema (shared/analysis-manifest.ts'den üretilir).
// description gönderilmez: SAI sunucusu `sai_prompt` taşıyan isteklerde
// açıklamayı kendisi ekler (talimat metni sunucuda yaşar).
export interface AiToolDefinition {
  name: AiToolName
  description?: string
  parameters: Record<string, unknown>
}

// `sai_prompt` istek alanı — talimat metni yerine gönderilen yapılandırılmış
// bağlam. Sistem prompt'unu SAI sunucusu bundan kurar (sunucu tarafı:
// src/prompts/schema.ts; sürüm ya da alan değişikliği iki tarafta birlikte
// yapılır). İçerik CLAUDE.md §9'un izin verdiği veridir: metadata, agrega,
// AnalysisResult tabloları — ham satır yok.
export interface AiSaiPrompt {
  version: 1
  kind: 'agent' | 'interpret'
  language: string
  context: {
    datasets?: unknown[]
    analyses?: unknown[]
    analysisCommandNames?: string[]
    mentionBlocks?: unknown[]
  }
}

// run_analysis tool argümanları — params içeriği manifest şemasıyla ayrıca
// doğrulanır (validateManifestParams); burada yalnız zarf şekli garantilenir.
export const AiRunAnalysisArgsSchema = z.object({
  datasetId: z.string().min(1),
  analysisId: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({})
})
export type AiRunAnalysisArgs = z.infer<typeof AiRunAnalysisArgsSchema>

// run_syntax tool argümanları — serbest metin SPSS syntax'ı. Metnin kendisi
// güvenilmez model çıktısıdır ama sonrasında SADECE deterministik regex
// tabanlı parser'dan (shared/spss-syntax-analysis.ts, aynı Terminal
// sekmesinin kullandığı) geçer — R'a veya shell'e asla ulaşmaz, keyfi kod
// yürütme riski taşımaz (bkz. CLAUDE.md §9 AI kuralları).
export const AiRunSyntaxArgsSchema = z.object({
  datasetId: z.string().min(1),
  syntax: z.string().min(1).max(4000)
})
export type AiRunSyntaxArgs = z.infer<typeof AiRunSyntaxArgsSchema>

// propose_syntax tool argümanları — veri-değiştirici syntax (COMPUTE, RECODE,
// ...). Main bunu ÇALIŞTIRMAZ; ai:syntax-proposal event'i ile Renderer'daki
// onay kartına düşer, kullanıcı ✓ ile onaylarsa Renderer runSpssSyntax üzerinden
// (Terminal ile aynı deterministik parser/handler hattı) yürütür.
export const AiProposeSyntaxArgsSchema = z.object({
  syntax: z.string().min(1).max(4000),
  description: z.string().max(500).optional()
})
export type AiProposeSyntaxArgs = z.infer<typeof AiProposeSyntaxArgsSchema>

// propose_r_code tool argümanları — R terminali için kod. Main bunu
// ÇALIŞTIRMAZ ve Renderer de çalıştırmaz: kart kodu yalnız R betik editörüne
// ekler (analiz diyaloglarının "R betiğine gönder"i gibi); çalıştırmak
// kullanıcının açık eylemidir (§9 R terminali kural 2).
export const AiProposeRCodeArgsSchema = z.object({
  code: z.string().min(1).max(8000),
  description: z.string().max(500).optional()
})
export type AiProposeRCodeArgs = z.infer<typeof AiProposeRCodeArgsSchema>

// get_variables / get_data_profile tool argümanları
export const AiGetVariablesArgsSchema = z.object({
  datasetId: z.string().min(1)
})
export type AiGetVariablesArgs = z.infer<typeof AiGetVariablesArgsSchema>

// Tek değişken (colId) ya da tek çağrıda birden çok değişken (colIds).
// Toplu biçim, agent turlarını azaltmak içindir: her tur ayrı bir LLM
// round-trip'i demek ve yavaş modellerde asıl bekleme oradan geliyor
// (2026-08-14).
export const AiGetDataProfileArgsSchema = z
  .object({
    datasetId: z.string().min(1),
    colId: z
      .string()
      .regex(/^col_\d+$/)
      .optional(),
    colIds: z
      .array(z.string().regex(/^col_\d+$/))
      .min(1)
      .max(10)
      .optional()
  })
  .refine(v => v.colId !== undefined || v.colIds !== undefined, {
    message: 'Either colId or colIds must be provided'
  })
export type AiGetDataProfileArgs = z.infer<typeof AiGetDataProfileArgsSchema>

// ─── ai:interpret — OutputBlock-benzeri blok payload'ı (§5.4) ────────────────
// Blok verisi Main'de yaşamıyor (output-store Renderer'da) → Renderer blok
// JSON'unu payload olarak gönderir; result alanı AnalysisResultSchema'yı aynen
// yeniden kullanır (tek doğruluk kaynağı, ek state senkronu yok).
export const AiInterpretBlockSchema = z.object({
  analysisId: z.string(),
  titleKey: z.string(),
  timestamp: z.string(),
  datasetName: z.string(),
  result: AnalysisResultSchema
})
export type AiInterpretBlock = z.infer<typeof AiInterpretBlockSchema>

export const AiInterpretRequestSchema = z.object({
  block: AiInterpretBlockSchema,
  question: z.string().max(4000).optional()
})
export type AiInterpretRequest = z.infer<typeof AiInterpretRequestSchema>

export const AiInterpretResponseSchema = z.object({
  text: z.string()
})
export type AiInterpretResponse = z.infer<typeof AiInterpretResponseSchema>
