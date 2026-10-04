/**
 * What the db/*.sql pollers behind /api/history, /api/learn, /api/rivals, /api/strategy and /api/venue share. Each
 * reads its views every few seconds and keeps the last snapshot in memory for its route, on the server's one shared
 * pool (the reader role has a connection limit), one capped query after the other. A view not applied yet (42P01)
 * or not granted (42501) only blanks its part, logged once; any other error keeps the last good part and backs off.
 * No exception ever leaves `pollOnce()`, and error text is redacted against the connection's secrets before it is
 * logged. `poke()` reads now (an agent's socket said something moved); `onChange` hears when a read's rows differ.
 */
import { parseAll } from './learn/rows.ts'
import type { Db } from './transcript/poller.ts'

export interface ViewPollerDeps {
  readonly db: Db
  readonly log: (entry: Record<string, unknown>) => void
  readonly intervalMs?: number
  readonly maxDelayMs?: number
  /** Strings to cut out of any logged error text (the url, its host, its password). */
  readonly secrets?: readonly string[]
  readonly now?: () => Date
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

/** A poller's own settings: its log tag, its empty snapshot, one query and one row cap per part, how often it reads. */
export interface ViewPollerSpec<P extends string, S> {
  readonly route: string
  readonly empty: S
  readonly sql: Readonly<Record<P, string>>
  readonly caps: Readonly<Record<P, number>>
  readonly intervalMs: number
}

/** One read in progress: which parts answered, and whether any failed (the snapshot then keeps its time and the poller backs off). */
export interface Read<P extends string> {
  readonly parts: Record<P, boolean>
  failed: boolean
}

type Snapshot<P extends string> = { readonly at: string | null; readonly parts: Readonly<Record<P, boolean>> }

export const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'ERR'
}

export function redactError(error: unknown, secrets: readonly string[]): string {
  let text = error instanceof Error ? error.message : String(error)
  for (const s of secrets) if (s) text = text.split(s).join('***')
  return text.slice(0, 200)
}

export abstract class ViewPoller<P extends string, S extends Snapshot<P>> {
  protected snapshot: S
  protected readonly deps: ViewPollerDeps
  protected readonly spec: ViewPollerSpec<P, S>
  private readonly missingLogged = new Set<P>()
  private failures = 0
  private timer: unknown = null
  private running = false
  private polling = false
  private again = false
  /** The last read's content (its time left out): a read that finds the same rows changes nothing. */
  private signature = ''
  private readonly listeners = new Set<(at: string) => void>()
  private readonly intervalMs: number
  private readonly maxDelayMs: number

  constructor(spec: ViewPollerSpec<P, S>, deps: ViewPollerDeps) {
    this.spec = spec
    this.deps = deps
    this.snapshot = spec.empty
    this.intervalMs = deps.intervalMs ?? spec.intervalMs
    this.maxDelayMs = deps.maxDelayMs ?? 120_000
  }

  /** One read of every view. Never throws. */
  abstract pollOnce(): Promise<void>

  current(): S {
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

  /** Called with the read's time after each read whose rows differ from the one before. Returns the unsubscribe. */
  onChange(listener: (at: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** A new read, starting from the parts the last one found. */
  protected begin(): Read<P> {
    return { parts: { ...this.snapshot.parts }, failed: false }
  }

  /** One part's rows by its query and cap, or what `lost` leaves when the query fails. */
  protected async view<T>(read: Read<P>, part: P, parse: (raw: unknown) => T | null, keep: readonly T[]): Promise<readonly T[]> {
    try {
      const { rows } = await this.deps.db.query(this.spec.sql[part], [this.spec.caps[part]])
      this.found(read, part)
      return parseAll(rows, parse)
    } catch (error: unknown) {
      return this.lost(read, part, error, keep)
    }
  }

  /** The part answered. */
  protected found(read: Read<P>, part: P): void {
    read.parts[part] = true
    this.missingLogged.delete(part)
  }

  /** The part's query failed: a missing view blanks it (logged once); any other error keeps `keep` and fails the read. */
  protected lost<T>(read: Read<P>, part: P, error: unknown, keep: readonly T[]): readonly T[] {
    const code = codeOf(error)
    if (code === '42P01' || code === '42501') {
      read.parts[part] = false
      if (!this.missingLogged.has(part)) this.deps.log({ route: this.spec.route, event: 'view_missing', part, code })
      this.missingLogged.add(part)
      return []
    }
    read.failed = true
    this.deps.log({ route: this.spec.route, event: 'poll_error', part, code, message: redactError(error, this.deps.secrets ?? []) })
    return keep
  }

  /**
   * Ends a read: `rows` with its parts become the snapshot, stamped now (or with the last read's time after a
   * failure), and the listeners hear of it when `signature` (all the rows by default) differs from the last one's.
   */
  protected finish(read: Read<P>, rows: Omit<S, 'at' | 'parts'>, signature: unknown = rows): void {
    const prev = this.snapshot
    this.failures = read.failed ? this.failures + 1 : 0
    const at = read.failed ? prev.at : (this.deps.now ?? (() => new Date()))().toISOString()
    this.snapshot = { at, parts: read.parts, ...rows } as unknown as S
    this.changed(at, JSON.stringify([read.parts, signature]))
  }

  private changed(at: string | null, signature: string): void {
    if (signature === this.signature || at === null) return
    this.signature = signature
    for (const l of this.listeners) {
      try {
        l(at)
      } catch (error: unknown) {
        this.deps.log({ route: this.spec.route, event: 'listener_failed', message: error instanceof Error ? error.name : 'ERR' })
      }
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) (this.deps.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>)
    this.timer = null
  }

  private async loop(): Promise<void> {
    // a start() while the last read is still out: that read's loop sets the timer when it ends
    if (!this.running || this.polling) return
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
}
