// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * code-highlight.ts — LLM yanıtlarındaki fenced kod bloklarını renklendirmek
 * için bağımlılıksız (harici highlight kütüphanesi olmayan) tokenizer.
 *
 * Neden kendi tokenizer'ımız: highlight.js/shiki gibi paketler ya devasa dil
 * gramerleri taşıyor ya da CSP ile çelişen runtime WASM/inline stil
 * gerektiriyor (CLAUDE.md §9). Sohbette pratikte yalnız iki dil geçiyor —
 * **R** ve **SPSS syntax** — geri kalan için satır/dize/sayı düzeyinde sade
 * bir "generic" mod yeterli.
 *
 * SPSS tarafı Terminal'in highlight overlay'iyle **aynı** tokenizer'ı
 * (`tokenizeSpssLine`, tek komut listesi kaynağı `SUPPORTED_COMMANDS`)
 * kullanır — aynı kod iki farklı yerde iki farklı renkte görünmesin.
 *
 * Saf fonksiyon; React/DOM bilmez, çıktısı `CodeToken[]`'dir (renk sınıfını
 * çağıran bileşen seçer).
 */

import { tokenizeSpssLine } from '../views/TerminalView/spss-editor-helpers'

export type CodeTokenKind =
  | 'plain'
  | 'keyword'
  | 'comment'
  | 'string'
  | 'number'
  | 'function'
  | 'operator'

export interface CodeToken {
  text: string
  kind: CodeTokenKind
}

export type CodeLanguage = 'r' | 'spss' | 'generic'

/** Markdown info string (```r, ```spss …) → desteklenen dil kimliği. */
const LANGUAGE_ALIASES: Record<string, CodeLanguage> = {
  r: 'r',
  rscript: 'r',
  rstats: 'r',
  spss: 'spss',
  sps: 'spss',
  syntax: 'spss',
  'spss-syntax': 'spss'
}

const R_KEYWORDS = new Set([
  'if',
  'else',
  'for',
  'while',
  'repeat',
  'break',
  'next',
  'function',
  'return',
  'in',
  'TRUE',
  'FALSE',
  'NULL',
  'NA',
  'NA_integer_',
  'NA_real_',
  'NA_character_',
  'Inf',
  '-Inf',
  'NaN',
  'library',
  'require',
  'suppressWarnings',
  'suppressMessages'
])

/**
 * Tek geçişte R tokenlarını yakalar. Sıra önemli: yorum → dize → sayı →
 * tanımlayıcı → operatör. Kapanmamış dize (streaming sırasında model henüz
 * tırnağı kapatmamışken) satır sonuna kadar dize sayılır; aksi halde blok
 * yarım geldiğinde renkler bir anda "atlıyor" gibi görünüyordu.
 */
const R_TOKEN_RE = new RegExp(
  [
    '(#[^\\n]*)', // 1: yorum
    '("(?:\\\\.|[^"\\\\\\n])*"?|\'(?:\\\\.|[^\'\\\\\\n])*\'?|`[^`\\n]*`?)', // 2: dize / backtick ad
    '(\\b\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?[Li]?\\b|\\.\\d+)', // 3: sayı
    '([A-Za-z._][A-Za-z0-9._]*)', // 4: tanımlayıcı
    '(%[^%\\s]*%|<<-|->>|<-|->|\\|>|[-+*/^<>=!&|~?:$@]+)' // 5: operatör (%>% dahil)
  ].join('|'),
  'g'
)

/** Yorum (`#`, `//`) ve dizeler dışında hiçbir şeyi boyamayan sade mod. */
const GENERIC_TOKEN_RE = new RegExp(
  [
    '(#[^\\n]*|//[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$))', // 1: yorum
    '("(?:\\\\.|[^"\\\\\\n])*"?|\'(?:\\\\.|[^\'\\\\\\n])*\')', // 2: dize
    '(\\b\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?\\b)' // 3: sayı
  ].join('|'),
  'g'
)

/** Bitişik aynı-türden tokenları birleştirir (span sayısını düşürür). */
function pushToken(tokens: CodeToken[], text: string, kind: CodeTokenKind): void {
  if (text === '') return
  const last = tokens[tokens.length - 1]
  if (last && last.kind === kind) {
    last.text += text
    return
  }
  tokens.push({ text, kind })
}

