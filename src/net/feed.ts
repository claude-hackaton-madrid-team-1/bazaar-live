/**
 * One agent's live feed: a WebSocket to `/events` that reconnects with backoff, drops duplicates and
 * tells replayed history apart from live moves.
 *
 * On every (re)connection the agent first sends its last 200 events. Those that were already seen are
 * dropped by key; the rest arrive flagged `replay: true` (history for the transcript, not a scene to
 * act out). Read-only: this client never sends anything on the socket.
 */
import type { AgentId, ShowEvent } from '../model/events.ts'
import { parseEnvelope } from '../model/sanitize.ts'
import { backoffDelay, DEFAULT_BACKOFF, type BackoffOptions } from './backoff.ts'

export type FeedStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'stopped'

/** The part of the browser WebSocket this client uses, so tests can drive a fake one. */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
  close(): void
}

export type SocketFactory = (url: string) => SocketLike

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  now(): number
}

const browserTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

export interface FeedOptions {
  readonly url: string
  readonly agent: AgentId
  readonly onEvent: (event: ShowEvent, replay: boolean) => void
  readonly onStatus?: (status: FeedStatus, info: { attempt: number; nextRetryMs: number | null }) => void
  readonly createSocket?: SocketFactory
  readonly timers?: Timers
  readonly backoff?: BackoffOptions
  readonly random?: () => number
  /** Events within this window after `open` are the agent's replay buffer... */
  readonly replayWindowMs?: number
  /** ...and so is the rest of that first burst, while messages keep coming closer than this... */
  readonly burstGapMs?: number
  /** ...up to this long after `open`. */
  readonly maxReplayMs?: number
  /** A socket that receives nothing for this long is presumed half-open and replaced. */
  readonly idleMs?: number
  /** A connection that stays open this long resets the backoff. */
  readonly stableAfterMs?: number
  /** How many keys to remember for dedupe. */
  readonly maxSeen?: number
}

export class EventFeed {
  private readonly opts: Required<Omit<FeedOptions, 'onStatus'>> & Pick<FeedOptions, 'onStatus'>
  private readonly seen = new Map<string, true>()
  private socket: SocketLike | null = null
  private retryTimer: unknown = null
  private stableTimer: unknown = null
  private idleTimer: unknown = null
  private openedAt = 0
  private lastMessageAt = 0
  private replaying = false
  private attempt = 0
  private status: FeedStatus = 'idle'
  private stopped = true
  /** Messages that failed to parse or were not shown: a counter for the debug corner. */
  rejected = 0

  constructor(options: FeedOptions) {
    this.opts = {
      createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      timers: browserTimers,
      backoff: DEFAULT_BACKOFF,
      random: Math.random,
      replayWindowMs: 1500,
      burstGapMs: 400,
      maxReplayMs: 10_000,
      idleMs: 150_000,
      stableAfterMs: 10_000,
      maxSeen: 4000,
      ...options,
    }
  }

  get currentStatus(): FeedStatus {
    return this.status
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    this.dropSocket()
    this.setStatus('stopped', null)
  }

  /** Skip the wait (e.g. the browser came back online). */
  reconnectNow(): void {
    if (this.stopped || this.status === 'open' || this.status === 'connecting') return
    this.clearTimers()
    this.connect()
  }

  private connect(): void {
    this.dropSocket()
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting', null)
    let socket: SocketLike
    try {
      socket = this.opts.createSocket(this.opts.url)
    } catch {
      this.scheduleRetry()
      return
    }
    this.socket = socket
    socket.onopen = () => {
      if (this.socket !== socket) return
      this.openedAt = this.opts.timers.now()
      this.lastMessageAt = this.openedAt
      this.replaying = true
      this.armIdle(socket)
      this.setStatus('open', null)
      this.stableTimer = this.opts.timers.setTimeout(() => {
        this.attempt = 0
      }, this.opts.stableAfterMs)
    }
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return
      this.armIdle(socket)
      this.handleMessage(ev.data)
    }
    socket.onerror = () => {
      // A close always follows an error; the retry is scheduled there.
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      if (!this.stopped) this.scheduleRetry()
    }
  }

  private handleMessage(data: unknown): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(typeof data === 'string' ? data : String(data))
    } catch {
      this.rejected += 1
      return
    }
    const event = parseEnvelope(parsed, this.opts.agent)
    if (!event || event.agent !== this.opts.agent) {
      this.rejected += 1
      return
    }
    const replay = this.isReplay()
    if (this.seen.has(event.key)) return
    this.remember(event.key)
    this.opts.onEvent(event, replay)
  }

  /** The join burst: the first window, then as long as messages keep arriving close together. */
  private isReplay(): boolean {
    const now = this.opts.timers.now()
    const sinceOpen = now - this.openedAt
    const gap = now - this.lastMessageAt
    this.lastMessageAt = now
    if (!this.replaying) return false
    this.replaying = sinceOpen < this.opts.maxReplayMs && (sinceOpen < this.opts.replayWindowMs || gap < this.opts.burstGapMs)
    return this.replaying
  }

  /** (Re)start the watchdog for a socket that may go silent without closing. */
  private armIdle(socket: SocketLike): void {
    if (this.idleTimer !== null) this.opts.timers.clearTimeout(this.idleTimer)
    this.idleTimer = this.opts.timers.setTimeout(() => {
      this.idleTimer = null
      if (this.socket !== socket || this.stopped) return
      this.dropSocket()
      this.attempt = 0
      this.scheduleRetry()
    }, this.opts.idleMs)
  }

  private remember(key: string): void {
    this.seen.set(key, true)
    if (this.seen.size > this.opts.maxSeen) {
      const oldest = this.seen.keys().next().value
      if (oldest !== undefined) this.seen.delete(oldest)
    }
  }

  private scheduleRetry(): void {
    this.clearTimers()
    const delay = backoffDelay(this.attempt, this.opts.backoff, this.opts.random)
    this.attempt += 1
    this.setStatus('reconnecting', delay)
    this.retryTimer = this.opts.timers.setTimeout(() => {
      this.retryTimer = null
      if (!this.stopped) this.connect()
    }, delay)
  }

  private dropSocket(): void {
    const socket = this.socket
    this.socket = null
    if (!socket) return
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
    try {
      socket.close()
    } catch {
      // Closing a socket that never opened can throw in some browsers; it is gone either way.
    }
  }

  private clearTimers(): void {
    for (const timer of [this.retryTimer, this.stableTimer, this.idleTimer]) {
      if (timer !== null) this.opts.timers.clearTimeout(timer)
    }
    this.retryTimer = this.stableTimer = this.idleTimer = null
  }

  private setStatus(status: FeedStatus, nextRetryMs: number | null): void {
    this.status = status
    this.opts.onStatus?.(status, { attempt: this.attempt, nextRetryMs })
  }
}
