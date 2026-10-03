/**
 * What the characters already said: a recent-lines memory so that no line repeats within a window
 * (a few minutes), and a chooser that prefers fresh lines in the mood asked for.
 *
 * A line is identified by its raw template text (with the `{slots}` unfilled), so two banks that share
 * a line also share its memory, and "Choca esa mano" is "Choca esa mano" whichever card it is about.
 */
import type { Mood, Variant } from '../../shared/bank.ts'
import { pick } from './words'

export const DEFAULT_WINDOW_MS = 6 * 60_000
const MAX_ENTRIES = 400
const MAX_MOODS = 8

export function variantId(variant: Variant): string {
  return variant.lines.map(([, text]) => text).join(' ¶ ')
}

/** The first row alone: two variants that open with the same words are the same line to the ear. */
function openingOf(variant: Variant): string {
  return variant.lines[0]?.[1] ?? ''
}

export class LineMemory {
  private readonly saidAt = new Map<string, number>()
  private moods: Mood[] = []
  readonly windowMs: number
  private readonly maxEntries: number

  constructor(windowMs: number = DEFAULT_WINDOW_MS, maxEntries: number = MAX_ENTRIES) {
    this.windowMs = windowMs
    this.maxEntries = maxEntries
  }

  /** How long ago (ms) a line was said; Infinity when it never was. */
  ageOf(variant: Variant, now: number): number {
    const at = Math.max(this.saidAt.get(variantId(variant)) ?? -Infinity, this.saidAt.get(openingOf(variant)) ?? -Infinity)
    return Number.isFinite(at) ? now - at : Infinity
  }

  recent(variant: Variant, now: number): boolean {
    return this.ageOf(variant, now) < this.windowMs
  }

  record(variant: Variant, now: number): void {
    this.saidAt.set(variantId(variant), now)
    this.saidAt.set(openingOf(variant), now)
    this.moods = [...this.moods, variant.mood].slice(-MAX_MOODS)
    if (this.saidAt.size > this.maxEntries) {
      const cutoff = now - this.windowMs
      for (const [id, at] of this.saidAt) if (at < cutoff) this.saidAt.delete(id)
    }
  }

  recentMoods(): readonly Mood[] {
    return this.moods
  }
}

/**
 * One variant of a pool: a fresh one if there is any (not said within the window), else the one said
 * longest ago; among those, the first mood in `moods` that has a candidate; within it the one never
 * said or said longest ago; then the seed picks among ties.
 * Without a memory it is only the mood and the seed, so a replay of the same event reads the same.
 */
export function chooseVariant(pool: readonly Variant[], moods: readonly Mood[], seed: number, memory: LineMemory | undefined, now: number): Variant {
  if (pool.length === 0) throw new Error('chooseVariant() needs at least one variant')
  let candidates = pool
  if (memory) {
    const fresh = pool.filter((v) => !memory.recent(v, now))
    if (fresh.length > 0) candidates = fresh
    else {
      const oldest = Math.max(...pool.map((v) => memory.ageOf(v, now)))
      candidates = pool.filter((v) => memory.ageOf(v, now) === oldest)
    }
  }
  for (const mood of moods) {
    const match = candidates.filter((v) => v.mood === mood)
    if (match.length > 0) return pick(leastRecent(match, memory, now), seed)
  }
  return pick(leastRecent(candidates, memory, now), seed)
}

/** Among equals, a line never said (or said longest ago) goes first, so a bank is used evenly, in a cycle. */
function leastRecent(pool: readonly Variant[], memory: LineMemory | undefined, now: number): readonly Variant[] {
  if (!memory) return pool
  const oldest = Math.max(...pool.map((v) => memory.ageOf(v, now)))
  return pool.filter((v) => memory.ageOf(v, now) === oldest)
}
