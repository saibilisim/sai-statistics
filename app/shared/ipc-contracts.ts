// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { AppSettings } from './settings-types'
import type { Variable, Dataset, CellValue, CustomStyles } from './data-types'
import type { AnalysisResult } from './analysis-types'
import type { PersistedAiChatEntry } from './ai-types'
import type { OutputDocument } from './output-document'

// Request payload TYPES (validation schemas live in ipc-schemas.ts — Main-only,
// so importing channel names here never pulls zod into the preload bundle).
export type {
  DatasetIdRequest,
  UpdateCellRequest,
  UpdateCellsRequest,
  InsertRowRequest,
  AppendRowsRequest,
  RowIndicesRequest,
  InsertColumnRequest,
  ColIdRequest,
  SortRequest,
  SortMultiRequest,
  IdentifyDuplicatesRequest,
  VariableUpdateRequest,
  VariableReorderRequest,
  GetFilteredRequest,
  GetSplitGroupsRequest,
  RecodeRequest,
  AutoRecodeRequest,
  CountValuesRequest,
  RankCasesRequest,
  VisualBinningRequest,
  ShiftValuesRequest,
  ReplaceMissingRequest,
  InstallPackageRequest,
  GetChunkRequest,
  AiSendRequest,
  AiCancelRequest,
  AiAccountRegisterRequest,
  AiAccountLoginRequest,
  AiAccountResendVerificationRequest,
  AiAccountForgotRequest,
  AiAccountChangePasswordRequest,
  AiAccountChangeEmailRequest,
  AiAccountDeleteRequest,
  AiCheckoutRequest
} from './ipc-schemas'

// AI tipleri (Faz F0) — yalnız tip re-export'u; runtime zod ai-types'ta kalır,
// preload bundle'ına zod girmemesi için (bkz. ipc-schemas.ts başlık yorumu).
export type {
  ChatRole,
  ToolCall,
  ChatMessage,
  AiProviderConfig,
  AiSetupInfo,
  AiStreamChunk,
  AiToolEvent,
  AiSyntaxProposal,
  AiTurnTrace,
  AiInterpretBlock,
  AiInterpretRequest,
  AiInterpretResponse,
  AiAccountStatus,
  AiAccountAuthResult,
  AiAccountErrorCode,
  AiCreditPack,
  AiCheckoutResult,
  AiServerModel
} from './ai-types'

// ─────────────────────────────────────────────────────────
//  IPC Channel names — never use raw strings, always import
// ─────────────────────────────────────────────────────────

