// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, MENU_CHANNELS } from '@shared/ipc-contracts'
import type { Variable, CustomStyles } from '@shared/data-types'
import type { FileSaveDataRequest } from '@shared/ipc-schemas'
import type {
  FileOpenResult,
  DataSliceResult,
  SplitGroupsResult,
  DataUndoResult,
  UpdateCellRequest,
  UpdateCellsRequest,
  AnalysisRunRequest,
  SettingsSetRequest,
  SettingsGetResult,
  JobProgressPayload,
  JobCompletePayload,
  JobErrorPayload,
  RStatusPayload,
  TransformResult,
  CheckPackagesResult,
  InstallPackageResult,
  InstallPackageRequest,
  RequiredSetupResult,
  RSessionStatus,
  TerminalROutputPayload,
  TerminalRStatusPayload,
  TerminalRPlotPayload,
  TerminalRTablePayload,
  TerminalRStartRequest,
  TerminalRWriteRequest,
  TerminalRRunRequest,
  TerminalRReloadRequest,
  TerminalRViewPayload,
  TerminalRHelpPayload,
  TerminalREnvPayload,
  TerminalRWdPayload,
  TerminalRCompleteResult,
  TerminalRViewRowsResult,
  TerminalRCommitPayload,
  TerminalRPackagesPayload,
  TerminalRPkgInstallResult,
  TerminalRWidgetPayload,
  TerminalRRunDonePayload,
  SystemInfoResult,
  GetChunkRequest,
  AiSendRequest,
  AiSendResult,
  AiCancelRequest,
  AiSetupInfo,
  AiStreamChunk,
  AiToolEvent,
  AiSyntaxProposal,
  AiTurnTrace,
  AiInterpretRequest,
  AiInterpretResponse,
  AiAccountRegisterRequest,
  AiAccountLoginRequest,
  AiAccountResendVerificationRequest,
  AiAccountForgotRequest,
  AiAccountChangePasswordRequest,
  AiAccountChangeEmailRequest,
  AiAccountDeleteRequest,
  AiAccountAuthResult,
  AiAccountStatus,
  AiCreditPack,
  AiCheckoutRequest,
  AiCheckoutResult,
  AiServerModel,
  AppVersionInfo,
  StartupInfo,
  UpdaterStatusPayload
} from '@shared/ipc-contracts'
import type { AiAppConfig } from '@shared/ai-types'
import type { CaseVar } from '@shared/analysis-types'

