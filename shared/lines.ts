import { isJevLine } from './jev-lines.ts'
import { isActivityLine } from './activity-lines.ts'
/**
 * The show's lines, as data: one pack per language (lines.es.ts, lines.en.ts), each a set of banks of
 * short BUYER ↔ SELLER exchanges with `{slot}` placeholders, every variant tagged with its mood.
 *
 * The browser fills the slots from public event fields and from the agents' /health (src/show). The
 * TTS proxy only speaks text that matches one of these templates, in one language, with each slot
 * restricted to the words the show can produce (vocab.ts), so the public proxy cannot be used to voice
 * anyone's own text.
 *
 * Imported by the browser bundle and by the Node proxy, so it imports nothing but the shared files.
 */
import { BANK_KEYS, type Bank, type BankKey, type Pack, type Role, type Row, type Template, type Variant } from './bank.ts'
import { LANGS, type Lang } from './lang.ts'
import { EN } from './lines.en.ts'
import { ES } from './lines.es.ts'
import type { Speaker } from './tags.ts'
import { slotPatterns, SLOT_NAMES, type Slot } from './vocab.ts'

export type { Bank, BankKey, Pack, Role, Row, Template, Variant }
export { BANK_KEYS }
export type { Slot }
export const SLOTS: readonly Slot[] = SLOT_NAMES

export const PACKS: Readonly<Record<Lang, Pack>> = { es: ES, en: EN }

/** A slot's words, or null when the public data has none (templates using it are then skipped). */
export type SlotValues = Readonly<Record<Slot, string | null>>

export const NO_VALUES: SlotValues = Object.fromEntries(SLOT_NAMES.map((s) => [s, null])) as unknown as SlotValues

const SLOT = /\{([a-zA-Z]+)\}/g

function isSlot(name: string): name is Slot {
  return (SLOTS as readonly string[]).includes(name)
}

/** The slots a template needs. */
export function slotsOf(template: Template): Slot[] {
  return template.flatMap(([, text]) => [...text.matchAll(SLOT)].map((m) => m[1] ?? '')).filter(isSlot)
}

/** A template can be used only when every slot it names has a value. */
export function usable(template: Template, values: SlotValues): boolean {
  return slotsOf(template).every((slot) => values[slot] !== null)
}

export function fill(text: string, values: SlotValues): string {
  return text.replace(SLOT, (match, name: string) => (isSlot(name) ? (values[name] ?? match) : match))
}

/** Who says a template line: the dealer role resolves to the dealer on stage, or the narrator. */
export function speakerOf(role: Role, dealer: 'abuela' | 'chato' | 'pilar' | 'other'): Speaker {
  if (role !== 'dealer') return role
  return dealer === 'other' ? 'narrator' : dealer
}

const ROLES_FOR: Readonly<Record<Speaker, readonly Role[]>> = {
  buyer: ['buyer'],
  seller: ['seller'],
  abuela: ['dealer'],
  chato: ['dealer'],
  pilar: ['dealer'],
  guest1: ['dealer'],
  guest2: ['dealer'],
  guest3: ['dealer'],
  narrator: ['narrator', 'dealer'],
  jev: [],
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compile(text: string, patterns: Readonly<Record<Slot, string>>): RegExp {
  const parts = text.split(SLOT).map((part, i) => (i % 2 === 1 && isSlot(part) ? patterns[part] : escape(part)))
  return new RegExp(`^${parts.join('')}$`, 'u')
}

const matchers = new Map<Lang, ReadonlyMap<Role, readonly RegExp[]>>()

function matchersFor(lang: Lang): ReadonlyMap<Role, readonly RegExp[]> {
  const cached = matchers.get(lang)
  if (cached) return cached
  const patterns = slotPatterns(lang)
  const byRole = new Map<Role, RegExp[]>()
  const seen = new Set<string>()
  for (const bank of Object.values(PACKS[lang])) {
    for (const variant of bank) {
      for (const [role, text] of variant.lines) {
        const key = `${role}|${text}`
        if (seen.has(key)) continue
        seen.add(key)
        byRole.set(role, [...(byRole.get(role) ?? []), compile(text, patterns)])
      }
    }
  }
  matchers.set(lang, byRole)
  return byRole
}

/**
 * True when `speaker` saying `text` is a line the show could have produced, in `lang` (or in either
 * language when it is not given: a line is never half of each, because every pattern is one language's).
 */
export function isShowLine(speaker: Speaker, text: string, lang?: Lang): boolean {
  const langs: readonly Lang[] = lang ? [lang] : LANGS
  return langs.some((l) => (speaker === 'jev' && isJevLine(text, l)) || (speaker === 'narrator' && isActivityLine(text, l)) || ROLES_FOR[speaker].some((role) => (matchersFor(l).get(role) ?? []).some((re) => re.test(text))))
}

/** Every template line of a pack as raw text (with `{slots}`), for the language and tag checks. */
export function rawLines(lang: Lang): string[] {
  return Object.values(PACKS[lang]).flatMap((bank) => bank.flatMap((variant) => variant.lines.map(([, text]) => text)))
}