export const IPC = {
  // File
  FILE_NEW: 'file:new',
  FILE_OPEN: 'file:open',
  FILE_SAVE_DATA: 'file:save-data',
  FILE_SAVE_DATA_AS: 'file:save-data-as',
  FILE_SAVE_OUTPUT: 'file:save-output',
  FILE_EXPORT_OUTPUT_PDF: 'file:export-output-pdf',
  // Generic "write this text to a user-chosen file" — backs the Export
  // Output dialog's Word/Excel/CSV/Markdown formats (all just text content
  // with a format-specific extension; no per-format handler needed).
  FILE_EXPORT_OUTPUT_TEXT: 'file:export-output-text',
  // Same, for formats the renderer builds as bytes (native .docx/.xlsx).
  FILE_EXPORT_OUTPUT_BINARY: 'file:export-output-binary',
  FILE_OPEN_SYNTAX: 'file:open-syntax',
  FILE_SAVE_SYNTAX: 'file:save-syntax',
  FILE_IMPORT: 'file:import',
  FILE_MODEL_EXPORT_PATH: 'file:model-export-path',
  FILE_EXPORT_CSV: 'file:export-csv',
  FILE_EXPORT_XLSX: 'file:export-xlsx',
  FILE_EXPORT_SAV: 'file:export-sav',
  FILE_APPROVE_PATH: 'file:approve-path',

  // Data (DuckDB)
  // DataView loads the full dataset via a series of these (chunked-load-
  // roadmap.md C1) rather than one data:get-all round trip, so the Renderer's
  // structured-clone deserialization never blocks the UI thread for more than
  // one chunk's worth of time. data:get-all itself is kept — e2e/measure-perf
  // scripts and the analysis layer's own one-shot reads still use it.
  DATA_GET_ALL: 'data:get-all',
  DATA_GET_CHUNK: 'data:get-chunk',
  // Filtered read for the analysis layer — applies the active column filter
  // (Select Cases) as a SQL WHERE so statistics run on the selected cases only.
  DATA_GET_FILTERED: 'data:get-filtered',
  // Distinct values of the Split File variable (respecting the active filter),
  // so the analysis runner can run a procedure once per group.
  DATA_GET_SPLIT_GROUPS: 'data:get-split-groups',
  DATA_UPDATE_CELL: 'data:update-cell',
  DATA_UPDATE_CELLS: 'data:update-cells',
  DATA_INSERT_ROW: 'data:insert-row',
  // Bulk append (paste growth): N empty rows in one round trip / one undo
  // snapshot, instead of N separate data:insert-row calls each bumping
  // dataVersion (which would trigger N full DataView reloads).
  DATA_APPEND_ROWS: 'data:append-rows',
  DATA_DELETE_ROWS: 'data:delete-rows',
  DATA_REORDER_ROWS: 'data:reorder-rows',
  DATA_INSERT_COLUMN: 'data:insert-column',
  DATA_DELETE_COLUMN: 'data:delete-column',
  DATA_SORT: 'data:sort',
  // Sort Cases (Data menu): multi-key ORDER BY, one direction per key.
  DATA_SORT_MULTI: 'data:sort-multi',
  // Identify Duplicate Cases (Data menu): flags cases whose values match on
  // a chosen set of "matching" variables, adding a 0/1 indicator variable.
  DATA_IDENTIFY_DUPLICATES: 'data:identify-duplicates',
  // Aggregate (Data menu): break-variable groups + summary functions → a new
  // dataset (one row per group). Returns FileOpenResult, same shape as
  // file:import — the renderer opens the result as the new active dataset.
  DATA_AGGREGATE: 'data:aggregate',
  // Transpose (Data menu): rows ↔ variables → a new dataset.
  DATA_TRANSPOSE: 'data:transpose',
  // Merge Files (Data menu): both take an already-imported second dataset id
  // (loaded via file:import) and produce a new merged dataset.
  DATA_MERGE_ADD_CASES: 'data:merge-add-cases',
  DATA_MERGE_ADD_VARIABLES: 'data:merge-add-variables',
  // Restructure (Data menu): wide→long, a new dataset.
  DATA_RESTRUCTURE_WIDE_TO_LONG: 'data:restructure-wide-to-long',
  DATA_UNDO: 'data:undo',
  DATA_REDO: 'data:redo',
  // Weight Cases (W1) — main-process source of truth for the active weight
  // variable, so analysis-handler can inject it into every analysis:run
  // without every dialog needing to know about it.
  DATA_SET_WEIGHT: 'data:set-weight',
  // Split File (B2) — same choke-point pattern as DATA_SET_WEIGHT.
  DATA_SET_SPLIT: 'data:set-split',
  // Column Filters (SELECT IF / Data View grid) — same choke-point pattern:
  // mirrors the Renderer's active filters into Main so AI-triggered analyses
  // (run_analysis/run_syntax) can honor them too, not just GUI dialogs that
  // pass columnFilters explicitly (destek talebi 2026-09-04).
  DATA_SET_COLUMN_FILTERS: 'data:set-column-filters',
  // Renderer replaced the active dataset (New/Open/Import/Aggregate/…): drop
  // the old one's DuckDB table, undo snapshots and registry entries — without
  // it every replaced dataset stayed in memory and kept counting as "unsaved"
  // for the close guard and the crash-recovery checkpoint.
  DATA_RELEASE_DATASET: 'data:release-dataset',
  // Renderer → Main mirror of cell formats/formulas (crash recovery + dirty flag).
  DATA_SET_CUSTOM_STYLES: 'data:set-custom-styles',
  // Main → Renderer push: the dataset's dirty flag changed (see state.ts).
  DATA_MODIFIED_CHANGED: 'data:modified-changed',

  // Variables
  VARIABLE_GET_ALL: 'variable:get-all',
  VARIABLE_UPDATE: 'variable:update',
  VARIABLE_ADD: 'variable:add',
  VARIABLE_DELETE: 'variable:delete',
  // Multi-select delete (Variable View): one undo snapshot for N variables.
  VARIABLE_DELETE_MANY: 'variable:delete-many',
  VARIABLE_REORDER: 'variable:reorder',

  // Analysis
  ANALYSIS_RUN: 'analysis:run',
  ANALYSIS_CANCEL: 'analysis:cancel',

  // Pull-based current R status (closes a push/mount race — see r-bridge.ts getCurrentRStatus)
  R_GET_STATUS: 'r:get-status',
  // Optional R packages (on-demand install into the user's R library)
  R_CHECK_PACKAGES: 'r:check-packages',
  R_INSTALL_PACKAGE: 'r:install-package',
  // P0.4 — first-run setup check (R found? required packages present?)
  R_CHECK_REQUIRED_SETUP: 'r:check-required-setup',

  // Diagnostics (Help ▸ Report Issue, K7) — system info for bug reports +
  // opening the electron-log folder. No user data ever crosses this boundary
  // (P6: log transport already scrubs cell values), only paths/versions.
  DIAG_GET_SYSTEM_INFO: 'diag:get-system-info',
  DIAG_OPEN_LOG_FOLDER: 'diag:open-log-folder',
  // Help ▸ Report a Bug — varsayılan e-posta istemcisinde support@ adresine bir
  // taslak açar. Alıcı + konu Main'de SABİT (renderer'dan gelmez → başlık
  // enjeksiyonu yok); yalnız gövde (sistem bilgisi + kullanıcı metni) taşınır,
  // o da encodeURIComponent ile kaçışlanır. shell.openExternal('mailto:…').
  DIAG_CONTACT_SUPPORT: 'diag:contact-support',

  // Transform
  TRANSFORM_RECODE: 'transform:recode',
  TRANSFORM_REPLACE_MISSING: 'transform:replace-missing',
  TRANSFORM_AUTO_RECODE: 'transform:auto-recode',
  TRANSFORM_COUNT_VALUES: 'transform:count-values',
  TRANSFORM_RANK_CASES: 'transform:rank-cases',
  TRANSFORM_VISUAL_BINNING: 'transform:visual-binning',
  TRANSFORM_SHIFT_VALUES: 'transform:shift-values',
  // Turns an analysis's case-level output (AnalysisResult.caseVars) into new
  // dataset columns. Deliberately a transform:* channel and not an analysis:*
  // one — it mutates the dataset exactly like the transforms above (undoable,
  // nothing written to disk), and grouping it here keeps the write path a
  // single family rather than opening a second one under analysis.
  TRANSFORM_CREATE_VARIABLES: 'transform:create-variables',

  // Terminal — persistent R console (Faz T2). Separate lane from the analysis
  // job-manager; see terminal.md §12–13.
  TERMINAL_R_START: 'terminal:r:start',
  TERMINAL_R_WRITE: 'terminal:r:write',
  // Same as write, tagged: terminal:r:run-done {runId} follows once the command
  // finished (report runner, Faz T3 P2).
  TERMINAL_R_RUN: 'terminal:r:run',
  TERMINAL_R_RESTART: 'terminal:r:restart',
  TERMINAL_R_KILL: 'terminal:r:kill',
  TERMINAL_R_INTERRUPT: 'terminal:r:interrupt',
  TERMINAL_R_RELOAD_DATA: 'terminal:r:reload-data',
  // Faz T3 — IDE conveniences: completion (answered only while idle), the
  // View() grid (rows are paged out of a DuckDB temp table) and closing it.
  TERMINAL_R_COMPLETE: 'terminal:r:complete',
  TERMINAL_R_VIEW_ROWS: 'terminal:r:view-rows',
  TERMINAL_R_VIEW_CLOSE: 'terminal:r:view-close',
  // sai_commit(): accept (import as the new dataset) or drop a pending commit.
  TERMINAL_R_COMMIT_RESOLVE: 'terminal:r:commit-resolve',
  // Redraw a captured plot at a chosen size/format into a user-picked file.
  TERMINAL_R_PLOT_EXPORT: 'terminal:r:plot-export',
  // Packages pane: list (answered via terminal:r:pkgs) and install.
  TERMINAL_R_PKGS_REFRESH: 'terminal:r:pkgs-refresh',
  TERMINAL_R_PKG_INSTALL: 'terminal:r:pkg-install',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_RESET: 'settings:reset',

  // AI (Faz F0, ai-entegrasyon-fizibilitesi.md §7) — LLM ile konuşan tek yer
  // Main; Renderer asla sağlayıcıya HTTP çağrısı yapmaz (CSP dokunulmaz).
  AI_SEND: 'ai:send',
  AI_STREAM_CHUNK: 'ai:stream-chunk', // Main → Renderer push
  AI_TOOL_EVENT: 'ai:tool-event', // Main → Renderer push (F2; F0 üretmez)
  AI_SYNTAX_PROPOSAL: 'ai:syntax-proposal', // Main → Renderer push (propose_syntax onay kartı)
  AI_TURN_TRACE: 'ai:turn-trace', // Main → Renderer push (round'un tool trafiği, geçmişe geri döner)
  AI_CANCEL: 'ai:cancel',
  AI_INTERPRET: 'ai:interpret',
  AI_GET_SETUP: 'ai:get-setup',

  // 'server' provider — SAI hesabı (bizim kotamız, server/ ayrı repo).
  // Oturum token'ı safeStorage'da; geri okuyan kanal yok, yalnız
  // ai:account:status email/plan döner.
  AI_ACCOUNT_REGISTER: 'ai:account:register',
  AI_ACCOUNT_LOGIN: 'ai:account:login',
  // Doğrulama e-postasını yeniden gönder (2026-08-15) — kayıt artık oturum
  // AÇMADIĞI için kullanıcı "mail gelmedi" durumunda token'sızdır; bu yüzden
  // uç oturum istemez, yalnız e-posta alır ve sunucuda sıkı rate-limit'lidir.
  AI_ACCOUNT_RESEND_VERIFICATION: 'ai:account:resend-verification',
  // Tam auth (2026-08-15). forgot oturumsuz (kullanıcı zaten giremiyor);
  // change-password/change-email/delete oturum gerektirir (Main token'ı
  // safeStorage'dan okur). change-password başarıda yeni token çifti saklar.
  AI_ACCOUNT_FORGOT: 'ai:account:forgot',
  AI_ACCOUNT_CHANGE_PASSWORD: 'ai:account:change-password',
  AI_ACCOUNT_CHANGE_EMAIL: 'ai:account:change-email',
  AI_ACCOUNT_DELETE: 'ai:account:delete',
  // Sistem tarayıcısı + loopback redirect (RFC 8252) ile Google OAuth — payload
  // yok, tüm akış (loopback server + kod değişimi) Main içinde kalır; sonuç
  // login/register ile aynı AiAccountAuthResult şeklini döner.
  AI_ACCOUNT_GOOGLE_LOGIN: 'ai:account:google-login',
  AI_ACCOUNT_DELETE_REAUTH_GOOGLE: 'ai:account:delete-reauth-google',
  AI_ACCOUNT_LOGOUT: 'ai:account:logout',
  AI_ACCOUNT_STATUS: 'ai:account:status',
  // Kimlik girişi artık Preferences içine gömülü değil — ayrı, küçük bir
  // BrowserWindow (main.ts openLoginWindow) açar; o pencere register/login
  // başarılı olunca kendini kapatır, main de bu push'u mainWindow'a yollar
  // (Preferences açıksa accountStatus'ü tazeler).
  AI_ACCOUNT_OPEN_LOGIN_WINDOW: 'ai:account:open-login-window',
  AI_ACCOUNT_CHANGED: 'ai:account:changed', // Main → Renderer push
  // Kredi paketleri (free kota bittiğinde) — server/src/routes/billing.ts.
  // Checkout URL'i Electron içinde render edilmez, shell.openExternal ile
  // varsayılan tarayıcıda açılır (ödeme sayfası hiçbir zaman renderer'da değil).
  AI_ACCOUNT_PACKS: 'ai:account:packs',
  AI_ACCOUNT_CHECKOUT: 'ai:account:checkout',
  // Canlı model kataloğu (2026-08-05) — server/src/routes/models.ts GET
  // /v1/models'ı Main'de proxy'ler (public, oturum gerektirmez). Ağ yoksa/
  // sunucuya ulaşılamıyorsa boş dizi döner — Renderer bunu "AI çevrimdışı"
  // mesajı olarak gösterir, sabit bir yedek listeye düşmez (server provider
  // zaten internet gerektiriyor, offline fallback anlamsız).
  AI_MODELS: 'ai:models',
  // Sunucudan yönetilen uygulama konfigürasyonu (2026-08-05) —
  // server/src/routes/config.ts GET /app/config'i Main'de proxy'ler (public,
  // oturum gerektirmez): varsayılan model. Ağ yoksa null döner; çağıran
  // taraf shared/ai-types.ts'teki gömülü fallback sabite
  // (AI_SERVER_DEFAULT_MODEL) düşer.
  AI_APP_CONFIG: 'ai:app-config',

  // Reads the OS clipboard's HTML flavor via Electron's native `clipboard`
  // module (main process) — NOT the renderer's `navigator.clipboard.read()`,
  // whose Chromium/Electron implementation does not reliably surface the
  // `text/html` type for a clipboard entry written by an external app
  // (Excel/LibreOffice/Sheets), even though the OS clipboard genuinely has
  // it. Used by DataView paste to also transfer cell color/font.
  CLIPBOARD_READ_HTML: 'clipboard:read-html',

  // App lifecycle / unsaved-changes guard
  DIALOG_CONFIRM_UNSAVED: 'dialog:confirm-unsaved',
  APP_QUIT_AFTER_SAVE: 'app:quit-after-save',
  APP_SAVE_AND_QUIT: 'app:save-and-quit',
  APP_SET_OUTPUT_DIRTY: 'app:set-output-dirty',
  // Karşılama penceresi (2026-09-29): bu açılışta pencere gösterilmeli mi
  // (dosyaya çift tıklama / kurtarma kopyası varsa hayır), son dosyaların
  // diskte hâlâ olup olmadığı ve paketle gelen örnek veri dosyaları.
  APP_GET_STARTUP_INFO: 'app:get-startup-info',
  // Yeni sürüm bildirimi (2026-08-05) — sai-ai-server'daki GET /app/version'ı
  // Main'de proxy'ler (StatusBar'daki tıklanabilir segment). Sunucuya
  // ulaşılamazsa updateAvailable:false döner, hata fırlatmaz (sessiz atlanır).
  APP_GET_VERSION_INFO: 'app:get-version-info',
  // İndirme sayfasını varsayılan tarayıcıda açar — URL Renderer'dan gelmez,
  // Main'de app:get-version-info sırasında zaten sunucudan doğrulanmış
  // downloadUrl'i kendi belleğinde tutup açar (checkout akışıyla aynı desen:
  // shell.openExternal'a hiçbir zaman Renderer-kontrollü bir URL girmez).
  APP_OPEN_DOWNLOAD_PAGE: 'app:open-download-page',
  // electron-updater (Windows only for now — bkz. electron-builder.json win.publish).
  // Renderer, indirilmiş güncellemeyi kurmak için pencereyi kapatmayı ister;
  // mevcut 'close' guard'ı (kaydedilmemiş veri/Output uyarısı) aynen devrede
  // kalır — updater güvenlik kontrolünü kendi başına atlamaz (bkz. updater-handler.ts).
  UPDATER_RESTART_TO_INSTALL: 'updater:restart-to-install',
  // Preferences ▸ Update — manuel kontrol / indirme tetikleyicileri (autoDownload
  // artık kapalı, bkz. updater-handler.ts). GET_STATUS, dialog geç açılırsa
  // (StatusBar'ın kaçırdığı) son bilinen durumu senkron döndürür.
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_GET_STATUS: 'updater:get-status',

  // Main → Renderer (one-way push events)
  JOB_PROGRESS: 'job:progress',
  JOB_COMPLETE: 'job:complete',
  JOB_ERROR: 'job:error',
  R_STATUS: 'r:status',
  TERMINAL_R_OUTPUT: 'terminal:r:output',
  TERMINAL_R_STATUS: 'terminal:r:status',
  TERMINAL_R_PLOT: 'terminal:r:plot',
  TERMINAL_R_TABLE: 'terminal:r:table',
  TERMINAL_R_VIEW: 'terminal:r:view',
  TERMINAL_R_HELP: 'terminal:r:help',
  TERMINAL_R_ENV: 'terminal:r:env',
  // Files pane: working directory + listing (push), open a listed script,
  // pick a folder for setwd().
  TERMINAL_R_WD: 'terminal:r:wd',
  TERMINAL_R_OPEN_FILE: 'terminal:r:open-file',
  TERMINAL_R_CHOOSE_DIR: 'terminal:r:choose-dir',
  TERMINAL_R_COMMIT: 'terminal:r:commit',
  TERMINAL_R_PKGS: 'terminal:r:pkgs',
  TERMINAL_R_WIDGET: 'terminal:r:widget',
  // A terminal:r:run command finished. Pushed (not an invoke reply) so it
  // arrives after the command's own output — invoke replies and pushes are
  // not ordered against each other.
  TERMINAL_R_RUN_DONE: 'terminal:r:run-done',
  UPDATER_STATUS: 'updater:status'
} as const

