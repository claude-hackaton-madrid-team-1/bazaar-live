import { BOOK, RARITY_COLOR, SETS, SLOT_RARITY, fmtP, type Rarity } from '../game.ts'
import type { BookOffer, State } from '../state.ts'

/*
 * What the album is worth to us, by the game's rules (bazaar STRATEGY.md "The economics", `strategy.py`
 * `copy_value` / `page_bonus_of`, `bazaar_sim/catalog.py` `collection_value`, W7 page economics §1):
 *  - a copy is worth book × our set affinity × the copy marginal (1, 0.25, 0.1 for the 1st, 2nd, 3rd; nothing after);
 *    `your_value` of a card we hold is the value of its last copy;
 *  - a complete page (its 10 commons, uncommons and rares) adds 25 % of the page's value (Σ book × affinity of
 *    those 10), and the epic and legendary on top add 10 % more (the master bonus);
 *  - none of it scores by itself: value only scores as the surplus of a trade at our private values,
 *    so the moves below are ranked by that surplus (what we gain minus what we pay, or the other way round).
 */

export const COPY_MARGINALS = [1, 0.25, 0.1] as const
export const PAGE_BONUS = 0.25
export const MASTER_BONUS = 0.1
/** STRATEGY.md `min_buy_surplus`: a buy has to beat its price by this much to be worth proposing. */
export const MIN_SURPLUS = 2
/** STRATEGY.md `sell_min_surplus`: a sell has to beat what the copy is worth to us by this much. */
export const MIN_SELL_SURPLUS = 5

const PAGE_SLOTS = 10
const PAGE_BOOK = BOOK.slice(0, PAGE_SLOTS).reduce((a, b) => a + b, 0)

export const marginal = (copy: number): number => COPY_MARGINALS[copy] ?? 0

/** What `n` copies of a card are worth to us together: book × affinity × the sum of their marginals. */
export const copiesWorth = (book: number, aff: number, n: number): number => {
  let m = 0
  for (let i = 0; i < n; i++) m += marginal(i)
  return book * aff * m
}

const round1 = (v: number) => Math.round(v * 10) / 10

const refFor = (set: string, i: number) => `${set}-${String(i + 1).padStart(2, '0')}`

export type Affinity = { value: number; known: boolean }

/** Our multiplier for a set: from /me's affinity, else read back from a card's `your_value`, else ×1 as a guess. */
export function affinityOf(s: State, set: string): Affinity {
  const a = s.affinity[set]
  if (typeof a === 'number') return { value: a, known: true }
  for (let i = 0; i < BOOK.length; i++) {
    const ref = refFor(set, i)
    const n = s.owned[ref]?.length ?? 0
    const v = s.values[ref]
    const per = (BOOK[i] ?? 0) * marginal(n - 1)
    if (n && v != null && per > 0) return { value: Math.round((v / per) * 100) / 100, known: true }
  }
  return { value: 1, known: false }
}

export const pageBonus = (aff: number): number => PAGE_BONUS * PAGE_BOOK * aff
export const masterBonus = (aff: number): number => MASTER_BONUS * PAGE_BOOK * aff

// ---------------------------------------------------------------- where a card trades

/** A price to buy or sell a card at: the best open offer on a board, else the last trade, else book (a dealer's list ≈ book). */
export type Quote = { price: number; source: 'board' | 'tape' | 'book'; venue: string | null; maker: string | null }

function bestOffer(s: State, ref: string, side: 'ask' | 'bid'): BookOffer | null {
  let best: BookOffer | null = null
  for (const offers of s.book.values()) {
    for (const o of offers.values()) {
      if (o.side !== side || o.ref !== ref || o.kind !== 'card' || o.maker === s.team || o.price == null) continue
      if (o.expiresTick != null && o.expiresTick < s.tick) continue
      if (!best || (side === 'ask' ? o.price < (best.price ?? 0) : o.price > (best.price ?? 0))) best = o
    }
  }
  return best
}

function quoteOf(s: State, ref: string, side: 'ask' | 'bid', book: number): Quote {
  const o = bestOffer(s, ref, side)
  if (o) return { price: o.price ?? 0, source: 'board', venue: o.venue, maker: o.maker }
  const last = s.prices[ref]?.at(-1)
  if (last != null) return { price: last, source: 'tape', venue: null, maker: null }
  return { price: book, source: 'book', venue: null, maker: null }
}

/** The cheapest ask for a card on any board (not ours), else the last trade, else book. */
export const buyQuote = (s: State, ref: string, book: number): Quote => quoteOf(s, ref, 'ask', book)

/** The best bid for a card on any board (not ours), else the last trade, else book. */
export const sellQuote = (s: State, ref: string, book: number): Quote => quoteOf(s, ref, 'bid', book)

// ---------------------------------------------------------------- the pages

export type Held = { id: number; serial: number }

