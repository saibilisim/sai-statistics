// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AiBlockControls.tsx — Output bloğu başlığındaki "✦ AI" butonu + üç
 * seçenekli menü (ai-entegrasyon-fizibilitesi.md §5.4 E/F/G):
 *
 *   1. Yorumla      → ai:interpret → yorum bloğa aiNote olarak işlenir.
 *   2. Soru sor…    → blok üzerinde küçük popover input; yanıt popover'da,
 *                     "Sohbete taşı" bağlantısıyla.
 *   3. Sohbette Aç  → AI paneli açılır + blok id'si chat-store.pendingMentions.
 *
 * AiNoteBand: bloğa işlenen aiNote'u katlanabilir bant olarak gösterir;
 * "AI-generated — verify" rozeti her zaman görünür (§10 risk tablosu).
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OutputBlock } from '../../store/output-store'
import { ContextMenu } from '../../components/ContextMenu'
import { MarkdownText } from '../../components/MarkdownText'
import {
  interpretAndAttachNote,
  openBlockInChat,
  requestBlockInterpretation
} from './ai-block-actions'
import styles from './OutputView.module.css'

// ─────────────────────────────────────────────────────────────
//  ✦ AI butonu + menü + soru popover'ı
// ─────────────────────────────────────────────────────────────

export function AiBlockControls({ block }: { block: OutputBlock }) {
  const { t } = useTranslation(['common', 'analysis'])
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [askOpen, setAskOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleInterpret() {
    setBusy(true)
    setError(null)
    try {
      const text = await interpretAndAttachNote(block)
      if (text === null)
        setError(t('ai.output.consentNeeded', { defaultValue: 'AI consent required' }))
    } catch {
      setError(t('ai.output.error', { defaultValue: 'AI request failed' }))
    } finally {
      setBusy(false)
    }
  }

  function handleOpenInChat() {
    openBlockInChat(block.id)
  }

  return (
    <>
      <button
        className={styles.aiBtn}
        disabled={busy}
        onClick={e => {
          e.stopPropagation()
          setMenuPos({ x: e.clientX, y: e.clientY })
        }}
        aria-label={t('ai.output.menuLabel', { defaultValue: 'AI actions' })}
        title={t('ai.output.menuLabel', { defaultValue: 'AI actions' })}
      >
        {busy ? '…' : '✦ AI'}
      </button>

      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={[
            {
              key: 'interpret',
              label: t('ai.output.interpret', { defaultValue: 'Yorumla' }),
              onClick: () => {
                void handleInterpret()
              }
            },
            {
              key: 'ask',
              label: t('ai.output.ask', { defaultValue: 'Soru sor…' }),
              onClick: () => {
                setAskOpen(true)
              }
            },
            {
              key: 'openInChat',
              label: t('ai.output.openInChat', { defaultValue: 'Sohbette Aç' }),
              onClick: handleOpenInChat
            }
          ]}
          onClose={() => {
            setMenuPos(null)
          }}
        />
      )}

      {askOpen && (
        <AiAskPopover
          block={block}
          onClose={() => {
            setAskOpen(false)
          }}
        />
      )}

      {error && (
        <div className={styles.aiErrorRow} role="alert">
          {error}
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────
//  Soru sor popover'ı (§5.4 F)
// ─────────────────────────────────────────────────────────────

function AiAskPopover({ block, onClose }: { block: OutputBlock; onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    const q = question.trim()
    if (!q || busy) return
    setBusy(true)
    setError(null)
    try {
      const text = await requestBlockInterpretation(block, q)
      if (text === null) {
        setError(t('ai.output.consentNeeded', { defaultValue: 'AI consent required' }))
      } else {
        setAnswer(text)
      }
    } catch {
      setError(t('ai.output.error', { defaultValue: 'AI request failed' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={styles.aiAskPopover}
      role="dialog"
      aria-label={t('ai.output.ask', { defaultValue: 'Soru sor…' })}
      onClick={e => {
        e.stopPropagation()
      }}
    >
      <div className={styles.aiAskRow}>
        <input
          className={styles.aiAskInput}
          value={question}
          autoFocus
          placeholder={t('ai.output.askPlaceholder', {
            defaultValue: 'Bu çıktı hakkında soru sor…'
          })}
          onChange={e => {
            setQuestion(e.target.value)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') void handleSubmit()
            if (e.key === 'Escape') onClose()
          }}
        />
        <button
          className={styles.navActionBtn}
          disabled={busy || question.trim().length === 0}
          onClick={() => {
            void handleSubmit()
          }}
        >
          {busy ? '…' : t('ai.output.askSubmit', { defaultValue: 'Sor' })}
        </button>
        <button
          className={styles.navActionBtn}
          onClick={onClose}
          aria-label={t('common.close', { defaultValue: 'Kapat' })}
        >
          ×
        </button>
      </div>

      {error && (
        <div className={styles.aiAskError} role="alert">
          {error}
        </div>
      )}

      {answer && (
        <div className={styles.aiAskAnswer}>
          <div className={styles.aiNoteText}>
            <MarkdownText text={answer} />
          </div>
          <button
            className={styles.aiLinkBtn}
            onClick={() => {
              openBlockInChat(block.id)
            }}
          >
            {t('ai.output.moveToChat', { defaultValue: 'Sohbete taşı' })}
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
//  AI Yorumu bandı (§5.4 E — bloğa işlenen kalıcı not)
// ─────────────────────────────────────────────────────────────

export function AiNoteBand({ block }: { block: OutputBlock }) {
  const { t } = useTranslation(['common', 'analysis'])
  const [isCollapsed, setIsCollapsed] = useState(false)
  const note = block.aiNote
  if (!note) return null

  return (
    <div className={styles.aiNoteBand}>
      <div className={styles.aiNoteHeader}>
        <button
          className={styles.blockCollapseBtn}
          onClick={() => {
            setIsCollapsed(c => !c)
          }}
          aria-label={isCollapsed ? t('output.expand') : t('output.collapse')}
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
        <span className={styles.aiNoteTitle}>
          ✦ {t('ai.output.noteTitle', { defaultValue: 'AI Yorumu' })}
        </span>
        <span className={styles.aiNoteBadge}>
          {t('ai.output.generatedBadge', { defaultValue: 'AI-generated — verify' })}
        </span>
        <span className={styles.aiNoteMeta}>{new Date(note.createdAt).toLocaleTimeString()}</span>
      </div>
      {!isCollapsed && (
        <div className={styles.aiNoteText}>
          <MarkdownText text={note.text} />
        </div>
      )}
    </div>
  )
}
