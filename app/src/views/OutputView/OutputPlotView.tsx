// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useMemo, useRef } from 'react'
import type { OutputPlot } from '@shared/analysis-types'
import { PlotlyChart } from '../../components/PlotlyChart'
import { translateOutputKey } from '../../lib/output-format'
import styles from './OutputView.module.css'
import { buildModifiedFigure, getStaticImageSrc, type PlotlyFigure } from './plot-helpers'
import { copyPlotImageToClipboard } from './plot-clipboard'
import { usePlotEditor } from './use-plot-editor'
import { PlotEditor } from './PlotEditor'

interface OutputPlotViewProps {
  plot: OutputPlot
}

export function OutputPlotView({ plot }: OutputPlotViewProps) {
  const editor = usePlotEditor(plot)
  const {
    t,
    pe,
    isEditing,
    setIsEditing,
    setTitleTarget,
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
  } = editor

  const [copying, setCopying] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const plotContainerRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const xInputRef = useRef<HTMLInputElement>(null)
  const yInputRef = useRef<HTMLInputElement>(null)

  const modifiedData = useMemo(
    (): PlotlyFigure | string | null =>
      buildModifiedFigure(plot.type, plot.data, {
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
      }),
    [
      plot.data,
      plot.type,
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
    ]
  )

  const src = useMemo(() => getStaticImageSrc(plot.type, plot.data), [plot.data, plot.type])

  const handleCopyAsImage = async (): Promise<void> => {
    try {
      setCopying(true)
      const copied = await copyPlotImageToClipboard(plot, plotContainerRef.current)

      if (copied) {
        setCopySuccess(true)
        setTimeout(() => {
          setCopySuccess(false)
        }, 2000)
      } else {
        alert(pe('copyImageFailed'))
      }
    } catch (err) {
      console.error('Failed to copy image to clipboard:', err)
      alert(pe('copyImageError'))
    } finally {
      setCopying(false)
    }
  }

  const handleContainerClick = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement

    // If they clicked the static image
    if (target.tagName.toLowerCase() === 'img') {
      setTitleTarget('plot')
      setIsEditing(true)
      setTimeout(() => {
        titleInputRef.current?.focus()
        titleInputRef.current?.select()
      }, 50)
      return
    }

    const textElement = target.closest('text')
    if (!textElement) return

    // Identify clicked SVG elements
    const cls = textElement.getAttribute('class') ?? ''
    const isTitle =
      target.closest('.g-title') !== null ||
      textElement.classList.contains('g-title') ||
      (cls.includes('title') && !cls.includes('xtitle') && !cls.includes('ytitle'))
    const isXTitle =
      target.closest('.g-xtitle') !== null ||
      target.closest('.xtitle') !== null ||
      textElement.classList.contains('g-xtitle') ||
      textElement.classList.contains('xtitle') ||
      cls.includes('xtitle')
    const isYTitle =
      target.closest('.g-ytitle') !== null ||
      target.closest('.ytitle') !== null ||
      textElement.classList.contains('g-ytitle') ||
      textElement.classList.contains('ytitle') ||
      cls.includes('ytitle')

    if (isTitle || isXTitle || isYTitle) {
      setTitleTarget(isTitle ? 'plot' : isXTitle ? 'x' : 'y')
      setIsEditing(true)
      setTimeout(() => {
        if (isTitle && titleInputRef.current) {
          titleInputRef.current.focus()
          titleInputRef.current.select()
        } else if (isXTitle && xInputRef.current) {
          xInputRef.current.focus()
          xInputRef.current.select()
        } else if (isYTitle && yInputRef.current) {
          yInputRef.current.focus()
          yInputRef.current.select()
        }
      }, 50)
    }
  }

  return (
    <div className={styles.plotWrapper}>
      <div className={styles.plotHeader}>
        <div className={styles.plotTitle}>
          {customTitle || (plot.titleKey ? translateOutputKey(plot.titleKey, t) : '')}
        </div>
        <div className={styles.plotActions}>
          <button
            className={styles.copyBtn}
            onClick={() => {
              void handleCopyAsImage()
            }}
            disabled={copying}
            title={pe('copyTooltip')}
          >
            {copying ? pe('copying') : copySuccess ? pe('copied') : pe('copyImage')}
          </button>
          <button
            className={styles.editToggleBtn}
            onClick={() => {
              setIsEditing(!isEditing)
            }}
            aria-label={pe('editAriaLabel')}
          >
            {isEditing ? pe('close') : pe('edit')}
          </button>
        </div>
      </div>

      {isEditing && (
        <PlotEditor
          plot={plot}
          editor={editor}
          titleInputRef={titleInputRef}
          xInputRef={xInputRef}
          yInputRef={yInputRef}
        />
      )}

      <div ref={plotContainerRef} className={styles.plotContainer} onClick={handleContainerClick}>
        {plot.type === 'png' || plot.type === 'svg' ? (
          <img src={src} alt={customTitle} className={styles.plotImg} />
        ) : (
          <PlotlyChart
            data={modifiedData}
            filename={customTitle || (plot.titleKey ? translateOutputKey(plot.titleKey, t) : '')}
          />
        )}
      </div>
    </div>
  )
}