// ─────────────────────────────────────────────────────────
//  Payload types per channel
// ─────────────────────────────────────────────────────────

// file:open → returns loaded dataset metadata
export interface FileOpenResult {
  dataset: Dataset
  variables: Variable[]
  styles?: CustomStyles | null
  chatHistory?: PersistedAiChatEntry[]
  /** Output sekmesi — yalnız output.json taşıyan .sdf'lerde (file:open). */
  outputDocument?: OutputDocument | null
}

// data:get-all response
export interface DataSliceResult {
  rows: CellValue[][]
  totalRows: number
  // Column order as returned by DuckDB — matches Variable[] order
  columnNames?: string[]
  /** Permanent case identity per returned row (`__case_id`), parallel to
   *  `rows`. Unlike the row's position it never changes under insert/delete/
   *  reorder/sort, so the renderer keys per-cell metadata (formats, formulas)
   *  on it. Absent for slices where it isn't needed (analysis-side reads). */
  caseIds?: number[]
}

// data:get-split-groups response — distinct split-variable values, ordered.
export interface SplitGroupsResult {
  groups: CellValue[]
}

// data:undo / data:redo — structural undo/redo result
export interface DataUndoResult {
  applied: boolean
  canUndo: boolean
  canRedo: boolean
  variables: Variable[]
  rowCount: number
}

