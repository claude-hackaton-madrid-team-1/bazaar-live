/**
 * Reads db/history.sql's six views and db/teams_score.sql's one every few seconds and keeps the last snapshot in memory for
 * GET /api/history. It reads on the server's one shared pool (the reader role has a connection limit of
 * 4), and its capped queries run one after the other. Like the learn poller: a view not applied yet (42P01)
 * or not granted (42501) only blanks its part, logged once; any other error keeps the last good part and
 * backs off; no exception leaves `pollOnce()`; error text is redacted.
 */
import { EMPTY_HISTORY, type HistoryParts, type HistorySnapshot } from '../../shared/history.ts'
import { parseAll } from '../learn/rows.ts'
import type { Db } from '../transcript/poller.ts'
import { orderOf, pointOf, scoreMarkOf, scorePointOf, teamEventOf, teamScoreOf, tradeOf } from './rows.ts'

// newest first, capped, then put back in time order; day::text so a date never becomes a local midnight
export const SQL = {
  points: `select * from (select day::text as day, tick, cash, score, rank from show.cash_points order by day desc, tick desc limit $1) p order by day, tick`,
  trades: `select id, day::text as day, tick, venue, side, counterparty, card, card_name, rarity, items, price, fee
             from show.our_trades order by day desc, tick desc, id desc limit $1`,
  orders: `select id, day::text as day, kind, tick, price, item, agent, offer, offer_side, offer_card, offer_venue, offer_expires, offer_status
             from show.our_orders order by id desc limit $1`,
  events: `select id, day::text as day, tick, type, venue, name, bond, pack, best, cash, level, why
             from show.our_events order by day desc, tick desc, id desc limit $1`,
  scores: `select * from (select day::text as day, tick, read_at, cash, score, duel, ladder, neg, mm, bench from show.score_points order by day desc, tick desc limit $1) p order by day, tick`,
  marks: `select kind, id, day::text as day, tick, agent, action, note, at from show.score_marks order by day desc, tick desc limit $1`,
  board: `select * from (select day::text as day, tick, team, rank, score, negotiating, market, level, pages, deals, read_at
             from show.team_scores order by day desc, tick desc, team limit $1) b order by day, tick, team`,
} as const

/** board: about 700 reads for 18 teams by Saturday evening (a read is kept only when it moved): room for a long day. */
export const CAPS = { points: 2000, trades: 500, orders: 500, events: 200, scores: 2000, marks: 300, board: 6000 } as const

/**
 * What a part reads while its view predates this code (db/history.sql not re-applied yet: 42703, an undefined
 * column): the columns it had, so the screen keeps its rows. The new query is tried again every LEGACY_RETRY reads.
 */
export const LEGACY_SQL: Partial<Record<keyof typeof SQL, string>> = {
  orders: `select id, day::text as day, kind, tick, price, item, agent from show.our_orders order by id desc limit $1`,
}
export const LEGACY_RETRY = 60

type Part = keyof HistoryParts

export interface HistoryPollerDeps {
  readonly db: Db
  readonly log: (entry: Record<string, unknown>) => void
  readonly intervalMs?: number
  readonly maxDelayMs?: number
  readonly secrets?: readonly string[]
  readonly now?: () => Date
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'ERR'
}

export class HistoryPoller {
  private snapshot: HistorySnapshot = EMPTY_HISTORY
  private readonly missingLogged = new Set<Part>()
  /** Parts read with LEGACY_SQL, and how many reads before the new query is tried again. */
  private readonly legacy = new Map<Part, number>()
  private failures = 0
  private timer: unknown = null
  private running = false
  private polling = false
  private again = false
  /** The last read's content (its time left out): a read that finds the same rows changes nothing. */
  private signature = ''
  private readonly listeners = new Set<(at: string) => void>()
  private readonly deps: HistoryPollerDeps
  private readonly intervalMs: number
  private readonly maxDelayMs: number

  constructor(deps: HistoryPollerDeps) {
    this.deps = deps
    this.intervalMs = deps.intervalMs ?? 5_000
    this.maxDelayMs = deps.maxDelayMs ?? 120_000
  }

