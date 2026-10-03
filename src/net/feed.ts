/**
 * One agent's live feed: a WebSocket to `/events` that reconnects with backoff, drops duplicates and
 * tells replayed history apart from live moves.
 *
 * On every (re)connection the agent first sends its last 200 events. Those that were already seen are
 * dropped by key; the rest arrive flagged `replay: true` (history for the transcript, not a scene to
 * act out). Read-only: this client never sends anything on the socket.
 */
import type { AgentId, ShowEvent } from '../model/events'
import { parseEnvelope } from '../model/sanitize'
import { backoffDelay, DEFAULT_BACKOFF, type BackoffOptions } from './backoff'

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
  /** Events within this window after `open` are the agent's replay buffer. */
  readonly replayWindowMs?: number
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
  private openedAt = 0
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
      this.setStatus('open', null)
      this.stableTimer = this.opts.timers.setTimeout(() => {
        this.attempt = 0
      }, this.opts.stableAfterMs)
    }
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return
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
    if (this.seen.has(event.key)) return
    this.remember(event.key)
    const replay = this.opts.timers.now() - this.openedAt < this.opts.replayWindowMs
    this.opts.onEvent(event, replay)
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
    if (this.retryTimer !== null) this.opts.timers.clearTimeout(this.retryTimer)
    if (this.stableTimer !== null) this.opts.timers.clearTimeout(this.stableTimer)
    this.retryTimer = this.stableTimer = null
  }

  private setStatus(status: FeedStatus, nextRetryMs: number | null): void {
    this.status = status
    this.opts.onStatus?.(status, { attempt: this.attempt, nextRetryMs })
  }
}
