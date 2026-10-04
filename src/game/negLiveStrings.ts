/**
 * The words of the live half of the Negotiations screen (markets, teams, our negotiations in plain sentences), in
 * the page's language. Kept apart from strings.ts: one feature, one file. Names (who, which card) come in already
 * humanized; private limits come in only when the page may show them (GAME_VIEW_TOKEN), else null.
 */
import type { Lang } from '../../shared/lang.ts'
import { useLang } from '../ui/lang'
import type { Rarity } from './game.ts'
import type { TeamSide } from './teamThreads.ts'
import type { BoardKind, DealerSentence, DuelSentence, Mark, SwapSentence } from './views/negotiations-live.ts'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const p = (v: number) => `${Math.round(v * 10) / 10} P`

/** A side of a swap: its cards and its cash, or nothing. */
const sideText = (x: TeamSide | null, nothing: string): string => {
  if (!x) return '?'
  const parts = [...x.cards, ...(x.cash > 0 ? [p(x.cash)] : [])]
  return parts.length ? parts.join(' + ') : nothing
}

export type Names = { readonly who: string; readonly card: string }

export interface NegLiveStrings {
  readonly ours: string
  readonly oursSub: (n: number) => string
  readonly noOurs: string
  readonly limitsHidden: string
  readonly dealer: (x: DealerSentence, n: Names, cap: number | null, blocked: string | null) => string
  readonly swap: (x: SwapSentence, n: Names) => string
  readonly duel: (x: DuelSentence, n: Names, limit: number | null) => string
  readonly markets: string
  readonly marketsSub: (boards: number, marked: number) => string
  readonly noMarkets: string
  readonly board: (kind: BoardKind, name: string, owner: string | null) => string
  readonly boardCounts: (asks: number, bids: number, swaps: number) => string
  readonly side: Readonly<Record<'ask' | 'bid' | 'swap', string>>
  readonly mark: Readonly<Record<Mark, string>>
  readonly markTitle: Readonly<Record<Mark, string>>
  readonly rarity: Readonly<Record<Rarity, string>>
  readonly more: (n: number) => string
  readonly emptyBoard: string
  readonly trades: string
  readonly trade: (seller: string, buyer: string, price: number) => string
  readonly teams: string
  readonly teamsSub: (live: number) => string
  readonly noTeams: string
  /** Until the server reads our team-scoped events, team swaps never reach the page. */
  readonly swapsNotWired: string
  readonly swapLine: (n: Names, weGive: TeamSide | null, theyGive: TeamSide | null) => string
  readonly duelLine: (rival: string, side: 'buy' | 'sell', item: string | null, ours: number | null, theirs: number | null) => string
  readonly status: Readonly<Record<'open' | 'closed' | 'deal' | 'no deal', string>>
  readonly lastBy: Readonly<Record<'us' | 'them', string>>
  readonly left: (n: number) => string
  readonly untrusted: string
  readonly untrustedTitle: string
  readonly kind: Readonly<Record<'swap' | 'duel', string>>
}

