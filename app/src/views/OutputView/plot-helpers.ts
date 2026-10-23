// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * plot-helpers.ts — Pure types, constants and chart-data helpers for
 * OutputPlotView: loose-but-typed Plotly figure shapes, default
 * font/color constants, and the pure figure-building helpers
 * (buildModifiedFigure / getStaticImageSrc) that turn editor state into
 * the Plotly figure or static data-URL the viewer renders.
 */

import type { OutputPlot } from '@shared/analysis-types'

// Plotly's own `Layout`/`Data` types are deeply strict discriminated unions
// (title can be N different shapes depending on trace type, marker/line color
// varies per trace kind, etc.) that fight a generic editor which only reads
// and rewrites a handful of fields. These loose-but-typed interfaces (index
// signatures preserve arbitrary R-generated Plotly properties untouched)
// replace `any` without fighting Plotly's exact generics — the object is
// handed to PlotlyChart as `unknown` regardless (see PlotlyChart.tsx).
export interface PlotlyFont {
  family?: string
  size?: number
  color?: string
  [key: string]: unknown
}

export interface PlotlyAxisTitle {
  text?: string
  font?: PlotlyFont
}

export interface PlotlyAxis {
  showgrid?: boolean
  gridcolor?: string
  tickfont?: { size?: number; [key: string]: unknown }
  title?: PlotlyAxisTitle | string
  [key: string]: unknown
}

export interface PlotlyLayoutLike {
  title?: PlotlyAxisTitle | string
  font?: PlotlyFont
  xaxis?: PlotlyAxis
  yaxis?: PlotlyAxis
  showlegend?: boolean
  plot_bgcolor?: string
  paper_bgcolor?: string
  [key: string]: unknown
}

export interface PlotlyTraceLike {
  name?: string
  marker?: { color?: string; [key: string]: unknown }
  line?: { color?: string; [key: string]: unknown }
  [key: string]: unknown
}

/** Shape of `plot.data` for interactive (Plotly) plots — the only fields this editor reads/writes. */
export interface PlotlyFigure {
  data: PlotlyTraceLike[]
  layout?: PlotlyLayoutLike
}

export type FontFamily = string

export const FONT_FAMILIES: readonly FontFamily[] = [
  'sans-serif',
  'Arial, sans-serif',
  'Times New Roman, Times, serif',
  'Courier New, Courier, monospace',
  'Verdana, Geneva, sans-serif',
  'Georgia, serif'
]

export const TITLE_FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48]
export const AXIS_FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28]
export const TICK_FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16]

/** Default plot-appearance colors. These style the exported Plotly figure
 * itself (mirroring Plotly's own default palette), not app UI chrome — they
 * intentionally do not follow the app's light/dark theme tokens (CLAUDE.md
 * §7 governs UI chrome; a saved chart's default text/background is export
 * data, not a themed component). */
export const DEFAULT_COLORS = {
  titleText: '#2d3748',
  axisText: '#4a5568',
  grid: '#e2e8f0',
  fallback: '#007acc',
  white: '#ffffff',
  black: '#000000'
} as const

/** Per-preset series/trace color palettes for the "Colors & Theme" tab's
 * style presets — each preset recolors every series to a set that matches
 * its own look (not just background/font/gridlines), so switching presets
 * always yields a visually coherent result. Cycled with `i % length` when a
 * plot has more series than colors. Grayscale isn't here: it derives its
 * ramp from the current series count instead of a fixed palette. */
export const THEME_PALETTES = {
  spss: ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'],
  modern: [
    '#5B8FF9',
    '#5AD8A6',
    '#F6903D',
    '#945FB9',
    '#E87A90',
    '#5D7092',
    '#5B9BD5',
    '#269A99',
    '#F6BD16',
    '#6F76D9',
    '#D9705F',
    '#72A98F'
  ],
  apa: ['#2C3E50', '#8E44AD', '#16A085', '#C0392B', '#7F8C8D', '#2980B9'],
  academic: ['#264653', '#2A9D8F', '#E9C46A', '#F4A261', '#E76F51', '#8AB17D']
} as const

export function extractTitleText(title: PlotlyAxisTitle | string | undefined): string {
  if (title == null) return ''
  if (typeof title === 'string') return title
  return title.text ?? ''
}

export function extractTitleFont(title: PlotlyAxisTitle | string | undefined): PlotlyFont {
  if (title != null && typeof title !== 'string') return title.font ?? {}
  return {}
}

