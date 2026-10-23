// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * code-highlight — AI yanıtlarındaki kod bloklarının tokenizer'ı.
 *
 * En kritik değişmez: tokenların metinleri **birleştirildiğinde kaynak kodun
 * aynısını** vermeli. Aksi halde renklendirme kullanıcının kopyaladığı /
 * Terminal'e yapıştırdığı syntax'ı sessizce bozar.
 */

import { describe, it, expect } from 'vitest'
import {
  detectLanguage,
  highlightCode,
  languageLabel,
  type CodeLanguage
} from '../../src/lib/code-highlight'

function joined(code: string, lang: CodeLanguage): string {
  return highlightCode(code, lang)
    .map(t => t.text)
    .join('')
}

function kindsOf(code: string, lang: CodeLanguage, text: string): string[] {
  return highlightCode(code, lang)
    .filter(t => t.text === text)
    .map(t => t.kind)
}

describe('detectLanguage', () => {
  it('markdown info string önceliklidir', () => {
    expect(detectLanguage('language-r', 'x <- 1')).toBe('r')
    expect(detectLanguage('language-spss', 'FREQUENCIES VARIABLES=x.')).toBe('spss')
    expect(detectLanguage('language-sps', 'FREQUENCIES VARIABLES=x.')).toBe('spss')
    expect(detectLanguage('language-python', 'x = 1')).toBe('generic')
  })

  it('dil yazılmamışsa içerikten tahmin eder', () => {
    expect(detectLanguage(undefined, 'FREQUENCIES VARIABLES=age.')).toBe('spss')
    expect(detectLanguage(undefined, 'model <- lm(y ~ x, data = df)')).toBe('r')
    expect(detectLanguage(undefined, 'merhaba dünya')).toBe('generic')
  })
})

describe('languageLabel', () => {
  it('bilinen diller için sabit etiket, diğerleri için info string', () => {
    expect(languageLabel('r', 'language-r')).toBe('R')
    expect(languageLabel('spss', 'language-sps')).toBe('SPSS')
    expect(languageLabel('generic', 'language-json')).toBe('JSON')
    expect(languageLabel('generic', undefined)).toBe('')
  })
})

describe('highlightCode — kayıpsızlık', () => {
  const samples: Array<[CodeLanguage, string]> = [
    ['r', '# yorum\nx <- c(1, 2.5, NA)\nsummary(x)  # sonuç\n'],
    ['r', 'df %>% filter(grup == "A") %>% summarise(m = mean(puan, na.rm = TRUE))'],
    ['spss', '* Bir yorum satırı.\nFREQUENCIES VARIABLES=yas /STATISTICS=MEAN.\n'],
    ['generic', 'SELECT * FROM t -- x\n{"a": 1}\n'],
    ['r', ''],
    ['r', 'x <- "kapanmamış dize']
  ]

  it.each(samples)('%s bloğu birebir korunur', (lang, code) => {
    expect(joined(code, lang)).toBe(code)
  })
})

describe('highlightCode — R sınıflandırması', () => {
  const code = '# not\nlibrary(stats)\nfit <- lm(y ~ x, data = df)\nn <- 42L\ns <- "metin"'

  it('yorum, dize ve sayıyı ayırır', () => {
    expect(kindsOf(code, 'r', '# not')).toEqual(['comment'])
    expect(kindsOf(code, 'r', '"metin"')).toEqual(['string'])
    expect(kindsOf(code, 'r', '42L')).toEqual(['number'])
  })

  it('anahtar sözcük ve fonksiyon çağrısını ayırır', () => {
    expect(kindsOf(code, 'r', 'library')).toEqual(['keyword'])
    expect(kindsOf(code, 'r', 'lm')).toEqual(['function'])
    // Çağrı olmayan tanımlayıcı boyanmaz — bitişik düz metinle birleşip
    // 'plain' kalır, kendi başına renkli bir token üretmez.
    expect(highlightCode(code, 'r').some(t => t.kind !== 'plain' && t.text.includes('fit'))).toBe(
      false
    )
  })

  it('atama ve pipe operatörünü işaretler', () => {
    // fit <- … , n <- … , s <- …
    expect(kindsOf(code, 'r', '<-')).toEqual(['operator', 'operator', 'operator'])
    expect(kindsOf('a %>% b', 'r', '%>%')).toEqual(['operator'])
  })
})

describe('highlightCode — SPSS sınıflandırması', () => {
  it('komut adını anahtar sözcük, * satırını yorum yapar', () => {
    const code = '* açıklama.\nFREQUENCIES VARIABLES=yas.'
    expect(kindsOf(code, 'spss', '* açıklama.')).toEqual(['comment'])
    expect(kindsOf(code, 'spss', 'FREQUENCIES')).toEqual(['keyword'])
  })

  it('çok satırlı bloklarda satır sonlarını korur', () => {
    const code = 'DESCRIPTIVES VARIABLES=a b.\nEXECUTE.'
    expect(joined(code, 'spss')).toBe(code)
  })
})
