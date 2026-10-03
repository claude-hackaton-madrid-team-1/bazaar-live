/**
 * The wire type of GET /api/learn: what our agents learned (db/learn.sql), as the server last read it.
 * Every field is checked on the server (server/learn/rows.ts); claims are feed-derived text, so the page
 * still shows them as quoted data, never as markup.
 */

/** blocker / cooloff / quota / sold_out stop a deal until `untilTick`; the rest are facts and lessons. */
export type LearningKind =
  | 'blocker' | 'cooloff' | 'quota' | 'sold_out' | 'price_floor' | 'behaviour' | 'rule_change'
  | 'fee_change' | 'announcement' | 'lesson' | 'policy' | 'tactic'

export interface Learning {
  readonly id: number
  readonly subjectKind: string
  readonly subject: string
  readonly kind: string
  readonly claim: string
  /** rules | llm | outcome */
  readonly source: string
  /** 0..1 */
  readonly confidence: number
  /** How many feed events or outcomes back it. */
  readonly support: number
  readonly createdTick: number | null
  /** Exclusive: the subject is free again AT this tick. Null = no expiry. */
  readonly untilTick: number | null
  /** Whom it binds; null = everyone. */
  readonly team: string | null
  readonly stats: Readonly<Record<string, unknown>> | null
}

export type MoveEvent = 'open' | 'counter' | 'concede' | 'hold' | 'final' | 'walk' | 'deal' | 'cooloff' | 'lie_suspected'

export interface TraderMove {
  readonly id: number
  readonly trader: string
  readonly thread: number | null
  readonly tick: number | null
  readonly event: string
  readonly ourPrice: number | null
  readonly theirPrice: number | null
  readonly step: number | null
  readonly final: boolean
  /** Our own thread (`ours`) or another team's, read from the public feed (`feed`). */
  readonly ours: boolean
}

export interface DealerStat {
  readonly dealer: string
  readonly threads: number
  readonly deals: number
  readonly ourThreads: number
  readonly ourDeals: number
  readonly avgOpen: number | null
  readonly avgFill: number | null
  /** Fill price over opening ask, all teams: 1 = paid the opening. */
  readonly fillRatio: number | null
  readonly ourFillRatio: number | null
  readonly avgSteps: number | null
  readonly avgTicks: number | null
}

export interface RivalProfile {
  readonly team: string
  readonly updatedTick: number | null
  readonly level: number | null
  readonly venue: string | null
  readonly avgPackPrice: number | null
  readonly dealerDealRate: number | null
  /** Set code → interest (a count or a share), as the profiler wrote it. */
  readonly setInterest: Readonly<Record<string, number>>
  readonly buys: number | null
  readonly sells: number | null
  readonly spent: number | null
  readonly earned: number | null
  readonly topSet: string | null
}

/** Which of the four views answered on the last poll (a view the admin has not applied yet is `false`). */
export interface LearnParts {
  readonly learnings: boolean
  readonly moves: boolean
  readonly dealers: boolean
  readonly rivals: boolean
}

export interface LearnSnapshot {
  /** ISO time of the last successful poll, or null before the first. */
  readonly at: string | null
  readonly parts: LearnParts
  readonly learnings: readonly Learning[]
  readonly moves: readonly TraderMove[]
  readonly dealers: readonly DealerStat[]
  readonly rivals: readonly RivalProfile[]
}

export type LearnResponse = ({ readonly enabled: true } & LearnSnapshot) | { readonly enabled: false }

export const EMPTY_LEARN: LearnSnapshot = {
  at: null,
  parts: { learnings: false, moves: false, dealers: false, rivals: false },
  learnings: [],
  moves: [],
  dealers: [],
  rivals: [],
}
