// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MarkdownText — LLM çıktısındaki markdown'ı (başlıklar, kalın/italik,
 * listeler, kod, GFM tabloları) gerçek HTML olarak render eder.
 *
 * AI yanıtları (sohbet balonları, AI Yorumu bandı, soru-cevap popover'ı)
 * modele markdown ürettirir; ham metin olarak basınca `| --- |` tabloları
 * okunamaz hale geliyordu. react-markdown varsayılan olarak ham HTML'e
 * izin VERMEZ (rehype-raw yok) — model çıktısından XSS riski taşımaz.
 *
 * Sunum kararları (2026-08-13):
 * - Kod blokları başlıklı bir kart: dil etiketi + kopyala düğmesi, gövdede
 *   `code-highlight.ts` tokenlarıyla sözdizimi renklendirmesi.
 * - Tablolar kendi kaydırma kabuğunda; sayısal SÜTUNLAR (başlığı dahil) sağa
 *   yaslı ve `tabular-nums` (istatistik çıktısında rakamlar alt alta
 *   hizalansın, başlık da değerlerle aynı kenara dayansın).
 * - Bağlantılar gezinmez (Electron'da `will-navigate` zaten bloklu);
 *   URL `title` olarak görünür, metin seçilip kopyalanabilir.
 */

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { CopyIcon, CheckIcon, TableIcon } from './AIPanel/ai-icons'
import { detectLanguage, highlightCode, languageLabel } from '../lib/code-highlight'
import { writeDualFlavor } from '../lib/output-clipboard'
import { styleTablesForClipboard } from '../lib/selection-clipboard'
import styles from './MarkdownText.module.css'

/** `pre > code` alt ağacından düz metni çıkarır (kod bloğunu kopyalamak için). */
function getPlainText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(getPlainText).join('')
  if (node !== null && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props
    return getPlainText(props?.children)
  }
  return ''
}

/** `pre`'nin tek çocuğu olan `<code class="language-…">` etiketini okur. */
function getCodeClassName(node: ReactNode): string | undefined {
  const child = Array.isArray(node) ? (node as ReactNode[])[0] : node
  if (child !== null && child !== undefined && typeof child === 'object' && 'props' in child) {
    const className = (child as { props?: { className?: unknown } }).props?.className
    if (typeof className === 'string') return className
  }
  return undefined
}

/** Sayı gibi görünen hücre (p değeri, yüzde, yıldızlı katsayı dahil). */
const NUMERIC_CELL_RE = /^[<>≤≥=]? ?[-+]?(?:\d[\d.,]*|[.,]\d+)(?:[eE][-+]?\d+)? ?[*%]{0,3}$/

// ── Tablo sütun hizası ──────────────────────────────────────────────────
//
// Hücre bazlı karar yetmiyor: "48.20" sağa yaslanıp başlığı ("Ortalama")
// solda kalınca sütun kırık görünüyor. Bu yüzden karar SÜTUN düzeyinde
// verilir ve başlık hücresi de aynı hizayı alır. Sütun numarasını bulmak
// için react-markdown'ın her bileşene geçirdiği hast düğümü kullanılır:
// `table` bileşeni ağacı bir kez gezip her hücre düğümüne sütun indeksi
// atar, `th`/`td` kendi düğümünü bu haritada arar (düğüm nesneleri aynı
// referanslardır).

/** react-markdown'ın geçirdiği hast düğümünün ihtiyacımız olan yüzeyi. */
interface HastNodeLike {
  tagName?: string
  value?: string
  children?: HastNodeLike[]
}

interface TableColumnInfo {
  numericColumns: ReadonlySet<number>
  columnOf: ReadonlyMap<HastNodeLike, number>
}

const TableColumnContext = createContext<TableColumnInfo | null>(null)

function hastText(node: HastNodeLike): string {
  if (typeof node.value === 'string') return node.value
  return (node.children ?? []).map(hastText).join('')
}

function isNumericText(text: string): boolean {
  const trimmed = text.trim()
  return trimmed !== '' && NUMERIC_CELL_RE.test(trimmed)
}

/** thead/tbody/tfoot sarmalayıcılarını atlayarak tüm `tr` düğümlerini toplar. */
function collectRows(parent: HastNodeLike, rows: HastNodeLike[] = []): HastNodeLike[] {
  for (const child of parent.children ?? []) {
    if (child.tagName === 'tr') rows.push(child)
    else if (child.tagName === 'thead' || child.tagName === 'tbody' || child.tagName === 'tfoot')
      collectRows(child, rows)
  }
  return rows
}

/** Her hücreye sütun indeksi atar; gövdesi tamamen sayısal olan sütunları işaretler. */
function analyzeTable(node: HastNodeLike | undefined): TableColumnInfo {
  const columnOf = new Map<HastNodeLike, number>()
  const numeric = new Map<number, boolean>()
  if (!node) return { numericColumns: new Set(), columnOf }

  const rows = collectRows(node)

  for (const row of rows) {
    let col = 0
    for (const cell of row.children ?? []) {
      if (cell.tagName !== 'th' && cell.tagName !== 'td') continue
      columnOf.set(cell, col)
      // Yalnız gövde hücreleri sütunun türünü belirler; başlık metni
      // ("N", "p") sayısal olmadığı için karara katılmaz.
      if (cell.tagName === 'td') {
        const text = hastText(cell).trim()
        if (text !== '') numeric.set(col, (numeric.get(col) ?? true) && isNumericText(text))
      }
      col += 1
    }
  }

  const numericColumns = new Set<number>()
  for (const [col, isNum] of numeric) if (isNum) numericColumns.add(col)
  return { numericColumns, columnOf }
}

/** Hücrenin (th/td) sütunu sayısal mı — bağlamdan okur. */
function useIsNumericColumn(node: unknown): boolean {
  const info = useContext(TableColumnContext)
  if (!info) return false
  const col = info.columnOf.get(node as HastNodeLike)
  return col !== undefined && info.numericColumns.has(col)
}

/**
 * Tabloyu TSV'ye çevirir — sekmeyle ayrılmış metin Excel/LibreOffice ve
 * uygulamanın kendi Data View'ı tarafından doğrudan hücrelere yapıştırılır
 * (markdown `|` boru çizgileri tek hücreye düşüyordu).
 */
function tableToTsv(node: HastNodeLike | undefined): string {
  if (!node) return ''
  return collectRows(node)
    .map(row =>
      (row.children ?? [])
        .filter(cell => cell.tagName === 'th' || cell.tagName === 'td')
        // Hücre içi sekme/satır sonu TSV'yi bozar — boşluğa indirgenir.
        .map(cell => hastText(cell).replace(/\s+/g, ' ').trim())
        .join('\t')
    )
    .join('\n')
}

function MarkdownTable({ node, children }: { node?: unknown; children?: ReactNode }) {
  const { t } = useTranslation(['common'])
  const [copied, setCopied] = useState(false)
  const hastNode = node as HastNodeLike | undefined
  const info = useMemo(() => analyzeTable(hastNode), [hastNode])
  const tableRef = useRef<HTMLTableElement>(null)

  // İki biçim birden: Excel/Data View TSV'yi hücrelere böler; Word/Outlook
  // ise HTML tabloyu alır — yalnız TSV yapıştırınca sekmeler orada
  // hizasız kalıp sütunlar iç içe giriyordu.
  const handleCopy = (): void => {
    const tsv = tableToTsv(hastNode)
    const clone = tableRef.current?.cloneNode(true) as HTMLTableElement | undefined
    if (clone) {
      clone.querySelectorAll('*').forEach(el => {
        el.removeAttribute('class')
        el.removeAttribute('style')
      })
      const holder = document.createElement('div')
      holder.appendChild(clone)
      styleTablesForClipboard(holder)
      void writeDualFlavor(holder.innerHTML, tsv)
    } else {
      void navigator.clipboard.writeText(tsv)
    }
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  return (
    <div className={styles.tableBlock}>
      <button
        type="button"
        className={styles.tableCopyBtn}
        onClick={handleCopy}
        title={t(copied ? 'ai.message.copied' : 'ai.message.copyTable')}
      >
        {copied ? <CheckIcon size={12} /> : <TableIcon size={12} />}
      </button>
      <div className={styles.tableWrap}>
        <TableColumnContext.Provider value={info}>
          <table ref={tableRef}>{children}</table>
        </TableColumnContext.Provider>
      </div>
    </div>
  )
}

function MarkdownTh({ node, children }: { node?: unknown; children?: ReactNode }) {
  return <th data-numeric={useIsNumericColumn(node)}>{children}</th>
}

function MarkdownTd({ node, children }: { node?: unknown; children?: ReactNode }) {
  return <td data-numeric={useIsNumericColumn(node)}>{children}</td>
}

/**
 * Fenced kod bloklarını (mesajın geri kalanından ayrı) tek tıkla kopyalanabilir
 * yapar — mesaj-seviyesi kopyala butonu tüm balonu (açıklama metni + kod)
 * kopyalıyordu, SPSS syntax'ını Terminal'e yapıştırmak için kullanışsızdı.
 */
function CodeBlock({ children }: { children?: ReactNode }) {
  const { t } = useTranslation(['common'])
  const [copied, setCopied] = useState(false)

  const code = getPlainText(children).replace(/\n$/, '')
  const className = getCodeClassName(children)
  const language = detectLanguage(className, code)
  const label = languageLabel(language, className)
  const tokens = highlightCode(code, language)

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span className={styles.codeLang}>{label}</span>
        <button
          type="button"
          className={styles.codeCopyBtn}
          onClick={handleCopy}
          title={t(copied ? 'ai.message.copied' : 'ai.message.copyCode')}
        >
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
        </button>
      </div>
      <pre className={styles.codePre}>
        <code>
          {tokens.map((tok, i) =>
            tok.kind === 'plain' ? (
              tok.text
            ) : (
              // Tokenlar kaynak sırasına göre üretilir ve içerik değişince
              // blok baştan render edilir — index key güvenli.
              <span key={i} className={styles[`tok_${tok.kind}`]}>
                {tok.text}
              </span>
            )
          )}
        </code>
      </pre>
    </div>
  )
}

const MARKDOWN_COMPONENTS: Components = {
  pre: CodeBlock,
  // Geniş tablo panelin tamamını yatayda taşırmasın: kaydırma kabuğu tabloyu
  // kendi içinde tutar (aksi halde mesaj akışı yanlara kayıyordu).
  table: MarkdownTable,
  th: MarkdownTh,
  td: MarkdownTd,
  // Electron'da harici gezinme bloklu (§9); bağlantı metni okunur/kopyalanır
  // kalsın, tıklama sessizce ölü bir sayfaya gitmesin.
  a: ({ children, href }) => (
    <a
      href={href}
      title={href}
      // Middle-click fires auxclick (not click) and Chromium would open the
      // link in a new window → setWindowOpenHandler → the system browser.
      draggable={false}
      onClick={e => {
        e.preventDefault()
      }}
      onAuxClick={e => {
        e.preventDefault()
      }}
    >
      {children}
    </a>
  )
}

export function MarkdownText({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
