/**
 * The score over the day and what may have moved it: the score and its parts per tick (db/history.sql's
 * score_points), the marks where something changed (an agent started, a round, a Market Test), and per part
 * how much it moved after a mark against the same number of ticks before it. That last comparison is the
 * answer to "did the change help?". Pure, over shared/history.ts.
 *
 * The parts are in their own units (the score is not their sum), so each one gets its own scale.
 */
import type { ScoreMark, ScorePoint } from '../../../shared/history.ts'

export type SeriesKey = 'score' | 'duel' | 'ladder' | 'neg' | 'mm' | 'bench' | 'cash'

/** The order the strips are drawn in: the score, its five parts, then cash. */
export const SERIES: readonly SeriesKey[] = ['score', 'duel', 'ladder', 'neg', 'mm', 'bench', 'cash']

/** Starts of the same agent this close together (in ticks) are one change: a deploy, or a crash loop. */
export const FOLD_TICKS = 10

/** The latest day's points, in tick order (the tick may start again on a new day). */
export function scoreDay(scores: readonly ScorePoint[]): ScorePoint[] {
  const day = scores.reduce<string | null>((d, p) => (d === null || p.day > d ? p.day : d), null)
  return scores.filter((p) => p.day === day).sort((a, b) => a.tick - b.tick)
}

/** The value of a series at a tick: the last reading at or before it, or null before the first. */
export function valueAt(points: readonly ScorePoint[], key: SeriesKey, tick: number): number | null {
  let v: number | null = null
  for (const p of points) {
    if (p.tick > tick) break
    v = p[key]
  }
  return v
}

/** One marker on the chart: a single mark, or a burst of starts of one agent folded together. */
export interface MarkGroup {
  readonly key: string
  readonly kind: 'start' | 'game'
  readonly agent: string | null
  readonly action: string | null
  readonly note: string | null
  /** The first tick: where the change began. */
  readonly tick: number
  /** The last start of a folded burst (= tick for one mark). */
  readonly last: number
  readonly count: number
  /** When it happened (ISO): the game's own time, or our reading at that tick for a start. */
  readonly at: string | null
}

/** When we read the score at or just after a tick (a start carries a tick and no time). */
function timeAt(points: readonly ScorePoint[], tick: number): string | null {
  return points.find((p) => p.tick >= tick)?.at ?? points.filter((p) => p.tick <= tick).at(-1)?.at ?? null
}

/** The latest day's marks in tick order, an agent's starts within FOLD_TICKS of each other folded into one. */
export function markGroups(marks: readonly ScoreMark[], points: readonly ScorePoint[]): MarkGroup[] {
  const day = points[0]?.day
  const today = marks.filter((m) => m.day === day).sort((a, b) => a.tick - b.tick || a.id - b.id)
  const out: MarkGroup[] = []
  const open = new Map<string, number>()
  for (const m of today) {
    if (m.kind === 'start' && m.agent) {
      const i = open.get(m.agent)
      const g = i === undefined ? undefined : out[i]
      if (g && m.tick - g.last <= FOLD_TICKS) {
        out[i as number] = { ...g, last: m.tick, count: g.count + 1 }
        continue
      }
      open.set(m.agent, out.length)
    }
    out.push({
      key: `${m.kind}${m.id}`,
      kind: m.kind,
      agent: m.agent,
      action: m.action,
      note: m.note,
      tick: m.tick,
      last: m.tick,
      count: 1,
      at: m.at ?? timeAt(points, m.tick),
    })
  }
  return out.sort((a, b) => a.tick - b.tick)
}

/** The mark to compare from when nobody picked one: our latest start, else the latest mark. */
export function defaultMark(groups: readonly MarkGroup[]): MarkGroup | null {
  return groups.filter((g) => g.kind === 'start').at(-1) ?? groups.at(-1) ?? null
}

export type Until = 'now' | 'next'

export interface Span {
  readonly from: MarkGroup
  /** The mark it runs to, or null: now. */
  readonly to: MarkGroup | null
  readonly start: number
  readonly end: number
  /** The same number of ticks before the mark, or null when the day's readings do not reach back that far. */
  readonly before: { readonly start: number; readonly end: number } | null
}

/** From a mark to now, or to the next mark after it. */
export function spanOf(groups: readonly MarkGroup[], from: MarkGroup, until: Until, points: readonly ScorePoint[]): Span {
  const lastTick = points.at(-1)?.tick ?? from.tick
  const next = until === 'next' ? (groups.find((g) => g.tick > from.tick) ?? null) : null
  const end = Math.max(from.tick, next ? next.tick : lastTick)
  const len = end - from.tick
  const firstTick = points[0]?.tick ?? from.tick
  return { from, to: next, start: from.tick, end, before: len > 0 && from.tick - len >= firstTick ? { start: from.tick - len, end: from.tick } : null }
}

export interface SeriesDelta {
  readonly key: SeriesKey
  readonly now: number | null
  /** How much it moved over the span. */
  readonly after: number | null
  /** How much it moved over the same number of ticks before the mark. */
  readonly before: number | null
}

