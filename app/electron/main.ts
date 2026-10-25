// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { app, BrowserWindow, session, shell, dialog, ipcMain } from 'electron'
import { join, dirname } from 'path'
import os from 'os'
import fs from 'fs'
import log from 'electron-log'
import { buildMenu } from './menu/menu-builder'
import { registerSettingsHandlers } from './ipc/settings-handler'
import {
  registerDbHandlers,
  hasUnsavedDatasets,
  loadedDatasets,
  datasetCustomStyles,
  setModifiedNotifier
} from './ipc/db-handler'
import { registerFileHandlers, writeDatasetSdf } from './ipc/file-handler'
import { validateSender, handleValidated, openExternalHttps } from './ipc/security'
import { approvePath } from './ipc/approved-paths'
import { dialogStrings } from './i18n'
import { IPC } from '../shared/ipc-contracts'
import type { SystemInfoResult, AppVersionInfo, StartupInfo } from '../shared/ipc-contracts'
import { AI_SERVER_BASE_URL } from '../shared/ai-types'
import {
  SetOutputDirtyRequestSchema,
  DiagContactSupportRequestSchema,
  GetStartupInfoRequestSchema,
  FileApprovePathRequestSchema
} from '../shared/ipc-schemas'
import { initRBridge, onRStatus, getCurrentRStatus, migrateUserRLibrary } from './ipc/r-bridge'
import { setJobManagerWindow } from './ipc/job-manager'
import { registerAnalysisHandlers } from './ipc/analysis-handler'
import { registerRPackagesHandlers } from './ipc/r-packages-handler'
import { registerRSessionHandlers, setRSessionWindow, killRSession } from './ipc/r-session'
import {
  registerWidgetScheme,
  registerWidgetProtocol,
  WIDGET_SCHEME,
  WIDGET_CSP
} from './ipc/r-widgets'
import { registerAiBridgeHandlers } from './ipc/ai-bridge'
import { registerClipboardHandlers } from './ipc/clipboard-handler'
import {
  registerUpdaterHandlers,
  cancelPendingRestart,
  installPendingUpdateOnQuit,
  IS_FLATPAK
} from './ipc/updater-handler'
import { seedLanguageFromSystemLocale, applyChromiumLocaleFromSettings } from './locale'

const isDev = !app.isPackaged

// electron-updater'ın büyük (~1.2GB) tam indirmeleri sırasında bu ağda
// tekrarlayan net::ERR_QUIC_PROTOCOL_ERROR / ERR_CONNECTION_RESET hataları
// gözlendi (2026-09-24 canlı testleri) — Chromium'un QUIC (HTTP/3)
// negotiasyonu Cloudflare ile bazı ağlarda kararsız. QUIC'i baştan kapatıp
// HTTP/2'ye zorlamak (çok daha olgun, TCP tabanlı, geçici ağ kesintilerine
// dayanıklı) hem güncelleme indirmelerini hem uygulamanın diğer tüm ağ
// isteklerini (AI köprüsü dahil) etkiler — app.whenReady()'den önce, tek
// seferlik bir komut satırı anahtarı.
app.commandLine.appendSwitch('disable-quic')

// Native menüdeki kısayol metinleri ("Ctrl+Virgül") OS dilinde değil uygulama
// dilinde çıksın — ayrıntı locale.ts'te; app.ready'den önce olmalı.
applyChromiumLocaleFromSettings()

// electron-builder's per-platform `icon` config only applies to packaged
// builds; in dev the Linux/Windows taskbar/title bar otherwise falls back to
// the generic Electron icon. macOS ignores BrowserWindow `icon` (uses the
// .app bundle icon instead), so this only matters on the other two platforms.
const devIconPath = join(app.getAppPath(), 'resources/icons/icon.png')

