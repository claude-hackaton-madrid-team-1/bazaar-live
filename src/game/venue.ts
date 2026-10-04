/**
 * The Venue screen's source: GET /api/venue as soon as the server says its rows changed, at once when the game stream
 * announces a Market Test (`wake`), and on a timer as the fallback (shorter while a session runs), with `?token=` when the
 * page has one; or a made-up day with `?mock=1`. Keeps the last good snapshot through an error, like ./strategy.ts.
 */
import { useMemo } from 'react'
import { usePolled } from '../net/poll.ts'
import { pollEvery, type PagePush } from './fresh.ts'
import { EMPTY_VENUE, type BenchBook, type BenchSession, type BenchTrader, type BrokerMatch, type VenueScorePoint, type VenueSnapshot, type VenueTrade } from '../../shared/venue.ts'
import { rng } from '../stage/rng.ts'
import { MOCK_BENCH } from './mock.ts'
import { possibleOf } from './views/venue.ts'

export type VenueStatus = 'loading' | 'live' | 'off' | 'locked' | 'error' | 'mock'

export interface VenueState {
  readonly status: VenueStatus
  readonly snapshot: VenueSnapshot
}

/** While a session runs the screen reads this often, whatever the notices say. */
export const LIVE_POLL_MS = 3_000

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** An answer of /api/venue → the screen's state. The server already checked every row. */
export function venueStateOf(httpStatus: number, body: unknown, prev: VenueSnapshot): VenueState {
  if (httpStatus === 401) return { status: 'locked', snapshot: EMPTY_VENUE }
  if (httpStatus !== 200 || !isObject(body)) return { status: 'error', snapshot: prev }
  if (body.enabled !== true) return { status: 'off', snapshot: EMPTY_VENUE }
  const parts = isObject(body.parts) ? body.parts : {}
  return {
    status: 'live',
    snapshot: {
      at: typeof body.at === 'string' ? body.at : null,
      parts: {
        venues: parts.venues === true, sessions: parts.sessions === true, books: parts.books === true,
        matches: parts.matches === true, trades: parts.trades === true, score: parts.score === true,
      },
      venues: list(body.venues),
      sessions: list(body.sessions),
      books: list(body.books),
      matches: list(body.matches),
      trades: list(body.trades),
      score: list(body.score),
    },
  }
}

/**
 * `push`: the server's notices for this screen (./fresh.ts); `wake`: anything that should read now (a Market Test the
 * stream just announced); `running`: a session is on, so the timer stays short.
 */
export function useVenue(mock: boolean, token: string | null, tick: number, today: string, push: PagePush | null, wake: string, running: boolean): VenueState {
  const intervalMs = running ? LIVE_POLL_MS : pollEvery('venue', push)
  const pushed = push?.at ?? null
  // a new notice or a new session reads now and starts the timer again from there
  const state = usePolled<VenueState>(mock ? null : `/api/venue${token ? `?token=${encodeURIComponent(token)}` : ''}`, { status: 'loading', snapshot: EMPTY_VENUE }, intervalMs, `${pushed}|${wake}`, venueStateOf)
  const mocked = useMemo<VenueState | null>(() => (mock ? { status: 'mock', snapshot: mockVenue(tick, today) } : null), [mock, tick, today])
  return mocked ?? state
}

// ── the mock ────────────────────────────────────────────────────────────────────────────────────────────────────────

const { first: MOCK_FIRST, cadence: MOCK_CADENCE, ticks: MOCK_TICKS } = MOCK_BENCH
const MOCK_VENUE = 'v19'

const dayBefore = (day: string): string => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * One session's book and what our broker did with it, up to `now` (a live session shows what has happened so far).
 * Every third session has a hard book (12 traders); the broker matches the crossing quotes greedily, one pair a tick,
 * and now and then the game answers `wait_for_tick` or a guardrail stops one.
 */
