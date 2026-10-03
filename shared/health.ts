/**
 * Our agents' health on the game stream: the server asks the taker's and the maker's public /health
 * (bazaar src/bazaar_agent/agents/status.py) every 10 s and relays an allow-listed report as `agent.health`,
 * kept as a sticky event (a page that joins late gets the latest first; it never enters the backlog). The
 * duels agent has no HTTP: the page reads its health from its decisions alone.
 *
 * /health today: {ok, agent, mode: dry|live, target: {mode: real|simulator, url}, ledger: shared|down|local file,
 * tick, last_tick_at, doors, paused, next_opens, tick_seconds, server_tick}. The tick's duration against its
 * budget, the 429s, Jev's latency and its undecided share are read when an agent reports them (`tick_ms`,
 * `tick_budget_s`, `rate_limited`, `jev_ms`, `jev_undecided`); none does yet.
 *
 * Facts and reason keys only: the words live in the page's strings (ES/EN).
 */

export const HEALTH_AGENTS = ['taker', 'maker'] as const
export type HealthAgent = (typeof HEALTH_AGENTS)[number]

export type LedgerHealth = 'shared' | 'down' | 'local'

/** Why the server has no answer: no reply in time, a non-2xx, a body that is not /health, or no connection. */
export type HealthError = 'timeout' | 'http' | 'bad_body' | 'unreachable'

export interface HealthReport {
  readonly agent: HealthAgent
  /** When the server asked (ISO). */
  readonly checkedAt: string
  /** null: it answered, and the fields below are what it said. */
  readonly error: HealthError | null
  readonly mode: 'live' | 'dry' | null
  readonly target: 'real' | 'simulator' | null
  readonly ledger: LedgerHealth | null
  readonly tick: number | null
  readonly serverTick: number | null
  readonly lastTickAt: string | null
  /** Seconds from its last tick to the server's question, by the server's clock. */
  readonly tickAgeS: number | null
  readonly doors: 'open' | 'closed' | null
  readonly paused: boolean | null
  readonly nextOpens: string | null
  readonly tickSeconds: number | null
  /** Its last tick's duration and the budget it runs against. */
  readonly tickMs: number | null
  readonly tickBudgetS: number | null
  /** 429s from the game lately. */
  readonly rateLimited: number | null
  /** Jev's latency, and the share of its answers that were `undecided` (0 to 1). */
  readonly jevMs: number | null
  readonly jevUndecided: number | null
  /** When each reason now true was first seen in a row (ISO), kept by the server across its polls. */
  readonly since: Readonly<Partial<Record<ReasonKind, string>>>
}

export interface HealthPayload {
  readonly agents: readonly HealthReport[]
}

export type HealthTone = 'good' | 'warn' | 'bad' | 'neutral'

export type Reason =
  | { readonly kind: 'unreachable'; readonly error: HealthError }
  | { readonly kind: 'ledger_down' }
  | { readonly kind: 'no_tick'; readonly ageS: number }
  | { readonly kind: 'tick_over'; readonly usedS: number; readonly budgetS: number }
  | { readonly kind: 'dry' }
  | { readonly kind: 'paused' }
  | { readonly kind: 'tick_slow'; readonly usedS: number; readonly budgetS: number }
  | { readonly kind: 'behind'; readonly ticks: number }
  | { readonly kind: 'rate_limited'; readonly count: number }
  | { readonly kind: 'jev_slow'; readonly s: number }
  | { readonly kind: 'jev_undecided'; readonly share: number }
  | { readonly kind: 'simulator' }
  | { readonly kind: 'ledger_local' }
  | { readonly kind: 'closed'; readonly opens: string | null }

export type ReasonKind = Reason['kind']

/** Worst first: the first one that applies is the chip's reason. */
export const REASON_TONE: Readonly<Record<ReasonKind, HealthTone>> = {
  unreachable: 'bad', ledger_down: 'bad', no_tick: 'bad', tick_over: 'bad',
  dry: 'warn', paused: 'warn', tick_slow: 'warn', behind: 'warn', rate_limited: 'warn', jev_slow: 'warn', jev_undecided: 'warn',
  simulator: 'warn', ledger_local: 'warn',
  closed: 'neutral',
}

const ORDER = Object.keys(REASON_TONE) as ReasonKind[]

/** The tick budget when the agent does not say its own (the game's 15 s to act in a tick). */
export const TICK_BUDGET_S = 15
/** A tick past this share of its budget is slow. */
export const TICK_SLOW_SHARE = 0.8
/** No tick for this long (or 4 game ticks, if longer) while the doors are open: the loop is stuck. */
export const NO_TICK_S = 120
/** This many ticks behind the game's clock. */
export const BEHIND_TICKS = 3
export const JEV_SLOW_MS = 8000
export const JEV_UNDECIDED_SHARE = 0.5

const round1 = (n: number): number => Math.round(n * 10) / 10

/** Every reason that applies to one report, worst first (empty: healthy). */
export function reasons(r: HealthReport): Reason[] {
  if (r.error !== null) return [{ kind: 'unreachable', error: r.error }]
  const out: Reason[] = []
  const stopped = r.doors === 'closed' || r.paused === true
  if (r.ledger === 'down') out.push({ kind: 'ledger_down' })
  const noTickAfter = Math.max(NO_TICK_S, 4 * (r.tickSeconds ?? 0))
  if (!stopped && r.tickAgeS != null && r.tickAgeS > noTickAfter) out.push({ kind: 'no_tick', ageS: Math.round(r.tickAgeS) })
  if (r.tickMs != null) {
    const usedS = round1(r.tickMs / 1000)
    const budgetS = r.tickBudgetS ?? TICK_BUDGET_S
    if (usedS > budgetS) out.push({ kind: 'tick_over', usedS, budgetS })
    else if (usedS >= budgetS * TICK_SLOW_SHARE) out.push({ kind: 'tick_slow', usedS, budgetS })
  }
  if (r.mode === 'dry') out.push({ kind: 'dry' })
  if (r.paused === true) out.push({ kind: 'paused' })
  if (!stopped && r.tick != null && r.serverTick != null && r.serverTick - r.tick >= BEHIND_TICKS) out.push({ kind: 'behind', ticks: r.serverTick - r.tick })
  if (r.rateLimited != null && r.rateLimited > 0) out.push({ kind: 'rate_limited', count: r.rateLimited })
  if (r.jevMs != null && r.jevMs >= JEV_SLOW_MS) out.push({ kind: 'jev_slow', s: round1(r.jevMs / 1000) })
  if (r.jevUndecided != null && r.jevUndecided >= JEV_UNDECIDED_SHARE) out.push({ kind: 'jev_undecided', share: r.jevUndecided })
  if (r.target === 'simulator') out.push({ kind: 'simulator' })
  if (r.ledger === 'local') out.push({ kind: 'ledger_local' })
  if (r.doors === 'closed') out.push({ kind: 'closed', opens: r.nextOpens })
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
}

export interface HealthVerdict {
  readonly tone: HealthTone
  /** The one reason that matters (null: healthy), and since when it holds. */
  readonly reason: Reason | null
  readonly since: string | null
  /** Every reason that applies, worst first (the panel lists them). */
  readonly all: readonly Reason[]
}

export function healthVerdict(r: HealthReport): HealthVerdict {
  const all = reasons(r)
  const reason = all[0] ?? null
  return { tone: reason ? REASON_TONE[reason.kind] : 'good', reason, since: reason ? (r.since[reason.kind] ?? null) : null, all }
}
