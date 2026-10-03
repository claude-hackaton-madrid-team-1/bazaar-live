/**
 * The words of the Our market screen, in the page's language (kept apart from strings.ts: one screen, one file).
 * Team ids stay as the game writes them (`t08`): they are what the boards and the tape show. Our values come in
 * only when the page may show them (GAME_VIEW_TOKEN), else null.
 */
import type { Lang } from '../../shared/lang.ts'
import { useLang } from '../ui/lang'
import type { Rarity } from './game.ts'
import type { TeamSide } from './teamThreads.ts'
import type { BrokerRow } from './decisions.ts'
import type { AskKind, AskRow, AskVerdict } from './views/our-market.ts'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const p = (v: number) => `${Math.round(v * 10) / 10} P`

/** Cards and cash of one side, or null when it moves nothing. */
const goods = (x: TeamSide, and: string): string | null => {
  const parts = [...x.cards, ...(x.cash > 0 ? [p(x.cash)] : [])]
  return parts.length ? parts.join(` ${and} `) : null
}

export interface OurMarketStrings {
  readonly title: string
  readonly noVenue: string
  readonly venueSub: (id: string, mechanism: string | null) => string
  readonly facts: Readonly<Record<'status' | 'fee' | 'bond' | 'opened' | 'trades' | 'volume' | 'traders' | 'bench', string>>
  readonly status: Readonly<Record<'open' | 'closing' | 'closed', string>>
  readonly fee: (bps: number | null, perCard: number | null) => string
  readonly tick: (n: number) => string
  readonly tapeNote: string
  readonly board: string
  readonly boardSub: (asks: number, bids: number, swaps: number) => string
  readonly emptyBoard: string
  readonly asks: string
  readonly bids: string
  readonly swaps: string
  readonly ours: string
  readonly rival: string
  readonly rivalTitle: string
  readonly rarity: Readonly<Record<Rarity, string>>
  readonly lapses: (n: number) => string
  readonly matches: string
  readonly matchesSub: (n: number, bench: number) => string
  readonly noMatches: string
  /** A match: `seller → buyer` (a bench's pseudonyms), or the two makers when the pair is two offer ids. */
  readonly match: (m: Pick<BrokerRow, 'buyer' | 'seller' | 'makers' | 'price'>) => string
  readonly surplus: (v: number) => string
  readonly benchTag: string
  readonly liveTag: string
  readonly benches: string
  readonly benchesSub: (points: number | null) => string
  readonly noBenches: string
  readonly benchLine: (session: number | null, from: number | null, to: number | null) => string
  readonly benchOurs: (matches: number, surplus: number) => string
  readonly benchNotOurs: string
  readonly benchLive: string
  readonly announcements: string
  readonly noAnnouncements: string
  readonly asked: string
  readonly askedSub: (forUs: number, bids: number, asks: number) => string
  readonly noAsked: string
  readonly kind: Readonly<Record<AskKind, string>>
  readonly askLine: (r: AskRow, values: boolean) => string
  readonly valuesHidden: string
}

/** The note after an offer: what our album says, and (with values) what our value says. */
function noteEn(r: AskRow, values: boolean): string {
  const v = (verdict: AskVerdict | null) => (verdict ? { keep: 'keep', sell: 'sell', hold: 'hold', buy: 'buy', skip: 'skip' }[verdict] : null)
  if (r.side === 'bid' && r.held > 0) {
    if (!r.duplicate) return `we hold 1, not a duplicate: ${v('keep')}`
    const head = `we hold ${r.held}, a duplicate`
    return values && r.worth != null && r.valueVerdict ? `${head}; worth ${p(r.worth)} to us: ${v(r.verdict)}` : head
  }
  if (values && r.worth != null && r.valueVerdict) return `worth ${p(r.worth)} to us: ${v(r.verdict)}`
  const missing = r.kind === 'forUs' && r.side === 'swap' ? `we're missing ${r.ref}` : "we're missing it"
  return r.kind === 'askMissing' || (r.side !== 'bid' && r.held === 0) ? missing : r.held > 0 ? `we hold ${r.held}` : ''
}

