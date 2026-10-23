// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { MentionChip } from './MentionChip'
import { SendIcon, StopIcon } from './ai-icons'
import styles from './AIPanel.module.css'

interface ChatInputProps {
  disabled?: boolean
}

const TEXTAREA_MAX_HEIGHT = 160

/**
 * ChatInput — mesaj girişi + mention chip'leri + gönder/iptal.
 * Enter gönderir, Shift+Enter yeni satır. Textarea içerik boyunca büyür
 * (modern kompozer davranışı), TEXTAREA_MAX_HEIGHT'te iç kaydırmaya döner.
 */
export function ChatInput({ disabled = false }: ChatInputProps) {
  const { t } = useTranslation(['common'])
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isStreaming = useChatStore(s => s.isStreaming)
  const pendingMentions = useChatStore(s => s.pendingMentions)
  const sendMessage = useChatStore(s => s.sendMessage)
  const cancelStreaming = useChatStore(s => s.cancelStreaming)

  const canSend = !disabled && !isStreaming && draft.trim() !== ''

  const autoGrow = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto'
    el.style.height = `${String(Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT))}px`
  }

  const handleSend = (): void => {
    if (!canSend) return
    setDraft('')
    void sendMessage(draft)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  return (
    <div className={styles.inputArea}>
      {pendingMentions.length > 0 && (
        <div className={styles.mentionRow}>
          {pendingMentions.map(blockId => (
            <MentionChip key={blockId} blockId={blockId} />
          ))}
        </div>
      )}
      <div className={styles.composer}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={draft}
          disabled={disabled}
          placeholder={t('ai.input.placeholder')}
          rows={1}
          onChange={e => {
            setDraft(e.target.value)
            autoGrow(e.target)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        {isStreaming ? (
          <button
            type="button"
            className={styles.sendBtn}
            onClick={cancelStreaming}
            title={t('ai.input.cancel')}
            aria-label={t('ai.input.cancel')}
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="button"
            className={styles.sendBtn}
            disabled={!canSend}
            onClick={handleSend}
            title={t('ai.input.send')}
            aria-label={t('ai.input.send')}
          >
            <SendIcon />
          </button>
        )}
      </div>
    </div>
  )
}