// Typed IPC bridge — Renderer never touches ipcRenderer directly
const api = {
  // ── Settings ──────────────────────────────────────────────
  settings: {
    get: (): Promise<SettingsGetResult> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (req: SettingsSetRequest): Promise<void> => ipcRenderer.invoke(IPC.SETTINGS_SET, req),
    reset: (): Promise<void> => ipcRenderer.invoke(IPC.SETTINGS_RESET)
  },

  // ── R status (pull) — closes a push/mount race, see r-bridge.ts getCurrentRStatus
  r: {
    getStatus: (): Promise<RStatusPayload> => ipcRenderer.invoke(IPC.R_GET_STATUS)
  },

  // ── Optional R packages (on-demand install) ───────────────
  rPackages: {
    check: (): Promise<CheckPackagesResult> => ipcRenderer.invoke(IPC.R_CHECK_PACKAGES),
    install: (req: InstallPackageRequest): Promise<InstallPackageResult> =>
      ipcRenderer.invoke(IPC.R_INSTALL_PACKAGE, req),
    // P0.4 — first-run welcome flow (R found? required packages present?)
    checkRequiredSetup: (): Promise<RequiredSetupResult> =>
      ipcRenderer.invoke(IPC.R_CHECK_REQUIRED_SETUP)
  },

  // ── Diagnostics (Help ▸ Report Issue, K7) ─────────────────
  diag: {
    getSystemInfo: (): Promise<SystemInfoResult> => ipcRenderer.invoke(IPC.DIAG_GET_SYSTEM_INFO),
    openLogFolder: (): Promise<void> => ipcRenderer.invoke(IPC.DIAG_OPEN_LOG_FOLDER),
    // Help ▸ Report a Bug — support@ adresine mailto taslağı açar (alıcı/konu
    // Main'de sabit; yalnız gövde taşınır).
    contactSupport: (body?: string): Promise<void> =>
      ipcRenderer.invoke(IPC.DIAG_CONTACT_SUPPORT, { body })
  },

  // ── Terminal — persistent R console (Faz T2) ──────────────
  terminal: {
    rStart: (req: TerminalRStartRequest): Promise<RSessionStatus> =>
      ipcRenderer.invoke(IPC.TERMINAL_R_START, req),
    rWrite: (req: TerminalRWriteRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.TERMINAL_R_WRITE, req),
    /** Run; terminal:r:run-done with the same runId follows when it finished. */
    rRun: (req: TerminalRRunRequest): Promise<void> => ipcRenderer.invoke(IPC.TERMINAL_R_RUN, req),
    rRestart: (req: TerminalRStartRequest): Promise<RSessionStatus> =>
      ipcRenderer.invoke(IPC.TERMINAL_R_RESTART, req),
    rKill: (): Promise<void> => ipcRenderer.invoke(IPC.TERMINAL_R_KILL, {}),
    /** Stop. On Windows this restarts R, which then loads `datasetId` as `data`. */
    // restarted: Stop could not interrupt in place and restarted R (Windows fallback).
    rInterrupt: (req: TerminalRStartRequest = {}): Promise<{ restarted: boolean }> =>
      ipcRenderer.invoke(IPC.TERMINAL_R_INTERRUPT, req),
    rReloadData: (req: TerminalRReloadRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.TERMINAL_R_RELOAD_DATA, req),
    rComplete: (req: { line: string }): Promise<TerminalRCompleteResult> =>
      ipcRenderer.invoke(IPC.TERMINAL_R_COMPLETE, req),
    rViewRows: (req: {
      viewId: string
      offset: number
      limit: number
      sortCol?: string
      sortDir?: 'asc' | 'desc'
    }): Promise<TerminalRViewRowsResult> => ipcRenderer.invoke(IPC.TERMINAL_R_VIEW_ROWS, req),
    rViewClose: (req: { viewId: string }): Promise<void> =>
      ipcRenderer.invoke(IPC.TERMINAL_R_VIEW_CLOSE, req),
    rPlotExport: (req: {
      plotId: number
      format: 'png' | 'svg' | 'pdf'
      widthCm: number
      heightCm: number
      dpi: number
    }): Promise<string | null> => ipcRenderer.invoke(IPC.TERMINAL_R_PLOT_EXPORT, req),
    rPkgsRefresh: (): Promise<void> => ipcRenderer.invoke(IPC.TERMINAL_R_PKGS_REFRESH, {}),
    // Files pane: open a listed script by name; pick a folder for setwd().
    rOpenFile: (req: { name: string }): Promise<{ filePath: string; content: string } | null> =>
      ipcRenderer.invoke(IPC.TERMINAL_R_OPEN_FILE, req),
    rChooseDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.TERMINAL_R_CHOOSE_DIR, {}),
    rPkgInstall: (req: { name: string }): Promise<TerminalRPkgInstallResult> =>
      ipcRenderer.invoke(IPC.TERMINAL_R_PKG_INSTALL, req),
    rCommitResolve: (req: { commitId: string; accept: boolean }): Promise<FileOpenResult | null> =>
      ipcRenderer.invoke(IPC.TERMINAL_R_COMMIT_RESOLVE, req)
  },

  // Host OS — lets the UI tailor install guidance (binary vs source build)
  platform: process.platform,
  // Unpackaged E2E run (main.ts additionalArguments) — skips per-user carry-over.
  isE2E: process.argv.includes('--sai-e2e'),

  // ── File ──────────────────────────────────────────────────
  file: {
    chooseModelExportPath: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.FILE_MODEL_EXPORT_PATH),
    getPathForFile: (file: File): string => {
      const filePath = webUtils.getPathForFile(file)
      // Main only trusts paths it saw come from a real user file (drop/pick).
      if (filePath) void ipcRenderer.invoke(IPC.FILE_APPROVE_PATH, filePath)
      return filePath
    },
    new: (): Promise<FileOpenResult> => ipcRenderer.invoke(IPC.FILE_NEW),
    open: (filePath?: string): Promise<FileOpenResult | null> =>
      ipcRenderer.invoke(IPC.FILE_OPEN, filePath),
    saveData: (req: FileSaveDataRequest): Promise<string | null> =>
      ipcRenderer.invoke(IPC.FILE_SAVE_DATA, req),
    saveDataAs: (req: FileSaveDataRequest): Promise<string | null> =>
      ipcRenderer.invoke(IPC.FILE_SAVE_DATA_AS, req),
    saveOutputHtml: (req: { html: string; defaultName: string }): Promise<string | null> =>
      ipcRenderer.invoke(IPC.FILE_SAVE_OUTPUT, req),
    exportOutputPdf: (req: { html: string; defaultName: string }): Promise<string | null> =>
      ipcRenderer.invoke(IPC.FILE_EXPORT_OUTPUT_PDF, req),
    exportOutputText: (req: {
      content: string
      defaultName: string
      filterName: string
      extensions: string[]
    }): Promise<string | null> => ipcRenderer.invoke(IPC.FILE_EXPORT_OUTPUT_TEXT, req),
    exportOutputBinary: (req: {
      data: Uint8Array
      defaultName: string
      filterName: string
      extensions: string[]
    }): Promise<string | null> => ipcRenderer.invoke(IPC.FILE_EXPORT_OUTPUT_BINARY, req),
    openSyntax: (req?: {
      kind?: 'spss' | 'r'
    }): Promise<{ filePath: string; content: string } | null> =>
      ipcRenderer.invoke(IPC.FILE_OPEN_SYNTAX, req ?? {}),
    // `filePath`: save in place if it is a file the user picked this session.
    saveSyntax: (req: {
      filePath?: string
      content: string
      defaultName: string
      kind?: 'spss' | 'r'
    }): Promise<string | null> => ipcRenderer.invoke(IPC.FILE_SAVE_SYNTAX, req),
    import: (req?: {
      filePath?: string
      fileType?: 'csv' | 'excel' | 'spss' | 'stata' | 'sas'
      options?: { delimiter?: string; header?: boolean; encoding?: string }
    }): Promise<FileOpenResult | null> => ipcRenderer.invoke(IPC.FILE_IMPORT, req),
    exportCsv: (req: { datasetId: string; filePath?: string }): Promise<string | null> =>
      ipcRenderer.invoke(IPC.FILE_EXPORT_CSV, req),
    exportXlsx: (req: { datasetId: string; filePath?: string }): Promise<string | null> =>
      ipcRenderer.invoke(IPC.FILE_EXPORT_XLSX, req),
    exportSav: (req: { datasetId: string; filePath?: string }): Promise<string | null> =>
      ipcRenderer.invoke(IPC.FILE_EXPORT_SAV, req)
  },

  // ── Data ──────────────────────────────────────────────────
  data: {
    getAll: (req: { datasetId: string }): Promise<DataSliceResult> =>
      ipcRenderer.invoke(IPC.DATA_GET_ALL, req),
    getChunk: (req: GetChunkRequest): Promise<DataSliceResult> =>
      ipcRenderer.invoke(IPC.DATA_GET_CHUNK, req),
    getFiltered: (req: {
      datasetId: string
      columnFilters: Record<string, { operator: string; value: string }>
    }): Promise<DataSliceResult> => ipcRenderer.invoke(IPC.DATA_GET_FILTERED, req),
    getSplitGroups: (req: {
      datasetId: string
      columnFilters: Record<string, { operator: string; value: string }>
      splitColId: string
    }): Promise<SplitGroupsResult> => ipcRenderer.invoke(IPC.DATA_GET_SPLIT_GROUPS, req),
    setWeight: (req: { datasetId: string; colId: string | null }): Promise<void> =>
      ipcRenderer.invoke(IPC.DATA_SET_WEIGHT, req),
    setSplit: (req: { datasetId: string; colId: string | null }): Promise<void> =>
      ipcRenderer.invoke(IPC.DATA_SET_SPLIT, req),
    setColumnFilters: (req: {
      datasetId: string
      columnFilters: Record<string, { operator: string; value: string }>
    }): Promise<void> => ipcRenderer.invoke(IPC.DATA_SET_COLUMN_FILTERS, req),
    releaseDataset: (req: { datasetId: string }): Promise<void> =>
      ipcRenderer.invoke(IPC.DATA_RELEASE_DATASET, req),
    setCustomStyles: (req: {
      datasetId: string
      customStyles: CustomStyles | null
    }): Promise<void> => ipcRenderer.invoke(IPC.DATA_SET_CUSTOM_STYLES, req),
    updateCell: (req: UpdateCellRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.DATA_UPDATE_CELL, req),
    updateCells: (req: UpdateCellsRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.DATA_UPDATE_CELLS, req),
    insertRow: (req: { datasetId: string; rowIndex: number }): Promise<void> =>
      ipcRenderer.invoke(IPC.DATA_INSERT_ROW, req),
    appendRows: (req: { datasetId: string; count: number }): Promise<void> =>
      ipcRenderer.invoke(IPC.DATA_APPEND_ROWS, req),
    deleteRows: (req: { datasetId: string; rowIndices: number[] }): Promise<void> =>
      ipcRenderer.invoke(IPC.DATA_DELETE_ROWS, req),
    reorderRows: (req: { datasetId: string; rowIndices: number[] }): Promise<void> =>
      ipcRenderer.invoke(IPC.DATA_REORDER_ROWS, req),
    insertColumn: (req: {
      datasetId: string
      variable: Variable
      index?: number
    }): Promise<Variable[]> => ipcRenderer.invoke(IPC.DATA_INSERT_COLUMN, req),
    deleteColumn: (req: { datasetId: string; colId: string }): Promise<void> =>
      ipcRenderer.invoke(IPC.DATA_DELETE_COLUMN, req),
    sort: (req: { datasetId: string; colId: string; direction: 'asc' | 'desc' }): Promise<void> =>
      ipcRenderer.invoke(IPC.DATA_SORT, req),
    sortMulti: (req: {
      datasetId: string
      keys: { colId: string; direction: 'asc' | 'desc' }[]
    }): Promise<void> => ipcRenderer.invoke(IPC.DATA_SORT_MULTI, req),
    identifyDuplicates: (req: {
      datasetId: string
      matchColIds: string[]
      primaryName: string
      primaryLabel?: string
      sequenceName: string
      sequenceLabel?: string
    }): Promise<TransformResult> => ipcRenderer.invoke(IPC.DATA_IDENTIFY_DUPLICATES, req),
    // Aggregate/Transpose create a NEW dataset (FileOpenResult) — the active
    // dataset is untouched; the renderer opens the result like an import.
    aggregate: (req: {
      datasetId: string
      breakColIds: string[]
      aggregates: {
        colId: string
        fn: 'mean' | 'sum' | 'n' | 'sd' | 'min' | 'max' | 'median' | 'first' | 'last'
        targetName: string
      }[]
    }): Promise<FileOpenResult> => ipcRenderer.invoke(IPC.DATA_AGGREGATE, req),
    transpose: (req: { datasetId: string; nameColId: string | null }): Promise<FileOpenResult> =>
      ipcRenderer.invoke(IPC.DATA_TRANSPOSE, req),
    // Merge Files — `datasetIdB` must already be loaded via file.import().
    mergeAddCases: (req: { datasetIdA: string; datasetIdB: string }): Promise<FileOpenResult> =>
      ipcRenderer.invoke(IPC.DATA_MERGE_ADD_CASES, req),
    mergeAddVariables: (req: {
      datasetIdA: string
      datasetIdB: string
      keyColIdA: string
      keyColIdB: string
    }): Promise<FileOpenResult> => ipcRenderer.invoke(IPC.DATA_MERGE_ADD_VARIABLES, req),
    restructureWideToLong: (req: {
      datasetId: string
      idColIds: string[]
      valueColIds: string[]
      indexName: string
      valueName: string
    }): Promise<FileOpenResult> => ipcRenderer.invoke(IPC.DATA_RESTRUCTURE_WIDE_TO_LONG, req),
    // Structural undo/redo (insert/delete row/col, sort, reorder, var metadata).
    undo: (req: { datasetId: string }): Promise<DataUndoResult> =>
      ipcRenderer.invoke(IPC.DATA_UNDO, req),
    redo: (req: { datasetId: string }): Promise<DataUndoResult> =>
      ipcRenderer.invoke(IPC.DATA_REDO, req)
  },

  // ── Variables ─────────────────────────────────────────────
  variable: {
    getAll: (req: { datasetId: string }): Promise<Variable[]> =>
      ipcRenderer.invoke(IPC.VARIABLE_GET_ALL, req),
    update: (req: {
      datasetId: string
      colId: string
      updates: Partial<Variable>
    }): Promise<void> => ipcRenderer.invoke(IPC.VARIABLE_UPDATE, req),
    add: (req: { datasetId: string; variable: Variable; index?: number }): Promise<Variable[]> =>
      ipcRenderer.invoke(IPC.VARIABLE_ADD, req),
    delete: (req: { datasetId: string; colId: string }): Promise<void> =>
      ipcRenderer.invoke(IPC.VARIABLE_DELETE, req),
    deleteMany: (req: { datasetId: string; colIds: string[] }): Promise<void> =>
      ipcRenderer.invoke(IPC.VARIABLE_DELETE_MANY, req),
    reorder: (req: { datasetId: string; colIds: string[] }): Promise<void> =>
      ipcRenderer.invoke(IPC.VARIABLE_REORDER, req)
  },

  // ── Clipboard (main-process, native — see clipboard-handler.ts) ──────────
  clipboard: {
    readHtml: (): Promise<string> => ipcRenderer.invoke(IPC.CLIPBOARD_READ_HTML)
  },

  // ── App lifecycle / unsaved-changes guard ─────────────────
  app: {
    // Shows the native "unsaved changes" prompt. 0=Save, 1=Discard, 2=Cancel.
    confirmUnsaved: (): Promise<number> => ipcRenderer.invoke(IPC.DIALOG_CONFIRM_UNSAVED),
    // Called by the renderer once its save pipeline finishes, to close the window.
    quitAfterSave: (): Promise<void> => ipcRenderer.invoke(IPC.APP_QUIT_AFTER_SAVE),
    // Tells Main whether the Output tab has unexported results, for the
    // window-close guard (P0.2 — output was previously lost silently on close).
    setOutputDirty: (dirty: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.APP_SET_OUTPUT_DIRTY, { dirty }),
    // Yeni sürüm bildirimi (StatusBar) — sunucuya ulaşılamazsa updateAvailable:false.
    getVersionInfo: (): Promise<AppVersionInfo> => ipcRenderer.invoke(IPC.APP_GET_VERSION_INFO),
    getStartupInfo: (recentFiles: string[]): Promise<StartupInfo> =>
      ipcRenderer.invoke(IPC.APP_GET_STARTUP_INFO, { recentFiles }),
    // URL Renderer'dan gitmez — Main kendi bildiği downloadUrl'i açar (bkz. ipc-contracts.ts).
    openDownloadPage: (): Promise<void> => ipcRenderer.invoke(IPC.APP_OPEN_DOWNLOAD_PAGE),
    // electron-updater indirmeyi bitirdiğinde (Windows) — pencereyi kapatır,
    // mevcut kaydedilmemiş-veri guard'ı devrede kalır (updater-handler.ts).
    restartToInstall: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_RESTART_TO_INSTALL),
    // Preferences ▸ Update — manuel kontrol / kullanıcı-tetikli indirme
    // (autoDownload kapalı, bkz. updater-handler.ts).
    checkForUpdates: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_CHECK),
    downloadUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_DOWNLOAD),
    getUpdaterStatus: (): Promise<UpdaterStatusPayload | null> =>
      ipcRenderer.invoke(IPC.UPDATER_GET_STATUS)
  },

  // ── Transform ─────────────────────────────────────────────
  transform: {
    recode: (req: {
      datasetId: string
      sourceColId: string
      targetColId: string | null
      targetName?: string
      targetLabel?: string
      mappings: Array<{ oldValue: string; newValue: string | null }>
      rangeMappings?: Array<{ low: number | null; high: number | null; newValue: string | null }>
      sysmisValue?: string | null
      elseValue: string | null
      elseSysmis?: boolean
      outputType: 'string' | 'numeric'
    }): Promise<TransformResult> => ipcRenderer.invoke(IPC.TRANSFORM_RECODE, req),

    autoRecode: (req: {
      datasetId: string
      sourceColId: string
      targetName: string
      targetLabel?: string
      order: 'ascending' | 'descending'
    }): Promise<TransformResult> => ipcRenderer.invoke(IPC.TRANSFORM_AUTO_RECODE, req),

    countValues: (req: {
      datasetId: string
      sourceColIds: string[]
      targetName: string
      targetLabel?: string
      matchValue: string
    }): Promise<TransformResult> => ipcRenderer.invoke(IPC.TRANSFORM_COUNT_VALUES, req),

    rankCases: (req: {
      datasetId: string
      sourceColId: string
      targetName: string
      targetLabel?: string
      order: 'ascending' | 'descending'
      method: 'rank' | 'dense_rank' | 'percent_rank'
    }): Promise<TransformResult> => ipcRenderer.invoke(IPC.TRANSFORM_RANK_CASES, req),

    visualBinning: (req: {
      datasetId: string
      sourceColId: string
      targetName: string
      targetLabel?: string
      method: 'equalWidth' | 'equalCount' | 'manual'
      bins?: number
      cutPoints?: number[]
    }): Promise<TransformResult> => ipcRenderer.invoke(IPC.TRANSFORM_VISUAL_BINNING, req),

    shiftValues: (req: {
      datasetId: string
      sourceColId: string
      targetName: string
      targetLabel?: string
      direction: 'lag' | 'lead'
      n: number
    }): Promise<TransformResult> => ipcRenderer.invoke(IPC.TRANSFORM_SHIFT_VALUES, req),

    replaceMissing: (req: {
      datasetId: string
      colId: string
      method: 'mean' | 'median' | 'mode' | 'value'
      value?: string
    }): Promise<void> => ipcRenderer.invoke(IPC.TRANSFORM_REPLACE_MISSING, req),

    // An analysis's case-level output as new dataset columns. Nothing is
    // written to disk — see case-var-handlers.ts.
    createVariables: (req: { datasetId: string; variables: CaseVar[] }): Promise<TransformResult> =>
      ipcRenderer.invoke(IPC.TRANSFORM_CREATE_VARIABLES, req)
  },

  // ── Analysis ──────────────────────────────────────────────
  analysis: {
    run: (req: AnalysisRunRequest): Promise<{ jobId: string }> =>
      // returns { jobId }
      ipcRenderer.invoke(IPC.ANALYSIS_RUN, req),
    cancel: (jobId: string): Promise<void> => ipcRenderer.invoke(IPC.ANALYSIS_CANCEL, { jobId })
  },

  // ── AI (Faz F0) — LLM trafiği yalnız Main'de; Renderer asla ─
  //    sağlayıcıya doğrudan HTTP çağrısı yapmaz, API anahtarını görmez.
  ai: {
    send: (req: AiSendRequest): Promise<AiSendResult> => ipcRenderer.invoke(IPC.AI_SEND, req),
    cancel: (req: AiCancelRequest): Promise<void> => ipcRenderer.invoke(IPC.AI_CANCEL, req),
    interpret: (req: AiInterpretRequest): Promise<AiInterpretResponse> =>
      ipcRenderer.invoke(IPC.AI_INTERPRET, req),
    getSetup: (): Promise<AiSetupInfo> => ipcRenderer.invoke(IPC.AI_GET_SETUP),
    // 'server' provider — SAI hesabı (bizim kotamız). Şifre/oturum token'ı
    // Renderer'a asla dönmez, yalnız { ok, error? } / hesap durumu döner.
    account: {
      register: (req: AiAccountRegisterRequest): Promise<AiAccountAuthResult> =>
        ipcRenderer.invoke(IPC.AI_ACCOUNT_REGISTER, req),
      login: (req: AiAccountLoginRequest): Promise<AiAccountAuthResult> =>
        ipcRenderer.invoke(IPC.AI_ACCOUNT_LOGIN, req),
      // Doğrulama e-postasını yeniden gönderir. Oturum gerektirmez (kayıt
      // oturum açmıyor); sonuç hesabın varlığını ele vermez — hesap yoksa da
      // { ok: true } döner, gerçek gönderim kararı sunucuda kalır.
      resendVerification: (req: AiAccountResendVerificationRequest): Promise<AiAccountAuthResult> =>
        ipcRenderer.invoke(IPC.AI_ACCOUNT_RESEND_VERIFICATION, req),
      // Şifremi unuttum — oturumsuz; sunucu enumeration-dirençli.
      forgotPassword: (req: AiAccountForgotRequest): Promise<AiAccountAuthResult> =>
        ipcRenderer.invoke(IPC.AI_ACCOUNT_FORGOT, req),
      // Aşağıdakiler oturum gerektirir (Main token'ı safeStorage'dan okur).
      // change-password başarıda yeni token çiftini Main saklar.
      changePassword: (req: AiAccountChangePasswordRequest): Promise<AiAccountAuthResult> =>
        ipcRenderer.invoke(IPC.AI_ACCOUNT_CHANGE_PASSWORD, req),
      changeEmail: (req: AiAccountChangeEmailRequest): Promise<AiAccountAuthResult> =>
        ipcRenderer.invoke(IPC.AI_ACCOUNT_CHANGE_EMAIL, req),
      deleteAccount: (req: AiAccountDeleteRequest): Promise<AiAccountAuthResult> =>
        ipcRenderer.invoke(IPC.AI_ACCOUNT_DELETE, req),
      // Sistem tarayıcısında Google onay ekranını açar, loopback redirect'i
      // Main bekler — bu çağrı tarayıcı akışı bitene kadar (ya da 5dk timeout)
      // pending kalır.
      // Hesap silme öncesi: Google'la yeniden doğrulama (aynı hesap şart).
      reauthGoogleForDelete: (): Promise<AiAccountAuthResult> =>
        ipcRenderer.invoke(IPC.AI_ACCOUNT_DELETE_REAUTH_GOOGLE),
      googleLogin: (): Promise<AiAccountAuthResult> =>
        ipcRenderer.invoke(IPC.AI_ACCOUNT_GOOGLE_LOGIN),
      logout: (): Promise<boolean> => ipcRenderer.invoke(IPC.AI_ACCOUNT_LOGOUT),
      status: (): Promise<AiAccountStatus> => ipcRenderer.invoke(IPC.AI_ACCOUNT_STATUS),
      // Kimlik girişi ayrı bir pencerede (main.ts openLoginWindow) — bu yalnız
      // o pencereyi açar/odaklar, sonucu döndürmez (kapanınca ai:account:changed
      // push'u ile öğrenilir, bkz. `on.aiAccountChanged`).
      openLoginWindow: (): Promise<void> => ipcRenderer.invoke(IPC.AI_ACCOUNT_OPEN_LOGIN_WINDOW),
      // Kredi paketleri ($10/$20/$50, server/src/routes/billing.ts). checkout()
      // Lemon Squeezy checkout URL'ini Main içinde shell.openExternal ile
      // varsayılan tarayıcıda açar (ödeme sayfası Electron içinde render
      // edilmez) — Renderer'a yalnız { ok, error? } döner, URL'i kendisi açmaz.
      packs: (): Promise<AiCreditPack[]> => ipcRenderer.invoke(IPC.AI_ACCOUNT_PACKS),
      checkout: (req: AiCheckoutRequest): Promise<AiCheckoutResult> =>
        ipcRenderer.invoke(IPC.AI_ACCOUNT_CHECKOUT, req)
    },
    // Canlı model kataloğu (server/src/routes/models.ts GET /v1/models) —
    // sabit AI_SERVER_MODEL_CATALOG'un yerini aldı (2026-08-05). Ağ yoksa
    // boş dizi döner.
    models: (): Promise<AiServerModel[]> => ipcRenderer.invoke(IPC.AI_MODELS),
    // Sunucudan yönetilen konfigürasyon (server/src/routes/config.ts GET
    // /app/config): varsayılan model. Ağ yoksa null — çağıran taraf
    // shared/ai-types.ts'teki gömülü fallback sabite düşer.
    appConfig: (): Promise<AiAppConfig | null> => ipcRenderer.invoke(IPC.AI_APP_CONFIG)
  },

  // ── Push events (Main → Renderer) ─────────────────────────
  on: {
    datasetModified: (cb: (payload: { datasetId: string; modified: boolean }) => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        payload: { datasetId: string; modified: boolean }
      ) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.DATA_MODIFIED_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.DATA_MODIFIED_CHANGED, handler)
    },
    jobProgress: (cb: (payload: JobProgressPayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: JobProgressPayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.JOB_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC.JOB_PROGRESS, handler)
    },
    jobComplete: (cb: (payload: JobCompletePayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: JobCompletePayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.JOB_COMPLETE, handler)
      return () => ipcRenderer.removeListener(IPC.JOB_COMPLETE, handler)
    },
    jobError: (cb: (payload: JobErrorPayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: JobErrorPayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.JOB_ERROR, handler)
      return () => ipcRenderer.removeListener(IPC.JOB_ERROR, handler)
    },
    rStatus: (cb: (payload: RStatusPayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: RStatusPayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.R_STATUS, handler)
      return () => ipcRenderer.removeListener(IPC.R_STATUS, handler)
    },
    aiStreamChunk: (cb: (payload: AiStreamChunk) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: AiStreamChunk) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.AI_STREAM_CHUNK, handler)
      return () => ipcRenderer.removeListener(IPC.AI_STREAM_CHUNK, handler)
    },
    aiToolEvent: (cb: (payload: AiToolEvent) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: AiToolEvent) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.AI_TOOL_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.AI_TOOL_EVENT, handler)
    },
    aiSyntaxProposal: (cb: (payload: AiSyntaxProposal) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: AiSyntaxProposal) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.AI_SYNTAX_PROPOSAL, handler)
      return () => ipcRenderer.removeListener(IPC.AI_SYNTAX_PROPOSAL, handler)
    },
    aiTurnTrace: (cb: (payload: AiTurnTrace) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: AiTurnTrace) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.AI_TURN_TRACE, handler)
      return () => ipcRenderer.removeListener(IPC.AI_TURN_TRACE, handler)
    },
    // Ayrı giriş penceresi kapanınca (başarılı ya da değil) main bunu gönderir
    // — Preferences açıksa accountStatus'ü tazelemek için.
    aiAccountChanged: (cb: () => void) => {
      const handler = () => {
        cb()
      }
      ipcRenderer.on(IPC.AI_ACCOUNT_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.AI_ACCOUNT_CHANGED, handler)
    },
    terminalROutput: (cb: (payload: TerminalROutputPayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: TerminalROutputPayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.TERMINAL_R_OUTPUT, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_R_OUTPUT, handler)
    },
    terminalRStatus: (cb: (payload: TerminalRStatusPayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: TerminalRStatusPayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.TERMINAL_R_STATUS, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_R_STATUS, handler)
    },
    terminalRPlot: (cb: (payload: TerminalRPlotPayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: TerminalRPlotPayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.TERMINAL_R_PLOT, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_R_PLOT, handler)
    },
    terminalRTable: (cb: (payload: TerminalRTablePayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: TerminalRTablePayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.TERMINAL_R_TABLE, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_R_TABLE, handler)
    },
    terminalRView: (cb: (payload: TerminalRViewPayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: TerminalRViewPayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.TERMINAL_R_VIEW, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_R_VIEW, handler)
    },
    terminalRHelp: (cb: (payload: TerminalRHelpPayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: TerminalRHelpPayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.TERMINAL_R_HELP, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_R_HELP, handler)
    },
    terminalRRunDone: (cb: (payload: TerminalRRunDonePayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: TerminalRRunDonePayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.TERMINAL_R_RUN_DONE, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_R_RUN_DONE, handler)
    },
    terminalRWidget: (cb: (payload: TerminalRWidgetPayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: TerminalRWidgetPayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.TERMINAL_R_WIDGET, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_R_WIDGET, handler)
    },
    terminalRPackages: (cb: (payload: TerminalRPackagesPayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: TerminalRPackagesPayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.TERMINAL_R_PKGS, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_R_PKGS, handler)
    },
    terminalRCommit: (cb: (payload: TerminalRCommitPayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: TerminalRCommitPayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.TERMINAL_R_COMMIT, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_R_COMMIT, handler)
    },
    terminalREnv: (cb: (payload: TerminalREnvPayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: TerminalREnvPayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.TERMINAL_R_ENV, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_R_ENV, handler)
    },
    terminalRWd: (cb: (payload: TerminalRWdPayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: TerminalRWdPayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.TERMINAL_R_WD, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_R_WD, handler)
    },
    updaterStatus: (cb: (payload: UpdaterStatusPayload) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: UpdaterStatusPayload) => {
        cb(payload)
      }
      ipcRenderer.on(IPC.UPDATER_STATUS, handler)
      return () => ipcRenderer.removeListener(IPC.UPDATER_STATUS, handler)
    },
    saveAndQuit: (cb: () => void) => {
      const handler = (): void => {
        cb()
      }
      ipcRenderer.on(IPC.APP_SAVE_AND_QUIT, handler)
      return () => ipcRenderer.removeListener(IPC.APP_SAVE_AND_QUIT, handler)
    },
    menuCommand: (cb: (channel: string, ...args: unknown[]) => void) => {
      const handlers = MENU_CHANNELS.map(channel => {
        const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
          cb(channel, ...args)
        }
        ipcRenderer.on(channel, handler)
        return { channel, handler }
      })
      return () => {
        handlers.forEach(({ channel, handler }) => ipcRenderer.removeListener(channel, handler))
      }
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export { api }

// Type declaration so Renderer (src/) knows the shape
declare global {
  interface Window {
    api: typeof api
  }
}
