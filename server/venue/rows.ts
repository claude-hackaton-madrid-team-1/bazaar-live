/**
 * Rows of db/venue.sql's views → the wire type (shared/venue.ts). Same rules as server/learn/rows.ts: every field is
 * checked, a row in an odd shape loses that field or is skipped when it lacks what makes it a row (a venue, a tick, a
 * run, an id), it never breaks the snapshot.
 */
import type { BenchBook, BenchSession, BenchTrader, BrokerMatch, OurVenue, VenueScorePoint, VenueTrade } from '../../shared/venue.ts'
import { dayOf, isoOf } from '../history/rows.ts'
import { line, num } from '../learn/rows.ts'

type Row = Record<string, unknown>

const asRow = (raw: unknown): Row => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Row) : {})

const int = (raw: unknown): number | null => {
  const n = num(raw)
  return n !== null && Number.isSafeInteger(n) ? n : null
}

/** An id as the game writes venues, runs, teams and bench traders (`v19`, `b35`, `t07`, `b35-4`); anything else is dropped. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/
const id = (raw: unknown): string | null => (typeof raw === 'string' && ID.test(raw) ? raw : null)

const REF = /^[A-Z]{3}-\d{1,3}$/
const ref = (raw: unknown): string | null => (typeof raw === 'string' && REF.test(raw) ? raw : null)

const oneOf = <T extends string>(raw: unknown, values: readonly T[]): T | null => (values.includes(raw as T) ? (raw as T) : null)

const bool = (raw: unknown): boolean | null => (typeof raw === 'boolean' ? raw : null)

export function venueOf(raw: unknown): OurVenue | null {
  const r = asRow(raw)
  const venue = id(r.venue)
  if (!venue) return null
  return {
    venue,
    name: line(r.name, 40),
    mechanism: oneOf(r.mechanism, ['board', 'auto']) ?? line(r.mechanism, 16),
    feeBps: int(r.fee_bps),
    feePerCard: int(r.fee_per_card),
    status: oneOf(r.status, ['open', 'closing', 'closed', 'suspended']),
    openedTick: int(r.opened_tick),
    current: r.current === true,
    counted: r.counted === true,
  }
}

export function sessionOf(raw: unknown): BenchSession | null {
  const r = asRow(raw)
  const day = dayOf(r.day)
  const startTick = int(r.start_tick)
  if (!day || startTick === null) return null
  return { day, session: int(r.session), startTick, ticks: int(r.ticks), venues: int(r.venues), ours: bool(r.ours), at: isoOf(r.received_at) }
}

function traderOf(raw: unknown): BenchTrader | null {
  const r = asRow(raw)
  const trader = id(r.id)
  const side = oneOf(r.side, ['buy', 'sell'])
  const first = int(r.first)
  const last = int(r.last)
  if (!trader || !side || first === null || last === null) return null
  return { id: trader, side, quote: int(r.quote), first, last }
}

export function bookOf(raw: unknown): BenchBook | null {
  const r = asRow(raw)
  const run = id(r.run)
  const firstTick = int(r.first_tick)
  const lastTick = int(r.last_tick)
  if (!run || firstTick === null || lastTick === null) return null
  const traders = (Array.isArray(r.offers) ? r.offers : []).slice(0, 200).map(traderOf).filter((t): t is BenchTrader => t !== null)
  return {
    run, day: dayOf(r.day), firstTick, lastTick, ticksSeen: int(r.ticks_seen) ?? 0, venue: id(r.venue),
    feeBps: int(r.fee_bps), feePerCard: int(r.fee_per_card), session: int(r.session), startTick: int(r.start_tick), traders,
  }
}

export function matchOf(raw: unknown): BrokerMatch | null {
  const r = asRow(raw)
  const matchId = int(r.id)
  const tick = int(r.tick)
  const kind = line(r.kind, 24)
  const status = line(r.status, 16)
  if (matchId === null || tick === null || !kind || !status) return null
  return {
    id: matchId, tick, kind, status, bench: r.bench === true, run: id(r.run), card: ref(r.card),
    ask: int(r.ask), bid: int(r.bid), price: int(r.price), fee: int(r.fee), surplus: num(r.surplus),
    guardrail: line(r.guardrail, 140), errorCode: line(r.error_code, 32),
  }
}

export function tradeOf(raw: unknown): VenueTrade | null {
  const r = asRow(raw)
  const tradeId = int(r.id)
  const tick = int(r.tick)
  const type = oneOf(r.type, ['listed', 'settled', 'failed'])
  if (tradeId === null || tick === null || !type) return null
  return {
    id: tradeId, day: dayOf(r.day), tick, type, venue: id(r.venue), card: ref(r.card), price: int(r.price), fee: int(r.fee),
    side: oneOf(r.side, ['buy', 'sell']), maker: id(r.maker), buyer: id(r.buyer), seller: id(r.seller),
  }
}

export function scoreOf(raw: unknown): VenueScorePoint | null {
  const r = asRow(raw)
  const day = dayOf(r.day)
  const tick = int(r.tick)
  if (!day || tick === null) return null
  return {
    day, tick, at: isoOf(r.read_at), venue: id(r.venue), benchVenue: id(r.bench_venue),
    efficiency: num(r.bench_efficiency), benchPoints: num(r.bench_points), mmPoints: num(r.mm_points), market: num(r.market),
  }
}
