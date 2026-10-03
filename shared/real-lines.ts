/**
 * The lines the show GENERATES about a real conversation, built from its structured fields (a price, a
 * card, whose offer): "I offer 24 primas for Lavapiés number 8." / "Ofrezco 24 primas por Lavapiés
 * número 8." One language per line, the selected one, never mixed.
 *
 * Like shared/lines.ts, these are closed templates with slot patterns: the TTS proxy can recognise
 * them (`isRealLine`) and so voice them without voicing anyone's free text. Real quotes are not here:
 * the proxy vouches for those separately (the server read them from the database itself).
 *
 * Imported by the browser bundle and by the Node proxy.
 */
import type { Lang } from './lang.ts'
import { LANGS } from './lang.ts'
import type { OfferView, Who } from './transcript.ts'

const HOODS: Readonly<Record<string, string>> = {
  LAV: 'Lavapiés', MAL: 'Malasaña', LAT: 'La Latina', SAL: 'Salamanca', RET: 'El Retiro', CHA: 'Chamberí',
}
const NUMBER: Readonly<Record<Lang, string>> = { en: 'number', es: 'número' }
const THIS_CARD: Readonly<Record<Lang, string>> = { en: 'this card', es: 'esta carta' }
const PACKS: Readonly<Record<Lang, Readonly<Record<string, string>>>> = {
  en: { sobre_barrio: 'a neighbourhood pack', sobre_plata: 'a silver pack' },
  es: { sobre_barrio: 'un sobre de barrio', sobre_plata: 'un sobre de plata' },
}
const REF = /^([A-Z]{3})-(\d{1,3})$/
const MAX_PRIMAS = 10_000_000

/** `LAV-08` → `Lavapiés number 8`; a pack by name; anything else `this card`. */
export function cardWords(item: string | null | undefined, lang: Lang): string {
  const m = REF.exec(item ?? '')
  if (m) {
    const [, set = '', n = ''] = m
    const hood = HOODS[set]
    return hood ? `${hood} ${NUMBER[lang]} ${Number(n)}` : `${set}-${n}`
  }
  return PACKS[lang][item ?? ''] ?? THIS_CARD[lang]
}

export function primasWords(price: number): string {
  const n = Math.min(MAX_PRIMAS, Math.max(0, Math.round(price)))
  return `${n} ${n === 1 ? 'prima' : 'primas'}`
}

type Key =
  | 'US_BID' | 'US_BID_FINAL' | 'US_ASK' | 'US_ASK_FINAL' | 'THEM_BID' | 'THEM_BID_FINAL' | 'THEM_ASK' | 'THEM_ASK_FINAL'
  | 'SETTLED' | 'OPENED' | 'DUEL_DEAL' | 'DUEL_DEAL_BARE' | 'DUEL_NO_DEAL' | 'DUEL_US' | 'DUEL_THEM'

const TEMPLATES: Readonly<Record<Lang, Readonly<Record<Key, string>>>> = {
  en: {
    US_BID: 'I offer {price} for {card}.',
    US_BID_FINAL: 'My final offer: {price} for {card}.',
    US_ASK: 'I want {price} for {card}.',
    US_ASK_FINAL: 'Final price: {price} for {card}.',
    THEM_BID: "I'll pay {price} for {card}.",
    THEM_BID_FINAL: 'Last offer: {price} for {card}. Take it or leave it.',
    THEM_ASK: '{card} will cost you {price}.',
    THEM_ASK_FINAL: 'Final price for {card}: {price}. Take it or leave it.',
    SETTLED: 'Deal done: {card} for {price}.',
    OPENED: "I'm after {card}.",
    DUEL_DEAL: 'The duel is over: a deal at {price}.',
    DUEL_DEAL_BARE: 'The duel is over: a deal.',
    DUEL_NO_DEAL: 'The duel is over: no deal.',
    DUEL_US: 'My offer is {price}.',
    DUEL_THEM: '{price} is my price.',
  },
  es: {
    US_BID: 'Ofrezco {price} por {card}.',
    US_BID_FINAL: 'Mi última oferta: {price} por {card}.',
    US_ASK: 'Quiero {price} por {card}.',
    US_ASK_FINAL: 'Precio final: {price} por {card}.',
    THEM_BID: 'Te pago {price} por {card}.',
    THEM_BID_FINAL: 'Última oferta: {price} por {card}. O la tomas o la dejas.',
    THEM_ASK: '{card} te sale por {price}.',
    THEM_ASK_FINAL: 'Precio final de {card}: {price}. O lo tomas o lo dejas.',
    SETTLED: 'Trato hecho: {card} por {price}.',
    OPENED: 'Voy a por {card}.',
    DUEL_DEAL: 'El duelo ha terminado: trato por {price}.',
    DUEL_DEAL_BARE: 'El duelo ha terminado: trato cerrado.',
    DUEL_NO_DEAL: 'El duelo ha terminado: sin trato.',
    DUEL_US: 'Mi oferta es {price}.',
    DUEL_THEM: '{price} es mi precio.',
  },
}

