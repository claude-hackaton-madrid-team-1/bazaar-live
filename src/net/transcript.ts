/**
 * The page's feed of real conversations: GET /api/transcript to learn whether the feature is on and to
 * catch up, then the SSE stream /api/transcript/stream for what comes next.
 *
 * Like src/net/feed.ts: reconnects with backoff and jitter, resumes from the last cursor, drops
 * duplicates by item id, tells history (captions) from live items (scenes), and replaces a stream that
 * stopped sending (the server sends an `hb` event every 15 s). Read-only: it never sends anything.
 * Without a database the server answers `enabled: false` and this stays off, quietly.
 */
import { parseBatch } from '../../shared/transcript-parse.ts'
import type { TranscriptBatch, TranscriptItem } from '../../shared/transcript.ts'
import { backoffDelay, DEFAULT_BACKOFF, type BackoffOptions } from './backoff'
import type { Timers } from './feed'

export type TranscriptStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'off' | 'stopped'

/** The part of the browser EventSource this client uses, so tests can drive a fake one. */
export interface SourceLike {
  onopen: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
  addEventListener(type: string, listener: (ev: { data: unknown }) => void): void
  close(): void
}

const browserTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

export interface TranscriptFeedOptions {
  /** `/api/transcript`: the JSON route; the stream is `${url}/stream`. */
  readonly url: string
  readonly onItems: (items: readonly TranscriptItem[], replay: boolean) => void
  readonly onStatus?: (status: TranscriptStatus) => void
  readonly createSource?: (url: string) => SourceLike
  readonly fetchImpl?: typeof fetch
  readonly timers?: Timers
  readonly backoff?: BackoffOptions
  readonly random?: () => number
  /** A stream that sends nothing, not even `hb`, for this long is replaced. */
  readonly idleMs?: number
  /** A connection that stays open this long resets the backoff. */
  readonly stableAfterMs?: number
  /** Ask again this often while the server says the feature is off. */
  readonly offRecheckMs?: number
  readonly maxSeen?: number
}

const REQUEST_TIMEOUT_MS = 8000

export class TranscriptFeed {
  private readonly o: Required<Omit<TranscriptFeedOptions, 'onStatus'>> & Pick<TranscriptFeedOptions, 'onStatus'>
  private readonly seen = new Map<string, true>()
  private source: SourceLike | null = null
  private retryTimer: unknown = null
  private idleTimer: unknown = null
  private stableTimer: unknown = null
  private epoch: string | null = null
  private cursor: number | null = null
  private attempt = 0
  private status: TranscriptStatus = 'idle'
  private stopped = true
  /** Batches that failed to parse: a counter for the debug corner. */
  rejected = 0

  constructor(options: TranscriptFeedOptions) {
    this.o = {
      createSource: (url) => new EventSource(url) as unknown as SourceLike,
      fetchImpl: (input, init) => fetch(input, init),
      timers: browserTimers,
      backoff: DEFAULT_BACKOFF,
      random: Math.random,
      idleMs: 45_000,
      stableAfterMs: 10_000,
      offRecheckMs: 300_000,
      maxSeen: 2000,
      ...options,
    }
  }

  get currentStatus(): TranscriptStatus {
    return this.status
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.begin()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    this.dropSource()
    this.setStatus('stopped')
  }

  /** Skip the wait (the browser came back online). */
  reconnectNow(): void {
    if (this.stopped || this.status === 'open' || this.status === 'connecting') return
    this.clearTimers()
    void this.begin()
  }

