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
const COLUMNS_DUEL = `kind, duel, n, session, status, role, item, rival, speaker, tick, price, days, text, final_price, final_days, updated_at`

export const SQL = {
  threadBackfill: `select * from (select ${COLUMNS_THREAD} from show.thread_lines order by event_id desc limit $1) t order by event_id asc`,
  threadAfter: `select ${COLUMNS_THREAD} from show.thread_lines where event_id > $1 order by event_id asc limit $2`,
  duelHeadersFirst: `select * from (select ${COLUMNS_DUEL} from show.duel_lines where kind in ('live', 'closed') order by updated_at desc limit $1) t order by updated_at asc`,
  duelHeadersAfter: `select ${COLUMNS_DUEL} from show.duel_lines where kind in ('live', 'closed') and updated_at >= $1::timestamptz order by updated_at asc limit $2`,
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
  /** Closed or live duels read when the server starts. */
  readonly duelBackfill?: number
  /** Duels are re-read from this long before the newest update, in case rows were written late. */
  readonly overlapMs?: number
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

const stampOf = (row: unknown): number | null => {
  const raw = typeof row === 'object' && row !== null ? (row as Record<string, unknown>).updated_at : null
  const ms = raw instanceof Date ? raw.getTime() : typeof raw === 'string' ? Date.parse(raw) : NaN
  return Number.isFinite(ms) ? ms : null
}

export class Poller {
  private readonly o: Required<Omit<PollerDeps, 'db' | 'store' | 'log'>>
  private readonly db: Db
  private readonly store: TranscriptStore
  private readonly log: (entry: Record<string, unknown>) => void
  private threadMark: number | null = null
  private duelMark: number | null = null
  private fails = 0
  private timer: unknown = null
  private stopped = true

  constructor(deps: PollerDeps) {
    this.db = deps.db
    this.store = deps.store
    this.log = deps.log
    this.o = {
      intervalMs: 3000, cap: 100, backfill: 40, duelBackfill: 20, overlapMs: 120_000, maxDelayMs: 60_000, secrets: [],
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
      : await this.db.query(SQL.threadAfter, [this.threadMark, this.o.cap])
    const ids = rows.map(idOf).filter((n): n is number => n !== null)
    if (ids.length > 0) this.threadMark = Math.max(this.threadMark ?? 0, ...ids)
    else if (this.threadMark === null) this.threadMark = 0
    this.store.add(rows.flatMap((r) => threadItem(r) ?? []))
  }

  private async readDuels(): Promise<void> {
    const headers = this.duelMark === null
      ? await this.db.query(SQL.duelHeadersFirst, [this.o.duelBackfill])
      : await this.db.query(SQL.duelHeadersAfter, [new Date(this.duelMark - this.o.overlapMs).toISOString(), this.o.cap])
    const stamps = headers.rows.map(stampOf).filter((n): n is number => n !== null)
    if (stamps.length > 0) this.duelMark = Math.max(this.duelMark ?? 0, ...stamps)
    else if (this.duelMark === null) this.duelMark = Date.now() - this.o.overlapMs
    const closed = headers.rows.flatMap((r) => (typeof r === 'object' && r !== null && (r as Record<string, unknown>).kind === 'closed' && typeof (r as Record<string, unknown>).duel === 'number' ? [(r as Record<string, unknown>).duel as number] : []))
    const messages = closed.length > 0 ? (await this.db.query(SQL.duelMessages, [closed])).rows : []
    this.store.add(duelItems(headers.rows, messages))
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
