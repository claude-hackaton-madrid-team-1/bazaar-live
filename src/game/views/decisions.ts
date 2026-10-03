/**
 * What the Agent screen answers from our agents' decisions (db/agent_decisions.sql, or the mock):
 * did each agent decide this tick and what stopped it, which guardrail blocks most in the last game hour,
 * where the money stands against its caps, and whether the settled deals beat our value.
 */
import { AGENTS, type AgentName, type DecisionStatus, type GuardrailLimits } from '../../../shared/decisions.ts'
import type { DecisionRow, OutcomeRow } from '../decisions.ts'
import type { State } from '../state.ts'

export type DecideSlot =
  | { readonly kind: 'row'; readonly row: DecisionRow }
  | { readonly kind: 'idle'; readonly agent: AgentName; readonly last: number | null }

export type StatusTone = 'good' | 'bad' | 'warn' | 'us' | 'neutral'

export const STATUS_TONE: Readonly<Record<DecisionStatus, StatusTone>> = {
  done: 'good', approved: 'us', claimed: 'us', proposed: 'neutral', rejected: 'bad', failed: 'bad', expired: 'warn',
}

/** True once any decision reached the page: before that the screen says nothing about idle agents. */
export const hasDecisions = (s: State): boolean => AGENTS.some((a) => s.agents.decisions[a].length > 0)

/** The ticks that have a decision, newest first. */
export function decisionTicks(s: State): number[] {
  const ticks = new Set<number>()
  for (const a of AGENTS) for (const r of s.agents.decisions[a]) ticks.add(r.tick)
  return [...ticks].sort((a, b) => b - a)
}

/**
 * The DECIDE lane of one tick: each agent's decisions of that tick in id order, or one idle slot saying
 * when it last decided. Nothing at all before the first decision ever seen (no claim about agents we never heard of).
 */
export function decideSlots(s: State, tick: number): DecideSlot[] {
  const first = Math.min(...AGENTS.flatMap((a) => s.agents.decisions[a].map((r) => r.tick)))
  if (!Number.isFinite(first) || tick < first) return []
  return AGENTS.flatMap((agent): DecideSlot[] => {
    const rows = s.agents.decisions[agent]
    const now = rows.filter((r) => r.tick === tick)
    if (now.length) return now.map((row) => ({ kind: 'row', row }))
    const before = rows.filter((r) => r.tick < tick).at(-1)
    return [{ kind: 'idle', agent, last: before?.tick ?? null }]
  })
}

/** Ticks in one game hour: `t_hours` grows by tick_seconds / 3600 a tick (60 s ticks: 60 a game hour). */
export const ticksPerHour = (tickSeconds: number): number => Math.max(1, Math.round(3600 / (tickSeconds > 0 ? tickSeconds : 60)))

export type RuleCount = { readonly rule: string; readonly count: number; readonly lastTick: number; readonly agents: AgentName[] }

export type Blocks = { readonly fromTick: number; readonly total: number; readonly rules: RuleCount[] }

/** Denials by rule id over the last game hour, most frequent first. */
export function blocksByRule(s: State): Blocks {
  const fromTick = Math.max(0, s.tick - ticksPerHour(s.tickSeconds) + 1)
  const by = new Map<string, { count: number; lastTick: number; agents: Set<AgentName> }>()
  for (const a of AGENTS) {
    for (const r of s.agents.decisions[a]) {
      if (r.verdict !== 'denied' || r.tick < fromTick) continue
      const rule = r.rule ?? 'other'
      const c = by.get(rule) ?? { count: 0, lastTick: r.tick, agents: new Set<AgentName>() }
      c.count += 1
      c.lastTick = Math.max(c.lastTick, r.tick)
      c.agents.add(a)
      by.set(rule, c)
    }
  }
  const rules = [...by].map(([rule, c]) => ({ rule, count: c.count, lastTick: c.lastTick, agents: AGENTS.filter((a) => c.agents.has(a)) }))
  rules.sort((x, y) => y.count - x.count || y.lastTick - x.lastTick || x.rule.localeCompare(y.rule))
  return { fromTick, total: rules.reduce((n, r) => n + r.count, 0), rules }
}

export type Ledger = {
  readonly spent: number
  readonly cash: number
  readonly accepts: number
  readonly limits: GuardrailLimits
  /** What the next purchase may still cost: the hour's budget and the cash above the floor, whichever is less. */
  readonly headroom: number
  readonly tick: number
}

/** The latest game hour we know: the newest clock we saw, or the newest ledger tick. */
function nowHours(s: State, ledgerT: number): number {
  for (let i = s.mine.length - 1; i >= 0; i--) {
    const e = s.mine[i]
    if (e?.type === 'clock' && typeof e.t === 'number') return Math.max(e.t, ledgerT)
  }
  return ledgerT
}

/** Spend over the last game hour (as guardrails.check() sums it: `t_hours` above now − 1), cash against the floor, accepts this tick. */
export function ledger(s: State): Ledger | null {
  const l = s.agents.ledger
  if (!l) return null
  const now = nowHours(s, Math.max(0, ...l.ticks.map((t) => t.t)))
  const spent = l.ticks.filter((t) => t.t > now - 1).reduce((n, t) => n + t.spent, 0)
  const accepts = l.ticks.find((t) => t.tick === s.tick)?.accepts ?? 0
  const headroom = Math.max(0, Math.min(l.limits.spendPerHour - spent, s.cash - l.limits.cashFloor))
  return { spent, cash: s.cash, accepts, limits: l.limits, headroom, tick: s.tick }
}

/** A share of a cap, 0 to 1, for a meter. */
export const share = (used: number, cap: number): number => (cap > 0 ? Math.min(1, Math.max(0, used / cap)) : used > 0 ? 1 : 0)

export type Deal = {
  readonly row: OutcomeRow
  /** Positive: the deal beat our value by this much. */
  readonly edge: number | null
  readonly verdict: 'beat' | 'even' | 'below' | null
}

/** The scored deals, newest first: did each beat our value, and was Jev right? */
export function deals(s: State, limit = 6): Deal[] {
  return [...s.agents.outcomes]
    .reverse()
    .slice(0, limit)
    .map((row) => {
      const edge = row.surplus ?? (row.value != null && row.price != null ? (row.side === 'sell' ? row.price - row.value : row.value - row.price) : null)
      return { row, edge, verdict: edge == null ? null : edge > 0 ? 'beat' : edge < 0 ? 'below' : 'even' }
    })
}
