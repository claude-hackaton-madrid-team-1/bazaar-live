/**
 * The wire type of GET /api/history: our cash over the day and what moved it (db/history.sql), as the server
 * last read it, with our score over the day and what may have moved it. Every field is checked on the server (server/history/rows.ts). Days are the Madrid date
 * (`2026-10-03`): the game's tick may start again on a new day, so a moment is (day, tick).
 */

/** Our cash at a tick it changed (and at the latest tick). */
export interface CashPoint {
  readonly day: string
  readonly tick: number
  readonly cash: number
  readonly score: number | null
  readonly rank: number | null
}

/** One of our settlements. A buyer pays price + fee; a seller gets the price. */
export interface Trade {
  readonly id: number
  readonly day: string
  readonly tick: number
  readonly side: 'buy' | 'sell'
  readonly counterparty: string
  /** null: a dealer's stall (the counterparty is the dealer). */
  readonly venue: string | null
  readonly card: string | null
  readonly cardName: string | null
  readonly rarity: string | null
  /** More than one item changed hands. */
  readonly items: number
  readonly price: number
  readonly fee: number
}

/** What an agent committed in the ledger: a listing, an accept, a spend. */
export interface Order {
  readonly id: number
  readonly day: string
  readonly tick: number
  readonly kind: string
  readonly price: number | null
  readonly item: string | null
  /** The ledger's source: an agent (taker, maker, duels) or a command run by hand (sell, dealer-sell, ...). */
  readonly agent: string
  /** A listing posted by hand (item `hands-off:<offer>`): that offer, as the feed has it; null otherwise. */
  readonly offer?: OrderOffer | null
}

/** A board offer of ours and what became of it (db/game.sql's show.game_our_offers). */
export interface OrderOffer {
  readonly id: number
  readonly side: 'ask' | 'bid' | 'swap'
  readonly card: string | null
  readonly venue: string | null
  readonly expiresTick: number | null
  readonly status: 'open' | 'settled' | 'cancelled' | 'expired'
}

/** A feed event of ours that can move cash or stock other than a trade. */
export interface TeamEvent {
  readonly id: number
  readonly day: string
  readonly tick: number
  /** venue.opened · venue.closed · pack.opened · gift.given · level.unlocked · settlement.failed */
  readonly type: string
  readonly venue: string | null
  readonly name: string | null
  readonly bond: number | null
  readonly pack: string | null
  readonly best: string | null
  readonly cash: number | null
  readonly level: number | null
  readonly why: string | null
}

/** Our score and its parts at a tick one of them moved (and at the latest tick). The parts are in their own
 *  units: the score is not their sum. */
export interface ScorePoint {
  readonly day: string
  readonly tick: number
  /** When we read it (ISO), or null. */
  readonly at: string | null
  readonly cash: number | null
  readonly score: number | null
  readonly duel: number | null
  readonly ladder: number | null
  readonly neg: number | null
  readonly mm: number | null
  readonly bench: number | null
}

/** What may explain a change of score: one of our agents starting (a deploy or a restart), or the game's own
 *  turn (a round, a Market Test, duels, a new day). */
export interface ScoreMark {
  readonly kind: 'start' | 'game'
  readonly id: number
  readonly day: string
  readonly tick: number
  /** The agent that started (kind start). */
  readonly agent: string | null
  /** round · bench · duels · day (kind game). */
  readonly action: string | null
  readonly note: string | null
  /** When we received it (ISO): game turns only, a start has a tick and no time. */
  readonly at: string | null
}

/**
 * One team's public leaderboard read (db/teams_score.sql), kept when something moved for it (and its first and latest
 * of the day). score = negotiating + market, in points, every team the same way: these compare like with like.
 * pages, deals and level score nothing by themselves. Our private parts (ScorePoint's duel, neg, ...) are not here.
 */
export interface TeamScore {
  readonly day: string
  readonly tick: number
  /** `t05`. */
  readonly team: string
  readonly rank: number
  readonly score: number
  readonly negotiating: number | null
  readonly market: number | null
  readonly level: number | null
  /** Complete album pages. */
  readonly pages: number | null
  readonly deals: number | null
  /** When the board was read (ISO), or null. */
  readonly at: string | null
  /** The team's venue at that read (`v07`), or null without one. */
  readonly venue: string | null
}

/** Which views answered on the last poll (a view the admin has not applied yet is `false`). */
export interface HistoryParts {
  readonly points: boolean
  readonly trades: boolean
  readonly orders: boolean
  readonly events: boolean
  readonly scores: boolean
  readonly marks: boolean
  readonly board: boolean
}

export interface HistorySnapshot {
  /** When the server last read the database; null before the first good read. */
  readonly at: string | null
  readonly parts: HistoryParts
  readonly points: readonly CashPoint[]
  readonly trades: readonly Trade[]
  readonly orders: readonly Order[]
  readonly events: readonly TeamEvent[]
  readonly scores: readonly ScorePoint[]
  readonly marks: readonly ScoreMark[]
  /** Every team's board reads (db/teams_score.sql), in day and tick order. */
  readonly board: readonly TeamScore[]
}

export const EMPTY_HISTORY: HistorySnapshot = {
  at: null,
  parts: { points: false, trades: false, orders: false, events: false, scores: false, marks: false, board: false },
  points: [],
  trades: [],
  orders: [],
  events: [],
  scores: [],
  marks: [],
  board: [],
}
