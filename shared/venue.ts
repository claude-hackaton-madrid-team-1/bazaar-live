/**
 * The wire type of GET /api/venue: what the Venue screen reads of db/venue.sql, as the server last read it. Every field
 * is checked on the server (server/venue/rows.ts). Private: our broker's moves and our own Market Test numbers, so the
 * route sits behind GAME_VIEW_TOKEN like every game screen.
 */

/** A venue of ours (the board venue the keeper opened, a hand-opened one, a starter stall /me named). */
export interface OurVenue {
  readonly venue: string
  readonly name: string | null
  /** `board` (our broker matches) or `auto` (the venue crosses on its own); null when unknown. */
  readonly mechanism: string | null
  readonly feeBps: number | null
  readonly feePerCard: number | null
  /** null: no venue event and not our venue now (a stall replaced since). */
  readonly status: 'open' | 'closing' | 'closed' | 'suspended' | null
  readonly openedTick: number | null
  /** /me names it as our venue now. */
  readonly current: boolean
  /** /me names it as the venue the Market Test counts (`bench_venue`). */
  readonly counted: boolean
}

/** A Market Test session as the public feed announced it. */
export interface BenchSession {
  readonly day: string
  readonly session: number | null
  readonly startTick: number
  readonly ticks: number | null
  /** How many venues got the book. */
  readonly venues: number | null
  /** One of our venues got it; null when the start does not list venues. */
  readonly ours: boolean | null
  readonly at: string | null
}

/** One synthetic trader of a session's book, once: its side and first quote, the ticks it was seen. */
export interface BenchTrader {
  readonly id: string
  readonly side: 'buy' | 'sell'
  readonly quote: number | null
  readonly first: number
  readonly last: number
}

/** A synthetic book our broker read: one run (`b35`) per session. */
export interface BenchBook {
  readonly run: string
  readonly day: string | null
  readonly firstTick: number
  readonly lastTick: number
  readonly ticksSeen: number
  readonly venue: string | null
  readonly feeBps: number | null
  readonly feePerCard: number | null
  /** The announced session it falls in, when the feed has it. */
  readonly session: number | null
  readonly startTick: number | null
  readonly traders: readonly BenchTrader[]
}

/** One match our broker proposed (bench or public book), or the bench probe. */
export interface BrokerMatch {
  readonly id: number
  readonly tick: number
  readonly kind: string
  /** approved, rejected (a guardrail), expired, done (sent and accepted), failed (the game refused). */
  readonly status: string
  readonly bench: boolean
  readonly run: string | null
  readonly card: string | null
  readonly ask: number | null
  readonly bid: number | null
  readonly price: number | null
  readonly fee: number | null
  /** Buyer quote − seller quote (the quoted surplus; the game scores the hidden limits). */
  readonly surplus: number | null
  readonly guardrail: string | null
  readonly errorCode: string | null
}

/** What another team did on our venue (public feed). */
export interface VenueTrade {
  readonly id: number
  readonly day: string | null
  readonly tick: number
  readonly type: 'listed' | 'settled' | 'failed'
  readonly venue: string | null
  readonly card: string | null
  readonly price: number | null
  readonly fee: number | null
  readonly side: 'buy' | 'sell' | null
  readonly maker: string | null
  readonly buyer: string | null
  readonly seller: string | null
}

/** Our Market Test numbers from /me at a tick one of them changed. */
export interface VenueScorePoint {
  readonly day: string
  readonly tick: number
  readonly at: string | null
  readonly venue: string | null
  readonly benchVenue: string | null
  /** 0–1: the share of the possible gains our venue realised. */
  readonly efficiency: number | null
  /** 0.5 = the free stall's level, 1 = the mean of the top three. */
  readonly benchPoints: number | null
  readonly mmPoints: number | null
  readonly market: number | null
}

export interface VenueParts {
  readonly venues: boolean
  readonly sessions: boolean
  readonly books: boolean
  readonly matches: boolean
  readonly trades: boolean
  readonly score: boolean
}

export interface VenueSnapshot {
  /** When the server last read the database; null before the first good read. */
  readonly at: string | null
  readonly parts: VenueParts
  readonly venues: readonly OurVenue[]
  /** Oldest first. */
  readonly sessions: readonly BenchSession[]
  /** Oldest first. */
  readonly books: readonly BenchBook[]
  /** Newest first. */
  readonly matches: readonly BrokerMatch[]
  /** Newest first. */
  readonly trades: readonly VenueTrade[]
  /** Oldest first. */
  readonly score: readonly VenueScorePoint[]
}

export const EMPTY_VENUE: VenueSnapshot = {
  at: null,
  parts: { venues: false, sessions: false, books: false, matches: false, trades: false, score: false },
  venues: [],
  sessions: [],
  books: [],
  matches: [],
  trades: [],
  score: [],
}