const diff = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : Math.round((b - a) * 1000) / 1000)

export function deltas(points: readonly ScorePoint[], span: Span): SeriesDelta[] {
  return SERIES.map((key) => ({
    key,
    now: valueAt(points, key, span.end),
    after: diff(valueAt(points, key, span.start), valueAt(points, key, span.end)),
    before: span.before ? diff(valueAt(points, key, span.before.start), valueAt(points, key, span.before.end)) : null,
  }))
}

/** Minutes between our readings at two ticks, or null without their times. */
export function minutesBetween(points: readonly ScorePoint[], a: number, b: number): number | null {
  const ta = points.find((p) => p.tick >= a)?.at
  const tb = points.filter((p) => p.tick <= b).at(-1)?.at
  if (!ta || !tb) return null
  const ms = Date.parse(tb) - Date.parse(ta)
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60_000)) : null
}

/** A series has something to show: a value at some tick. */
export const hasSeries = (points: readonly ScorePoint[], key: SeriesKey): boolean => points.some((p) => p[key] !== null)

// --- geometry ---------------------------------------------------------------------------------------------

export interface Pad {
  readonly l: number
  readonly r: number
  readonly t: number
  readonly b: number
}

export const PAD: Pad = { l: 40, r: 12, t: 14, b: 22 }

/** The day's tick → x, shared by the main chart and every strip so their marks line up. */
export function xScale(points: readonly ScorePoint[], w: number, pad: Pad = PAD): { x: (tick: number) => number; t0: number; t1: number; tick: (x: number) => number } {
  const t0 = points[0]?.tick ?? 0
  const t1 = Math.max(points.at(-1)?.tick ?? t0, t0 + 1)
  const span = Math.max(1, w - pad.l - pad.r)
  return {
    t0,
    t1,
    x: (tick) => pad.l + ((Math.min(Math.max(tick, t0), t1) - t0) / (t1 - t0)) * span,
    tick: (x) => Math.round(t0 + ((Math.min(Math.max(x, pad.l), w - pad.r) - pad.l) / span) * (t1 - t0)),
  }
}

const niceStep = (span: number, n: number): number => {
  const raw = span / n
  if (!(raw > 0)) return 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  return ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
}

export interface SeriesChart {
  /** The step line: a value holds until the next reading; a gap where the series has no value. */
  readonly path: string
  readonly yTicks: readonly { readonly y: number; readonly value: number }[]
  readonly y: (v: number) => number
  readonly end: { readonly x: number; readonly y: number; readonly value: number } | null
}

/**
 * One series as a step line in a w×h box. `zero`: the axis starts at 0 (the main chart); otherwise it fits
 * the series' own range (a strip, where the movement is the point).
 */
export function seriesChart(points: readonly ScorePoint[], key: SeriesKey, w: number, h: number, pad: Pad = PAD, zero = true): SeriesChart | null {
  const vals = points.flatMap((p) => (p[key] === null ? [] : [p[key] as number]))
  if (!vals.length) return null
  const { x } = xScale(points, w, pad)
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  if (zero) lo = Math.min(0, lo)
  if (hi - lo < 1e-9) {
    const d = Math.abs(hi) > 0 ? Math.abs(hi) * 0.5 : 1
    lo = zero ? Math.min(0, lo) : lo - d
    hi = hi + d
  }
  const step = niceStep(hi - lo, zero ? 4 : 2)
  const min = zero ? Math.floor(lo / step) * step : lo
  const max = zero ? Math.max(min + step, Math.ceil(hi / step) * step) : hi
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b)
  let d = ''
  let prev: number | null = null
  for (const p of points) {
    const v = p[key]
    const px = x(p.tick).toFixed(1)
    if (v === null) {
      if (prev !== null) d += ` H${px}`
      prev = null
      continue
    }
    d += prev === null ? `${d ? ' ' : ''}M${px},${y(v).toFixed(1)}` : ` H${px} V${y(v).toFixed(1)}`
    prev = v
  }
  const yTicks: { y: number; value: number }[] = []
  if (zero) for (let v = min; v <= max + step / 2; v += step) yTicks.push({ y: y(v), value: Math.round(v * 100) / 100 })
  const lastP = [...points].reverse().find((p) => p[key] !== null)
  const lastV = lastP?.[key] ?? null
  return { path: d, yTicks, y, end: lastP && lastV !== null ? { x: x(lastP.tick), y: y(lastV), value: lastV } : null }
}

/** Tick labels along the bottom: about one every 90 px. */
export function xTicks(points: readonly ScorePoint[], w: number, pad: Pad = PAD): { x: number; tick: number }[] {
  const { x, t0, t1 } = xScale(points, w, pad)
  const step = Math.max(1, niceStep(t1 - t0, Math.max(2, Math.floor((w - pad.l - pad.r) / 90))))
  const out: { x: number; tick: number }[] = []
  for (let tk = Math.ceil(t0 / step) * step; tk <= t1; tk += step) out.push({ x: x(tk), tick: tk })
  return out
}
