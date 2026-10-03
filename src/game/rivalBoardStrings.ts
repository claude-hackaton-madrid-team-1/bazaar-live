/**
 * The words of the rival board (the private part of the Rivals screen), in the page's language: kept apart from
 * ./rivalStrings.ts (the public albums). The move is said from its fields (./views/rivalBoard.ts `moveOf`), never copied
 * from the view's English sentence. Gains are the board's estimates (their side at book value), and the words say so.
 */
import type { Lang } from '../../shared/lang.ts'
import type { GuardReason, MoveKind, StrengthCode, WeaknessCode } from '../../shared/rivalBoard.ts'
import { useLang } from '../ui/lang'
import type { MoveView } from './views/rivalBoard.ts'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const round1 = (v: number) => Math.round(v * 10) / 10

/** A number with one decimal at most: 8.5 in English, 8,5 in Spanish. */
const numIn = (lang: Lang) => (v: number): string => (lang === 'es' ? String(round1(v)).replace('.', ',') : String(round1(v)))

/** A gain with its sign (a true minus), 0 without one, or a dash when the board could not price it. */
const gainIn = (lang: Lang) => (v: number | null): string => {
  if (v === null) return '—'
  const r = round1(v)
  return r === 0 ? '0' : `${r > 0 ? '+' : '−'}${numIn(lang)(Math.abs(r))}`
}

interface Badge {
  readonly label: string
  readonly title: string
}

export interface RivalBoardStrings {
  readonly missing: string
  readonly guard: Readonly<Record<GuardReason, string>>
  readonly guardTitle: Readonly<Record<GuardReason, string>>
  readonly strength: Readonly<Record<StrengthCode, Badge>>
  readonly weakness: Readonly<Record<WeaknessCode, Badge>>
  readonly moveKind: Readonly<Record<MoveKind, string>>
  readonly moveTitle: (give: number, get: number) => string
  readonly move: (m: MoveView) => string
  /** A guarded team we may still trade with: why the board allows it. */
  readonly guardedTrade: (reason: GuardReason) => string
  readonly title: (team: string) => string
  readonly sub: string
  readonly versusUs: string
  readonly vs: (theirs: number | null, ours: number | null) => string
  readonly component: { readonly score: string; readonly negotiating: string; readonly market: string; readonly pages: string }
  readonly trend: (from: number, to: number, ticks: number | null) => string
  readonly strengthsHead: string
  readonly weaknessesHead: string
  readonly none: string
  readonly weHaveForThem: string
  readonly theyHaveForUs: string
  readonly theyWant: string
  readonly theyHave: string
  readonly spare: (n: number) => string
  /** Their bid for one of our spares; null: no live bid (a swap or a lapsed listing named it). */
  readonly theirBid: (price: number | null) => string
  /** Their ask for a copy we miss; null: no live ask. */
  readonly theirAsk: (price: number | null) => string
  readonly valueToUs: (value: number | null) => string
  readonly priceShort: (price: number | null) => string
  readonly noCards: string
  readonly setInterest: string
  readonly interestTitle: string
  readonly activity: (dealerDeals: number, venueTrades: number) => string
  readonly whyClimbed: string
  readonly atTick: (tick: number) => string
}

const EN_STRENGTH: Readonly<Record<StrengthCode, Badge>> = {
  negotiating: { label: 'Negotiates better', title: 'their negotiating points beat ours' },
  market: { label: 'Stronger market', title: 'their market points beat ours' },
  pages: { label: 'More pages', title: 'more complete album pages than us' },
  dealer_ladder: { label: 'Dealer ladder', title: 'more deals with the dealers than us' },
  venue: { label: 'Busy venue', title: 'more trades on their venue than on ours' },
  climbing: { label: 'Climbing', title: 'up two ranks or more over the trend window' },
}

const EN_WEAKNESS: Readonly<Record<WeaknessCode, Badge>> = {
  negotiating: { label: 'Weaker negotiator', title: 'their negotiating points trail ours' },
  market: { label: 'Weaker market', title: 'their market points trail ours' },
  pages: { label: 'Fewer pages', title: 'fewer complete album pages than us' },
  no_venue_trades: { label: 'Quiet venue', title: 'no trade on their venue yet' },
  falling: { label: 'Falling', title: 'down two ranks or more over the trend window' },
  needs_cards: { label: 'Needs cards', title: 'they bid for cards they miss: our spares may have a buyer' },
}

const ES_STRENGTH: Readonly<Record<StrengthCode, Badge>> = {
  negotiating: { label: 'Negocia mejor', title: 'sus puntos de negociación superan los nuestros' },
  market: { label: 'Mercado más fuerte', title: 'sus puntos de mercado superan los nuestros' },
  pages: { label: 'Más páginas', title: 'más páginas del álbum completas que nosotros' },
  dealer_ladder: { label: 'Escalera de tratantes', title: 'más tratos con los tratantes que nosotros' },
  venue: { label: 'Puesto activo', title: 'más ventas en su puesto que en el nuestro' },
  climbing: { label: 'Subiendo', title: 'sube dos puestos o más en la ventana de tendencia' },
}

