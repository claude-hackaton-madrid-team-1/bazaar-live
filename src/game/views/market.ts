import { bookOf } from '../game.ts'
import type { BookOffer, State, Trade, Venue } from '../state.ts'
import { MIN_SELL_SURPLUS, MIN_SURPLUS, affinityOf, albumRows, marginal, masterBonus, pageBonus } from './album.ts'

export type Include = 'others' | 'all'

export type TapeRow = Trade & { book: number | null; delta: number | null }

export type CardStat = {
  ref: string
  name: string
  trades: number
  last: number
  lastTick: number | undefined
  median: number | null
  min: number
  max: number
  book: number | null
  trend: number[]
}

const visible = (s: State, include: Include): Trade[] => (include === 'all' ? s.tape : s.tape.filter((t) => !t.ours))

const haystack = (t: Trade): string =>
  [t.seller, t.buyer, t.ref, t.name, t.venue, `s${t.settlementId}`, `#${t.assetId}`, `e${t.eventId}`].join(' ').toLowerCase()

export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const hi = sorted[mid] ?? 0
  return sorted.length % 2 ? hi : ((sorted[mid - 1] ?? hi) + hi) / 2
}

export function marketTape(s: State, { include = 'others', query = '' }: { include?: Include; query?: string } = {}): TapeRow[] {
  const q = query.trim().toLowerCase()
  return visible(s, include)
    .filter((t) => !q || haystack(t).includes(q))
    .map((t) => {
      const book = bookOf(t.ref)
      return { ...t, book, delta: book ? (t.price - book) / book : null }
    })
}

export function cardStats(s: State, include: Include = 'others'): CardStat[] {
  const byRef = new Map<string, Trade[]>()
  for (const t of visible(s, include)) {
    const list = byRef.get(t.ref)
    if (list) list.push(t)
    else byRef.set(t.ref, [t])
  }
  return [...byRef].map(([ref, trades]) => {
    const prices = trades.map((t) => t.price)
    // the tape is newest first, and a ref is only in the map with at least one trade
    const newest = trades[0] as Trade
    return {
      ref, name: newest.name, trades: trades.length, last: newest.price, lastTick: newest.tick,
      median: median(prices), min: Math.min(...prices), max: Math.max(...prices), book: bookOf(ref),
      trend: s.prices[ref] ?? [],
    }
  }).sort((a, b) => b.trades - a.trades || a.ref.localeCompare(b.ref))
}

const r1 = (v: number) => Math.round(v * 10) / 10

export function sparkPath(values: number[], w: number, h: number, pad = 1): string {
  if (values.length < 2) return ''
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const x = (i: number) => r1(pad + (i * (w - 2 * pad)) / (values.length - 1))
  const y = (v: number) => r1(hi === lo ? h / 2 : pad + ((hi - v) / (hi - lo)) * (h - 2 * pad))
  return values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')
}

export function sparkEnd(values: number[], w: number, h: number, pad = 1): { x: number; y: number } | null {
  const d = sparkPath(values, w, h, pad)
  const last = d.split(/[ML]/).at(-1)
  if (!last) return null
  const [x = 0, y = 0] = last.split(',').map(Number)
  return { x, y }
}

export const deltaText = (delta: number | null): string =>
  delta == null ? '' : `${delta > 0 ? '▲' : delta < 0 ? '▼' : '='} ${Math.abs(Math.round(delta * 100))}%`

export const deltaTone = (delta: number | null): string => {
  const pct = delta == null ? 0 : Math.round(delta * 100)
  return pct > 0 ? 'bad' : pct < 0 ? 'good' : ''
}

// ---------------------------------------------------------------- the board

export type Whose = 'all' | 'ours'

/** The best offer on one side of a card: its price, who made it, how many ticks ago. */
export type Quote = { id: number; eventId: number; maker: string; price: number; age: number | null; ours: boolean }

export type BookRow = { ref: string; kind: string; bids: number; asks: number; bid: Quote | null; ask: Quote | null; book: number | null }

export type VenueBook = { venue: string; name: string; owner: string | null; offers: number; ours: number; rows: BookRow[] }

export type VenueRow = {
  id: string
  name: string
  owner: string | null
  status: Venue['status']
  offers: number
  /** The fee as the game charges it: basis points of the price, plus P per card. */
  feeBps: number | null
  feePerCard: number | null
  announcement: Venue['announcement']
  announcements: number
  ours: boolean
}

const live = (s: State, o: BookOffer) => o.expiresTick == null || o.expiresTick >= s.tick

const quote = (s: State, o: BookOffer): Quote => ({
  id: o.id, eventId: o.eventId, maker: o.maker, price: o.price ?? 0,
  age: o.createdTick == null ? null : Math.max(0, s.tick - o.createdTick), ours: o.maker === s.team,
})

