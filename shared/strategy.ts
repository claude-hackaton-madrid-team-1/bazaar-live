/**
 * The wire type of GET /api/strategy: what the Strategy screen reads of db/strategy.sql, as the server last read it.
 * Every field is checked on the server (server/strategy/rows.ts). Private: our values, our caps and why our agents
 * refused a buy, so the route sits behind GAME_VIEW_TOKEN like every game screen.
 */

import type { GuardrailLimits } from './decisions.ts'

/** One album page of ours (a barrio): how many of its page cards we hold. */
export interface StrategyPage {
  readonly set: string
  readonly name: string | null
  readonly have: number
  readonly of: number
  readonly complete: boolean
}

/** One copy of a card we hold. `asset` only matches our own open asks; it is never printed. */
export interface HeldCard {
  readonly ref: string
  readonly set: string | null
  readonly rarity: string | null
  readonly asset: number | null
  /** What the game says this copy is worth to us (`your_value`). */
  readonly value: number | null
}

/** Our latest real-world snapshot. */
export interface StrategyMe {
  readonly team: string
  readonly tick: number
  readonly at: string | null
  readonly cash: number
  readonly level: number | null
  /** Our own venue, when we run one. */
  readonly venue: string | null
  readonly tickSeconds: number | null
  /** Set → multiplier (×1.6 is a set we chase). */
  readonly affinity: Readonly<Record<string, number>>
  readonly pages: readonly StrategyPage[]
  readonly cards: readonly HeldCard[]
}

/** The guardrail ledger now: what our buys spent in the last game hour. */
export interface StrategySpend {
  readonly ledgerTick: number | null
  readonly tHours: number | null
  readonly spent: number
  readonly buys: number
}

/** One decision of the taker or the maker (never the duels'). */
export interface StrategyDecision {
  readonly id: number
  readonly tick: number
  readonly agent: 'taker' | 'maker'
  readonly kind: string
  readonly status: string
  readonly allowed: boolean | null
  /** The guardrail's denial, rules and their values ("denied: cash 81 - 79 < cash_floor 50"), or null. */
  readonly guardrail: string | null
  readonly card: string | null
  /** A swap's card we would give. */
  readonly giveCard: string | null
  readonly rarity: string | null
  readonly venue: string | null
  readonly price: number | null
  readonly fee: number | null
  /** What a buy would cost us, fee included. */
  readonly total: number | null
  readonly value: number | null
  readonly surplus: number | null
  readonly jevValue: number | null
  readonly jevVerdict: string | null
  readonly jevReason: string | null
  /** The agent's own one-line why. */
  readonly reason: string | null
}

/** A single-card ask for cash open now, on some venue. */
export interface OpenAsk {
  readonly offer: number
  readonly tick: number
  readonly expiresTick: number | null
  readonly venue: string | null
  readonly maker: string | null
  /** Addressed to one team (only it can take it), or null for anyone. */
  readonly to: string | null
  readonly asset: number | null
  readonly card: string
  readonly rarity: string | null
  readonly price: number
  readonly ours: boolean
}

/** A released card of the catalog (public), with the last price the tape filled for it. */
export interface CatalogCard {
  readonly card: string
  readonly set: string | null
  readonly setName: string | null
  readonly name: string | null
  readonly rarity: string | null
  readonly book: number | null
  readonly minted: number | null
  readonly printRun: number | null
  /** One of the ten cards of its album page. */
  readonly page: boolean
  readonly lastFill: number | null
  readonly lastFillTick: number | null
}

/** Which views answered on the last poll (a view the admin has not applied yet is `false`). */
export interface StrategyParts {
  readonly me: boolean
  readonly spend: boolean
  readonly decisions: boolean
  readonly asks: boolean
  readonly cards: boolean
}

export interface StrategySnapshot {
  /** When the server last read the database; null before the first good read. */
  readonly at: string | null
  readonly parts: StrategyParts
  readonly me: StrategyMe | null
  readonly spend: StrategySpend | null
  /** Newest first. */
  readonly decisions: readonly StrategyDecision[]
  readonly asks: readonly OpenAsk[]
  readonly cards: readonly CatalogCard[]
  /** The server's limits: a GUARDRAIL_* variable, else the docs (a fresh denial text still overrides them on the page). */
  readonly limits?: GuardrailLimits | null
}

export const EMPTY_STRATEGY: StrategySnapshot = {
  at: null,
  parts: { me: false, spend: false, decisions: false, asks: false, cards: false },
  me: null,
  spend: null,
  decisions: [],
  asks: [],
  cards: [],
}
