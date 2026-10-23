// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Sürüm notu kapısı — `pnpm release:win`'in İLK adımı (derlemeden önce, ~10 dk
 * boşa gitmesin diye). app/release-notes.json son kullanıcıya dönük sürüm
 * notlarının tek kaynağıdır: upload-release-win.cjs onu kurulum dosyasıyla
 * birlikte sunucuya yükler, sai-ai-server GET /app/release-notes ile yayımlar,
 * site (indirme + sürüm notları sayfası) oradan okur.
 *
 * Kullanım:
 *   node scripts/check-release-notes.cjs            → package.json sürümünü doğrular
 *   node scripts/check-release-notes.cjs --scaffold → o sürüm için boş not şablonu ekler
 *                                                     (pnpm release-notes:new)
 *
 * Yazım kuralları (son kullanıcı okur — geliştirici değil):
 *   - Kullanıcının fark ettiği değişikliği ve faydasını yaz: "Excel'den aktarmada
 *     tarihler doğru görünüyor", "…hatası giderildi" değil "… artık …".
 *   - İç adlar, dosya/fonksiyon adları, kütüphane/servis adları, commit dili YOK.
 *   - Analiz ve menü adları serbesttir (kullanıcı onları arayüzde görür).
 *   - Her dilde aynı sayıda madde (tr/en/es/fr/pt/it), madde başına tek cümle
 *     ya da kısa iki cümle. Kullanıcıyı ilgilendirmeyen iç değişiklik yazılmaz;
 *     sürümde öyle bir şey yoksa tek madde: genel kararlılık iyileştirmesi.
 */
const fs = require('fs')
const path = require('path')

const pkg = require('../package.json')
const FILE = path.join(__dirname, '..', 'release-notes.json')
const LANGS = ['tr', 'en', 'es', 'fr', 'pt', 'it']
const MIN_LEN = 15
const MAX_LEN = 280
const MAX_NOTES = 6

// Son kullanıcı notunda geçmemesi gereken geliştirici terimleri.
const DEV_TERMS = [
  /\brefactor/i,
  /\bcommit/i,
  /\bmerge\b/i,
  /\bIPC\b/,
  /\bE2E\b/i,
  /\bzod\b/i,
  /\bschema\b/i,
  /\bhandler\b/i,
  /\bendpoint\b/i,
  /\btsc\b/i,
  /\blint\b/i,
  /\bp?npm\b/i,
  /\bi18n\b/i,
  /\bunit test/i,
  /\bregression test/i,
  /\.(tsx?|cjs|mjs|js|R)\b/,
  /\br-scripts\b/i,
  /\belectron\b/i,
  /\brenderer\b/i,
  /\bpreload\b/i,
  /\bDuckDB\b/i,
  /\bParquet\b/i,
  /\bArrow\b/,
  /\bOpenRouter\b/i,
  /\btoken\b/i,
  /\bTODO\b/,
  /^\s*(fix|feat|chore|docs)(\(|:)/i,
  /\bR motoru\b/i,
  /\bbackend\b/i,
  /\bfrontend\b/i
]

function fail(msg) {
  console.error(`[release-notes] ${msg}`)
  console.error(`[release-notes] dosya: ${FILE}`)
  process.exit(1)
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8'))
  } catch (err) {
    fail(`okunamadı: ${err.message}`)
  }
}

const data = read()
if (!Array.isArray(data.releases)) fail('"releases" dizisi yok')

if (process.argv.includes('--scaffold')) {
  if (data.releases.some(r => r.version === pkg.version)) {
    console.log(`[release-notes] v${pkg.version} zaten var — düzenleyin: ${FILE}`)
    process.exit(0)
  }
  const today = new Date().toISOString().slice(0, 10)
  data.releases.unshift({
    version: pkg.version,
    date: today,
    notes: Object.fromEntries(LANGS.map(l => [l, ['']]))
  })
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n')
  console.log(`[release-notes] v${pkg.version} için boş şablon eklendi — 6 dilde doldurun: ${FILE}`)
  process.exit(0)
}

const entry = data.releases[0]
if (!entry || entry.version !== pkg.version) {
  const has = data.releases.some(r => r.version === pkg.version)
  fail(
    has
      ? `v${pkg.version} notu listenin en üstünde değil (en yeni en üstte olmalı)`
      : `v${pkg.version} için sürüm notu yok. Şablon: pnpm -C app release-notes:new`
  )
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date ?? '')) fail(`v${pkg.version}: "date" YYYY-AA-GG olmalı`)

const problems = []
const counts = new Set()
for (const lang of LANGS) {
  const notes = entry.notes?.[lang]
  if (!Array.isArray(notes) || notes.length === 0) {
    problems.push(`${lang}: not yok`)
    continue
  }
  counts.add(notes.length)
  if (notes.length > MAX_NOTES) problems.push(`${lang}: en fazla ${MAX_NOTES} madde`)
  notes.forEach((note, i) => {
    const where = `${lang}[${i + 1}]`
    if (typeof note !== 'string' || note.trim().length < MIN_LEN) {
      problems.push(`${where}: boş ya da çok kısa`)
      return
    }
    if (note.length > MAX_LEN)
      problems.push(`${where}: ${note.length} karakter (en fazla ${MAX_LEN}) — kısaltın`)
    const term = DEV_TERMS.find(re => re.test(note))
    if (term)
      problems.push(
        `${where}: geliştirici terimi (${term}) — son kullanıcı diliyle yazın: "${note}"`
      )
  })
}
if (counts.size > 1) problems.push(`dillerde madde sayısı farklı (${[...counts].join(', ')})`)

if (problems.length) fail(`v${pkg.version} sürüm notu geçersiz:\n  - ${problems.join('\n  - ')}`)
console.log(
  `[release-notes] v${pkg.version} tamam (${entry.notes.tr.length} madde, ${LANGS.length} dil)`
)
