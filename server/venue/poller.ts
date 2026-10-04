/**
 * Reads db/venue.sql's six views every few seconds and keeps the last snapshot in memory for GET /api/venue. Like the
 * strategy poller: on the server's one shared pool (the reader role has a connection limit), one capped query after the
 * other; a view not applied yet (42P01) or not granted (42501) only blanks its part, logged once; any other error keeps
 * the last good part and backs off; no exception leaves `pollOnce()`; error text is redacted. `poke()` reads now (a
 * Market Test started, an agent's socket said something moved); `onChange` hears when a read's rows differ.
 */
import { EMPTY_VENUE, type VenueParts, type VenueSnapshot } from '../../shared/venue.ts'
import { parseAll } from '../learn/rows.ts'
import type { Db } from '../transcript/poller.ts'
import { bookOf, matchOf, scoreOf, sessionOf, tradeOf, venueOf } from './rows.ts'

export const SQL = {
  venues: 'select venue, name, mechanism, fee_bps, fee_per_card, status, opened_tick, current, counted from show.venue_ours order by venue limit $1',
  sessions: `select * from (select id, day::text as day, session, start_tick, ticks, venues, ours, received_at
                              from show.venue_sessions order by id desc limit $1) s order by id`,
  books: `select * from (select run, day::text as day, first_tick, last_tick, ticks_seen, venue, fee_bps, fee_per_card, session, start_tick, offers
                           from show.venue_books order by day desc nulls last, first_tick desc limit $1) b order by day nulls first, first_tick`,
  matches: `select id, tick, kind, status, bench, run, card, ask, bid, price, fee, surplus, guardrail, error_code
              from show.venue_matches order by id desc limit $1`,
  trades: `select id, day::text as day, tick, type, venue, card, price, fee, side, maker, buyer, seller
             from show.venue_trades order by id desc limit $1`,
  score: `select * from (select day::text as day, tick, read_at, venue, bench_venue, bench_efficiency, bench_points, mm_points, market
                           from show.venue_score order by day desc, tick desc limit $1) s order by day, tick`,
} as const

/** Three days of sessions (12 a day) and books with room; up to 15 matches a tick for 16 ticks a session. */
export const CAPS = { venues: 10, sessions: 60, books: 60, matches: 1500, trades: 400, score: 1500 } as const

type Part = keyof VenueParts

export interface VenuePollerDeps {
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

export class VenuePoller {
  private snapshot: VenueSnapshot = EMPTY_VENUE
  private readonly missingLogged = new Set<Part>()
  private failures = 0
  private timer: unknown = null
  private running = false
  private reading = false
  private readonly listeners = new Set<(at: string) => void>()
  private readonly deps: VenuePollerDeps
  private readonly intervalMs: number
  private readonly maxDelayMs: number

  constructor(deps: VenuePollerDeps) {
    this.deps = deps
    this.intervalMs = deps.intervalMs ?? 5_000
    this.maxDelayMs = deps.maxDelayMs ?? 120_000
  }

  current(): VenueSnapshot {
    return this.snapshot
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  stop(): void {
    this.running = false
    if (this.timer !== null) (this.deps.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>)
    this.timer = null
  }

  /** Reads now instead of at the next interval; false when stopped or already reading. */
  poke(): boolean {
    if (!this.running || this.reading) return false
    if (this.timer !== null) (this.deps.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>)
    this.timer = null
    void this.loop()
    return true
  }

  /** Called with the read's time whenever a read's rows differ from the last ones. Returns the unsubscribe. */
  onChange(listener: (at: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async loop(): Promise<void> {
    if (!this.running || this.reading) return
    this.reading = true
    try {
      await this.pollOnce()
    } finally {
      this.reading = false
    }
    if (!this.running) return
    const delay = this.failures === 0 ? this.intervalMs : Math.min(this.maxDelayMs, this.intervalMs * 2 ** this.failures)
    this.timer = (this.deps.setTimer ?? setTimeout)(() => void this.loop(), delay)
  }

  /** One read of the six views. Never throws. */
  async pollOnce(): Promise<void> {
    const prev = this.snapshot
    const parts: Record<Part, boolean> = { ...prev.parts }
    let failed = false
    const read = async <T>(part: Part, parse: (raw: unknown) => T | null, keep: readonly T[]): Promise<readonly T[]> => {
      try {
        const { rows } = await this.deps.db.query(SQL[part], [CAPS[part]])
        parts[part] = true
        this.missingLogged.delete(part)
        return parseAll(rows, parse)
      } catch (error: unknown) {
        const code = codeOf(error)
        if (code === '42P01' || code === '42501') {
          parts[part] = false
          if (!this.missingLogged.has(part)) this.deps.log({ route: 'venue', event: 'view_missing', part, code })
          this.missingLogged.add(part)
          return []
        }
        failed = true
        this.deps.log({ route: 'venue', event: 'poll_error', part, code, message: this.redact(error) })
        return keep
      }
    }
    const venues = await read('venues', venueOf, prev.venues)
    const sessions = await read('sessions', sessionOf, prev.sessions)
    const books = await read('books', bookOf, prev.books)
    const matches = await read('matches', matchOf, prev.matches)
    const trades = await read('trades', tradeOf, prev.trades)
    const score = await read('score', scoreOf, prev.score)
    this.failures = failed ? this.failures + 1 : 0
    const at = failed ? prev.at : (this.deps.now ?? (() => new Date()))().toISOString()
    const next = { parts, venues, sessions, books, matches, trades, score }
    const changed = JSON.stringify(next) !== JSON.stringify({ parts: prev.parts, venues: prev.venues, sessions: prev.sessions, books: prev.books, matches: prev.matches, trades: prev.trades, score: prev.score })
    this.snapshot = { at, ...next }
    if (changed && at) for (const listener of this.listeners) listener(at)
  }

  private redact(error: unknown): string {
    let text = error instanceof Error ? error.message : String(error)
    for (const s of this.deps.secrets ?? []) if (s) text = text.split(s).join('***')
    return text.slice(0, 200)
  }
}
