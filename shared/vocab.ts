/**
 * The words the show fills into its templates, per language, and the patterns that describe exactly
 * those words (the TTS proxy checks every slot against them, so it cannot be used to voice anyone's
 * own text). src/show/words.ts produces the words; this file is the only place they are listed.
 *
 * Imported by the browser bundle and by the Node proxy.
 */
import type { Lang } from './lang.ts'

export const HOODS: Readonly<Record<string, string>> = {
  LAV: 'Lavapiés',
  MAL: 'Malasaña',
  LAT: 'La Latina',
  SAL: 'Salamanca',
  RET: 'El Retiro',
  CHA: 'Chamberí',
}

/** The game's refusal codes (vendor/bazaar-kit README, "Errors you will meet"). */
export const ERROR_CODES = [
  'insufficient_cash', 'wait_for_tick', 'rate_limited', 'persona_quota', 'cooloff', 'sold_out', 'asset_locked',
  'not_owner', 'venue_not_live', 'locked', 'self_venue', 'bad_key', 'missing_days',
] as const

/** Decision kinds docs/services.md lists; any other kind is `something new`. */
export const KIND_CODES = [
  'accept_ask', 'dealer_open', 'dealer_bid', 'dealer_accept', 'dealer_walk', 'post_ask', 'post_bid',
  'cancel_ask', 'cancel_bid', 'hold_ask', 'hold_bid', 'reprice_ask', 'reprice_bid', 'duel_accept',
  'duel_offer', 'duel_hold',
] as const

/** Jev's verdict labels (docs/services.md: a noul's yes/no, a choice's option, undecided). */
export const VERDICT_CODES = [
  'aggressive', 'fair', 'quick_sale', 'hold', 'reprice', 'yes', 'no', 'accept', 'reject', 'walk', 'bid', 'undecided',
] as const

export const RARITY_CODES = ['sobre_barrio', 'sobre_plata', 'common', 'uncommon', 'rare', 'epic', 'legendary'] as const

const WEEKDAYS: Readonly<Record<Lang, readonly string[]>> = {
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
}

export interface Vocab {
  readonly number: string
  readonly thisCard: string
  readonly items: Readonly<Record<(typeof RARITY_CODES)[number], string>>
  readonly someItem: string
  readonly dealers: { readonly abuela: string; readonly chato: string; readonly other: string }
  readonly verdicts: Readonly<Record<(typeof VERDICT_CODES)[number], string>>
  readonly errors: Readonly<Record<(typeof ERROR_CODES)[number], string>>
  readonly unknownError: string
  readonly kinds: Readonly<Record<(typeof KIND_CODES)[number], string>>
  readonly unknownKind: string
  readonly minute: readonly [string, string]
  readonly hour: readonly [string, string]
  readonly today: string
  readonly tomorrow: string
  readonly on: string
  readonly at: string
  /** The preposition before one o'clock ("a la 1:05"). */
  readonly atOne: string
}

export const VOCAB: Readonly<Record<Lang, Vocab>> = {
  es: {
    number: 'número',
    thisCard: 'esta carta',
    items: {
      sobre_barrio: 'un sobre de barrio',
      sobre_plata: 'un sobre de plata',
      common: 'una común',
      uncommon: 'una poco común',
      rare: 'una rara',
      epic: 'una épica',
      legendary: 'una legendaria',
    },
    someItem: 'algo especial',
    dealers: { abuela: 'Abuela Carmen', chato: 'El Chato', other: 'el tratante' },
    verdicts: {
      aggressive: 'agresivo', fair: 'justo', quick_sale: 'venta rápida', hold: 'mantener', reprice: 'cambiar el precio',
      yes: 'sí', no: 'no', accept: 'aceptar', reject: 'rechazar', walk: 'irse', bid: 'pujar', undecided: 'indeciso',
    },
    errors: {
      insufficient_cash: 'no hay efectivo suficiente',
      wait_for_tick: 'hay que esperar al siguiente turno',
      rate_limited: 'vamos demasiado rápido',
      persona_quota: 'la cuota de esta hora está llena',
      cooloff: 'toca enfriarse un rato',
      sold_out: 'agotado',
      asset_locked: 'esa carta está bloqueada',
      not_owner: 'no es nuestra para vender',
      venue_not_live: 'ese mercado no está abierto',
      locked: 'ese tratante está bloqueado',
      self_venue: 'no en nuestro propio mercado',
      bad_key: 'una clave incorrecta',
      missing_days: 'faltan los días',
    },
    unknownError: 'un error desconocido',
    kinds: {
      accept_ask: 'aceptar una oferta', dealer_open: 'abrir con un tratante', dealer_bid: 'pujar a un tratante',
      dealer_accept: 'cerrar con un tratante', dealer_walk: 'irse de un tratante', post_ask: 'poner a la venta',
      post_bid: 'pedir una carta', cancel_ask: 'retirar una oferta', cancel_bid: 'retirar una puja',
      hold_ask: 'mantener la oferta', hold_bid: 'mantener la puja', reprice_ask: 'cambiar el precio',
      reprice_bid: 'cambiar la puja', duel_accept: 'aceptar un duelo', duel_offer: 'ofrecer en un duelo',
      duel_hold: 'aguantar en un duelo',
    },
    unknownKind: 'algo nuevo',
    minute: ['minuto', 'minutos'],
    hour: ['hora', 'horas'],
    today: 'hoy',
    tomorrow: 'mañana',
    on: 'el',
    at: 'a las',
    atOne: 'a la',
  },
  en: {
    number: 'number',
    thisCard: 'this card',
    items: {
      sobre_barrio: 'a neighbourhood pack',
      sobre_plata: 'a silver pack',
      common: 'a common',
      uncommon: 'an uncommon',
      rare: 'a rare',
      epic: 'an epic',
      legendary: 'a legendary',
    },
    someItem: 'a little something',
    dealers: { abuela: 'Abuela Carmen', chato: 'El Chato', other: 'the dealer' },
    verdicts: {
      aggressive: 'aggressive', fair: 'fair', quick_sale: 'quick sale', hold: 'hold', reprice: 'reprice',
      yes: 'yes', no: 'no', accept: 'accept', reject: 'reject', walk: 'walk', bid: 'bid', undecided: 'undecided',
    },
    errors: {
      insufficient_cash: 'not enough cash',
      wait_for_tick: 'wait for the next tick',
      rate_limited: 'slow down',
      persona_quota: 'quota is full this hour',
      cooloff: 'cool off for a while',
      sold_out: 'sold out',
      asset_locked: 'that card is locked',
      not_owner: 'not ours to sell',
      venue_not_live: 'that market is not open',
      locked: 'that dealer is locked',
      self_venue: 'not on our own market',
      bad_key: 'a bad key',
      missing_days: 'say the days too',
    },
    unknownError: 'an unknown error',
    kinds: {
      accept_ask: 'accept ask', dealer_open: 'dealer open', dealer_bid: 'dealer bid', dealer_accept: 'dealer accept',
      dealer_walk: 'dealer walk', post_ask: 'post ask', post_bid: 'post bid', cancel_ask: 'cancel ask',
      cancel_bid: 'cancel bid', hold_ask: 'hold ask', hold_bid: 'hold bid', reprice_ask: 'reprice ask',
      reprice_bid: 'reprice bid', duel_accept: 'duel accept', duel_offer: 'duel offer', duel_hold: 'duel hold',
    },
    unknownKind: 'something new',
    minute: ['minute', 'minutes'],
    hour: ['hour', 'hours'],
    today: 'today',
    tomorrow: 'tomorrow',
    on: 'on',
    at: 'at',
    atOne: 'at',
  },
}

