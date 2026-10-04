/**
 * Every team's score over the day, and where they beat us (db/teams_score.sql's board reads). Pure, over
 * shared/history.ts's TeamScore.
 *
 * Only the board's own numbers are compared, ours included (never /me's private parts): score = negotiating + market,
 * in points and normalised the same way for every team, so those three compare like with like. pages, deals and level
 * score nothing by themselves: they are context, shown in their own units and never ranked against a part in points.
 */
import type { ScoreMark, TeamScore } from '../../../shared/history.ts'

export type BoardPart = 'score' | 'negotiating' | 'market' | 'pages' | 'deals' | 'level'

/** The board's parts in points: the score is their sum. */
export const POINT_PARTS = ['negotiating', 'market'] as const satisfies readonly BoardPart[]
/** What scores nothing by itself. */
export const CONTEXT_PARTS = ['pages', 'deals', 'level'] as const satisfies readonly BoardPart[]

export const isScored = (part: BoardPart): boolean => part === 'score' || (POINT_PARTS as readonly BoardPart[]).includes(part)

export const partOf = (r: TeamScore, part: BoardPart): number | null => r[part]

/** The latest day's reads, in tick order (the tick may start again on a new day). */
export function boardDay(rows: readonly TeamScore[]): TeamScore[] {
  const day = rows.reduce<string | null>((d, r) => (d === null || r.day > d ? r.day : d), null)
  return rows.filter((r) => r.day === day).sort((a, b) => a.tick - b.tick || a.team.localeCompare(b.team))
}

export interface Board {
  /** Every tick some team's read was kept, in order. */
  readonly ticks: readonly number[]
  /** When each of those ticks was read (ISO): the earliest read at that tick. */
  readonly times: ReadonlyMap<number, string>
  /** Every team on the board, by its latest rank. */
  readonly teams: readonly string[]
  /** Each team's reads, in tick order. */
  readonly series: ReadonlyMap<string, readonly TeamScore[]>
}

export function boardOf(rows: readonly TeamScore[]): Board {
  const day = boardDay(rows)
  const series = new Map<string, TeamScore[]>()
  const times = new Map<number, string>()
  for (const r of day) {
    const list = series.get(r.team)
    if (list) list.push(r)
    else series.set(r.team, [r])
    const t = times.get(r.tick)
    if (r.at && (!t || r.at < t)) times.set(r.tick, r.at)
  }
  const ticks = [...new Set(day.map((r) => r.tick))]
  const last = (team: string) => series.get(team)?.at(-1)
  const teams = [...series.keys()].sort((a, b) => (last(a)?.rank ?? 99) - (last(b)?.rank ?? 99) || a.localeCompare(b))
  return { ticks, times, teams, series }
}

export const lastTick = (b: Board): number | null => b.ticks.at(-1) ?? null

/** A team's read at a tick: the last one at or before it (the lines are steps), or null before its first. */
export function readAt(b: Board, team: string, tick: number): TeamScore | null {
  let hit: TeamScore | null = null
  for (const r of b.series.get(team) ?? []) {
    if (r.tick > tick) break
    hit = r
  }
  return hit
}

/** The board's tick at or before a tick (the reading the crosshair is on), or the first one. */
export function boardTickAt(b: Board, tick: number): number | null {
  let hit: number | null = b.ticks[0] ?? null
  for (const k of b.ticks) {
    if (k > tick) break
    hit = k
  }
  return hit
}

/** One step along the board's ticks from a tick, kept within the day. */
export function stepBoardTick(b: Board, tick: number, dir: -1 | 1): number | null {
  if (!b.ticks.length) return null
  const at = boardTickAt(b, tick) ?? (b.ticks[0] as number)
  const i = b.ticks.indexOf(at)
  const to = dir > 0 ? i + 1 : at < tick ? i : i - 1
  return b.ticks[Math.min(Math.max(to, 0), b.ticks.length - 1)] ?? null
}

