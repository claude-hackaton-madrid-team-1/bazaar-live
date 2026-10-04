/**
 * The game screens fed from our own database (db/game.sql's views, on the show's read-only pool) instead of
 * the game's API: the agents already record the feed, our /me and our duels there, so the page needs no
 * team key and spends none of its rate.
 *
 * Every few seconds, only what is newer than last time: feed rows by id, the /me snapshot by read_at, duels
 * by (updated_at, duel). Each poll publishes into the SAME hub, in the SAME shapes as `./relay.ts`: `clock`
 * (when the tick moved), `agent.hello` (when the team is new), `agent.me` (allow-listed again, `./me.ts`),
 * the duel events not sent before (`./duels.ts`), then the feed rows unchanged, oldest first. The first poll
 * replays a bounded window (the newest feed rows and duels). No exception ever leaves `pollOnce()`; the
 * views missing (db/game.sql not applied) is reported once, through `onMissing`, and the source stops.
 *
 * Our open board offers are not left to that window (an offer listed before it, still open, would vanish after a
 * restart, and a page opened later only gets the hub's backlog): each poll also reads them all from
 * show.game_our_offers and publishes them as one sticky status, `offers.ours`, when they changed. That view coming
 * later than this code (an older db/game.sql) only turns that part off for a while, never the source.
 */
import type { Db } from '../transcript/poller.ts'
import { redact } from '../transcript/poller.ts'
import { duelEvents } from './duels.ts'
import { projectMe } from './me.ts'
import type { GameEvent, GameHub, Payload } from './relay.ts'

const FEED_COLUMNS = 'id, tick, type, actor, payload'
const DUEL_COLUMNS = 'duel, session, tick, status, role, item, rival, deadline_tick, price, days, messages, your_limit, rounds, decay_per_round, result'
/** Exact microsecond text: a JS Date would round it, and the keyset must not skip a row. */
const stampOf = (column: string): string => `to_char(${column} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as stamp`

export const DB_SQL = {
  feedFirst: `select * from (select ${FEED_COLUMNS} from show.game_feed order by id desc limit $1) t order by id`,
  quotes: `select ${FEED_COLUMNS} from show.game_feed where id = any($1::int[]) and type = 'thread.message' order by id`,
  feedAfter: `select ${FEED_COLUMNS} from show.game_feed where id > $1 order by id limit $2`,
  /** The day's name is in the round's opening event, usually far behind the replay window. */
  day: `select ${FEED_COLUMNS} from show.game_feed where type in ('round.started', 'day.opened') order by id desc limit 1`,
  meFirst: `select tick, tick_seconds, me, ${stampOf('read_at')} from show.game_me order by read_at desc limit 1`,
  meAfter: `select tick, tick_seconds, me, ${stampOf('read_at')} from show.game_me where read_at > $1::timestamptz order by read_at desc limit 1`,
  duelsFirst: `select * from (select ${DUEL_COLUMNS}, ${stampOf('updated_at')}, updated_at from show.game_duels order by updated_at desc, duel desc limit $1) t order by updated_at, duel`,
  // Keyset on (updated_at, duel): the agents re-upsert every duel with one now(), so many rows share a stamp.
  duelsAfter: `select ${DUEL_COLUMNS}, ${stampOf('updated_at')} from show.game_duels where (updated_at, duel) > ($1::timestamptz, $2::int) order by updated_at, duel limit $3`,
  /** Every board offer of ours still open, however old its listing: the listing row as the feed has it, and whether it was posted by hand. */
  ours: `select ${FEED_COLUMNS}, hand from show.game_our_offers where status = 'open' order by id limit $1`,
} as const

/** The made-up ids of `offers.ours`: below the relay's, the decisions', the health's and the pages' own ranges. */
export const FIRST_OURS_ID = -(2 ** 49)

/** One open offer of ours in `offers.ours`: its listing row (an `offer.listed` event's fields) and whether it was posted by hand. */
export interface OurOfferRow {
  readonly id: number
  readonly tick: number | null
  readonly actor: string
  readonly payload: Payload
  readonly hand: boolean
}

/** `show.game_our_offers` rows → `offers.ours`' list: only listings with an offer id, never more than the row carries. */
export function ourOfferRows(rows: readonly unknown[]): OurOfferRow[] {
  return rows.flatMap((raw) => {
    const e = feedRowEvent(raw)
    if (e === null || e.type !== 'offer.listed' || !isRecord(e.payload.offer) || intOf(e.payload.offer.id) === null) return []
    return [{ id: e.id, tick: e.tick ?? null, actor: e.actor ?? '', payload: e.payload, hand: isRecord(raw) && raw.hand === true }]
  })
}

const isRecord = (v: unknown): v is Payload => typeof v === 'object' && v !== null && !Array.isArray(v)