/** The cheaper ask, the dearer bid; on a tie, the one listed first. */
const better = (side: 'ask' | 'bid', a: BookOffer, b: BookOffer) => {
  const d = (a.price ?? 0) - (b.price ?? 0)
  return d ? (side === 'ask' ? d < 0 : d > 0) : a.id < b.id
}

/** Per venue, per card: the best bid and ask, and how deep each side is. Swaps count in the venue, not in a card's best. */
export function orderBook(s: State, { whose = 'all' }: { whose?: Whose } = {}): VenueBook[] {
  const venues: VenueBook[] = []
  for (const [venue, offers] of s.book) {
    const rows = new Map<string, BookRow>()
    const best = new Map<string, { bid?: BookOffer; ask?: BookOffer }>()
    let count = 0
    let ours = 0
    for (const o of offers.values()) {
      if (!live(s, o) || (whose === 'ours' && o.maker !== s.team)) continue
      count += 1
      if (o.maker === s.team) ours += 1
      if (o.side === 'swap') continue
      let row = rows.get(o.ref)
      if (!row) rows.set(o.ref, (row = { ref: o.ref, kind: o.kind, bids: 0, asks: 0, bid: null, ask: null, book: o.kind === 'card' ? bookOf(o.ref) : null }))
      row[o.side === 'bid' ? 'bids' : 'asks'] += 1
      const top = best.get(o.ref) ?? {}
      const cur = top[o.side]
      if (!cur || better(o.side, o, cur)) top[o.side] = o
      best.set(o.ref, top)
    }
    if (!count) continue
    for (const [ref, top] of best) {
      const row = rows.get(ref)
      if (!row) continue
      row.bid = top.bid ? quote(s, top.bid) : null
      row.ask = top.ask ? quote(s, top.ask) : null
    }
    const v = s.venues.get(venue)
    venues.push({
      venue, name: v?.name ?? venue, owner: v?.owner ?? null, offers: count, ours,
      rows: [...rows.values()].sort((a, b) => b.bids + b.asks - (a.bids + a.asks) || a.ref.localeCompare(b.ref)),
    })
  }
  return venues.sort((a, b) => b.offers - a.offers || a.venue.localeCompare(b.venue))
}

const STATUS_ORDER: Record<Venue['status'], number> = { open: 0, closing: 1, closed: 2 }

/** Every venue seen: open ones first, the busiest board first. */
export function venueRows(s: State): VenueRow[] {
  return [...s.venues.values()]
    .map((v) => ({
      id: v.id, name: v.name, owner: v.owner, status: v.status,
      offers: [...(s.book.get(v.id)?.values() ?? [])].filter((o) => live(s, o)).length,
      feeBps: v.feeBps, feePerCard: v.feePerCard, announcement: v.announcement, announcements: v.announcements,
      ours: Boolean(s.team) && v.owner === s.team,
    }))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.offers - a.offers || a.id.localeCompare(b.id))
}

// ---------------------------------------------------------------- what the board means for us

/** Why we care about a card: a page slot we lack, a spare copy, a card of no page of ours, or a single copy we keep. */
export type Need = 'missing' | 'spare' | 'unneeded' | 'held'

/** What a card is worth to us (see `ourCards`); `estimated` when our affinity for its set is a guess. */
export type Worth = { value: number; estimated: boolean }

/** The latest word of our agents on a card since an offer went up: what they did, and the rule that stopped them. */
export type AgentNote = { agent: string; status: string; rule: string | null }

export type Opportunity = {
  offerId: number
  eventId: number
  /** What WE would do: buy their ask, or sell into their bid. */
  side: 'buy' | 'sell'
  ref: string
  name: string
  need: Need
  price: number
  value: number
  estimated: boolean
  /** Our gain before fees: value − price to buy, price − value to sell. */
  net: number
  venue: string
  venueName: string
  maker: string
  /** Addressed to us alone. */
  forUs: boolean
  expiresIn: number | null
  age: number | null
  /** Other offers for the same card that qualify too (the best one is shown). */
  more: number
  /** Buying it completes the page or the master page (its bonus is in `value`). */
  completes: 'page' | 'master' | null
  /** On the board long enough, and clear enough (over the agents' own minimum surplus), that our agents should have taken it. */
  untaken: boolean
  agent: AgentNote | null
}

export type Opportunities = {
  buy: Opportunity[]
  sell: Opportunity[]
  /** Cards with an ask under our value that costs more than our cash. */
  overCash: number
  cash: number
}

export type OurOffer = {
  offerId: number
  side: 'ask' | 'bid'
  ref: string
  name: string
  price: number
  worth: Worth | null
  venueName: string
  expiresIn: number | null
  /** The best price another team shows the market (not one addressed to a single other team) on the same side of the same card, if any. */
  best: number | null
  /** How far that best price beats ours (null: ours is the best, or alone). */
  beatenBy: number | null
  /** Posted by hand (`bazaar sell ... --live`): no agent reprices or cancels it. */
  hand: boolean
}