/** When a tick happened (ISO): between the board reads around it, in proportion. Null without times. */
export function timeAt(b: Board, tick: number): string | null {
  let a: number | null = null
  let c: number | null = null
  for (const k of b.ticks) {
    if (!b.times.has(k)) continue
    if (k <= tick) a = k
    if (k >= tick && c === null) c = k
  }
  const ta = a === null ? null : (b.times.get(a) as string)
  const tc = c === null ? null : (b.times.get(c) as string)
  if (ta === null || tc === null || a === null || c === null) return ta ?? tc
  if (a === c) return ta
  const ma = Date.parse(ta)
  return new Date(ma + ((Date.parse(tc) - ma) * (tick - a)) / (c - a)).toISOString()
}

/** The tick a moment fell on: the inverse of timeAt, between the reads around it. Null outside the day's reads. */
export function tickAtTime(b: Board, ms: number): number | null {
  const known = b.ticks.filter((k) => b.times.has(k)).map((k) => ({ k, ms: Date.parse(b.times.get(k) as string) }))
  for (let i = 1; i < known.length; i++) {
    const a = known[i - 1] as { k: number; ms: number }
    const c = known[i] as { k: number; ms: number }
    if (ms >= a.ms && ms <= c.ms) return c.ms === a.ms ? a.k : a.k + ((c.k - a.k) * (ms - a.ms)) / (c.ms - a.ms)
  }
  return known.length === 1 && known[0]?.ms === ms ? known[0].k : null
}

/** Seconds between a tick and the board's latest read, by the reads' times; null without them. */
export function secondsBefore(b: Board, tick: number): number | null {
  const last = lastTick(b)
  const a = timeAt(b, tick)
  const z = last === null ? null : timeAt(b, last)
  return a && z ? Math.max(0, (Date.parse(z) - Date.parse(a)) / 1000) : null
}

export interface Standing {
  readonly team: string
  readonly value: number
  readonly rank: number
}

/**
 * Every team's value of a part at a tick, highest first. For the score, the board's own rank (it breaks ties as the
 * game does); for a part, the place by value (teams level share it).
 */
export function standingAt(b: Board, tick: number, part: BoardPart = 'score'): Standing[] {
  const rows = b.teams.flatMap((team) => {
    const r = readAt(b, team, tick)
    const value = r ? partOf(r, part) : null
    return r && value !== null ? [{ team, value, boardRank: r.rank }] : []
  })
  rows.sort((a, c) => (part === 'score' ? a.boardRank - c.boardRank : c.value - a.value) || a.team.localeCompare(c.team))
  return rows.map((r) => ({ team: r.team, value: r.value, rank: part === 'score' ? r.boardRank : 1 + rows.filter((o) => o.value > r.value).length }))
}

/** Our value against one team's (or the mean's): ours − theirs, so above zero we lead. */
export interface Versus {
  readonly team: string | null
  readonly value: number
  readonly gap: number
}

