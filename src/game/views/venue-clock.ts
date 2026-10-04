/**
 * When the Market Test comes: the session running now (its book lasts `ticks` ticks from `start_tick`) or the next one,
 * from the starts the feed announced (`bench.started`, our database's and the live stream's) and their cadence (every
 * 240 ticks so far: two game hours). Pure; ticks only, the clock time is the caller's (ticks × the tick's seconds).
 */

/** One announced start, from any source: the stream's BenchRun or the database's session. */
export interface BenchStart {
  readonly session: number | null
  readonly startTick: number
  readonly ticks: number
}

/** The game's cadence until two starts in one run say otherwise (RULES.md: every two hours). */
export const DEFAULT_CADENCE = 240
/** A session's book lasts this long when its start does not say. */
export const DEFAULT_TICKS = 16

export interface BenchClock {
  /** The session whose book is on the venues now, with the ticks left. */
  readonly running: { readonly session: number | null; readonly startTick: number; readonly endTick: number; readonly left: number; readonly elapsed: number; readonly ticks: number } | null
  /** The next start by the cadence, with the ticks until it; null before any start of this run is known. */
  readonly next: { readonly session: number | null; readonly tick: number; readonly inTicks: number } | null
  /** The latest start of this run (running or done). */
  readonly last: BenchStart | null
  readonly cadence: number
}

/** Starts merged by (session, start tick), oldest first; a start above `now` belongs to an earlier run's clock. */
export function startsOf(sources: readonly (readonly BenchStart[])[], now: number): BenchStart[] {
  const byKey = new Map<string, BenchStart>()
  for (const list of sources) {
    for (const s of list) {
      if (!Number.isFinite(s.startTick) || s.startTick > now) continue
      const key = `${s.session ?? '?'}:${s.startTick}`
      if (!byKey.has(key)) byKey.set(key, s)
    }
  }
  // a start known without its session number and with it is one start
  const out = [...byKey.values()].filter((s) => s.session !== null || ![...byKey.values()].some((o) => o.session !== null && o.startTick === s.startTick))
  return out.sort((a, b) => a.startTick - b.startTick)
}

/** The most common gap between consecutive starts (the cadence the game keeps), else DEFAULT_CADENCE. */
export function cadenceOf(starts: readonly BenchStart[]): number {
  const gaps = new Map<number, number>()
  for (let i = 1; i < starts.length; i++) {
    const gap = (starts[i]?.startTick ?? 0) - (starts[i - 1]?.startTick ?? 0)
    if (gap > 0) gaps.set(gap, (gaps.get(gap) ?? 0) + 1)
  }
  let best = DEFAULT_CADENCE
  let seen = 0
  for (const [gap, n] of gaps) if (n > seen || (n === seen && gap === DEFAULT_CADENCE)) [best, seen] = [gap, n]
  return best
}

export function benchClock(starts: readonly BenchStart[], now: number): BenchClock {
  const cadence = cadenceOf(starts)
  const last = starts.at(-1) ?? null
  if (!last) return { running: null, next: null, last: null, cadence }
  const ticks = last.ticks > 0 ? last.ticks : DEFAULT_TICKS
  const endTick = last.startTick + ticks
  const running = now < endTick ? { session: last.session, startTick: last.startTick, endTick, left: endTick - now, elapsed: now - last.startTick, ticks } : null
  // the cadence counts from the last start; a start that never came (a pause, a closed door) moves it on by whole steps
  let tick = last.startTick + cadence
  let skipped = 0
  while (tick <= now) {
    tick += cadence
    skipped += 1
  }
  // after a start that never came we cannot tell its number
  const session = last.session === null || skipped > 0 ? null : last.session + 1
  return { running, next: { session, tick, inTicks: tick - now }, last, cadence }
}