// ─── Loglama: stdout/stderr kırık bir boru olabilir (EPIPE) ─────────────────
// Paketlenmiş uygulama, kendisini başlatan sürecin stdio'sunu miras alır. O
// süreç gidince (SAI.exe'yi açıp kapanan bir terminal, Explorer'ın devrettiği
// kapalı boru), stdout'a her yazma EPIPE ile düşer. electron-log'un console
// transport'u HER log çağrısında oraya yazar; hata asenkron olarak
// uncaughtException'a çıkar ve sıradan bir `log.info()` "Unexpected Error"
// modalını açar (main.log 2026-08-23: 21 EPIPE, hepsi Logger.processMessage
// üzerinden — analiz çalıştırırken). İki katman: (1) süreç akışlarındaki EPIPE
// yutulur, (2) paketlenmiş derlemede console transport hiç kullanılmaz —
// görülecek bir konsol zaten yok, her şey dosya transport'una yazılıyor.
function ignoreBrokenPipe(stream: NodeJS.WriteStream): void {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
      log.transports.console.level = false // boru bir kez kırıldıysa kalıcıdır
      return
    }
    log.error('[main] stdio error', err)
  })
}
ignoreBrokenPipe(process.stdout)
ignoreBrokenPipe(process.stderr)
if (!isDev) log.transports.console.level = false

// ─── P0.5: open-with / double-click file association ───────────────────────
// electron-builder registers .sdf as a file association (electron-builder.json
// fileAssociations), but without this wiring double-clicking one just opened a
// blank app window — Windows/Linux relaunch the app with the path in argv,
// macOS instead fires 'open-file'. A path noted before the window/renderer is
// ready is queued and flushed once the renderer's menu listener is mounted.
// (Output results live inside the .sdf as output.json — no separate format.)
const OPENABLE_EXTENSIONS = ['.sdf']

function extractFilePathFromArgv(argv: string[]): string | undefined {
  // Skip argv[0] (the exe) and, in dev, the electron-vite entry script path.
  return argv.find(a => OPENABLE_EXTENSIONS.some(ext => a.toLowerCase().endsWith(ext)))
}

// Basit semver karşılaştırması (major.minor.patch) — dış bağımlılık gerektirmez.
function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.split('.').map(n => parseInt(n, 10) || 0)
  const b = current.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

let pendingOpenPath: string | undefined = extractFilePathFromArgv(process.argv)

// app:get-version-info'nun son bildiği indirme URL'i — app:open-download-page
// yalnız bunu açar, Renderer'ın kendi URL'i taşımasına gerek kalmaz.
let cachedDownloadUrl: string | null = null

/** Sends the pending open-with path to the renderer once it can handle it. */
function flushPendingOpen(win: BrowserWindow): void {
  if (!pendingOpenPath) return
  const filePath = pendingOpenPath
  pendingOpenPath = undefined
  setTimeout(() => {
    win.webContents.send('menu:file:open', filePath)
  }, 500)
}

// Packaged builds refuse Chromium's remote-debugging switches: launched with
// --remote-debugging-port anyone could drive the renderer (and window.api)
// over the DevTools protocol. Node's --inspect / ELECTRON_RUN_AS_NODE are
// already disabled by the Electron fuses (electron-builder.json electronFuses).
if (
  app.isPackaged &&
  ['remote-debugging-port', 'remote-debugging-pipe'].some(s => app.commandLine.hasSwitch(s))
) {
  app.exit(1)
}

// R console htmlwidgets (r-widgets.ts) — privileged schemes must be declared
// before 'ready'.
registerWidgetScheme()

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

// macOS: fired when the OS opens a registered file (double-click, "Open With").
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  pendingOpenPath = filePath
  if (mainWindow) {
    mainWindow.focus()
    flushPendingOpen(mainWindow)
  }
})

// Windows/Linux: a second launch (double-click while already running) relaunches
// with the file path in argv; the OS then routes here instead of a new process.
app.on('second-instance', (_event, argv) => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
  const filePath = extractFilePathFromArgv(argv)
  if (filePath) {
    mainWindow.webContents.send('menu:file:open', filePath)
  }
})

