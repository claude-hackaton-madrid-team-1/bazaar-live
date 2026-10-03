/**
 * Reads the game with the team key and turns it into the web view's event stream (bazaar spec 003, the
 * envelope `{id, tick, t, type, scope, actor, payload}` that `bazaar monitor` wrote on feat/web-live).
 *
 * Polling, not the game's SSE stream: a team key has 6 streams and 5 requests a second, shared with the
 * agents that trade with it. Every poll is `/api/clock` and `/api/feed`; `/api/me` only on the first poll,
 * on a new tick, after a settlement of ours, and again after it failed (never again once the key is refused
 * there: the clock and the feed are public, so the market screens keep working; a 429 there waits for the
 * next tick, and its Retry-After, without slowing the loop). On the first poll and each new tick, after /me,
 * `/api/duels?done=true` too: duel messages and results are team-only, so the feed never has them (`./duels.ts`
 * translates them; a 429 there waits the same way, a refusal turns them off). Each poll publishes, in order:
 * `clock` (when the tick changed), `agent.hello` (when the team is new), `agent.me` (allow-listed, `./me.ts`),
 * the duel events not sent before, then the new feed events unchanged, oldest first. No exception ever
 * leaves `pollOnce()`.
 */
import { redact } from '../transcript/poller.ts'
import { duelEvents } from './duels.ts'
import { projectMe } from './me.ts'

export type Payload = Record<string, unknown>

/** One event of the stream. Feed events pass through as the game sent them (extra fields included). */
export interface GameEvent {
  readonly id: number
  readonly tick?: number
  readonly t?: number
  readonly type: string
  readonly scope?: string
  readonly actor?: string
  readonly payload: Payload
  readonly [extra: string]: unknown
}

/** Types a late client always gets first, the latest of each, so its first screen already knows who we are. */
export const STICKY = ['agent.hello', 'agent.me', 'clock', 'agent.phase', 'agent.ledger', 'agent.health', 'pages.changed'] as const

/** What every viewer shares: the latest sticky events, a bounded backlog, and the batches as they come. */
export class GameHub {
  private readonly backlog: GameEvent[] = []
  private readonly sticky = new Map<string, GameEvent>()
  private readonly listeners = new Set<(batch: readonly GameEvent[]) => void>()
  private readonly keep: number

  constructor(keep = 5000) {
    this.keep = keep
  }

  publish(batch: readonly GameEvent[]): void {
    if (batch.length === 0) return
    for (const e of batch) {
      this.backlog.push(e)
      if ((STICKY as readonly string[]).includes(e.type)) this.sticky.set(e.type, e)
    }
    if (this.backlog.length > this.keep) this.backlog.splice(0, this.backlog.length - this.keep)
    this.listeners.forEach((l) => l(batch))
  }

  /**
   * A status that only its latest copy matters for (our agents' health, every 10 s): kept as the sticky of its
   * type and sent to every viewer, never added to the backlog, where it would push the game's events out.
   */
  publishStatus(e: GameEvent): void {
    this.sticky.set(e.type, e)
    this.listeners.forEach((l) => l([e]))
  }

  /** The sticky events (hello, me, clock, phase), then the backlog without them. */
  replay(): GameEvent[] {
    const first = STICKY.flatMap((t) => this.sticky.get(t) ?? [])
    const sent = new Set(first)
    return [...first, ...this.backlog.filter((e) => !sent.has(e))]
  }