function noteEs(r: AskRow, values: boolean): string {
  const v = (verdict: AskVerdict | null) => (verdict ? { keep: 'la guardamos', sell: 'vender', hold: 'guardar', buy: 'comprar', skip: 'no comprar' }[verdict] : null)
  if (r.side === 'bid' && r.held > 0) {
    if (!r.duplicate) return `tenemos 1, no es repetida: ${v('keep')}`
    const head = `tenemos ${r.held}, una repetida`
    return values && r.worth != null && r.valueVerdict ? `${head}; nos vale ${p(r.worth)}: ${v(r.verdict)}` : head
  }
  if (values && r.worth != null && r.valueVerdict) return `nos vale ${p(r.worth)}: ${v(r.verdict)}`
  const missing = r.kind === 'forUs' && r.side === 'swap' ? `nos falta ${r.ref}` : 'nos falta'
  return r.kind === 'askMissing' || (r.side !== 'bid' && r.held === 0) ? missing : r.held > 0 ? `tenemos ${r.held}` : ''
}

const withNote = (line: string, note: string) => (note ? `${line} (${note})` : line)

const both = (a: string, b: string) => [a, b].filter(Boolean).join('; ')

/** What a swap would take from us: our only copy, a duplicate, or a card we do not even hold. */
const takesEn = (r: AskRow) =>
  r.wantHeld.map((w) => (w.held === 1 ? `${w.ref} is our only copy` : w.held > 1 ? `${w.ref} is a duplicate of ours` : `we don't hold ${w.ref}`)).join(', ')

const takesEs = (r: AskRow) =>
  r.wantHeld.map((w) => (w.held === 1 ? `${w.ref} es nuestra única copia` : w.held > 1 ? `${w.ref} la tenemos repetida` : `no tenemos ${w.ref}`)).join(', ')

const isOfferId = (v: string | null) => v != null && /^\d+$/.test(v)

const pairOf = (m: Pick<BrokerRow, 'buyer' | 'seller' | 'makers'>, offers: string) =>
  isOfferId(m.buyer) || isOfferId(m.seller)
    ? `${m.makers.length ? m.makers.join(' × ') : '?'} (${offers} #${m.seller ?? '?'} → #${m.buyer ?? '?'})`
    : `${m.seller ?? '?'} → ${m.buyer ?? '?'}`