export function colorToHex(color: unknown): string {
  if (!color || typeof color !== 'string') return DEFAULT_COLORS.fallback
  const c = color.trim()
  if (c.startsWith('#')) {
    if (c.length === 4) {
      const r = c.charAt(1)
      const g = c.charAt(2)
      const b = c.charAt(3)
      return `#${r}${r}${g}${g}${b}${b}`
    }
    return c
  }
  if (c.startsWith('rgb')) {
    const match = /\d+/g.exec(c)
    if (match && match.length >= 3) {
      const r = Number(match[0]).toString(16).padStart(2, '0')
      const g = Number(match[1]).toString(16).padStart(2, '0')
      const b = Number(match[2]).toString(16).padStart(2, '0')
      return `#${r}${g}${b}`
    }
  }
  return DEFAULT_COLORS.fallback
}

// CSP-safe: convert a base64 data-URL to Blob without fetch()
export function base64ToBlob(b64: string, mimeType: string): Blob {
  const byteChars = atob(b64)
  const bytes = new Uint8Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

export function fontOptionLabel(family: FontFamily, pe: (key: string) => string): string {
  switch (family) {
    case 'sans-serif':
      return pe('fontOption.systemDefault')
    case 'Arial, sans-serif':
      return pe('fontOption.arial')
    case 'Times New Roman, Times, serif':
      return pe('fontOption.timesNewRoman')
    case 'Courier New, Courier, monospace':
      return pe('fontOption.courierNew')
    case 'Verdana, Geneva, sans-serif':
      return pe('fontOption.verdana')
    case 'Georgia, serif':
      return pe('fontOption.georgia')
    default:
      return family
  }
}

/** Editor-state snapshot buildModifiedFigure rewrites the Plotly figure with. */
export interface ModifiedFigureInput {
  customTitle: string
  titleFontFamily: FontFamily
  titleFontSize: number
  titleFontColor: string
  titleFontBold: boolean
  titleFontItalic: boolean
  customXLabel: string
  xLabelFontFamily: FontFamily
  xLabelFontSize: number
  xLabelFontColor: string
  xLabelFontBold: boolean
  xLabelFontItalic: boolean
  customYLabel: string
  yLabelFontFamily: FontFamily
  yLabelFontSize: number
  yLabelFontColor: string
  yLabelFontBold: boolean
  yLabelFontItalic: boolean
  showXGrid: boolean
  showYGrid: boolean
  gridColor: string
  tickFontSize: number
  showLegend: boolean
  plotBgColor: string
  paperBgColor: string
  traceNames: string[]
  traceColors: string[]
  markerSize?: number
  /** 0 = unset — leaves each box trace's own (auto) width untouched. */
  boxWidth?: number
}

/** Rewrites the base Plotly figure with the editor's title/axis/grid/color/
 * trace overrides. Returns null for static (png/svg) plots — those render
 * the base64 image untouched. */
export function buildModifiedFigure(
  plotType: OutputPlot['type'],
  plotData: unknown,
  input: ModifiedFigureInput
): PlotlyFigure | string | null {
  const {
    customTitle,
    titleFontFamily,
    titleFontSize,
    titleFontColor,
    titleFontBold,
    titleFontItalic,
    customXLabel,
    xLabelFontFamily,
    xLabelFontSize,
    xLabelFontColor,
    xLabelFontBold,
    xLabelFontItalic,
    customYLabel,
    yLabelFontFamily,
    yLabelFontSize,
    yLabelFontColor,
    yLabelFontBold,
    yLabelFontItalic,
    showXGrid,
    showYGrid,
    gridColor,
    tickFontSize,
    showLegend,
    plotBgColor,
    paperBgColor,
    traceNames,
    traceColors,
    markerSize,
    boxWidth
  } = input

  if (plotType === 'png' || plotType === 'svg') return null
  const base = plotData as PlotlyFigure | undefined
  if (!base) return null

  const layout: PlotlyLayoutLike = { ...base.layout }

  // Format Title
  let formattedTitle = customTitle
  if (titleFontBold) formattedTitle = `<b>${formattedTitle}</b>`
  if (titleFontItalic) formattedTitle = `<i>${formattedTitle}</i>`
  layout.title = {
    text: formattedTitle,
    font: {
      family: titleFontFamily,
      size: titleFontSize,
      color: titleFontColor
    }
  }

  // Format X Axis
  let formattedX = customXLabel
  if (xLabelFontBold) formattedX = `<b>${formattedX}</b>`
  if (xLabelFontItalic) formattedX = `<i>${formattedX}</i>`
  layout.xaxis = {
    ...layout.xaxis,
    showgrid: showXGrid,
    gridcolor: gridColor,
    tickfont: {
      ...layout.xaxis?.tickfont,
      size: tickFontSize
    },
    title: {
      text: formattedX,
      font: {
        family: xLabelFontFamily,
        size: xLabelFontSize,
        color: xLabelFontColor
      }
    }
  }

  // Format Y Axis
  let formattedY = customYLabel
  if (yLabelFontBold) formattedY = `<b>${formattedY}</b>`
  if (yLabelFontItalic) formattedY = `<i>${formattedY}</i>`
  layout.yaxis = {
    ...layout.yaxis,
    showgrid: showYGrid,
    gridcolor: gridColor,
    tickfont: {
      ...layout.yaxis?.tickfont,
      size: tickFontSize
    },
    title: {
      text: formattedY,
      font: {
        family: yLabelFontFamily,
        size: yLabelFontSize,
        color: yLabelFontColor
      }
    }
  }

  // Legend
  layout.showlegend = showLegend

  // Colors
  if (plotBgColor) layout.plot_bgcolor = plotBgColor
  if (paperBgColor) layout.paper_bgcolor = paperBgColor

  // Map Traces (Variable/Series names, Colors & Marker Size)
  let updatedData = base.data
  if (Array.isArray(base.data)) {
    updatedData = base.data.map((trace, idx) => {
      const newTrace = { ...trace }
      if (traceNames[idx] !== undefined) {
        Object.assign(newTrace, { name: traceNames[idx] })
      }
      const newColor = traceColors[idx]
      const marker =
        'marker' in trace && trace.marker && typeof trace.marker === 'object'
          ? { ...trace.marker }
          : {}
      if (newColor) {
        marker.color = newColor
        const line = 'line' in trace ? trace.line : undefined
        if (line) {
          Object.assign(newTrace, { line: { ...line, color: newColor } })
        }
      }
      if (markerSize !== undefined && markerSize > 0) {
        marker.size = markerSize
      }
      if (Object.keys(marker).length > 0) {
        Object.assign(newTrace, { marker })
      }
      // Box width override: also scale the trace's own jitter so an overlaid
      // point cloud narrows with the box instead of spilling past its edges
      // (0.5 is Plotly's typical auto width for a single, ungrouped box).
      if (boxWidth !== undefined && boxWidth > 0 && trace.type === 'box') {
        const baseJitter = typeof trace.jitter === 'number' ? trace.jitter : 0.3
        Object.assign(newTrace, {
          width: boxWidth,
          jitter: Math.min(1, Math.max(0, baseJitter * (boxWidth / 0.5)))
        })
      }
      return newTrace
    })
  }

  // Box width also pulls categories closer together as it narrows: Plotly
  // holds category spacing fixed regardless of a box trace's own `width`
  // (each box is just a category with no explicit x/x0 — see chart.R), so a
  // narrower box alone would only widen the empty margin around it. Spacing
  // is recomputed as boxWidth * MAX_SPACING (a fixed 30%-of-box-width gap)
  // and applied via explicit x0/y0 plus matching category tick labels.
  //
  // The axis range is pinned to the *widest* possible layout (every box at
  // its maximum width) rather than left on Plotly's autorange. Autorange
  // fits the view to whatever data is present — since box width and spacing
  // shrink by the same factor together, an autoranged view would zoom back
  // in to fill the same pixels every time, making narrower settings look
  // visually identical to wider ones. A fixed range makes the cluster
  // actually render smaller, centered in the unused space, as it narrows.
  if (boxWidth !== undefined && boxWidth > 0 && Array.isArray(updatedData)) {
    const boxTraces = updatedData.filter(tr => tr.type === 'box')
    if (boxTraces.length > 1) {
      const MAX_SPACING = 1.3 // spacing at boxWidth's max slider value (1)
      const n = boxTraces.length
      const spacing = boxWidth * MAX_SPACING
      const fullExtent = (n - 1) * MAX_SPACING
      const currentExtent = (n - 1) * spacing
      const offset = (fullExtent - currentExtent) / 2
      const isHorizontal = boxTraces[0]?.orientation === 'h'
      const posKey = isHorizontal ? 'y0' : 'x0'
      const axisKey = isHorizontal ? 'yaxis' : 'xaxis'
      const tickvals: number[] = []
      const ticktext: string[] = []
      boxTraces.forEach((tr, i) => {
        const pos = offset + i * spacing
        Object.assign(tr, { [posKey]: pos })
        tickvals.push(pos)
        ticktext.push(typeof tr.name === 'string' ? tr.name : String(i + 1))
      })
      layout[axisKey] = {
        ...layout[axisKey],
        tickmode: 'array',
        tickvals,
        ticktext,
        range: [-0.75, fullExtent + 0.75],
        autorange: false
      }
    }
  }

  return {
    ...base,
    data: updatedData,
    layout
  }
}

/** base64 data-URL for static (png/svg) plots; '' for interactive ones. */
export function getStaticImageSrc(plotType: OutputPlot['type'], plotData: unknown): string {
  if (plotType !== 'png' && plotType !== 'svg') return ''
  return plotType === 'png'
    ? `data:image/png;base64,${String(plotData)}`
    : `data:image/svg+xml;base64,${String(plotData)}`
}