// analysis:run
export interface AnalysisRunRequest {
  analysisId: string
  datasetId: string
  scriptFile: string
  params: Record<string, unknown>
  columnFilters?: Record<string, { operator: string; value: string }>
  /** Auto output header (variables summary) — see pending-run-meta.ts. */
  summary?: string
  /** Auto output header's collapsible syntax line — see pending-run-meta.ts. */
  syntax?: string
}

// r:check-packages response — installed status keyed by package name
export type CheckPackagesResult = Record<string, boolean>

// r:check-required-setup response (P0.4 first-run welcome flow)
export interface RequiredSetupResult {
  rFound: boolean
  rVersion?: string
  missingRequired: string[]
}

// r:install-package response
export interface InstallPackageResult {
  success: boolean
  /** R availability / install detail (logged, not necessarily user-facing) */
  detail?: string
}

// diag:get-system-info response (Help ▸ Report Issue, K7)
export interface SystemInfoResult {
  appVersion: string
  osPlatform: string
  osRelease: string
  electronVersion: string
  rStatus: RStatus
  rVersion: string | null
  logFilePath: string
}

// settings:set
export interface SettingsSetRequest {
  path: string // dot-separated: "appearance.theme"
  value: unknown
}

// job:progress push
export interface JobProgressPayload {
  jobId: string
  analysisId?: string
  percent: number
  messageKey: string
}

