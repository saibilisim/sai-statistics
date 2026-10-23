// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Diagnostic: verifies the shadow-DOM + getComputedStyle technique in
 * src/lib/html-clipboard.ts against a REALISTIC Microsoft Excel clipboard
 * HTML fragment (MSO namespaces, HTML-comment-wrapped <style> block,
 * .xlNN class-based cell styling, background written with the CSS shorthand
 * `background:` rather than `background-color:`) — run inside the app's
 * actual bundled Chromium/Electron renderer (real CSS engine), not a
 * simplified test-only DOM implementation, so the result reflects what a
 * real Excel paste will actually do.
 */
const { _electron } = require('@playwright/test')

// A trimmed but structurally faithful copy of real Excel "Copy" HTML output
// (verified against publicly documented Excel clipboard samples): MSO XML
// namespaces, a `<style>` block wrapped in an HTML comment defining classes
// keyed by "xlNN", and <td class=xlNN> referencing them — background color
// comes ONLY from the class, never inline, which is exactly the case the
// previous (inline-style-only) implementation could not handle.
const EXCEL_HTML = `
<html xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns="http://www.w3.org/TR/REC-html40">

<head>
<meta name=ProgId content=Excel.Sheet>
<style>
<!--table
	{mso-displayed-decimal-separator:"\\.";
	mso-displayed-thousand-separator:"\\,";}
.xl65
	{color:windowtext;
	font-weight:700;
	background:#FFFF00;
	mso-pattern:black none;}
.xl66
	{color:#FF0000;
	background:#00B0F0;}
-->
</style>
</head>

<body link="#0563C1" vlink="#954F72">

<table border=0 cellpadding=0 cellspacing=0 width=128 style='border-collapse:
 collapse;width:96pt'>
 <col width=64 style='mso-width-source:userset;mso-width-alt:2048;width:48pt'>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl65 width=64 style='height:15.0pt;width:48pt'>Bold Yellow</td>
  <td class=xl66 width=64 style='width:48pt'>Red on Blue</td>
 </tr>
 <tr height=20 style='height:15.0pt'>
  <td height=20 style='height:15.0pt'>Plain</td>
  <td style='font-weight:700'>Inline Bold</td>
 </tr>
</table>

</body>
</html>
`

// A LibreOffice Calc-shaped fixture (same class+stylesheet idea, different
// concrete markup) as a second real-world regression check.
const LIBREOFFICE_HTML = `
<html>
<head>
<style type="text/css">
table { border-collapse: collapse; }
.ce1 { background-color: #ffff00; font-weight: bold; }
.ce2 { color: #ff0000; }
</style>
</head>
<body>
<table>
<tr><td class="ce1">Bold Yellow</td><td class="ce2">Red Text</td></tr>
<tr><td>Plain</td><td>Plain</td></tr>
</table>
</body>
</html>
`

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(500)

  const run = async html => {
    return win.evaluate(htmlArg => {
      // Inline copy of html-clipboard.ts's algorithm (shadow DOM + computed
      // style + baseline diff) — verifying the TECHNIQUE against this
      // Electron build's real Chromium, not re-importing the bundled module.
      const BOLD_WEIGHT_RE = /^(bold|bolder|[6-9]\d\d|1000)$/i
      const TRANSPARENT_RE = /^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/i

      function styleToCellFormat(style, baseline) {
        const format = {}
        if (
          style.backgroundColor !== baseline.backgroundColor &&
          !TRANSPARENT_RE.test(style.backgroundColor)
        ) {
          format.bg = style.backgroundColor
        }
        if (style.color !== baseline.color) format.color = style.color
        if (style.fontWeight !== baseline.fontWeight && BOLD_WEIGHT_RE.test(style.fontWeight)) {
          format.bold = true
        }
        return format
      }

      const host = document.createElement('div')
      host.style.cssText = 'position:fixed; left:-99999px; top:-99999px; visibility:hidden;'
      document.body.appendChild(host)
      try {
        const shadow = host.attachShadow({ mode: 'open' })
        shadow.innerHTML = htmlArg
        const table = shadow.querySelector('table')
        if (!table) return { error: 'no table found' }

        const baselineTd = document.createElement('td')
        const baselineTable = document.createElement('table')
        baselineTable.append(document.createElement('tbody'))
        baselineTable.querySelector('tbody').append(document.createElement('tr'))
        baselineTable.querySelector('tr').append(baselineTd)
        shadow.appendChild(baselineTable)
        const baseline = getComputedStyle(baselineTd)

        const out = []
        for (const tr of Array.from(table.querySelectorAll('tr'))) {
          const tds = Array.from(tr.querySelectorAll('td, th'))
          out.push(
            tds.map(td => ({
              text: td.textContent,
              format: styleToCellFormat(getComputedStyle(td), baseline)
            }))
          )
        }
        return out
      } finally {
        host.remove()
      }
    }, html)
  }

  console.log('=== Excel-style fixture ===')
  console.log(JSON.stringify(await run(EXCEL_HTML), null, 2))

  console.log('=== LibreOffice-style fixture ===')
  console.log(JSON.stringify(await run(LIBREOFFICE_HTML), null, 2))

  await app.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
