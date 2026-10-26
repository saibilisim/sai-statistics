// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod'
import { SUPPORTED_LANGUAGES } from './languages'
import { AI_SERVER_DEFAULT_MODEL } from './ai-types'

export const AppTheme = z.enum(['light', 'dark', 'high-contrast', 'system'])
export type AppTheme = z.infer<typeof AppTheme>

export const AppLanguage = z.enum(SUPPORTED_LANGUAGES)
export type AppLanguage = z.infer<typeof AppLanguage>

// Eski sürümler/elle düzenleme ',' ve '.' yazmış olabilir — sessizce eşle
// (aksi halde tüm settings.json varsayılana düşüyordu).
const DecimalMark = z.preprocess(
  v => (v === ',' ? 'comma' : v === '.' ? 'dot' : v),
  z.enum(['dot', 'comma'])
)

export const SettingsSchema = z
  .object({
    appearance: z
      .object({
        theme: AppTheme.default('system'),
        fontSize: z.number().int().min(10).max(20).default(13),
        language: AppLanguage.default('en')
      })
      .prefault({}),
    editor: z
      .object({
        // thousandSeparator/showGridLines/showRowNumbers used to live here
        // too. They were rendered in Preferences (or never even that) and
        // stored, but nothing ever read them — controls the user could
        // change with no effect anywhere (grid lines are already a plain
        // View toggle in ui-store, not a persisted preference; row numbers
        // were never actually hideable at all). Removed 2026-08-24 rather
        // than wired, per that same audit — don't re-add without wiring a
        // real reader first.
        missingValue: z.number().default(-99),
        /** Decimal mark for numeric cells in Data View. Default comma —
         *  SPSS and spreadsheets (Excel/Sheets under a European/Turkish
         *  locale) both show "," for the raw data grid; dot is offered for
         *  whoever wants it. Independent of output.decimalSeparator (that
         *  one governs analysis RESULT tables, deliberately dot-default for
         *  journal-submission reasons — see its own comment); the two may
         *  legitimately disagree. Display only — never changes the stored
         *  value, DuckDB, or import/export. */
        decimalSeparator: DecimalMark.default('comma')
      })
      .prefault({}),
    // Import-time inference (electron/ipc/file-handler/type-inference.ts).
    // Settings rather than constants because all three are judgement calls a
    // user may legitimately disagree with on their own data. Preferences UI
    // added 2026-08-24 (Preferences ▸ Data Import).
    dataImport: z
      .object({
        /** SPSS's "measurement level for unknown" threshold: an all-integer
         *  numeric column with at most this many distinct values is imported
         *  as Nominal instead of Scale. 0 restores the old behaviour, where
         *  everything numeric became Scale. */
        categoricalMaxDistinct: z.number().int().min(0).max(1000).default(24),
        /** Recognise Turkish/European number notation ("3,14", "1.234,56") on
         *  import. Off = only SQL notation counts and such columns arrive as
         *  text, which is what used to happen unconditionally. */
        detectDecimalComma: z.boolean().default(true),
        /** Read variable and value labels out of .sav/.dta files via R's
         *  `foreign` package. Costs one extra read of the file at import. */
        readStatLabels: z.boolean().default(true)
      })
      .prefault({}),
    output: z
      .object({
        significanceLevel: z.number().min(0).max(1).default(0.05),
        tableStyle: z.enum(['compact', 'academic', 'apa']).default('academic'),
        // autoScrollToNew/chartWidth/chartHeight/highlightSignificant used to
        // live here — stored, never read anywhere (no Plotly/OutputView code
        // consulted them). Removed 2026-08-24; re-add only alongside the
        // code that actually wires them (chart sizing is a separate,
        // not-yet-scoped piece of work — not a Preferences gap).
        /** Decimal mark in output tables — display only; nothing about how a
         *  value is stored, computed or written back to the dataset depends on
         *  it. Deliberately NOT tied to the UI language: switching to Turkish
         *  should not silently reformat every table someone already produced.
         *  Default dot, changed from Preferences. */
        decimalSeparator: DecimalMark.default('dot'),
        /** Hide the leading zero on values that cannot exceed 1 — p-values and
         *  the like (".024" instead of "0.024"). The APA/SPSS convention, on
         *  by default, but a preference because house styles differ. */
        dropLeadingZero: z.boolean().default(true)
      })
      .prefault({}),
    r: z
      .object({
        // runtimePath/cranMirror/showConsoleOutput used to live here too —
        // stored, never read anywhere (runtime path resolution and CRAN
        // mirror selection are hardcoded elsewhere; showConsoleOutput had no
        // reader at all). Removed 2026-08-24; re-add only alongside the code
        // that actually wires them.
        /** R job timeout in seconds — actually enforced (job-manager.ts,
         *  ai-bridge/job-bridge.ts), unlike its removed siblings above. */
        timeout: z.number().int().min(10).max(3600).default(120),
        // CLAUDE.md §9 R-console exception rule 1: must be opt-out-able for
        // restricted/enterprise deployments. Default true (power-user
        // feature, on by default) — main-process r-session.ts enforces this
        // even without a dedicated Preferences UI, since settings.json is
        // intentionally user-editable (CLAUDE.md §3 "Ayarlar" format).
        consoleEnabled: z.boolean().default(true)
      })
      .prefault({}),
    recentFiles: z.array(z.string()).max(20).default([]),
    // Açılış karşılama penceresi (WelcomeDialog, 2026-09-29). Pencerenin
    // "Bir daha gösterme" kutusu ve Preferences ▸ Genel bu bayrağı yazar.
    startup: z
      .object({
        showWelcome: z.boolean().default(true)
      })
      .prefault({}),
    // AI entegrasyonu (Faz F0, ai-entegrasyon-fizibilitesi.md §4).
    // Oturum token'ı BURAYA GİRMEZ (§6.1) — safeStorage + userData/ai-session.bin.
    ai: z
      .object({
        // 'off' her zaman mevcut. 'server': SAI hesabıyla giriş ZORUNLU, bizim
        // sunucumuz (server/) üzerinden deneme kredisi + satın alınan kredi
        // bakiyesiyle çalışır — oturum token'ı safeStorage'da tutulur
        // (ai-bridge/credentials.ts). Kaldırılmış eski değerler ('free-default':
        // OpenRouter'ın login'siz :free modeli; 'byok': kendi API anahtarı,
        // 2026-10-16'da kaldırıldı) preprocess ile sessizce 'server'a taşınır —
        // aksi halde readSettings() zod parse hatasında TÜM settings.json'u
        // (tema/dil/kısayollar dahil) varsayılana düşürürdü (settings-handler.ts).
        provider: z
          .preprocess(
            v => (v === 'free-default' || v === 'byok' ? 'server' : v),
            z.enum(['server', 'off'])
          )
          .default('server'),
        // Varsayılan: server model kataloğunun ilk (kotalı) modeli.
        model: z.string().default(AI_SERVER_DEFAULT_MODEL),
        // İlk-aktivasyon veri-paylaşım onayı (§4/§5.1) — onay diyaloğu Renderer'da
        // (AiConsentDialog) açılır; ayrıca ai-bridge.ts'de Main-side guard olarak
        // da zorunlu tutulur (requireConsent, denetim #1: yalnız renderer-state'e
        // güvenmek trust-boundary'yi atlanabilir kılıyordu).
        consentGiven: z.boolean().default(false),
        // Agent turlarında OpenAI-uyumlu `reasoning_effort` alanı (AIPanel'deki
        // düşünme seçici, 2026-08-25). 'off' alanı hiç göndermez — reasoning'i
        // ZORUNLU kılan modellerle (örn. google/gemini-3.7-flash) çakışmaz.
        // Ücretlendirme ayrı bir mantık gerektirmez: reasoning token'ları
        // upstream'de completion_tokens'a dahil gelir, mevcut kullanım-bazlı
        // faturalama (sai-ai-server costCredits) bunu otomatik yansıtır.
        reasoningEffort: z.enum(['off', 'low', 'medium', 'high']).default('off')
      })
      .prefault({}),
    // Kullanıcı özelleştirmesi — id → accelerator override (shared/shortcuts.ts
    // DEFAULT_SHORTCUTS'ın üstüne biner). Boş string = "varsayılana dön"
    // (settings:set tek-seviye path setter'ında per-key silme yok, bkz. o dosya).
    shortcuts: z.record(z.string(), z.string()).default({}),
    // Preferences ▸ Update (2026-09-26) — StatusBar'daki "yeni sürüm" bildirimi
    // artık indirmeyi TETİKLEMEZ (bkz. updater-handler.ts autoDownload:false);
    // tıklama Preferences'a yönlendirir, kullanıcı orada "Güncelle"/"Bir daha
    // gösterme" seçer. dismissedVersion bir sürüm numarasıdır — StatusBar o
    // sürüm için sessiz kalır, yeni bir sürüm çıkınca (değer değişince) bildirim
    // otomatik geri döner.
    update: z
      .object({
        dismissedVersion: z.string().nullable().default(null),
        // false → no version query at startup / in the status bar (privacy
        // opt-out); the user can still update manually.
        autoCheck: z.boolean().default(true)
      })
      .prefault({}),
    ribbon: z
      .object({
        // Buton id'leri (yeur: Ribbon buton tanımındaki `id` ile eşleşir).
        hidden: z.array(z.string()).default([]),
        // Kullanıcı tanımlı sıralama: id dizisi. Eksik id'ler varsayılan
        // sıraya göre otomatik eklenir (yeni butonlar için forward-compat).
        order: z.array(z.string()).default([]),
        // İki satırlı düzen (overflow alanı artar).
        twoRows: z.boolean().default(false)
      })
      .prefault({})
  })
  .prefault({})