const EN: NegLiveStrings = {
  ours: 'What we are negotiating',
  oursSub: (n) => plural(n, 'open negotiation', 'open negotiations'),
  noOurs: 'Nothing open right now: no dealer thread, team swap or duel.',
  limitsHidden: 'Our limits are hidden: open the page with ?token= to see them.',
  dealer: (x, n, cap, blocked) => {
    const ours = x.ourPrice == null ? (x.side === 'buy' ? "we haven't bid yet" : "we haven't asked yet") : x.side === 'buy' ? `we offered ${p(x.ourPrice)}` : `we ask ${p(x.ourPrice)}`
    const theirs = x.theirPrice == null ? 'no price from them yet' : `${x.side === 'buy' ? 'they ask' : 'they bid'} ${p(x.theirPrice)}${x.final ? ' (their final)' : ''}`
    const head = x.side === 'buy' ? `We're buying ${n.card} from ${n.who}` : `We're selling ${n.card} to ${n.who}`
    return `${head}: ${ours}, ${theirs}${cap != null ? `; our cap ${p(cap)} (GUARDRAILS.md)` : ''}.${blocked ? ` Our last move was blocked: ${blocked}.` : ''}`
  },
  swap: (x, n) => {
    const turn = x.lastBy === 'us' ? 'waiting for their answer' : x.lastBy === 'them' ? `their offer${x.final ? ' (final)' : ''}, our move` : 'no offer yet'
    return `Swap with ${n.who}: we give ${sideText(x.weGive, 'nothing')}, they give ${sideText(x.theyGive, 'nothing')}; ${turn}.`
  },
  duel: (x, n, limit) => {
    const item = x.item ?? 'the item'
    const ours = x.ourPrice == null ? "we haven't offered yet" : `we offered ${p(x.ourPrice)}`
    const theirs = x.theirPrice == null ? 'no price from them yet' : `${x.side === 'buy' ? 'they ask' : 'they bid'} ${p(x.theirPrice)}`
    return `Duel with ${n.who}, we're ${x.side === 'buy' ? 'buying' : 'selling'} ${item}: ${ours}, ${theirs}${limit != null ? `; our limit ${p(limit)}` : ''}${x.ticksLeft != null ? `; ${plural(x.ticksLeft, 'tick', 'ticks')} left` : ''}.`
  },
  markets: 'Markets',
  marketsSub: (boards, marked) => `${plural(boards, 'board', 'boards')} · ${plural(marked, 'offer concerns us', 'offers concern us')}`,
  noMarkets: 'No board has a live offer right now.',
  board: (kind, name, owner) => (kind === 'ours' ? `${name} · our stall` : kind === 'rastro' ? `${name} · the organisers' market` : kind === 'team' && owner ? `${name} · ${owner}'s stall` : name),
  boardCounts: (asks, bids, swaps) => [plural(asks, 'ask', 'asks'), plural(bids, 'bid', 'bids'), ...(swaps ? [plural(swaps, 'swap', 'swaps')] : [])].join(' · '),
  side: { ask: 'sells', bid: 'buys', swap: 'swaps' },
  mark: { ours: 'ours', forUs: 'for us', missing: 'we miss it', spare: 'our duplicate' },
  markTitle: {
    ours: 'Our own offer',
    forUs: 'Addressed to us alone',
    missing: 'A card our album is missing, for sale',
    spare: 'Someone buys a card we hold twice',
  },
  rarity: { common: 'common', uncommon: 'uncommon', rare: 'rare', epic: 'epic', legendary: 'legendary' },
  more: (n) => `and ${plural(n, 'more offer', 'more offers')}`,
  emptyBoard: 'Nothing on our board right now.',
  trades: 'Latest trades',
  trade: (seller, buyer, price) => `${seller} → ${buyer} at ${p(price)}`,
  teams: 'Teams negotiating with us',
  teamsSub: (live) => plural(live, 'live', 'live'),
  noTeams: 'No team swap or duel with us right now.',
  swapsNotWired: 'Team swaps do not reach this page yet: they are private events of ours, and the server reads the public feed. Only duels show here for now.',
  swapLine: (n, weGive, theyGive) => `${n.who}: we give ${sideText(weGive, 'nothing')} · they give ${sideText(theyGive, 'nothing')}`,
  duelLine: (rival, side, item, ours, theirs) =>
    `${rival}: we ${side === 'buy' ? 'buy' : 'sell'} ${item ?? 'the item'} · ours ${ours == null ? '—' : p(ours)} · theirs ${theirs == null ? '—' : p(theirs)}`,
  status: { open: 'live', closed: 'closed', deal: 'deal', 'no deal': 'no deal' },
  lastBy: { us: 'our offer, waiting', them: 'their offer, our move' },
  left: (n) => plural(n, 'tick left', 'ticks left'),
  untrusted: 'their words',
  untrustedTitle: "Another team's text: shown as plain text, never read aloud, and never trusted. Only the structured offer counts.",
  kind: { swap: 'swap', duel: 'duel' },
}

