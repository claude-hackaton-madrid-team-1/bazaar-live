/**
 * The Our market screen: our own venue (status, bond, trades, volume, traders, its live board, the matches our broker
 * made, the bench sessions, our announcements), and what people are asking of us on every board: offers addressed to
 * us, bids for cards we hold, asks for cards we are missing. Every number from the stream; our values are private and
 * the screen shows them only with GAME_VIEW_TOKEN.
 */
import type { BrokerRow } from '../decisions.ts'
import { nameOfRef } from '../cards.ts'
import { rarityOf, type Rarity } from '../game.ts'
import type { Announcement, Bench } from '../marketExtras.ts'
import type { BookOffer, State, Venue } from '../state.ts'
import type { TeamSide } from '../teamThreads.ts'
import { ourCards, worthOf } from './market.ts'

/** The teams Omar marked as our rivals (3 Oct): their offers carry a badge wherever they show. */
export const RIVAL_TEAMS: ReadonlySet<string> = new Set(['t05', 't10', 't12', 't13', 't14', 't17', 't18'])

export const isRival = (id: string | null | undefined): boolean => id != null && RIVAL_TEAMS.has(id)

const live = (s: State, o: BookOffer) => o.expiresTick == null || o.expiresTick >= s.tick

const empty: TeamSide = { cash: 0, cards: [] }

export type VenueOffer = {
  readonly id: number
  readonly eventId: number
  readonly side: BookOffer['side']
  readonly ref: string
  readonly name: string | null
  readonly rarity: Rarity | null
  readonly price: number | null
  readonly maker: string
  readonly rival: boolean
  readonly ours: boolean
  readonly expiresIn: number | null
}

export type BenchRow = Bench & {
  readonly endTick: number | null
  readonly live: boolean
  /** Our venue was one of the bench's venues. */
  readonly ours: boolean
  /** Our broker's bench matches inside the session's ticks, and the surplus they made. */
  readonly matches: number
  readonly surplus: number
}

export type OurVenue = {
  readonly id: string
  readonly name: string
  readonly status: Venue['status']
  readonly mechanism: string | null
  readonly feeBps: number | null
  readonly feePerCard: number | null
  readonly bond: number | null
  readonly openedTick: number | null
  /** On the trades the page has seen (the tape window): how many, their volume, the teams on either side. */
  readonly trades: number
  readonly volume: number
  readonly traders: string[]
  readonly asks: VenueOffer[]
  readonly bids: VenueOffer[]
  readonly swaps: VenueOffer[]
  /** Newest first. */
  readonly announcements: Announcement[]
}

const venueOffer = (s: State, o: BookOffer): VenueOffer => ({
  id: o.id, eventId: o.eventId, side: o.side, ref: o.ref, name: nameOfRef(o.ref), rarity: rarityOf(o.ref), price: o.price,
  maker: o.maker, rival: isRival(o.maker), ours: o.maker === s.team, expiresIn: o.expiresTick == null ? null : o.expiresTick - s.tick,
})

const byPrice = (side: 'ask' | 'bid') => (a: VenueOffer, b: VenueOffer) => (side === 'ask' ? (a.price ?? 0) - (b.price ?? 0) : (b.price ?? 0) - (a.price ?? 0)) || a.id - b.id

/** Our venues (the ones we own, not closed), the newest first: the one we run now leads. */
export function ourVenues(s: State): OurVenue[] {
  if (!s.team) return []
  return [...s.venues.values()]
    .filter((v) => v.owner === s.team && v.status !== 'closed')
    .sort((a, b) => (b.openedTick ?? -1) - (a.openedTick ?? -1) || b.id.localeCompare(a.id))
    .map((v): OurVenue => {
      const offers = [...(s.book.get(v.id)?.values() ?? [])].filter((o) => live(s, o)).map((o) => venueOffer(s, o))
      const tape = s.tape.filter((t) => t.venue === v.id)
      const extra = s.market.venues.get(v.id)
      return {
        id: v.id, name: v.name, status: v.status, mechanism: extra?.mechanism ?? null, feeBps: v.feeBps, feePerCard: v.feePerCard, bond: extra?.bond ?? null,
        openedTick: v.openedTick, trades: tape.length, volume: tape.reduce((n, t) => n + t.price, 0),
        traders: [...new Set(tape.flatMap((t) => [t.seller, t.buyer]))].sort(),
        asks: offers.filter((o) => o.side === 'ask').sort(byPrice('ask')),
        bids: offers.filter((o) => o.side === 'bid').sort(byPrice('bid')),
        swaps: offers.filter((o) => o.side === 'swap'),
        announcements: [...(s.market.announcements.get(v.id) ?? [])].reverse(),
      }
    })
}

/** Our broker's matches, newest first (`agent.broker`, from our database). */
export const brokerMatches = (s: State, { bench }: { bench?: boolean } = {}): BrokerRow[] =>
  [...s.agents.broker].filter((m) => bench == null || m.bench === bench).reverse()