export type AppSettings = z.infer<typeof SettingsSchema>

/**
 * settings.json'u tek bir geçersiz alan yüzünden tümden çöpe atmadan çözer:
 * şemaya uymayan alanı siler (varsayılana döner), geçerli alanları (dil, tema…)
 * korur. Main'deki her okuyucu (menü, diyalog, renderer'a giden settings:get)
 * aynı sonucu görsün diye tek kaynak.
 */
export function parseSettingsTolerant(raw: unknown): AppSettings {
  const data: unknown = raw !== null && typeof raw === 'object' ? structuredClone(raw) : {}
  for (let i = 0; i < 50; i++) {
    const result = SettingsSchema.safeParse(data)
    if (result.success) return result.data
    let removed = false
    for (const issue of result.error.issues) {
      const path = issue.path
      if (path.length === 0) continue
      let parent: unknown = data
      for (const key of path.slice(0, -1)) {
        parent = (parent as Record<PropertyKey, unknown> | undefined)?.[key]
      }
      const last = path[path.length - 1]
      if (last === undefined) continue
      if (parent !== null && typeof parent === 'object' && last in parent) {
        Reflect.deleteProperty(parent, last)
        removed = true
      }
    }
    if (!removed) break
  }
  return SettingsSchema.parse({})
}
