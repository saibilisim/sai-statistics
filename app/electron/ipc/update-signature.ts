// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * update-signature.ts — signature check of a downloaded Windows installer,
 * used by electron-updater instead of its built-in verifier (updater-handler.ts).
 *
 * Why (2026-10-11): our certificate's name is Turkish ("SAİ BİLİŞİM ANONİM
 * ŞİRKETİ"). electron-builder reads it from the Windows certificate store through
 * PowerShell and wrote it into app-update.yml mangled ("SA� B�L���M …"), while
 * electron-updater's own check read the downloaded installer's signer correctly
 * — so on Turkish Windows every downloaded update was rejected as "not signed by
 * the application owner" and nothing was installed (the signature itself was
 * valid). Here nothing non-ASCII ever crosses a console: PowerShell prints the
 * signature status and the signer subject as Base64 of its UTF-8 bytes, and the
 * comparison happens in Node.
 *
 * Accepted: status "Valid" (Windows trusts the chain) AND the signer CN equals
 * one of the expected names — app-update.yml's publisherName (correct again from
 * 0.2.27, electron-builder.json) or UPDATE_PUBLISHER_CN.
 */
import { execFile } from 'child_process'
import { join } from 'path'

/** CN of the code-signing certificate — electron-builder.json win.signtoolOptions.publisherName. */
export const UPDATE_PUBLISHER_CN = 'SAİ BİLİŞİM ANONİM ŞİRKETİ'

// The file path travels in an environment variable, never inside the script.
const PS_SCRIPT = [
  '$s = Get-AuthenticodeSignature -LiteralPath $env:SAI_UPDATE_FILE',
  "$subj = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { '' }",
  "[Console]::Out.Write($s.Status.ToString() + '|' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($subj)))"
].join('; ')

/** CN of a distinguished name ("CN=X, O=Y, …"), or the name itself when it is not a DN. */
export function commonName(name: string): string {
  const m = /(?:^|,)\s*CN=(?:"([^"]*)"|([^,]*))/.exec(name)
  const cn = m ? (m[1] ?? m[2] ?? '') : name.includes('=') ? '' : name
  return cn.trim().normalize('NFC')
}

/** Does the signer subject's CN equal one of the expected names (exact, after NFC)? */
export function publisherMatches(subject: string, expected: readonly string[]): boolean {
  const cn = commonName(subject)
  return cn !== '' && expected.some(name => commonName(name) === cn)
}

/** Parses the script's "Status|Base64(subject)" line. */
export function parseSignatureLine(line: string): { status: string; subject: string } | null {
  const m = /^(\w+)\|([A-Za-z0-9+/=]*)$/.exec(line.trim())
  if (!m?.[1]) return null
  return { status: m[1], subject: Buffer.from(m[2] ?? '', 'base64').toString('utf8') }
}

/**
 * electron-updater's verifyUpdateCodeSignature contract: null = accepted,
 * a string = the reason it was rejected (electron-updater reports it as an error).
 */
export function verifyInstallerSignature(
  publisherNames: string[],
  file: string
): Promise<string | null> {
  const ps = join(
    process.env['SystemRoot'] ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  // PSModulePath removed (not emptied) — same as electron-updater: a PowerShell 7
  // value would point Windows PowerShell at incompatible modules, an empty one
  // hides Microsoft.PowerShell.Security (Get-AuthenticodeSignature).
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries({ ...process.env, SAI_UPDATE_FILE: file }).filter(
      ([k]) => k.toLowerCase() !== 'psmodulepath'
    )
  )
  return new Promise(resolve => {
    execFile(
      ps,
      ['-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-Command', PS_SCRIPT],
      {
        env,
        timeout: 60_000,
        windowsHide: true
      },
      (err, stdout, stderr) => {
        if (err) {
          resolve(`signature check could not run: ${err.message} ${stderr.trim()}`)
          return
        }
        const parsed = parseSignatureLine(stdout)
        if (!parsed) {
          resolve(`signature check returned unreadable output: ${stdout.slice(0, 200)}`)
          return
        }
        if (parsed.status !== 'Valid') {
          resolve(`installer signature is not valid (status ${parsed.status})`)
          return
        }
        const expected = [...publisherNames, UPDATE_PUBLISHER_CN]
        resolve(
          publisherMatches(parsed.subject, expected)
            ? null
            : `installer is signed by "${parsed.subject}", expected ${expected.join(' | ')}`
        )
      }
    )
  })
}
