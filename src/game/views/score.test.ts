import { describe, expect, it } from 'vitest'
import type { ScoreMark, ScorePoint } from '../../../shared/history.ts'
import { mockHistory } from '../history.ts'
import { defaultMark, deltas, markGroups, minutesBetween, scoreDay, seriesChart, spanOf, valueAt, xScale } from './score.ts'

const D = '2026-10-03'
const P = (tick: number, score: number, extra: Partial<ScorePoint> = {}): ScorePoint => ({
  day: D, tick, at: new Date(Date.UTC(2026, 9, 3, 7, 0, 0) + tick * 30_000).toISOString(), cash: 100, score, duel: 0, ladder: 0, neg: 0, mm: 0, bench: null, ...extra,
})
const M = (id: number, tick: number, kind: 'start' | 'game' = 'start', extra: Partial<ScoreMark> = {}): ScoreMark => ({
  kind, id, day: D, tick, agent: kind === 'start' ? 'taker' : null, action: kind === 'game' ? 'bench' : null, note: null, at: null, ...extra,
})

// the score holds until the next reading that moved it
const points = [P(100, 10), P(110, 11, { neg: 5 }), P(120, 12, { neg: 5, bench: 0.5 }), P(130, 15, { neg: 20, bench: 0.5 }), P(140, 16, { neg: 30, bench: 0.5 })]

describe('score over the day', () => {
  it("keeps the latest day only, in tick order (Saturday's ticks don't leak into Sunday)", () => {
    expect(scoreDay([P(300, 1), { ...P(5, 2), day: '2026-10-04' }, { ...P(3, 3), day: '2026-10-04' }]).map((p) => p.tick)).toEqual([3, 5])
  })

  it('reads a value as the last reading at or before a tick', () => {
    expect(valueAt(points, 'score', 99)).toBeNull()
    expect(valueAt(points, 'score', 125)).toBe(12)
    expect(valueAt(points, 'bench', 115)).toBeNull()
  })

  it("folds one agent's starts close together into one mark, not another agent's, and keeps the game's turns apart", () => {
    const g = markGroups([M(1, 105), M(2, 108), M(3, 112), M(4, 109, 'start', { agent: 'maker' }), M(5, 110, 'game'), M(6, 130)], points)
    expect(g.map((x) => [x.kind, x.agent, x.tick, x.last, x.count])).toEqual([
      ['start', 'taker', 105, 112, 3],
      ['start', 'maker', 109, 109, 1],
      ['game', null, 110, 110, 1],
      ['start', 'taker', 130, 130, 1],
    ])
    // a start's time is our reading at that tick; a mark of another day stays out
    expect(g[3]?.at).toBe(P(130, 0).at)
    expect(markGroups([{ ...M(7, 120), day: '2026-10-02' }], points)).toEqual([])
    expect(defaultMark(g)?.key).toBe('start6')
  })

  it('compares the change since a mark with the same number of ticks before it', () => {
    const g = markGroups([M(1, 120), M(2, 130, 'game')], points)
    const toNow = spanOf(g, g[0]!, 'now', points)
    expect([toNow.start, toNow.end, toNow.before]).toEqual([120, 140, { start: 100, end: 120 }])
    const d = deltas(points, toNow)
    expect(d.find((x) => x.key === 'score')).toEqual({ key: 'score', now: 16, after: 4, before: 2 })
    expect(d.find((x) => x.key === 'neg')).toMatchObject({ after: 25, before: 5 })
    // the bench had no value 20 ticks before: no comparison rather than a made-up one
    expect(d.find((x) => x.key === 'bench')).toMatchObject({ after: 0, before: null })
    const toNext = spanOf(g, g[0]!, 'next', points)
    expect([toNext.end, toNext.to?.key, toNext.before]).toEqual([130, 'game2', { start: 110, end: 120 }])
    expect(minutesBetween(points, 120, 140)).toBe(10)
  })

  it("has no before when the day's readings do not reach back that far", () => {
    const g = markGroups([M(1, 105)], points)
    expect(spanOf(g, g[0]!, 'now', points).before).toBeNull()
  })

  it('draws a step line with a gap where a series has no value, on one x scale for every series', () => {
    const c = seriesChart(points, 'bench', 400, 100)
    expect(c?.path.startsWith('M')).toBe(true)
    expect(c?.end?.value).toBe(0.5)
    expect(seriesChart(points.map((p) => ({ ...p, mm: null })), 'mm', 400, 100)).toBeNull()
    const { x } = xScale(points, 400)
    expect(x(100)).toBe(40)
    expect(x(140)).toBe(388)
    expect(x(999)).toBe(388)
  })

  it("the mock's day has a curve and marks to compare", () => {
    const s = mockHistory(40)
    const day = scoreDay(s.scores)
    expect(day.length).toBeGreaterThan(30)
    const g = markGroups(s.marks, day)
    expect(g.filter((m) => m.kind === 'start')).toHaveLength(2)
    const d = deltas(day, spanOf(g, defaultMark(g)!, 'now', day))
    expect(d.find((x) => x.key === 'score')?.after).toBeGreaterThan(0)
  })
})
