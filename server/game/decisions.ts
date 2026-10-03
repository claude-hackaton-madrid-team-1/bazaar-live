/**
 * Our agents' decisions into the game stream: polls the three views of db/agent_decisions.sql through the
 * show's read-only pool and publishes `agent.decision`, `agent.outcome` and `agent.ledger` into the game hub
 * (shared/decisions.ts), so they reach the Agent screen behind GAME_VIEW_TOKEN like every other event.
 *
 * Same manners as the transcript poller: one small query per view, rows newer than the last seen (plus a
 * look-back over the last ids, since a decision's status and its request's answer land after its row), a
 * row cap, a backoff, and no exception ever leaves `pollOnce()`. A missing view (or a grant show.sql's
 * re-run dropped) is said once and re-checked slowly; the relay never notices.
 */
import { cleanInt, cleanItem, cleanName } from '../../shared/clean.ts'
import {
  AGENTS, DECISION_STATUSES, type AgentName, type DecisionPayload, type GuardrailLimits, type LedgerPayload, type LedgerTick, type OutcomeLabel, type OutcomePayload,
} from '../../shared/decisions.ts'
import { redact, type Db } from '../transcript/poller.ts'
import type { GameEvent } from './relay.ts'

/** GUARDRAILS.md on bazaar main, 3 Oct: `max_spend_per_game_hour` 150, `cash_floor` 50 (our venue is open, so no
 * bond reserve on top), `max_accepts_per_tick` 1. Not in the database: the GUARDRAIL_* variables follow an edit. */
export const DEFAULT_LIMITS: GuardrailLimits = { spendPerHour: 150, cashFloor: 50, acceptsPerTick: 1 }

const limit = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw)
  return raw !== undefined && raw.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 10_000_000 ? n : fallback
}

export function readLimits(env: Readonly<Record<string, string | undefined>>): GuardrailLimits {
  return {
    spendPerHour: limit(env.GUARDRAIL_SPEND_PER_HOUR, DEFAULT_LIMITS.spendPerHour),
    cashFloor: limit(env.GUARDRAIL_CASH_FLOOR, DEFAULT_LIMITS.cashFloor),
    acceptsPerTick: limit(env.GUARDRAIL_ACCEPTS_PER_TICK, DEFAULT_LIMITS.acceptsPerTick),
  }
}

const DECISION_COLUMNS = `id, tick, agent, kind, item, counterparty, price, our_value, status, verdict, rule, rule_text, jev_verdict, jev_value, exec_method, error_code, outcome_label, realized_surplus, jev_right`
const OUTCOME_COLUMNS = `target, subject, decision_id, agent, tick, item, counterparty, side, price, our_value, label, score, realized_surplus, jev_verdict, jev_right`
/** The stamp as exact microsecond text, as in the transcript poller: a JS Date would round it and the keyset skip a row. */
const STAMP = `to_char(scored_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as stamp`

export const SQL = {
  decisionsBackfill: `select * from (select ${DECISION_COLUMNS} from show.agent_decisions order by id desc limit $1) t order by id`,
  decisionsAfter: `select ${DECISION_COLUMNS} from show.agent_decisions where id > $1 order by id limit $2`,
  // The look-back: a decision is written `approved`, then settled `done` / `failed` once its request answered.
  decisionsWindow: `select ${DECISION_COLUMNS} from show.agent_decisions where id > $1 and id <= $2 order by id desc limit $3`,
  outcomesBackfill: `select * from (select ${OUTCOME_COLUMNS}, ${STAMP}, scored_at from show.agent_outcomes where scored_at is not null order by scored_at desc, target desc, subject desc limit $1) t order by scored_at, target, subject`,
  // Keyset on (scored_at, target, subject): one evals run upserts many outcomes with one now().
  outcomesAfter: `select ${OUTCOME_COLUMNS}, ${STAMP} from show.agent_outcomes where (scored_at, target, subject) > ($1::timestamptz, $2::text, $3::text) order by scored_at, target, subject limit $4`,
  ledger: `select tick, t_hours, spent, accepts, listings from show.agent_ledger where t_hours > (select max(t_hours) from show.agent_ledger) - 2 order by tick limit $1`,
} as const

/** Postgres codes for a view that is not there (yet) or not ours to read: undefined table / schema, no privilege. */
const MISSING = new Set(['42P01', '3F000', '42501'])

type Row = Readonly<Record<string, unknown>>

const isRow = (v: unknown): v is Row => typeof v === 'object' && v !== null

