// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import type * as PlotlyTypes from 'plotly.js'

// plotly.js-dist-min has no bundled types; we borrow the interface from @types/plotly.js
type PlotlyModule = {
  newPlot: (
    el: HTMLElement,
    data: PlotlyTypes.Data[],
    layout?: Partial<PlotlyTypes.Layout>,
    config?: Partial<PlotlyTypes.Config>
  ) => Promise<PlotlyTypes.PlotlyHTMLElement>
  Plots: {
    resize: (el: HTMLElement) => Promise<PlotlyTypes.PlotlyHTMLElement>
  }
  toImage: (
    el: HTMLElement,
    opts: { format: string; width: number; height: number }
  ) => Promise<string>
  purge: (el: HTMLElement) => void
}

// Turns a plot title into a filesystem-safe download filename — strips
// <b>/<i> markup from custom titles and characters invalid on Windows.
function sanitizeFilename(name: string | undefined): string {
  if (!name) return ''
  return name
    .replace(/<[^>]+>/g, '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 80)
}

export function PlotlyChart({
  data,
  minHeight,
  filename
}: {
  data: unknown
  minHeight?: number | string
  filename?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const plotlyRef = useRef<PlotlyModule | null>(null)
  const mountedRef = useRef(false)

  // Initial render
  useEffect(() => {
    if (!ref.current) return
    let cleanup: (() => void) | undefined

    void (import('plotly.js-dist-min') as Promise<PlotlyModule>).then(Plotly => {
      if (!ref.current) return
      plotlyRef.current = Plotly
      const plotData = data as {
        data: PlotlyTypes.Data[]
        layout: Partial<PlotlyTypes.Layout>
      }

      // Strip hardcoded dimensions — autosize + responsive handles sizing
      const layoutCopy = { ...plotData.layout }
      delete layoutCopy.width
      delete layoutCopy.height

      void Plotly.newPlot(
        ref.current,
        plotData.data,
        {
          ...layoutCopy,
          autosize: true,
          // Default white (not transparent) so exported/copied images stay
          // legible regardless of the app's light/dark theme behind them.
          paper_bgcolor: layoutCopy.paper_bgcolor ?? '#ffffff',
          plot_bgcolor: layoutCopy.plot_bgcolor ?? '#ffffff'
        },
        {
          responsive: true,
          displaylogo: false,
          modeBarButtonsToRemove: ['lasso2d', 'select2d', 'toggleSpikelines'],
          toImageButtonOptions: {
            format: 'png',
            scale: 2,
            filename: sanitizeFilename(filename) || 'sai-plot'
          }
        }
      ).then(() => {
        mountedRef.current = true
        if (ref.current) {
          void Plotly.Plots.resize(ref.current)
        }
      })

      cleanup = () => {
        mountedRef.current = false
        if (ref.current) Plotly.purge(ref.current)
      }
    })

    return () => cleanup?.()
  }, [data, filename])

  // Relayout when the container resizes
  useEffect(() => {
    if (!ref.current) return

    const observer = new ResizeObserver(() => {
      if (ref.current && plotlyRef.current && mountedRef.current) {
        void plotlyRef.current.Plots.resize(ref.current)
      }
    })

    observer.observe(ref.current)
    return () => {
      observer.disconnect()
    }
  }, [])

  return <div ref={ref} style={{ width: '100%', height: '100%', minHeight }} />
}