export type WatchRow = CardStat & { need: Need; worth: Worth | null }

/** Ticks a clear opportunity may sit on the board before the screen says our agents left it there. */
export const UNTAKEN_TICKS = 2

const NEED_ORDER: Record<Need, number> = { missing: 0, spare: 1, unneeded: 2, held: 3 }

const setCode = (ref: string): string => ref.split('-')[0] ?? ''

const round1 = (v: number) => Math.round(v * 10) / 10

/** A card we care about: why, what it is worth to us, and whether buying it completes a page. */
export type OurCard = { need: Need; worth: Worth; completes: 'page' | 'master' | null }

/**
 * Every card we care about, by the album's own rules (`views/album.ts`: book × our set affinity × the copy's
 * marginal, plus the page or master bonus a missing card completes): the page slots we lack (the specials
 * only once their page is complete), our spares (what selling one copy loses us), our single copies, and the
 * cards of no page of ours (their `your_value`). A value is an estimate only when our affinity for the set is a guess.
 */
export function ourCards(s: State): Map<string, OurCard> {
  const out = new Map<string, OurCard>()
  for (const row of albumRows(s, { sort: 'set' })) {
    const aff = row.affinity.value
    const guess = !row.affinity.known
    for (const c of row.slots) {
      if (c.count > 0) {
        const lose = c.value ?? c.book * aff * marginal(c.count - 1)
        out.set(c.ref, { need: c.count > 1 ? 'spare' : 'held', worth: { value: round1(lose), estimated: c.value == null && guess }, completes: null })
      } else if (c.num <= 10 || row.complete) {
        const bonus = c.completes === 'page' ? pageBonus(aff) + (row.specialMissing === 0 ? masterBonus(aff) : 0) : c.completes === 'master' ? masterBonus(aff) : 0
        out.set(c.ref, { need: 'missing', worth: { value: round1(c.worth + bonus), estimated: guess }, completes: c.completes })
      }
    }
  }
  for (const [ref, held] of Object.entries(s.owned)) {
    const book = bookOf(ref)
    if (out.has(ref) || !held.length || book == null) continue
    const aff = affinityOf(s, setCode(ref))
    const v = s.values[ref]
    out.set(ref, { need: 'unneeded', worth: { value: round1(v ?? book * aff.value * marginal(held.length - 1)), estimated: v == null && !aff.known }, completes: null })
  }
  return out
}

/** Why we care about each card (see `ourCards`). */
export const needs = (s: State): Map<string, Need> => new Map([...ourCards(s)].map(([ref, c]) => [ref, c.need]))

/** What a card is worth to us: as `ourCards` has it, else (a card of a set with no page of ours) book × our affinity. */
export function worthOf(s: State, ref: string, cards = ourCards(s)): Worth | null {
  const c = cards.get(ref)
  if (c) return c.worth
  const book = bookOf(ref)
  if (book == null) return null
  const aff = affinityOf(s, setCode(ref))
  return { value: round1(book * aff.value), estimated: !aff.known }
}

/** A card's name, from the trades seen (the board's offers carry none). */
function namesOf(s: State): Map<string, string> {
  const names = new Map<string, string>()
  for (const t of s.tape) if (!names.has(t.ref) && t.name !== t.ref) names.set(t.ref, t.name)
  return names
}

function agentNote(s: State, ref: string, since: number | undefined): AgentNote | null {
  let best: (AgentNote & { decision: number }) | null = null
  for (const agent of ['taker', 'maker'] as const) {
    for (const d of s.agents.decisions[agent]) {
      if (d.item !== ref || (since != null && d.tick < since)) continue
      if (!best || d.decision > best.decision) best = { agent, status: d.status, rule: d.verdict === 'denied' ? d.rule : null, decision: d.decision }
    }
  }
  return best && { agent: best.agent, status: best.status, rule: best.rule }
}

/** Offers we could take: live, priced, a card, not ours, open to anyone or addressed to us. */
function takeable(s: State): BookOffer[] {
  const out: BookOffer[] = []
  for (const offers of s.book.values()) {
    for (const o of offers.values()) {
      if (!live(s, o) || o.side === 'swap' || o.kind !== 'card' || o.price == null || o.maker === s.team) continue
      if (o.to != null && o.to !== s.team) continue
      if (bookOf(o.ref) == null) continue
      out.push(o)
    }
  }
  return out
}

/**
 * What the board offers us right now. Buy: asks for cards we are missing, under what they are worth to us.
 * Sell: bids for our spares and cards of no page of ours, at or over our value. One row per card, the best
 * offer for it, our biggest gain first; asks we cannot pay are only counted.
 */
