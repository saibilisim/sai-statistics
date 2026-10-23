// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { autoUpdater, NsisUpdater } from 'electron-updater'
import { verifyInstallerSignature } from './update-signature'
import log from 'electron-log'
import { IPC } from '../../shared/ipc-contracts'
import type { UpdaterStatusPayload } from '../../shared/ipc-contracts'
import { validateSender } from './security'
import { dialogStrings } from '../i18n'

// electron-updater (Faz 9 — bkz. CLAUDE.md §2). Yalnız Windows: win.publish feed'i
// electron-builder.json'da tanımlı.
// Linux BİLİNÇLİ OLARAK HARİÇ (2026-10-14): .deb/.rpm sistem paket yöneticisinden,
// Flatpak Flathub'dan güncellenir; AppImage için ayrı feed tutulmuyor (feed bayat
// kalıp yalnız .rpm'e işaret edince AppImage kullanıcıları zaten güncelleme alamıyordu).
// macOS BİLİNÇLİ OLARAK HARİÇ: mac.identity: null (imzasız) — Gatekeeper +
// electron-updater'ın imza doğrulaması imzasız bir uygulamada auto-update'i
// güvenilir çalıştırmaz. Apple Developer Program sertifikası + notarization
// kurulunca buraya 'darwin' eklenir (mac.publish zaten hazır).
// Ayrıca yalnızca paketlenmiş derlemede: dev'de app-update.yml yok,
// autoUpdater.checkForUpdates() atar.
const UPDATER_ENABLED = process.platform === 'win32'

let mainWindow: BrowserWindow | null = null
// "Yeniden Başlat" tıklandığında true olur; asıl kurulum main.ts'teki
// window-all-closed'dan installPendingUpdateOnQuit() ile tetiklenir (aşağıya
// bak — neden autoUpdater.autoInstallOnAppQuit KULLANILMADIĞI için).
let restartOnQuitRequested = false

// Preferences ▸ Update dialog'u StatusBar'dan SONRA açılabilir ve geçmiş
// event'leri kaçırır (her ikisi de kendi `updaterStatus` listener'ını
// kuruyor, replay yok) — bu yüzden son durumu burada tutup GET_STATUS ile
// senkron olarak da veriyoruz.
let lastStatus: UpdaterStatusPayload | null = null

// Help ▸ Güncellemeleri Kontrol Et sonucunu (güncel / yeni sürüm / hata) native
// kutuyla bildirir. Yalnız menüden başlatılan kontrolde: açılıştaki otomatik
// kontrol sessiz kalır, Tercihler ▸ Güncelleme sonucu zaten kendi içinde gösterir.
let reportNextResult = false

type CheckResult =
  | { kind: 'up-to-date' }
  | { kind: 'available'; version: string }
  | { kind: 'error' }

function reportCheckResult(result: CheckResult): void {
  if (!reportNextResult) return
  reportNextResult = false
  const t = dialogStrings().updateCheck
  const current = app.getVersion()
  const fill = (text: string, version: string): string =>
    text.replace('{{version}}', version).replace('{{current}}', current)
  const show = (options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> =>
    mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options)

  if (result.kind === 'available') {
    void show({
      type: 'info',
      title: t.title,
      message: fill(t.available, result.version),
      detail: fill(t.availableDetail, result.version),
      buttons: [t.download, t.later],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) startDownload()
    })
    return
  }
  const upToDate = result.kind === 'up-to-date'
  void show({
    type: upToDate ? 'info' : 'error',
    title: t.title,
    message: upToDate ? t.upToDate : t.error,
    detail: upToDate ? fill(t.upToDateDetail, current) : t.errorDetail,
    buttons: [t.ok]
  })
}

function startDownload(): void {
  autoUpdater.downloadUpdate().catch((err: unknown) => {
    log.error('[updater] downloadUpdate failed', err)
    send({ status: 'error', error: err instanceof Error ? err.message : String(err) })
  })
}

function send(payload: UpdaterStatusPayload): void {
  lastStatus = payload
  mainWindow?.webContents.send(IPC.UPDATER_STATUS, payload)
}

/**
 * Başlatma sırasında bir kez çağrılır. Event dinleyicilerini bağlar, birkaç
 * saniye sonra ilk kontrolü tetikler ve `updater:restart-to-install` IPC
 * handler'ını kaydeder. Windows dışında / dev'de no-op.
 */