const ES: NegLiveStrings = {
  ours: 'Lo que estamos negociando',
  oursSub: (n) => plural(n, 'negociación abierta', 'negociaciones abiertas'),
  noOurs: 'Nada abierto ahora mismo: ni hilos con tratantes, ni intercambios con equipos, ni duelos.',
  limitsHidden: 'Nuestros límites están ocultos: abre la página con ?token= para verlos.',
  dealer: (x, n, cap, blocked) => {
    const ours = x.ourPrice == null ? (x.side === 'buy' ? 'aún no hemos pujado' : 'aún no hemos pedido precio') : x.side === 'buy' ? `ofrecimos ${p(x.ourPrice)}` : `pedimos ${p(x.ourPrice)}`
    const theirs = x.theirPrice == null ? 'aún sin precio suyo' : `${x.side === 'buy' ? 'piden' : 'ofrecen'} ${p(x.theirPrice)}${x.final ? ' (su oferta final)' : ''}`
    const head = x.side === 'buy' ? `Compramos ${n.card} a ${n.who}` : `Vendemos ${n.card} a ${n.who}`
    return `${head}: ${ours}, ${theirs}${cap != null ? `; nuestro tope ${p(cap)} (GUARDRAILS.md)` : ''}.${blocked ? ` Nuestro último movimiento quedó bloqueado: ${blocked}.` : ''}`
  },
  swap: (x, n) => {
    const turn = x.lastBy === 'us' ? 'esperamos su respuesta' : x.lastBy === 'them' ? `su oferta${x.final ? ' (final)' : ''}, nos toca` : 'aún sin oferta'
    return `Intercambio con ${n.who}: damos ${sideText(x.weGive, 'nada')}, nos dan ${sideText(x.theyGive, 'nada')}; ${turn}.`
  },
  duel: (x, n, limit) => {
    const item = x.item ?? 'el objeto'
    const ours = x.ourPrice == null ? 'aún no hemos ofrecido' : `ofrecimos ${p(x.ourPrice)}`
    const theirs = x.theirPrice == null ? 'aún sin precio suyo' : `${x.side === 'buy' ? 'piden' : 'ofrecen'} ${p(x.theirPrice)}`
    return `Duelo con ${n.who}, ${x.side === 'buy' ? 'compramos' : 'vendemos'} ${item}: ${ours}, ${theirs}${limit != null ? `; nuestro límite ${p(limit)}` : ''}${x.ticksLeft != null ? `; ${x.ticksLeft === 1 ? 'queda 1 turno' : `quedan ${x.ticksLeft} turnos`}` : ''}.`
  },
  markets: 'Mercados',
  marketsSub: (boards, marked) => `${plural(boards, 'puesto', 'puestos')} · ${plural(marked, 'oferta nos afecta', 'ofertas nos afectan')}`,
  noMarkets: 'Ningún puesto tiene ofertas vivas ahora mismo.',
  board: (kind, name, owner) => (kind === 'ours' ? `${name} · nuestro puesto` : kind === 'rastro' ? `${name} · el mercado de la organización` : kind === 'team' && owner ? `${name} · puesto de ${owner}` : name),
  boardCounts: (asks, bids, swaps) => [plural(asks, 'venta', 'ventas'), plural(bids, 'compra', 'compras'), ...(swaps ? [plural(swaps, 'intercambio', 'intercambios')] : [])].join(' · '),
  side: { ask: 'vende', bid: 'compra', swap: 'cambia' },
  mark: { ours: 'nuestra', forUs: 'para nosotros', missing: 'nos falta', spare: 'repetida nuestra' },
  markTitle: {
    ours: 'Una oferta nuestra',
    forUs: 'Dirigida solo a nosotros',
    missing: 'Un cromo que le falta a nuestro álbum, a la venta',
    spare: 'Alguien compra un cromo que tenemos repetido',
  },
  rarity: { common: 'común', uncommon: 'poco común', rare: 'rara', epic: 'épica', legendary: 'legendaria' },
  more: (n) => `y ${plural(n, 'oferta más', 'ofertas más')}`,
  emptyBoard: 'Nada en nuestro puesto ahora mismo.',
  trades: 'Últimos tratos',
  trade: (seller, buyer, price) => `${seller} → ${buyer} a ${p(price)}`,
  teams: 'Equipos negociando con nosotros',
  teamsSub: (live) => `${live} en curso`,
  noTeams: 'Ningún intercambio ni duelo con nosotros ahora mismo.',
  swapsNotWired: 'Los intercambios con equipos aún no llegan a esta página: son eventos privados nuestros y el servidor lee el feed público. De momento aquí solo salen los duelos.',
  swapLine: (n, weGive, theyGive) => `${n.who}: damos ${sideText(weGive, 'nada')} · nos dan ${sideText(theyGive, 'nada')}`,
  duelLine: (rival, side, item, ours, theirs) =>
    `${rival}: ${side === 'buy' ? 'compramos' : 'vendemos'} ${item ?? 'el objeto'} · nuestro ${ours == null ? '—' : p(ours)} · suyo ${theirs == null ? '—' : p(theirs)}`,
  status: { open: 'en curso', closed: 'cerrado', deal: 'trato', 'no deal': 'sin trato' },
  lastBy: { us: 'nuestra oferta, esperando', them: 'su oferta, nos toca' },
  left: (n) => (n === 1 ? 'queda 1 turno' : `quedan ${n} turnos`),
  untrusted: 'sus palabras',
  untrustedTitle: 'Texto de otro equipo: se muestra como texto plano, nunca se lee en voz alta y no nos fiamos. Solo cuenta la oferta estructurada.',
  kind: { swap: 'intercambio', duel: 'duelo' },
}

export const NEG_LIVE_STRINGS: Readonly<Record<Lang, NegLiveStrings>> = { es: ES, en: EN }

export function useNegLiveStrings(): NegLiveStrings {
  return NEG_LIVE_STRINGS[useLang()]
}