/** 1: under 10 P to us, 2: 10–30, 3: 30–80, 4: 80 or more. */
export type Tier = 1 | 2 | 3 | 4

export const tierOf = (worth: number): Tier => (worth >= 80 ? 4 : worth >= 30 ? 3 : worth >= 10 ? 2 : 1)

export type Slot = {
  ref: string
  num: number
  rarity: Rarity
  color: string
  count: number
  held: Held[]
  book: number
  /** `your_value` from /me: the value of the last copy we hold. */
  value: number | null
  last: number | null
  spare: boolean
  /** What the first copy is worth to us: book × affinity. */
  worth: number
  tier: Tier
  /** Missing: the cheapest place to buy it; a spare copy: the best place to sell one; else null. */
  quote: Quote | null
  /** Missing: what it adds (worth, plus the page or master bonus when it is the last one) minus the price; spare: the price minus what one copy is worth to us. */
  net: number | null
  /** Buying it completes the page (`page`) or the master page (`master`). */
  completes: 'page' | 'master' | null
  /** `buy`: missing and worth more than its price by `MIN_SURPLUS` (the epic and legendary only once someone priced one); `sell`: a spare copy the market pays `MIN_SELL_SURPLUS` more for. */
  move: 'buy' | 'sell' | null
  title: string
}

export type AlbumRow = {
  set: string
  name: string
  color: string
  have: number
  of: number
  missing: number
  specialMissing: number
  complete: boolean
  master: boolean
  affinity: Affinity
  /** What every copy we hold of the set is worth to us, the page and master bonus included when earned (unrounded: the totals add it up). */
  worth: number
  /** What completing the page adds on top of its cards. */
  bonus: number
  slots: Slot[]
}

export type AlbumSort = 'closest' | 'set'


function slotOf(s: State, set: string, i: number, aff: Affinity): Omit<Slot, 'quote' | 'net' | 'completes' | 'move' | 'title'> {
  const ref = refFor(set, i)
  const held = s.owned[ref] ?? []
  const rarity = SLOT_RARITY[i] ?? 'common'
  const book = BOOK[i] ?? 0
  const worth = round1(book * aff.value)
  return {
    ref, num: i + 1, rarity, color: RARITY_COLOR[rarity], count: held.length, held, book,
    value: held.length ? s.values[ref] ?? null : null, last: s.prices[ref]?.at(-1) ?? null, spare: held.length > 1,
    worth, tier: tierOf(worth),
  }
}

/** What one more copy of this held card loses us when sold: `your_value` (the last copy), else book × affinity × its marginal. */
const spareLoss = (c: Pick<Slot, 'value' | 'book' | 'count'>, aff: number) => c.value ?? c.book * aff * marginal(c.count - 1)

function titleOf(c: Omit<Slot, 'title'>, aff: Affinity): string {
  const lines = [`${c.ref} · ${c.rarity}${c.count > 1 ? ` · ×${c.count}` : c.count ? '' : ' · missing'}`, `worth to us ${fmtP(c.worth)} (book ${c.book} × ${aff.known ? '' : '~'}${aff.value})`]
  if (c.quote && c.net != null) {
    const where = c.quote.source === 'board' ? `${c.count ? 'bid' : 'ask'} on ${c.quote.venue}` : c.quote.source === 'tape' ? 'last trade' : 'book'
    lines.push(`${c.count ? 'sell a copy' : 'buy'} at ${fmtP(c.quote.price)} (${where}): ${c.net >= 0 ? '+' : '−'}${Math.abs(round1(c.net))} P${c.completes ? `, completes the ${c.completes}` : ''}`)
  }
  return lines.join('\n')
}