  current(): HistorySnapshot {
    return this.snapshot
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  stop(): void {
    this.running = false
    this.clearTimer()
  }

  /**
   * Read now rather than at the timer's next turn (an agent's socket said something moved). While a read is
   * running, one more follows it; while stopped or backing off after a failure, nothing: the backoff holds.
   * True when a read is coming.
   */
  poke(): boolean {
    if (!this.running || this.failures > 0) return false
    if (this.polling) {
      this.again = true
      return true
    }
    this.clearTimer()
    void this.loop()
    return true
  }

  /** Called with the read's time after each read whose rows differ from the one before. */
  onChange(listener: (at: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private clearTimer(): void {
    if (this.timer !== null) (this.deps.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>)
    this.timer = null
  }

  private async loop(): Promise<void> {
    if (!this.running) return
    this.polling = true
    await this.pollOnce()
    this.polling = false
    const again = this.again && this.failures === 0
    this.again = false
    if (!this.running) return
    if (again) return this.loop()
    const delay = this.failures === 0 ? this.intervalMs : Math.min(this.maxDelayMs, this.intervalMs * 2 ** this.failures)
    this.timer = (this.deps.setTimer ?? setTimeout)(() => {
      this.timer = null
      void this.loop()
    }, delay)
  }

  private changed(): void {
    const { at, ...rows } = this.snapshot
    const signature = JSON.stringify(rows)
    if (signature === this.signature || at === null) return
    this.signature = signature
    for (const l of this.listeners) {
      try {
        l(at)
      } catch (error: unknown) {
        this.deps.log({ route: 'history', event: 'listener_failed', message: error instanceof Error ? error.name : 'ERR' })
      }
    }
  }

  /** One read of the six views. Never throws. */
  async pollOnce(): Promise<void> {
    const prev = this.snapshot
    const parts: Record<Part, boolean> = { ...prev.parts }
    let failed = false
    const read = async <T>(part: Part, parse: (raw: unknown) => T | null, keep: readonly T[]): Promise<readonly T[]> => {
      const left = this.legacy.get(part)
      if (left !== undefined) this.legacy.set(part, left - 1)
      const old = left !== undefined && left > 0 ? LEGACY_SQL[part] : undefined
      try {
        const { rows } = await this.deps.db.query(old ?? SQL[part], [CAPS[part]])
        if (old === undefined) this.legacy.delete(part)
        parts[part] = true
        this.missingLogged.delete(part)
        return parseAll(rows, parse)
      } catch (error: unknown) {
        const code = codeOf(error)
        const fallback = LEGACY_SQL[part]
        if (code === '42703' && old === undefined && fallback !== undefined) {
          if (left === undefined) this.deps.log({ route: 'history', event: 'view_outdated', part, code, note: 'apply db/history.sql; reading its older columns' })
          this.legacy.set(part, LEGACY_RETRY)
          return read(part, parse, keep)
        }
        if (code === '42P01' || code === '42501') {
          parts[part] = false
          if (!this.missingLogged.has(part)) this.deps.log({ route: 'history', event: 'view_missing', part, code })
          this.missingLogged.add(part)
          return []
        }
        failed = true
        this.deps.log({ route: 'history', event: 'poll_error', part, code, message: this.redact(error) })
        return keep
      }
    }
    const points = await read('points', pointOf, prev.points)
    const trades = await read('trades', tradeOf, prev.trades)
    const orders = await read('orders', orderOf, prev.orders)
    const events = await read('events', teamEventOf, prev.events)
    const scores = await read('scores', scorePointOf, prev.scores)
    const marks = await read('marks', scoreMarkOf, prev.marks)
    const board = await read('board', teamScoreOf, prev.board)
    this.failures = failed ? this.failures + 1 : 0
    this.snapshot = { at: failed ? prev.at : (this.deps.now ?? (() => new Date()))().toISOString(), parts, points, trades, orders, events, scores, marks, board }
    this.changed()
  }

  private redact(error: unknown): string {
    let text = error instanceof Error ? error.message : String(error)
    for (const s of this.deps.secrets ?? []) if (s) text = text.split(s).join('***')
    return text.slice(0, 200)
  }
}
