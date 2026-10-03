/**
 * Our agents' decisions in the game state: `agent.decision` kept per agent and per decision id (a decision
 * comes again when its status, its request's answer or its outcome changes: the latest wins, in place),
 * `agent.outcome` per scored deal, and the latest `agent.ledger`. Bounded; the reducer calls these.
 */
import { AGENTS, type AgentName, type DecisionPayload, type LedgerPayload, type OutcomePayload } from '../../shared/decisions.ts'
import type { GameEvent } from './state.ts'

export type DecisionRow = DecisionPayload & { readonly eventId: number; readonly tick: number }

export type OutcomeRow = OutcomePayload & { readonly eventId: number; readonly tick: number | null }

export type DecisionLog = {
  /** Per agent, oldest first. */
  decisions: Record<AgentName, DecisionRow[]>
  /** Newest last. */
  outcomes: OutcomeRow[]
  ledger: LedgerPayload | null
}

export const DECISION_LIMITS = { perAgent: 400, outcomes: 200 }

export function createDecisionLog(): DecisionLog {
  return { decisions: { taker: [], maker: [], duels: [] }, outcomes: [], ledger: null }
}

const isAgent = (v: unknown): v is AgentName => (AGENTS as readonly unknown[]).includes(v)

export function applyDecision(s: DecisionLog, e: GameEvent): void {
  const p = e.payload as Partial<DecisionPayload>
  if (!isAgent(p.agent) || typeof p.decision !== 'number' || typeof e.tick !== 'number') return
  const list = s.decisions[p.agent]
  const row = { ...(p as DecisionPayload), eventId: e.id, tick: e.tick }
  const at = list.findIndex((r) => r.decision === row.decision)
  if (at >= 0) {
    list[at] = row
    return
  }
  // Rows come oldest first; a late one (a re-read after a restart) still lands in id order.
  let i = list.length
  while (i > 0 && (list[i - 1]?.decision ?? 0) > row.decision) i -= 1
  list.splice(i, 0, row)
  if (list.length > DECISION_LIMITS.perAgent) list.splice(0, list.length - DECISION_LIMITS.perAgent)
}

export function applyOutcome(s: DecisionLog, e: GameEvent): void {
  const p = e.payload as Partial<OutcomePayload>
  if (typeof p.target !== 'string' || typeof p.subject !== 'string') return
  const row = { ...(p as OutcomePayload), eventId: e.id, tick: typeof e.tick === 'number' ? e.tick : null }
  const at = s.outcomes.findIndex((o) => o.target === row.target && o.subject === row.subject)
  if (at >= 0) s.outcomes.splice(at, 1)
  s.outcomes.push(row)
  if (s.outcomes.length > DECISION_LIMITS.outcomes) s.outcomes.splice(0, s.outcomes.length - DECISION_LIMITS.outcomes)
  // The decision that made the deal shows how it ended.
  if (row.decision != null && row.agent != null && isAgent(row.agent)) {
    const list = s.decisions[row.agent]
    const i = list.findIndex((d) => d.decision === row.decision)
    const d = list[i]
    if (d) list[i] = { ...d, outcome: row.label, surplus: row.surplus, jevRight: row.jevRight }
  }
}

export function applyLedger(s: DecisionLog, e: GameEvent): void {
  const p = e.payload as Partial<LedgerPayload>
  if (!Array.isArray(p.ticks) || typeof p.limits !== 'object' || p.limits === null) return
  s.ledger = { ticks: p.ticks, limits: p.limits, venue: typeof p.venue === 'boolean' ? p.venue : null }
}
