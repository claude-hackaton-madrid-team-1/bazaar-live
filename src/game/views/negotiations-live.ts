/**
 * The live half of the Negotiations screen: what is on each market's board now (and what traded there last),
 * the teams negotiating with us (team swaps and duels), and one plain sentence per open negotiation of ours,
 * built from the structured offers and our decision rows (never from anyone's words).
 */
import { nameOfRef } from '../cards.ts'
import { rarityOf, setOf, type Rarity } from '../game.ts'
import type { BookOffer, State } from '../state.ts'
import { TEAM_ID, type TeamSide, type TeamThread } from '../teamThreads.ts'
import { liveDuel } from './duels.ts'
import { needs } from './market.ts'
import { negRows, type NegRow } from './negotiations.ts'

// ---------------------------------------------------------------- markets

/** Why an offer concerns us: ours, addressed to us, a card we are missing for sale, a buyer for one of our duplicates. */
export type Mark = 'ours' | 'forUs' | 'missing' | 'spare'

export type BoardOffer = {
  readonly id: number
  readonly eventId: number
  readonly side: BookOffer['side']
  readonly ref: string
  readonly name: string | null
  readonly set: { readonly name: string; readonly color: string } | null
  readonly rarity: Rarity | null
  readonly price: number | null
  readonly maker: string
  readonly mark: Mark | null
}

export type BoardTrade = { readonly eventId: number; readonly tick: number | null; readonly ref: string; readonly name: string; readonly price: number; readonly seller: string; readonly buyer: string; readonly ours: boolean }

export type BoardKind = 'ours' | 'rastro' | 'team' | 'other'

export type MarketBoard = {
  readonly venue: string
  readonly name: string
  readonly owner: string | null
  readonly kind: BoardKind
  readonly asks: number
  readonly bids: number
  readonly swaps: number
  /** The offers shown: the ones that concern us first, then by card; at most `perVenue`. */
  readonly offers: BoardOffer[]
  /** Live offers not shown. */
  readonly more: number
  /** Live offers that concern us (all of them, shown or not). */
  readonly marked: number
  /** The latest trades on this board, newest first. */
  readonly trades: BoardTrade[]
}

const live = (s: State, o: BookOffer) => o.expiresTick == null || o.expiresTick >= s.tick

function markOf(s: State, o: BookOffer, need: ReadonlyMap<string, string>): Mark | null {
  if (o.maker === s.team) return 'ours'
  if (o.to != null && o.to === s.team) return 'forUs'
  const n = need.get(o.ref)
  // they sell (or swap away) a card we lack; they buy a card we hold twice
  if (o.side !== 'bid' && n === 'missing') return 'missing'
  if (o.side === 'bid' && n === 'spare') return 'spare'
  return null
}

const MARK_ORDER: Readonly<Record<Mark, number>> = { ours: 0, forUs: 1, missing: 2, spare: 3 }

function kindOf(s: State, venue: string, owner: string | null): BoardKind {
  if (s.team && owner === s.team) return 'ours'
  if (venue === 'rastro') return 'rastro'
  return owner != null && TEAM_ID.test(owner) ? 'team' : 'other'
}

const KIND_ORDER: Readonly<Record<BoardKind, number>> = { ours: 0, rastro: 1, team: 2, other: 3 }

/**
 * Every board with live offers, and our own venue even when it is empty: ours first, then the Rastro, then the
 * team venues with the most offers that concern us. Offers addressed to another team are left out (not ours to take).
 */
