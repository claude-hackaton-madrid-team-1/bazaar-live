/**
 * Polls the two views of db/show.sql every few seconds by watermark and feeds the store.
 *
 * Gentle on a shared database and on the server: one small query per view, a row cap per poll, a
 * backoff that grows when the database is away, and no exception ever leaves `pollOnce()`. Errors are
 * logged with their code and a redacted message, never with the connection string.
 */
import { duelItems, threadItem } from './rows.ts'
import type { TranscriptStore } from './store.ts'

/** The part of a pg pool this uses, so tests can drive a fake. */
export interface Db {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: unknown[] }>
}

const COLUMNS_THREAD = `event_id, tick, kind, thread, counterpart, speaker, item_ref, offer_maker, give_cash, want_cash, final, offer_status, price, text`
const COLUMNS_DUEL = `kind, duel, n, session, status, role, item, rival, speaker, tick, price, days, text, final_price, final_days`
/** The stamp as exact microsecond text: a JS Date would round it, and the keyset must not skip a row. */
const STAMP = `to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as stamp`

export const SQL = {
  threadBackfill: `select * from (select ${COLUMNS_THREAD} from show.thread_lines order by event_id desc limit $1) t order by event_id asc`,
  threadAfter: `select ${COLUMNS_THREAD} from show.thread_lines where event_id > $1 order by event_id asc limit $2`,
  duelHeadersFirst: `select * from (select ${COLUMNS_DUEL}, ${STAMP}, updated_at from show.duel_lines where kind = 'closed' order by updated_at desc, duel desc limit $1) t order by updated_at, duel`,
  // Keyset on (updated_at, duel): bazaar re-upserts every finished duel with one now(), so many rows share a stamp.
  duelHeadersAfter: `select ${COLUMNS_DUEL}, ${STAMP} from show.duel_lines where kind = 'closed' and (updated_at, duel) > ($1::timestamptz, $2::int) order by updated_at, duel limit $3`,
  duelMessages: `select ${COLUMNS_DUEL} from show.duel_lines where kind = 'message' and duel = any($1::int[]) order by duel, n`,
} as const

export interface PollerDeps {
  readonly db: Db
  readonly store: TranscriptStore
  readonly log: (entry: Record<string, unknown>) => void
  readonly intervalMs?: number
  /** Rows per poll and per view. */
  readonly cap?: number
  /** Thread lines read when the server starts (history for the first page). */
  readonly backfill?: number
  /** Closed duels read when the server starts. */
  readonly duelBackfill?: number
  /** Thread lines are re-read from this many ids before the newest one: the monitor writes streamed events at once and gap-fills later. */
  readonly idWindow?: number
  readonly maxDelayMs?: number
  /** Strings to cut out of any logged error text (the url, its host, its password). */
  readonly secrets?: readonly string[]
  readonly random?: () => number
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

const idOf = (row: unknown): number | null => {
  const raw = typeof row === 'object' && row !== null ? (row as Record<string, unknown>).event_id : null
  const n = typeof raw === 'string' ? Number(raw) : raw
  return typeof n === 'number' && Number.isSafeInteger(n) ? n : null
}

const STAMP_TEXT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/

/** A duel header's place in (updated_at, duel) order, or null when the row has no usable stamp. */
const keyOf = (row: unknown): DuelMark | null => {
  const r = typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {}
  return typeof r.stamp === 'string' && STAMP_TEXT.test(r.stamp) && typeof r.duel === 'number' ? { stamp: r.stamp, duel: r.duel } : null
}

interface DuelMark {
  readonly stamp: string
  readonly duel: number
}

export class Poller {
  private readonly o: Required<Omit<PollerDeps, 'db' | 'store' | 'log'>>
  private readonly db: Db
  private readonly store: TranscriptStore
  private readonly log: (entry: Record<string, unknown>) => void
  private threadMark: number | null = null
  private duelMark: DuelMark | null = null
  private fails = 0
  private timer: unknown = null
  private stopped = true

  constructor(deps: PollerDeps) {
    this.db = deps.db
    this.store = deps.store
    this.log = deps.log
    this.o = {
      intervalMs: 3000, cap: 200, backfill: 40, duelBackfill: 20, idWindow: 1000, maxDelayMs: 60_000, secrets: [],
      random: Math.random, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
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

  /** The wait before the next poll: the interval, or a growing, jittered, capped one after failures. */
  nextDelayMs(): number {
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

  /** One round over both views. Never throws. */
  async pollOnce(): Promise<void> {
    const results = await Promise.allSettled([this.readThreads(), this.readDuels()])
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (!failed) {
      if (this.fails > 0) this.log({ route: 'transcript', event: 'poll_recovered', after: this.fails })
      this.fails = 0
      return
    }
    this.fails += 1
    if (this.fails === 1 || this.fails % 10 === 0) {
      this.log({ route: 'transcript', event: 'poll_failed', fails: this.fails, ...this.describe(failed.reason) })
    }
  }

  private async readThreads(): Promise<void> {
    const { rows } = this.threadMark === null
      ? await this.db.query(SQL.threadBackfill, [this.o.backfill])
      : await this.db.query(SQL.threadAfter, [Math.max(0, this.threadMark - this.o.idWindow), this.o.cap])
    const ids = rows.map(idOf).filter((n): n is number => n !== null)
    if (ids.length > 0) this.threadMark = Math.max(this.threadMark ?? 0, ...ids)
    else if (this.threadMark === null) this.threadMark = 0
    this.store.add(rows.flatMap((r) => threadItem(r) ?? []))
  }

  private async readDuels(): Promise<void> {
    const headers = this.duelMark === null
      ? await this.db.query(SQL.duelHeadersFirst, [this.o.duelBackfill])
      : await this.db.query(SQL.duelHeadersAfter, [this.duelMark.stamp, this.duelMark.duel, this.o.cap])
    // Rows come in (updated_at, duel) order, so the last one is the new mark.
    const last = headers.rows.map(keyOf).filter((k): k is DuelMark => k !== null).at(-1)
    if (last) this.duelMark = last
    else if (this.duelMark === null) this.duelMark = { stamp: '1970-01-01T00:00:00.000000Z', duel: 0 }
    // A duel already shown is not read again (bazaar re-stamps every finished duel each cycle).
    const fresh = headers.rows.filter((r) => {
      const duel = typeof r === 'object' && r !== null ? (r as Record<string, unknown>).duel : null
      return typeof duel === 'number' && !this.store.has(`dc:${duel}`)
    })
    const ids = fresh.map((r) => (r as Record<string, unknown>).duel as number)
    const messages = ids.length > 0 ? (await this.db.query(SQL.duelMessages, [ids])).rows : []
    this.store.add(duelItems(fresh, messages))
  }

  private describe(reason: unknown): { code: string; message: string } {
    const code = typeof reason === 'object' && reason !== null && typeof (reason as { code?: unknown }).code === 'string' ? (reason as { code: string }).code : 'ERR'
    const text = reason instanceof Error ? reason.message : String(reason)
    return { code, message: redact(text, this.o.secrets).slice(0, 160) }
  }
}

/** Cut known secrets and anything shaped like a url out of an error text before it is logged. */
export function redact(text: string, secrets: readonly string[]): string {
  const known = [...secrets].filter((s) => s.length > 2).sort((a, b) => b.length - a.length)
  const without = known.reduce((acc, secret) => acc.split(secret).join('[redacted]'), text)
  return without.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[redacted-url]')
}