export function opportunities(s: State, { untakenAfter = UNTAKEN_TICKS }: { untakenAfter?: number } = {}): Opportunities {
  const cards = ourCards(s)
  const names = namesOf(s)
  const groups = new Map<string, Opportunity[]>()
  const tooDear = new Set<string>()
  for (const o of takeable(s)) {
    const price = o.price ?? 0
    const card = cards.get(o.ref)
    const why = card?.need
    const buying = o.side === 'ask'
    const worth = card && (buying ? why === 'missing' : why === 'spare' || why === 'unneeded') ? card.worth : null
    if (!worth || !why) continue
    const net = buying ? worth.value - price : price - worth.value
    if (buying ? net <= 0 : net < 0) continue
    if (buying && price > s.cash) {
      tooDear.add(o.ref)
      continue
    }
    const age = o.createdTick == null ? null : Math.max(0, s.tick - o.createdTick)
    const side = buying ? 'buy' : 'sell'
    const row: Opportunity = {
      offerId: o.id, eventId: o.eventId, side, ref: o.ref, name: names.get(o.ref) ?? o.ref, need: why,
      price, value: worth.value, estimated: worth.estimated, net: round1(net), completes: buying ? card?.completes ?? null : null,
      venue: o.venue, venueName: s.venues.get(o.venue)?.name ?? o.venue, maker: o.maker, forUs: o.to === s.team,
      expiresIn: o.expiresTick == null ? null : o.expiresTick - s.tick, age, more: 0,
      untaken: age != null && age >= untakenAfter && net >= (buying ? MIN_SURPLUS : MIN_SELL_SURPLUS), agent: agentNote(s, o.ref, o.createdTick),
    }
    const key = `${side}:${o.ref}`
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }
  const buy: Opportunity[] = []
  const sell: Opportunity[] = []
  for (const list of groups.values()) {
    list.sort((a, b) => b.net - a.net || a.offerId - b.offerId)
    const top = list[0]
    if (!top) continue
    top.more = list.length - 1
    ;(top.side === 'buy' ? buy : sell).push(top)
  }
  const order = (a: Opportunity, b: Opportunity) => b.net - a.net || (a.expiresIn ?? Infinity) - (b.expiresIn ?? Infinity) || a.ref.localeCompare(b.ref)
  return { buy: buy.sort(order), sell: sell.sort(order), overCash: [...tooDear].filter((ref) => !groups.has(`buy:${ref}`)).length, cash: s.cash }
}

/** Our own offers on the boards: what each is worth to us, when it goes, and whether another team shows a better price. */
export function ourOffers(s: State): OurOffer[] {
  const mine: BookOffer[] = []
  const rivals: BookOffer[] = []
  for (const offers of s.book.values()) {
    for (const o of offers.values()) {
      if (!live(s, o) || o.side === 'swap' || o.price == null) continue
      if (o.maker === s.team) mine.push(o)
      else if (o.to == null || o.to === s.team) rivals.push(o)
    }
  }
  if (!mine.length) return []
  const cards = ourCards(s)
  const names = namesOf(s)
  return mine
    .map((o): OurOffer => {
      const side = o.side === 'ask' ? 'ask' : 'bid'
      const price = o.price ?? 0
      const others = rivals.filter((r) => r.side === side && r.ref === o.ref).map((r) => r.price ?? 0)
      const best = others.length ? (side === 'ask' ? Math.min(...others) : Math.max(...others)) : null
      const gap = best == null ? 0 : side === 'ask' ? price - best : best - price
      return {
        offerId: o.id, side, ref: o.ref, name: names.get(o.ref) ?? o.ref, price,
        worth: o.kind === 'card' ? worthOf(s, o.ref, cards) : null, venueName: s.venues.get(o.venue)?.name ?? o.venue,
        expiresIn: o.expiresTick == null ? null : o.expiresTick - s.tick, best, beatenBy: gap > 0 ? round1(gap) : null,
        hand: s.byHand.has(o.id),
      }
    })
    .sort((a, b) => (a.expiresIn ?? Infinity) - (b.expiresIn ?? Infinity) || a.offerId - b.offerId)
}

/** Prices for the cards we care about only (missing first, then spares), with our value beside them; and how many of them never traded. */
export function watchPrices(s: State): { rows: WatchRow[]; untraded: number } {
  const cards = ourCards(s)
  const rows = cardStats(s, 'all')
    .filter((c) => cards.has(c.ref))
    .map((c): WatchRow => ({ ...c, need: cards.get(c.ref)?.need ?? 'held', worth: cards.get(c.ref)?.worth ?? null }))
    .sort((a, b) => NEED_ORDER[a.need] - NEED_ORDER[b.need] || b.trades - a.trades || a.ref.localeCompare(b.ref))
  return { rows, untraded: cards.size - rows.length }
}
