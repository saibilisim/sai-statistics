// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure helpers for the SPSS syntax editor: keyword/comment/string tokenizing
 * (for the highlight overlay) and command-name autocomplete. No React/DOM —
 * kept separate so the highlighting regex and the autocomplete matching stay
 * testable and share one source of truth for "what counts as a command
 * keyword" (`SUPPORTED_COMMANDS`, the same list the dispatcher itself uses).
 */
import { SUPPORTED_COMMANDS } from '../../lib/spss-syntax'

export type TokenKind = 'plain' | 'command' | 'comment' | 'string'

export interface SpssToken {
  text: string
  kind: TokenKind
}

// Longest-first so multi-word commands ("RENAME VARIABLES") match before
// their single-word prefix ("RENAME") would otherwise falsely win.
const SORTED_COMMANDS = [...SUPPORTED_COMMANDS].sort((a, b) => b.length - a.length)

/** Splits `text` on quoted-string boundaries, tagging the quoted spans. */
function tokenizeStrings(text: string): SpssToken[] {
  if (text === '') return []
  const parts = text.split(/('(?:[^']|'')*'|"(?:[^"]|"")*")/g)
  return parts
    .filter(p => p !== '')
    .map(
      (p): SpssToken => ({
        text: p,
        kind: p.startsWith("'") || p.startsWith('"') ? 'string' : 'plain'
      })
    )
}

/**
 * Tokenizes a single line for the highlight overlay: a `*`-comment line
 * becomes one comment token; otherwise a leading recognized command keyword
 * is tagged (matched the same way `parseStatement` does — exact match or
 * followed by a space/`=`), and any quoted strings in the remainder are
 * tagged too. Concatenating every token's `text` reproduces the input
 * exactly, so the overlay stays character-for-character aligned with the
 * plain textarea underneath it.
 */
export function tokenizeSpssLine(line: string): SpssToken[] {
  const leadingWs = /^[ \t]*/.exec(line)?.[0] ?? ''
  const rest = line.slice(leadingWs.length)
  const tokens: SpssToken[] = []
  if (leadingWs) tokens.push({ text: leadingWs, kind: 'plain' })

  if (rest.startsWith('*')) {
    tokens.push({ text: rest, kind: 'comment' })
    return tokens
  }

  const upper = rest.toUpperCase()
  const cmd = SORTED_COMMANDS.find(
    name => upper === name || upper.startsWith(`${name} `) || upper.startsWith(`${name}=`)
  )
  let tail = rest
  if (cmd) {
    tokens.push({ text: rest.slice(0, cmd.length), kind: 'command' })
    tail = rest.slice(cmd.length)
  }
  tokens.push(...tokenizeStrings(tail))
  return tokens
}

/**
 * The command keyword currently being typed: everything since the closer of
 * the last statement terminator (`.`) or line break, whichever is later.
 * Resetting on line breaks too (not just `.`) means an unterminated comment
 * or a previous statement the user hasn't finished yet doesn't leak into the
 * next line's suggestions — a command keyword always starts its own line.
 */
export function getCurrentToken(
  text: string,
  caret: number
): { start: number; end: number; value: string } {
  const upto = text.slice(0, caret)
  const boundary = Math.max(upto.lastIndexOf('.'), upto.lastIndexOf('\n'))
  const afterBoundary = upto.slice(boundary + 1)
  const leadingLen = /^[ \t]*/.exec(afterBoundary)?.[0].length ?? 0
  const start = boundary + 1 + leadingLen
  return { start, end: caret, value: text.slice(start, caret) }
}

/** Command names that start with `token` (case-insensitive), closest matches first. */
export function getCommandSuggestions(token: string, limit = 8): string[] {
  const trimmed = token.trim()
  if (trimmed.length === 0) return []
  const upper = trimmed.toUpperCase()
  if (SUPPORTED_COMMANDS.includes(upper)) return []
  return SUPPORTED_COMMANDS.filter(name => name.startsWith(upper) && name !== upper)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .slice(0, limit)
}
