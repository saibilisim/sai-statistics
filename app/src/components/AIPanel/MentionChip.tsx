// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { useOutputStore } from '../../store/output-store'
import { XIcon } from './ai-icons'
import styles from './AIPanel.module.css'

interface MentionChipProps {
  blockId: string
}

/**
 * MentionChip — chat input'taki Output blok referansı (spec §5.4, F3).
 * Blok başlığını output-store'dan çözer; blok silinmişse id'yi gösterir.
 */
export function MentionChip({ blockId }: MentionChipProps) {
  const { t } = useTranslation(['common', 'analysis'])
  const removeMention = useChatStore(s => s.removeMention)
  const block = useOutputStore(s => s.blocks.find(b => b.id === blockId))
  const label = block ? String(t(block.titleKey as never)) : blockId

  return (
    <span className={styles.mentionChip}>
      <span className={styles.mentionLabel}>{label}</span>
      <button
        className={styles.mentionRemove}
        onClick={() => {
          removeMention(blockId)
        }}
        aria-label={t('ai.mention.remove')}
      >
        <XIcon size={11} />
      </button>
    </span>
  )
}