export function registerUpdaterHandlers(win: BrowserWindow): void {
  mainWindow = win

  ipcMain.handle(IPC.UPDATER_RESTART_TO_INSTALL, event => {
    validateSender(event)
    // Bir sonraki gerçek kapanışta kurulumu tetikle (main.ts'teki
    // window-all-closed → installPendingUpdateOnQuit()) — mevcut 'close'
    // guard'ı (kaydedilmemiş veri/Output uyarısı) araya girebilir, o zaman
    // hiçbir şey kapanmaz ve bu bayrak cancelPendingRestart() ile geri alınır.
    restartOnQuitRequested = true
    mainWindow?.close()
  })

  // Preferences ▸ Update dialog'u geç açılırsa StatusBar'ın zaten aldığı
  // event'i kaçırmasın diye son bilinen durumu senkron döndürür.
  ipcMain.handle(IPC.UPDATER_GET_STATUS, event => {
    validateSender(event)
    return lastStatus
  })

  // "Kontrol Et" düğmesi (Preferences ▸ Update) — menüdeki Help ▸ Güncellemeleri
  // Kontrol Et ile aynı fonksiyonu çağırır.
  ipcMain.handle(IPC.UPDATER_CHECK, event => {
    validateSender(event)
    checkForUpdatesManually()
  })

  // "Güncelle" düğmesi — indirmeyi burada, kullanıcının açık isteğiyle başlatır
  // (aşağıdaki autoDownload:false nedeniyle 'update-available' kendi başına
  // indirmeyi tetiklemez).
  ipcMain.handle(IPC.UPDATER_DOWNLOAD, event => {
    validateSender(event)
    if (!UPDATER_ENABLED || !app.isPackaged) return
    startDownload()
  })

  if (!UPDATER_ENABLED || !app.isPackaged) return

  autoUpdater.logger = log
  // ÖNCEDEN true: 'update-available' event'i otomatik olarak indirmeyi de
  // başlatıyordu — kullanıcı StatusBar'daki "yeni sürüm" segmentine hiç
  // tıklamasa da indirme (ve kısa süre sonra "yeniden başlat" isteği) arka
  // planda gerçekleşiyordu. Artık indirme yalnız kullanıcı Preferences ▸
  // Update'te "Güncelle"ye bastığında (yukarıdaki UPDATER_DOWNLOAD handler'ı)
  // başlar; checkForUpdates() burada ve manuel kontrolde SADECE metadata
  // getirir (sürüm numarası + 'available' bildirimi), indirmez.
  autoUpdater.autoDownload = false
  // Delta (blockmap) indirme İKİ AYRI nedenle kapalı tutuluyor, ikisi de
  // canlıda ölçüldü (2026-09-24):
  // 1) Varsayılan çoklu-range istek (Range: bytes=A-B,C-D,…) Cloudflare'de
  //    multipart/byteranges yerine application/octet-stream dönüyor — kalıcı,
  //    dokümante edilmiş bir CDN kısıtı, Cloudflare tarafında düzeltilemez.
  // 2) electron-builder.json'daki win.publish.useMultipleRangeRequest:false ile
  //    bunu ardışık TEK-range isteklere çevirmek TEKNİK olarak çalışıyor (hata
  //    kayboluyor) ama pratikte kullanılamaz: 21.431 değişen blok = 21.431 ayrı
  //    HTTP isteği, her biri kendi Cloudflare+TLS gecikmesini taşıyor — 503MB'lık
  //    bir delta 10 dakikada bile bitmedi (aynı ağda tam 1.2GB indirme ~30
  //    saniyede tamamlanıyor). VS Code'un Windows updater'ı da tam bu nedenle
  //    NSIS blockmap-diff kullanmıyor; tek kesintisiz akışla tam paket indirip
  //    hızı CDN'den alıyor — burada da aynı yaklaşımı izliyoruz.
  autoUpdater.disableDifferentialDownload = true
  // Encoding-proof installer signature check (update-signature.ts): the
  // built-in one compared our Turkish certificate name against a mangled copy
  // and rejected every update on Turkish Windows.
  if (autoUpdater instanceof NsisUpdater) {
    autoUpdater.verifyUpdateCodeSignature = async (names, file) => {
      const problem = await verifyInstallerSignature(names, file)
      log.info(
        `[updater] installer signature ${problem === null ? 'accepted' : `rejected: ${problem}`}`
      )
      return problem
    }
  }

  autoUpdater.on('checking-for-update', () => {
    send({ status: 'checking' })
  })
  autoUpdater.on('update-available', info => {
    send({ status: 'available', version: info.version })
    reportCheckResult({ kind: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    send({ status: 'not-available' })
    reportCheckResult({ kind: 'up-to-date' })
  })
  autoUpdater.on('download-progress', progress => {
    send({ status: 'downloading', percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', info => {
    send({ status: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', err => {
    log.error('[updater] error', err)
    send({ status: 'error', error: err.message })
    reportCheckResult({ kind: 'error' })
  })

  // Açılıştan hemen sonra değil — pencere/Renderer daha ayağa kalkarken ağ
  // I/O'suyla yarışmasın diye kısa bir gecikme.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      log.error('[updater] initial checkForUpdates failed', err)
    })
  }, 5_000)
}

/**
 * main.ts'teki 'close' guard'ı kullanıcı "Kaydet/Dışa Aktar" akışını iptal
 * ederse (Cancel) çağırır — "Yeniden Başlat" tıklandığında true'ya çekilen
 * restartOnQuitRequested'i geri false'a alır. Aksi halde kapanış bu sefer
 * gerçekleşmese de bayrak açık kalır ve bir SONRAKİ sıradan çıkışta
 * (kullanıcı bir daha hiç "Yeniden Başlat" demeden) sessizce kurulum
 * tetiklenirdi — tam da kullanıcının istemediği "zorla güncelleme".
 */
export function cancelPendingRestart(): void {
  restartOnQuitRequested = false
}

/**
 * main.ts'in window-all-closed handler'ından çağrılır (yalnız win32/linux) —
 * 'close' guard'ı geçtiyse (kaydedilmemiş veri yok ya da halloldu) ve
 * kullanıcı StatusBar'daki restart segmentine bastıysa gerçek kurulumu
 * burada tetikler.
 *
 * electron-updater'ın autoInstallOnAppQuit + dahili quit-hook mekanizması
 * BİLİNÇLİ OLARAK kullanılmıyor: BaseUpdater.addQuitHandler() yalnızca
 * indirme tamamlandığı anda çağrılıyor — yani uygulama açılışında, kullanıcı
 * henüz "Yeniden Başlat"a hiç basmadan önce. O anda autoInstallOnAppQuit hâlâ
 * varsayılan false olduğundan dahili `app.once('quit', …)` hook'u hiç
 * takılmıyor (quitHandlerAdded bir daha sıfırlanmıyor); sonradan bayrağı
 * true yapmanın (restart tıklaması) hiçbir etkisi kalmıyor. Gözlemlenen hata
 * tam bu yüzdendi: pencere kapanıyor, hiçbir şey kurulmuyor, uygulama yeniden
 * açılmıyor. quitAndInstall() bu dahili hook'a bağımlı değil — install()'ı
 * doğrudan, senkron çağırır.
 * @returns true ise çağıran taraf app.quit() ÇAĞIRMAMALI — quitAndInstall
 *   kurulumu spawn ettikten sonra kendi app.quit()'ini tetikleyecek.
 */
export function installPendingUpdateOnQuit(): boolean {
  if (!restartOnQuitRequested) return false
  restartOnQuitRequested = false
  // isSilent=true: NSIS'in kendi sihirbaz UI'si atlanır (Windows'un UAC onay
  // isteği bundan bağımsız — o silinemez/atlanamaz). isForceRunAfter=true:
  // kurulum bitince uygulama otomatik yeniden açılır (VS Code/Antigravity
  // tarzı "restart to update" — kullanıcı isteği, elle yeniden açma yok).
  autoUpdater.quitAndInstall(true, true)
  return true
}

/**
 * Help ▸ Güncellemeleri Kontrol Et (menu-builder.ts, `notify: true` — sonuç
 * kutuyla bildirilir) ve Tercihler ▸ Güncelleme'deki "Kontrol Et" düğmesi.
 */
export function checkForUpdatesManually({ notify = false }: { notify?: boolean } = {}): void {
  if (!UPDATER_ENABLED || !app.isPackaged) return
  if (notify) reportNextResult = true
  autoUpdater.checkForUpdates().catch((err: unknown) => {
    log.error('[updater] manual checkForUpdates failed', err)
    reportCheckResult({ kind: 'error' })
  })
}

export { UPDATER_ENABLED }
