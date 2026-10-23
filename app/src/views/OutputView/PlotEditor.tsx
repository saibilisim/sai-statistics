// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PlotEditor.tsx — The collapsible plot-appearance editor panel for
 * OutputPlotView. Static (png/svg) plots get a title-only editor;
 * interactive Plotly plots get the tabbed titles/traces/grids/colors
 * editor. All state lives in usePlotEditor — this component only renders it.
 */

import { useState, type RefObject } from 'react'
import type { OutputPlot } from '@shared/analysis-types'
import { cx } from '../../lib/cx'
import {
  AXIS_FONT_SIZES,
  colorToHex,
  FONT_FAMILIES,
  fontOptionLabel,
  TICK_FONT_SIZES,
  TITLE_FONT_SIZES
} from './plot-helpers'
import type { PlotEditorState } from './use-plot-editor'
import styles from './OutputView.module.css'

interface PlotEditorProps {
  plot: OutputPlot
  editor: PlotEditorState
  titleInputRef: RefObject<HTMLInputElement | null>
  xInputRef: RefObject<HTMLInputElement | null>
  yInputRef: RefObject<HTMLInputElement | null>
}

export function PlotEditor({ plot, editor, titleInputRef, xInputRef, yInputRef }: PlotEditorProps) {
  const [activeTraceIndex, setActiveTraceIndex] = useState(0)

  const {
    pe,
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
    handleTraceNameChange,
    handleTraceColorChange,
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
  } = editor

  // The Titles tab edits one of Plot/X-Axis/Y-Axis at a time, picked via the
  // `titleTarget` dropdown — these derive the active target's bound state
  // (and, for the ref, which of titleInputRef/xInputRef/yInputRef the shared
  // text field mounts to, so click-to-edit-in-chart in OutputPlotView still
  // finds a live input to focus).
  const targetRef =
    titleTarget === 'plot' ? titleInputRef : titleTarget === 'x' ? xInputRef : yInputRef
  const targetText =
    titleTarget === 'plot' ? customTitle : titleTarget === 'x' ? customXLabel : customYLabel
  const setTargetText =
    titleTarget === 'plot'
      ? setCustomTitle
      : titleTarget === 'x'
        ? setCustomXLabel
        : setCustomYLabel
  const targetFontFamily =
    titleTarget === 'plot'
      ? titleFontFamily
      : titleTarget === 'x'
        ? xLabelFontFamily
        : yLabelFontFamily
  const setTargetFontFamily =
    titleTarget === 'plot'
      ? setTitleFontFamily
      : titleTarget === 'x'
        ? setXLabelFontFamily
        : setYLabelFontFamily
  const targetFontSize =
    titleTarget === 'plot' ? titleFontSize : titleTarget === 'x' ? xLabelFontSize : yLabelFontSize
  const setTargetFontSize =
    titleTarget === 'plot'
      ? setTitleFontSize
      : titleTarget === 'x'
        ? setXLabelFontSize
        : setYLabelFontSize
  const targetFontSizes = titleTarget === 'plot' ? TITLE_FONT_SIZES : AXIS_FONT_SIZES
  const targetFontColor =
    titleTarget === 'plot'
      ? titleFontColor
      : titleTarget === 'x'
        ? xLabelFontColor
        : yLabelFontColor
  const setTargetFontColor =
    titleTarget === 'plot'
      ? setTitleFontColor
      : titleTarget === 'x'
        ? setXLabelFontColor
        : setYLabelFontColor
  const targetFontBold =
    titleTarget === 'plot' ? titleFontBold : titleTarget === 'x' ? xLabelFontBold : yLabelFontBold
  const setTargetFontBold =
    titleTarget === 'plot'
      ? setTitleFontBold
      : titleTarget === 'x'
        ? setXLabelFontBold
        : setYLabelFontBold
  const targetFontItalic =
    titleTarget === 'plot'
      ? titleFontItalic
      : titleTarget === 'x'
        ? xLabelFontItalic
        : yLabelFontItalic
  const setTargetFontItalic =
    titleTarget === 'plot'
      ? setTitleFontItalic
      : titleTarget === 'x'
        ? setXLabelFontItalic
        : setYLabelFontItalic
  const targetPlaceholder =
    titleTarget === 'plot'
      ? pe('titlePlaceholder')
      : titleTarget === 'x'
        ? pe('field.xAxisPlaceholder')
        : pe('field.yAxisPlaceholder')

  const activeTraceIdx =
    traceNames.length > 0 ? Math.min(activeTraceIndex, traceNames.length - 1) : 0

  return (
    <div className={styles.plotControls}>
      <div className={styles.resizeHint}>
        ℹ️ <strong>{pe('resizeHintLabel')}</strong> {pe('resizeHint')}
      </div>

      {plot.type === 'png' || plot.type === 'svg' ? (
        <div className={styles.tabContent}>
          <div className={styles.editorSection}>
            <div className={styles.sectionTitle}>{pe('plotTitleLabel')}</div>
            <div className={styles.editorRow}>
              <input
                ref={titleInputRef}
                type="text"
                value={customTitle}
                onChange={e => {
                  setCustomTitle(e.target.value)
                }}
                placeholder={pe('titlePlaceholder')}
                className={styles.textInput}
              />
            </div>
            <span className={styles.staticPlotHint}>ℹ️ {pe('staticPlotHint')}</span>
          </div>
        </div>
      ) : (
        <>
          {/* Tab headers */}
          <div className={styles.editorTabs}>
            <button
              type="button"
              className={cx(styles.tabBtn, activeTab === 'titles' && styles.activeTab)}
              onClick={() => {
                setActiveTab('titles')
              }}
            >
              {pe('tabs.titles')}
            </button>
            <button
              type="button"
              className={cx(styles.tabBtn, activeTab === 'traces' && styles.activeTab)}
              onClick={() => {
                setActiveTab('traces')
              }}
            >
              {pe('tabs.traces')}
            </button>
            <button
              type="button"
              className={cx(styles.tabBtn, activeTab === 'grids' && styles.activeTab)}
              onClick={() => {
                setActiveTab('grids')
              }}
            >
              {pe('tabs.grids')}
            </button>
            <button
              type="button"
              className={cx(styles.tabBtn, activeTab === 'colors' && styles.activeTab)}
              onClick={() => {
                setActiveTab('colors')
              }}
            >
              {pe('tabs.colors')}
            </button>
          </div>

          {/* Tab contents */}
          {activeTab === 'titles' && (
            <div className={styles.tabContent}>
              <div className={styles.editorSection}>
                <div className={styles.sectionTitle}>{pe('section.titleSection')}</div>
                <div className={styles.editorRow}>
                  <div className={styles.editorField}>
                    <label>{pe('field.titleTarget')}</label>
                    <select
                      value={titleTarget}
                      onChange={e => {
                        setTitleTarget(e.target.value as 'plot' | 'x' | 'y')
                      }}
                      className={styles.selectInput}
                    >
                      <option value="plot">{pe('section.plotTitle')}</option>
                      <option value="x">{pe('section.xAxisTitle')}</option>
                      <option value="y">{pe('section.yAxisTitle')}</option>
                    </select>
                  </div>
                </div>
                <div className={styles.editorRow}>
                  <div className={cx(styles.editorField, styles.editorFieldWide)}>
                    <label>{pe('field.text')}</label>
                    <input
                      ref={targetRef}
                      type="text"
                      value={targetText}
                      onChange={e => {
                        setTargetText(e.target.value)
                      }}
                      placeholder={targetPlaceholder}
                      className={styles.textInput}
                    />
                  </div>
                  <div className={styles.editorField}>
                    <label>{pe('field.fontFamily')}</label>
                    <select
                      value={targetFontFamily}
                      onChange={e => {
                        setTargetFontFamily(e.target.value)
                      }}
                      className={styles.selectInput}
                    >
                      {FONT_FAMILIES.map(f => (
                        <option key={f} value={f}>
                          {fontOptionLabel(f, pe)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.editorField}>
                    <label>{pe('field.fontSize')}</label>
                    <select
                      value={targetFontSize}
                      onChange={e => {
                        setTargetFontSize(Number(e.target.value))
                      }}
                      className={styles.selectInput}
                    >
                      {targetFontSizes.map(sz => (
                        <option key={sz} value={sz}>
                          {sz}px
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.editorField}>
                    <label>{pe('field.color')}</label>
                    <input
                      type="color"
                      value={colorToHex(targetFontColor)}
                      onChange={e => {
                        setTargetFontColor(e.target.value)
                      }}
                      className={styles.colorInput}
                    />
                  </div>
                  <div className={styles.editorField}>
                    <label>{pe('field.format')}</label>
                    <div className={styles.formatBtnRow}>
                      <button
                        type="button"
                        className={cx(styles.iconBtn, targetFontBold && styles.activeBtn)}
                        onClick={() => {
                          setTargetFontBold(!targetFontBold)
                        }}
                        title={pe('field.bold')}
                      >
                        B
                      </button>
                      <button
                        type="button"
                        className={cx(styles.iconBtn, targetFontItalic && styles.activeBtn)}
                        onClick={() => {
                          setTargetFontItalic(!targetFontItalic)
                        }}
                        title={pe('field.italic')}
                      >
                        I
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'traces' && (
            <div className={styles.tabContent}>
              <div className={styles.editorSection}>
                <div className={styles.sectionTitle}>{pe('section.seriesSection')}</div>
                <div
                  className={styles.editorRow}
                  style={{
                    paddingBottom: 8,
                    marginBottom: 4,
                    borderBottom: '1px solid var(--color-border)'
                  }}
                >
                  <div className={styles.editorField}>
                    <label>{pe('field.pointSize')}</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <select
                        value={markerSize}
                        onChange={e => {
                          setMarkerSize(Number(e.target.value))
                        }}
                        className={styles.selectInput}
                      >
                        {[2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 24].map(sz => (
                          <option key={sz} value={sz}>
                            {sz}px
                          </option>
                        ))}
                      </select>
                      <input
                        type="range"
                        min={2}
                        max={24}
                        value={markerSize}
                        onChange={e => {
                          setMarkerSize(Number(e.target.value))
                        }}
                        style={{ cursor: 'pointer', width: 110 }}
                      />
                    </div>
                  </div>
                  {hasBoxTrace && (
                    <div className={styles.editorField}>
                      <label>{pe('field.boxWidth')}</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <select
                          value={boxWidth}
                          onChange={e => {
                            setBoxWidth(Number(e.target.value))
                          }}
                          className={styles.selectInput}
                        >
                          <option value={0}>{pe('field.boxWidthAuto')}</option>
                          {[0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map(w => (
                            <option key={w} value={w}>
                              {w}
                            </option>
                          ))}
                        </select>
                        <input
                          type="range"
                          min={0.1}
                          max={1}
                          step={0.05}
                          value={boxWidth || 0.5}
                          onChange={e => {
                            setBoxWidth(Number(e.target.value))
                          }}
                          style={{ cursor: 'pointer', width: 110 }}
                        />
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => {
                            setBoxWidth(0)
                          }}
                          disabled={boxWidth === 0}
                          title={pe('field.boxWidthReset')}
                          aria-label={pe('field.boxWidthReset')}
                        >
                          ↺
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {traceNames.length === 0 ? (
                  <span className={styles.mutedHint}>{pe('field.noSeries')}</span>
                ) : (
                  <>
                    <div className={styles.editorRow}>
                      <div className={styles.editorField}>
                        <label>{pe('field.seriesSelectLabel')}</label>
                        <select
                          value={activeTraceIdx}
                          onChange={e => {
                            setActiveTraceIndex(Number(e.target.value))
                          }}
                          className={styles.selectInput}
                        >
                          {traceNames.map((name, idx) => (
                            <option key={idx} value={idx}>
                              {pe('field.seriesLabel', { n: idx + 1 })} {name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className={cx(styles.editorRow, styles.traceRow)}>
                      <div className={cx(styles.editorField, styles.editorFieldFlex)}>
                        <label>{pe('field.seriesNameLabel')}</label>
                        <input
                          type="text"
                          value={traceNames[activeTraceIdx] ?? ''}
                          onChange={e => {
                            handleTraceNameChange(activeTraceIdx, e.target.value)
                          }}
                          className={styles.textInput}
                          placeholder={pe('field.seriesPlaceholder', { n: activeTraceIdx + 1 })}
                        />
                      </div>
                      <div className={styles.editorField}>
                        <label>{pe('field.color')}</label>
                        <input
                          type="color"
                          value={colorToHex(traceColors[activeTraceIdx])}
                          onChange={e => {
                            handleTraceColorChange(activeTraceIdx, e.target.value)
                          }}
                          className={styles.colorInput}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {activeTab === 'grids' && (
            <div className={styles.tabContent}>
              <div className={styles.editorSection}>
                <div className={styles.sectionTitle}>{pe('section.gridLegendSection')}</div>
                <div className={cx(styles.editorRow, styles.editorRowWideGap)}>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={showLegend}
                      onChange={e => {
                        setShowLegend(e.target.checked)
                      }}
                    />
                    {pe('field.showLegend')}
                  </label>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={showXGrid}
                      onChange={e => {
                        setShowXGrid(e.target.checked)
                      }}
                    />
                    {pe('field.showXGrid')}
                  </label>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={showYGrid}
                      onChange={e => {
                        setShowYGrid(e.target.checked)
                      }}
                    />
                    {pe('field.showYGrid')}
                  </label>
                </div>
              </div>

              <div className={styles.editorSection}>
                <div className={styles.sectionTitle}>{pe('section.gridScaleSection')}</div>
                <div className={styles.editorRow}>
                  <div className={styles.editorField}>
                    <label>{pe('field.gridColor')}</label>
                    <input
                      type="color"
                      value={colorToHex(gridColor)}
                      onChange={e => {
                        setGridColor(e.target.value)
                      }}
                      className={styles.colorInput}
                    />
                  </div>
                  <div className={styles.editorField}>
                    <label>{pe('field.tickFontSize')}</label>
                    <select
                      value={tickFontSize}
                      onChange={e => {
                        setTickFontSize(Number(e.target.value))
                      }}
                      className={styles.selectInput}
                    >
                      {TICK_FONT_SIZES.map(sz => (
                        <option key={sz} value={sz}>
                          {sz}px
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'colors' && (
            <div className={styles.tabContent}>
              <div className={styles.editorSection}>
                <div className={styles.sectionTitle}>{pe('section.bgColorsSection')}</div>
                <div className={styles.editorRow}>
                  <div className={styles.editorField}>
                    <label>{pe('field.plotBgColor')}</label>
                    <div className={styles.formatBtnRow}>
                      <input
                        type="color"
                        value={colorToHex(plotBgColor)}
                        onChange={e => {
                          setPlotBgColor(e.target.value)
                        }}
                        className={styles.colorInput}
                      />
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={() => {
                          setPlotBgColor('')
                        }}
                        disabled={!plotBgColor}
                        title={pe('field.clearColor')}
                        aria-label={pe('field.clearColor')}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className={styles.editorField}>
                    <label>{pe('field.paperBgColor')}</label>
                    <div className={styles.formatBtnRow}>
                      <input
                        type="color"
                        value={colorToHex(paperBgColor)}
                        onChange={e => {
                          setPaperBgColor(e.target.value)
                        }}
                        className={styles.colorInput}
                      />
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={() => {
                          setPaperBgColor('')
                        }}
                        disabled={!paperBgColor}
                        title={pe('field.clearColor')}
                        aria-label={pe('field.clearColor')}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.editorSection}>
                <div className={styles.sectionTitle}>{pe('section.presetsSection')}</div>
                <div className={styles.presetGrid}>
                  <button
                    type="button"
                    className={styles.presetBtn}
                    onClick={() => {
                      applyThemePreset('modern')
                    }}
                  >
                    {pe('preset.modern')}
                  </button>
                  <button
                    type="button"
                    className={styles.presetBtn}
                    onClick={() => {
                      applyThemePreset('apa')
                    }}
                  >
                    {pe('preset.apa')}
                  </button>
                  <button
                    type="button"
                    className={styles.presetBtn}
                    onClick={() => {
                      applyThemePreset('academic')
                    }}
                  >
                    {pe('preset.academic')}
                  </button>
                  <button
                    type="button"
                    className={styles.presetBtn}
                    onClick={() => {
                      applyThemePreset('grayscale')
                    }}
                  >
                    {pe('preset.grayscale')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
