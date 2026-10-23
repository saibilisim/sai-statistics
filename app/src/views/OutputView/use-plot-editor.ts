// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * use-plot-editor.ts — All plot-editor state for OutputPlotView: title/axis
 * text + font overrides, per-trace names/colors, legend/grid/background
 * toggles, theme presets, and the effect that re-seeds that state from the
 * incoming `plot` (plus the `pe()` plotEditor-i18n helper).
 */

import { useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OutputPlot } from '@shared/analysis-types'
import { translateOutputKey } from '../../lib/output-format'
import {
  DEFAULT_COLORS,
  extractTitleFont,
  extractTitleText,
  THEME_PALETTES,
  type FontFamily,
  type PlotlyFigure
} from './plot-helpers'

export function usePlotEditor(plot: OutputPlot) {
  const { t } = useTranslation(['common', 'analysis', 'dialogs'])
  // Keys are built dynamically (tab/preset/field names), so they can't be
  // narrowed to the typed literal union i18next.d.ts generates — same
  // established pattern as translateOutputKey() for R-driven dynamic keys.
  // The `as never` cast is required by `tsc` (i18next's literal-key overload
  // otherwise rejects the dynamic `options` argument); eslint's type-aware
  // pass resolves the i18next overload set differently (projectService vs.
  // the tsconfig `pnpm typecheck` uses) and flags the same cast as redundant.
  // tsc is authoritative here.
  const pe = (key: string, opts?: Record<string, unknown>): string =>
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    t(`dialogs:plotEditor.${key}` as never, opts)

  const [isEditing, setIsEditing] = useState(false)
  const [activeTab, setActiveTab] = useState<'titles' | 'traces' | 'grids' | 'colors'>('titles')
  const [titleTarget, setTitleTarget] = useState<'plot' | 'x' | 'y'>('plot')

  // Title States
  const [customTitle, setCustomTitle] = useState('')
  const [titleFontFamily, setTitleFontFamily] = useState<FontFamily>('sans-serif')
  const [titleFontSize, setTitleFontSize] = useState(16)
  const [titleFontColor, setTitleFontColor] = useState<string>(DEFAULT_COLORS.titleText)
  const [titleFontBold, setTitleFontBold] = useState(false)
  const [titleFontItalic, setTitleFontItalic] = useState(false)

  // X-Axis States
  const [customXLabel, setCustomXLabel] = useState('')
  const [xLabelFontFamily, setXLabelFontFamily] = useState<FontFamily>('sans-serif')
  const [xLabelFontSize, setXLabelFontSize] = useState(12)
  const [xLabelFontColor, setXLabelFontColor] = useState<string>(DEFAULT_COLORS.axisText)
  const [xLabelFontBold, setXLabelFontBold] = useState(false)
  const [xLabelFontItalic, setXLabelFontItalic] = useState(false)

  // Y-Axis States
  const [customYLabel, setCustomYLabel] = useState('')
  const [yLabelFontFamily, setYLabelFontFamily] = useState<FontFamily>('sans-serif')
  const [yLabelFontSize, setYLabelFontSize] = useState(12)
  const [yLabelFontColor, setYLabelFontColor] = useState<string>(DEFAULT_COLORS.axisText)
  const [yLabelFontBold, setYLabelFontBold] = useState(false)
  const [yLabelFontItalic, setYLabelFontItalic] = useState(false)

  // Trace (Variable/Series) States
  const [traceNames, setTraceNames] = useState<string[]>([])
  const [traceColors, setTraceColors] = useState<string[]>([])
  const [markerSize, setMarkerSize] = useState<number>(6)
  // 0 means "unset" — leaves Plotly's own auto box width untouched, so the
  // user can always dial back to the original look after narrowing it.
  const [boxWidth, setBoxWidth] = useState<number>(0)
  const [hasBoxTrace, setHasBoxTrace] = useState(false)

  // Legend State
  const [showLegend, setShowLegend] = useState(true)

  // Axes tickfont size
  const [tickFontSize, setTickFontSize] = useState(10)

  // Grids & Colors
  const [showXGrid, setShowXGrid] = useState(true)
  const [showYGrid, setShowYGrid] = useState(true)
  const [plotBgColor, setPlotBgColor] = useState('')
  const [paperBgColor, setPaperBgColor] = useState('')
  const [gridColor, setGridColor] = useState<string>(DEFAULT_COLORS.grid)

  // Resets ~15 pieces of independent editor state (title/axis text, fonts,
  // colors, per-trace overrides…) whenever `plot` changes identity. This is
  // the "adjust state on prop change" case React's own docs describe as a
  // legitimate Effect use (https://react.dev/learn/you-might-not-need-an-effect)
  // — collapsing it to derived-during-render state would need a full render
  // key per plot instead of the shared per-slot key OutputView uses today.
  //
  // useLayoutEffect, not useEffect: every field here starts at its blank/
  // default useState initializer, so a plain useEffect (post-paint) put a
  // real title/axis-label/legend flash of that blank state on screen before
  // snapping to the plot's actual values one render later — every plot in
  // the app, on every mount, not something specific to R's title/axis-label
  // resolution (which is already correct in plot.data at this point).
  // Synchronous, pre-paint correction here collapses that to one paint.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitleTarget('plot')
    setBoxWidth(0)

    if (plot.type === 'png' || plot.type === 'svg') {
      const defaultTitle = plot.titleKey ? translateOutputKey(plot.titleKey, t) : ''
      setCustomTitle(defaultTitle)
      setHasBoxTrace(false)
      return
    }

    const base = plot.data as PlotlyFigure | undefined
    if (!base) return

    const layout = base.layout ?? {}
    const font = layout.font ?? {}

    // Title
    const rawTitle = extractTitleText(layout.title)
    const titleFont = extractTitleFont(layout.title)
    const isBoldTitle = rawTitle.includes('<b>')
    const isItalicTitle = rawTitle.includes('<i>')
    const cleanTitle = rawTitle.replace(/<\/?b>/g, '').replace(/<\/?i>/g, '')

    setCustomTitle(cleanTitle)
    setTitleFontBold(isBoldTitle)
    setTitleFontItalic(isItalicTitle)
    setTitleFontFamily(titleFont.family ?? font.family ?? 'sans-serif')
    setTitleFontSize(titleFont.size ?? 16)
    setTitleFontColor(titleFont.color ?? font.color ?? DEFAULT_COLORS.titleText)

    // X Axis
    const rawX = extractTitleText(layout.xaxis?.title)
    const xFont = extractTitleFont(layout.xaxis?.title)
    const isBoldX = rawX.includes('<b>')
    const isItalicX = rawX.includes('<i>')
    const cleanX = rawX.replace(/<\/?b>/g, '').replace(/<\/?i>/g, '')

    setCustomXLabel(cleanX)
    setXLabelFontBold(isBoldX)
    setXLabelFontItalic(isItalicX)
    setXLabelFontFamily(xFont.family ?? font.family ?? 'sans-serif')
    setXLabelFontSize(xFont.size ?? 12)
    setXLabelFontColor(xFont.color ?? font.color ?? DEFAULT_COLORS.axisText)

    // Y Axis
    const rawY = extractTitleText(layout.yaxis?.title)
    const yFont = extractTitleFont(layout.yaxis?.title)
    const isBoldY = rawY.includes('<b>')
    const isItalicY = rawY.includes('<i>')
    const cleanY = rawY.replace(/<\/?b>/g, '').replace(/<\/?i>/g, '')

    setCustomYLabel(cleanY)
    setYLabelFontBold(isBoldY)
    setYLabelFontItalic(isItalicY)
    setYLabelFontFamily(yFont.family ?? font.family ?? 'sans-serif')
    setYLabelFontSize(yFont.size ?? 12)
    setYLabelFontColor(yFont.color ?? font.color ?? DEFAULT_COLORS.axisText)

    // Grids, scale, legend
    setShowXGrid(layout.xaxis?.showgrid !== false)
    setShowYGrid(layout.yaxis?.showgrid !== false)
    setPlotBgColor(typeof layout.plot_bgcolor === 'string' ? layout.plot_bgcolor : '')
    setPaperBgColor(typeof layout.paper_bgcolor === 'string' ? layout.paper_bgcolor : '')
    setGridColor(
      typeof layout.xaxis?.gridcolor === 'string' ? layout.xaxis.gridcolor : DEFAULT_COLORS.grid
    )
    setShowLegend(layout.showlegend !== false)
    setTickFontSize(layout.xaxis?.tickfont?.size ?? 10)

    // Traces
    if (Array.isArray(base.data)) {
      setHasBoxTrace(base.data.some(tr => tr.type === 'box'))
      setTraceNames(base.data.map(tr => (typeof tr.name === 'string' ? tr.name : '')))
      setTraceColors(
        base.data.map(tr => {
          const marker = 'marker' in tr ? tr.marker : undefined
          const line = 'line' in tr ? tr.line : undefined
          const markerColor = marker && typeof marker.color === 'string' ? marker.color : undefined
          const lineColor = line && typeof line.color === 'string' ? line.color : undefined
          return markerColor ?? lineColor ?? ''
        })
      )
      const foundSize = base.data
        .map(tr =>
          'marker' in tr && tr.marker && typeof (tr.marker as { size?: unknown }).size === 'number'
            ? (tr.marker as { size: number }).size
            : undefined
        )
        .find((s): s is number => typeof s === 'number')
      setMarkerSize(foundSize ?? 6)
    } else {
      setHasBoxTrace(false)
      setTraceNames([])
      setTraceColors([])
      setMarkerSize(6)
    }
  }, [plot, t])

  const handleTraceColorChange = (idx: number, newColor: string): void => {
    setTraceColors(prev => {
      const updated = [...prev]
      updated[idx] = newColor
      return updated
    })
  }

  const handleTraceNameChange = (idx: number, newName: string): void => {
    setTraceNames(prev => {
      const updated = [...prev]
      updated[idx] = newName
      return updated
    })
  }

  const applyThemePreset = (preset: 'spss' | 'modern' | 'apa' | 'academic' | 'grayscale'): void => {
    const { white, black } = DEFAULT_COLORS
    if (preset === 'spss') {
      setPlotBgColor(white)
      setPaperBgColor(white)
      setShowXGrid(false)
      setShowYGrid(false)
      setTitleFontFamily('Times New Roman, Times, serif')
      setXLabelFontFamily('Times New Roman, Times, serif')
      setYLabelFontFamily('Times New Roman, Times, serif')
      setTitleFontColor(black)
      setXLabelFontColor(black)
      setYLabelFontColor(black)
      setTraceColors(prev =>
        prev.map((_, i) => THEME_PALETTES.spss[i % THEME_PALETTES.spss.length] ?? black)
      )
    } else if (preset === 'modern') {
      setPlotBgColor('#f8fafc')
      setPaperBgColor(white)
      setShowXGrid(true)
      setShowYGrid(true)
      setGridColor(DEFAULT_COLORS.grid)
      setTitleFontFamily('sans-serif')
      setXLabelFontFamily('sans-serif')
      setYLabelFontFamily('sans-serif')
      setTitleFontColor(DEFAULT_COLORS.titleText)
      setXLabelFontColor(DEFAULT_COLORS.axisText)
      setYLabelFontColor(DEFAULT_COLORS.axisText)
      setTraceColors(prev =>
        prev.map((_, i) => THEME_PALETTES.modern[i % THEME_PALETTES.modern.length] ?? black)
      )
    } else if (preset === 'apa') {
      setPlotBgColor(white)
      setPaperBgColor(white)
      setShowXGrid(false)
      setShowYGrid(false)
      setTitleFontFamily('Times New Roman, Times, serif')
      setXLabelFontFamily('Times New Roman, Times, serif')
      setYLabelFontFamily('Times New Roman, Times, serif')
      setTitleFontColor(black)
      setXLabelFontColor(black)
      setYLabelFontColor(black)
      setTitleFontBold(true)
      setXLabelFontItalic(true)
      setYLabelFontItalic(true)
      setTraceColors(prev =>
        prev.map((_, i) => THEME_PALETTES.apa[i % THEME_PALETTES.apa.length] ?? black)
      )
    } else if (preset === 'academic') {
      setPlotBgColor(white)
      setPaperBgColor(white)
      setShowXGrid(false)
      setShowYGrid(true)
      setGridColor('#eaeaea')
      setTitleFontFamily('Times New Roman, Times, serif')
      setXLabelFontFamily('Times New Roman, Times, serif')
      setYLabelFontFamily('Times New Roman, Times, serif')
      setTitleFontColor(black)
      setXLabelFontColor(black)
      setYLabelFontColor(black)
      setTraceColors(prev =>
        prev.map((_, i) => THEME_PALETTES.academic[i % THEME_PALETTES.academic.length] ?? black)
      )
    } else {
      setPlotBgColor(white)
      setPaperBgColor(white)
      setShowXGrid(false)
      setShowYGrid(false)
      setTitleFontFamily('sans-serif')
      setXLabelFontFamily('sans-serif')
      setYLabelFontFamily('sans-serif')
      setTitleFontColor(black)
      setXLabelFontColor(black)
      setYLabelFontColor(black)
      // Map traces to publication-ready grayscale
      setTraceColors(prev =>
        prev.map((_, i) => ['#000000', '#555555', '#888888', '#cccccc'][i % 4] ?? black)
      )
    }
  }

  return {
    t,
    pe,
    isEditing,
    setIsEditing,
    activeTab,
    setActiveTab,
    titleTarget,
    setTitleTarget,
    customTitle,
    setCustomTitle,
    titleFontFamily,
    setTitleFontFamily,
    titleFontSize,
    setTitleFontSize,
    titleFontColor,
    setTitleFontColor,
    titleFontBold,
    setTitleFontBold,
    titleFontItalic,
    setTitleFontItalic,
    customXLabel,
    setCustomXLabel,
    xLabelFontFamily,
    setXLabelFontFamily,
    xLabelFontSize,
    setXLabelFontSize,
    xLabelFontColor,
    setXLabelFontColor,
    xLabelFontBold,
    setXLabelFontBold,
    xLabelFontItalic,
    setXLabelFontItalic,
    customYLabel,
    setCustomYLabel,
    yLabelFontFamily,
    setYLabelFontFamily,
    yLabelFontSize,
    setYLabelFontSize,
    yLabelFontColor,
    setYLabelFontColor,
    yLabelFontBold,
    setYLabelFontBold,
    yLabelFontItalic,
    setYLabelFontItalic,
    traceNames,
    traceColors,
    markerSize,
    setMarkerSize,
    boxWidth,
    setBoxWidth,
    hasBoxTrace,
    handleTraceColorChange,
    handleTraceNameChange,
    showLegend,
    setShowLegend,
    tickFontSize,
    setTickFontSize,
    showXGrid,
    setShowXGrid,
    showYGrid,
    setShowYGrid,
    plotBgColor,
    setPlotBgColor,
    paperBgColor,
    setPaperBgColor,
    gridColor,
    setGridColor,
    applyThemePreset
  }
}

export type PlotEditorState = ReturnType<typeof usePlotEditor>
