/**
 * The game screens' feed: GET /api/game to learn whether the server relays the game (it needs the
 * team key) and whether a view token is required, then the SSE stream /api/game/stream.
 *
 * The stream has no cursor: every (re)connect starts with the whole replay (sticky events first, then
 * the backlog), so the first `events` message after an open replaces the state and the rest add to it.
 * Like src/net/transcript.ts: reconnects with backoff and jitter, replaces a stream that went quiet
 * (the server sends `hb` every 15 s), and asks again now and then while the server says it is off.
 */
import { backoffDelay, DEFAULT_BACKOFF, type BackoffOptions } from '../net/backoff'
import type { Timers } from '../net/feed'
import type { SourceLike } from '../net/transcript'
import type { GameEvent } from './state.ts'

export type GameFeedStatus = 'connecting' | 'live' | 'reconnecting' | 'off' | 'locked'

/** Where the server's feed comes from: our database's views, or the game's API with the team key. */
export type GameFeedSource = 'db' | 'api'

export interface GameFeedOptions {
  /** `/api/game`: the JSON route; the stream is `${url}/stream`. */
  readonly url: string
  /** GAME_VIEW_TOKEN, from the page's `?token=`; sent on the stream only. */
  readonly token?: string | null
  /** A batch of events; `replay` is true for the first one after a (re)connect: start from a clean state. */
  readonly onEvents: (events: readonly GameEvent[], replay: boolean) => void
  readonly onStatus?: (status: GameFeedStatus) => void
  /** What GET /api/game said about the source, each time it is asked (null while off or unknown). */
  readonly onSource?: (source: GameFeedSource | null) => void
  readonly createSource?: (url: string) => SourceLike
  readonly fetchImpl?: typeof fetch
  readonly timers?: Timers
  readonly backoff?: BackoffOptions
  readonly random?: () => number
  readonly idleMs?: number
  readonly stableAfterMs?: number
  readonly offRecheckMs?: number
}

const browserTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

const REQUEST_TIMEOUT_MS = 8000

/** What GET /api/game answers (only the fields read here). */
interface GameInfo {
  readonly enabled?: unknown
  readonly tokenRequired?: unknown
  readonly source?: unknown
}

/** The events in one `events` message: objects with a numeric id and a string type; anything else is dropped. */
export function parseEvents(data: unknown): GameEvent[] {
  if (typeof data !== 'string') return []
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  return value.filter((e): e is GameEvent => {
    if (typeof e !== 'object' || e === null) return false
    const r = e as Record<string, unknown>
    return typeof r.id === 'number' && typeof r.type === 'string' && (r.payload === undefined || (typeof r.payload === 'object' && r.payload !== null))
  })
}

export class GameFeed {
  private readonly o: Required<Omit<GameFeedOptions, 'onStatus' | 'onSource' | 'token'>> & Pick<GameFeedOptions, 'onStatus' | 'onSource' | 'token'>
  private source: SourceLike | null = null
  private retryTimer: unknown = null
  private idleTimer: unknown = null
  private stableTimer: unknown = null
  private attempt = 0
  private fresh = true
  private status: GameFeedStatus | null = null
  private stopped = true

  constructor(options: GameFeedOptions) {
    this.o = {
      createSource: (url) => new EventSource(url) as unknown as SourceLike,
      fetchImpl: (input, init) => fetch(input, init),
      timers: browserTimers,
      backoff: DEFAULT_BACKOFF,
      random: Math.random,
      idleMs: 45_000,
      stableAfterMs: 10_000,
      offRecheckMs: 120_000,
      ...options,
    }
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.check()
  }

  stop(): void {
    this.stopped = true
    this.closeSource()
    this.clear('retryTimer')
  }

  private setStatus(status: GameFeedStatus): void {
    if (status === this.status) return
    this.status = status
    this.o.onStatus?.(status)
  }

  private clear(name: 'retryTimer' | 'idleTimer' | 'stableTimer'): void {
    if (this[name] !== null) this.o.timers.clearTimeout(this[name])
    this[name] = null
  }

  /** Is the relay on, and may we read it? Then open the stream; else look again later. */
  private async check(): Promise<void> {
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')
    let info: GameInfo | null = null
    try {
      const res = await this.o.fetchImpl(this.o.url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { Accept: 'application/json' } })
      if (res.ok) info = (await res.json()) as GameInfo
    } catch {
      info = null
    }
    if (this.stopped) return
    if (info === null) return this.retry()
    this.o.onSource?.(info.source === 'db' || info.source === 'api' ? info.source : null)
    if (info.enabled !== true) {
      this.setStatus('off')
      return this.later(this.o.offRecheckMs)
    }
    if (info.tokenRequired === true && !this.o.token) {
      this.setStatus('locked')
      return
    }
    this.open()
  }

  private open(): void {
    const query = this.o.token ? `?token=${encodeURIComponent(this.o.token)}` : ''
    const source = this.o.createSource(`${this.o.url}/stream${query}`)
    this.source = source
    this.fresh = true
    this.touch()
    source.onopen = () => {
      if (this.source !== source) return
      this.fresh = true
      this.touch()
      this.clear('stableTimer')
      this.stableTimer = this.o.timers.setTimeout(() => (this.attempt = 0), this.o.stableAfterMs)
    }
    source.addEventListener('events', (ev) => {
      if (this.source !== source) return
      this.touch()
      const events = parseEvents(ev.data)
      const replay = this.fresh
      this.fresh = false
      this.setStatus('live')
      this.o.onEvents(events, replay)
    })
    source.addEventListener('hb', () => {
      if (this.source === source) this.touch()
    })
    // A refused stream (401, 404, 429) and a dropped one both land here: ask /api/game again, after a wait.
    source.onerror = () => {
      if (this.source !== source) return
      this.closeSource()
      this.retry()
    }
  }

  /** Any sign of life pushes the watchdog back; a stream silent past idleMs is replaced. */
  private touch(): void {
    this.clear('idleTimer')
    this.idleTimer = this.o.timers.setTimeout(() => {
      this.closeSource()
      this.retry()
    }, this.o.idleMs)
  }

  private closeSource(): void {
    this.clear('idleTimer')
    this.clear('stableTimer')
    this.source?.close()
    this.source = null
  }

  private retry(): void {
    if (this.stopped) return
    this.setStatus('reconnecting')
    this.later(backoffDelay(this.attempt, this.o.backoff, this.o.random))
    this.attempt += 1
  }

  private later(ms: number): void {
    this.clear('retryTimer')
    this.retryTimer = this.o.timers.setTimeout(() => {
      this.retryTimer = null
      if (!this.stopped) void this.check()
    }, ms)
  }
}