const EN: OurMarketStrings = {
  title: 'Our market',
  noVenue: 'We run no venue right now.',
  venueSub: (id, mechanism) => `${id}${mechanism ? ` · ${mechanism}` : ''}`,
  facts: { status: 'Status', fee: 'Fee', bond: 'Bond', opened: 'Opened', trades: 'Trades', volume: 'Volume', traders: 'Traders', bench: 'Bench points' },
  status: { open: 'open', closing: 'closing', closed: 'closed' },
  fee: (bps, perCard) => (bps == null && perCard == null ? '—' : `${Math.round((bps ?? 0) / 10) / 10} %${perCard ? ` + ${p(perCard)} a card` : ''}`),
  tick: (n) => `tick ${n}`,
  tapeNote: 'Trades, volume and traders count the settlements this page has seen (its tape window).',
  board: 'Our board now',
  boardSub: (asks, bids, swaps) => [plural(asks, 'ask', 'asks'), plural(bids, 'bid', 'bids'), ...(swaps ? [plural(swaps, 'swap', 'swaps')] : [])].join(' · '),
  emptyBoard: 'Nothing on our board right now.',
  asks: 'Asks',
  bids: 'Bids',
  swaps: 'Swaps',
  ours: 'ours',
  rival: 'rival',
  rivalTitle: 'One of the teams we watch as rivals',
  rarity: { common: 'common', uncommon: 'uncommon', rare: 'rare', epic: 'epic', legendary: 'legendary' },
  lapses: (n) => (n <= 0 ? 'lapses now' : `lapses in ${plural(n, 'tick', 'ticks')}`),
  matches: 'Matches our broker made',
  matchesSub: (n, bench) => `${plural(n, 'match', 'matches')}${bench ? ` · ${bench} on a bench` : ''}`,
  noMatches: 'No match seen yet. They come from our database (db/agent_decisions.sql, view show.agent_broker).',
  match: (m) => `${pairOf(m, 'offers')}${m.price == null ? '' : ` at ${p(m.price)}`}`,
  surplus: (v) => `surplus ${p(v)}`,
  benchTag: 'bench',
  liveTag: 'live',
  benches: 'Bench sessions',
  benchesSub: (points) => (points == null ? 'the same synthetic book on every venue' : `our bench points: ${points}`),
  noBenches: 'No bench session seen yet.',
  benchLine: (session, from, to) => `Session ${session ?? '?'}${from != null ? ` · ticks ${from}${to != null ? `–${to}` : ''}` : ''}`,
  benchOurs: (matches, surplus) => `our venue: ${plural(matches, 'match', 'matches')}, surplus ${p(surplus)}`,
  benchNotOurs: 'our venue was not in it',
  benchLive: 'running now',
  announcements: 'Our announcements',
  noAnnouncements: 'No announcement of ours seen yet.',
  asked: 'What people are asking us',
  askedSub: (forUs, bids, asks) => `${forUs} for us · ${plural(bids, 'bid for our cards', 'bids for our cards')} · ${plural(asks, 'ask for a card we miss', 'asks for cards we miss')}`,
  noAsked: 'Nobody is asking us anything right now.',
  kind: { forUs: 'for us', bidHeld: 'bid for our card', askMissing: 'a card we miss' },
  askLine: (r, values) => {
    const gives = goods(r.give, '+')
    const wants = goods(r.want, '+')
    if (r.kind === 'forUs' && r.side === 'swap') {
      const cash = r.want.cash > 0 ? `for ${p(r.want.cash)}` : r.want.cards.length ? 'with no cash' : 'for free'
      return withNote(`${r.maker} offers ${gives ?? 'nothing'} to us ${cash}${r.want.cards.length ? ` if we give ${r.want.cards.join(' + ')}` : ''}`, both(noteEn(r, values), takesEn(r)))
    }
    if (r.side === 'bid') return withNote(`${r.maker} bids ${r.price == null ? '?' : p(r.price)} ${r.kind === 'forUs' ? 'to us ' : ''}for ${wants ?? r.ref}`, noteEn(r, values))
    if (r.side === 'swap') return withNote(`${r.maker} swaps ${gives ?? r.ref} for ${wants ?? 'nothing'}`, noteEn(r, values))
    return withNote(`${r.maker} ${r.kind === 'forUs' ? 'offers us' : 'sells'} ${gives ?? r.ref} at ${r.price == null ? '?' : p(r.price)}`, noteEn(r, values))
  },
  valuesHidden: 'Our values are hidden: open the page with ?token= to see them and the verdicts they give.',
}