/** bigint arrives as a string: a positive safe integer or null. */
function idOf(v: unknown): number | null {
  const n = typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : v
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null
}

/** numeric arrives as a string: a finite number in the game's range, or null. */
function numOf(v: unknown): number | null {
  const n = typeof v === 'string' && /^-?\d{1,9}(?:\.\d{1,6})?$/.test(v) ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10_000_000 ? n : null
}

const word = (v: unknown, max: number): string | null => (typeof v === 'string' && new RegExp(`^[a-z][a-z0-9_.]{0,${max - 1}}$`).test(v) ? v : null)

const agentOf = (v: unknown): AgentName | null => ((AGENTS as readonly unknown[]).includes(v) ? (v as AgentName) : null)

const labelOf = (v: unknown): OutcomeLabel | null => (v === 'good' || v === 'ok' || v === 'bad' ? v : null)

const boolOf = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

/**
 * A denial as plain text: guardrails.check() writes `spend 140 + 20 > max_spend_per_game_hour 150`, so unlike a
 * quote it keeps `<` and `>` (the page prints it as text, never as markup, and no voice reads it).
 */
export function ruleText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const plain = v.normalize('NFC').replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ').replace(/[\p{Cf}\p{Co}\p{Cs}]/gu, '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()
  if (!plain) return null
  return plain.length <= 140 ? plain : `${plain.slice(0, 139).trimEnd()}…`
}

/** The item: a card ref or a plain name, or a duel as `duel:<id>`. */
const itemOf = (v: unknown): string | null => (typeof v === 'string' && /^duel:\d{1,9}$/.test(v) ? v : cleanItem(v))

/** A decision row → its payload, every value re-checked (the second wall after the view), or null. */
export function decisionOf(row: unknown): { tick: number; payload: DecisionPayload } | null {
  if (!isRow(row)) return null
  const decision = idOf(row.id)
  const tick = cleanInt(row.tick)
  const agent = agentOf(row.agent)
  const status = (DECISION_STATUSES as readonly unknown[]).includes(row.status) ? (row.status as DecisionPayload['status']) : null
  const kind = word(row.kind, 32)
  if (decision === null || tick === null || agent === null || status === null || kind === null) return null
  return {
    tick,
    payload: {
      decision, agent, kind, status,
      item: itemOf(row.item),
      counterparty: cleanName(row.counterparty),
      price: cleanInt(row.price),
      value: numOf(row.our_value),
      verdict: row.verdict === 'allowed' || row.verdict === 'denied' ? row.verdict : null,
      rule: row.verdict === 'denied' ? (word(row.rule, 40) ?? 'other') : null,
      text: ruleText(row.rule_text),
      jev: word(row.jev_verdict, 16),
      jevValue: numOf(row.jev_value),
      method: word(row.exec_method, 32),
      error: word(row.error_code, 48),
      outcome: labelOf(row.outcome_label),
      surplus: numOf(row.realized_surplus),
      jevRight: boolOf(row.jev_right),
    },
  }
}

export function outcomeOf(row: unknown): { tick: number | null; payload: OutcomePayload } | null {
  if (!isRow(row)) return null
  const target = row.target === 'trade' || row.target === 'dealer' || row.target === 'duel' ? row.target : null
  const subject = typeof row.subject === 'string' && /^[a-z_]{1,16}:\d{1,12}$/.test(row.subject) ? row.subject : null
  if (target === null || subject === null) return null
  return {
    tick: cleanInt(row.tick),
    payload: {
      target, subject,
      decision: idOf(row.decision_id),
      agent: agentOf(row.agent),
      item: cleanItem(row.item),
      counterparty: cleanName(row.counterparty),
      side: row.side === 'buy' || row.side === 'sell' ? row.side : null,
      price: cleanInt(row.price),
      value: numOf(row.our_value),
      label: labelOf(row.label),
      score: numOf(row.score),
      surplus: numOf(row.realized_surplus),
      jev: word(row.jev_verdict, 16),
      jevRight: boolOf(row.jev_right),
    },
  }
}

export function ledgerOf(rows: readonly unknown[], limits: GuardrailLimits): LedgerPayload {
  const ticks: LedgerTick[] = []
  for (const r of rows) {
    if (!isRow(r)) continue
    const tick = cleanInt(r.tick)
    const t = numOf(r.t_hours)
    if (tick === null || t === null) continue
    ticks.push({ tick, t, spent: numOf(r.spent) ?? 0, accepts: cleanInt(r.accepts) ?? 0, listings: cleanInt(r.listings) ?? 0 })
  }
  return { ticks, limits }
}