export function albumRows(s: State, { sort = 'closest' }: { sort?: AlbumSort } = {}): AlbumRow[] {
  const rows = s.pages.map((page): AlbumRow => {
    const aff = affinityOf(s, page.set)
    const base = SLOT_RARITY.map((_, i) => slotOf(s, page.set, i, aff))
    const have = page.have ?? base.slice(0, PAGE_SLOTS).filter((c) => c.count).length
    const of = page.of ?? PAGE_SLOTS
    const missing = Math.max(0, of - have)
    const complete = page.complete ?? missing === 0
    const master = Boolean(page.master)
    const bonus = pageBonus(aff.value)
    const specialsHeld = base.slice(PAGE_SLOTS).filter((c) => c.count).length
    const slots = base.map((c, i): Slot => {
      let quote: Quote | null = null
      let net: number | null = null
      let completes: Slot['completes'] = null
      if (!c.count) {
        quote = buyQuote(s, c.ref, c.book)
        let gain = c.worth
        if (i < PAGE_SLOTS && missing === 1) {
          completes = 'page'
          gain += bonus + (specialsHeld === 2 ? masterBonus(aff.value) : 0)
        } else if (i >= PAGE_SLOTS && complete && specialsHeld === 1) {
          completes = 'master'
          gain += masterBonus(aff.value)
        }
        net = round1(gain - quote.price)
      } else if (c.spare) {
        quote = sellQuote(s, c.ref, c.book)
        net = round1(quote.price - spareLoss(c, aff.value))
      }
      let move: Slot['move'] = null
      if (!c.count && net != null && net >= MIN_SURPLUS && (i < PAGE_SLOTS || quote?.source !== 'book')) move = 'buy'
      else if (c.spare && net != null && net >= MIN_SELL_SURPLUS) move = 'sell'
      const slot = { ...c, quote, net, completes, move }
      return { ...slot, title: titleOf(slot, aff) }
    })
    const cards = base.reduce((n, c) => n + copiesWorth(c.book, aff.value, c.count), 0)
    return {
      set: page.set,
      name: page.name ?? SETS[page.set]?.name ?? page.set,
      color: SETS[page.set]?.color ?? 'var(--text-muted)',
      have, of, missing,
      specialMissing: 2 - specialsHeld,
      complete, master, affinity: aff,
      worth: cards + (complete ? bonus : 0) + (master ? masterBonus(aff.value) : 0),
      bonus: round1(bonus),
      slots,
    }
  })
  if (sort === 'set') return rows
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => a.row.missing - b.row.missing || a.row.specialMissing - b.row.specialMissing || a.i - b.i)
    .map(({ row }) => row)
}

// ---------------------------------------------------------------- the best next moves

export type BuyMove = {
  ref: string
  set: string
  page: string
  rarity: Rarity
  /** What it adds to us: its worth, plus the bonus it completes. */
  gain: number
  worth: number
  completes: Slot['completes']
  quote: Quote
  net: number
  /** The price is book (nobody has offered or traded it), or our affinity for the set is a guess. */
  estimate: boolean
}

export type SellMove = {
  ref: string
  set: string
  rarity: Rarity
  count: number
  /** `spare`: a copy beyond the first; `low`: our only copy, of a set that is worth little to us and far from complete. */
  why: 'spare' | 'low'
  /** What selling one copy costs us in value. */
  lose: number
  quote: Quote
  net: number
  estimate: boolean
}

export type PageMove = {
  set: string
  name: string
  color: string
  have: number
  of: number
  missing: { ref: string; rarity: Rarity; quote: Quote }[]
  /** What the missing cards cost at the quotes. */
  cost: number
  /** What they add: their worth plus the page bonus. */
  gain: number
  bonus: number
  net: number
  estimate: boolean
}

export type Moves = { buy: BuyMove[]; sell: SellMove[]; pages: PageMove[] }

/** A priced move (someone offered or traded the card) before a guess at book, then the larger surplus first. */
const byNet = <T extends { net: number; estimate: boolean; ref: string }>(a: T, b: T) =>
  Number(a.estimate) - Number(b.estimate) || b.net - a.net || a.ref.localeCompare(b.ref)

/**
 * What to do next, ranked by the surplus it creates at our private values (the only way value scores):
 * buy a missing card for less than it adds, sell a copy for more than it takes away, finish the pages closest to done.
 * A move priced by the market comes before one priced at book (a guess: real rares trade well over book).
 * The epic and the legendary only show as buys once someone has offered or traded one: at book they are a guess.
 */
export function bestMoves(s: State, { limit = 5 }: { limit?: number } = {}): Moves {
  const rows = albumRows(s, { sort: 'set' })
  const buy: BuyMove[] = []
  const sell: SellMove[] = []
  const pages: PageMove[] = []
  for (const row of rows) {
    const aff = row.affinity
    row.slots.forEach((c) => {
      if (!c.count) {
        if (c.move !== 'buy' || !c.quote || c.net == null) return
        buy.push({
          ref: c.ref, set: row.set, page: row.name, rarity: c.rarity, gain: round1(c.net + c.quote.price), worth: c.worth,
          completes: c.completes, quote: c.quote, net: c.net, estimate: c.quote.source === 'book' || !aff.known,
        })
      } else if (c.move === 'sell' && c.quote && c.net != null) {
        sell.push({ ref: c.ref, set: row.set, rarity: c.rarity, count: c.count, why: 'spare', lose: round1(spareLoss(c, aff.value)), quote: c.quote, net: c.net, estimate: c.quote.source === 'book' })
      } else if (c.count === 1 && aff.value < 1 && row.missing > 2) {
        const quote = sellQuote(s, c.ref, c.book)
        const net = round1(quote.price - c.worth)
        if (net >= MIN_SELL_SURPLUS) sell.push({ ref: c.ref, set: row.set, rarity: c.rarity, count: 1, why: 'low', lose: c.worth, quote, net, estimate: quote.source === 'book' })
      }
    })
    if (row.missing >= 1 && row.missing <= 2) {
      const missing = row.slots.slice(0, PAGE_SLOTS).filter((c) => !c.count)
      const quoted = missing.map((c) => ({ ref: c.ref, rarity: c.rarity, quote: c.quote ?? buyQuote(s, c.ref, c.book) }))
      const cost = quoted.reduce((n, m) => n + m.quote.price, 0)
      const gain = missing.reduce((n, c) => n + c.worth, 0) + row.bonus
      pages.push({
        set: row.set, name: row.name, color: row.color, have: row.have, of: row.of, missing: quoted,
        cost: round1(cost), gain: round1(gain), bonus: row.bonus, net: round1(gain - cost),
        estimate: !aff.known || quoted.some((m) => m.quote.source === 'book'),
      })
    }
  }
  return {
    buy: buy.sort(byNet).slice(0, limit),
    sell: sell.sort(byNet).slice(0, limit),
    pages: pages.sort((a, b) => a.missing.length - b.missing.length || b.net - a.net || a.set.localeCompare(b.set)),
  }
}

