import { describe, expect, it } from 'vitest'
import { EMPTY_LEARN, type Learning, type LearnSnapshot, type TraderMove } from '../../../shared/learn.ts'
import { mockLearn } from '../learn.ts'
import { learningGroups, moveTone, pct, recentMoves, rivalRows, traderProfiles } from './learn.ts'

const L = (id: number, kind: string, extra: Partial<Learning> = {}): Learning => ({
  id, kind, subjectKind: 'dealer', subject: 'abuela', claim: `claim ${id}`, source: 'rules', confidence: 0.5, support: 1, createdTick: id, untilTick: null, team: null, stats: null, ...extra,
})

const snap = (over: Partial<LearnSnapshot>): LearnSnapshot => ({ ...EMPTY_LEARN, ...over })

describe('learningGroups', () => {
  const snapshot = snap({
    learnings: [
      L(1, 'cooloff', { untilTick: 110 }),
      L(2, 'quota', { untilTick: 103, subject: 'chato' }),
      L(3, 'blocker', { untilTick: 100 }), // lifted AT 100: until is exclusive
      L(4, 'lesson', { confidence: 0.4, support: 9 }),
      L(5, 'policy', { confidence: 0.9 }),
      L(6, 'tactic', { confidence: 0.4, support: 2 }),
      L(7, 'price_floor', { createdTick: 50 }),
      L(8, 'announcement', { createdTick: 90 }),
      L(9, 'fee_change', { untilTick: 99 }), // a fact that expired
    ],
  })

  it('splits blocking, lessons and facts, and counts what lifted', () => {
    const g = learningGroups(snapshot, 100)
    expect(g.inForce.map((l) => [l.id, l.left])).toEqual([
      [2, 3],
      [1, 10],
    ])
    expect(g.lifted).toBe(1)
    expect(g.lessons.map((l) => l.id)).toEqual([5, 4, 6])
    expect(g.facts.map((l) => l.id)).toEqual([8, 7])
  })

  it('keeps everything in force while the tick is unknown', () => {
    const g = learningGroups(snapshot, null)
    expect(g.inForce.map((l) => l.id).sort()).toEqual([1, 2, 3])
    expect(g.inForce.every((l) => l.left === null)).toBe(true)
    expect(g.lifted).toBe(0)
  })

  it('filters by subject, claim, kind and team', () => {
    expect(learningGroups(snapshot, 100, 'CHATO').inForce.map((l) => l.id)).toEqual([2])
    expect(learningGroups(snapshot, 100, 'claim 7').facts.map((l) => l.id)).toEqual([7])
  })
})

const M = (id: number, trader: string, thread: number, event: string, theirPrice: number | null, ours = false, tick = id): TraderMove => ({
  id, trader, thread, tick, event, ourPrice: null, theirPrice, step: null, final: event === 'final', ours,
})

describe('traderProfiles', () => {
  it('joins the curves with the moves: concessions, firmness, last tick', () => {
    const rows = traderProfiles(
      snap({
        dealers: [{ dealer: 'abuela', threads: 10, deals: 5, ourThreads: 2, ourDeals: 1, avgOpen: 20, avgFill: 12, fillRatio: 0.6, ourFillRatio: 0.5, avgSteps: 3, avgTicks: 4 }],
        moves: [M(4, 'abuela', 1, 'concede', 17, true), M(1, 'abuela', 1, 'open', 24, true), M(2, 'abuela', 1, 'concede', 20, true), M(3, 'abuela', 1, 'hold', 20), M(5, 'chato', 2, 'final', 33)],
      }),
    )
    expect(rows.map((r) => r.trader)).toEqual(['abuela', 'chato'])
    expect(rows[0]).toMatchObject({ moves: 4, ourMoves: 3, avgConcession: 3.5, lastTick: 4, events: { open: 1, concede: 2, hold: 1 } })
    expect(rows[0]?.firmness).toBeCloseTo(1 / 3)
    expect(rows[1]).toMatchObject({ stat: null, firmness: 1, avgConcession: null })
  })
})

describe('recentMoves and rivalRows', () => {
  const s = snap({ moves: [M(1, 'abuela', 1, 'open', 24, true), M(2, 'chato', 2, 'hold', 30), M(3, 'abuela', 3, 'deal', 15)] })

  it('shows ours or all, newest first, filtered', () => {
    expect(recentMoves(s, 'ours').map((m) => m.id)).toEqual([1])
    expect(recentMoves(s, 'all').map((m) => m.id)).toEqual([3, 2, 1])
    expect(recentMoves(s, 'all', 'abuela').map((m) => m.id)).toEqual([3, 1])
  })

  it('orders rivals by activity', () => {
    const r = rivalRows(mockLearn(50))
    expect(r.map((x) => x.team)).toEqual(['t03', 't12', 't17'])
  })
})

describe('helpers', () => {
  it('pct and moveTone', () => {
    expect(pct(0.634)).toBe('63%')
    expect(pct(null)).toBe('—')
    expect(moveTone('concede')).toBe('good')
    expect(moveTone('walk')).toBe('bad')
    expect(moveTone('final')).toBe('warn')
    expect(moveTone('open')).toBe('neutral')
  })
})

describe('mockLearn', () => {
  it('fills every part of the screen around the tick, with a lifted cooloff', () => {
    const g = learningGroups(mockLearn(30), 30)
    expect(g.inForce.length).toBeGreaterThan(2)
    expect(g.lifted).toBe(1)
    expect(g.lessons.length).toBeGreaterThan(2)
    expect(g.facts.length).toBeGreaterThan(2)
    expect(traderProfiles(mockLearn(30)).length).toBe(3)
  })
})
