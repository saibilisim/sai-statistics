// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * update-signature.test.ts — encoding-proof installer signature check
 * (electron/ipc/update-signature.ts). The built-in electron-updater check
 * compared our Turkish certificate name with a mangled copy from app-update.yml
 * and rejected every update on Turkish Windows (2026-10-11).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  UPDATE_PUBLISHER_CN,
  commonName,
  publisherMatches,
  parseSignatureLine,
  verifyInstallerSignature
} from '../../electron/ipc/update-signature'

const SUBJECT =
  'CN=SAİ BİLİŞİM ANONİM ŞİRKETİ, O=SAİ BİLİŞİM ANONİM ŞİRKETİ, L=GAZIANTEP, S=GAZIANTEP, C=TR'

describe('commonName / publisherMatches', () => {
  it('reads CN from a DN and passes a bare name through', () => {
    expect(commonName(SUBJECT)).toBe(UPDATE_PUBLISHER_CN)
    expect(commonName(UPDATE_PUBLISHER_CN)).toBe(UPDATE_PUBLISHER_CN)
    expect(commonName('CN="ACME, Inc.", O=x')).toBe('ACME, Inc.')
    expect(commonName('O=no common name')).toBe('')
  })

  it('accepts our certificate; the mangled app-update.yml copy alone does not match', () => {
    expect(publisherMatches(SUBJECT, [UPDATE_PUBLISHER_CN])).toBe(true)
    expect(publisherMatches(SUBJECT, ['SA� B�L���M ANON�M'])).toBe(false)
    expect(publisherMatches('CN=Someone Else, O=X', [UPDATE_PUBLISHER_CN])).toBe(false)
    expect(publisherMatches('', [UPDATE_PUBLISHER_CN])).toBe(false)
  })

  it('compares after Unicode normalization (decomposed İ still matches)', () => {
    const decomposed = SUBJECT.normalize('NFD')
    expect(decomposed).not.toBe(SUBJECT)
    expect(publisherMatches(decomposed, [UPDATE_PUBLISHER_CN])).toBe(true)
  })

  it('matches electron-builder.json publisherName', () => {
    const cfg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'electron-builder.json'), 'utf8')
    ) as { win: { signtoolOptions: { publisherName: string[] } } }
    expect(cfg.win.signtoolOptions.publisherName).toContain(UPDATE_PUBLISHER_CN)
  })
})

describe('parseSignatureLine', () => {
  it('decodes the Base64 UTF-8 subject', () => {
    const b64 = Buffer.from(SUBJECT, 'utf8').toString('base64')
    expect(parseSignatureLine(`Valid|${b64}\r\n`)).toEqual({ status: 'Valid', subject: SUBJECT })
    expect(parseSignatureLine('NotSigned|')).toEqual({ status: 'NotSigned', subject: '' })
    expect(parseSignatureLine('garbage')).toBeNull()
  })
})

// Real PowerShell round-trip on Windows: the signed R runtime DLL is accepted,
// an unsigned file is rejected.
const SIGNED_DLL = join(__dirname, '..', '..', 'resources', 'r-runtime-win', 'bin', 'x64', 'R.dll')
const runReal =
  process.platform === 'win32' &&
  (() => {
    try {
      readFileSync(SIGNED_DLL)
      return true
    } catch {
      return false
    }
  })()

describe.skipIf(!runReal)('verifyInstallerSignature (Windows, real PowerShell)', () => {
  it('accepts a file signed with our certificate even with a mangled expected name', async ctx => {
    const result = await verifyInstallerSignature(['SA� B�L���M'], SIGNED_DLL)
    // A freshly vendored runtime is unsigned until `pnpm sign:r-runtime:win`
    // runs — nothing to verify against yet. Any OTHER rejection still fails.
    if (result?.includes('status NotSigned')) {
      ctx.skip()
      return
    }
    expect(result).toBeNull()
  }, 60_000)

  it('rejects an unsigned file', async () => {
    const unsigned = join(__dirname, '..', '..', 'package.json')
    expect(await verifyInstallerSignature([UPDATE_PUBLISHER_CN], unsigned)).toMatch(/not valid/)
  }, 60_000)
})