// ---------------------------------------------------------------- the totals

export type AlbumSummary = {
  pages: number
  complete: number
  master: number
  missing: number
  /** What every card we hold is worth to us, the bonus of every complete page included (the game's `collection_value`). */
  worth: number
  /** Our spare copies: how many, what they are worth to us, and what the market would pay for them (best bid, else last trade, else book). */
  duplicates: { count: number; worth: number; market: number; refs: { ref: string; spare: number }[] }
  cash: number
  /** Some set's affinity is a guess (×1). */
  estimate: boolean
  /** Our sealed packs, by kind, the most first. */
  packs: { count: number; refs: { ref: string; name: string; count: number }[] }
}

export function albumSummary(s: State): AlbumSummary {
  const rows = albumRows(s)
  const refs = Object.entries(s.owned)
    .filter(([, held]) => held.length > 1)
    .map(([ref, held]) => ({ ref, spare: held.length - 1 }))
    .sort((a, b) => b.spare - a.spare || a.ref.localeCompare(b.ref))
  let spareWorth = 0
  let spareMarket = 0
  for (const row of rows) {
    for (const c of row.slots) {
      if (!c.spare) continue
      spareWorth += copiesWorth(c.book, row.affinity.value, c.count) - c.worth
      spareMarket += (c.quote?.price ?? 0) * (c.count - 1)
    }
  }
  const packs = new Map<string, { ref: string; name: string; count: number }>()
  for (const p of s.packs) {
    const k = packs.get(p.ref)
    if (k) k.count += 1
    else packs.set(p.ref, { ref: p.ref, name: p.name, count: 1 })
  }
  return {
    pages: rows.length,
    complete: rows.filter((r) => r.complete).length,
    master: rows.filter((r) => r.master).length,
    missing: rows.reduce((n, r) => n + r.missing, 0),
    worth: round1(rows.reduce((n, r) => n + r.worth, 0)),
    duplicates: { count: refs.reduce((n, r) => n + r.spare, 0), worth: round1(spareWorth), market: round1(spareMarket), refs },
    cash: s.cash,
    estimate: rows.some((r) => !r.affinity.known && r.have > 0),
    packs: { count: s.packs.length, refs: [...packs.values()].sort((a, b) => b.count - a.count || a.ref.localeCompare(b.ref)) },
  }
}

// ---------------------------------------------------------------- the score

const PARTS = [
  ['duel_points', 'Duels'],
  ['ladder_points', 'Ladder'],
  ['neg_points', 'Negotiation'],
  ['mm_points', 'Market-making'],
  ['bench_points', 'Bench'],
] as const

export type ScoreBar = { key: string; label: string; points: number; pct: number }

export type ScoreView = { total: number; rank: number | null; deals: number | null; bars: ScoreBar[] }

export function scoreBars(s: State): ScoreView {
  const sc = s.score ?? {}
  const points = PARTS.map(([key]) => Number(sc[key] ?? 0))
  const max = Math.max(10, ...points)
  return {
    total: sc.score ?? 0,
    rank: sc.rank ?? null,
    deals: typeof sc.deals === 'number' ? sc.deals : null,
    bars: PARTS.map(([key, label], i) => ({
      key, label, points: points[i] ?? 0, pct: Math.min(100, Math.max(0, ((points[i] ?? 0) / max) * 100)),
    })),
  }
}

export const series = (history: State['history'], key: 'score' | 'cash'): number[] => history.map((p) => p[key])

export function sparkline(values: number[], { w, h }: { w: number; h: number }): { d: string; x: number; y: number } | null {
  if (values.length < 2) return null
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2
  const y = (v: number) => h - 3 - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (h - 6)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')
  return { d, x: x(values.length - 1), y: y(values.at(-1) ?? lo) }
}