export function marketBoards(s: State, { perVenue = 8, trades = 3 }: { perVenue?: number; trades?: number } = {}): MarketBoard[] {
  const need = needs(s)
  const venues = new Set<string>([...s.book.keys()])
  for (const v of s.venues.values()) if (s.team && v.owner === s.team && v.status !== 'closed') venues.add(v.id)
  const boards: MarketBoard[] = []
  for (const venue of venues) {
    const all = [...(s.book.get(venue)?.values() ?? [])].filter((o) => live(s, o) && (o.to == null || o.to === s.team || o.maker === s.team))
    const v = s.venues.get(venue)
    const owner = v?.owner ?? null
    const kind = kindOf(s, venue, owner)
    if (!all.length && kind !== 'ours') continue
    const offers = all.map((o): BoardOffer => ({
      id: o.id, eventId: o.eventId, side: o.side, ref: o.ref, name: nameOfRef(o.ref), set: setOf(o.ref), rarity: rarityOf(o.ref),
      price: o.price, maker: o.maker, mark: markOf(s, o, need),
    }))
    offers.sort((a, b) => (a.mark == null ? 9 : MARK_ORDER[a.mark]) - (b.mark == null ? 9 : MARK_ORDER[b.mark]) || a.ref.localeCompare(b.ref) || (a.price ?? 0) - (b.price ?? 0) || a.id - b.id)
    boards.push({
      venue, name: v?.name ?? venue, owner, kind,
      asks: all.filter((o) => o.side === 'ask').length,
      bids: all.filter((o) => o.side === 'bid').length,
      swaps: all.filter((o) => o.side === 'swap').length,
      offers: offers.slice(0, perVenue),
      more: Math.max(0, offers.length - perVenue),
      marked: offers.filter((o) => o.mark != null).length,
      trades: s.tape.filter((t) => t.venue === venue).slice(0, trades).map((t) => ({
        eventId: t.eventId, tick: t.tick ?? null, ref: t.ref, name: t.name, price: t.price, seller: t.seller, buyer: t.buyer, ours: t.ours,
      })),
    })
  }
  return boards.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.marked - a.marked || b.asks + b.bids + b.swaps - (a.asks + a.bids + a.swaps) || a.venue.localeCompare(b.venue))
}

// ---------------------------------------------------------------- teams negotiating with us

export type SwapTalk = {
  readonly kind: 'swap'
  readonly id: number
  readonly with: string
  readonly venue: string | null
  readonly status: 'open' | 'closed'
  readonly closedReason: string | null
  /** The latest offer, from our side: what we would give and get; null before any offer. */
  readonly weGive: TeamSide | null
  readonly theyGive: TeamSide | null
  /** Who made the latest offer. */
  readonly lastBy: 'us' | 'them' | null
  readonly final: boolean
  /** Their latest words: untrusted plain text, printed escaped, never spoken. */
  readonly lastText: string | null
  readonly lastTick: number | null
}

export type DuelTalk = {
  readonly kind: 'duel'
  readonly id: number
  readonly rival: string | null
  readonly side: 'buy' | 'sell'
  readonly item: string | null
  readonly ourPrice: number | null
  readonly theirPrice: number | null
  readonly status: 'open' | 'deal' | 'no deal'
  readonly dealPrice: number | null
  readonly ticksLeft: number | null
  readonly lastTick: number | null
}

export type TeamTalk = SwapTalk | DuelTalk

/** A team thread is live while it is open and its latest offer has not lapsed (a thread may never get thread.closed). */
const teamStatus = (s: State, th: TeamThread): { status: 'open' | 'closed'; reason: string | null } => {
  const lapse = th.offers.at(-1)?.expiresTick
  if (th.status === 'open' && lapse != null && lapse < s.tick) return { status: 'closed', reason: 'expired' }
  return { status: th.status, reason: th.closedReason }
}

const swapOf = (s: State, th: TeamThread): SwapTalk => {
  const last = th.offers.at(-1)
  const { status, reason } = teamStatus(s, th)
  // the maker gives `give` and wants `want`: from our side, our offer gives `give`, theirs asks us for `want`
  const weGive = last ? (last.side === 'us' ? last.give : last.want) : null
  const theyGive = last ? (last.side === 'us' ? last.want : last.give) : null
  return {
    kind: 'swap', id: th.id, with: th.with, venue: th.venue, status, closedReason: reason,
    weGive, theyGive, lastBy: last?.side ?? null, final: last?.final ?? false, lastText: th.lastText, lastTick: th.lastTick,
  }
}

/**
 * Every team we are negotiating with: the team threads (swaps) and the duels, live ones first (latest activity
 * first), then the ones that ended in the last `recentTicks`, at most `limit` rows.
 */
