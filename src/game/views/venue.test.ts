import { describe, expect, it } from 'vitest'
import { EMPTY_VENUE, type BenchBook, type BenchSession, type BrokerMatch, type OurVenue, type VenueSnapshot } from '../../../shared/venue.ts'
import { mockVenue, venueStateOf } from '../venue.ts'
import { VENUE_STRINGS } from '../venueStrings.ts'
import type { BenchRun } from '../state.ts'
import { activityOf, benchScoreOf, clockOf, feeOn, madridDay, possibleOf, sessionRows, venueNow } from './venue.ts'

const TODAY = '2026-10-04'
const v = (over: Partial<OurVenue> & Pick<OurVenue, 'venue'>): OurVenue => ({
  name: null, mechanism: 'board', feeBps: 0, feePerCard: 0, status: 'open', openedTick: 900, current: false, counted: false, ...over,
})
const session = (n: number, start: number, day = TODAY, ours: boolean | null = true): BenchSession => ({ day, session: n, startTick: start, ticks: 16, venues: 19, ours, at: null })
const trader = (id: string, side: 'buy' | 'sell', quote: number) => ({ id, side, quote, first: 1402, last: 1416 })
const match = (id: number, status: string, surplus: number, over: Partial<BrokerMatch> = {}): BrokerMatch => ({
  id, tick: 1403, kind: 'broker_match', status, bench: true, run: 'b35', card: null, ask: 40, bid: 40 + surplus, price: 45, fee: 0, surplus, guardrail: null, errorCode: null, ...over,
})
const book: BenchBook = {
  run: 'b35', day: TODAY, firstTick: 1402, lastTick: 1416, ticksSeen: 15, venue: 'v19', feeBps: 0, feePerCard: 0, session: 6, startTick: 1401,
  traders: [trader('b35-1', 'sell', 40), trader('b35-2', 'buy', 62), trader('b35-3', 'buy', 30), trader('b35-4', 'sell', 50), trader('b35-5', 'buy', 55)],
}
const snap = (over: Partial<VenueSnapshot> = {}): VenueSnapshot => ({ ...EMPTY_VENUE, ...over })

describe('venueNow', () => {
  it('takes the venue /me counts, open', () => {
    const now = venueNow([v({ venue: 'v19', current: true, counted: true }), v({ venue: 'v20', mechanism: 'auto' })])
    expect(now.best?.venue).toBe('v19')
    expect(now.others.map((o) => o.venue)).toEqual(['v20'])
    expect(now.warn).toBeNull()
  })

  it('warns when nothing is open, when it is closing, when the open one is auto, when /me counts another', () => {
    expect(venueNow([]).warn).toBe('none_open')
    expect(venueNow([v({ venue: 'v19', status: 'closed', counted: true })]).warn).toBe('none_open')
    expect(venueNow([v({ venue: 'v19', status: 'closing', counted: true })]).warn).toBe('closing')
    expect(venueNow([v({ venue: 'v20', mechanism: 'auto', current: true })]).warn).toBe('auto')
    expect(venueNow([v({ venue: 'v19', current: true }), v({ venue: 'v08', status: 'closed', counted: true })]).warn).toBe('not_counted')
  })
})

describe('possibleOf', () => {
  it('pairs the highest bids with the lowest asks while they cross after the fee', () => {
    // 62 − 40 and 55 − 50; 30 never crosses
    expect(possibleOf(book.traders, 0, 0)).toEqual({ pairs: 2, surplus: 27 })
    // a 20 % fee: 50 + 10 > 55 stops the second pair (40 + 8 ≤ 62 still crosses)
    expect(possibleOf(book.traders, 2000, 0)).toEqual({ pairs: 1, surplus: 22 })
    expect(feeOn(50, 1000, 1)).toBe(6)
  })
})

describe('sessionRows', () => {
  const base = snap({
    sessions: [session(5, 1161), session(6, 1401), session(6, 1401, '2026-10-03')],
    books: [book],
    matches: [match(1, 'done', 22), match(2, 'failed', 5, { errorCode: 'wait_for_tick' }), match(3, 'rejected', 5), match(4, 'done', 99, { run: 'b34' }), match(5, 'done', 2, { bench: false, run: null, card: 'LAV-03' })],
    score: [
      { day: TODAY, tick: 1180, at: null, venue: 'v19', benchVenue: 'v19', efficiency: 0.769, benchPoints: 0.5, mmPoints: 2, market: 8 },
      { day: TODAY, tick: 1420, at: null, venue: 'v19', benchVenue: 'v19', efficiency: 0.912, benchPoints: 0.5, mmPoints: 2.3, market: 8 },
    ],
  })

  it('reads each session newest first: its book, what the broker took and lost, and /me after it', () => {
    const rows = sessionRows(base, [], TODAY, 1500)
    expect(rows.map((r) => [r.day, r.session])).toEqual([[TODAY, 6], [TODAY, 5], ['2026-10-03', 6]])
    expect(rows[0]).toMatchObject({
      live: false, seen: true, buyers: 3, sellers: 2, matched: 1, failed: 1, refused: 1, expired: 0, errors: ['wait_for_tick'],
      captured: 22, possible: 27, possiblePairs: 2, efficiency: 0.912, points: 0.5,
    })
    expect(rows[0]?.share).toBeCloseTo(22 / 27)
    expect(rows[1]).toMatchObject({ seen: false, efficiency: 0.769 })
    // the other day's session 6 is not today's book
    expect(rows[2]).toMatchObject({ seen: false, efficiency: null })
  })

  it('a session in its 16 ticks is live, with no result yet; the stream adds a start the database has not read', () => {
    const rows = sessionRows(base, [], TODAY, 1405)
    expect(rows[0]).toMatchObject({ session: 6, live: true, efficiency: null })
    const run: BenchRun = { eventId: 1, session: 7, startTick: 1641, ticks: 16, venues: ['v19'], finishedTick: null }
    expect(sessionRows(base, [run], TODAY, 1645)[0]).toMatchObject({ session: 7, live: true, seen: false })
  })
})

