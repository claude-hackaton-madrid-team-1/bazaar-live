/** Small helpers that turn refs, items and numbers into words the characters can say, per language. */
import type { Lang } from '../../shared/lang.ts'
import { ERROR_CODES, HOODS, KIND_CODES, RARITY_CODES, VERDICT_CODES, VOCAB } from '../../shared/vocab.ts'
import type { DealerId } from './beat'

const REF = /^([A-Z]{3})-(\d{1,3})$/

const has = <T extends string>(list: readonly T[], value: string): value is T => (list as readonly string[]).includes(value)

/**
 * `LAT-09` → `La Latina número 9`; a ref from a set we do not know yet stays `XYZ-01`; anything else
 * is `esta carta`. Every output matches the card pattern in shared/vocab.ts (the proxy checks it).
 */
export function cardName(ref: string | undefined, lang: Lang): string {
  const m = REF.exec((ref ?? '').trim().toUpperCase())
  if (!m) return VOCAB[lang].thisCard
  const [, set = '', n = ''] = m
  const hood = HOODS[set]
  return hood ? `${hood} ${VOCAB[lang].number} ${Number(n)}` : `${set}-${n}`
}

/** What a dealer thread is about: a pack, a rarity or a card. */
export function itemName(item: string | undefined, lang: Lang): string {
  if (!item) return VOCAB[lang].someItem
  const key = item.toLowerCase()
  return has(RARITY_CODES, key) ? VOCAB[lang].items[key] : cardName(item, lang)
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
export function kindWords(kind: string | null | undefined, lang: Lang): string {
  const v = (kind ?? '').toLowerCase()
  return has(KIND_CODES, v) ? VOCAB[lang].kinds[v] : VOCAB[lang].unknownKind
}

/** Jev's verdict as words (`venta rápida`), from its known options only; null otherwise. */
export function verdictWords(verdict: string | null | undefined, lang: Lang): string | null {
  const v = (verdict ?? '').toLowerCase()
  return has(VERDICT_CODES, v) ? VOCAB[lang].verdicts[v] : null
}

export function dealerId(name: string | undefined): DealerId {
  const id = (name ?? '').toLowerCase()
  if (id.includes('abuela') || id.includes('carmen')) return 'abuela'
  if (id.includes('chato')) return 'chato'
  return 'other'
}

export function dealerName(id: DealerId, lang: Lang): string {
  return VOCAB[lang].dealers[id]
}

export function errorWords(code: string, lang: Lang): string {
  const v = VOCAB[lang]
  return has(ERROR_CODES, code) ? v.errors[code] : v.unknownError
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
