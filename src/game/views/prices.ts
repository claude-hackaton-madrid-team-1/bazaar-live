/**
 * The price guide: per card, the market's standard price, where it is going, the best bid and ask on every
 * venue right now, and what a good deal is for us. Pure functions of the reducer's State, so the screen
 * re-renders on every batch the stream brings (the stream is the WebSocket by default: wsSource.ts).
 *
 * - Standard price: the median of the last `STANDARD_TRADES` settlements of the card (every team's, ours too);
 *   with none, the catalogue's book price. Dealers' fills count: they are the market too.
 * - Trend: the median of the newest `TREND_WINDOW` fills against the median of the `TREND_WINDOW` before them;
 *   within ±`FLAT_SHARE` it is flat. Fewer than 2 × `TREND_WINDOW` fills: no trend (never a guess).
 * - The board: the best ask (cheapest) and best bid (dearest) over every venue, live, priced, card offers that
 *   anyone (or we) may take; our own offers are counted apart and never quoted as the market.
 * - A good deal for us, by the album's own rules (views/album.ts, the same `MIN_SURPLUS` / `MIN_SELL_SURPLUS`
 *   the agents use): buy at or under min(what the card is worth to us − MIN_SURPLUS, the standard price); sell
 *   at or over max(what the copy is worth to us + MIN_SELL_SURPLUS, the standard price). A copy that completes a
 *   page is worth that page to us, so its sell line sits high: a SAL-07-at-29 sale reads as a bad deal here.
 * - A signal when the board has a good deal now: an ask (with the venue's fee) at or under our buy line for a
 *   card we lack or hold for no page, a bid at or over our sell line for a copy we hold.
 */
import { bookOf, rarityOf } from '../game.ts'
import type { BookOffer, State, Trade } from '../state.ts'
import { MIN_SELL_SURPLUS, MIN_SURPLUS } from './album.ts'
import { median, ourCards, worthOf, type Need, type Worth } from './market.ts'

export const STANDARD_TRADES = 8
export const TREND_WINDOW = 3
export const FLAT_SHARE = 0.05

export type Trend = 'up' | 'down' | 'flat'

/** One side's best offer over every venue. `cost` is the price with the venue's fee (an ask: what we would pay). */
export type BestQuote = { readonly offerId: number; readonly venue: string; readonly maker: string; readonly price: number; readonly cost: number; readonly age: number | null }

export type PriceRow = {
  readonly ref: string
  readonly name: string
  readonly rarity: string | null
  readonly book: number | null
  /** The market's standard price, and where it comes from. */
  readonly standard: number | null
  readonly basis: 'trades' | 'book' | null
  readonly trades: number
  readonly last: number | null
  readonly lastTick: number | null
  readonly trend: Trend | null
  /** The newest fills' median against the ones before, as a share (0.12 = +12 %). */
  readonly change: number | null
  /** Recent fill prices, oldest first (the sparkline). */
  readonly spark: readonly number[]
  readonly ask: BestQuote | null
  readonly bid: BestQuote | null
  readonly asks: number
  readonly bids: number
  /** Live offers of ours on this card, on any venue (never the market's quote). */
  readonly ours: number
  readonly spread: number | null
  readonly need: Need | null
  readonly worth: Worth | null
  /** A good buy for us: at or under this (null when nothing says what is good). */
  readonly buyUpTo: number | null
  /** A good sell for us: at or over this (null for a card we do not hold). */
  readonly sellFrom: number | null
  readonly signal: 'buy' | 'sell' | null
  /** The last tick anything about the card moved (a fill or an offer), for the row's flash. */
  readonly moved: number | null
}

export type PriceFocus = 'all' | 'ours' | 'signals'

const round1 = (v: number) => Math.round(v * 10) / 10

const live = (s: State, o: BookOffer): boolean => o.expiresTick == null || o.expiresTick >= s.tick

/** The fee the venue charges on `price`: basis points of it plus P per card (none on an unknown venue). */
export function feeOn(s: State, venue: string, price: number): number {
  const v = s.venues.get(venue)
  if (!v) return 0
  return round1((price * (v.feeBps ?? 0)) / 10_000 + (v.feePerCard ?? 0))
}

/** The trend of fills (newest first): the newest window's median against the window before it. */
export function trendOf(newestFirst: readonly number[], window = TREND_WINDOW, flat = FLAT_SHARE): { trend: Trend | null; change: number | null } {
  if (newestFirst.length < 2 * window) return { trend: null, change: null }
  const recent = median(newestFirst.slice(0, window))
  const before = median(newestFirst.slice(window, 2 * window))
  if (recent == null || before == null || before <= 0) return { trend: null, change: null }
  const change = (recent - before) / before
  return { trend: Math.abs(change) <= flat ? 'flat' : change > 0 ? 'up' : 'down', change }
}

/** What a good deal is for us, given the card's worth to us, our need for it and the standard price. */
export function dealLines(worth: number | null, need: Need | null, standard: number | null): { buyUpTo: number | null; sellFrom: number | null } {
  const ourBuy = worth == null ? null : worth - MIN_SURPLUS
  const buyCandidates = [ourBuy, standard].filter((v): v is number => v != null)
  const buy = buyCandidates.length ? Math.min(...buyCandidates) : null
  const holds = need === 'held' || need === 'spare' || need === 'unneeded'
  const ourSell = worth == null ? null : worth + MIN_SELL_SURPLUS
  const sellCandidates = [ourSell, standard].filter((v): v is number => v != null)
  return {
    buyUpTo: buy != null && buy > 0 ? round1(buy) : null,
    sellFrom: holds && sellCandidates.length ? round1(Math.max(...sellCandidates)) : null,
  }
}

