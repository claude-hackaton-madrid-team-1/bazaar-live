/**
 * Other teams' set multipliers, as our agent stores them (bazaar `team_affinity`, read through db/game.sql's
 * `show.game_team_affinity`), relayed on the game stream as the sticky status `agent.affinity` {rows}.
 *
 * Two sources per (team, set): `said`, what the team TOLD us in a thread (its words: unverified, the quote is
 * another team's untrusted text), and `inferred`, what our agent estimated from its trades, with a probability.
 * Both the server (rows from the database) and the page (the relayed payload) read them through this file.
 */
import { cleanQuote } from './clean.ts'

export const AFFINITY_QUOTE_MAX = 200
/** 18 teams × 6 sets is 108: room for more sets, never an unbounded payload. */
export const MAX_AFFINITY_ROWS = 200
/** The game's multipliers are 0.5 to about 1.6; anything far outside is not a multiplier. */
const MAX_MULTIPLIER = 5

const TEAM = /^t\d{1,3}$/
const SET = /^[A-Z]{3}$/

export interface TeamAffinity {
  readonly team: string
  readonly set: string
  /** What the team said, null when it said nothing (or nothing readable). */
  readonly said: number | null
  readonly saidConfidence: number | null
  readonly saidTick: number | null
  /** Its words, plain text (no markup, links or voice tags), at most AFFINITY_QUOTE_MAX characters. */
  readonly quote: string | null
  /** What our agent inferred from the team's trades, with its probability (0..1). */
  readonly inferred: number | null
  readonly inferredConfidence: number | null
  readonly inferredTick: number | null
}

export interface AffinityPayload {
  readonly rows: readonly TeamAffinity[]
}

type Row = Readonly<Record<string, unknown>>

const isRow = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v)

/** numeric and float8 may arrive as text: a finite number, or null. */
function num(v: unknown): number | null {
  const n = typeof v === 'string' && /^-?\d{1,6}(?:\.\d{1,12})?$/.test(v.trim()) ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function multiplier(v: unknown): number | null {
  const n = num(v)
  return n !== null && n > 0 && n <= MAX_MULTIPLIER ? n : null
}

function probability(v: unknown): number | null {
  const n = num(v)
  return n !== null && n >= 0 && n <= 1 ? n : null
}

function tick(v: unknown): number | null {
  const n = num(v)
  return n !== null && Number.isSafeInteger(n) && n >= 0 ? n : null
}

const pick = (r: Row, snake: string, camel: string): unknown => (snake in r ? r[snake] : r[camel])

/**
 * One row of show.game_team_affinity (snake_case) or of a relayed payload (camelCase), validated: a team id,
 * a set code, and at least one multiplier in range. Each side's confidence and tick only travel with its value.
 */
export function cleanAffinityRow(raw: unknown): TeamAffinity | null {
  if (!isRow(raw)) return null
  const team = raw.team
  const set = pick(raw, 'set_code', 'set')
  if (typeof team !== 'string' || !TEAM.test(team) || typeof set !== 'string' || !SET.test(set)) return null
  const said = multiplier(raw.said)
  const inferred = multiplier(raw.inferred)
  if (said === null && inferred === null) return null
  return {
    team, set, said,
    saidConfidence: said === null ? null : probability(pick(raw, 'said_confidence', 'saidConfidence')),
    saidTick: said === null ? null : tick(pick(raw, 'said_tick', 'saidTick')),
    quote: said === null ? null : cleanQuote(raw.quote, AFFINITY_QUOTE_MAX),
    inferred,
    inferredConfidence: inferred === null ? null : probability(pick(raw, 'inferred_confidence', 'inferredConfidence')),
    inferredTick: inferred === null ? null : tick(pick(raw, 'inferred_tick', 'inferredTick')),
  }
}

/** Every valid row, the first of each (team, set), sorted by team then set, at most MAX_AFFINITY_ROWS. */
export function cleanAffinityPayload(rows: unknown): TeamAffinity[] {
  if (!Array.isArray(rows)) return []
  const seen = new Map<string, TeamAffinity>()
  for (const raw of rows) {
    const r = cleanAffinityRow(raw)
    const key = r === null ? '' : `${r.team}/${r.set}`
    if (r !== null && !seen.has(key)) seen.set(key, r)
  }
  return [...seen.values()]
    .sort((a, b) => (a.team === b.team ? a.set.localeCompare(b.set) : a.team.localeCompare(b.team)))
    .slice(0, MAX_AFFINITY_ROWS)
}