const fill = (key: Key, lang: Lang, values: { card?: string; price?: string }): string =>
  TEMPLATES[lang][key].replace('{card}', values.card ?? '').replace('{price}', values.price ?? '')

/** What an offer says, from its structure: who makes it, whether they pay or ask, how much, for what. */
export function offerLine(offer: OfferView, lang: Lang): string {
  const key = `${offer.by === 'us' ? 'US' : 'THEM'}_${offer.verb === 'bid' ? 'BID' : 'ASK'}${offer.final ? '_FINAL' : ''}` as Key
  return fill(key, lang, { card: cardWords(offer.item, lang), price: primasWords(offer.price) })
}

export const settlementLine = (price: number, item: string | null, lang: Lang): string =>
  fill('SETTLED', lang, { card: cardWords(item, lang), price: primasWords(price) })

export const openedLine = (item: string | null, lang: Lang): string | null => (item ? fill('OPENED', lang, { card: cardWords(item, lang) }) : null)

export function duelEndLine(status: 'deal' | 'no_deal', price: number | null, lang: Lang): string {
  if (status === 'no_deal') return fill('DUEL_NO_DEAL', lang, {})
  return price === null ? fill('DUEL_DEAL_BARE', lang, {}) : fill('DUEL_DEAL', lang, { price: primasWords(price) })
}

export const duelOfferLine = (who: Who, price: number, lang: Lang): string => fill(who === 'us' ? 'DUEL_US' : 'DUEL_THEM', lang, { price: primasWords(price) })

// ---------------------------------------------------------------- recognising them (the TTS proxy)

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const alt = (words: readonly string[]): string => `(?:${words.map(escape).join('|')})`

const slotPattern = (lang: Lang): { card: string; price: string } => ({
  card: `(?:(?:${alt(Object.values(HOODS))}) ${NUMBER[lang]} \\d{1,3}|[A-Z]{3}-\\d{1,3}|${alt([THIS_CARD[lang], ...Object.values(PACKS[lang])])})`,
  price: '\\d{1,8} primas?',
})
const SLOT_PATTERN: Readonly<Record<Lang, { card: string; price: string }>> = { en: slotPattern('en'), es: slotPattern('es') }

function compile(template: string, lang: Lang): RegExp {
  const pattern = template
    .split(/(\{card\}|\{price\})/)
    .map((part) => (part === '{card}' ? SLOT_PATTERN[lang].card : part === '{price}' ? SLOT_PATTERN[lang].price : escape(part)))
    .join('')
  return new RegExp(`^${pattern}$`, 'u')
}

const matchersOf = (lang: Lang): readonly RegExp[] => Object.values(TEMPLATES[lang]).map((t) => compile(t, lang))
const MATCHERS: Readonly<Record<Lang, readonly RegExp[]>> = { en: matchersOf('en'), es: matchersOf('es') }

/** True when `text` is one of the lines above (in `lang`, or in either language when none is given). */
export function isRealLine(text: string, lang?: Lang): boolean {
  return (lang ? [lang] : LANGS).some((l) => MATCHERS[l].some((re) => re.test(text)))
}