const ES_WEAKNESS: Readonly<Record<WeaknessCode, Badge>> = {
  negotiating: { label: 'Negocia peor', title: 'sus puntos de negociación quedan por debajo de los nuestros' },
  market: { label: 'Mercado más flojo', title: 'sus puntos de mercado quedan por debajo de los nuestros' },
  pages: { label: 'Menos páginas', title: 'menos páginas del álbum completas que nosotros' },
  no_venue_trades: { label: 'Puesto sin ventas', title: 'aún ninguna venta en su puesto' },
  falling: { label: 'Cayendo', title: 'baja dos puestos o más en la ventana de tendencia' },
  needs_cards: { label: 'Busca cartas', title: 'pujan por cartas que les faltan: nuestros repetidos pueden tener comprador' },
}

function moveEn(m: MoveView): string {
  const g = gainIn('en')
  const gains = (t: { ourGain: number | null; theirGain: number | null }) => `${g(t.ourGain)} for us, ${g(t.theirGain)} for them (estimated)`
  const rule = 'A deal only if our gain is at least twice theirs, with their side at book value.'
  switch (m.kind) {
    case 'swap':
      return `Offer our spare ${m.give} for their ${m.get}: ${gains(m)}.`
    case 'sell':
      return `Sell our spare ${m.give} into their bid${m.price === null ? '' : ` of ${numIn('en')(m.price)} P`}: ${gains(m)}.`
    case 'buy':
      return `Buy their ${m.get}${m.price === null ? '' : ` at their ask of ${numIn('en')(m.price)} P`}: ${gains(m)}.`
    case 'hold': {
      if (m.reason === 'top5') return `Do not trade: a top-5 rival (rank ${m.rank}). ${rule}`
      if (m.ourRank === null) return `Do not trade: our own rank is unknown, so every team is guarded (theirs ${m.rank}). ${rule}`
      const distance = Math.abs(m.rank - m.ourRank)
      return distance === 0
        ? `Do not trade: level with us (rank ${m.rank}). ${rule}`
        : `Do not trade: ${plural(distance, 'rank', 'ranks')} from us (rank ${m.rank}, we are ${m.ourRank}). ${rule}`
    }
    case 'watch':
      return 'Nothing to trade yet: watch their bids.'
  }
}

function moveEs(m: MoveView): string {
  const g = gainIn('es')
  const gains = (t: { ourGain: number | null; theirGain: number | null }) => `${g(t.ourGain)} para nosotros, ${g(t.theirGain)} para ellos (estimado)`
  const rule = 'Solo un trato si ganamos al menos el doble que ellos, con su parte a valor de libro.'
  switch (m.kind) {
    case 'swap':
      return `Ofrece nuestro ${m.give} repetido por su ${m.get}: ${gains(m)}.`
    case 'sell':
      return `Vende nuestro ${m.give} repetido a su puja${m.price === null ? '' : ` de ${numIn('es')(m.price)} P`}: ${gains(m)}.`
    case 'buy':
      return `Compra su ${m.get}${m.price === null ? '' : ` por ${numIn('es')(m.price)} P, lo que piden`}: ${gains(m)}.`
    case 'hold': {
      if (m.reason === 'top5') return `No negociar: rival del top 5 (puesto ${m.rank}). ${rule}`
      if (m.ourRank === null) return `No negociar: no sabemos nuestro puesto, así que todos quedan protegidos (el suyo, ${m.rank}). ${rule}`
      const distance = Math.abs(m.rank - m.ourRank)
      return distance === 0
        ? `No negociar: empatados con nosotros (puesto ${m.rank}). ${rule}`
        : `No negociar: a ${plural(distance, 'puesto', 'puestos')} de nosotros (puesto ${m.rank}, nosotros ${m.ourRank}). ${rule}`
    }
    case 'watch':
      return 'Nada que cambiar todavía: vigila sus pujas.'
  }
}

