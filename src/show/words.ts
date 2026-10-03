/** Small helpers that turn refs, items and numbers into words the characters can say. */
import { ERROR_WORDS, KINDS, UNKNOWN_ERROR, UNKNOWN_KIND, VERDICTS } from '../../shared/lines.ts'
import type { DealerId } from './beat'

const NEIGHBOURHOODS: Readonly<Record<string, string>> = {
  LAV: 'Lavapiés',
  MAL: 'Malasaña',
  LAT: 'La Latina',
  SAL: 'Salamanca',
  RET: 'El Retiro',
  CHA: 'Chamberí',
}

const ITEMS: Readonly<Record<string, string>> = {
  sobre_barrio: 'a neighbourhood pack',
  sobre_plata: 'a silver pack',
  common: 'a common',
  uncommon: 'an uncommon',
  rare: 'a rare',
  epic: 'an epic',
  legendary: 'a legendary',
}

const REF = /^([A-Z]{3})-(\d{1,3})$/

/**
 * `LAT-09` → `La Latina number 9`; a ref from a set we do not know yet stays `XYZ-01`; anything else
 * is `this card`. Every output matches shared/lines.ts's card pattern (the proxy checks it).
 */
export function cardName(ref: string | undefined): string {
  const m = REF.exec((ref ?? '').trim().toUpperCase())
  if (!m) return 'this card'
  const [, set = '', n = ''] = m
  const hood = NEIGHBOURHOODS[set]
  return hood ? `${hood} number ${Number(n)}` : `${set}-${n}`
}

/** What a dealer thread is about: a pack, a rarity or a card. */
export function itemName(item: string | undefined): string {
  if (!item) return 'a little something'
  return ITEMS[item.toLowerCase()] ?? cardName(item)
}

const MAX_PRIMAS = 10_000_000 // the game's own cap on prices and cash

export function primas(value: number | undefined | null): string | null {
  if (value === undefined || value === null || !Number.isFinite(value) || value < 0 || value > MAX_PRIMAS) return null
  const n = Math.round(value * 10) / 10
  return `${n} ${n === 1 ? 'prima' : 'primas'}`
}

const LABEL = /^[a-z0-9_]{1,30}$/

/** A machine label (`not_approved`) as words for the stage chip, or null when it is not a plain label. */
export function labelWords(label: string | null | undefined): string | null {
  const v = (label ?? '').toLowerCase()
  return LABEL.test(v) ? v.replace(/_/g, ' ').trim() || null : null
}

/** A decision kind as words, from the documented list only (the TTS proxy accepts nothing else). */
export function kindWords(kind: string | null | undefined): string {
  const v = (kind ?? '').toLowerCase()
  return KINDS.includes(v) ? v.replace(/_/g, ' ') : UNKNOWN_KIND
}

/** Jev's verdict as words (`quick sale`), from its known options only; null otherwise. */
export function verdictWords(verdict: string | null | undefined): string | null {
  const v = (verdict ?? '').toLowerCase()
  return VERDICTS.includes(v) ? v.replace(/_/g, ' ') : null
}

export function dealerId(name: string | undefined): DealerId {
  const id = (name ?? '').toLowerCase()
  if (id.includes('abuela') || id.includes('carmen')) return 'abuela'
  if (id.includes('chato')) return 'chato'
  return 'other'
}

export const DEALER_NAMES: Readonly<Record<DealerId, string>> = {
  abuela: 'Abuela Carmen',
  chato: 'El Chato',
  other: 'the dealer',
}

export function errorWords(code: string): string {
  return ERROR_WORDS[code] ?? UNKNOWN_ERROR
}

/** FNV-1a: a stable 32-bit seed per event, so the same event always gets the same line. */
export function seedOf(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Pick one of `options` with `seed`; `salt` lets two picks from one seed differ. */
export function pick<T>(options: readonly T[], seed: number, salt = 0): T {
  if (options.length === 0) throw new Error('pick() needs at least one option')
  const mixed = Math.imul(seed ^ (salt * 0x9e3779b1), 0x85ebca6b) >>> 0
  return options[mixed % options.length] as T
}
