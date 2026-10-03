import { describe, expect, it } from 'vitest'
import type { CashPoint, TeamEvent, Trade } from '../../../shared/history.ts'
import { cashChart, cashSummary, filterMovements, lastCashChange, movements, ordersOf, tradeAmount } from './history.ts'

const D = '2026-10-03'
const P = (tick: number, cash: number, day = D): CashPoint => ({ day, tick, cash, score: null, rank: null })
const T = (id: number, tick: number, side: 'buy' | 'sell', price: number, fee: number, extra: Partial<Trade> = {}): Trade => ({
  id, day: D, tick, side, price, fee, counterparty: side === 'buy' ? 't02' : 't06', venue: 'rastro', card: 'SAL-10', cardName: null, rarity: null, items: 1, ...extra,
})
const E = (id: number, tick: number, type: string, extra: Partial<TeamEvent> = {}): TeamEvent => ({
  id, day: D, tick, type, venue: null, name: null, bond: null, pack: null, best: null, cash: null, level: null, why: null, ...extra,
})

// the real afternoon: 72 + 5 fee out at 163, a 250 bond at 262 (the change was 270), 76 in at 376
const points = [P(160, 312), P(163, 235), P(262, 389 - 270 + 0), P(300, 119), P(376, 195)]
const trades = [T(1, 56, 'buy', 7, 0, { venue: null, counterparty: 'abuela' }), T(2, 163, 'buy', 72, 5), T(3, 376, 'sell', 76, 5)]
const events = [E(9, 262, 'venue.opened', { venue: 'v19', bond: 250 }), E(10, 285, 'pack.opened', { pack: 'sobre_bienvenida', best: 'SAL-10' })]

describe('movements', () => {
  const rows = movements({ points, trades, events })

  it('explains each change of cash by the trades and events since the last reading, newest first', () => {
    expect(rows.map((m) => [m.tick, m.delta, m.cashAfter])).toEqual([
      [376, 76, 195],
      [300, 0, 119],
      [262, -116, 119],
      [163, -77, 235],
      [56, null, null],
    ])
    expect(rows[3]?.lines.map((l) => [l.kind, l.amount])).toEqual([['buy', -77]])
  })

  it('shows what a change does not account for as "other", not hidden', () => {
    expect(rows[2]?.lines.map((l) => [l.kind, l.amount])).toEqual([['bond', -250], ['other', 134]])
  })

  it('keeps an event that moves no cash, and a trade before the first reading on its own', () => {
    expect(rows[1]?.lines.map((l) => [l.kind, l.amount])).toEqual([['pack', null]])
    expect(rows[4]?.lines[0]?.trade?.counterparty).toBe('abuela')
  })

  it('a new day sorts after the old one even when its ticks start again', () => {
    const next = movements({ points: [P(390, 100), P(5, 150, '2026-10-04')], trades: [T(4, 3, 'sell', 50, 0, { day: '2026-10-04' })], events: [] })
    expect(next[0]).toMatchObject({ day: '2026-10-04', tick: 5, delta: 50 })
    expect(next[0]?.lines.map((l) => l.kind)).toEqual(['sell'])
  })

  it('filters money in and money out', () => {
    expect(filterMovements(rows, 'in').map((m) => m.tick)).toEqual([376])
    expect(filterMovements(rows, 'out').map((m) => m.tick)).toEqual([262, 163, 56])
    expect(filterMovements(rows, 'all')).toHaveLength(5)
  })
})

describe('cashSummary', () => {
  it('reads the latest day: now, open, low, high, in, out, fees and the last change', () => {
    expect(cashSummary({ points, trades, events })).toEqual({
      now: 195, day: D, tick: 376, open: 312, low: 119, high: 312,
      earned: 76, spent: 7 + 77 + 250, fees: 5, buys: 2, sells: 1,
      last: { delta: 76, tick: 376 },
    })
  })

  it('is empty without readings', () => {
    expect(cashSummary({ points: [], trades: [], events: [] })).toMatchObject({ now: null, open: null, last: null, earned: 0 })
  })
})

describe('cashChart', () => {
  it('draws a step line of the latest day with a mark at each change', () => {
    const c = cashChart(points, 400, 100)
    expect(c?.path.startsWith('M40.0,')).toBe(true)
    expect(c?.marks.map((m) => [m.tick, m.tone])).toEqual([[163, 'out'], [262, 'out'], [376, 'in']])
    expect(c?.end?.x).toBeCloseTo(388)
    expect(c?.yTicks[0]?.value).toBe(0)
    expect(cashChart([], 400, 100)).toBeNull()
  })
})

describe('ledger and amounts', () => {
  it('a buyer pays the fee, a seller gets the price', () => {
    expect(tradeAmount(T(1, 1, 'buy', 20, 2))).toBe(-22)
    expect(tradeAmount(T(1, 1, 'sell', 20, 2))).toBe(20)
  })

  it('lists one agent\'s orders, newest first', () => {
    const o = (id: number, agent: string) => ({ id, day: D, tick: id, kind: 'listing', price: 10, item: 'LAV-04', agent })
    expect(ordersOf([o(1, 'maker'), o(3, 'taker'), o(2, 'maker')], 'maker').map((x) => x.id)).toEqual([2, 1])
  })
})

describe('lastCashChange', () => {
  it('finds the newest reading that differs from the one before it', () => {
    expect(lastCashChange([{ tick: 1, cash: 100 }, { tick: 2, cash: 80 }, { tick: 3, cash: 80 }])).toEqual({ delta: -20, tick: 2 })
    expect(lastCashChange([{ tick: 1, cash: 100 }, { tick: 2, cash: 100 }])).toBeNull()
    expect(lastCashChange([])).toBeNull()
  })
})
