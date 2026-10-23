// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useTranslation } from 'react-i18next'
import type { AiToolEvent } from '@shared/ai-types'
import { SpinnerIcon, CheckIcon, AlertIcon } from './ai-icons'
import styles from './AIPanel.module.css'

interface ToolCallCardProps {
  event: AiToolEvent
}

/**
 * ToolCallCard — agent tool olayının tek satırlık durum göstergesi (spec §3,
 * F2 üretir). ChatMessageList bunu sıraya dizip biriktirmez; her yeni tool
 * olayı `key={event.tool}` değiştiği için aynı konumda öncekinin YERİNE
 * geçer (Claude Code'daki "Metadata yükleniyor… → Analiz yapılıyor…" akışı).
 */
export function ToolCallCard({ event }: ToolCallCardProps) {
  const { t } = useTranslation(['common'])
  return (
    <div className={styles.toolCard} data-status={event.status}>
      <span className={styles.toolStatus} aria-hidden="true">
        {event.status === 'running' && <SpinnerIcon size={12} />}
        {event.status === 'done' && <CheckIcon size={12} />}
        {event.status === 'error' && <AlertIcon size={12} />}
      </span>
      <span className={styles.toolLabel}>{String(t(event.label as never))}</span>
    </div>
  )
}
