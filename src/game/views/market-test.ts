/**
 * The Market Test panel on /history: the board's `market` part for every team beside ours, and our own bench run.
 * Pure, over shared/history.ts's TeamScore (db/teams_score.sql) and our /me score (db/game.sql's show.game_me).
 *
 * `market` is on the public board for every team, in points, so it is ranked. bench_points, bench_efficiency and
 * mm_points are our private breakdown, in their own units (the board hides them for every team): they are shown apart,
 * never ranked against a rival's number.
 */
import type { TeamScore } from '../../../shared/history.ts'
import type { Score } from '../state.ts'
import { boardOf, lastTick, standingAt } from './teams.ts'

/** Teams level on market, one row: a value shared by many (the free stall's level) reads as one line. */
export interface MarketLevel {
  readonly value: number
  /** By name order, ours first when we are among them. */
  readonly teams: readonly string[]
  readonly us: boolean
}

export interface MarketTest {
  /** Our market by the board (else /me's, the same number), and our place: teams level share it. */
  readonly ours: number | null
  readonly place: number | null
  readonly teams: number
  /** The best rival and how far ahead of us it is. */
  readonly leader: { readonly team: string; readonly value: number; readonly gap: number | null } | null
  /** Highest first. */
  readonly levels: readonly MarketLevel[]
  readonly bench: {
    readonly points: number | null
    readonly efficiency: number | null
    readonly venue: string | null
    readonly mm: number | null
  }
}

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const r2 = (v: number): number => Math.round(v * 100) / 100

/** The Market Test at the board's latest read; null when we have neither a board nor a bench run. */
export function marketTest(rows: readonly TeamScore[], us: string, score: Score | null | undefined): MarketTest | null {
  const b = boardOf(rows)
  const tick = lastTick(b)
  const standing = tick === null ? [] : standingAt(b, tick, 'market')
  const mine = standing.find((s) => s.team === us)
  const ours = mine?.value ?? n(score?.market)
  const leaderRow = standing.find((s) => s.team !== us) ?? null
  const levels: { value: number; teams: string[]; us: boolean }[] = []
  for (const s of standing) {
    const value = r2(s.value)
    const last = levels.at(-1)
    if (last && last.value === value) last.teams.push(s.team)
    else levels.push({ value, teams: [s.team], us: false })
  }
  for (const l of levels) {
    l.us = l.teams.includes(us)
    l.teams.sort((a, c) => Number(c === us) - Number(a === us) || a.localeCompare(c, undefined, { numeric: true }))
  }
  const bench = {
    points: n(score?.bench_points),
    efficiency: n(score?.bench_efficiency),
    venue: typeof score?.bench_venue === 'string' && score.bench_venue ? score.bench_venue : null,
    mm: n(score?.mm_points),
  }
  if (!standing.length && bench.points === null && bench.efficiency === null && ours === null) return null
  return {
    ours,
    place: mine?.rank ?? null,
    teams: standing.length,
    leader: leaderRow ? { team: leaderRow.team, value: leaderRow.value, gap: ours === null ? null : r2(leaderRow.value - ours) } : null,
    levels,
    bench,
  }
}
