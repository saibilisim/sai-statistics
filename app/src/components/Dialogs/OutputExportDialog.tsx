// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from './DialogBase'
import { useOutputStore } from '../../store/output-store'
import { exportOutputAs, type ExportFormat, type ExportScope } from '../../lib/output-export'
import i18nInstance from '../../i18n'
import dataStyles from './DataDialogs.module.css'

interface Props {
  onClose: () => void
}

const FORMATS: ExportFormat[] = ['html', 'pdf', 'word', 'excel', 'csv', 'markdown']

/**
 * Export Output dialog (File ▸ Export Output…) — the scope + format picker
 * the two dialog-less HTML/PDF menu items never had. Wraps exportOutputAs()
 * (src/lib/output-export.ts), which already knows how to build every format;
 * this component only collects scope/format/options and shows the result.
 */
export function OutputExportDialog({ onClose }: Props) {
  const { t } = useTranslation(['common', 'dialogs'])
  const blocks = useOutputStore(s => s.blocks)
  const selection = useOutputStore(s => s.selection)

  const selectedBlockIds = selection?.kind === 'blocks' ? selection.ids : []
  const [scopeKind, setScopeKind] = useState<'all' | 'selected'>(
    selectedBlockIds.length > 0 ? 'selected' : 'all'
  )
  const [format, setFormat] = useState<ExportFormat>('html')
  const [includeAiNotes, setIncludeAiNotes] = useState(false)
  const [includeHidden, setIncludeHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scope: ExportScope =
    scopeKind === 'selected' ? { kind: 'blocks', blockIds: selectedBlockIds } : { kind: 'all' }

  const handleOk = () => {
    setBusy(true)
    setError(null)
    void exportOutputAs(format, i18nInstance.t, scope, { includeAiNotes, includeHidden })
      .then(path => {
        if (path) onClose()
      })
      .catch(() => {
        setError(t('dialogs:outputExport.exportFailed'))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <DialogBase
      titleKey="dialogs:outputExport.title"
      onOk={handleOk}
      onCancel={onClose}
      okDisabled={busy || blocks.length === 0}
    >
      <div className={dataStyles.splitRoot}>
        <h3>{t('dialogs:outputExport.scope')}</h3>
        <label className={dataStyles.radioRow}>
          <input
            type="radio"
            name="exportScope"
            checked={scopeKind === 'all'}
            onChange={() => {
              setScopeKind('all')
            }}
          />
          {t('dialogs:outputExport.scopeAll', { count: blocks.length })}
        </label>
        <label className={dataStyles.radioRow}>
          <input
            type="radio"
            name="exportScope"
            disabled={selectedBlockIds.length === 0}
            checked={scopeKind === 'selected'}
            onChange={() => {
              setScopeKind('selected')
            }}
          />
          {selectedBlockIds.length > 0
            ? t('dialogs:outputExport.scopeSelected', { count: selectedBlockIds.length })
            : t('dialogs:outputExport.scopeSelectedEmpty')}
        </label>

        <h3>{t('dialogs:outputExport.format')}</h3>
        {FORMATS.map(fmt => (
          <label key={fmt} className={dataStyles.radioRow}>
            <input
              type="radio"
              name="exportFormat"
              checked={format === fmt}
              onChange={() => {
                setFormat(fmt)
              }}
            />
            {t(`dialogs:outputExport.formats.${fmt}`)}
          </label>
        ))}

        <h3>{t('dialogs:outputExport.options')}</h3>
        <label className={dataStyles.radioRow}>
          <input
            type="checkbox"
            checked={includeAiNotes}
            onChange={e => {
              setIncludeAiNotes(e.target.checked)
            }}
          />
          {t('dialogs:outputExport.includeAiNotes')}
        </label>
        <label className={dataStyles.radioRow}>
          <input
            type="checkbox"
            checked={includeHidden}
            onChange={e => {
              setIncludeHidden(e.target.checked)
            }}
          />
          {t('dialogs:outputExport.includeHidden')}
        </label>

        {blocks.length === 0 && <p className={dataStyles.emptyNote}>{t('output.empty')}</p>}
        {error && (
          <p className={dataStyles.limitationNote} role="alert">
            {error}
          </p>
        )}
      </div>
    </DialogBase>
  )
}
