/**
 * The director decides what the stage plays next. Beats play in arrival order (the story reads
 * left to right: list, reach, handshake), but a busy tick cannot wait forever: past `maxQueue` the
 * least interesting beat is dropped, a low-priority beat that waited longer than `maxAgeMs` is skipped,
 * and a run of holds becomes one line. Dropped beats are returned so the transcript still has them.
 */
import { PRIORITY, type Beat } from './beat'
import { holdsBeat } from './dialogue'

export interface DirectorOptions {
  readonly maxQueue: number
  readonly maxAgeMs: number
  /** Beats at or above this priority are never dropped for age. */
  readonly keepPriority: number
  readonly now: () => number
  /** Joins a run of holds into one beat (the engine passes one that speaks the show's language). */
  readonly mergeHolds: (holds: readonly Beat[]) => Beat
}

const DEFAULTS: DirectorOptions = {
  maxQueue: 8,
  maxAgeMs: 40_000,
  keepPriority: PRIORITY.dealer,
  now: () => Date.now(),
  mergeHolds: (holds) => holdsBeat(holds, { lang: 'es' }),
}

interface Queued {
  readonly beat: Beat
  readonly at: number
}

export class Director {
  private queue: Queued[] = []
  private readonly opts: DirectorOptions

  constructor(options: Partial<DirectorOptions> = {}) {
    this.opts = { ...DEFAULTS, ...options }
  }

  get size(): number {
    return this.queue.length
  }

  /** Queue a beat; returns the beats dropped to make room (possibly the new one). */
  push(beat: Beat): Beat[] {
    this.queue = [...this.queue, { beat, at: this.opts.now() }]
    const dropped: Beat[] = []
    while (this.queue.length > this.opts.maxQueue) {
      const victim = this.lowest()
      dropped.push(victim.beat)
      this.queue = this.queue.filter((q) => q !== victim)
    }
    return dropped
  }

  /** The next beat to play and the stale ones skipped on the way. */
  next(): { beat: Beat | null; skipped: Beat[] } {
    const skipped: Beat[] = []
    const now = this.opts.now()
    while (this.queue.length > 0) {
      const [head, ...rest] = this.queue
      if (!head) break
      this.queue = rest
      const stale = now - head.at > this.opts.maxAgeMs && head.beat.priority < this.opts.keepPriority
      if (stale) {
        skipped.push(head.beat)
        continue
      }
      if (head.beat.cue.kind === 'hold') return { beat: this.mergeHolds(head.beat), skipped }
      return { beat: head.beat, skipped }
    }
    return { beat: null, skipped }
  }

  /** The beat that would play next, without taking it (for prefetching its voices). */
  peek(): Beat | null {
    return this.queue[0]?.beat ?? null
  }

  clear(): Beat[] {
    const all = this.queue.map((q) => q.beat)
    this.queue = []
    return all
  }

  /** The lowest priority beat; among equals, the oldest. */
  private lowest(): Queued {
    return this.queue.reduce((low, q) => (q.beat.priority < low.beat.priority ? q : low))
  }

  /** Every queued hold of the same agent joins the one being played. */
  private mergeHolds(first: Beat): Beat {
    const same = this.queue.filter((q) => q.beat.cue.kind === 'hold' && q.beat.agent === first.agent)
    if (same.length === 0) return first
    this.queue = this.queue.filter((q) => !same.includes(q))
    return this.opts.mergeHolds([first, ...same.map((q) => q.beat)])
  }
}