function mockSession(day: string, session: number, start: number, now: number, run: string, ids: { next: number }) {
  const r = rng(start * 31 + session * 7 + day.length)
  const per = session % 3 === 0 ? 6 : 5
  const traders: BenchTrader[] = []
  for (let k = 0; k < per; k++) traders.push({ id: `${run}-${2 * k + 1}`, side: 'sell', quote: 20 + Math.floor(r() * 45), first: start + 1, last: start + MOCK_TICKS - 1 })
  for (let k = 0; k < per; k++) traders.push({ id: `${run}-${2 * k + 2}`, side: 'buy', quote: 35 + Math.floor(r() * 50), first: start + 1, last: start + MOCK_TICKS - 1 })
  const asks = traders.filter((t) => t.side === 'sell').sort((a, b) => (a.quote ?? 0) - (b.quote ?? 0))
  const bids = traders.filter((t) => t.side === 'buy').sort((a, b) => (b.quote ?? 0) - (a.quote ?? 0))
  const matches: BrokerMatch[] = []
  const pairs = possibleOf(traders, 0, 0).pairs
  for (let k = 0; k < pairs; k++) {
    const tick = start + 2 + k
    if (tick > now) break
    const ask = asks[k]
    const bid = bids[k]
    if (!ask || !bid) break
    const roll = r()
    const status = roll < 0.12 ? 'failed' : roll < 0.18 ? 'rejected' : 'done'
    if (status === 'done') {
      traders[traders.indexOf(ask)] = { ...ask, last: tick }
      traders[traders.indexOf(bid)] = { ...bid, last: tick }
    }
    matches.push({
      id: ids.next++, tick, kind: 'broker_match', status, bench: true, run, card: null, ask: ask.quote, bid: bid.quote,
      price: Math.floor(((ask.quote ?? 0) + (bid.quote ?? 0)) / 2), fee: 0, surplus: (bid.quote ?? 0) - (ask.quote ?? 0),
      guardrail: status === 'rejected' ? 'denied: max_matches_per_tick 15' : null, errorCode: status === 'failed' ? 'wait_for_tick' : null,
    })
  }
  const lastTick = Math.min(now, start + MOCK_TICKS - 1)
  const book: BenchBook = {
    run, day, firstTick: start + 1, lastTick, ticksSeen: Math.max(0, lastTick - start), venue: MOCK_VENUE, feeBps: 0, feePerCard: 0, session, startTick: start,
    traders: traders.map((t) => ({ ...t, last: Math.min(t.last, lastTick) })),
  }
  return { book, matches, efficiency: Math.round((0.72 + r() * 0.25) * 1000) / 1000 }
}

/**
 * A made-up Market Test around `tick` for `?mock=1`: yesterday's six sessions at the real cadence (every 240 ticks from
 * 201), today's at the mock game's (every 40 ticks from tick 2, so one is on within seconds of opening the screen), our
 * board venue v19 at 0 %, bench points level with the free stall, and a little trade by other teams on our venue.
 */
export function mockVenue(tick: number, today: string): VenueSnapshot {
  const now = Math.max(0, tick)
  const yesterday = dayBefore(today)
  const sessions: BenchSession[] = []
  const books: BenchBook[] = []
  const matches: BrokerMatch[] = []
  const score: VenueScorePoint[] = []
  const ids = { next: 5000 }
  let run = 30
  const add = (day: string, session: number, start: number, until: number) => {
    sessions.push({ day, session, startTick: start, ticks: MOCK_TICKS, venues: 19, ours: true, at: null })
    const s = mockSession(day, session, start, until, `b${run++}`, ids)
    books.push(s.book)
    matches.push(...s.matches)
    if (until >= start + MOCK_TICKS + 1) {
      score.push({ day, tick: start + MOCK_TICKS + 1, at: null, venue: MOCK_VENUE, benchVenue: MOCK_VENUE, efficiency: s.efficiency, benchPoints: 0.5, mmPoints: 2.1 + session * 0.05, market: 8.4 })
    }
  }
  for (let k = 0; k < 6; k++) add(yesterday, k + 1, 201 + 240 * k, 2000)
  for (let k = 0; MOCK_FIRST + MOCK_CADENCE * k <= now; k++) add(today, k + 1, MOCK_FIRST + MOCK_CADENCE * k, now)
  matches.push({ id: ids.next++, tick: Math.max(1, now - 6), kind: 'broker_match', status: 'done', bench: false, run: null, card: 'LAV-03', ask: 10, bid: 12, price: 11, fee: 0, surplus: 2, guardrail: null, errorCode: null })
  const trades: VenueTrade[] = [
    { id: 9003, day: today, tick: Math.max(1, now - 5), type: 'settled', venue: MOCK_VENUE, card: 'LAV-03', price: 11, fee: 0, side: null, maker: null, buyer: 't09', seller: 't07' },
    { id: 9002, day: today, tick: Math.max(1, now - 8), type: 'listed', venue: MOCK_VENUE, card: 'LAV-03', price: 10, fee: null, side: 'sell', maker: 't07', buyer: null, seller: null },
    { id: 9001, day: today, tick: Math.max(1, now - 9), type: 'listed', venue: MOCK_VENUE, card: 'MAL-02', price: 14, fee: null, side: 'buy', maker: 't12', buyer: null, seller: null },
  ]
  return {
    at: new Date(0).toISOString(),
    parts: { venues: true, sessions: true, books: true, matches: true, trades: true, score: true },
    venues: [{ venue: MOCK_VENUE, name: 'Team 1 market', mechanism: 'board', feeBps: 0, feePerCard: 0, status: 'open', openedTick: 880, current: true, counted: true }],
    sessions,
    books,
    matches: matches.sort((a, b) => b.id - a.id),
    trades,
    score: score.sort((a, b) => a.day.localeCompare(b.day) || a.tick - b.tick),
  }
}