// job:complete push
export interface JobCompletePayload {
  jobId: string
  analysisId: string
  result: AnalysisResult
  /** Dataset the job ran on (case variables must be written back to THIS one). */
  datasetId?: string
  /**
   * Set when the job was enqueued by the AI agent (ai-bridge.ts) rather than
   * a Renderer dialog/tab. NormalityView's own job:complete listener uses
   * this to ignore AI-triggered normality runs (which may cover a different,
   * AI-chosen subset of variables) so it never silently overwrites the tab's
   * displayed result out from under the user.
   */
  source?: 'ai'
  /** Passed through from AnalysisRunRequest.summary — see pending-run-meta.ts. */
  summary?: string
  /** Passed through from AnalysisRunRequest.syntax — see pending-run-meta.ts. */
  syntax?: string
}

// job:error push
export interface JobErrorPayload {
  jobId: string
  errorKey: string
  details?: string
}

// r:status push
export type RStatus = 'starting' | 'ready' | 'not-found' | 'error'
export interface RStatusPayload {
  status: RStatus
  version?: string
}

// terminal:r:* — persistent R console (Faz T2)
/** 'debug' = R's browser() is waiting at its Browse prompt (debug(), debugonce(), browser()). */
export type RSessionStatus = 'starting' | 'idle' | 'busy' | 'debug' | 'dead'
export interface TerminalROutputPayload {
  /** R text for stdout/stderr; an i18n key (analysis namespace) for 'notice'. */
  chunk: string
  /** 'notice' = a message from SAI itself (not R) — translated in the renderer.
   *  'traceback' = the call stack of the error just printed, one call per line. */
  stream: 'stdout' | 'stderr' | 'notice' | 'traceback'
  /** Interpolation params for a 'notice' key. */
  params?: Record<string, string>
}
export interface TerminalRStatusPayload {
  status: RSessionStatus
  /** Browser nesting level (the n in "Browse[n]>") while status is 'debug'. */
  debugLevel?: number
}
export interface TerminalRPlotPayload {
  /** Base64-encoded PNG of a plot produced by the last R command. */
  png: string
  /** The session's id for the recorded plot (Export redraws it); absent if unknown. */
  plotId?: number
}
export interface TerminalRTablePayload {
  /** A data.frame promoted to Output via sai_show(). */
  columns: string[]
  rows: (string | number | null)[][]
  title?: string
}
/** A View() snapshot, loaded into a DuckDB temp table; rows are paged on demand. */
export interface TerminalRViewPayload {
  viewId: string
  title: string
  columns: { name: string; type: string }[]
  rowCount: number
}
/** A help page rendered as plain text (`?topic`, help(), F1). */
export interface TerminalRHelpPayload {
  title: string
  text: string
}
/** One object in the R session's global environment (Environment pane). */
export interface TerminalREnvItem {
  name: string
  cls: string
  kind: 'data' | 'function' | 'value'
  /** [rows, cols] for data frames / matrices. */
  dims: number[] | null
  /** R's own one-line description (`str()` / argument list) — R text, not translated. */
  desc: string
  /** Bytes (object.size). */
  size: number
}
/** Files pane: the R session's working directory and its entries. */
export interface TerminalRWdPayload {
  wd: string
  /** Entries in the folder; `files` holds at most the first 500. */
  total: number
  files: { name: string; dir: boolean; size: number }[]
}
export interface TerminalREnvPayload {
  items: TerminalREnvItem[]
  /** Set while debugging: the call whose frame `items` lists (R text, e.g. "f(2)"). */
  frame?: string
}
export interface TerminalRCompletion {
  text: string
  /** True for functions — inserted as `name()` with the caret inside. */
  fn: boolean
  /** Argument names, comma-separated (functions only). */
  args: string
}
export interface TerminalRCompleteResult {
  /** The token R completed (the tail of the line it replaces). */
  token: string
  items: TerminalRCompletion[]
}
/** terminal:r:run finished: `ok` false when the session stopped first. */
export interface TerminalRRunDonePayload {
  runId: string
  ok: boolean
}
/** An htmlwidget printed in the R console, served under sai-widget://. */
export interface TerminalRWidgetPayload {
  widgetId: string
  title: string
  url: string
}

