// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RPlotPanel — the Plots tab of the R side panel: plots captured from the R
 * console, newest first, click to enlarge, and an explicit "Send to Output"
 * per plot (the toolbar checkbox still auto-sends every plot when wanted),
 * plus Export (R redraws the plot as PNG/SVG/PDF at a chosen size).
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTerminalStore, type RPlot } from '../../store/terminal-store'
import { useDialogKeyboard } from '../../lib/use-dialog-keyboard'
import { CloseIcon, SaveIcon, SendIcon, TrashIcon } from './terminal-icons'
import { PlotExportDialog, type PlotExportSettings } from './PlotExportDialog'
import styles from './TerminalView.module.css'

interface RPlotPanelProps {
  onSendToOutput: (png: string) => void
}

export function RPlotPanel({ onSendToOutput }: RPlotPanelProps) {
  const { t } = useTranslation(['analysis', 'common'])
  const rPlots = useTerminalStore(s => s.rPlots)
  const [enlarged, setEnlarged] = useState<RPlot | null>(null)
  const [sentIds, setSentIds] = useState<ReadonlySet<number>>(new Set())
  const [exporting, setExporting] = useState<RPlot | null>(null)

  const send = (p: RPlot) => {
    onSendToOutput(p.png)
    setSentIds(prev => new Set(prev).add(p.id))
  }

  const exportPlot = (plotId: number, settings: PlotExportSettings) => {
    const out = useTerminalStore.getState()
    window.api.terminal
      .rPlotExport({ plotId, ...settings })
      .then(path => {
        if (path) {
          out.appendROutput('terminal.r.notice.plotSaved', 'notice', {
            file: path.split(/[\\/]/).pop() ?? path
          })
        }
      })
      .catch((err: unknown) => {
        const msg = String(err)
        out.appendROutput(
          /plot_gone/.test(msg)
            ? 'terminal.r.notice.plotGone'
            : 'terminal.r.notice.plotExportFailed',
          'notice',
          { detail: msg.replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '') }
        )
      })
  }

  const newestFirst = [...rPlots].reverse()

  return (
    <div className={styles.sideTabBody}>
      <div className={styles.sideTabToolbar}>
        <span>{t('terminal.r.plots.count', { count: rPlots.length })}</span>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => {
            useTerminalStore.getState().clearRPlots()
          }}
          disabled={rPlots.length === 0}
          title={t('terminal.r.plots.clear')}
          aria-label={t('terminal.r.plots.clear')}
        >
          <TrashIcon size={13} />
        </button>
      </div>
      <div className={styles.plotList}>
        {rPlots.length === 0 && (
          <div className={styles.sideEmpty}>{t('terminal.r.plots.empty')}</div>
        )}
        {newestFirst.map(p => (
          <figure key={p.id} className={styles.plotCard}>
            <button
              type="button"
              className={styles.plotThumbBtn}
              onClick={() => {
                setEnlarged(p)
              }}
              title={t('terminal.r.plots.enlarge')}
            >
              <img
                className={styles.plotImg}
                src={`data:image/png;base64,${p.png}`}
                alt={t('terminal.r.plotTitle')}
              />
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                send(p)
              }}
              disabled={sentIds.has(p.id)}
            >
              <SendIcon size={12} />
              {sentIds.has(p.id) ? t('terminal.r.plots.sent') : t('terminal.r.plots.sendToOutput')}
            </button>
            {p.rid !== undefined && (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => {
                  setExporting(p)
                }}
                title={t('terminal.r.plots.export')}
                aria-label={t('terminal.r.plots.export')}
              >
                <SaveIcon size={13} />
              </button>
            )}
          </figure>
        ))}
      </div>
      {exporting && exporting.rid !== undefined && (
        <PlotExportDialog
          onCancel={() => {
            setExporting(null)
          }}
          onExport={settings => {
            const rid = exporting.rid
            setExporting(null)
            if (rid !== undefined) exportPlot(rid, settings)
          }}
        />
      )}
      {enlarged && (
        <PlotLightbox
          plot={enlarged}
          sent={sentIds.has(enlarged.id)}
          onSend={() => {
            send(enlarged)
          }}
          onClose={() => {
            setEnlarged(null)
          }}
        />
      )}
    </div>
  )
}

function PlotLightbox({
  plot,
  sent,
  onSend,
  onClose
}: {
  plot: RPlot
  sent: boolean
  onSend: () => void
  onClose: () => void
}) {
  const { t } = useTranslation(['analysis', 'common'])
  const boxRef = useRef<HTMLDivElement>(null)
  useDialogKeyboard({ containerRef: boxRef, onCancel: onClose, onSubmit: onClose })
  useEffect(() => {
    boxRef.current?.focus()
  }, [])

  return (
    <div
      className={styles.lightboxOverlay}
      role="dialog"
      aria-modal="true"
      aria-label={t('terminal.r.plotTitle')}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={styles.lightbox} ref={boxRef} tabIndex={-1}>
        <div className={styles.lightboxBar}>
          <span>{t('terminal.r.plotTitle')}</span>
          <span className={styles.spacer} />
          <button type="button" className={styles.button} onClick={onSend} disabled={sent}>
            <SendIcon size={12} />
            {sent ? t('terminal.r.plots.sent') : t('terminal.r.plots.sendToOutput')}
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            title={t('common:common.close')}
            aria-label={t('common:common.close')}
          >
            <CloseIcon size={14} />
          </button>
        </div>
        <img
          className={styles.lightboxImg}
          src={`data:image/png;base64,${plot.png}`}
          alt={t('terminal.r.plotTitle')}
        />
      </div>
    </div>
  )
}