const STAMP_TEXT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/

interface OutcomeMark {
  readonly stamp: string
  readonly target: string
  readonly subject: string
}

const markOf = (row: unknown): OutcomeMark | null => {
  if (!isRow(row)) return null
  return typeof row.stamp === 'string' && STAMP_TEXT.test(row.stamp) && typeof row.target === 'string' && typeof row.subject === 'string'
    ? { stamp: row.stamp, target: row.target, subject: row.subject }
    : null
}

/** Where the events go: the game hub (its `publish` is the whole injection point). */
export interface Publisher {
  publish(batch: readonly GameEvent[]): void
}

export interface DecisionsPollerDeps {
  readonly db: Db
  readonly hub: Publisher
  readonly log: (entry: Record<string, unknown>) => void
  readonly limits?: GuardrailLimits
  readonly intervalMs?: number
  /** Rows per poll and per view. */
  readonly cap?: number
  /** Decisions read when the server starts. */
  readonly backfill?: number
  /** Decisions re-read under the newest id each poll, for their late status. */
  readonly idWindow?: number
  readonly outcomeBackfill?: number
  /** The wait between looks while the views are missing. */
  readonly recheckMs?: number
  readonly maxDelayMs?: number
  readonly secrets?: readonly string[]
  readonly random?: () => number
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

/**
 * Event ids of their own: feed ids are positive, the relay's made-up events count down from -1 and its duel
 * events sit just below -1e12 (duels.ts), so these count down from -2^50 (about -1.1e15), which none will reach.
 */
export const FIRST_ID = -(2 ** 50)

export class DecisionsPoller {
  private readonly o: Required<Omit<DecisionsPollerDeps, 'db' | 'hub' | 'log'>>
  private readonly deps: DecisionsPollerDeps
  private nextId = FIRST_ID
  private decisionMark: number | null = null
  /** What was last sent per decision id, so a re-read only goes out when something changed. */
  private readonly sent = new Map<number, string>()
  private outcomeMark: OutcomeMark | null = null
  private readonly outcomesSent = new Map<string, string>()
  private ledgerSent = ''
  private fails = 0
  private missing = false
  private timer: unknown = null
  private stopped = true

  constructor(deps: DecisionsPollerDeps) {
    this.deps = deps
    this.o = {
      limits: DEFAULT_LIMITS, intervalMs: 3000, cap: 200, backfill: 300, idWindow: 300, outcomeBackfill: 100, recheckMs: 60_000, maxDelayMs: 60_000,
      secrets: [], random: Math.random, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...deps,
    }
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.schedule(0)
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) this.o.clearTimer(this.timer)
    this.timer = null
  }

  /** True while the views are missing (or not granted): polling has slowed to a re-check. */
  get off(): boolean {
    return this.missing
  }

  nextDelayMs(): number {
    if (this.missing) return this.o.recheckMs
    if (this.fails === 0) return this.o.intervalMs
    const grown = this.o.intervalMs * 2 ** Math.min(this.fails, 10)
    return Math.min(this.o.maxDelayMs, Math.round(grown * (0.75 + this.o.random() * 0.5)))
  }

  private schedule(ms: number): void {
    this.timer = this.o.setTimer(() => {
      this.timer = null
      if (this.stopped) return
      void this.pollOnce().then(() => {
        if (!this.stopped) this.schedule(this.nextDelayMs())
      })
    }, ms)
  }

  private event(type: string, tick: number | null, actor: string, payload: object): GameEvent {
    const id = this.nextId
    this.nextId -= 1
    return { id, ...(tick !== null ? { tick } : {}), type, scope: 'team', actor, payload: { ...payload } }
  }

  /** One round over the three views, published as one batch. Never throws. */
  async pollOnce(): Promise<void> {
    const results = await Promise.allSettled([this.readDecisions(), this.readOutcomes(), this.readLedger()])
    const batch = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    if (batch.length > 0) this.deps.hub.publish(batch)
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (!failed) {
      if (this.missing) this.deps.log({ route: 'agent_decisions', event: 'on' })
      else if (this.fails > 0) this.deps.log({ route: 'agent_decisions', event: 'poll_recovered', after: this.fails })
      this.missing = false
      this.fails = 0
      return
    }
    const { code, message } = this.describe(failed.reason)
    if (MISSING.has(code)) {
      // Said once: the views are applied by an admin, maybe later; until then this is a slow re-check.
      if (!this.missing) this.deps.log({ route: 'agent_decisions', event: 'off', reason: 'view_missing', code, note: 'apply db/agent_decisions.sql (after db/show.sql)' })
      this.missing = true
      return
    }
    this.fails += 1
    if (this.fails === 1 || this.fails % 10 === 0) this.deps.log({ route: 'agent_decisions', event: 'poll_failed', fails: this.fails, code, message })
  }

