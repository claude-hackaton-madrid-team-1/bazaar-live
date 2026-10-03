/**
 * The wire type of GET /api/history: our cash over the day and what moved it (db/history.sql), as the server
 * last read it. Every field is checked on the server (server/history/rows.ts). Days are the Madrid date
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
  readonly agent: string
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

/** Which views answered on the last poll (a view the admin has not applied yet is `false`). */
export interface HistoryParts {
  readonly points: boolean
  readonly trades: boolean
  readonly orders: boolean
  readonly events: boolean
}

export interface HistorySnapshot {
  /** When the server last read the database; null before the first good read. */
  readonly at: string | null
  readonly parts: HistoryParts
  readonly points: readonly CashPoint[]
  readonly trades: readonly Trade[]
  readonly orders: readonly Order[]
  readonly events: readonly TeamEvent[]
}

export const EMPTY_HISTORY: HistorySnapshot = {
  at: null,
  parts: { points: false, trades: false, orders: false, events: false },
  points: [],
  trades: [],
  orders: [],
  events: [],
}
