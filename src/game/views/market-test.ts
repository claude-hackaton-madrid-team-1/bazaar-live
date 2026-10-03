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
import { boardOf, lastTick, readAt, standingAt } from './teams.ts'

/** Teams level on market, one row: a value shared by many (the free stall's level) reads as one line. */
export interface MarketTeam {
  readonly team: string
  /** Its venue at the board's latest read (`v07`), or null without one. */
  readonly venue: string | null
}

export interface MarketLevel {
  readonly value: number
  /** By team number, ours first when we are among them. */
  readonly teams: readonly MarketTeam[]
  readonly us: boolean
}

export interface MarketTest {
  /** Our market by the board (else /me's, the same number), and our place: teams level share it. */
  readonly ours: number | null
  readonly place: number | null
  readonly teams: number
  /** The best rival, its venue and how far ahead of us it is. */
  readonly leader: { readonly team: string; readonly venue: string | null; readonly value: number; readonly gap: number | null } | null
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
  const venueOf = (team: string): string | null => (tick === null ? null : (readAt(b, team, tick)?.venue ?? null))
  const levels: { value: number; teams: MarketTeam[]; us: boolean }[] = []
  for (const s of standing) {
    const value = r2(s.value)
    const team = { team: s.team, venue: venueOf(s.team) }
    const last = levels.at(-1)
    if (last && last.value === value) last.teams.push(team)
    else levels.push({ value, teams: [team], us: false })
  }
  for (const l of levels) {
    l.us = l.teams.some((t) => t.team === us)
    l.teams.sort((a, c) => Number(c.team === us) - Number(a.team === us) || a.team.localeCompare(c.team, undefined, { numeric: true }))
  }
  const bench = {
    points: n(score?.bench_points),
    efficiency: n(score?.bench_efficiency),
    venue: typeof score?.bench_venue === 'string' && score.bench_venue ? score.bench_venue : venueOf(us),
    mm: n(score?.mm_points),
  }
  if (!standing.length && bench.points === null && bench.efficiency === null && ours === null) return null
  return {
    ours,
    place: mine?.rank ?? null,
    teams: standing.length,
    leader: leaderRow ? { team: leaderRow.team, venue: venueOf(leaderRow.team), value: leaderRow.value, gap: ours === null ? null : r2(leaderRow.value - ours) } : null,
    levels,
    bench,
  }
}