/** pg hands bigint (and some numerics) over as text. */
const intOf = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isSafeInteger(n) ? n : null
}

const numOf = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

const STAMP_TEXT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/

const stamp = (row: Payload): string | null => (typeof row.stamp === 'string' && STAMP_TEXT.test(row.stamp) ? row.stamp : null)

/** A `show.game_feed` row as the stream's event, or null for a row it cannot carry. */
export function feedRowEvent(row: unknown): GameEvent | null {
  if (!isRecord(row)) return null
  const id = intOf(row.id)
  if (id === null || id < 0 || typeof row.type !== 'string') return null
  const tick = intOf(row.tick)
  return {
    id, ...(tick === null ? {} : { tick }), type: row.type, scope: 'public',
    actor: typeof row.actor === 'string' ? row.actor : '', payload: isRecord(row.payload) ? row.payload : {},
  }
}

/** The day's name out of a `round.started` ("Saturday · Gran Vía") or `day.opened` ("Saturday") row. */
export function dayOf(row: unknown): string | null {
  const e = feedRowEvent(row)
  if (e === null || (e.type !== 'round.started' && e.type !== 'day.opened')) return null
  return typeof e.payload.name === 'string' ? e.payload.name : null
}

export interface MeRow {
  readonly tick: number | null
  readonly tickSeconds: number | null
  readonly me: Payload
  readonly stamp: string | null
}

/** A `show.game_me` row, with the projection applied again (the page never gets more than ./me.ts allows). */
export function meRow(row: unknown): MeRow | null {
  if (!isRecord(row) || !isRecord(row.me)) return null
  return { tick: intOf(row.tick), tickSeconds: numOf(row.tick_seconds), me: projectMe(row.me), stamp: stamp(row) }
}

/** `show.game_duels` rows as `./duels.ts` reads `/api/duels`: the result is our gain (a number, as the real game's), never points. */
export function duelRowEvents(rows: readonly unknown[], team: string, limit: number): GameEvent[] {
  const duels = rows.filter(isRecord).map((r) => ({
    duel: intOf(r.duel), session: intOf(r.session), tick: intOf(r.tick), item: r.item, role: r.role, rival: r.rival, status: r.status, deadline_tick: intOf(r.deadline_tick), price: numOf(r.price), days: numOf(r.days),
    messages: Array.isArray(r.messages) ? r.messages : [], your_limit: numOf(r.your_limit), rounds: intOf(r.rounds), decay_per_round: numOf(r.decay_per_round), result: numOf(r.result),
  }))
  return duelEvents({ duels }, team, limit).map((e) => ({ id: e.id, ...(e.tick === null ? {} : { tick: e.tick }), type: e.type, scope: 'team', actor: '', payload: e.payload }))
}

/**
 * The error the views' absence (or a missing grant) raises: db/game.sql is not applied. An undefined column (42703)
 * counts too: the view predates this code (db/game.sql not re-applied since a column was added).
 */
export const isMissingViews = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code
  return code === '42P01' || code === '42501' || code === '3F000' || code === '42703'
}

export interface DbSourceDeps {
  readonly db: Db
  readonly hub: GameHub
  readonly log: (entry: Record<string, unknown>) => void
  /** Called once when the views are not there (db/game.sql not applied): the caller falls back to the API. */
  readonly onMissing?: () => void
  readonly intervalMs?: number
  /** Feed rows replayed on the first poll. */
  readonly feedBackfill?: number
  /** Feed rows per later poll. */
  readonly cap?: number
  /** Duels replayed on the first poll, and read per later poll. */
  readonly duelLimit?: number
  /** Our open board offers read per poll. */
  readonly oursLimit?: number
  /** Polls to wait before trying show.game_our_offers again once it turned out missing. */
  readonly oursRetryPolls?: number
  readonly maxDelayMs?: number
  readonly secrets?: readonly string[]
  readonly random?: () => number
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

export class GameDbSource {
  private readonly o: Required<Omit<DbSourceDeps, 'db' | 'hub' | 'log' | 'onMissing'>>
  private readonly deps: DbSourceDeps
  private feedMark: number | null = null
  private readonly missingQuotes = new Map<number, number>()
  private meMark: string | null = null
  private duelMark: { stamp: string; duel: number } | null = null
  private readonly duelsSeen = new Set<number>()
  private team: string | null = null
  private tick: number | null = null
  private day = ''
  private tickSeconds: number | null = null
  private clockSent = false
  /** Made-up events (clock, hello, me) count down from -1, as the relay's do. */
  private nextMadeUp = -1
  private fails = 0
  private timer: unknown = null
  private stopped = true
  private missing = false
  private polling = false
  private again = false
  /** What `offers.ours` last said, and how many polls to skip it for while its view is missing. */
  private oursSent = ''
  private oursSkip = 0
  private oursFails = 0
  private nextOurs = FIRST_OURS_ID

