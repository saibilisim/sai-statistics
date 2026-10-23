// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { useSettingsStore } from '../../store/settings-store'
import { ToolCallCard } from './ToolCallCard'
import { SyntaxProposalCard } from './SyntaxProposalCard'
import { CreditPurchaseCard } from './CreditPurchaseCard'
import { MarkdownText } from '../MarkdownText'
import { ContextMenu } from '../ContextMenu'
import { cx } from '../../lib/cx'
import { writeDualFlavor } from '../../lib/output-clipboard'
import {
  buildProseSelectionClipboard,
  type SelectionClipboardPayload
} from '../../lib/selection-clipboard'
import { ERROR_I18N_KEY, isSettingsActionable } from '../../lib/ai-errors'
import { CopyIcon, CheckIcon, SearchIcon, RefreshIcon } from './ai-icons'
import styles from './AIPanel.module.css'

/** Mesaj footer'ındaki saat — sohbet session-only olduğu için tarih değil
 * yalnız saat gösterilir (kullanıcının sistem yerel biçimi). */
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** Kullanıcı zaten en altta değilse (geçmişi okuyorken) streaming her delta'da
 * onu dibe zıplatmasın — yalnız zaten dibe yakınsa otomatik kaydır. */
const AUTO_SCROLL_THRESHOLD_PX = 80

/**
 * "Düşünüyor…" göstergesi + geçen süre sayacı. Yavaş modellerde ilk token
 * dakikalar sonra gelebiliyor; sabit bir metin donmuş görünüyordu, sayaç
 * beklemenin sürdüğünü kanıtlar. Sayı biçimi (m:ss) çeviri gerektirmez.
 */
function ThinkingIndicator({ label }: { label: string }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const startedAt = Date.now()
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => {
      clearInterval(id)
    }
  }, [])
  const elapsed = `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`
  return (
    <div className={cx(styles.messageContent, styles.thinking)} aria-live="polite">
      <span>{label}</span>
      <span className={styles.typingDots} aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {/* İlk saniyelerde sayaç gürültü olur; yalnız bekleme uzayınca çıkar. */}
      {seconds >= 5 && <span className={styles.thinkingElapsed}>{elapsed}</span>}
    </div>
  )
}

/** Preferences diyaloğunu AI sekmesinde açtırır (App.tsx 'sai:open-preferences' dinler). */
function openAiSettings(): void {
  window.dispatchEvent(new CustomEvent('sai:open-preferences', { detail: { category: 'ai' } }))
}

