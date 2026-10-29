// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
// Fills the source url and sha256 of the Flathub manifest from a published .deb.
//   node flatpak/flathub/update-manifest.cjs <path-to.deb> <public-https-url>
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const [deb, url] = process.argv.slice(2)
// http is accepted for 127.0.0.1 only (local test); Flathub itself needs https.
if (!deb || !url || !/^(https:\/\/|http:\/\/127\.0\.0\.1[:/])/.test(url)) {
  console.error('usage: node update-manifest.cjs <path-to.deb> <https-url-of-that-deb>')
  process.exit(1)
}
const data = fs.readFileSync(deb)
const sha = crypto.createHash('sha256').update(data).digest('hex')
const file = path.join(__dirname, 'com.saibilisim.saistatistics.yml')
let yml = fs.readFileSync(file, 'utf8')
yml = yml
  .replace(/url: https?:\/\/\S+\.deb/, `url: ${url}`)
  .replace(/sha256: '?([0-9a-f]{64})'?/, `sha256: '${sha}'`)
fs.writeFileSync(file, yml)
console.log(`url=${url}\nsha256=${sha}\nsize=${data.length}`)