/** The bench sessions, newest first, with our broker's bench matches inside each one's ticks. */
export function benchRows(s: State, venues: readonly string[] = ourVenues(s).map((v) => v.id)): BenchRow[] {
  return [...s.market.benches].reverse().map((b): BenchRow => {
    const endTick = b.startTick != null && b.ticks != null ? b.startTick + b.ticks : null
    const inside = s.agents.broker.filter((m) => m.bench && b.startTick != null && m.tick >= b.startTick && (endTick == null || m.tick < endTick))
    return {
      ...b, endTick, live: b.startTick != null && s.tick >= b.startTick && (endTick == null || s.tick < endTick),
      ours: b.venues.some((v) => venues.includes(v)),
      matches: inside.length, surplus: Math.round(inside.reduce((n, m) => n + (m.surplus ?? 0), 0) * 10) / 10,
    }
  })
}

// ---------------------------------------------------------------- what people are asking us

/** Addressed to us; a bid for a card we hold; an ask (or swap) giving a card we are missing. */
export type AskKind = 'forUs' | 'bidHeld' | 'askMissing'

/**
 * What our album says about it, from the copies we hold; and, only where our value decides it (shown with
 * GAME_VIEW_TOKEN): sell or hold a duplicate, buy or skip a missing card.
 */
export type AskVerdict = 'keep' | 'sell' | 'hold' | 'buy' | 'skip'

export type AskRow = {
  readonly id: number
  readonly eventId: number
  readonly kind: AskKind
  readonly side: BookOffer['side']
  readonly venue: string
  readonly venueName: string
  readonly maker: string
  readonly rival: boolean
  readonly ref: string
  /** What they give and what they want (cards and cash). */
  readonly give: TeamSide
  readonly want: TeamSide
  readonly price: number | null
  readonly expiresIn: number | null
  /** Copies of `ref` we hold. */
  readonly held: number
  readonly duplicate: boolean
  /** Our value of `ref` (private: shown only with GAME_VIEW_TOKEN). */
  readonly worth: number | null
  /** From the album alone (`keep` a single copy), else from our value (private). */
  readonly verdict: AskVerdict | null
  readonly valueVerdict: boolean
  /** The cards it wants from us, and how many copies of each we hold (1: our only copy). */
  readonly wantHeld: readonly { readonly ref: string; readonly held: number }[]
}

const KIND_ORDER: Readonly<Record<AskKind, number>> = { forUs: 0, bidHeld: 1, askMissing: 2 }

function verdictOf(kind: AskKind, side: BookOffer['side'], price: number | null, held: number, worth: number | null): { verdict: AskVerdict | null; byValue: boolean } {
  if (side === 'bid' && held > 0) {
    if (held === 1) return { verdict: 'keep', byValue: false }
    if (worth == null || price == null) return { verdict: null, byValue: false }
    return { verdict: price >= worth ? 'sell' : 'hold', byValue: true }
  }
  if (side === 'ask' && kind !== 'bidHeld' && worth != null && price != null) return { verdict: price <= worth ? 'buy' : 'skip', byValue: true }
  return { verdict: null, byValue: false }
}

/**
 * Every live offer that asks something of us, on any board: addressed to us first, then bids for cards we hold, then
 * asks for cards we are missing; within each, the one that lapses first first. Our own offers are not asking us anything.
 */
export function askedOfUs(s: State): AskRow[] {
  if (!s.team) return []
  const cards = ourCards(s)
  const ownIds = new Set(Object.values(s.owned).flatMap((copies) => copies.map((c) => c.id)))
  const out: AskRow[] = []
  for (const [venue, offers] of s.book) {
    for (const o of offers.values()) {
      if (!live(s, o) || o.maker === s.team) continue
      // a bid (or swap) for named copies none of which is ours asks another team, not us
      if (o.wantAssetIds?.length && !o.wantAssetIds.some((id) => ownIds.has(id))) continue
      const held = s.owned[o.ref]?.length ?? 0
      const kind: AskKind | null = o.to === s.team ? 'forUs'
        : o.to != null ? null
        : o.side === 'bid' && held > 0 ? 'bidHeld'
        : o.side !== 'bid' && cards.get(o.ref)?.need === 'missing' ? 'askMissing'
        : null
      if (!kind) continue
      const worth = worthOf(s, o.ref, cards)?.value ?? null
      const { verdict, byValue } = verdictOf(kind, o.side, o.price, held, worth)
      out.push({
        id: o.id, eventId: o.eventId, kind, side: o.side, venue, venueName: s.venues.get(venue)?.name ?? venue, maker: o.maker, rival: isRival(o.maker),
        ref: o.ref, give: o.give ?? empty, want: o.want ?? empty, price: o.price, expiresIn: o.expiresTick == null ? null : o.expiresTick - s.tick,
        held, duplicate: held > 1, worth, verdict, valueVerdict: byValue,
        wantHeld: (o.want?.cards ?? []).map((ref) => ({ ref, held: s.owned[ref]?.length ?? 0 })),
      })
    }
  }
  const lapse = (r: AskRow) => r.expiresIn ?? Number.MAX_SAFE_INTEGER
  return out.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || lapse(a) - lapse(b) || a.ref.localeCompare(b.ref) || a.id - b.id)
}
