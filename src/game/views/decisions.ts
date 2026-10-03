/**
 * What the Agent screen answers from our agents' decisions (db/agent_decisions.sql, or the mock):
 * did each agent decide this tick and what stopped it, which guardrail blocks most in the last game hour,
 * where the money stands against its caps, and whether the settled deals beat our value.
 */
import { AGENTS, type AgentName, type DecisionStatus, type GuardrailLimits } from '../../../shared/decisions.ts'
import type { DecisionRow, OutcomeRow } from '../decisions.ts'
import type { State } from '../state.ts'

/** The same refusal repeated tick after tick, shown once: how many, over which ticks, at which prices. */
export type Run = { readonly count: number; readonly from: number; readonly to: number; readonly low: number | null; readonly high: number | null }

export type Idle = { readonly agent: AgentName; readonly last: number | null }

export type DecideSlot =
  | { readonly kind: 'row'; readonly row: DecisionRow; readonly run: Run | null }
  | { readonly kind: 'idle'; readonly agents: readonly Idle[] }

/** Rows the agents log that send nothing to the game (a deploy restart, a thread's bookkeeping): no guardrail ran on them. */
const NON_WRITE_KINDS: ReadonlySet<string> = new Set(['process_started', 'dealer_opened', 'dealer_closed'])

export const isWrite = (kind: string): boolean => !NON_WRITE_KINDS.has(kind)

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

const refusalKey = (r: DecisionRow): string | null => (r.verdict === 'denied' ? `${r.kind}|${r.item ?? ''}|${r.rule ?? ''}` : null)

/**
 * Identical refusals in a row (same agent, kind, item and rule; rows that write nothing do not break a run): the
 * last row of each run of two or more carries the run, the earlier ones are folded into it. Decision id → run, or
 * null for a folded row.
 */
export function refusalRuns(s: State, upToTick: number | null = null): Map<number, Run | null> {
  const out = new Map<number, Run | null>()
  for (const agent of AGENTS) {
    let run: DecisionRow[] = []
    const close = () => {
      const last = run.at(-1)
      if (last && run.length > 1) {
        const prices = run.map((r) => r.price).filter((p): p is number => p != null)
        for (const r of run) out.set(r.decision, null)
        out.set(last.decision, {
          count: run.length, from: run[0]?.tick ?? last.tick, to: last.tick,
          low: prices.length ? Math.min(...prices) : null, high: prices.length ? Math.max(...prices) : null,
        })
      }
      run = []
    }
    for (const r of s.agents.decisions[agent]) {
      if (upToTick != null && r.tick > upToTick) break
      if (!isWrite(r.kind)) continue
      const key = refusalKey(r)
      const prev = run[0]
      if (key == null || (prev && refusalKey(prev) !== key)) close()
      if (key != null) run.push(r)
    }
    close()
  }
  return out
}

/**
 * The DECIDE lane of one tick: each agent's decisions of that tick in id order (a run of identical refusals once,
 * on its last tick), then one compact slot naming the agents that did not decide and when they last did. Nothing
 * at all before the first decision ever seen (no claim about agents we never heard of).
 */
export function decideSlots(s: State, tick: number, runs: Map<number, Run | null> = refusalRuns(s)): DecideSlot[] {
  const first = Math.min(...AGENTS.flatMap((a) => s.agents.decisions[a].map((r) => r.tick)))
  if (!Number.isFinite(first) || tick < first) return []
  const slots: DecideSlot[] = []
  const idle: Idle[] = []
  for (const agent of AGENTS) {
    const rows = s.agents.decisions[agent]
    const now = rows.filter((r) => r.tick === tick)
    if (!now.length) idle.push({ agent, last: rows.filter((r) => r.tick < tick).at(-1)?.tick ?? null })
    for (const row of now) {
      const run = runs.get(row.decision)
      if (run !== null) slots.push({ kind: 'row', row, run: run ?? null })
    }
  }
  if (idle.length) slots.push({ kind: 'idle', agents: idle })
  return slots
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
  /** Our value of the item: the outcome's, else (a dealer fill) the one our decisions on that thread logged. */
  readonly value: number | null
  /** Positive: the deal beat our value by this much. */
  readonly edge: number | null
  readonly verdict: 'beat' | 'even' | 'below' | null
}

/** A dealer thread that ended with no fill (we walked, she walked) scored as an outcome, but nothing changed hands. */
const settled = (o: OutcomeRow): boolean => o.target !== 'dealer' || o.price != null

/** Our value of a dealer fill: the latest value our agent logged for that card with that dealer up to the fill. */
function dealerValue(s: State, o: OutcomeRow): number | null {
  if (o.target !== 'dealer' || o.agent == null || o.item == null) return null
  const rows = s.agents.decisions[o.agent]
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r && r.value != null && r.item === o.item && r.counterparty === o.counterparty && (o.tick == null || r.tick <= o.tick)) return r.value
  }
  return null
}

function dealOf(s: State, row: OutcomeRow): Deal {
  const value = row.value ?? dealerValue(s, row)
  const edge = row.surplus ?? (value != null && row.price != null ? (row.side === 'sell' ? row.price - value : value - row.price) : null)
  return { row, value, edge, verdict: edge == null ? null : edge > 0 ? 'beat' : edge < 0 ? 'below' : 'even' }
}

/** Every settled deal we know of, newest first: trades and dealer fills (a duel is scored, not settled on the board). */
export function settledDeals(s: State): Deal[] {
  return [...s.agents.outcomes].reverse().filter((o) => o.target !== 'duel' && settled(o)).map((o) => dealOf(s, o))
}

/** The scored deals, newest first: did each beat our value, and was Jev right? */
export function deals(s: State, limit = 6): Deal[] {
  return [...s.agents.outcomes]
    .reverse()
    .filter(settled)
    .slice(0, limit)
    .map((row) => dealOf(s, row))
}

/** Dealer threads our agents opened and have not closed, opened within the last game hour (older ones lapsed). */
export function openDealerThreads(s: State): number {
  const since = s.tick - ticksPerHour(s.tickSeconds)
  let open = 0
  for (const a of AGENTS) {
    const live = new Map<string, number>()
    for (const r of s.agents.decisions[a]) {
      const key = `${r.item ?? ''}|${r.counterparty ?? ''}`
      if (r.kind === 'dealer_opened') live.set(key, r.tick)
      else if (r.kind === 'dealer_closed') live.delete(key)
    }
    for (const tick of live.values()) if (tick >= since) open += 1
  }
  return open
}

/** The latest decision across agents, by id, that the test says yes to. */
export function latestDecision(s: State, keep: (r: DecisionRow) => boolean): DecisionRow | null {
  let best: DecisionRow | null = null
  for (const a of AGENTS) {
    const rows = s.agents.decisions[a]
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]
      if (r && keep(r)) {
        if (!best || r.decision > best.decision) best = r
        break
      }
    }
  }
  return best
}
