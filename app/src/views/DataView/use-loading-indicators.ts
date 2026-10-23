// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * use-loading-indicators.ts — the two transient UI indicators DataView shows
 * over the grid: the full-screen loading overlay and the corner cell warning
 * toast. Extracted from DataView.tsx; no behaviour change.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseLoadingIndicatorsResult {
  loading: boolean
  beginLoading: () => void
  endLoading: () => void
  cellWarning: string | null
  warnCell: (message: string) => void
}

export function useLoadingIndicators(): UseLoadingIndicatorsResult {
  const [loading, setLoading] = useState(false)
  // Structural ops (insert/delete row or column) trigger the same full
  // re-fetch path as opening a new dataset (T1) — cheap (471ms/60K rows,
  // G0.1) but still enough to flash the full-screen loading overlay on and
  // off for a small dataset's near-instant refetch, which read as a
  // spurious "reload" flicker. Standard fix: don't show the overlay at all
  // unless the fetch is still running past a short grace period — genuinely
  // slow loads (500K rows) still show it, fast ones never flash it.
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const beginLoading = useCallback(() => {
    if (loadingTimerRef.current) return
    loadingTimerRef.current = setTimeout(() => {
      loadingTimerRef.current = null
      setLoading(true)
    }, 150)
  }, [])
  const endLoading = useCallback(() => {
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current)
      loadingTimerRef.current = null
    }
    setLoading(false)
  }, [])
  useEffect(
    () => () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current)
    },
    []
  )
  const [cellWarning, setCellWarning] = useState<string | null>(null)
  const cellWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warnCell = useCallback((message: string) => {
    setCellWarning(message)
    if (cellWarningTimerRef.current) clearTimeout(cellWarningTimerRef.current)
    cellWarningTimerRef.current = setTimeout(() => {
      setCellWarning(null)
    }, 3500)
  }, [])

  return { loading, beginLoading, endLoading, cellWarning, warnCell }
}
