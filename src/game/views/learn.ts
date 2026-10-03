/**
 * The Learn screen's selectors over GET /api/learn (shared/learn.ts): what is blocking us right now, what our
 * outcomes taught us, the facts read from the feed, how each dealer behaves, and what the rivals do.
 * Pure: the snapshot and the game's current tick in, rows out.
 */
import type { DealerStat, Learning, LearnSnapshot, RivalProfile, TraderMove } from '../../../shared/learn.ts'

/** Kinds that stop a deal until `untilTick` (bazaar learn/model.py BLOCKING_KINDS). */
export const BLOCKING_KINDS: ReadonlySet<string> = new Set(['blocker', 'cooloff', 'quota', 'sold_out'])
/** Kinds our own scored outcomes wrote (lessons, learned ladders) and the bluff tactics' results. */
export const LESSON_KINDS: ReadonlySet<string> = new Set(['lesson', 'policy', 'tactic'])

export interface LearningRow extends Learning {
  /** Ticks until it lifts (blocking kinds with an expiry and a known tick), else null. */
  readonly left: number | null
}

export interface LearningGroups {
  /** Blockers, cooloffs, quotas and sold-outs still in force, the soonest to lift first. */
  readonly inForce: LearningRow[]
  /** Lessons, policies and tactics, the most confident (then best supported) first. */
  readonly lessons: LearningRow[]
  /** Everything else read from the feed (price floors, behaviour, notices), newest first. */
  readonly facts: LearningRow[]
  /** Blocking learnings that already lifted: counted, not listed. */
  readonly lifted: number
}

const matches = (l: Learning, q: string): boolean =>
  !q || [l.subject, l.claim, l.kind, l.team ?? '', l.subjectKind].some((s) => s.toLowerCase().includes(q))

/** `until` is exclusive: the subject is free again AT that tick. */
const expired = (l: Learning, tick: number | null): boolean => tick !== null && l.untilTick !== null && l.untilTick <= tick

export function learningGroups(snapshot: LearnSnapshot, tick: number | null, query = ''): LearningGroups {
  const q = query.trim().toLowerCase()
  const inForce: LearningRow[] = []
  const lessons: LearningRow[] = []
  const facts: LearningRow[] = []
  let lifted = 0
  for (const l of snapshot.learnings) {
    if (BLOCKING_KINDS.has(l.kind)) {
      if (expired(l, tick)) {
        lifted += 1
        continue
      }
      if (matches(l, q)) inForce.push({ ...l, left: tick !== null && l.untilTick !== null ? l.untilTick - tick : null })
    } else if (!expired(l, tick) && matches(l, q)) {
      ;(LESSON_KINDS.has(l.kind) ? lessons : facts).push({ ...l, left: null })
    }
  }
  inForce.sort((a, b) => (a.left ?? Infinity) - (b.left ?? Infinity) || a.subject.localeCompare(b.subject))
  lessons.sort((a, b) => b.confidence - a.confidence || b.support - a.support || b.id - a.id)
  facts.sort((a, b) => (b.createdTick ?? -1) - (a.createdTick ?? -1) || b.id - a.id)
  return { inForce, lessons, facts, lifted }
}

export interface TraderProfile {
  readonly trader: string
  readonly stat: DealerStat | null
  /** Moves seen in the window, by event (open, concede, hold, final, deal, walk, cooloff, ...). */
  readonly events: Readonly<Record<string, number>>
  readonly moves: number
  readonly ourMoves: number
  /** Mean drop of her price on a concede, in primas, within a thread. */
  readonly avgConcession: number | null
  /** Share of her priced answers that held or went final instead of conceding. */
  readonly firmness: number | null
  readonly lastTick: number | null
}

/** One row per dealer, from the curves' aggregates and the recent moves, the busiest first. */
export function traderProfiles(snapshot: LearnSnapshot): TraderProfile[] {
  const byTrader = new Map<string, TraderMove[]>()
  for (const m of snapshot.moves) {
    const list = byTrader.get(m.trader) ?? []
    list.push(m)
    byTrader.set(m.trader, list)
  }
  const names = new Set<string>([...snapshot.dealers.map((d) => d.dealer), ...byTrader.keys()])
  const rows: TraderProfile[] = []
  for (const trader of names) {
    const moves = [...(byTrader.get(trader) ?? [])].sort((a, b) => a.id - b.id)
    const events: Record<string, number> = {}
    const lastAsk = new Map<number, number>()
    const drops: number[] = []
    let lastTick: number | null = null
    for (const m of moves) {
      events[m.event] = (events[m.event] ?? 0) + 1
      if (m.tick !== null) lastTick = Math.max(lastTick ?? m.tick, m.tick)
      if (m.thread === null || m.theirPrice === null) continue
      const prev = lastAsk.get(m.thread)
      if (m.event === 'concede' && prev !== undefined && prev > m.theirPrice) drops.push(prev - m.theirPrice)
      lastAsk.set(m.thread, m.theirPrice)
    }
    const answers = (events.concede ?? 0) + (events.hold ?? 0) + (events.final ?? 0)
    rows.push({
      trader,
      stat: snapshot.dealers.find((d) => d.dealer === trader) ?? null,
      events,
      moves: moves.length,
      ourMoves: moves.filter((m) => m.ours).length,
      avgConcession: drops.length ? drops.reduce((a, b) => a + b, 0) / drops.length : null,
      firmness: answers ? ((events.hold ?? 0) + (events.final ?? 0)) / answers : null,
      lastTick,
    })
  }
  return rows.sort((a, b) => (b.stat?.threads ?? 0) - (a.stat?.threads ?? 0) || b.moves - a.moves || a.trader.localeCompare(b.trader))
}

export type MoveFilter = 'ours' | 'all'

/** The newest dealer moves first, ours only or everyone's, filtered by trader / event / thread. */
export function recentMoves(snapshot: LearnSnapshot, include: MoveFilter, query = '', limit = 80): TraderMove[] {
  const q = query.trim().toLowerCase()
  return snapshot.moves
    .filter((m) => (include === 'all' || m.ours) && (!q || m.trader.toLowerCase().includes(q) || m.event.includes(q) || String(m.thread ?? '').includes(q)))
    .sort((a, b) => b.id - a.id)
    .slice(0, limit)
}

/** Rivals, the most active (bought + sold) first. */
export function rivalRows(snapshot: LearnSnapshot): RivalProfile[] {
  const activity = (r: RivalProfile) => (r.buys ?? 0) + (r.sells ?? 0)
  return [...snapshot.rivals].sort((a, b) => activity(b) - activity(a) || a.team.localeCompare(b.team))
}

/** A 0..1 share as a whole percentage, or a dash. */
export const pct = (share: number | null): string => (share === null ? '—' : `${Math.round(share * 100)}%`)

/** The tone of an event in a dealer's move list: her concessions are good for us, her firmness is not. */
export function moveTone(event: string): 'good' | 'bad' | 'warn' | 'neutral' {
  if (event === 'deal' || event === 'concede') return 'good'
  if (event === 'walk' || event === 'cooloff' || event === 'lie_suspected') return 'bad'
  if (event === 'hold' || event === 'final') return 'warn'
  return 'neutral'
}