/** One installed R package (Packages pane). */
export interface TerminalRPackage {
  name: string
  version: string
  /** Installed in the user's own library (the app's installs), not the bundled one. */
  user: boolean
  attached: boolean
}
export interface TerminalRPackagesPayload {
  items: TerminalRPackage[]
}
export interface TerminalRPkgInstallResult {
  success: boolean
  detail?: string
}

/** sai_commit(df): a data frame waiting to become the new dataset. */
export interface TerminalRCommitPayload {
  commitId: string
  name: string
  rows: number
  cols: number
}
export interface TerminalRViewRowsResult {
  rows: (string | number | boolean | null)[][]
}
export interface TerminalRStartRequest {
  datasetId?: string
}
export interface TerminalRWriteRequest {
  code: string
}
/** `runId` (the renderer's own UUID) comes back in terminal:r:run-done. */
export interface TerminalRRunRequest {
  code: string
  runId: string
}
export interface TerminalRReloadRequest {
  datasetId?: string
}

// settings:get response
export type SettingsGetResult = AppSettings

// ai:send yanıtı — agent döngüsünün turn kimliği; stream-chunk/tool-event
// payload'ları shared/ai-types.ts'den re-export ediliyor (yukarı).
export interface AiSendResult {
  turnId: string
}

// transform:* operations result — updated variable list + row count
export interface TransformResult {
  variables: Variable[]
  rowCount: number
}