// P0.6: crashes previously vanished silently (no handler at all) and, since
// DuckDB is in-memory, took every unsaved edit with them. Log + tell the user
// rather than dying invisibly. Registered at module load, before app.whenReady,
// so a crash during startup is still captured.
process.on('uncaughtException', err => {
  // Kırık boru (stdout/stderr veya ölmüş bir alt sürecin stdin'i) kullanıcı
  // için bir arıza değildir — veri kaybı yok, iş akışı sürüyor. Modal açmak
  // yalnızca yanlış alarm üretir (yukarıdaki loglama notuna bakın); dosyaya
  // yazıp sessizce devam et.
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') {
    log.warn('[main] ignoring broken-pipe error', err)
    return
  }
  log.error('[main] uncaughtException', err)
  if (app.isReady()) {
    dialog.showErrorBox(
      'SAI Statistics — Unexpected Error',
      `An unexpected error occurred and has been logged. If you have unsaved work, ` +
        `SAI periodically saves a recovery copy that will be offered on next launch.\n\n${String(err)}`
    )
  }
})
process.on('unhandledRejection', reason => {
  log.error('[main] unhandledRejection', reason)
})

// Set once the user has confirmed a quit (discard or save-then-quit), so the
// close guard doesn't re-prompt when we programmatically destroy the window.
let isQuitting = false

// Whether the Output tab has changes not yet saved into the .sdf (output.json).
// Kept in Main (pushed from the renderer on every change) because the close
// guard runs synchronously in the 'close' handler and can't await a renderer query.
let outputDirty = false

/** Native "unsaved changes" prompt. Returns 0=Save, 1=Discard, 2=Cancel. */
function showUnsavedDialog(win: BrowserWindow): number {
  const t = dialogStrings().unsavedChanges
  return dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: [t.save, t.discard, t.cancel],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: t.title,
    message: t.message
  })
}

// ─── P0.6: crash-recovery autosave ──────────────────────────────────────────
// DuckDB is in-memory — a crash (or a killed process, or `kill -9` from the
// OS) loses every unsaved edit with nothing to fall back on. Periodically
// snapshot the active dataset to a recovery .sdf in userData; offer it back
// on the next launch. This is best-effort data safety, not a real save: it
// never touches dataset.filePath/isModified (writeDatasetSdf doesn't mutate).
const RECOVERY_PATH = join(app.getPath('userData'), 'recovery.sdf')
const RECOVERY_INTERVAL_MS = 5 * 60 * 1000
let recoveryTimer: NodeJS.Timeout | null = null

async function checkpointRecovery(): Promise<void> {
  // Single-dataset app: the renderer releases a dataset it replaces
  // (data:release-dataset), so this is the active one — newest first anyway,
  // in case a release is still in flight.
  for (const dataset of [...loadedDatasets.values()].reverse()) {
    if (!dataset.isModified) continue
    try {
      await writeDatasetSdf(dataset, RECOVERY_PATH, datasetCustomStyles.get(dataset.id) ?? null)
      log.info('[main] recovery checkpoint written')
    } catch (err) {
      log.warn('[main] recovery checkpoint failed', err)
    }
    return
  }
  // Nothing unsaved right now — an existing recovery file would be stale/misleading.
  deleteRecoveryFile()
}

function startRecoveryTimer(): void {
  recoveryTimer ??= setInterval(() => void checkpointRecovery(), RECOVERY_INTERVAL_MS)
}

function deleteRecoveryFile(): void {
  fs.promises.unlink(RECOVERY_PATH).catch(() => undefined)
}