describe('clockOf', () => {
  it('counts down from today\'s starts at the cadence, learned from earlier days when today has one start', () => {
    const s = snap({ sessions: [session(1, 201, '2026-10-03'), session(2, 441, '2026-10-03'), session(1, 201)] })
    expect(clockOf(s, [], TODAY, 300).next).toEqual({ session: 2, tick: 441, inTicks: 141 })
    expect(clockOf(s, [], TODAY, 300, 40).next).toMatchObject({ tick: 321 })
    expect(clockOf(s, [], TODAY, 210).running).toMatchObject({ session: 1, left: 7 })
    expect(clockOf(snap(), [], TODAY, 50).next).toBeNull()
  })
})

describe('activityOf and benchScoreOf', () => {
  it('counts today\'s trades of other teams on our venue and the public pairs our broker matched', () => {
    const a = activityOf(snap({
      trades: [
        { id: 3, day: TODAY, tick: 1503, type: 'settled', venue: 'v19', card: 'LAV-03', price: 12, fee: 0, side: null, maker: null, buyer: 't09', seller: 't07' },
        { id: 2, day: TODAY, tick: 1500, type: 'listed', venue: 'v19', card: 'LAV-03', price: 12, fee: null, side: 'sell', maker: 't07', buyer: null, seller: null },
        { id: 1, day: '2026-10-03', tick: 900, type: 'settled', venue: 'v19', card: 'MAL-01', price: 50, fee: 0, side: null, maker: null, buyer: 't02', seller: 't03' },
      ],
      matches: [match(5, 'done', 2, { bench: false }), match(6, 'rejected', 2, { bench: false })],
    }), TODAY)
    expect(a).toMatchObject({ listed: 1, settled: 1, failed: 0, volume: 12, teams: 2, brokered: 1, brokerStopped: 1 })
    expect(a.latest.map((t) => t.id)).toEqual([3, 2])
  })

  it('says where the bench points sit against the free stall', () => {
    const p = (benchPoints: number | null) => benchScoreOf([{ day: TODAY, tick: 1, at: null, venue: null, benchVenue: null, efficiency: 0.9, benchPoints, mmPoints: 2, market: 8 }]).level
    expect([p(0.5), p(0.3), p(0.7), p(1), p(null)]).toEqual(['stall', 'below_stall', 'above_stall', 'top', null])
    expect(benchScoreOf([])).toEqual({ efficiency: null, benchPoints: null, mmPoints: null, level: null })
  })

  it('keys rows by the Madrid date', () => {
    expect(madridDay(Date.parse('2026-10-03T22:30:00Z'))).toBe('2026-10-04')
  })
})

describe('venueStateOf and the mock', () => {
  it('reads the answer: locked, off, an error keeping the last snapshot', () => {
    expect(venueStateOf(401, {}, EMPTY_VENUE).status).toBe('locked')
    expect(venueStateOf(200, { enabled: false }, EMPTY_VENUE).status).toBe('off')
    const prev = mockVenue(30, TODAY)
    expect(venueStateOf(500, null, prev)).toEqual({ status: 'error', snapshot: prev })
    expect(venueStateOf(200, { enabled: true, at: 'x', parts: { venues: true }, venues: [], sessions: 'nope' }, EMPTY_VENUE).snapshot).toMatchObject({ parts: { venues: true, books: false }, sessions: [] })
  })

  it('plays yesterday at the real cadence and a session on within seconds of opening', () => {
    const m = mockVenue(5, TODAY)
    const rows = sessionRows(m, [], TODAY, 5)
    expect(rows[0]).toMatchObject({ day: TODAY, session: 1, live: true, seen: true })
    expect(rows.filter((r) => r.day !== TODAY)).toHaveLength(6)
    expect(rows.filter((r) => r.day !== TODAY).every((r) => r.efficiency !== null)).toBe(true)
    expect(venueNow(m.venues).best?.venue).toBe('v19')
  })

  it('has every word in both languages', () => {
    expect(Object.keys(VENUE_STRINGS.es).sort()).toEqual(Object.keys(VENUE_STRINGS.en).sort())
    expect(VENUE_STRINGS.en.fee(250, 1)).toBe('fee 2.5 % + 1 P/card')
    expect(VENUE_STRINGS.es.fee(0, 0)).toBe('comisión 0 %')
  })
})