// app:get-startup-info yanıtı — karşılama penceresi (WelcomeDialog).
export interface StartupInfo {
  /** true → karşılama penceresi bu açılışta gösterilmez: açılış zaten bir
   *  dosya açıyor (çift tıklama / "Birlikte aç" ya da çökme kurtarma kopyası)
   *  veya SAI_NO_WELCOME=1 (E2E koşucusu — pencere tıklamaları engellemesin). */
  skipWelcome: boolean
  /** İstekteki recentFiles ile aynı sırada: dosya diskte hâlâ var mı. */
  recentFiles: { path: string; exists: boolean }[]
  /** resources/sample-data altındaki örnek CSV'ler (ad = uzantısız dosya adı). */
  sampleFiles: { name: string; path: string }[]
}

// app:get-version-info yanıtı — sai-ai-server GET /app/version'dan.
// downloadUrl yalnız updateAvailable true iken anlamlıdır.
export interface AppVersionInfo {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  downloadUrl: string | null
  /** Flatpak kurulumu: güncellemeyi Flathub yapar, sunucuya sorulmaz. */
  externallyManaged: boolean
}

// updater:status push (Windows only) — electron-updater'ın kendi event akışının
// birebir izdüşümü. 'error' sessizce loglanır, UI'ye kritik bir hata olarak
// çıkmaz (get-version-info fallback'iyle aynı "kritik değil" duruşu).
export interface UpdaterStatusPayload {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  error?: string
}