  subscribe(listener: (batch: readonly GameEvent[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get size(): number {
    return this.backlog.length
  }
}

/** A non-2xx answer from the game. */
export class GameHttpError extends Error {
  readonly status: number
  readonly retryAfterMs: number | null

  constructor(path: string, status: number, retryAfterMs: number | null) {
    super(`${path} answered ${status}`)
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

export interface RelayDeps {
  /** The game's base URL (REAL_URL or SIM_URL, never free-form). */
  readonly url: string
  readonly key: string
  readonly hub: GameHub
  readonly log: (entry: Record<string, unknown>) => void
  readonly fetchImpl?: typeof fetch
  readonly pollMs?: number
  readonly timeoutMs?: number
  readonly feedLimit?: number
  /** The newest duels translated each time (a first read would otherwise backfill hundreds of events). */
  readonly duelLimit?: number
  readonly maxDelayMs?: number
  /** Feed ids remembered for dedupe, below the newest one. */
  readonly idWindow?: number
  readonly random?: () => number
  /** Milliseconds, for a Retry-After that holds a single route back. */
  readonly now?: () => number
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

const isRecord = (v: unknown): v is Payload => typeof v === 'object' && v !== null && !Array.isArray(v)

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)

/** A feed event the stream can carry: an integer id, a type, an object payload (or none). */
function feedEvent(v: unknown): GameEvent | null {
  if (!isRecord(v) || !isInt(v.id) || typeof v.type !== 'string') return null
  if (v.payload !== undefined && v.payload !== null && !isRecord(v.payload)) return null
  return { ...v, id: v.id, type: v.type, payload: isRecord(v.payload) ? v.payload : {} }
}

function retryAfterMs(raw: string | null): number | null {
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 600) * 1000 : null
}

export class GameRelay {
  private readonly o: Required<Omit<RelayDeps, 'url' | 'key' | 'hub' | 'log'>>
  private readonly deps: RelayDeps
  private tick: number | null = null
  private team: string | null = null
  private meDue = true
  private clockSent = false
  /** Made-up events (clock, hello, me) count down from -1: /me can be read more than once a tick, so `-(tick*3+n)` would collide. */
  private nextMadeUp = -1
  private mark: number | null = null
  private readonly seen = new Set<number>()
  private fails = 0
  private waitMs: number | null = null
  private timer: unknown = null
  private stopped = true
  private refused = false
  /** The key was refused on /me: the relay keeps the public clock and feed, with nothing of ours. */
  private meRefused = false
  /** After a 429 on /me: not before this time (ms), and not before the next tick. */
  private meNotBefore = 0
  private duelsDue = true
  private duelsNotBefore = 0
  /** The game refused /api/duels (401, 403, 404): no more duels, the rest goes on. */
  private duelsOff = false
  private duelFails = 0
  /** The synthetic ids of the last duel list, so each message and result is sent once. */
  private duelsSeen = new Set<number>()

  constructor(deps: RelayDeps) {
    this.deps = deps
    this.o = {
      fetchImpl: fetch, pollMs: 5000, timeoutMs: 4000, feedLimit: 150, duelLimit: 20, maxDelayMs: 60_000, idWindow: 2000,
      random: Math.random, now: Date.now, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...deps,
    }
  }

  start(): void {
    if (!this.stopped || this.refused) return
    this.stopped = false
    this.schedule(0)
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) this.o.clearTimer(this.timer)
    this.timer = null
  }

  /** True once the game refused the key (401/403): the relay stays stopped. */
  get keyRefused(): boolean {
    return this.refused
  }

  /** The wait before the next poll: the interval, a 429's Retry-After, or a growing, jittered, capped one after failures. */
  nextDelayMs(): number {
    if (this.waitMs !== null) return Math.max(this.waitMs, this.o.pollMs)
    if (this.fails === 0) return this.o.pollMs
    const grown = this.o.pollMs * 2 ** Math.min(this.fails, 10)
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

  private async get(path: string): Promise<unknown> {
    const res = await this.o.fetchImpl(`${this.deps.url}${path}`, {
      headers: { 'X-Team-Key': this.deps.key, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.o.timeoutMs),
    })
    if (!res.ok) {
      void res.body?.cancel().catch(() => undefined)
      throw new GameHttpError(path, res.status, retryAfterMs(res.headers.get('retry-after')))
    }
    return res.json()
  }

  private madeUp(type: string, clock: Payload, payload: Payload): GameEvent {
    const id = this.nextMadeUp
    this.nextMadeUp -= 1
    return {
      id, tick: isInt(clock.tick) ? clock.tick : (this.tick ?? 0), t: typeof clock.t_hours === 'number' ? clock.t_hours : 0,
      type, scope: 'team', actor: '', payload,
    }
  }

  /** The feed events not seen before, oldest first; the ones too far below the newest are dropped as already passed. */
  private fresh(body: unknown): GameEvent[] {
    const raw = isRecord(body) && Array.isArray(body.events) ? body.events : []
    const floor = this.mark === null ? null : this.mark - this.o.idWindow
    const out = raw
      .map(feedEvent)
      .filter((e): e is GameEvent => e !== null && !this.seen.has(e.id) && (floor === null || e.id > floor))
      .sort((a, b) => a.id - b.id)
    const unique = out.filter((e, i) => i === 0 || out[i - 1]?.id !== e.id)
    for (const e of unique) {
      this.seen.add(e.id)
      this.mark = this.mark === null ? e.id : Math.max(this.mark, e.id)
    }
    if (this.mark !== null) {
      const low = this.mark - this.o.idWindow
      for (const id of this.seen) if (id <= low) this.seen.delete(id)
    }
    return unique
  }

  /** One poll. Never throws. */
  async pollOnce(): Promise<void> {
    if (this.refused) return
    this.waitMs = null
    try {
      const [clockBody, feedBody] = await Promise.all([this.get('/api/clock'), this.get(`/api/feed?limit=${this.o.feedLimit}`)])
      const clock = isRecord(clockBody) ? clockBody : {}
      const out: GameEvent[] = []
      const tick = isInt(clock.tick) ? clock.tick : null
      const newTick = tick !== null && tick !== this.tick
      if (newTick || !this.clockSent) {
        const day = clock.round_name ?? clock.today ?? ''
        out.push(this.madeUp('clock', clock, { day: typeof day === 'string' ? day : '', tick_seconds: clock.tick_seconds ?? null, next_tick_in: clock.next_tick_in ?? null }))
        if (tick !== null) this.tick = tick
        this.clockSent = true
      }
      const feed = this.fresh(feedBody)
      const ours = this.team !== null && feed.some((e) => e.type === 'settlement' && Array.isArray(e.payload.parties) && e.payload.parties.includes(this.team))
      if (newTick || ours) this.meDue = true
      if (newTick) this.duelsDue = true
      const meEvents: GameEvent[] = []
      let meError: unknown = null
      let meHeld = false
      if (this.meDue && !this.meRefused && this.o.now() >= this.meNotBefore) {
        try {
          const me = await this.get('/api/me')
          if (isRecord(me)) {
            const team = typeof me.id === 'string' ? me.id : null
            if (team !== null && team !== this.team) {
              meEvents.push(this.madeUp('agent.hello', clock, { team, name: me.name ?? null }))
              this.team = team
            }
            meEvents.push(this.madeUp('agent.me', clock, projectMe(me)))
            this.meDue = false
          }
        } catch (error: unknown) {
          // The feed and the clock are public: a refused key only loses /me, and the screens show the market.
          if (error instanceof GameHttpError && (error.status === 401 || error.status === 403)) {
            this.meRefused = true
            this.meDue = false
            this.deps.log({ route: 'game', event: 'me_refused', status: error.status })
          } else if (error instanceof GameHttpError && error.status === 429) {
            // Too early in the tick, or over the key's rate: /me waits for the next tick, the clock and the feed go on.
            this.meDue = false
            this.meNotBefore = this.o.now() + (error.retryAfterMs ?? 0)
            // The Retry-After is the key's: the duels wait as long.
            this.duelsNotBefore = Math.max(this.duelsNotBefore, this.meNotBefore)
            meHeld = true
          } else meError = error
        }
      }
      // Our duels go before the feed: a public `duel.closed` of ours then finds its duel already known.
      const duels = meHeld || meError !== null ? [] : await this.pollDuels()
      this.deps.hub.publish([...out, ...meEvents, ...duels, ...feed])
      if (meError !== null) throw meError
      if (this.fails > 0) this.deps.log({ route: 'game', event: 'poll_recovered', after: this.fails })
      this.fails = 0
    } catch (error: unknown) {
      this.failed(error)
    }
  }

  /** Our duels as the page's events, the ones not sent before; at most once a tick. Never throws. */
  private async pollDuels(): Promise<GameEvent[]> {
    const team = this.team
    if (!this.duelsDue || this.duelsOff || team === null || this.o.now() < this.duelsNotBefore) return []
    this.duelsDue = false
    try {
      const all = duelEvents(await this.get('/api/duels?done=true'), team, this.o.duelLimit)
      const next = new Set<number>()
      const fresh = all.filter((e) => {
        const isNew = !this.duelsSeen.has(e.id) && !next.has(e.id)
        next.add(e.id)
        return isNew
      })
      this.duelsSeen = next
      this.duelFails = 0
      return fresh.map((e) => ({ id: e.id, tick: e.tick ?? this.tick ?? 0, type: e.type, scope: 'team', actor: '', payload: e.payload }))
    } catch (error: unknown) {
      const status = error instanceof GameHttpError ? error.status : 0
      if (status === 401 || status === 403 || status === 404) {
        this.duelsOff = true
        this.deps.log({ route: 'game', event: 'duels_refused', status })
        return []
      }
      // Next tick, and not before a 429's Retry-After.
      if (status === 429 && error instanceof GameHttpError) this.duelsNotBefore = this.o.now() + (error.retryAfterMs ?? 0)
      this.duelFails += 1
      if (this.duelFails === 1 || this.duelFails % 10 === 0) {
        const text = error instanceof Error ? error.message : String(error)
        this.deps.log({ route: 'game', event: 'duels_failed', fails: this.duelFails, status, message: redact(text, [this.deps.key, this.deps.url]).slice(0, 160) })
      }
      return []
    }
  }

  private failed(error: unknown): void {
    const status = error instanceof GameHttpError ? error.status : 0
    if (status === 401 || status === 403) {
      this.refused = true
      this.stop()
      this.deps.log({ route: 'game', event: 'key_refused', status })
      return
    }
    this.fails += 1
    if (status === 429 && error instanceof GameHttpError && error.retryAfterMs !== null) this.waitMs = error.retryAfterMs
    if (this.fails === 1 || this.fails % 10 === 0) {
      const text = error instanceof Error ? error.message : String(error)
      this.deps.log({ route: 'game', event: 'poll_failed', fails: this.fails, status, message: redact(text, [this.deps.key, this.deps.url]).slice(0, 160) })
    }
  }
}
