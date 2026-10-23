// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore, type AiSyntaxProposalEntry } from '../../store/chat-store'
import { useTerminalStore } from '../../store/terminal-store'
import { useUIStore } from '../../store/ui-store'
import { highlightCode } from '../../lib/code-highlight'
import { CheckIcon, XIcon, CopyIcon, EditIcon, ExternalIcon } from './ai-icons'
import markdownStyles from '../MarkdownText.module.css'
import styles from './AIPanel.module.css'

interface SyntaxProposalCardProps {
  messageId: string
  proposal: AiSyntaxProposalEntry
}

/**
 * SyntaxProposalCard — propose_syntax onay kartı (F2). Main syntax'ı asla
 * kendisi çalıştırmaz; kullanıcı ✓ ile kabul ederse chat-store
 * runSpssSyntax (Terminal ile aynı hat) üzerinden yürütür, ✗ kartı kapatır.
 *
 * 2026-08-14 (kullanıcı geri bildirimi: "çalıştır dedim hata verdi, sonra
 * syntax'ı kopyalayamadım, değiştiremedim"): kart artık çıkmaz sokak değil —
 * syntax kopyalanabilir, kart üzerinde düzenlenip yeniden çalıştırılabilir ve
 * tek düğmeyle Sözdizimi (Terminal) sekmesine aktarılabilir. Hata satırlarının
 * TAMAMI gösterilir, yalnız ilki değil.
 *
 * propose_r_code (language 'r', 2026-10-18): aynı kart, ama ÇALIŞTIRMA YOK —
 * birincil eylem kodu R betik editörüne göndermek; kullanıcı orada görüp
 * kendisi çalıştırır (CLAUDE.md §9). Gönderilen kart yine gönderilebilir.
 */
export function SyntaxProposalCard({ messageId, proposal }: SyntaxProposalCardProps) {
  const { t } = useTranslation(['common', 'analysis'])
  const acceptSyntaxProposal = useChatStore(s => s.acceptSyntaxProposal)
  const rejectSyntaxProposal = useChatStore(s => s.rejectSyntaxProposal)
  const updateSyntaxProposal = useChatStore(s => s.updateSyntaxProposal)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)

  const isPending = proposal.status === 'pending'
  const isR = proposal.language === 'r'

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(proposal.syntax)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  // Analiz diyaloglarının "Sözdizimine Aktar" düğmesiyle aynı hat: Terminal
  // sekmesinin tamponuna ekle + o sekmeye geç. Orada tam log, düzenleme ve
  // yeniden çalıştırma var — hatalı bir öneriyi kurtarmanın yolu.
  const handleSendToSyntaxTab = (): void => {
    useTerminalStore.getState().appendSyntax(proposal.syntax)
    useUIStore.getState().setActiveTab('terminal')
  }

  return (
    <div className={styles.syntaxProposal} data-status={proposal.status}>
      {proposal.description && (
        <div className={styles.syntaxProposalDesc}>{proposal.description}</div>
      )}
      {editing ? (
        <textarea
          className={styles.syntaxProposalEditor}
          value={proposal.syntax}
          spellCheck={false}
          aria-label={t('ai.proposal.edit')}
          rows={Math.min(14, proposal.syntax.split('\n').length + 1)}
          onChange={e => {
            updateSyntaxProposal(messageId, proposal.id, e.target.value)
          }}
        />
      ) : (
        /* Kod bloğu ile aynı renklendirme (tek tokenizer kaynağı:
           code-highlight.ts) — onay kartındaki kod, sohbetteki ```spss /
           ```r bloğuyla aynı görünsün. */
        <pre className={styles.syntaxProposalCode}>
          {highlightCode(proposal.syntax, isR ? 'r' : 'spss').map((tok, i) =>
            tok.kind === 'plain' ? (
              tok.text
            ) : (
              <span key={i} className={markdownStyles[`tok_${tok.kind}`]}>
                {tok.text}
              </span>
            )
          )}
        </pre>
      )}
      {/* Çalıştırma hataları — durum pending kalır, kullanıcı düzeltip ✓ ile
          yeniden deneyebilir. Ham i18n anahtarları burada çözümlenir. */}
      {proposal.errors && proposal.errors.length > 0 && (
        <div className={styles.syntaxProposalError} role="alert">
          {proposal.errors.map((err, i) => (
            <div key={i}>{t(err.key as never, { ns: 'analysis', ...err.params })}</div>
          ))}
        </div>
      )}
      <div className={styles.syntaxProposalActions}>
        {isR && (
          <button
            type="button"
            className={styles.actionBtn}
            title={t('ai.proposal.toRScript')}
            aria-label={t('ai.proposal.toRScript')}
            onClick={() => {
              void acceptSyntaxProposal(messageId, proposal.id)
            }}
          >
            <ExternalIcon size={13} />
          </button>
        )}
        {isR && isPending && (
          <button
            type="button"
            className={styles.actionBtn}
            title={t(editing ? 'ai.proposal.editDone' : 'ai.proposal.edit')}
            aria-pressed={editing}
            onClick={() => {
              setEditing(v => !v)
            }}
          >
            <EditIcon size={13} />
          </button>
        )}
        {!isR && isPending && (
          <>
            <button
              type="button"
              className={styles.actionBtn}
              title={t('ai.proposal.accept')}
              onClick={() => {
                void acceptSyntaxProposal(messageId, proposal.id)
              }}
            >
              <CheckIcon size={13} />
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              title={t(editing ? 'ai.proposal.editDone' : 'ai.proposal.edit')}
              aria-pressed={editing}
              onClick={() => {
                setEditing(v => !v)
              }}
            >
              <EditIcon size={13} />
            </button>
          </>
        )}
        {/* Kopyala/aktar kabul edilmiş ya da reddedilmiş kartta da çalışır —
            kayıt olarak duran syntax hâlâ işe yarar. */}
        <button
          type="button"
          className={styles.actionBtn}
          title={t(
            copied ? 'ai.message.copied' : isR ? 'ai.proposal.copyCode' : 'ai.proposal.copy'
          )}
          onClick={handleCopy}
        >
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
        </button>
        {!isR && (
          <button
            type="button"
            className={styles.actionBtn}
            title={t('ai.proposal.toSyntaxTab')}
            onClick={handleSendToSyntaxTab}
          >
            <ExternalIcon size={13} />
          </button>
        )}
        {isPending ? (
          <button
            type="button"
            className={styles.actionBtn}
            title={t('ai.proposal.reject')}
            onClick={() => {
              rejectSyntaxProposal(messageId, proposal.id)
            }}
          >
            <XIcon size={13} />
          </button>
        ) : (
          <span className={styles.syntaxProposalStatus}>
            {proposal.status === 'accepted' ? (
              <>
                <CheckIcon size={12} />{' '}
                {t(isR ? 'ai.proposal.sentToRScript' : 'ai.proposal.accepted')}
              </>
            ) : (
              <>
                <XIcon size={12} /> {t('ai.proposal.rejected')}
              </>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
