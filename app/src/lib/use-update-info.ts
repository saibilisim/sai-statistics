// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'
import type { UpdaterStatusPayload } from '@shared/ipc-contracts'

export type UpdateStatus = UpdaterStatusPayload['status'] | 'idle'

export interface UpdateInfo {
  currentVersion: string | null
  latestVersion: string | null
  status: UpdateStatus
  percent: number | null
  error: string | null
  /** win32 paketli derlemede electron-updater indirip kurar; darwin'de (imzasız,
   *  Gatekeeper) ve linux'ta (paket yöneticisi/Flathub günceller) yalnız indirme
   *  sayfası açılabilir — bkz.
   *  updater-handler.ts UPDATER_ENABLED. */
  usesNativeUpdater: boolean
  /** Flatpak kurulumu: güncellemeyi Flathub yapar; sürüm sorgusu ve indirme
   *  sayfası yok (main.ts app:get-version-info). */
  externallyManaged: boolean
  checkNow: () => void
  download: () => void
  restart: () => void
  openDownloadPage: () => void
}

/**
 * StatusBar ve Preferences ▸ Update'in paylaştığı tek güncelleme durumu
 * kaynağı. İki ayrı sinyali birleştirir: electron-updater'ın push event'leri
 * (yalnız Windows — `updater:status` + geç açılan diyalog için senkron
 * `updater:get-status`) ve sunucu tarafından yönetilen genel sürüm bilgisi
 * (`app:get-version-info`, tüm platformlarda çalışır — macOS'ta
 * electron-updater hiç yürümediğinden tek kaynak budur). Native sinyal
 * geldiyse (Windows paketli derleme) ona öncelik verir.
 */
export function useUpdateInfo(): UpdateInfo {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)
  const [serverLatest, setServerLatest] = useState<string | null>(null)
  const [serverChecked, setServerChecked] = useState(false)
  const [externallyManaged, setExternallyManaged] = useState(false)
  const [native, setNative] = useState<UpdaterStatusPayload | null>(null)

  const refreshServerInfo = (): void => {
    void window.api.app.getVersionInfo().then(info => {
      setCurrentVersion(info.currentVersion)
      setServerLatest(info.updateAvailable ? info.latestVersion : null)
      setServerChecked(true)
      setExternallyManaged(info.externallyManaged)
    })
  }

  useEffect(() => {
    refreshServerInfo()
    void window.api.app.getUpdaterStatus().then(status => {
      if (status) setNative(status)
    })
    const unsub = window.api.on.updaterStatus(payload => {
      setNative(payload)
    })
    return () => {
      unsub()
    }
    // refreshServerInfo bir sabit closure — yalnız mount'ta çalışır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const usesNativeUpdater = window.api.platform === 'win32'

  // Flatpak'te "güncel" de denmez — bilmiyoruz; Preferences Flathub notunu gösterir.
  const status: UpdateStatus = externallyManaged
    ? 'idle'
    : (native?.status ?? (serverChecked ? (serverLatest ? 'available' : 'not-available') : 'idle'))
  const latestVersion = native?.version ?? serverLatest
  const percent = native?.status === 'downloading' ? (native.percent ?? 0) : null
  const error = native?.status === 'error' ? (native.error ?? null) : null

  return {
    currentVersion,
    latestVersion,
    status,
    percent,
    error,
    usesNativeUpdater,
    externallyManaged,
    checkNow: () => {
      if (usesNativeUpdater) {
        void window.api.app.checkForUpdates()
      } else {
        refreshServerInfo()
      }
    },
    download: () => {
      void window.api.app.downloadUpdate()
    },
    restart: () => {
      void window.api.app.restartToInstall()
    },
    openDownloadPage: () => {
      void window.api.app.openDownloadPage()
    }
  }
}