  private async readDecisions(): Promise<GameEvent[]> {
    const db = this.deps.db
    let rows: unknown[]
    if (this.decisionMark === null) {
      rows = (await db.query(SQL.decisionsBackfill, [this.o.backfill])).rows
    } else {
      const mark = this.decisionMark
      const fresh = (await db.query(SQL.decisionsAfter, [mark, this.o.cap])).rows
      const back = (await db.query(SQL.decisionsWindow, [Math.max(0, mark - this.o.idWindow), mark, this.o.cap])).rows
      rows = [...back.reverse(), ...fresh]
    }
    const out: GameEvent[] = []
    let top = this.decisionMark ?? 0
    for (const raw of rows) {
      const d = decisionOf(raw)
      if (!d) continue
      top = Math.max(top, d.payload.decision)
      const sig = JSON.stringify(d.payload)
      if (this.sent.get(d.payload.decision) === sig) continue
      this.sent.set(d.payload.decision, sig)
      out.push(this.event('agent.decision', d.tick, d.payload.agent, d.payload))
    }
    this.decisionMark = top
    for (const id of this.sent.keys()) if (id <= top - this.o.idWindow) this.sent.delete(id)
    return out
  }

  private async readOutcomes(): Promise<GameEvent[]> {
    const rows = this.outcomeMark === null
      ? (await this.deps.db.query(SQL.outcomesBackfill, [this.o.outcomeBackfill])).rows
      : (await this.deps.db.query(SQL.outcomesAfter, [this.outcomeMark.stamp, this.outcomeMark.target, this.outcomeMark.subject, this.o.cap])).rows
    const last = rows.map(markOf).filter((m): m is OutcomeMark => m !== null).at(-1)
    if (last) this.outcomeMark = last
    else if (this.outcomeMark === null) this.outcomeMark = { stamp: '1970-01-01T00:00:00.000000Z', target: '', subject: '' }
    const out: GameEvent[] = []
    for (const raw of rows) {
      const o = outcomeOf(raw)
      if (!o) continue
      const key = `${o.payload.target}|${o.payload.subject}`
      const sig = JSON.stringify(o.payload)
      if (this.outcomesSent.get(key) === sig) continue
      this.outcomesSent.set(key, sig)
      if (this.outcomesSent.size > 2000) this.outcomesSent.delete(this.outcomesSent.keys().next().value as string)
      out.push(this.event('agent.outcome', o.tick, o.payload.agent ?? '', o.payload))
    }
    return out
  }

  private async readLedger(): Promise<GameEvent[]> {
    const ledger = ledgerOf((await this.deps.db.query(SQL.ledger, [1000])).rows, this.o.limits)
    const sig = JSON.stringify(ledger)
    if (sig === this.ledgerSent) return []
    this.ledgerSent = sig
    return [this.event('agent.ledger', ledger.ticks.at(-1)?.tick ?? null, '', ledger)]
  }

  private describe(reason: unknown): { code: string; message: string } {
    const code = typeof reason === 'object' && reason !== null && typeof (reason as { code?: unknown }).code === 'string' ? (reason as { code: string }).code : 'ERR'
    const text = reason instanceof Error ? reason.message : String(reason)
    return { code, message: redact(text, this.o.secrets).slice(0, 160) }
  }
}

export interface Decisions {
  readonly stop: () => void
}

/** Off (and says why, once) without the show's database or without the game hub; else polling. */
export function startDecisions(
  env: Readonly<Record<string, string | undefined>>,
  deps: { readonly db: Db | null; readonly hub: Publisher | null; readonly log: (entry: Record<string, unknown>) => void; readonly secrets?: readonly string[] },
): Decisions {
  const off: Decisions = { stop: () => undefined }
  if (deps.db === null) {
    deps.log({ route: 'agent_decisions', event: 'off', reason: 'no_database' })
    return off
  }
  if (deps.hub === null) {
    deps.log({ route: 'agent_decisions', event: 'off', reason: 'no_game' })
    return off
  }
  const poller = new DecisionsPoller({ db: deps.db, hub: deps.hub, log: deps.log, limits: readLimits(env), secrets: deps.secrets ?? [] })
  poller.start()
  deps.log({ route: 'agent_decisions', event: 'polling' })
  return { stop: () => poller.stop() }
}
