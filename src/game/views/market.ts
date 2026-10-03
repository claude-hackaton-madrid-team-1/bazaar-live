import { bookOf } from '../game.ts'
import type { BookOffer, State, Trade, Venue } from '../state.ts'

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

export type TeamStat = {
  team: string
  trades: number
  volume: number
  asBuyer: number
  asSeller: number
  lastTick: number | undefined
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

const later = (a: number | undefined, b: number | undefined) => (a == null ? b : b == null ? a : Math.max(a, b))

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

export function teamStats(s: State, include: Include = 'others'): TeamStat[] {
  const teams = new Map<string, TeamStat>()
  const touch = (team: string, t: Trade, role: 'asBuyer' | 'asSeller') => {
    if (!team || team === s.team) return
    let st = teams.get(team)
    if (!st) teams.set(team, (st = { team, trades: 0, volume: 0, asBuyer: 0, asSeller: 0, lastTick: undefined }))
    st.trades += 1
    st.volume += t.price
    st[role] += 1
    st.lastTick = later(st.lastTick, t.tick)
  }
  for (const t of visible(s, include)) {
    touch(t.seller, t, 'asSeller')
    touch(t.buyer, t, 'asBuyer')
  }
  return [...teams.values()].sort((a, b) => b.trades - a.trades || b.volume - a.volume || a.team.localeCompare(b.team))
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
