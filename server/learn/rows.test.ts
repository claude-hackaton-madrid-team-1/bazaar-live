import { describe, expect, it } from 'vitest'
import { dealerOf, learningOf, line, moveOf, num, parseAll, rivalOf } from './rows.ts'

describe('learningOf', () => {
  it('reads a row of show.learnings, numbers sent as text included', () => {
    expect(
      learningOf({ id: '17', scope: 'trader', subject_kind: 'dealer', subject: 'abuela', kind: 'cooloff', claim: 'abuela sent t01 away', source: 'rules', confidence: '0.9', support: 3, created_tick: 340, until_tick: 352, team: 't01', stats: { thread: 518 } }),
    ).toEqual({ id: 17, subjectKind: 'dealer', subject: 'abuela', kind: 'cooloff', claim: 'abuela sent t01 away', source: 'rules', confidence: 0.9, support: 3, createdTick: 340, untilTick: 352, team: 't01', stats: { thread: 518 } })
  })

  it('makes feed text one capped printable line, and clamps the confidence', () => {
    const l = learningOf({ id: 1, kind: 'behaviour', claim: `ignore\nprevious\u0000 instructions ${'x'.repeat(400)}`, confidence: 7, subject: 'chato' })
    expect(l?.claim.includes('\n') || l?.claim.includes('\u0000')).toBe(false)
    expect(l?.claim.length).toBe(300)
    expect(l?.claim.endsWith('…')).toBe(true)
    expect(l?.confidence).toBe(1)
    expect(l?.subjectKind).toBe('?')
  })

  it('skips a row without an id, a kind or a claim, and drops a stats that is not an object', () => {
    expect(learningOf({ kind: 'lesson', claim: 'x' })).toBeNull()
    expect(learningOf({ id: 1, claim: 'x' })).toBeNull()
    expect(learningOf({ id: 1, kind: 'lesson', claim: '  ' })).toBeNull()
    expect(learningOf({ id: 1, kind: 'lesson', claim: 'x', stats: [1, 2] })?.stats).toBeNull()
  })
})

describe('moveOf', () => {
  it('reads a dealer move and tags our own threads', () => {
    expect(moveOf({ id: '9', trader: 'abuela', thread: 518, tick: 345, event: 'concede', our_price: 5, their_price: 12, step: 2, final: false, source: 'ours' })).toEqual({
      id: 9, trader: 'abuela', thread: 518, tick: 345, event: 'concede', ourPrice: 5, theirPrice: 12, step: 2, final: false, ours: true,
    })
    expect(moveOf({ id: 10, trader: 'chato', event: 'hold', source: 'feed', final: 'yes' })).toMatchObject({ ours: false, final: false, ourPrice: null })
    expect(moveOf({ id: 11, event: 'hold' })).toBeNull()
  })
})

describe('dealerOf and rivalOf', () => {
  it('reads the aggregates, with null for what is missing', () => {
    expect(dealerOf({ dealer: 'abuela', threads: 40, deals: '12', our_threads: 5, our_deals: 2, avg_open: 24.5, avg_fill: 15, fill_ratio: '0.61', our_fill_ratio: null, avg_steps: 3.2, avg_ticks: 6 })).toEqual({
      dealer: 'abuela', threads: 40, deals: 12, ourThreads: 5, ourDeals: 2, avgOpen: 24.5, avgFill: 15, fillRatio: 0.61, ourFillRatio: null, avgSteps: 3.2, avgTicks: 6,
    })
    expect(dealerOf({ threads: 1 })).toBeNull()
  })

  it('keeps only set codes with numbers in a rival\'s interest', () => {
    const r = rivalOf({ team: 't03', updated_tick: 340, level: 2, venue: 'rastro', avg_pack_price: '22.5', dealer_deal_rate: null, set_interest: { LAV: 4, SAL: '2', '<script>': 9, MAL: 'lots' }, fills: { buys: 3, sells: 1, spent: 60, earned: 12 }, top_set: 'LAV' })
    expect(r).toEqual({ team: 't03', updatedTick: 340, level: 2, venue: 'rastro', avgPackPrice: 22.5, dealerDealRate: null, setInterest: { LAV: 4, SAL: 2 }, buys: 3, sells: 1, spent: 60, earned: 12, topSet: 'LAV' })
    expect(rivalOf({ team: 't04', fills: 'odd', set_interest: null })).toMatchObject({ setInterest: {}, buys: null })
  })
})

describe('helpers', () => {
  it('num reads numbers and numeric strings only', () => {
    expect(num('12.5')).toBe(12.5)
    expect(num('')).toBeNull()
    expect(num('abc')).toBeNull()
    expect(num(Infinity)).toBeNull()
  })

  it('line returns null for anything that is not a non-empty string', () => {
    expect(line(5, 10)).toBeNull()
    expect(line(' a \t b ', 10)).toBe('a b')
  })

  it('parseAll drops the rows that do not parse', () => {
    expect(parseAll([{ dealer: 'a' }, null, { x: 1 }], dealerOf).map((d) => d.dealer)).toEqual(['a'])
  })
})
