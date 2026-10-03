/**
 * The show's event model: what the taker and maker publish on WS /events, reduced to public fields.
 *
 * Contract: bazaar/docs/services.md. Envelope `{id, tick, t, type, scope, actor, agent, payload}`, ids
 * negative and per process (both agents count -1, -2, ... and restart at -1 after a deploy), so a dedupe
 * key needs the agent and more than the id.
 */

export type AgentId = 'taker' | 'maker'
export const AGENTS: readonly AgentId[] = ['taker', 'maker']

/** `allowed`, `denied` or `-` (no guardrail ran): the label only, never the rule text. */
export type GuardrailLabel = 'allowed' | 'denied' | '-'

export type DecisionStatus = 'approved' | 'rejected' | 'skipped' | 'expired' | (string & {})

/** The public inputs of a decision. Every field is optional: unsent rows carry only the card. */
export interface PublicInputs {
  readonly dealer?: string
  readonly thread?: number
  readonly item?: string
  readonly ref?: string
  readonly card?: string
  readonly rarity?: string
  readonly side?: string
  readonly venue?: string
  readonly offerId?: number
  readonly maker?: string
  readonly ask?: number
  readonly herAsk?: number
  readonly fee?: number
  readonly final?: boolean
  /** Our own price: public only on an approved row of a live agent. */
  readonly price?: number
}

/** The public move: what was (or would be) sent. */
export interface PublicMove {
  readonly kind?: string
  readonly price?: number
  readonly accept?: number
  readonly openThread?: string
  readonly cancel?: number
  readonly hold?: number
  readonly reprice?: number
  readonly wantCash?: number
  readonly venue?: string
}

export interface PublicDecision {
  readonly decisionId: number | null
  readonly tick: number | null
  readonly kind: string
  readonly chosen: boolean | null
  readonly status: DecisionStatus
  /** null when the row did not say (counts as a dry run). */
  readonly dryRun: boolean | null
  /** Approved, chosen and live: the request really went to the game. */
  readonly sent: boolean
  readonly threadId: number | null
  readonly guardrail: GuardrailLabel
  /** Jev's verdict label (`aggressive`, `accept`, `yes`, `undecided`, ...) on a sent row, else null. */
  readonly jevVerdict: string | null
  readonly inputs: PublicInputs
  readonly move: PublicMove
}

export interface PublicExecution {
  readonly decisionId: number | null
  readonly tick: number | null
  /** SDK route name: `accept`, `list_offer`, `cancel`, `open_thread`, `say`, `close_thread`, ... */
  readonly method: string
  readonly ok: boolean
  readonly errorCode: string | null
  readonly createdId: number | null
  readonly request: {
    readonly offer?: number
    readonly thread?: number
    readonly with?: string
    readonly price?: number
    readonly venue?: string
  }
}

interface BaseEvent {
  /** Dedupe key: agent, envelope id, type, tick and t. */
  readonly key: string
  readonly id: number
  readonly agent: AgentId
  readonly tick: number | null
  /** Game hours since the start, as the agent saw them. */
  readonly t: number | null
}

export interface TickEvent extends BaseEvent {
  readonly type: 'agent.tick'
  readonly mode: 'live' | 'dry' | null
}

export interface DecisionEvent extends BaseEvent {
  readonly type: 'agent.decision'
  readonly decision: PublicDecision
}

export interface ExecutionEvent extends BaseEvent {
  readonly type: 'agent.execution'
  readonly execution: PublicExecution
}

export type ShowEvent = TickEvent | DecisionEvent | ExecutionEvent

/** GET /health, as the show reads it. */
export interface AgentHealth {
  readonly ok: boolean
  readonly agent: string
  readonly mode: 'live' | 'dry' | null
  readonly tick: number | null
  readonly doors: string | null
  readonly paused: boolean | null
  readonly nextOpens: string | null
  readonly tickSeconds: number | null
  readonly serverTick: number | null
  /** Where the agent's requests go: the real game or the simulator (`target.mode`). */
  readonly target: 'real' | 'simulator' | null
}

/** One of the maker's open offers from GET /state (already public on the board). */
export interface OpenOffer {
  readonly id: number
  readonly side: string
  readonly ref: string
  readonly price: number | null
  readonly venue: string | null
}

export interface AgentState {
  readonly agent: string
  readonly mode: 'live' | 'dry' | null
  readonly tick: number | null
  readonly team: string | null
  /** null when /state has no `open_offers` (the taker, or a maker before its first view). */
  readonly openOffers: readonly OpenOffer[] | null
}