  constructor(deps: DbSourceDeps) {
    this.deps = deps
    this.o = {
      intervalMs: 3000, feedBackfill: 2000, cap: 500, duelLimit: 50, oursLimit: 200, oursRetryPolls: 100, maxDelayMs: 60_000, secrets: [],
      random: Math.random, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...deps,
    }
  }

  start(): void {
    if (!this.stopped || this.missing) return
    this.stopped = false
    this.schedule(0)
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) this.o.clearTimer(this.timer)
    this.timer = null
  }

  /**
   * Read now rather than at the timer's next turn (an agent's socket said something moved). While a read is
   * running, one more follows it; while stopped, missing or backing off after a failure, nothing: the backoff
   * holds. True when a read is coming.
   */
  poke(): boolean {
    if (this.stopped || this.missing || this.fails > 0) return false
    if (this.polling) {
      this.again = true
      return true
    }
    if (this.timer !== null) this.o.clearTimer(this.timer)
    this.schedule(0)
    return true
  }

  /** True once the views turned out to be missing: the source stays stopped. */
  get viewsMissing(): boolean {
    return this.missing
  }

  nextDelayMs(): number {
    if (this.fails === 0) return this.o.intervalMs
    const grown = this.o.intervalMs * 2 ** Math.min(this.fails, 10)
    return Math.min(this.o.maxDelayMs, Math.round(grown * (0.75 + this.o.random() * 0.5)))
  }

  private schedule(ms: number): void {
    this.timer = this.o.setTimer(() => {
      this.timer = null
      if (this.stopped) return
      this.polling = true
      void this.pollOnce().then(() => {
        this.polling = false
        const again = this.again && this.fails === 0
        this.again = false
        if (!this.stopped) this.schedule(again ? 0 : this.nextDelayMs())
      })
    }, ms)
  }

  private madeUp(type: string, payload: Payload): GameEvent {
    const id = this.nextMadeUp
    this.nextMadeUp -= 1
    return { id, tick: this.tick ?? 0, type, scope: 'team', actor: '', payload }
  }

  private async readFeed(): Promise<GameEvent[]> {
    const first = this.feedMark === null
    const { rows } = first
      ? await this.deps.db.query(DB_SQL.feedFirst, [this.o.feedBackfill])
      : await this.deps.db.query(DB_SQL.feedAfter, [this.feedMark, this.o.cap])
    if (first) {
      const { rows: day } = await this.deps.db.query(DB_SQL.day)
      this.day = dayOf(day[0]) ?? this.day
    }
    const events = rows.map(feedRowEvent).filter((e): e is GameEvent => e !== null && (this.feedMark === null || e.id > this.feedMark))
    for (const e of events) {
      this.feedMark = Math.max(this.feedMark ?? 0, e.id)
      this.day = dayOf(e) ?? this.day
    }
    if (first && this.feedMark === null) this.feedMark = 0

    return events
  }

  /** Late acknowledged words reuse the same DB relay; bounded by recent game ticks and IDs. */
  private async refreshQuotes(events: GameEvent[]): Promise<void> {
    for (const e of events) {
      if (this.team && e.type === 'thread.message' && e.payload.sender === this.team && !e.payload.text && typeof e.tick === 'number') this.missingQuotes.set(e.id, e.tick)
    }
    while (this.missingQuotes.size > 100) this.missingQuotes.delete(this.missingQuotes.keys().next().value ?? -1)
    for (const [id, tick] of this.missingQuotes) if (this.tick !== null && tick < this.tick - 8) this.missingQuotes.delete(id)
    if (this.missingQuotes.size) {
      const { rows: quotes } = await this.deps.db.query(DB_SQL.quotes, [[...this.missingQuotes.keys()]])
      for (const raw of quotes) {
        const e = feedRowEvent(raw)
        if (!e || !this.missingQuotes.has(e.id) || e.payload.sender !== this.team || typeof e.payload.text !== 'string' || !e.payload.text.trim()) continue
        this.missingQuotes.delete(e.id)
        events.push({ ...this.madeUp('thread.message.quote', { ...e.payload, feed_id: e.id }), tick: e.tick })
      }
    }
  }

  private async readMe(): Promise<MeRow | null> {
    const { rows } = this.meMark === null ? await this.deps.db.query(DB_SQL.meFirst) : await this.deps.db.query(DB_SQL.meAfter, [this.meMark])
    const me = meRow(rows[0])
    if (me?.stamp) this.meMark = me.stamp
    return me
  }

  private async readDuels(): Promise<unknown[]> {
    const mark = this.duelMark
    const { rows } = mark === null
      ? await this.deps.db.query(DB_SQL.duelsFirst, [this.o.duelLimit])
      : await this.deps.db.query(DB_SQL.duelsAfter, [mark.stamp, mark.duel, this.o.duelLimit])
    for (const r of rows) {
      if (!isRecord(r)) continue
      const s = stamp(r)
      const duel = intOf(r.duel)
      if (s !== null && duel !== null) this.duelMark = { stamp: s, duel }
    }
    return rows
  }