export function teamTalks(s: State, { recentTicks = 30, limit = 12 }: { recentTicks?: number; limit?: number } = {}): TeamTalk[] {
  // a thread with no offer yet (words only) says nothing about what moves
  const swaps = [...s.teamThreads.values()].filter((th) => th.offers.length > 0).map((th) => swapOf(s, th))
  const duels = Object.values(s.duels).map((d): DuelTalk => {
    const r = d.status === 'open' ? liveDuel(s, d) : null
    return {
      kind: 'duel', id: d.id, rival: d.rival, side: d.role === 'seller' ? 'sell' : 'buy', item: d.item,
      ourPrice: d.ourPrice, theirPrice: d.theirPrice, status: d.status, dealPrice: d.dealPrice,
      ticksLeft: r?.ticksLeft ?? null, lastTick: d.closedTick ?? d.offers.at(-1)?.tick ?? d.startTick,
    }
  })
  const open = (x: TeamTalk) => x.status === 'open'
  const recent = (x: TeamTalk) => x.lastTick == null || x.lastTick >= s.tick - recentTicks
  const byLast = (a: TeamTalk, b: TeamTalk) => (b.lastTick ?? -1) - (a.lastTick ?? -1) || b.id - a.id
  const all: TeamTalk[] = [...swaps, ...duels]
  return [...all.filter(open).sort(byLast), ...all.filter((x) => !open(x) && recent(x)).sort(byLast)].slice(0, limit)
}

// ---------------------------------------------------------------- what we are negotiating, in words

export type DealerSentence = {
  readonly kind: 'dealer'
  readonly id: number
  readonly side: 'buy' | 'sell'
  readonly with: string
  readonly ref: string
  readonly ourPrice: number | null
  readonly theirPrice: number | null
  readonly final: boolean
  /** Our guardrail cap for the card (a private limit: the page shows it only with GAME_VIEW_TOKEN). */
  readonly cap: number | null
  /** The rule that blocked our agent's latest move in this thread, if it was blocked. */
  readonly blockedBy: string | null
}

export type SwapSentence = { readonly kind: 'swap'; readonly id: number; readonly with: string; readonly weGive: TeamSide | null; readonly theyGive: TeamSide | null; readonly lastBy: 'us' | 'them' | null; readonly final: boolean }

export type DuelSentence = {
  readonly kind: 'duel'
  readonly id: number
  readonly rival: string | null
  readonly side: 'buy' | 'sell'
  readonly item: string | null
  readonly ourPrice: number | null
  readonly theirPrice: number | null
  /** Our limit (private: shown only with GAME_VIEW_TOKEN). */
  readonly limit: number | null
  readonly ticksLeft: number | null
}

export type Sentence = DealerSentence | SwapSentence | DuelSentence

const dealerSentence = (r: NegRow): DealerSentence => ({
  kind: 'dealer', id: r.id, side: r.side, with: r.with, ref: r.topic, ourPrice: r.ourPrice, theirPrice: r.theirPrice, final: r.final,
  cap: r.cap?.cap ?? null, blockedBy: r.next?.status === 'rejected' ? (r.next.rule ?? 'other') : null,
})

/** One sentence per open negotiation of ours: dealer threads, team swaps, duels. */
export function ourNegotiations(s: State, rows: readonly NegRow[] = negRows(s)): Sentence[] {
  const dealers = rows.filter((r) => r.status === 'open').map(dealerSentence)
  const swaps = [...s.teamThreads.values()].filter((th) => th.offers.length > 0 && teamStatus(s, th).status === 'open').map((th): SwapSentence => {
    const x = swapOf(s, th)
    return { kind: 'swap', id: x.id, with: x.with, weGive: x.weGive, theyGive: x.theyGive, lastBy: x.lastBy, final: x.final }
  })
  const duels = Object.values(s.duels).filter((d) => d.status === 'open').sort((a, b) => b.id - a.id).map((d): DuelSentence => {
    const r = liveDuel(s, d)
    return { kind: 'duel', id: d.id, rival: d.rival, side: r.side, item: d.item, ourPrice: d.ourPrice, theirPrice: d.theirPrice, limit: d.limit, ticksLeft: r.ticksLeft }
  })
  return [...dealers, ...swaps, ...duels]
}
