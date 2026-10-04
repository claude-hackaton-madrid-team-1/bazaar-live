/**
 * Reads db/venue.sql's six views every few seconds and keeps the last snapshot in memory for GET /api/venue, the way
 * ../view-poller.ts says. `poke()` also reads now when a Market Test starts.
 */
import { EMPTY_VENUE, type VenueParts, type VenueSnapshot } from '../../shared/venue.ts'
import { ViewPoller, type ViewPollerDeps } from '../view-poller.ts'
import { bookOf, matchOf, scoreOf, sessionOf, tradeOf, venueOf } from './rows.ts'

export const SQL = {
  venues: 'select venue, name, mechanism, fee_bps, fee_per_card, status, opened_tick, current, counted from show.venue_ours order by venue limit $1',
  sessions: `select * from (select id, day::text as day, session, start_tick, ticks, venues, ours, received_at
                              from show.venue_sessions order by id desc limit $1) s order by id`,
  books: `select * from (select run, day::text as day, first_tick, last_tick, ticks_seen, venue, fee_bps, fee_per_card, session, start_tick, offers
                           from show.venue_books order by day desc nulls last, first_tick desc limit $1) b order by day nulls first, first_tick`,
  matches: `select id, tick, kind, status, bench, run, card, ask, bid, price, fee, surplus, guardrail, error_code
              from show.venue_matches order by id desc limit $1`,
  trades: `select id, day::text as day, tick, type, venue, card, price, fee, side, maker, buyer, seller
             from show.venue_trades order by id desc limit $1`,
  score: `select * from (select day::text as day, tick, read_at, venue, bench_venue, bench_efficiency, bench_points, mm_points, market
                           from show.venue_score order by day desc, tick desc limit $1) s order by day, tick`,
} as const

/** Three days of sessions (12 a day) and books with room; up to 15 matches a tick for 16 ticks a session. */
export const CAPS = { venues: 10, sessions: 60, books: 60, matches: 1500, trades: 400, score: 1500 } as const

export class VenuePoller extends ViewPoller<keyof VenueParts, VenueSnapshot> {
  constructor(deps: ViewPollerDeps) {
    super({ route: 'venue', empty: EMPTY_VENUE, sql: SQL, caps: CAPS, intervalMs: 5_000 }, deps)
  }

  /** One read of the six views. Never throws. */
  async pollOnce(): Promise<void> {
    const prev = this.snapshot
    const read = this.begin()
    const venues = await this.view(read, 'venues', venueOf, prev.venues)
    const sessions = await this.view(read, 'sessions', sessionOf, prev.sessions)
    const books = await this.view(read, 'books', bookOf, prev.books)
    const matches = await this.view(read, 'matches', matchOf, prev.matches)
    const trades = await this.view(read, 'trades', tradeOf, prev.trades)
    const score = await this.view(read, 'score', scoreOf, prev.score)
    this.finish(read, { venues, sessions, books, matches, trades, score })
  }
}
