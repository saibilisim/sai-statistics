// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Drag/keyboard splitter that sets a side panel's width — the R console's
 * right-hand panes and the Output navigator. The handle is a sibling of the
 * panel; `edge` says which side of the panel it sits on. The width the user
 * picks is remembered per `storageKey` (a convenience: a missing or blocked
 * localStorage just means the CSS default width).
 */
import { useRef, useState } from 'react'

const KEY_STEP = 24

interface WidthResizerOptions {
  storageKey: string
  /** Side of the panel the handle sits on. */
  edge: 'left' | 'right'
  minPx: number
  /** Width left for the rest of the row (px). */
  minRestPx: number
}

function readWidth(key: string): number | null {
  try {
    const n = Number(localStorage.getItem(key))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function writeWidth(key: string, px: number): void {
  try {
    localStorage.setItem(key, String(Math.round(px)))
  } catch {
    // Storage unavailable — the width just doesn't carry over.
  }
}

export function useWidthResizer<T extends HTMLElement>({
  storageKey,
  edge,
  minPx,
  minRestPx
}: WidthResizerOptions) {
  // null = CSS default width; a number once the user drags the handle.
  const [widthPx, setWidthPx] = useState<number | null>(() => readWidth(storageKey))
  const panelRef = useRef<T>(null)

  const clamp = (px: number): number => {
    const row = panelRef.current?.parentElement?.clientWidth ?? 0
    const max = row > 0 ? Math.max(minPx, row - minRestPx) : px
    return Math.max(minPx, Math.min(px, max))
  }

  const currentWidth = (): number => panelRef.current?.getBoundingClientRect().width ?? 0
  const sign = edge === 'left' ? -1 : 1

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startW = currentWidth()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    let last = startW
    const onMove = (ev: PointerEvent) => {
      last = clamp(startW + sign * (ev.clientX - startX))
      setWidthPx(last)
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      if (last !== startW) writeWidth(storageKey, last)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const dir = e.key === 'ArrowRight' ? 1 : -1
    const next = clamp(currentWidth() + sign * dir * KEY_STEP)
    setWidthPx(next)
    writeWidth(storageKey, next)
  }

  /** Back to the CSS default width (double-click on the handle). */
  const onDoubleClick = () => {
    setWidthPx(null)
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // ignore
    }
  }

  /** Width the user dragged the panel to — a runtime value. */
  const panelStyle: React.CSSProperties | undefined =
    widthPx !== null ? { width: `${String(widthPx)}px` } : undefined

  return {
    panelRef,
    panelStyle,
    handleProps: { onPointerDown, onKeyDown, onDoubleClick }
  }
}
