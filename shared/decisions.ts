/**
 * Our agents' decisions on the game stream: what the server builds from db/agent_decisions.sql and
 * the Agent screen reads. Three event types, scope `team`, behind GAME_VIEW_TOKEN like the rest:
 *
 * - `agent.decision`  one decision of the taker, the maker or the duels, sent again when its status,
 *                     its request's answer or its outcome changes (the page keeps the latest per id)
 * - `agent.outcome`   a scored deal: a trade, a dealer thread or a duel
 * - `agent.ledger`    the guardrail ledger per tick for the last two game hours, with the caps it is held to
 */

export const AGENTS = ['taker', 'maker', 'duels'] as const
export type AgentName = (typeof AGENTS)[number]

export const DECISION_STATUSES = ['proposed', 'approved', 'rejected', 'claimed', 'done', 'failed', 'expired'] as const
export type DecisionStatus = (typeof DECISION_STATUSES)[number]

export type OutcomeLabel = 'good' | 'ok' | 'bad'

export interface DecisionPayload {
  readonly decision: number
  readonly agent: AgentName
  readonly kind: string
  /** A card ref, a pack or item name, or `duel:<id>`. */
  readonly item: string | null
  readonly counterparty: string | null
  readonly price: number | null
  /** Our private value of the item (never for a duel). */
  readonly value: number | null
  readonly status: DecisionStatus
  /** `allowed`, `denied`, or null when the row was not a guardrail check (a skip, a note). */
  readonly verdict: 'allowed' | 'denied' | null
  /** The guardrail rule id that blocked it (`max_spend_per_game_hour`, ...), `other`, or null. */
  readonly rule: string | null
  /** The denial, short (never for a duel: it prints our limit). */
  readonly text: string | null
  readonly jev: string | null
  readonly jevValue: number | null
  readonly method: string | null
  readonly error: string | null
  readonly outcome: OutcomeLabel | null
  readonly surplus: number | null
  readonly jevRight: boolean | null
}

export interface OutcomePayload {
  readonly target: 'trade' | 'dealer' | 'duel'
  readonly subject: string
  readonly decision: number | null
  readonly agent: AgentName | null
  readonly item: string | null
  readonly counterparty: string | null
  readonly side: 'buy' | 'sell' | null
  readonly price: number | null
  readonly value: number | null
  readonly label: OutcomeLabel | null
  readonly score: number | null
  readonly surplus: number | null
  readonly jev: string | null
  readonly jevRight: boolean | null
}

export interface LedgerTick {
  readonly tick: number
  /** Game hours played at that tick (`t_hours`). */
  readonly t: number
  /** Primas committed to purchases, net of refunds. */
  readonly spent: number
  readonly accepts: number
  readonly listings: number
}

/** The caps of GUARDRAILS.md the ledger is held to, as the server knows them: a GUARDRAIL_* variable, else the docs. */
export interface GuardrailLimits {
  readonly spendPerHour: number
  readonly cashFloor: number
  readonly acceptsPerTick: number
  /** `venue_bond_reserve`, held on top of the floor while our planned venue is not open; 0 when no venue is planned. */
  readonly bondReserve?: number
  /** The values a GUARDRAIL_* variable set (the rest are the docs'). */
  readonly fromEnv?: readonly ('spendPerHour' | 'cashFloor' | 'acceptsPerTick')[]
}

export interface LedgerPayload {
  readonly ticks: readonly LedgerTick[]
  readonly limits: GuardrailLimits
  /** We run our own venue now (the bond reserve no longer applies); null when the server does not know. */
  readonly venue?: boolean | null
}