  /**
   * Our open board offers, all of them, as one sticky status sent again when they or the tick changed (the hub replays it after
   * its backlog, so a page opened late gets it after the older listings). Its own failures stay here: the source goes on.
   */
  private async publishOurs(): Promise<void> {
    if (this.oursSkip > 0) {
      this.oursSkip -= 1
      return
    }
    try {
      const { rows } = await this.deps.db.query(DB_SQL.ours, [this.o.oursLimit])
      this.oursFails = 0
      const offers = ourOfferRows(rows)
      // with the tick: once a tick at least, so a page that guessed one of ours away (a fill the feed does not name) gets it back
      const sig = JSON.stringify([this.tick, offers])
      if (sig === this.oursSent) return
      this.oursSent = sig
      const id = this.nextOurs
      this.nextOurs -= 1
      this.deps.hub.publishStatus({ id, tick: this.tick ?? 0, type: 'offers.ours', scope: 'team', actor: '', payload: { offers } })
    } catch (error: unknown) {
      const code = (error as { code?: unknown } | null)?.code
      if (isMissingViews(error)) {
        if (this.oursSkip === 0 && this.oursFails === 0) this.deps.log({ route: 'game', event: 'db_our_offers_missing', code, note: 'apply db/game.sql; our older open offers wait for it' })
        this.oursFails += 1
        this.oursSkip = this.o.oursRetryPolls
        return
      }
      this.oursFails += 1
      if (this.oursFails === 1 || this.oursFails % 10 === 0) {
        const text = error instanceof Error ? error.message : String(error)
        this.deps.log({ route: 'game', event: 'db_our_offers_failed', fails: this.oursFails, code: typeof code === 'string' ? code : 'ERR', message: redact(text, this.o.secrets).slice(0, 160) })
      }
    }
  }

  /** One poll. Never throws. */
  async pollOnce(): Promise<void> {
    if (this.missing) return
    try {
      const feed = await this.readFeed()
      const me = await this.readMe()
      const duelRows = await this.readDuels()
      const out: GameEvent[] = []
      const feedTick = feed.reduce<number | null>((m, e) => (typeof e.tick === 'number' ? Math.max(m ?? e.tick, e.tick) : m), null)
      const tick = [this.tick, feedTick, me?.tick ?? null].reduce<number | null>((m, t) => (t === null ? m : Math.max(m ?? t, t)), null)
      if (me?.tickSeconds != null) this.tickSeconds = me.tickSeconds
      if (tick !== this.tick || !this.clockSent) {
        this.tick = tick
        out.push(this.madeUp('clock', { day: this.day, tick_seconds: this.tickSeconds, next_tick_in: null }))
        this.clockSent = true
      }
      if (me !== null) {
        const team = typeof me.me.id === 'string' ? me.me.id : null
        if (team !== null && team !== this.team) {
          out.push(this.madeUp('agent.hello', { team, name: me.me.name ?? null }))
          this.team = team
        }
        out.push(this.madeUp('agent.me', me.me))
      }
      await this.refreshQuotes(feed)
      // Our duels go before the feed: a public `duel.closed` of ours then finds its duel already known.
      const duels = this.team === null ? [] : duelRowEvents(duelRows, this.team, this.o.duelLimit)
        .filter((e) => !this.duelsSeen.has(e.id))
        .map((e) => (e.tick === undefined ? { ...e, tick: this.tick ?? 0 } : e))
      for (const e of duels) this.duelsSeen.add(e.id)
      this.deps.hub.publish([...out, ...duels, ...feed])
      if (this.fails > 0) this.deps.log({ route: 'game', event: 'db_poll_recovered', after: this.fails })
      this.fails = 0
    } catch (error: unknown) {
      this.failed(error)
      return
    }
    // After the feed: the view reads the same table, so it knows every listing the batch above carried.
    await this.publishOurs()
  }

  private failed(error: unknown): void {
    const code = (error as { code?: unknown } | null)?.code
    if (isMissingViews(error)) {
      this.missing = true
      this.stop()
      this.deps.log({ route: 'game', event: 'db_views_missing', code, note: 'apply db/game.sql; falling back to the game API' })
      this.deps.onMissing?.()
      return
    }
    this.fails += 1
    if (this.fails === 1 || this.fails % 10 === 0) {
      const text = error instanceof Error ? error.message : String(error)
      this.deps.log({ route: 'game', event: 'db_poll_failed', fails: this.fails, code: typeof code === 'string' ? code : 'ERR', message: redact(text, this.o.secrets).slice(0, 160) })
    }
  }
}
