/**
 * What the Agent screen answers from our agents' decisions (db/agent_decisions.sql, or the mock):
 * is each agent alive or silent, what it last did and what blocks it most, which guardrail blocks most in the
 * last game hour, where the money stands against its caps, and whether the settled deals beat our value.
 */
import { AGENTS, type AgentName, type DecisionStatus, type GuardrailLimits } from '../../../shared/decisions.ts'
import type { DecisionRow, OutcomeRow } from '../decisions.ts'
import type { State } from '../state.ts'

export type StatusTone = 'good' | 'bad' | 'warn' | 'us' | 'neutral'

export const STATUS_TONE: Readonly<Record<DecisionStatus, StatusTone>> = {
  done: 'good', approved: 'us', claimed: 'us', proposed: 'neutral', rejected: 'bad', failed: 'bad', expired: 'warn',
}

/** True once any decision reached the page: before that the screen says nothing about idle agents. */
export const hasDecisions = (s: State): boolean => AGENTS.some((a) => s.agents.decisions[a].length > 0)

/**
 * Ticks without a decision before an agent is quiet (amber), then silent (red): the first thing a watcher must see.
 * Per agent: the taker decides every tick (gaps of 5 ticks at p99 on the real game), so it is silent after 3 with no
 * amber stage; the maker posts in bursts (gaps of 14 ticks at p90, 21 at most), so it is only quiet until 24; the
 * duels decide while a duel runs, so they get a little longer.
 */
export const SILENCE: Readonly<Record<AgentName, { readonly quiet: number; readonly silent: number }>> = {
  taker: { quiet: 3, silent: 3 },
  maker: { quiet: 3, silent: 24 },
  duels: { quiet: 3, silent: 12 },
}

/** An agent whose last run is this many identical blocks in a row is stuck behind a guardrail. */
export const STUCK_AFTER = 3

/** A `process_started` row is the agent coming back up, not a decision: never a block, never proof of life. */
export const isRestart = (r: DecisionRow): boolean => r.kind === 'process_started'

/** Rows the agents log that send nothing to the game (a deploy restart, a thread's bookkeeping): no guardrail ran on them. */
const NON_WRITE_KINDS: ReadonlySet<string> = new Set(['process_started', 'dealer_opened', 'dealer_closed'])

export const isWrite = (kind: string): boolean => !NON_WRITE_KINDS.has(kind)

/** The newest tick we know of: the clock's, or a decision or ledger row ahead of it. */
export function nowTick(s: State): number {
  let tick = s.tick
  for (const a of AGENTS) tick = Math.max(tick, s.agents.decisions[a].at(-1)?.tick ?? 0)
  for (const t of s.agents.ledger?.ticks ?? []) tick = Math.max(tick, t.tick)
  return tick
}

/**
 * One agent's identical decisions folded into one run: the taker asking for SAL-08 every tick and the same rule
 * refusing it twelve times is one line, ×12. Identical means the same kind, item, verdict, rule and status (never
 * the denial text or the price: those drift from tick to tick). Other rows in between do not break a run (the
 * taker refuses several asks each tick, and a restart or a thread's bookkeeping is no decision); a tick the run
 * skips does (twelve blocks over a hundred ticks are not one stuck stretch), and so does another verdict on the
 * same kind and item. A scored decision stays on its own.
 */
export type Run = {
  readonly agent: AgentName
  readonly kind: string
  readonly item: string | null
  /** The counterparty when every row of the run names the same one. */
  readonly counterparty: string | null
  readonly status: DecisionStatus
  readonly verdict: DecisionRow['verdict']
  readonly rule: string | null
  /** Oldest first. */
  readonly rows: readonly DecisionRow[]
  readonly fromTick: number
  readonly toTick: number
  readonly minPrice: number | null
  readonly maxPrice: number | null
  readonly last: DecisionRow
}

const itemKey = (r: DecisionRow): string => `${r.kind}|${r.item ?? ''}`