const EN: RivalBoardStrings = {
  missing: 'db/rival_board.sql is not applied yet (or the agents\' rival_board behind it): our move with each team is missing.',
  guard: { top5: 'Top 5', near: 'Near us' },
  guardTitle: {
    top5: 'a top-5 team: we only trade when our gain is at least twice theirs (their side at book value)',
    near: 'within 3 ranks of us (or our rank is unknown): we only trade when our gain is at least twice theirs (their side at book value)',
  },
  strength: EN_STRENGTH,
  weakness: EN_WEAKNESS,
  moveKind: { swap: 'Swap', sell: 'Sell', buy: 'Buy', hold: 'Hold', watch: 'Watch' },
  moveTitle: (give, get) => `our move · ${plural(give, 'spare', 'spares')} of ours they want · ${plural(get, 'card', 'cards')} of theirs we miss`,
  move: moveEn,
  guardedTrade: (reason) =>
    `${reason === 'top5' ? 'A top-5 rival' : 'Close to us in the ranking'}, but by the board's estimate (their side at book value) we gain at least twice what they do.`,
  title: (team) => `Our move with ${team}`,
  sub: 'private: our spares, the cards we miss and our estimates',
  versusUs: 'Against us',
  vs: (theirs, ours) => `${theirs === null ? '—' : numIn('en')(theirs)} vs ${ours === null ? '—' : numIn('en')(ours)}`,
  component: { score: 'Score', negotiating: 'Negotiating', market: 'Market', pages: 'Pages' },
  trend: (from, to, ticks) => `rank ${from} → ${to}${ticks === null ? '' : ` over ${ticks} ticks`}`,
  strengthsHead: 'Strengths',
  weaknessesHead: 'Weaknesses',
  none: 'none',
  weHaveForThem: 'We have for them',
  theyHaveForUs: 'They have for us',
  theyWant: 'They want',
  theyHave: 'They offer',
  spare: (n) => `×${n} spare`,
  theirBid: (price) => (price === null ? 'no live bid' : `they bid ${numIn('en')(price)} P`),
  theirAsk: (price) => (price === null ? 'no live ask' : `they ask ${numIn('en')(price)} P`),
  valueToUs: (value) => (value === null ? '' : `adds ${numIn('en')(value)} P for us`),
  priceShort: (price) => (price === null ? '·' : `${numIn('en')(price)} P`),
  noCards: 'nothing seen in the last 60 ticks',
  setInterest: 'Set interest',
  interestTitle: 'positive: they buy cards of this set; negative: they sell them',
  activity: (dealerDeals, venueTrades) => `${plural(dealerDeals, 'dealer deal', 'dealer deals')} · ${plural(venueTrades, 'trade', 'trades')} on their venue`,
  whyClimbed: 'Why they climbed',
  atTick: (tick) => `tick ${tick}`,
}

const ES: RivalBoardStrings = {
  missing: 'db/rival_board.sql aún no está aplicado (o el rival_board de los agentes que hay detrás): falta nuestra jugada con cada equipo.',
  guard: { top5: 'Top 5', near: 'Cerca' },
  guardTitle: {
    top5: 'un equipo del top 5: solo negociamos si ganamos al menos el doble que ellos (su parte a valor de libro)',
    near: 'a 3 puestos o menos de nosotros (o no sabemos nuestro puesto): solo negociamos si ganamos al menos el doble que ellos (su parte a valor de libro)',
  },
  strength: ES_STRENGTH,
  weakness: ES_WEAKNESS,
  moveKind: { swap: 'Cambio', sell: 'Venta', buy: 'Compra', hold: 'Esperar', watch: 'Vigilar' },
  moveTitle: (give, get) =>
    `nuestra jugada · ${plural(give, 'repetido nuestro', 'repetidos nuestros')} que buscan · ${plural(get, 'carta suya', 'cartas suyas')} que nos faltan`,
  move: moveEs,
  guardedTrade: (reason) =>
    `${reason === 'top5' ? 'Rival del top 5' : 'Cerca de nosotros en la clasificación'}, pero según la estimación del tablero (su parte a valor de libro) ganamos al menos el doble que ellos.`,
  title: (team) => `Nuestra jugada con ${team}`,
  sub: 'privado: nuestros repetidos, las cartas que nos faltan y nuestras estimaciones',
  versusUs: 'Frente a nosotros',
  vs: (theirs, ours) => `${theirs === null ? '—' : numIn('es')(theirs)} vs ${ours === null ? '—' : numIn('es')(ours)}`,
  component: { score: 'Puntos', negotiating: 'Negociación', market: 'Mercado', pages: 'Páginas' },
  trend: (from, to, ticks) => `puesto ${from} → ${to}${ticks === null ? '' : ` en ${ticks} turnos`}`,
  strengthsHead: 'Fortalezas',
  weaknessesHead: 'Debilidades',
  none: 'ninguna',
  weHaveForThem: 'Tenemos para ellos',
  theyHaveForUs: 'Tienen para nosotros',
  theyWant: 'Buscan',
  theyHave: 'Ofrecen',
  spare: (n) => `×${n} ${n === 1 ? 'repetida' : 'repetidas'}`,
  theirBid: (price) => (price === null ? 'sin puja viva' : `pujan ${numIn('es')(price)} P`),
  theirAsk: (price) => (price === null ? 'sin oferta viva' : `piden ${numIn('es')(price)} P`),
  valueToUs: (value) => (value === null ? '' : `nos suma ${numIn('es')(value)} P`),
  priceShort: (price) => (price === null ? '·' : `${numIn('es')(price)} P`),
  noCards: 'nada visto en los últimos 60 turnos',
  setInterest: 'Interés por barrio',
  interestTitle: 'positivo: compran cartas de este barrio; negativo: las venden',
  activity: (dealerDeals, venueTrades) => `${plural(dealerDeals, 'trato', 'tratos')} con tratantes · ${plural(venueTrades, 'venta', 'ventas')} en su puesto`,
  whyClimbed: 'Por qué subieron',
  atTick: (tick) => `turno ${tick}`,
}

export const RIVAL_BOARD_STRINGS: Readonly<Record<Lang, RivalBoardStrings>> = { es: ES, en: EN }

export function useRivalBoardStrings(): RivalBoardStrings {
  return RIVAL_BOARD_STRINGS[useLang()]
}