const ES: OurMarketStrings = {
  title: 'Nuestro mercado',
  noVenue: 'Ahora mismo no llevamos ningún puesto.',
  venueSub: (id, mechanism) => `${id}${mechanism ? ` · ${mechanism}` : ''}`,
  facts: { status: 'Estado', fee: 'Comisión', bond: 'Fianza', opened: 'Abierto', trades: 'Tratos', volume: 'Volumen', traders: 'Equipos', bench: 'Puntos de banco' },
  status: { open: 'abierto', closing: 'cerrando', closed: 'cerrado' },
  fee: (bps, perCard) => (bps == null && perCard == null ? '—' : `${Math.round((bps ?? 0) / 10) / 10} %${perCard ? ` + ${p(perCard)} por cromo` : ''}`),
  tick: (n) => `turno ${n}`,
  tapeNote: 'Tratos, volumen y equipos cuentan las liquidaciones que esta página ha visto (su ventana de la cinta).',
  board: 'Nuestro tablón ahora',
  boardSub: (asks, bids, swaps) => [plural(asks, 'venta', 'ventas'), plural(bids, 'compra', 'compras'), ...(swaps ? [plural(swaps, 'intercambio', 'intercambios')] : [])].join(' · '),
  emptyBoard: 'Nada en nuestro tablón ahora mismo.',
  asks: 'Ventas',
  bids: 'Compras',
  swaps: 'Intercambios',
  ours: 'nuestra',
  rival: 'rival',
  rivalTitle: 'Uno de los equipos que vigilamos como rivales',
  rarity: { common: 'común', uncommon: 'poco común', rare: 'rara', epic: 'épica', legendary: 'legendaria' },
  lapses: (n) => (n <= 0 ? 'caduca ya' : `caduca en ${plural(n, 'turno', 'turnos')}`),
  matches: 'Cruces de nuestro bróker',
  matchesSub: (n, bench) => `${plural(n, 'cruce', 'cruces')}${bench ? ` · ${bench} en un banco` : ''}`,
  noMatches: 'Aún no hay cruces. Llegan de nuestra base de datos (db/agent_decisions.sql, vista show.agent_broker).',
  match: (m) => `${pairOf(m, 'ofertas')}${m.price == null ? '' : ` a ${p(m.price)}`}`,
  surplus: (v) => `excedente ${p(v)}`,
  benchTag: 'banco',
  liveTag: 'real',
  benches: 'Sesiones de banco',
  benchesSub: (points) => (points == null ? 'el mismo libro sintético en todos los puestos' : `nuestros puntos de banco: ${points}`),
  noBenches: 'Aún no hay ninguna sesión de banco.',
  benchLine: (session, from, to) => `Sesión ${session ?? '?'}${from != null ? ` · turnos ${from}${to != null ? `–${to}` : ''}` : ''}`,
  benchOurs: (matches, surplus) => `nuestro puesto: ${plural(matches, 'cruce', 'cruces')}, excedente ${p(surplus)}`,
  benchNotOurs: 'nuestro puesto no estaba',
  benchLive: 'en marcha',
  announcements: 'Nuestros anuncios',
  noAnnouncements: 'Aún no hay anuncios nuestros.',
  asked: 'Lo que nos piden',
  askedSub: (forUs, bids, asks) => `${forUs} para nosotros · ${plural(bids, 'compra de un cromo nuestro', 'compras de cromos nuestros')} · ${plural(asks, 'venta de un cromo que nos falta', 'ventas de cromos que nos faltan')}`,
  noAsked: 'Nadie nos pide nada ahora mismo.',
  kind: { forUs: 'para nosotros', bidHeld: 'compra un cromo nuestro', askMissing: 'un cromo que nos falta' },
  askLine: (r, values) => {
    const gives = goods(r.give, '+')
    const wants = goods(r.want, '+')
    if (r.kind === 'forUs' && r.side === 'swap') {
      const cash = r.want.cash > 0 ? `por ${p(r.want.cash)}` : r.want.cards.length ? 'sin dinero' : 'gratis'
      return withNote(`${r.maker} nos ofrece ${gives ?? 'nada'} ${cash}${r.want.cards.length ? ` si le damos ${r.want.cards.join(' + ')}` : ''}`, both(noteEs(r, values), takesEs(r)))
    }
    if (r.side === 'bid') return withNote(`${r.maker} ${r.kind === 'forUs' ? 'nos puja' : 'puja'} ${r.price == null ? '?' : p(r.price)} por ${wants ?? r.ref}`, noteEs(r, values))
    if (r.side === 'swap') return withNote(`${r.maker} cambia ${gives ?? r.ref} por ${wants ?? 'nada'}`, noteEs(r, values))
    return withNote(`${r.maker} ${r.kind === 'forUs' ? 'nos ofrece' : 'vende'} ${gives ?? r.ref} a ${r.price == null ? '?' : p(r.price)}`, noteEs(r, values))
  },
  valuesHidden: 'Nuestros valores están ocultos: abre la página con ?token= para verlos, y los veredictos que dan.',
}

export const OUR_MARKET_STRINGS: Readonly<Record<Lang, OurMarketStrings>> = { es: ES, en: EN }

export function useOurMarketStrings(): OurMarketStrings {
  return OUR_MARKET_STRINGS[useLang()]
}
