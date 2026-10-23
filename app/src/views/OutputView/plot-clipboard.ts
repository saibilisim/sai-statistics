// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * plot-clipboard.ts — "Copy as image" support for OutputPlotView: renders
 * the current plot (static base64 png/svg or interactive Plotly chart) to a
 * PNG Blob and writes it to the clipboard. Returns false when no image
 * could be produced so the caller can surface its localized error.
 */

import type { OutputPlot } from '@shared/analysis-types'
import { base64ToBlob, DEFAULT_COLORS } from './plot-helpers'

export async function copyPlotImageToClipboard(
  plot: OutputPlot,
  plotContainer: HTMLElement | null
): Promise<boolean> {
  let blob: Blob | null = null

  if (plot.type === 'png') {
    blob = base64ToBlob(String(plot.data), 'image/png')
  } else if (plot.type === 'svg') {
    blob = await new Promise<Blob | null>(resolve => {
      const img = new Image()
      img.src = `data:image/svg+xml;base64,${String(plot.data)}`
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || 800
        canvas.height = img.naturalHeight || 600
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.fillStyle = DEFAULT_COLORS.white
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(img, 0, 0)
          canvas.toBlob(resolve, 'image/png')
        } else {
          resolve(null)
        }
      }
      img.onerror = () => {
        resolve(null)
      }
    })
  } else {
    const plotlyEl = plotContainer?.firstElementChild as HTMLElement | undefined
    if (plotlyEl) {
      // plotly.js-dist-min ships no types; borrow the toImage signature
      // from @types/plotly.js (same approach as PlotlyChart.tsx) instead
      // of intersecting with the untyped (`any`) module type, which would
      // collapse the whole intersection back to `any`.
      type PlotlyImageModule = {
        toImage: (
          el: HTMLElement,
          opts: { format: string; width: number; height: number; scale?: number }
        ) => Promise<string>
      }
      const Plotly = (await import('plotly.js-dist-min')) as unknown as PlotlyImageModule
      const containerRect = plotContainer?.getBoundingClientRect()
      const exportW = Math.round(containerRect?.width ?? 800)
      const exportH = Math.round(containerRect?.height ?? 400)
      const dataUrl = await Plotly.toImage(plotlyEl, {
        format: 'png',
        width: exportW,
        height: exportH,
        scale: 2
      })
      const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
      blob = base64ToBlob(b64, 'image/png')
    }
  }

  if (!blob) return false
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  return true
}
