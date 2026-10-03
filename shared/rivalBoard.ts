/**
 * The rival board's part of GET /api/rivals (shared/rivals.ts `board`): what the Rivals screen reads of db/rival_board.sql
 * (show.rival_board, over the agents' public.rival_board view), as the server last read it. Every field is checked on
 * the server (server/rivals/boardRows.ts). Private, unlike the rival albums: our spare copies, the cards we miss and the
 * move we would make with each team; the route sits behind GAME_VIEW_TOKEN like every game screen.
 */

/** Where a team beats us (or simply does well): one badge each. */
export type StrengthCode = 'negotiating' | 'market' | 'pages' | 'dealer_ladder' | 'venue' | 'climbing'

/** Where a team trails us, or what it lacks: one badge each. */
export type WeaknessCode = 'negotiating' | 'market' | 'pages' | 'no_venue_trades' | 'falling' | 'needs_cards'

export const STRENGTH_CODES: readonly StrengthCode[] = ['negotiating', 'market', 'pages', 'dealer_ladder', 'venue', 'climbing']
export const WEAKNESS_CODES: readonly WeaknessCode[] = ['negotiating', 'market', 'pages', 'no_venue_trades', 'falling', 'needs_cards']

/**
 * The view's suggested move: swap (our spare for their copy), sell (our spare into their bid), buy (their copy at their
 * ask), hold (a guarded rival: the best move would help them more than the rule allows), watch (nothing to trade yet).
 */
export type MoveKind = 'swap' | 'sell' | 'buy' | 'hold' | 'watch'

export const MOVE_KINDS: readonly MoveKind[] = ['swap', 'sell', 'buy', 'hold', 'watch']

/** Why a team is guarded: in the top 5, or within 3 ranks of us (also every team while our own rank is unknown). */
export type GuardReason = 'top5' | 'near'

export const GUARD_REASONS: readonly GuardReason[] = ['top5', 'near']

/** One point of a team's rank and score over the trend window (oldest first). */
export interface TrendPoint {
  readonly tick: number
  readonly rank: number
  readonly score: number | null
}

/** A card a team showed on the board in the window: a bid or swap want (theyWant), an ask or swap give (theyHave). */
export interface CardSignal {
  readonly ref: string
  /** Their latest price for it (a bid's cash, an ask's cash), or null when only a swap named it. */
  readonly price: number | null
  readonly tick: number | null
}

/** One of our spare copies that a team bid for (or asked for in a swap). */
export interface SpareMatch {
  readonly ref: string
  /** Copies we hold beyond the one the album keeps. */
  readonly spare: number
  readonly theirPrice: number | null
  /** What the game says one of our copies is worth to us (`your_value`). */
  readonly ourValue: number | null
}

/** A copy a team offered (ask or swap give) of a page card we miss. */
export interface CopyMatch {
  readonly ref: string
  readonly theirPrice: number | null
  /** Book × our set multiplier: what the card would add for us. */
  readonly valueToUs: number | null
}

export interface BoardRow {
  readonly team: string
  /** The leaderboard window these numbers come from. */
  readonly tick: number
  readonly rank: number
  readonly score: number | null
  readonly negotiating: number | null
  readonly market: number | null
  readonly level: number | null
  readonly pages: number | null
  readonly deals: number | null
  readonly venue: string | null
  /** Ranks gained over the trend window (positive: climbed). */
  readonly rankChange: number | null
  readonly scoreChange: number | null
  /** How many ticks back the trend compares with. */
  readonly trendTicks: number | null
  readonly trend: readonly TrendPoint[]
  readonly ourRank: number | null
  readonly ourScore: number | null
  readonly ourNegotiating: number | null
  readonly ourMarket: number | null
  readonly ourPages: number | null
  /** Their settlements with a dealer (persona), all game. */
  readonly dealerDeals: number
  /** Settlements on their own venue, all game. */
  readonly venueTrades: number
  /** The set they chase most (competitor_profiles), or null. */
  readonly topSet: string | null
  /** Set → interest (positive: they buy it, negative: they sell it). */
  readonly setInterest: Readonly<Record<string, number>>
  readonly strengths: readonly StrengthCode[]
  readonly weaknesses: readonly WeaknessCode[]
  readonly theyWant: readonly CardSignal[]
  readonly theyHave: readonly CardSignal[]
  readonly weHaveForThem: readonly SpareMatch[]
  readonly theyHaveForUs: readonly CopyMatch[]
  /** weHaveForThem + theyHaveForUs. */
  readonly matchCount: number
  /** In the top 5 or within 3 ranks of us: we only trade when our gain (as the board estimates it) is at least twice theirs. */
  readonly guarded: boolean
  readonly guardReason: GuardReason | null
  readonly moveKind: MoveKind
  /** The card we would give (swap, sell). */
  readonly moveGive: string | null
  /** The card we would get (swap, buy). */
  readonly moveGet: string | null
  /** Their live bid (sell) or ask (buy). */
  readonly movePrice: number | null
  /** Estimates: ours net of the fee cap on a sale or a buy; theirs at book × the top set multiplier, page bonus unknown. */
  readonly ourGain: number | null
  readonly theirGain: number | null
  /** The view's own sentence, in English (the screen builds its ES/EN words from the fields above). */
  readonly suggestedMove: string
  /** The latest rule-made note on why they climbed (learnings kind rival_move), or null. */
  readonly whyClimbed: string | null
  readonly whyClimbedTick: number | null
}
