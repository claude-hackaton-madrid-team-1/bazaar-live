/**
 * Everything that reaches the page from the database is untrusted: a rival's or a dealer's text can
 * carry markup, expressive voice tags (`[shouts]`), links or a prompt-injection line. This file turns
 * it into plain, short text, and turns every other field into a value from a closed vocabulary.
 *
 * Imported by the Node server and by tests; it has no imports of its own.
 */

/** One quote on screen and in a voice: long enough for a haggle line, short enough to read. */
export const MAX_QUOTE = 280
const MAX_PRIMAS = 10_000_000 // the game's own cap on prices and cash

const LINK = /\b(?:https?:\/\/|www\.)\S+/gi
const ANGLE_TAG = /<\/?[a-z!][^>]{0,60}>/gi
const SQUARE_TAG = /\[[^\]]{0,40}\]/g
const STRAY = /[<>|[\]{}\\]/g
const CONTROL = /\p{Cc}/gu
/** Format characters: zero-width, joiners, bidi overrides and isolates, BOM, soft hyphen. */
const INVISIBLE = /[\p{Cf}\p{Co}\p{Cs}]/gu
const SPACES = /\s+/g

/**
 * A quote as plain text: no control, invisible or direction-changing characters, no markup, no voice
 * tag, no link, collapsed spaces, at most `max` characters. null when nothing readable is left.
 */
export function cleanQuote(raw: unknown, max: number = MAX_QUOTE): string | null {
  if (typeof raw !== 'string') return null
  const plain = raw
    .normalize('NFC')
    .replace(LINK, ' ')
    .replace(ANGLE_TAG, ' ')
    .replace(SQUARE_TAG, ' ')
    .replace(INVISIBLE, '')
    .replace(CONTROL, ' ')
    .replace(STRAY, ' ')
    .replace(SPACES, ' ')
    .trim()
  if (!plain) return null
  if (plain.length <= max) return plain
  const cut = plain.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

const REF = /^[A-Z]{3}-\d{1,3}$/
const NAME = /^[\p{L}\p{N} _.'-]{1,32}$/u

/** A card ref (`LAV-08`) or null. */
export function cleanRef(raw: unknown): string | null {
  return typeof raw === 'string' && REF.test(raw) ? raw : null
}

/** A handle or alias (`chato`, `Rival Noche`) or null. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.normalize('NFC').trim()
  return NAME.test(name) ? name : null
}

/** A whole number from 0 to the game's cap, or null. */
export function cleanInt(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= MAX_PRIMAS ? raw : null
}
