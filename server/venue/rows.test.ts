import { describe, expect, it } from 'vitest'
import { bookOf, matchOf, scoreOf, sessionOf, tradeOf, venueOf } from './rows.ts'

describe('venue rows', () => {
  it('reads a venue of ours; an odd id is no venue, an unknown status null', () => {
    expect(venueOf({ venue: 'v19', name: 'Team 1\nmarket', mechanism: 'board', fee_bps: 0, fee_per_card: 0, status: 'open', opened_tick: 900, current: true, counted: true })).toEqual({
      venue: 'v19', name: 'Team 1 market', mechanism: 'board', feeBps: 0, feePerCard: 0, status: 'open', openedTick: 900, current: true, counted: true,
    })
    expect(venueOf({ venue: 'v08', status: 'gone' })).toMatchObject({ status: null, current: false, counted: false })
    expect(venueOf({ venue: '<script>' })).toBeNull()
  })

  it('reads a session: a day and a start tick make one', () => {
    expect(sessionOf({ day: '2026-10-04', session: 6, start_tick: 1401, ticks: 16, venues: '19', ours: true, received_at: '2026-10-04T10:03:00Z' })).toEqual({
      day: '2026-10-04', session: 6, startTick: 1401, ticks: 16, venues: 19, ours: true, at: '2026-10-04T10:03:00.000Z',
    })
    expect(sessionOf({ day: '2026-10-04', session: 6 })).toBeNull()
  })

  it('reads a book with each trader checked', () => {
    const b = bookOf({ run: 'b35', day: '2026-10-04', first_tick: 1402, last_tick: 1416, ticks_seen: 15, venue: 'v19', fee_bps: 0, fee_per_card: 0, session: 6, start_tick: 1401,
      offers: [{ id: 'b35-1', side: 'sell', quote: 40, first: 1402, last: 1405 }, { id: 'b35-2', side: 'hold', quote: 1, first: 1, last: 1 }, 'x'] })
    expect(b).toMatchObject({ run: 'b35', session: 6, ticksSeen: 15, traders: [{ id: 'b35-1', side: 'sell', quote: 40, first: 1402, last: 1405 }] })
    expect(bookOf({ run: 'b35' })).toBeNull()
  })

  it('reads a match: the card only as a card code', () => {
    expect(matchOf({ id: '6', tick: 1502, kind: 'broker_match', status: 'rejected', bench: false, card: 'LAV-03', ask: 10, bid: 12, price: 11, fee: 0, surplus: '2.0', guardrail: 'denied: x', error_code: null })).toMatchObject({
      id: 6, bench: false, card: 'LAV-03', surplus: 2, guardrail: 'denied: x', errorCode: null, run: null,
    })
    expect(matchOf({ id: 1, tick: 1, kind: 'broker_match', status: 'done', card: 'card:LAV-03' })?.card).toBeNull()
    expect(matchOf({ id: 1, kind: 'broker_match', status: 'done' })).toBeNull()
  })

  it('reads a trade and a score point', () => {
    expect(tradeOf({ id: '7', day: '2026-10-04', tick: 1503, type: 'settled', venue: 'v19', card: 'LAV-03', price: 12, fee: 0, buyer: 't09', seller: 't07' })).toMatchObject({ id: 7, type: 'settled', side: null, maker: null })
    expect(tradeOf({ id: 1, tick: 1, type: 'other' })).toBeNull()
    expect(scoreOf({ day: '2026-10-04', tick: 1420, venue: 'v19', bench_venue: 'v19', bench_efficiency: '0.9120', bench_points: null, mm_points: '2.3', market: 8.4 })).toEqual({
      day: '2026-10-04', tick: 1420, at: null, venue: 'v19', benchVenue: 'v19', efficiency: 0.912, benchPoints: null, mmPoints: 2.3, market: 8.4,
    })
  })
})