  /** The question that comes first on every (re)connection: is it on, and what did I miss? */
  private async begin(): Promise<void> {
    this.dropSource()
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')
    const resume = this.cursor === null || this.epoch === null ? '' : `?since=${this.cursor}&epoch=${encodeURIComponent(this.epoch)}`
    let batch: TranscriptBatch | null
    try {
      const controller = new AbortController()
      const timer = this.o.timers.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const res = await this.o.fetchImpl(`${this.o.url}${resume}`, { cache: 'no-store', signal: controller.signal })
        if (!res.ok) throw new Error(`transcript answered ${res.status}`)
        batch = parseBatch((await res.json()) as unknown)
      } finally {
        this.o.timers.clearTimeout(timer)
      }
    } catch {
      if (!this.stopped) this.scheduleRetry()
      return
    }
    if (this.stopped) return
    if (!batch) {
      this.rejected += 1
      this.scheduleRetry()
      return
    }
    if (!batch.enabled) {
      this.setStatus('off')
      this.retryTimer = this.o.timers.setTimeout(() => void this.begin(), this.o.offRecheckMs)
      return
    }
    this.accept(batch)
    this.openStream()
  }

  private openStream(): void {
    const query = this.cursor === null || this.epoch === null ? '' : `?since=${this.cursor}&epoch=${encodeURIComponent(this.epoch)}`
    let source: SourceLike
    try {
      source = this.o.createSource(`${this.o.url}/stream${query}`)
    } catch {
      this.scheduleRetry()
      return
    }
    this.source = source
    source.onopen = () => {
      if (this.source !== source) return
      this.armIdle(source)
      this.setStatus('open')
      this.stableTimer = this.o.timers.setTimeout(() => {
        this.attempt = 0
      }, this.o.stableAfterMs)
    }
    source.addEventListener('items', (ev) => {
      if (this.source !== source) return
      this.armIdle(source)
      this.handle(ev.data)
    })
    source.addEventListener('hb', () => {
      if (this.source === source) this.armIdle(source)
    })
    source.onerror = () => {
      if (this.source !== source) return
      this.dropSource()
      if (!this.stopped) this.scheduleRetry()
    }
    this.armIdle(source)
  }

  private handle(data: unknown): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(typeof data === 'string' ? data : String(data))
    } catch {
      this.rejected += 1
      return
    }
    const batch = parseBatch(parsed)
    if (!batch) {
      this.rejected += 1
      return
    }
    this.accept(batch)
  }

  /** Remember the cursor, drop what was seen, and pass the rest on. */
  private accept(batch: TranscriptBatch): void {
    const newest = batch.items.reduce((max, i) => Math.max(max, i.seq), 0)
    if (batch.epoch !== this.epoch) {
      this.epoch = batch.epoch
      this.cursor = Math.max(newest, batch.items.length === 0 ? batch.cursor : 0)
    } else {
      this.cursor = Math.max(this.cursor ?? 0, newest, batch.items.length === 0 ? batch.cursor : 0)
    }
    const fresh = batch.items.filter((i) => {
      if (this.seen.has(i.id)) return false
      this.remember(i.id)
      return true
    })
    // Items the server read while catching up are captions, never scenes, even in a live batch.
    const history = fresh.filter((i) => i.history)
    const live = fresh.filter((i) => !i.history)
    if (history.length > 0) this.o.onItems(history, true)
    if (live.length > 0) this.o.onItems(live, batch.replay)
  }

  private remember(id: string): void {
    this.seen.set(id, true)
    if (this.seen.size > this.o.maxSeen) {
      const oldest = this.seen.keys().next().value
      if (oldest !== undefined) this.seen.delete(oldest)
    }
  }

  private armIdle(source: SourceLike): void {
    if (this.idleTimer !== null) this.o.timers.clearTimeout(this.idleTimer)
    this.idleTimer = this.o.timers.setTimeout(() => {
      this.idleTimer = null
      if (this.source !== source || this.stopped) return
      this.dropSource()
      this.attempt = 0
      this.scheduleRetry()
    }, this.o.idleMs)
  }

  private scheduleRetry(): void {
    this.clearTimers()
    const delay = backoffDelay(this.attempt, this.o.backoff, this.o.random)
    this.attempt += 1
    this.setStatus('reconnecting')
    this.retryTimer = this.o.timers.setTimeout(() => {
      this.retryTimer = null
      if (!this.stopped) void this.begin()
    }, delay)
  }

  private dropSource(): void {
    const source = this.source
    this.source = null
    if (this.idleTimer !== null) this.o.timers.clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (!source) return
    source.onopen = source.onerror = null
    try {
      source.close()
    } catch {
      // A source that never opened can throw on close in some browsers; it is gone either way.
    }
  }

  private clearTimers(): void {
    for (const timer of [this.retryTimer, this.stableTimer, this.idleTimer]) {
      if (timer !== null) this.o.timers.clearTimeout(timer)
    }
    this.retryTimer = this.stableTimer = this.idleTimer = null
  }

  private setStatus(status: TranscriptStatus): void {
    this.status = status
    this.o.onStatus?.(status)
  }
}