type Board = { ask: BestQuote | null; bid: BestQuote | null; asks: number; bids: number; ours: number; moved: number | null }

/** Every venue's live card offers, per card: the best ask and bid of others, the depth, our own count. */
function boards(s: State): Map<string, Board> {
  const out = new Map<string, Board>()
  for (const offers of s.book.values()) {
    for (const o of offers.values()) {
      if (!live(s, o) || o.side === 'swap' || o.kind !== 'card' || o.price == null || !o.ref) continue
      const b = out.get(o.ref) ?? { ask: null, bid: null, asks: 0, bids: 0, ours: 0, moved: null }
      out.set(o.ref, b)
      if (o.createdTick != null) b.moved = Math.max(b.moved ?? 0, o.createdTick)
      if (o.maker === s.team) {
        b.ours += 1
        continue
      }
      if (o.to != null && o.to !== s.team) continue
      const fee = feeOn(s, o.venue, o.price)
      const quote: BestQuote = {
        offerId: o.id, venue: o.venue, maker: o.maker, price: o.price,
        cost: o.side === 'ask' ? round1(o.price + fee) : round1(o.price - fee),
        age: o.createdTick == null ? null : Math.max(0, s.tick - o.createdTick),
      }
      if (o.side === 'ask') {
        b.asks += 1
        if (!b.ask || quote.price < b.ask.price || (quote.price === b.ask.price && quote.offerId < b.ask.offerId)) b.ask = quote
      } else {
        b.bids += 1
        if (!b.bid || quote.price > b.bid.price || (quote.price === b.bid.price && quote.offerId < b.bid.offerId)) b.bid = quote
      }
    }
  }
  return out
}

/** The price guide: one row per card the market or we care about. */
export function priceGuide(s: State, { focus = 'all', query = '' }: { focus?: PriceFocus; query?: string } = {}): PriceRow[] {
  const fills = new Map<string, Trade[]>()
  for (const t of s.tape) {
    // a pack (or anything that is not a card) is not a card's price
    if (t.kind && t.kind !== 'card') continue
    const list = fills.get(t.ref)
    if (list) list.push(t)
    else fills.set(t.ref, [t])
  }
  const book = boards(s)
  const cards = ourCards(s)
  const refs = new Set<string>([...fills.keys(), ...book.keys()])
  for (const [ref, c] of cards) if (c.need === 'missing' || c.need === 'spare') refs.add(ref)

  const q = query.trim().toLowerCase()
  const rows: PriceRow[] = []
  for (const ref of refs) {
    if (bookOf(ref) == null) continue
    const trades = fills.get(ref) ?? []
    const name = trades.find((t) => t.name && t.name !== ref)?.name ?? ref
    if (q && !`${ref} ${name}`.toLowerCase().includes(q)) continue
    const prices = trades.map((t) => t.price)
    const recent = prices.slice(0, STANDARD_TRADES)
    const fromTrades = median(recent)
    const standard = fromTrades ?? bookOf(ref)
    const { trend, change } = trendOf(prices)
    const b = book.get(ref) ?? { ask: null, bid: null, asks: 0, bids: 0, ours: 0, moved: null }
    const card = cards.get(ref)
    const need = card?.need ?? null
    const worth = worthOf(s, ref, cards)
    const { buyUpTo, sellFrom } = dealLines(worth?.value ?? null, need, standard)
    const buyNow = b.ask != null && buyUpTo != null && (need === 'missing' || need === null) && b.ask.cost <= buyUpTo
    const sellNow = b.bid != null && sellFrom != null && b.bid.cost >= sellFrom
    const lastTick = trades[0]?.tick ?? null
    const moved = [lastTick, b.moved].filter((v): v is number => v != null)
    rows.push({
      ref, name, rarity: rarityOf(ref), book: bookOf(ref),
      standard: standard == null ? null : round1(standard), basis: fromTrades != null ? 'trades' : standard != null ? 'book' : null,
      trades: trades.length, last: trades[0]?.price ?? null, lastTick, trend, change,
      spark: (s.prices[ref] ?? []).slice(-STANDARD_TRADES * 2),
      ask: b.ask, bid: b.bid, asks: b.asks, bids: b.bids, ours: b.ours,
      spread: b.ask && b.bid ? round1(b.ask.price - b.bid.price) : null,
      need, worth, buyUpTo, sellFrom,
      signal: buyNow ? 'buy' : sellNow ? 'sell' : null,
      moved: moved.length ? Math.max(...moved) : null,
    })
  }
  const kept = rows.filter((r) => focus === 'all' || (focus === 'signals' ? r.signal != null : r.need != null))
  // the board's good deals first, then what moved last, then the most traded
  return kept.sort((a, b) =>
    Number(b.signal != null) - Number(a.signal != null)
    || (b.moved ?? -1) - (a.moved ?? -1)
    || b.trades - a.trades
    || a.ref.localeCompare(b.ref))
}
