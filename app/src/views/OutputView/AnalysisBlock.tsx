// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx'
import { useOutputStore, type OutputBlock } from '../../store/output-store'
import type { AnalysisResult } from '@shared/analysis-types'
import { translateOutputKey } from '../../lib/output-format'
import { OutputPlotView } from './OutputPlotView'
import { AiBlockControls, AiNoteBand } from './AiBlockControls'
import { EyeOffIcon, EyeIcon, RerunIcon, CopyIcon } from '../../components/ContextMenu'
import { OutputTableView } from './OutputTableView'
import { ANALYSIS_ID_TO_CHANNEL } from '../../analyses/_shared/analysis-channels'
import { dispatchMenu } from '../../lib/menu-dispatch'
import { ConfirmDialog } from '../../components/Dialogs/ConfirmDialog'
import { writeDualFlavor } from '../../lib/output-clipboard'
import { escapeClipboardHtml } from '../../lib/output-clipboard-html'
import styles from './OutputView.module.css'

function BlockSummary({ summary }: { summary: string }) {
  const parts = summary
    .split(' | ')
    .map(p => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null

  return (
    <div className={styles.blockSummaryContainer}>
      {parts.map((part, idx) => {
        const colonIdx = part.indexOf(':')
        if (colonIdx === -1) {
          return (
            <div key={idx} className={styles.summaryGroup}>
              <span className={styles.summaryValueChip}>{part}</span>
            </div>
          )
        }

        const rawLabel = part.slice(0, colonIdx).trim().replace(/:+$/, '')
        const rest = part
          .slice(colonIdx + 1)
          .replace(/^:+/, '')
          .trim()
        const vars = rest
          .split(',')
          .map(v => v.trim())
          .filter(Boolean)

        return (
          <div key={idx} className={styles.summaryGroup}>
            <span className={styles.summaryLabel}>{rawLabel}:</span>
            <div className={styles.summaryChips}>
              {vars.map((v, vIdx) => (
                <span key={vIdx} className={styles.summaryChip}>
                  {v}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function AnalysisBlock({
  block,
  isSelected,
  onSelect,
  onRemove
}: {
  block: OutputBlock
  isSelected: boolean
  onSelect: (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void
  onRemove: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const toggleCollapse = useOutputStore(s => s.toggleCollapse)
  const setBlockTitle = useOutputStore(s => s.setBlockTitle)
  const toggleBlockHidden = useOutputStore(s => s.toggleBlockHidden)
  const titleOverride = useOutputStore(s => s.edits[block.id]?.titleOverride)
  const isHidden = useOutputStore(s => s.edits[block.id]?.hidden === true)
  const [editingTitle, setEditingTitle] = useState(false)
  const [syntaxVisible, setSyntaxVisible] = useState(false)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const [syntaxCopied, setSyntaxCopied] = useState(false)

  const result: AnalysisResult = block.result
  const displayTitle = titleOverride ?? translateOutputKey(block.titleKey, t)
  const rerunChannel = ANALYSIS_ID_TO_CHANNEL[block.analysisId]

  // Writes block.syntax directly to the clipboard (both flavors) instead of
  // relying on a DOM text selection over the <pre> — a reliable one-click
  // path that can't be affected by the content pane's own selection-range
  // copy handling (OutputView.tsx's onCopy), which targets narrative/table
  // selections, not this fixed known string.
  const handleCopySyntax = async (): Promise<void> => {
    if (!block.syntax) return
    await writeDualFlavor(`<pre>${escapeClipboardHtml(block.syntax)}</pre>`, block.syntax)
    setSyntaxCopied(true)
    setTimeout(() => {
      setSyntaxCopied(false)
    }, 2000)
  }

  return (
    <div
      className={cx(styles.block, isHidden && styles.blockHidden)}
      id={`block-${block.id}`}
      role="region"
      aria-label={displayTitle}
      style={{ outline: isSelected ? '2px solid var(--color-accent)' : undefined }}
    >
      <div className={styles.blockHeader} onClick={onSelect}>
        <button
          className={styles.blockCollapseBtn}
          onClick={e => {
            e.stopPropagation()
            toggleCollapse(block.id)
          }}
          aria-label={block.isCollapsed ? t('output.expand') : t('output.collapse')}
        >
          {block.isCollapsed ? '▶' : '▼'}
        </button>
        {editingTitle ? (
          <input
            className={styles.blockTitle}
            autoFocus
            defaultValue={displayTitle}
            onClick={e => {
              e.stopPropagation()
            }}
            onBlur={e => {
              setBlockTitle(block.id, e.target.value)
              setEditingTitle(false)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setEditingTitle(false)
            }}
          />
        ) : (
          <div
            className={styles.blockTitle}
            onDoubleClick={e => {
              e.stopPropagation()
              setEditingTitle(true)
            }}
          >
            {displayTitle}
          </div>
        )}
        {isHidden && <span className={styles.hiddenTag}>{t('output.hideBlock')}</span>}
        <div className={styles.blockMeta}>
          {block.datasetName} · {new Date(block.timestamp).toLocaleTimeString()}
        </div>
        {block.isCollapsed && result.warnings.length > 0 && (
          <span
            className={styles.warningBadge}
            title={result.warnings.map(w => translateOutputKey(w, t)).join('\n')}
          >
            ⚠ {result.warnings.length}
          </span>
        )}
        <AiBlockControls block={block} />
        {rerunChannel && (
          <button
            className={styles.blockDeleteBtn}
            onClick={e => {
              e.stopPropagation()
              dispatchMenu(rerunChannel)
            }}
            aria-label={t('output.rerun')}
            title={t('output.rerun')}
          >
            <RerunIcon size={14} />
          </button>
        )}
        <button
          className={styles.blockDeleteBtn}
          onClick={e => {
            e.stopPropagation()
            toggleBlockHidden(block.id)
          }}
          aria-label={isHidden ? t('output.showBlock') : t('output.hideBlock')}
          title={isHidden ? t('output.showBlock') : t('output.hideBlock')}
        >
          {isHidden ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
        </button>
        <button
          className={styles.blockDeleteBtn}
          onClick={e => {
            e.stopPropagation()
            setRemoveConfirmOpen(true)
          }}
          aria-label={t('output.removeBlock')}
          title={t('output.removeBlock')}
        >
          ×
        </button>
      </div>

      {!isHidden && block.summary && <BlockSummary summary={block.summary} />}

      {!isHidden && !block.isCollapsed && (
        <div className={styles.blockBody}>
          {block.syntax && (
            <>
              <div className={styles.formatBtnRow}>
                <button
                  className={styles.syntaxToggle}
                  onClick={() => {
                    setSyntaxVisible(v => !v)
                  }}
                >
                  {syntaxVisible ? t('output.hideSyntax') : t('output.showSyntax')}
                </button>
                {syntaxVisible && (
                  <button
                    className={styles.copyBtn}
                    onClick={() => {
                      void handleCopySyntax()
                    }}
                    title={t('output.copySyntax')}
                  >
                    <CopyIcon size={12} />{' '}
                    {syntaxCopied ? t('output.syntaxCopied') : t('output.copySyntax')}
                  </button>
                )}
              </div>
              {syntaxVisible && <pre className={styles.syntaxBlock}>{block.syntax}</pre>}
            </>
          )}
          {result.warnings.length > 0 &&
            result.warnings.map((w, i) => (
              <div key={i} className={styles.warningRow}>
                ⚠ {translateOutputKey(w, t)}
              </div>
            ))}
          <AiNoteBand block={block} />
          {result.tables.map((table, i) => (
            <OutputTableView key={i} table={table} blockId={block.id} tableIndex={i} />
          ))}
          {result.plots.map((plot, i) => (
            <OutputPlotView key={i} plot={plot} />
          ))}
          {result.notes.length > 0 &&
            result.notes.map((n, i) => (
              <div
                key={i}
                style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}
              >
                {translateOutputKey(n, t)}
              </div>
            ))}
        </div>
      )}

      {removeConfirmOpen && (
        <ConfirmDialog
          titleKey="output.removeConfirmTitle"
          messageKey="output.removeConfirmMessage"
          danger
          onConfirm={() => {
            setRemoveConfirmOpen(false)
            onRemove()
          }}
          onCancel={() => {
            setRemoveConfirmOpen(false)
          }}
        />
      )}
    </div>
  )
}