/** Offers a found recovery file on startup. Returns true if the caller should open it. */
function offerRecovery(win: BrowserWindow): boolean {
  if (!fs.existsSync(RECOVERY_PATH)) return false
  const rt = dialogStrings().recovery
  const choice = dialog.showMessageBoxSync(win, {
    type: 'question',
    buttons: [rt.recover, rt.discard],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: rt.title,
    message: rt.message
  })
  if (choice === 1) {
    deleteRecoveryFile()
    return false
  }
  return true
}

// Karşılama penceresi atlanacak mı? createWindow() başında yakalanır —
// ready-to-show'da pendingOpenPath tüketilir, kurtarma dosyası da "Kaydetme"
// seçilirse silinir; renderer'ın sorusu bundan sonra gelebilir.
// SAI_NO_WELCOME=1: tests/e2e/run-e2e.cjs set eder (overlay tıklamaları kesmesin).
let skipWelcome = false

/** Paketle gelen örnek veri klasörü (electron-builder.json extraResources). */
function sampleDataDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'sample-data')
    : join(__dirname, '../../resources/sample-data')
}

function listSampleFiles(): StartupInfo['sampleFiles'] {
  const dir = sampleDataDir()
  try {
    return fs
      .readdirSync(dir)
      .filter(f => f.toLowerCase().endsWith('.csv'))
      .sort()
      .map(f => {
        const path = join(dir, f)
        approvePath(path)
        return { name: f.replace(/\.csv$/i, ''), path }
      })
  } catch (err) {
    log.warn('[main] sample-data not found', err)
    return []
  }
}

function registerAppHandlers(): void {
  handleValidated(IPC.FILE_APPROVE_PATH, FileApprovePathRequestSchema, (filePath): void => {
    approvePath(filePath)
  })
  handleValidated(
    IPC.APP_GET_STARTUP_INFO,
    GetStartupInfoRequestSchema,
    ({ recentFiles }): StartupInfo => ({
      skipWelcome,
      // The crash-recovery copy is opened through File ▸ Open too, so it can
      // land in recentFiles — it's an internal file, never a "recent" one.
      recentFiles: recentFiles
        .filter(p => p !== RECOVERY_PATH)
        .map(p => ({ path: p, exists: fs.existsSync(p) })),
      sampleFiles: listSampleFiles()
    })
  )
  // Menu New/Open/Import guard — renderer asks before replacing the dataset.
  ipcMain.handle(IPC.DIALOG_CONFIRM_UNSAVED, (event): number => {
    validateSender(event)
    return mainWindow ? showUnsavedDialog(mainWindow) : 2
  })
  // Renderer finished its save flow after a save-and-quit choice → close now.
  ipcMain.handle(IPC.APP_QUIT_AFTER_SAVE, (event): void => {
    validateSender(event)
    isQuitting = true
    mainWindow?.destroy()
  })
  handleValidated(IPC.APP_SET_OUTPUT_DIRTY, SetOutputDirtyRequestSchema, ({ dirty }): void => {
    outputDirty = dirty
  })
  // 'server' AI provider hesabı (kayıt/giriş) artık Preferences içine gömülü
  // form değil, ayrı bir pencere (openLoginWindow) — kimlik bilgisi girişini
  // Ayarlar diyaloğundan ayırmak için (2026-08-02).
  ipcMain.handle(IPC.AI_ACCOUNT_OPEN_LOGIN_WINDOW, (event): void => {
    validateSender(event)
    openLoginWindow()
  })
}

log.initialize()
log.transports.file.level = 'info'

/**
 * Content-Security-Policy. Production'da sıkı (bkz. CLAUDE.md §9); dev'de Vite HMR
 * WebSocket'i ve @vitejs/plugin-react'in inline React-Refresh preamble'ı için gevşetilir.
 * style-src 'unsafe-inline' her iki modda da gerekli (Plotly runtime stil enjekte eder).
 * font-src data: — AG Grid'in legacy CSS teması (ag-grid.css) ikon fontunu base64
 * data: URI olarak gömüyor (aggrid-gecis-roadmap.md geçişinde eklendi).
 * frame-src sai-widget: — R konsolu htmlwidget'ları, sandbox'lı iframe'de; o
 * belgelerin kendi (ayrı) CSP'si r-widgets.ts WIDGET_CSP'de.
 */