const runKey = (r: DecisionRow): string => `${itemKey(r)}|${r.verdict ?? ''}|${r.rule ?? ''}|${r.status}`

function runOf(rows: DecisionRow[]): Run {
  const first = rows[0] as DecisionRow
  const last = rows.at(-1) as DecisionRow
  const prices = rows.map((r) => r.price).filter((p): p is number => p != null)
  const who = new Set(rows.map((r) => r.counterparty))
  return {
    agent: last.agent, kind: last.kind, item: last.item, counterparty: who.size === 1 ? last.counterparty : null,
    status: last.status, verdict: last.verdict, rule: last.rule, rows, fromTick: first.tick, toTick: last.tick,
    minPrice: prices.length ? Math.min(...prices) : null, maxPrice: prices.length ? Math.max(...prices) : null, last,
  }
}

/** An agent's rows (oldest first) as runs, oldest first by their last decision; a restart or a bookkeeping row is a run of its own. */
export function runsOf(rows: readonly DecisionRow[]): Run[] {
  const runs: Run[] = []
  const open = new Map<string, DecisionRow[]>()
  const close = (key: string) => {
    const run = open.get(key)
    if (run?.length) runs.push(runOf(run))
    open.delete(key)
  }
  for (const r of rows) {
    if (!isWrite(r.kind)) {
      runs.push(runOf([r]))
      continue
    }
    const key = runKey(r)
    // another verdict on the same kind and item ends that item's run
    for (const k of [...open.keys()]) if (k !== key && k.startsWith(`${itemKey(r)}|`)) close(k)
    const run = open.get(key)
    const last = run?.at(-1)
    if (run && last && r.outcome == null && last.outcome == null && r.tick - last.tick <= 1) run.push(r)
    else {
      close(key)
      open.set(key, [r])
    }
  }
  for (const k of [...open.keys()]) close(k)
  return runs.sort((a, b) => a.last.decision - b.last.decision)
}

/** Ticks in one game hour: `t_hours` grows by tick_seconds / 3600 a tick (60 s ticks: 60 a game hour). */
export const ticksPerHour = (tickSeconds: number): number => Math.max(1, Math.round(3600 / (tickSeconds > 0 ? tickSeconds : 60)))

/** The first tick of the last game hour. */
export const hourStart = (s: State): number => Math.max(0, nowTick(s) - ticksPerHour(s.tickSeconds) + 1)

export type RuleCount = { readonly rule: string; readonly count: number; readonly lastTick: number; readonly agents: AgentName[] }

export type Blocks = { readonly fromTick: number; readonly total: number; readonly rules: RuleCount[] }

