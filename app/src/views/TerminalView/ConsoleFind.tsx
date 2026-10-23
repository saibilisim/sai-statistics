// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ConsoleFind — find in the R console output. Matches are painted with the
 * CSS Custom Highlight API (no DOM rewrite, so selection/copy and the chunk
 * list stay untouched); Enter / Shift+Enter walk through them.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './TerminalView.module.css'

const ALL = 'sai-console-find'
const CURRENT = 'sai-console-find-current'

/** Ranges of every case-insensitive occurrence of `query` under `root`. */
function findRanges(root: HTMLElement, query: string): Range[] {
  const q = query.toLowerCase()
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? '').toLowerCase()
    for (let i = text.indexOf(q); i !== -1; i = text.indexOf(q, i + q.length)) {
      const r = document.createRange()
      r.setStart(node, i)
      r.setEnd(node, i + q.length)
      ranges.push(r)
    }
  }
  return ranges
}

function clearHighlights(): void {
  CSS.highlights.delete(ALL)
  CSS.highlights.delete(CURRENT)
}

export function ConsoleFind({
  containerRef,
  version
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Changes whenever the output changes (re-search). */
  version: unknown
}) {
  const { t } = useTranslation(['analysis'])
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(0)
  const [index, setIndex] = useState(0)
  const rangesRef = useRef<Range[]>([])

  useEffect(() => {
    const root = containerRef.current
    if (!root || query.trim() === '') {
      rangesRef.current = []
      setCount(0)
      clearHighlights()
      return
    }
    const ranges = findRanges(root, query)
    rangesRef.current = ranges
    setCount(ranges.length)
    setIndex(i => (ranges.length === 0 ? 0 : Math.min(i, ranges.length - 1)))
    CSS.highlights.set(ALL, new Highlight(...ranges))
  }, [containerRef, query, version])

  // The current match: its own highlight, scrolled into view.
  useEffect(() => {
    const r = rangesRef.current[index]
    if (!r) {
      CSS.highlights.delete(CURRENT)
      return
    }
    CSS.highlights.set(CURRENT, new Highlight(r))
    r.startContainer.parentElement?.scrollIntoView({ block: 'nearest' })
  }, [index, count])

  useEffect(() => clearHighlights, [])

  const step = (dir: 1 | -1) => {
    if (count === 0) return
    setIndex(i => (i + dir + count) % count)
  }

  return (
    <span className={styles.consoleFind}>
      <input
        type="search"
        className={styles.consoleFindInput}
        value={query}
        onChange={e => {
          setQuery(e.target.value)
          setIndex(0)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          }
        }}
        placeholder={t('terminal.r.find.placeholder')}
        aria-label={t('terminal.r.find.placeholder')}
      />
      {query.trim() !== '' && (
        <span className={styles.consoleFindCount} aria-live="polite">
          {count === 0
            ? t('terminal.r.find.none')
            : t('terminal.r.find.count', { index: index + 1, count })}
        </span>
      )}
    </span>
  )
}