/** `name(` biçimindeki tanımlayıcıyı fonksiyon çağrısı sayar. */
function isCallSite(source: string, endIndex: number): boolean {
  const rest = source.slice(endIndex)
  return /^\s*\(/.test(rest)
}

function tokenizeWithRegex(
  source: string,
  re: RegExp,
  classify: (match: RegExpExecArray) => CodeTokenKind
): CodeToken[] {
  const tokens: CodeToken[] = []
  re.lastIndex = 0
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    // Boş eşleşme sonsuz döngü yapar (operatör alternatifi teorik olarak
    // boş eşleşebilir) — bir karakter ilerleyip devam et.
    if (match[0] === '') {
      re.lastIndex += 1
      continue
    }
    pushToken(tokens, source.slice(cursor, match.index), 'plain')
    pushToken(tokens, match[0], classify(match))
    cursor = match.index + match[0].length
  }
  pushToken(tokens, source.slice(cursor), 'plain')
  return tokens
}

function tokenizeR(source: string): CodeToken[] {
  return tokenizeWithRegex(source, R_TOKEN_RE, match => {
    if (match[1] !== undefined) return 'comment'
    if (match[2] !== undefined) return 'string'
    if (match[3] !== undefined) return 'number'
    if (match[4] !== undefined) {
      if (R_KEYWORDS.has(match[4])) return 'keyword'
      return isCallSite(source, match.index + match[0].length) ? 'function' : 'plain'
    }
    return 'operator'
  })
}

function tokenizeGeneric(source: string): CodeToken[] {
  return tokenizeWithRegex(source, GENERIC_TOKEN_RE, match => {
    if (match[1] !== undefined) return 'comment'
    if (match[2] !== undefined) return 'string'
    return 'number'
  })
}

/** Terminal'in SPSS tokenizer'ı satır bazlı — satır sonlarını geri ekler. */
function tokenizeSpss(source: string): CodeToken[] {
  const tokens: CodeToken[] = []
  const lines = source.split('\n')
  lines.forEach((line, i) => {
    for (const tok of tokenizeSpssLine(line)) {
      pushToken(tokens, tok.text, tok.kind === 'command' ? 'keyword' : tok.kind)
    }
    if (i < lines.length - 1) pushToken(tokens, '\n', 'plain')
  })
  return tokens
}

/**
 * Fenced blok dilini belirler. Model dili yazmadıysa (` ``` ` düz) içeriğe
 * bakarak tahmin eder: SPSS komutları büyük harfle başlayıp `.` ile biter,
 * R ise `<-`/`%>%`/`library(` gibi imzalar taşır.
 */
export function detectLanguage(className: string | undefined, code: string): CodeLanguage {
  const declared = /language-([\w-]+)/.exec(className ?? '')?.[1]?.toLowerCase()
  if (declared !== undefined) return LANGUAGE_ALIASES[declared] ?? 'generic'

  const firstCode = code.split('\n').find(l => l.trim() !== '') ?? ''
  if (/^\s*[A-Z][A-Z /-]{2,}(\s|=|\.|$)/.test(firstCode)) return 'spss'
  if (/<-|%>%|\blibrary\(|\bfunction\s*\(/.test(code)) return 'r'
  return 'generic'
}

/** Kod bloğu başlığında gösterilen etiket (çeviri gerektirmeyen dil adı). */
export function languageLabel(language: CodeLanguage, className: string | undefined): string {
  if (language === 'r') return 'R'
  if (language === 'spss') return 'SPSS'
  const declared = /language-([\w-]+)/.exec(className ?? '')?.[1]
  return declared ? declared.toUpperCase() : ''
}

/** Kaynağı renk sınıfı atanabilir tokenlara böler. Birleşimleri kaynağa eşittir. */
export function highlightCode(code: string, language: CodeLanguage): CodeToken[] {
  if (language === 'r') return tokenizeR(code)
  if (language === 'spss') return tokenizeSpss(code)
  return tokenizeGeneric(code)
}
