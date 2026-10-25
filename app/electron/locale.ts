// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { app } from 'electron'
import Store from 'electron-store'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../shared/languages'
import type { AppSettings } from '../shared/settings-types'

function detectSystemLanguage(): SupportedLanguage {
  // E2E betikleri Türkçe etiketlerle yazılı (tr kaynak dil); CI runner'ı
  // en-US olduğundan sistem dili tespiti ilk açılışta 'en' yazıyordu.
  if (!app.isPackaged && process.env['SAI_E2E'] === '1') return 'tr'
  const primary = app.getLocale().split('-')[0]?.toLowerCase()
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary ?? '')
    ? (primary as SupportedLanguage)
    : 'en'
}

/**
 * Yalnız gerçek ilk kurulumda etkili olur: settings.json'da appearance.language
 * hiç yazılmamışsa (SettingsSchema'nın sabit 'tr' varsayılanı o ana kadar
 * hiçbir yere yazılmadı, sadece zod parse anında türetiliyordu — her
 * kurulumda ülkeden bağımsız hep Türkçe açılıyordu), işletim sisteminin
 * dilini (`app.getLocale()`) okuyup desteklenen 6 dilden biriyle eşleşiyorsa
 * onu, eşleşmiyorsa İngilizce'yi kalıcı olarak yazar.
 *
 * main.ts'te buildMenu()'den ve ilk settings:get çağrısından ÖNCE bir kez
 * çağrılmalı. Kullanıcı sonradan dili elle değiştirirse bu fonksiyon bir
 * daha hiç devreye girmez (store zaten dolu, erken çıkar).
 */
export function seedLanguageFromSystemLocale(): void {
  const store = new Store<AppSettings>({ name: 'settings', cwd: app.getPath('userData') })
  if (store.has('appearance.language')) return
  store.set('appearance.language', detectSystemLanguage())
}

/** UI language → Chromium locale (.pak) name. */
const CHROMIUM_LOCALE: Record<SupportedLanguage, string> = {
  tr: 'tr',
  en: 'en-US',
  es: 'es',
  fr: 'fr',
  it: 'it',
  pt: 'pt-BR'
}

/**
 * Chromium'un kendi arayüz dilini uygulamanın diline sabitler. Windows/Linux
 * native menüsündeki kısayol metni ("Ctrl+Virgül", "Strg", "Entf" …) Electron
 * tarafından değil Chromium'un dil paketinden üretiliyor ve o paket varsayılan
 * olarak İŞLETİM SİSTEMİ diline göre seçiliyor — İngilizce arayüzde Türkçe
 * "Ctrl+Virgül" görünmesinin sebebi buydu.
 *
 * `--lang` yalnız `app.ready`'den ÖNCE etkili → main.ts'in en üstünde
 * çağrılır; çalışırken dil değişince kısayol metinleri bir sonraki açılışta
 * güncellenir. Ayar henüz yazılmamışsa (ilk kurulum) dokunulmaz: Chromium OS
 * dilinde kalır ve seedLanguageFromSystemLocale()'in `app.getLocale()` ile
 * yaptığı sistem dili tespiti bozulmaz.
 */
export function applyChromiumLocaleFromSettings(): void {
  const store = new Store<AppSettings>({ name: 'settings', cwd: app.getPath('userData') })
  if (!store.has('appearance.language')) return
  const lang = store.get('appearance.language')
  const locale = CHROMIUM_LOCALE[lang] as string | undefined
  if (locale) app.commandLine.appendSwitch('lang', locale)
}
