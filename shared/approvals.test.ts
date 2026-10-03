import { describe, expect, it } from 'vitest'
import { approvalsOf, approveInputOf, approveResultOf, CONTRACT_LIMITS, revokeInputOf, revokeResultOf, stripControls } from './approvals.ts'

describe('approvalsOf', () => {
  it('keeps the contract fields only, cleans text and counts the rows it could not read', () => {
    const snap = approvalsOf({
      tick: 912,
      threshold: 250,
      pending: [
        { card: 'SAL-09', side: 'buy', price: 260, state: 'waiting', why: 'price\u202e 260\n≥ 250', extra: 1, album: { set: 'SAL', held: 'one' } },
        { card: 'SAL-09', side: 'buy', price: 0, state: 'waiting' },
        'junk',
      ],
      active: [{ card: 'LAV-10', side: 'sell', until_tick: 1100, min_price: 300 }, { card: 'LAV-10', side: 'sell' }],
      limits: { price_max: 5000, ttl_default: 100 },
      notes: ['a', 7, 'b'],
    })
    expect(snap).not.toBeNull()
    expect(snap!.skipped).toBe(3)
    expect(snap!.pending).toEqual([
      {
        card: 'SAL-09', side: 'buy', price: 260, asked_tick: null, stale_after_tick: null, state: 'waiting', counterparty: null, asked_by: null,
        why: 'price 260 ≥ 250', official_value: null, our_value: null, score_impact: null, album: null, cap: null,
      },
    ])
    expect(snap!.active).toEqual([{ card: 'LAV-10', side: 'sell', max_price: null, min_price: 300, until_tick: 1100, by: null, reason: null, created_at: null }])
    // a limit outside the contract keeps the contract's bound; one inside is taken
    expect(snap!.limits).toEqual({ ...CONTRACT_LIMITS, ttl_default: 100 })
    expect(snap!.notes).toEqual(['a', 'b'])
  })

  it('refuses a reply without the contract\'s shape', () => {
    expect(approvalsOf(null)).toBeNull()
    expect(approvalsOf({ tick: 1, threshold: 250, pending: {}, active: [] })).toBeNull()
    expect(approvalsOf({ tick: 1.5, threshold: 250, pending: [], active: [] })).toBeNull()
  })
})

describe('approveInputOf / revokeInputOf', () => {
  const good = { card: 'SAL-09', side: 'buy', price: 260, ttl_ticks: 240 }

  it('takes a body inside the ranges, the ttl defaulting to 240 and a blank reason dropped', () => {
    expect(approveInputOf(good)).toEqual(good)
    expect(approveInputOf({ ...good, ttl_ticks: undefined, reason: '   ' })).toEqual({ ...good, ttl_ticks: 240 })
    expect(approveInputOf({ ...good, price: 1, ttl_ticks: 480 })).toEqual({ ...good, price: 1, ttl_ticks: 480 })
    expect(approveInputOf({ ...good, price: 1000, ttl_ticks: 1, reason: 'x'.repeat(300) })).toMatchObject({ price: 1000, reason: 'x'.repeat(300) })
    expect(revokeInputOf({ card: 'LAV-10', side: 'sell', reason: 'a\tb' })).toEqual({ card: 'LAV-10', side: 'sell', reason: 'a b' })
  })

  it('names the field that is out of range', () => {
    expect(approveInputOf({ ...good, price: 1001 })).toMatch(/^price/)
    expect(approveInputOf({ ...good, price: 1.5 })).toMatch(/^price/)
    expect(approveInputOf({ ...good, ttl_ticks: 0 })).toMatch(/^ttl_ticks/)
    expect(approveInputOf({ ...good, card: 'SAL09' })).toMatch(/^card/)
    expect(approveInputOf({ ...good, reason: 'x'.repeat(301) })).toMatch(/^reason/)
    expect(approveInputOf([])).toMatch(/object/)
    expect(revokeInputOf({ card: 'SAL-09', side: 'sold' })).toMatch(/^side/)
  })
})

describe('the write results', () => {
  it('reads approved, refused, revoked and denied, and nothing else', () => {
    expect(approveResultOf({ status: 'approved', card: 'SAL-09', side: 'buy', max_price: 260, until_tick: 1150 })).toMatchObject({ status: 'approved', max_price: 260, min_price: null, notes: [] })
    expect(approveResultOf({ status: 'refused', card: 'SAL-09', side: 'buy', price: 260, reasons: ['cap'] })).toEqual({ status: 'refused', card: 'SAL-09', side: 'buy', price: 260, reasons: ['cap'] })
    expect(approveResultOf({ status: 'maybe', card: 'SAL-09', side: 'buy' })).toBeNull()
    expect(revokeResultOf({ status: 'revoked', card: 'SAL-09', side: 'sell', tick: 3 })).toEqual({ status: 'revoked', card: 'SAL-09', side: 'sell', tick: 3, by: null })
    expect(revokeResultOf({ status: 'approved', card: 'SAL-09', side: 'sell' })).toBeNull()
  })

  it('strips control characters and bidi overrides', () => {
    expect(stripControls('a\u0000b\u202ec\u2066d')).toBe('a b c d')
    expect(stripControls(3)).toBeNull()
  })
})