function buildCsp(): string {
  const prod = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    `frame-src ${WIDGET_SCHEME}:`
  ].join('; ')

  const dev = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws://localhost:* http://localhost:*",
    `frame-src ${WIDGET_SCHEME}:`
  ].join('; ')

  return isDev ? dev : prod
}

function applyCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Widget documents carry their own (separate) policy — never the app's.
    const csp = details.url.startsWith(`${WIDGET_SCHEME}:`) ? WIDGET_CSP : buildCsp()
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

let mainWindow: BrowserWindow | null = null

// ─── 'server' AI hesabı — ayrı giriş penceresi ──────────────────────────────
// Preferences'a gömülü email/şifre formu yerine (2026-08-02): kimlik girişi
// artık kendi küçük, modal penceresinde — LoginWindow.tsx (renderer, aynı
// index.html'i ?window=login query'siyle yükler, main.tsx bu parametreye göre
// <App/> yerine <LoginWindow/> render eder). Aynı preload/CSP/sandbox
// (§9 pazarlık edilemez) — tek fark boyut ve modal:true.
let loginWindow: BrowserWindow | null = null

function openLoginWindow(): void {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus()
    return
  }
  loginWindow = new BrowserWindow({
    width: 420,
    height: 600,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'SAI Statistics',
    ...(isDev ? { icon: devIconPath } : {}),
    ...(mainWindow ? { parent: mainWindow, modal: true } : {}),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDev
    }
  })
  loginWindow.setMenu(null)

  // Aynı navigasyon/pencere-açma kısıtları mainWindow ile (§9).
  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  loginWindow.webContents.on('will-navigate', (event, url) => {
    const isLocalDevServer = isDev && url.startsWith('http://localhost')
    if (!url.startsWith('file://') && !isLocalDevServer) {
      event.preventDefault()
    }
  })

  loginWindow.on('ready-to-show', () => {
    loginWindow?.show()
  })

  loginWindow.on('closed', () => {
    loginWindow = null
    // Koşulsuz gönderilir (başarılı login/register sonrası pencere kendini
    // kapatır) — Preferences açıksa accountStatus'ü tazeler, değilse zararsız
    // no-op.
    mainWindow?.webContents.send(IPC.AI_ACCOUNT_CHANGED)
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void loginWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?window=login`)
  } else {
    void loginWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: 'login' }
    })
  }
}

function createWindow(): void {
  skipWelcome =
    pendingOpenPath !== undefined ||
    fs.existsSync(RECOVERY_PATH) ||
    process.env['SAI_NO_WELCOME'] === '1'
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'SAI Statistics',
    ...(isDev ? { icon: devIconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDev,
      // E2E runs share one userData dir: tell the renderer so per-user
      // carry-over (restored script drafts) does not leak between scripts.
      ...(!app.isPackaged && process.env['SAI_E2E'] === '1'
        ? { additionalArguments: ['--sai-e2e'] }
        : {})
    }
  })

  // Block external navigation. Only http(s) links are handed to the OS
  // browser — file://, smb://, and other schemes are dropped rather than
  // opened, so a malicious or malformed link can't reach the local
  // filesystem or a network share via the user's default handler.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isLocalDevServer = isDev && url.startsWith('http://localhost')
    if (!url.startsWith('file://') && !isLocalDevServer) {
      event.preventDefault()
    }
  })

  // Pipe renderer logs to the terminal — DEVELOPMENT ONLY. In production the
  // listener is never attached, so renderer console output (which can contain
  // cell data, e.g. health records) never reaches the on-disk log (KVKK/GDPR).
  if (isDev) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log(
        `[RENDERER] [Level:${String(level)}] ${message} (Source: ${sourceId}:${String(line)})`
      )
    })
  }

  // Unsaved-changes guard: prevent losing edits when the window is closed.
  // The Output tab is saved inside the .sdf (output.json), so dataset edits and
  // Output changes are one "project" — a single Save/Discard/Cancel prompt.
  mainWindow.on('close', e => {
    if (isQuitting || !mainWindow) return
    if (!hasUnsavedDatasets() && !outputDirty) return
    e.preventDefault()
    const choice = showUnsavedDialog(mainWindow)
    if (choice === 2) {
      cancelPendingRestart() // Cancel — keep the window open
      return
    }
    if (choice === 1) {
      // Discard — quit without saving
      isQuitting = true
      mainWindow.destroy()
      return
    }
    // Save — let the renderer run its save pipeline (snapshot + styles +
    // output), then it calls APP_QUIT_AFTER_SAVE to actually close.
    mainWindow.webContents.send(IPC.APP_SAVE_AND_QUIT)
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (!mainWindow) return
    if (pendingOpenPath) {
      // A file was opened via double-click/"Open With" — that takes priority
      // over offering the crash-recovery copy this run.
      flushPendingOpen(mainWindow)
    } else if (offerRecovery(mainWindow)) {
      const win = mainWindow
      // Give the renderer's menu-command listener a moment to mount before
      // simulating a File ▸ Open on the recovery file (same pattern as the
      // r-session respawn delay elsewhere in this codebase).
      setTimeout(() => {
        approvePath(RECOVERY_PATH)
        win.webContents.send('menu:file:open', RECOVERY_PATH)
      }, 500)
    }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  // buildMenu()'den ve renderer'ın ilk settings:get çağrısından önce —
  // gerçek ilk kurulumda sistem diline göre kalıcı bir dil seçer (locale.ts).
  seedLanguageFromSystemLocale()
  applyCsp()
  registerWidgetProtocol()
  createWindow()
  if (mainWindow) {
    buildMenu(mainWindow)
    setJobManagerWindow(mainWindow)
    setRSessionWindow(mainWindow)
    registerAnalysisHandlers()
    registerRSessionHandlers()
    registerUpdaterHandlers(mainWindow)
  }
  registerSettingsHandlers()
  registerAiBridgeHandlers()
  registerClipboardHandlers()
  registerDbHandlers()
  setModifiedNotifier((datasetId, modified) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.DATA_MODIFIED_CHANGED, { datasetId, modified })
    }
  })
  registerFileHandlers()
  registerAppHandlers()
  registerRPackagesHandlers()
  startRecoveryTimer()

  // Detect R and forward status events to the renderer; then, in the
  // background, carry the packages the user installed over an R version change
  void initRBridge().then(migrateUserRLibrary)
  onRStatus(payload => {
    mainWindow?.webContents.send(IPC.R_STATUS, payload)
  })
  ipcMain.handle(IPC.R_GET_STATUS, event => {
    validateSender(event)
    return getCurrentRStatus()
  })

  // Diagnostics (Help ▸ Report Issue, K7) — no cell data ever crosses this
  // boundary (electron-log's own transport already never sees it, P6), only
  // versions/paths for a bug report.
  ipcMain.handle(IPC.DIAG_GET_SYSTEM_INFO, (event): SystemInfoResult => {
    validateSender(event)
    const rStatusPayload = getCurrentRStatus()
    return {
      appVersion: app.getVersion(),
      osPlatform: process.platform,
      osRelease: os.release(),
      electronVersion: process.versions.electron,
      rStatus: rStatusPayload.status,
      rVersion: rStatusPayload.version ?? null,
      logFilePath: log.transports.file.getFile().path
    }
  })
  ipcMain.handle(IPC.DIAG_OPEN_LOG_FOLDER, async (event): Promise<void> => {
    validateSender(event)
    const logFilePath = log.transports.file.getFile().path
    await shell.openPath(dirname(logFilePath))
  })
  // diag:contact-support — Help ▸ Report a Bug. Alıcı + konu BURADA sabit
  // (renderer'dan gelmez → mailto başlık enjeksiyonu imkânsız); yalnız gövde
  // renderer'dan gelir ve encodeURIComponent ile kaçışlanır. Varsayılan
  // e-posta istemcisinde destek adresine bir taslak açar (gönderim tamamen
  // kullanıcının kontrolünde — biz yalnız taslağı hazırlarız).
  // Workspace'te dev@saibilisim.com'a bağlı bir alias — gelen destek
  // mailleri o kutuya düşer.
  const SUPPORT_EMAIL = 'support@saistatistics.com'
  ipcMain.handle(IPC.DIAG_CONTACT_SUPPORT, async (event, payload: unknown): Promise<void> => {
    validateSender(event)
    const parsed = DiagContactSupportRequestSchema.safeParse(payload)
    const body = parsed.success ? (parsed.data.body ?? '') : ''
    const subject = `SAI Statistics — Bug Report (v${app.getVersion()})`
    const mailto =
      `mailto:${SUPPORT_EMAIL}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`
    await shell.openExternal(mailto)
  })

  // app:get-version-info — sai-ai-server GET /app/version'ı proxy'ler
  // (StatusBar'daki "yeni sürüm" segmenti). Sunucuya ulaşılamazsa/uç nokta
  // boşsa sessizce updateAvailable:false döner — bu bir kritik özellik değil.
  ipcMain.handle(IPC.APP_GET_VERSION_INFO, async (event): Promise<AppVersionInfo> => {
    validateSender(event)
    const currentVersion = app.getVersion()
    const fallback: AppVersionInfo = {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      downloadUrl: null,
      externallyManaged: IS_FLATPAK
    }
    // Flatpak: sunucuya hiç sorulmaz; cachedDownloadUrl boş kaldığından
    // app:open-download-page de bir şey açmaz (updater-handler.ts IS_FLATPAK).
    if (IS_FLATPAK) return fallback
    try {
      const res = await fetch(`${AI_SERVER_BASE_URL}/app/version`, {
        signal: AbortSignal.timeout(8_000)
      })
      if (!res.ok) return fallback
      const json = (await res.json()) as { latest?: string; url?: string }
      if (!json.latest) return fallback
      cachedDownloadUrl = json.url ?? null
      return {
        currentVersion,
        latestVersion: json.latest,
        updateAvailable: isNewerVersion(json.latest, currentVersion),
        downloadUrl: cachedDownloadUrl,
        externallyManaged: false
      }
    } catch {
      return fallback
    }
  })

  // app:open-download-page — cachedDownloadUrl yalnız yukarıdaki handler'ın
  // sunucudan aldığı değerdir, Renderer bir URL göndermez (bkz. ipc-contracts.ts
  // APP_OPEN_DOWNLOAD_PAGE yorumu).
  ipcMain.handle(IPC.APP_OPEN_DOWNLOAD_PAGE, (event): void => {
    validateSender(event)
    if (cachedDownloadUrl) openExternalHttps(cachedDownloadUrl)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  killRSession()
  if (recoveryTimer) clearInterval(recoveryTimer)
  // A clean quit (isQuitting is only ever set after the close-guard resolved
  // — saved, explicitly discarded, or there was nothing unsaved) means the
  // recovery copy no longer reflects "work the user might want back".
  if (!hasUnsavedDatasets()) deleteRecoveryFile()
})

app.on('window-all-closed', () => {
  killRSession()
  if (process.platform !== 'darwin') {
    // Bekleyen bir "restart to install" varsa quitAndInstall() kendi
    // app.quit()'ini tetikleyecek — burada ayrıca çağırmak kurulumu iptal
    // edip sıradan bir kapanışa döndürür.
    if (!installPendingUpdateOnQuit()) app.quit()
  }
})

export { mainWindow }