export interface GapRow {
  readonly part: BoardPart
  readonly scored: boolean
  readonly ours: number
  /** Our place in this part, of `of` teams. */
  readonly place: number
  readonly of: number
  readonly leader: Versus | null
  readonly above: Versus | null
  /** The mean of every other team. */
  readonly mean: Versus | null
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000

/** Who we are compared with: the board's leader (the next one when we lead) and the team just above us. */
export interface Rivals {
  readonly leader: string | null
  readonly above: string | null
  /** Our rank on the board. */
  readonly rank: number | null
}

export function rivalsAt(b: Board, us: string, tick: number): Rivals {
  const table = standingAt(b, tick)
  const i = table.findIndex((s) => s.team === us)
  if (i < 0) return { leader: table[0]?.team ?? null, above: null, rank: null }
  const others = table.filter((s) => s.team !== us)
  return { leader: others[0]?.team ?? null, above: i > 0 ? (table[i - 1]?.team ?? null) : null, rank: table[i]?.rank ?? null }
}

/**
 * Per part, us against the leader, the team just above us and the mean of the others, at a tick. The score first,
 * then its two parts with the one where we trail the mean most first (same unit, points), then the context parts
 * with our worst place first (a place has no unit, so counts of different things still sort together).
 */
export function gapsAt(b: Board, us: string, tick: number): GapRow[] {
  const ourRead = readAt(b, us, tick)
  if (!ourRead) return []
  const who = rivalsAt(b, us, tick)
  const versus = (team: string | null, part: BoardPart, ours: number): Versus | null => {
    const r = team ? readAt(b, team, tick) : null
    const v = r ? partOf(r, part) : null
    return team && v !== null ? { team, value: v, gap: r3(ours - v) } : null
  }
  const rows: GapRow[] = []
  for (const part of ['score', ...POINT_PARTS, ...CONTEXT_PARTS] as BoardPart[]) {
    const ours = partOf(ourRead, part)
    if (ours === null) continue
    const table = standingAt(b, tick, part)
    const others = table.filter((s) => s.team !== us)
    const mean = others.length ? others.reduce((n, s) => n + s.value, 0) / others.length : null
    rows.push({
      part,
      scored: isScored(part),
      ours,
      place: table.find((s) => s.team === us)?.rank ?? table.length,
      of: table.length,
      leader: versus(who.leader, part, ours),
      above: versus(who.above, part, ours),
      mean: mean === null ? null : { team: null, value: r3(mean), gap: r3(ours - mean) },
    })
  }
  const head = rows.filter((r) => r.part === 'score')
  const points = rows.filter((r) => r.scored && r.part !== 'score').sort((a, c) => (a.mean?.gap ?? 0) - (c.mean?.gap ?? 0))
  const context = rows.filter((r) => !r.scored).sort((a, c) => c.place / c.of - a.place / a.of)
  return [...head, ...points, ...context]
}

export interface Headline {
  /** The part in points where we trail the mean most, or null when we trail in none. */
  readonly worst: { readonly part: BoardPart; readonly gap: number } | null
  /** The part in points where we lead the mean most; else a context part where we sit in the top half (scored false). */
  readonly best: { readonly part: BoardPart; readonly gap: number; readonly scored: boolean } | null
  /** The part in points where the leader beats us most (null when we lead the board or trail it in none). */
  readonly leader: { readonly team: string; readonly part: BoardPart; readonly gap: number } | null
}

/** Gaps under this (in points, or in a context part's units) count as level. */
export const LEVEL = 0.005

/** "Where do they beat us, and where do we beat them?" in two answers, from gapsAt's rows. */
export function headline(rows: readonly GapRow[]): Headline {
  const points = rows.filter((r) => r.scored && r.part !== 'score' && r.mean)
  const trail = points.filter((r) => (r.mean as Versus).gap < -LEVEL).sort((a, c) => (a.mean as Versus).gap - (c.mean as Versus).gap)[0]
  const lead = points.filter((r) => (r.mean as Versus).gap > LEVEL).sort((a, c) => (c.mean as Versus).gap - (a.mean as Versus).gap)[0]
  const ctx = rows.filter((r) => !r.scored && r.mean && (r.mean as Versus).gap > LEVEL && r.place <= Math.ceil(r.of / 2)).sort((a, c) => a.place / a.of - c.place / c.of)[0]
  const best = lead ?? ctx
  const top = points.filter((r) => r.leader && r.leader.gap < -LEVEL && r.place > 1).sort((a, c) => (a.leader as Versus).gap - (c.leader as Versus).gap)[0]
  const onTop = rows.find((r) => r.part === 'score')?.place === 1
  return {
    worst: trail ? { part: trail.part, gap: (trail.mean as Versus).gap } : null,
    best: best ? { part: best.part, gap: (best.mean as Versus).gap, scored: best.scored } : null,
    leader: top && !onTop ? { team: (top.leader as Versus).team as string, part: top.part, gap: (top.leader as Versus).gap } : null,
  }
}

/** The teams to draw in colour by default: the top three and the teams just above and below us (never us). */
export function defaultPick(b: Board, us: string, tick: number, max = 5): string[] {
  const table = standingAt(b, tick)
  const i = table.findIndex((s) => s.team === us)
  const near = i < 0 ? [] : [table[i - 1]?.team, table[i + 1]?.team]
  const top = table.slice(0, 4).map((s) => s.team)
  const out: string[] = []
  for (const team of [...top.filter((t) => t !== us).slice(0, 3), ...near]) if (team && team !== us && !out.includes(team)) out.push(team)
  return out.slice(0, max)
}

/** A team that crossed us between two board reads, and how much its score moved. */
export interface Crossing {
  readonly team: string
  readonly score: number
  /** Its part in points that moved most (by size), or null when neither did. */
  readonly part: 'negotiating' | 'market' | null
  readonly partDelta: number
}

export interface RankChange {
  readonly tick: number
  /** The board read before. */
  readonly from: number
  readonly before: number
  readonly after: number
  /** How our own numbers moved over the same reads. */
  readonly ours: { readonly score: number; readonly negotiating: number | null; readonly market: number | null }
  /** Below us before, above us after. */
  readonly passedUs: readonly Crossing[]
  /** Above us before, below us after. */
  readonly wePassed: readonly Crossing[]
  /** Our own move explains it (our score moved more than any team that crossed us), else the others' play does. */
  readonly cause: 'ours' | 'theirs'
  /** What may explain it on our side: our agents' starts and the game's turns between the two reads. */
  readonly marks: readonly ScoreMark[]
}

const delta = (a: number | null | undefined, c: number | null | undefined): number | null => (a == null || c == null ? null : r3(c - a))

function crossing(b: Board, team: string, from: number, to: number): Crossing {
  const a = readAt(b, team, from)
  const c = readAt(b, team, to)
  const moves = POINT_PARTS.map((p) => ({ p, d: delta(a?.[p], c?.[p]) ?? 0 })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
  const top = moves[0]
  return { team, score: delta(a?.score, c?.score) ?? 0, part: top && Math.abs(top.d) > LEVEL ? top.p : null, partDelta: top?.d ?? 0 }
}

/** Our rank changes over the day, the latest first, each with what changed it. `marks`: the day's ScoreMarks. */
export function rankChanges(b: Board, us: string, marks: readonly ScoreMark[] = []): RankChange[] {
  const out: RankChange[] = []
  const day = b.series.get(us)?.[0]?.day
  for (let i = 1; i < b.ticks.length; i++) {
    const from = b.ticks[i - 1] as number
    const tick = b.ticks[i] as number
    const was = readAt(b, us, from)
    const now = readAt(b, us, tick)
    if (!was || !now || was.rank === now.rank) continue
    const passedUs: Crossing[] = []
    const wePassed: Crossing[] = []
    for (const team of b.teams) {
      if (team === us) continue
      const a = readAt(b, team, from)
      const c = readAt(b, team, tick)
      if (!a || !c) continue
      if (a.rank > was.rank && c.rank < now.rank) passedUs.push(crossing(b, team, from, tick))
      if (a.rank < was.rank && c.rank > now.rank) wePassed.push(crossing(b, team, from, tick))
    }
    const score = r3(now.score - was.score)
    out.push({
      tick,
      from,
      before: was.rank,
      after: now.rank,
      ours: { score, negotiating: delta(was.negotiating, now.negotiating), market: delta(was.market, now.market) },
      passedUs: passedUs.sort((x, y) => y.score - x.score),
      wePassed: wePassed.sort((x, y) => x.score - y.score),
      cause: Math.abs(score) > LEVEL && [...passedUs, ...wePassed].every((x) => Math.abs(score) > Math.abs(x.score)) ? 'ours' : 'theirs',
      marks: marks.filter((m) => m.day === day && m.tick > from && m.tick <= tick),
    })
  }
  return out.reverse()
}

// --- geometry ---------------------------------------------------------------------------------------------

export interface Pad {
  readonly l: number
  readonly r: number
  readonly t: number
  readonly b: number
}

export const BOARD_PAD: Pad = { l: 40, r: 76, t: 10, b: 22 }

export function boardX(b: Board, w: number, pad: Pad = BOARD_PAD): { x: (tick: number) => number; tick: (x: number) => number; t0: number; t1: number } {
  const t0 = b.ticks[0] ?? 0
  const t1 = Math.max(b.ticks.at(-1) ?? t0, t0 + 1)
  const span = Math.max(1, w - pad.l - pad.r)
  return {
    t0,
    t1,
    x: (tick) => pad.l + ((Math.min(Math.max(tick, t0), t1) - t0) / (t1 - t0)) * span,
    tick: (x) => Math.round(t0 + ((Math.min(Math.max(x, pad.l), w - pad.r) - pad.l) / span) * (t1 - t0)),
  }
}

/** A round step for an axis: 1, 2, 2.5 or 5 times a power of ten, about `n` of them over the span. */
export function niceStep(span: number, n: number): number {
  const raw = span / n
  if (!(raw > 0)) return 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  return ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
}

/** A team's value (a part, or its rank) as a step line: it holds until its next read, and to the board's last tick. */
export function stepPath(b: Board, team: string, value: (r: TeamScore) => number | null, x: (tick: number) => number, y: (v: number) => number): string {
  const end = lastTick(b)
  let d = ''
  let prev: number | null = null
  for (const r of b.series.get(team) ?? []) {
    const v = value(r)
    if (v === null) continue
    d += prev === null ? `M${x(r.tick).toFixed(1)},${y(v).toFixed(1)}` : ` H${x(r.tick).toFixed(1)} V${y(v).toFixed(1)}`
    prev = v
  }
  if (prev !== null && end !== null) d += ` H${x(end).toFixed(1)}`
  return d
}

/** The score axis: from 0 to a round number over the highest score of the day. */
export function scoreAxis(b: Board, h: number, pad: Pad = BOARD_PAD): { y: (v: number) => number; ticks: number[] } {
  let hi = 0
  for (const list of b.series.values()) for (const r of list) hi = Math.max(hi, r.score)
  const step = niceStep(Math.max(hi, 1), 4)
  const max = Math.max(step, Math.ceil(hi / step) * step)
  const ticks: number[] = []
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(Math.round(v * 100) / 100)
  return { y: (v) => pad.t + (1 - v / max) * (h - pad.t - pad.b), ticks }
}

/** The rank axis: 1 on top, the board's size at the bottom. */
export function rankAxis(b: Board, h: number, pad: Pad = BOARD_PAD): { y: (rank: number) => number; ticks: number[] } {
  const n = Math.max(2, b.teams.length)
  const step = n > 12 ? 5 : n > 6 ? 2 : 1
  const ticks = [1]
  for (let r = step; r <= n; r += step) if (r > 1) ticks.push(r)
  return { y: (rank) => pad.t + ((rank - 1) / (n - 1)) * (h - pad.t - pad.b), ticks }
}

/** Clock labels along the bottom: round times (5, 10, 15, 30 min, 1 h, 2 h apart), about one every 90 px. */
export function timeTicks(b: Board, w: number, pad: Pad = BOARD_PAD): { x: number; at: string }[] {
  const first = b.ticks.find((k) => b.times.has(k))
  const last = [...b.ticks].reverse().find((k) => b.times.has(k))
  if (first === undefined || last === undefined || first === last) return []
  const m0 = Date.parse(b.times.get(first) as string)
  const m1 = Date.parse(b.times.get(last) as string)
  const n = Math.max(2, Math.floor((w - pad.l - pad.r) / 90))
  const minutes = [5, 10, 15, 30, 60, 120, 240].find((m) => (m1 - m0) / (m * 60_000) <= n) ?? 240
  const step = minutes * 60_000
  const { x } = boardX(b, w, pad)
  const out: { x: number; at: string }[] = []
  for (let ms = Math.ceil(m0 / step) * step; ms <= m1; ms += step) {
    const tick = tickAtTime(b, ms)
    if (tick !== null) out.push({ x: x(tick), at: new Date(ms).toISOString() })
  }
  return out
}
