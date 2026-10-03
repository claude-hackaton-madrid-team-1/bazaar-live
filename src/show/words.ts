/** Small helpers that turn refs, items and numbers into words the characters can say. */
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

/** `LAT-09` → `La Latina number 9`; anything else is returned as it came. */
export function cardName(ref: string | undefined): string {
  if (!ref) return 'this card'
  const m = REF.exec(ref.trim().toUpperCase())
  if (!m) return ref
  const [, set = '', n = ''] = m
  const hood = NEIGHBOURHOODS[set]
  return hood ? `${hood} number ${Number(n)}` : ref
}

/** What a dealer thread is about: a pack, a rarity or a card. */
export function itemName(item: string | undefined): string {
  if (!item) return 'a little something'
  return ITEMS[item.toLowerCase()] ?? cardName(item)
}

export function primas(value: number | undefined | null): string | null {
  if (value === undefined || value === null || !Number.isFinite(value)) return null
  const n = Math.round(value * 10) / 10
  return `${n} ${n === 1 ? 'prima' : 'primas'}`
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

const ERRORS: Readonly<Record<string, string>> = {
  insufficient_cash: 'not enough cash',
  wait_for_tick: 'wait for the next tick',
  rate_limited: 'slow down',
  persona_quota: 'quota is full this hour',
  cooloff: 'cool off for a while',
  sold_out: 'sold out',
  asset_locked: 'that card is locked',
  not_owner: 'not ours to sell',
  venue_not_live: 'that market is not open',
}

export function errorWords(code: string): string {
  return ERRORS[code] ?? code.replace(/_/g, ' ')
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
