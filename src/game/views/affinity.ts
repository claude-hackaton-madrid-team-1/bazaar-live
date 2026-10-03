import type { TeamAffinity } from '../../../shared/affinity.ts'
import { SETS } from '../game.ts'

/** One team's line of the board: its multiplier per set, said and/or inferred. */
export type AffinityTeamRow = { team: string; cells: Readonly<Record<string, TeamAffinity>> }

export type AffinityBoard = {
  /** The sets any team has a value for: the album's order first, then any other code. */
  sets: string[]
  /** Teams in id order (t02 before t10). */
  teams: AffinityTeamRow[]
  said: number
  inferred: number
}

const SET_ORDER = Object.keys(SETS)

const teamNumber = (team: string): number => Number(team.slice(1))

/** The relayed rows as a team × set board; null when there is nothing to show (no data yet). */
export function affinityBoard(rows: readonly TeamAffinity[] | null): AffinityBoard | null {
  if (!rows?.length) return null
  const byTeam = new Map<string, Record<string, TeamAffinity>>()
  const sets = new Set<string>()
  for (const r of rows) {
    const cells = byTeam.get(r.team) ?? {}
    cells[r.set] = r
    byTeam.set(r.team, cells)
    sets.add(r.set)
  }
  const order = (set: string): number => {
    const i = SET_ORDER.indexOf(set)
    return i < 0 ? SET_ORDER.length : i
  }
  return {
    sets: [...sets].sort((a, b) => order(a) - order(b) || a.localeCompare(b)),
    teams: [...byTeam].sort(([a], [b]) => teamNumber(a) - teamNumber(b) || a.localeCompare(b)).map(([team, cells]) => ({ team, cells })),
    said: rows.filter((r) => r.said !== null).length,
    inferred: rows.filter((r) => r.inferred !== null).length,
  }
}

/** `×1.3`, `×0.5`, `×1.25`: at most two decimals, no trailing zeros. */
export const fmtMultiplier = (m: number): string => `×${Number(m.toFixed(2))}`

/** A probability as a whole percent, `72 %`. */
export const fmtProbability = (p: number): string => `${Math.round(p * 100)} %`