const MAX_ETA_HOURS = 72

/** A wait as words ("45 minutos", "2 hours"), or null when it is not a usable countdown. */
export function etaWords(minutes: number | null | undefined, lang: Lang): string | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 2 || minutes > MAX_ETA_HOURS * 60) return null
  const vocab = VOCAB[lang]
  // Under two hours the minutes are what people count; after that, whole hours (never more than there are).
  if (minutes < 120) {
    const n = Math.max(1, Math.round(minutes))
    return `${n} ${vocab.minute[n === 1 ? 0 : 1]}`
  }
  const h = Math.floor(minutes / 60)
  return `${h} ${vocab.hour[h === 1 ? 0 : 1]}`
}

/** "hoy a las 9:00", "mañana a las 9:00" or "el sábado a las 9:00". `dayOffset` is 0 (today), 1 or more. */
export function opensWords(dayOffset: number, weekday: number, hour: number, minute: number, lang: Lang): string | null {
  if (!Number.isInteger(dayOffset) || dayOffset < 0 || weekday < 0 || weekday > 6 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  const vocab = VOCAB[lang]
  const clock = `${hour}:${String(minute).padStart(2, '0')}`
  const day = dayOffset === 0 ? vocab.today : dayOffset === 1 ? vocab.tomorrow : `${vocab.on} ${WEEKDAYS[lang][weekday]}`
  return `${day} ${hour === 1 ? vocab.atOne : vocab.at} ${clock}`
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const oneOf = (words: readonly string[]): string => `(?:${words.map(escape).join('|')})`

export const SLOT_NAMES = ['card', 'price', 'ask', 'item', 'dealerName', 'verdict', 'error', 'kind', 'count', 'eta', 'opens', 'hood', 'tick'] as const
export type Slot = (typeof SLOT_NAMES)[number]

const HOOD_NAMES = Object.values(HOODS)
const PRIMAS = '\\d{1,8}(?:[.,]\\d)? primas?'

/** What each slot may contain, per language: exactly the words src/show/words.ts produces. */
export function slotPatterns(lang: Lang): Readonly<Record<Slot, string>> {
  const vocab = VOCAB[lang]
  const card = `(?:(?:${oneOf(HOOD_NAMES)}) ${escape(vocab.number)} \\d{1,3}|[A-Z]{3}-\\d{1,3}|${escape(vocab.thisCard)})`
  return {
    card,
    price: PRIMAS,
    ask: PRIMAS,
    item: `(?:${oneOf([...Object.values(vocab.items), vocab.someItem])}|${card})`,
    dealerName: oneOf(Object.values(vocab.dealers)),
    verdict: oneOf(Object.values(vocab.verdicts)),
    error: oneOf([...Object.values(vocab.errors), vocab.unknownError]),
    kind: oneOf([...Object.values(vocab.kinds), vocab.unknownKind]),
    count: '\\d{1,3}',
    eta: `\\d{1,3} ${oneOf([...vocab.minute, ...vocab.hour])}`,
    opens: `(?:${escape(vocab.today)}|${escape(vocab.tomorrow)}|${escape(vocab.on)} ${oneOf(WEEKDAYS[lang])}) (?:${escape(vocab.at)}|${escape(vocab.atOne)}) \\d{1,2}:\\d{2}`,
    hood: oneOf(HOOD_NAMES),
    tick: '\\d{1,7}',
  }
}