export const MENU_CHANNELS = [
  'menu:file:new',
  'menu:file:open',
  'menu:file:save',
  'menu:file:save-as',
  'menu:file:save-output',
  'menu:file:export-output-pdf',
  'menu:file:export-output',
  'menu:file:clear-recent',
  'menu:file:import:csv',
  'menu:file:import:excel',
  'menu:file:import:spss',
  'menu:file:import:stata',
  'menu:file:import:sas',
  'menu:file:export:csv',
  'menu:file:export:excel',
  'menu:file:export:spss',
  'menu:view:tab',
  'menu:theme',
  'menu:language',
  'menu:view:value-labels',
  'menu:view:grid-lines',
  'menu:view:focus-cell',
  'menu:preferences',
  'menu:edit:toggle-shortcuts',
  'menu:edit:find',
  'menu:edit:find-replace',
  'menu:edit:undo',
  'menu:edit:redo',
  'menu:about',
  'menu:data:sort-cases',
  'menu:data:sort-variables',
  'menu:data:identify-duplicates',
  'menu:data:aggregate',
  'menu:data:transpose',
  'menu:data:merge-add-cases',
  'menu:data:merge-add-variables',
  'menu:data:restructure',
  'menu:data:define-var-props',
  'menu:data:select-cases',
  'menu:data:weight-cases',
  'menu:data:split-file',
  'menu:transform:compute',
  'menu:transform:recode-same',
  'menu:transform:recode-different',
  'menu:transform:auto-recode',
  'menu:transform:count-values',
  'menu:transform:rank-cases',
  'menu:transform:visual-binning',
  'menu:transform:shift-values',
  'menu:graphs:scatter',
  'menu:graphs:bar',
  'menu:graphs:line',
  'menu:graphs:histogram',
  'menu:graphs:boxplot',
  'menu:graphs:pp',
  'menu:graphs:qq',
  'menu:transform:replace-missing',
  'menu:analyze:descriptives',
  'menu:analyze:frequencies',
  'menu:analyze:explore',
  'menu:analyze:crosstabs',
  'menu:analyze:case-summaries',
  'menu:analyze:olap-cubes',
  'menu:analyze:report-summaries',
  'menu:analyze:report-columns',
  'menu:analyze:onesample-ttest',
  'menu:analyze:independent-ttest',
  'menu:analyze:paired-ttest',
  'menu:analyze:proportions-one',
  'menu:analyze:proportions-independent',
  'menu:analyze:proportions-paired',
  'menu:analyze:oneway-anova',
  'menu:analyze:correlate-bivariate',
  'menu:analyze:correlate-partial',
  'menu:analyze:regression-linear',
  'menu:analyze:regression-logistic',
  'menu:analyze:regression-curve',
  'menu:analyze:npar-2indep',
  'menu:analyze:npar-kindep',
  'menu:analyze:npar-2related',
  'menu:analyze:npar-krelated',
  'menu:analyze:npar-chisquare',
  'menu:analyze:npar-binomial',
  'menu:analyze:npar-runs',
  'menu:analyze:npar-ks',
  'menu:analyze:roc',
  'menu:analyze:roc-analysis',
  'menu:analyze:survival-km',
  'menu:analyze:survival-cox',
  'menu:analyze:reliability',
  'menu:analyze:means',
  'menu:analyze:glm-univariate',
  'menu:analyze:glm-multivariate',
  'menu:analyze:glm-repeated',
  'menu:analyze:factor',
  'menu:analyze:kmeans',
  'menu:analyze:hierarchical',
  'menu:analyze:discriminant',
  'menu:analyze:knn',
  'menu:analyze:tree',
  'menu:analyze:regression-multinomial',
  'menu:analyze:regression-ordinal',
  'menu:analyze:regression-probit',
  'menu:analyze:distances',
  'menu:analyze:genlin',
  'menu:analyze:mixed-models',
  'menu:analyze:mds',
  'menu:analyze:life-tables',
  'menu:analyze:ratio',
  'menu:analyze:multiple-response',
  'menu:analyze:missing-values',
  'menu:analyze:gee',
  'menu:analyze:power',
  'menu:analyze:glmm',
  'menu:analyze:mi',
  'menu:analyze:bayes-ttest-independent',
  'menu:analyze:bayes-ttest-onesample',
  'menu:analyze:bayes-ttest-paired',
  'menu:analyze:bayes-anova',
  'menu:analyze:bayes-regression',
  'menu:analyze:bayes-correlation',
  'menu:help:report-issue'
] as const

export type MenuChannel = (typeof MENU_CHANNELS)[number]