/** Denials by rule id over the last game hour, most frequent first. */
export function blocksByRule(s: State): Blocks {
  const fromTick = hourStart(s)
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

export type AgentState = 'none' | 'silent' | 'quiet' | 'stuck' | 'ok'

/** One agent at a glance: alive or silent, what it last did, and what blocks it most this game hour. */
export type AgentStatus = {
  readonly agent: AgentName
  /**
   * `none`: no decision log from this source at all; `silent`: no decision for more than its SILENCE.silent ticks
   * (or never); `quiet`: for more than its SILENCE.quiet; `stuck`: deciding, but its last run is STUCK_AFTER or more
   * identical blocks; `ok` otherwise.
   */
  readonly state: AgentState
  /** Its last run of decisions (restarts left out), or null if it never decided. */
  readonly last: Run | null
  /** Ticks since its last decision. */
  readonly silentFor: number | null
  /** Its restarts this game hour, and the newest one's tick. */
  readonly restarts: number
  readonly restartedAt: number | null
  /** The rule that blocked it most this game hour. */
  readonly topBlock: { readonly rule: string; readonly count: number } | null
  /** Its blocks and decisions this game hour. */
  readonly blocks: number
  readonly decisions: number
}

export function agentStatuses(s: State): AgentStatus[] {
  const logged = hasDecisions(s)
  const now = nowTick(s)
  const from = hourStart(s)
  return AGENTS.map((agent): AgentStatus => {
    const rows = s.agents.decisions[agent]
    const last = runsOf(rows.filter((r) => isWrite(r.kind))).at(-1) ?? null
    const restarts = rows.filter(isRestart)
    const hour = rows.filter((r) => r.tick >= from && isWrite(r.kind))
    const byRule = new Map<string, number>()
    for (const r of hour) if (r.verdict === 'denied') byRule.set(r.rule ?? 'other', (byRule.get(r.rule ?? 'other') ?? 0) + 1)
    const top = [...byRule].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    const silentFor = last ? Math.max(0, now - last.toTick) : null
    const state: AgentState = !logged ? 'none'
      : silentFor == null || silentFor > SILENCE[agent].silent ? 'silent'
      : silentFor > SILENCE[agent].quiet ? 'quiet'
      : last && last.verdict === 'denied' && last.rows.length >= STUCK_AFTER ? 'stuck'
      : 'ok'
    return {
      agent, state, last, silentFor,
      restarts: restarts.filter((r) => r.tick >= from).length, restartedAt: restarts.at(-1)?.tick ?? null,
      topBlock: top ? { rule: top[0], count: top[1] } : null,
      blocks: [...byRule.values()].reduce((n, c) => n + c, 0), decisions: hour.length,
    }
  })
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
export const settled = (o: OutcomeRow): boolean => o.target !== 'dealer' || o.price != null

/**
 * Our value of a dealer fill: the latest value our agent logged for that card with that dealer up to the fill,
 * within that thread (back to its `dealer_opened`, the row before it included: `dealer_open` carries the value).
 */
function dealerValue(s: State, o: OutcomeRow): number | null {
  if (o.target !== 'dealer' || o.agent == null || o.item == null) return null
  const rows = s.agents.decisions[o.agent]
  let value: number | null = null
  let opened = false
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (!r || r.item !== o.item || r.counterparty !== o.counterparty || (o.tick != null && r.tick > o.tick)) continue
    // past the thread's start: only the open request that started it may still lend its value
    if (opened) return r.kind === 'dealer_open' ? r.value : null
    if (value == null && r.value != null) value = r.value
    if (r.kind === 'dealer_open') return value
    if (r.kind === 'dealer_opened') {
      if (value != null) return value
      opened = true
    }
  }
  // the thread's start is older than the decisions we hold: no value rather than another thread's
  return null
}

/** A scored deal against our value, from our side: positive when it beat our value. */
export function dealOf(s: State, row: OutcomeRow): Deal {
  const value = row.value ?? dealerValue(s, row)
  const edge = row.surplus ?? (value != null && row.price != null ? (row.side === 'sell' ? row.price - value : value - row.price) : null)
  return { row, value, edge, verdict: edge == null ? null : edge > 0 ? 'beat' : edge < 0 ? 'below' : 'even' }
}

/** The scored deals, newest first: did each beat our value, and was Jev right? */
export function deals(s: State, limit = 6): Deal[] {
  return [...s.agents.outcomes]
    .reverse()
    .filter(settled)
    .slice(0, limit)
    .map((row) => dealOf(s, row))
}

export type DealTally = {
  readonly good: number
  readonly ok: number
  readonly bad: number
  readonly unscored: number
  readonly jevRight: number
  readonly jevJudged: number
}

/** The scored deals we hold, by label, and how often Jev called them right. */
export function dealTally(s: State): DealTally {
  const t = { good: 0, ok: 0, bad: 0, unscored: 0, jevRight: 0, jevJudged: 0 }
  for (const o of s.agents.outcomes.filter(settled)) {
    if (o.label) t[o.label] += 1
    else t.unscored += 1
    if (o.jevRight != null) {
      t.jevJudged += 1
      if (o.jevRight) t.jevRight += 1
    }
  }
  return t
}