/** ChatMessageList — sohbet geçmişi; streaming sırasında alta otomatik kayar. */
export function ChatMessageList() {
  const { t } = useTranslation(['common'])
  const provider = useSettingsStore(s => s.settings.ai.provider)
  const messages = useChatStore(s => s.messages)
  const streamingMessageId = useChatStore(s => s.streamingMessageId)
  const isStreaming = useChatStore(s => s.isStreaming)
  const regenerateMessage = useChatStore(s => s.regenerateMessage)
  const sendMessage = useChatStore(s => s.sendMessage)
  const listRef = useRef<HTMLDivElement>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Streaming delta'ları messages state'ini güncelledikçe en alta kaydır —
  // ama yalnız kullanıcı zaten dibe yakınsa. Aksi halde geçmişi okurken her
  // token'da dibe zıplama "kayma" hissi veriyordu (kullanıcı geri bildirimi).
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  const handleCopy = (id: string, content: string): void => {
    void navigator.clipboard.writeText(content)
    setCopiedId(id)
    setTimeout(() => {
      setCopiedId(null)
    }, 2000)
  }

  // Ctrl+C and right-click ▸ Copy on a free text selection share ONE payload
  // builder, so both put exactly the same thing on the clipboard. The
  // browser's default copy carried the panel's inline theme styles into the
  // HTML flavor, and Electron shows no native context menu at all.
  const [selectionMenu, setSelectionMenu] = useState<{
    x: number
    y: number
    payload: SelectionClipboardPayload
  } | null>(null)

  /** The selection's payload, only when it lies inside the message list. */
  const currentSelectionPayload = (): SelectionClipboardPayload | null => {
    const sel = window.getSelection()
    const list = listRef.current
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !list) return null
    const range = sel.getRangeAt(0)
    if (!list.contains(range.startContainer) || !list.contains(range.endContainer)) return null
    return buildProseSelectionClipboard(sel)
  }

  const handleListCopy = (e: React.ClipboardEvent<HTMLDivElement>): void => {
    const payload = currentSelectionPayload()
    if (!payload) return
    e.clipboardData.setData('text/html', payload.html)
    e.clipboardData.setData('text/plain', payload.text)
    e.preventDefault()
  }

  const handleListContextMenu = (e: React.MouseEvent<HTMLDivElement>): void => {
    const payload = currentSelectionPayload()
    if (!payload) return
    e.preventDefault()
    setSelectionMenu({ x: e.clientX, y: e.clientY, payload })
  }

  const handleSelectText = (el: HTMLElement | null): void => {
    if (!el) return
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(el)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  if (messages.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyStateIcon} aria-hidden="true">
          AI
        </span>
        <span className={styles.emptyStateTitle}>{t('ai.panel.emptyTitle')}</span>
        <span className={styles.emptyStateHint}>{t('ai.panel.emptyHint')}</span>
      </div>
    )
  }

  return (
    <div
      className={styles.messageList}
      ref={listRef}
      onCopy={handleListCopy}
      onContextMenu={handleListContextMenu}
    >
      {selectionMenu && (
        <ContextMenu
          x={selectionMenu.x}
          y={selectionMenu.y}
          items={[
            {
              key: 'copy',
              label: t('common.copy'),
              icon: <CopyIcon size={13} />,
              onClick: () => {
                const { html, text } = selectionMenu.payload
                setSelectionMenu(null)
                void writeDualFlavor(html, text)
              }
            }
          ]}
          onClose={() => {
            setSelectionMenu(null)
          }}
        />
      )}
      {messages.map((m, index) => {
        // Yalnız en güncel tool olayı gösterilir — hepsi aynı satırda
        // birbirinin YERİNE geçer (yığılmaz). chat-store güncellenen olayı
        // listenin sonuna taşır, bu yüzden son eleman = en güncel olay.
        const lastToolEvent = m.toolEvents[m.toolEvents.length - 1]
        const isStreamingThis = m.id === streamingMessageId
        // Tool bitti ama model henüz yanıt yazmadıysa tur DEVAM ediyor: ikinci
        // provider round-trip'i (tool sonucunu yorumlama) uzun sürebilir.
        // Eskiden tool olayı geldiği anda "Düşünüyor…" göstergesi tamamen
        // kayboluyordu → panel "Değişkenler listeleniyor" kartında donmuş
        // görünüyordu (kullanıcı geri bildirimi 2026-08-14).
        const waitingForModel =
          isStreamingThis && m.content === '' && !m.error && lastToolEvent?.status !== 'running'
        return (
          <div key={m.id} className={cx(styles.message, styles[m.role])}>
            <span className={styles.messageRole}>
              {t(m.role === 'user' ? 'ai.message.roleUser' : 'ai.message.roleAssistant')}
            </span>
            {/* `key={ev.tool}` her farklı tool'a geçişte kartı yeniden monte
                eder, CSS bunu fade-in yapar. */}
            {lastToolEvent && <ToolCallCard key={lastToolEvent.tool} event={lastToolEvent} />}
            {/* Analiz/syntax tool'u başarıyla çalıştıysa ve stream bittiyse
              kullanıcıyı Output'a yönlendir — sonuçlar sohbette değil
              Output sekmesinde birikir. */}
            {m.role === 'assistant' &&
              m.id !== streamingMessageId &&
              m.toolEvents.some(
                ev =>
                  (ev.tool === 'run_analysis' || ev.tool === 'run_syntax') && ev.status === 'done'
              ) && (
                <div className={styles.toolOutputNotice} role="note">
                  {t('ai.tool.outputNotice')}
                </div>
              )}
            {/* propose_syntax onay kartları — Main asla kendisi çalıştırmaz;
              kullanıcı ✓/✗ ile karar verir. */}
            {(m.syntaxProposals ?? []).map(p => (
              <SyntaxProposalCard key={p.id} messageId={m.id} proposal={p} />
            ))}
            {m.content !== '' && (
              <div className={styles.messageContentWrapper}>
                <div className={styles.messageContent}>
                  {/* Asistan çıktısı markdown (tablo/başlık/liste) içerebilir;
                    kullanıcı mesajı ham metin kalır — girdiği `*`/`|` gibi
                    karakterler formatlamaya dönüşmesin. */}
                  {m.role === 'assistant' ? <MarkdownText text={m.content} /> : m.content}
                </div>
                {/* Footer: saat solda, eylem ikonları sağda — modern sohbet
                    istemcilerindeki gibi mesajın ALTINDA sabit bir satır
                    (eskiden hover'da üstte beliren yüzen kutuydu). */}
                <div className={styles.messageFooter}>
                  <span className={styles.messageTimestamp}>
                    {timeFormatter.format(new Date(m.createdAt))}
                  </span>
                  <div className={styles.messageActions}>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={() => {
                        handleCopy(m.id, m.content)
                      }}
                      title={t(copiedId === m.id ? 'ai.message.copied' : 'ai.message.copy')}
                    >
                      {copiedId === m.id ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={e => {
                        const el =
                          e.currentTarget.parentElement?.parentElement?.previousElementSibling
                        handleSelectText(el instanceof HTMLElement ? el : null)
                      }}
                      title={t('ai.message.selectText')}
                    >
                      <SearchIcon size={13} />
                    </button>
                    {/* Yeniden oluştur — yalnız listenin SON asistan mesajında
                        (ara bir mesajı yeniden üretmek sonrasını geçersiz kılar,
                        bkz. chat-store.ts regenerateMessage). "Silme" düğmesi
                        kaldırıldı, yerine daha faydalı bu eylem geldi. */}
                    {m.role === 'assistant' && index === messages.length - 1 && !isStreaming && (
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => {
                          void regenerateMessage(m.id)
                        }}
                        title={t('ai.message.regenerate')}
                      >
                        <RefreshIcon size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
            {/* Hata mesajı hover/tooltip yerine doğrudan chat cevabı olarak
              görünür — yerelleştirme burada (t()), store ham kod taşır. */}
            {m.error && (
              <div className={cx(styles.messageContent, styles.errorContent)} role="alert">
                {t(`ai.error.${ERROR_I18N_KEY[m.error.code]}`, { detail: m.error.message })}
              </div>
            )}
            {/* Adım sınırı: hata değil bilgi — yapılan iş kaydedildi (tool
              izi), "Devam et" yeni turda kaldığı yerden sürdürür. */}
            {m.notice === 'tool-round-limit' && (
              <div className={cx(styles.messageContent, styles.noticeContent)} role="status">
                {t('ai.notice.toolRoundLimit')}
                {index === messages.length - 1 && !isStreaming && (
                  <button
                    type="button"
                    className={styles.noticeContinueBtn}
                    onClick={() => {
                      void sendMessage(t('ai.notice.continueMessage'))
                    }}
                  >
                    {t('ai.notice.continue')}
                  </button>
                )}
              </div>
            )}
            {m.error && m.error.code === 'payment' && provider === 'server' ? (
              <CreditPurchaseCard />
            ) : (
              m.error &&
              isSettingsActionable(m.error.code) && (
                <button type="button" className={styles.errorSettingsBtn} onClick={openAiSettings}>
                  {t('ai.error.openSettings')}
                </button>
              )
            )}
            {/* Model henüz yanıt metnini dönmedi (ilk tur ya da tool sonrası
              yorum turu) — aksi halde asistan balonu donmuş görünür ve
              kullanıcı ilerleme olup olmadığını anlayamaz. */}
            {waitingForModel && <ThinkingIndicator label={t('ai.panel.thinking')} />}
          </div>
        )
      })}
    </div>
  )
}
