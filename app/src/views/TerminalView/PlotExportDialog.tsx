// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PlotExportDialog — format + size for exporting an R console plot. R redraws
 * the recorded plot (not the on-screen PNG), so the file is sharp at any size:
 * PNG at the chosen DPI, SVG/PDF as vectors. Sizes in cm (publication habit).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from '../../components/Dialogs/DialogBase'
import styles from './TerminalView.module.css'

export type PlotFormat = 'png' | 'svg' | 'pdf'

export interface PlotExportSettings {
  format: PlotFormat
  widthCm: number
  heightCm: number
  dpi: number
}

// Remembered for the session — exporting several plots alike is the norm.
let lastSettings: PlotExportSettings = { format: 'png', widthCm: 16, heightCm: 10, dpi: 300 }

const FORMATS: PlotFormat[] = ['png', 'svg', 'pdf']

function inRange(n: number, lo: number, hi: number): boolean {
  return Number.isFinite(n) && n >= lo && n <= hi
}

export function PlotExportDialog({
  onExport,
  onCancel
}: {
  onExport: (settings: PlotExportSettings) => void
  onCancel: () => void
}) {
  const { t } = useTranslation(['analysis'])
  const [s, setS] = useState<PlotExportSettings>(lastSettings)
  const valid =
    inRange(s.widthCm, 1, 100) &&
    inRange(s.heightCm, 1, 100) &&
    (s.format !== 'png' || (Number.isInteger(s.dpi) && inRange(s.dpi, 72, 1200)))

  const num = (key: 'widthCm' | 'heightCm' | 'dpi') => (e: React.ChangeEvent<HTMLInputElement>) => {
    setS(prev => ({ ...prev, [key]: Number(e.target.value) }))
  }

  return (
    <DialogBase
      titleKey="analysis:terminal.r.plotExport.title"
      okDisabled={!valid}
      onOk={() => {
        if (!valid) return
        lastSettings = s
        onExport(s)
      }}
      onCancel={onCancel}
    >
      <fieldset className={styles.exportFormats}>
        <legend className={styles.fieldLabel}>{t('terminal.r.plotExport.format')}</legend>
        {FORMATS.map(f => (
          <label key={f} className={styles.toggle}>
            <input
              type="radio"
              name="plot-format"
              checked={s.format === f}
              onChange={() => {
                setS(prev => ({ ...prev, format: f }))
              }}
            />
            {t(`terminal.r.plotExport.fmt.${f}`)}
          </label>
        ))}
      </fieldset>
      <div className={styles.exportGrid}>
        <label className={styles.fieldLabel} htmlFor="plot-w">
          {t('terminal.r.plotExport.width')}
        </label>
        <input
          id="plot-w"
          type="number"
          min={1}
          max={100}
          step={0.5}
          className={styles.fieldInput}
          value={s.widthCm}
          onChange={num('widthCm')}
        />
        <label className={styles.fieldLabel} htmlFor="plot-h">
          {t('terminal.r.plotExport.height')}
        </label>
        <input
          id="plot-h"
          type="number"
          min={1}
          max={100}
          step={0.5}
          className={styles.fieldInput}
          value={s.heightCm}
          onChange={num('heightCm')}
        />
        <label className={styles.fieldLabel} htmlFor="plot-dpi">
          {t('terminal.r.plotExport.dpi')}
        </label>
        <input
          id="plot-dpi"
          type="number"
          min={72}
          max={1200}
          step={1}
          className={styles.fieldInput}
          value={s.dpi}
          disabled={s.format !== 'png'}
          onChange={num('dpi')}
        />
      </div>
      <p className={styles.exportHint}>
        {s.format === 'png'
          ? t('terminal.r.plotExport.pngHint', {
              w: Math.round((s.widthCm / 2.54) * s.dpi),
              h: Math.round((s.heightCm / 2.54) * s.dpi)
            })
          : t('terminal.r.plotExport.vectorHint')}
      </p>
    </DialogBase>
  )
}
