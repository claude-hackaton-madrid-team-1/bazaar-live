/**
 * What the Venue screen answers, from GET /api/venue (db/venue.sql) and the game stream: is our venue open and is it the
 * one the Market Test counts; when is the next session, or how is the one running now going; what each session brought
 * (the synthetic traders on our venue, what our broker matched, refused or failed, the quoted surplus it captured of what
 * the quotes made possible, the official efficiency /me gave after it); and what other teams did on our venue.
 *
 * Quotes are not limits: the game scores the gains between the traders' hidden limits, so the quoted surplus is our
 * broker's own measure and the official number is /me's `bench_efficiency`, read after each session. Pure.
 */
import type { BenchBook, BenchSession, BenchTrader, BrokerMatch, OurVenue, VenueScorePoint, VenueSnapshot, VenueTrade } from '../../../shared/venue.ts'
import type { BenchRun } from '../state.ts'
import { benchClock, commonGap, DEFAULT_TICKS, gapsOf, startsOf, type BenchClock, type BenchStart } from './venue-clock.ts'

// ── our venue ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type VenueWarn = 'none_open' | 'not_counted' | 'auto' | 'closing' | null

export interface VenueNow {
  /** The venue the session counts: /me's bench_venue, else our venue now, else our first open one. */
  readonly best: OurVenue | null
  /** Our other venues still open (max_venues allows a second, opened by hand). */
  readonly others: readonly OurVenue[]
  readonly warn: VenueWarn
}

const isOpen = (v: OurVenue): boolean => v.status === 'open' || v.status === 'closing'

export function venueNow(venues: readonly OurVenue[]): VenueNow {
  const open = venues.filter(isOpen)
  const best = venues.find((v) => v.counted && isOpen(v)) ?? venues.find((v) => v.current && isOpen(v)) ?? open.find((v) => v.mechanism === 'board') ?? open[0] ?? null
  const others = open.filter((v) => v !== best)
  const warn: VenueWarn = !best ? 'none_open'
    : best.status === 'closing' ? 'closing'
    : best.mechanism === 'auto' ? 'auto'
    : venues.some((v) => v.counted) && !best.counted ? 'not_counted'
    : null
  return { best, others, warn }
}

// ── the sessions ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A trading fee on a price, as the matcher counts it: ceil(p × bps / 10000) + per card. */
export const feeOn = (price: number, bps: number | null, perCard: number | null): number => Math.ceil((price * (bps ?? 0)) / 10_000) + (perCard ?? 0)

/**
 * The most the quotes allowed: the highest bids against the lowest asks while they cross after the fee (an exact
 * maximum for one card type: any crossing pair left out could be swapped in). Gains are bid − ask.
 */
export function possibleOf(traders: readonly BenchTrader[], bps: number | null, perCard: number | null): { readonly pairs: number; readonly surplus: number } {
  const bids = traders.filter((t) => t.side === 'buy' && t.quote !== null).map((t) => t.quote ?? 0).sort((a, b) => b - a)
  const asks = traders.filter((t) => t.side === 'sell' && t.quote !== null).map((t) => t.quote ?? 0).sort((a, b) => a - b)
  let pairs = 0
  let surplus = 0
  for (let i = 0; i < Math.min(bids.length, asks.length); i++) {
    const bid = bids[i] ?? 0
    const ask = asks[i] ?? 0
    if (ask + feeOn(ask, bps, perCard) > bid) break
    pairs += 1
    surplus += bid - ask
  }
  return { pairs, surplus }
}

export interface SessionRow {
  readonly key: string
  readonly day: string
  readonly session: number | null
  readonly startTick: number
  readonly endTick: number
  readonly live: boolean
  /** Our venue got the book (the start lists it); null when unknown. */
  readonly ours: boolean | null
  /** Our broker read a book for it. */
  readonly seen: boolean
  readonly venue: string | null
  readonly buyers: number
  readonly sellers: number
  /** Matches the game took (done), and those it refused, a guardrail stopped or that ran out of time. */
  readonly matched: number
  readonly failed: number
  readonly refused: number
  readonly expired: number
  /** The game's error codes behind the failed ones, most frequent first. */
  readonly errors: readonly string[]
  /** Quoted surplus of the matches the game took, and the most the quotes allowed. */
  readonly captured: number
  readonly possible: number
  readonly possiblePairs: number
  /** captured ÷ possible, 0–1; null with nothing possible. */
  readonly share: number | null
  /** /me after the session: the official efficiency (0–1) and the bench points; null while not read yet. */
  readonly efficiency: number | null
  readonly points: number | null
  readonly matches: readonly BrokerMatch[]
}

const DONE = new Set(['done'])
const FAILED = new Set(['failed'])
const REFUSED = new Set(['rejected'])
const EXPIRED = new Set(['expired'])

/** A start the stream saw today, as a database session would say it. */
const fromStream = (b: BenchRun, day: string): BenchSession => ({
  day, session: b.session, startTick: b.startTick, ticks: b.ticks, venues: b.venues.length || null, ours: null, at: null,
})

/** The run of a book: by the session the database put it on, else by its first tick within the session's window. */
function bookFor(s: BenchSession, books: readonly BenchBook[], end: number): BenchBook | null {
  return books.find((b) => b.day === s.day && ((b.session !== null && b.session === s.session && b.startTick === s.startTick) || (b.firstTick >= s.startTick && b.firstTick <= end + 2))) ?? null
}

/** /me's numbers read after the session ended, and before the next one started. */
function resultFor(score: readonly VenueScorePoint[], day: string, end: number, next: number | null): VenueScorePoint | null {
  return score.find((p) => p.day === day && p.tick >= end && (next === null || p.tick < next + DEFAULT_TICKS) && p.efficiency !== null) ?? null
}

const counted = (list: readonly string[]): string[] => {
  const n = new Map<string, number>()
  for (const x of list) n.set(x, (n.get(x) ?? 0) + 1)
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
}

/**
 * Every session, newest first: today's (by the Madrid date) from the database and the stream, earlier days' from the
 * database. `now` is today's tick; a session of today still in its 16 ticks is live.
 */
export function sessionRows(snap: VenueSnapshot, stream: readonly BenchRun[], today: string, now: number): SessionRow[] {
  const all = [...snap.sessions]
  for (const b of stream) {
    if (!all.some((s) => s.day === today && s.startTick === b.startTick)) all.push(fromStream(b, today))
  }
  const sorted = all.filter((s) => s.day < today || s.startTick <= now).sort((a, b) => a.day.localeCompare(b.day) || a.startTick - b.startTick)
  const rows = sorted.map((s, i): SessionRow => {
    const ticks = s.ticks && s.ticks > 0 ? s.ticks : DEFAULT_TICKS
    const end = s.startTick + ticks
    const after = sorted[i + 1]
    const next = after && after.day === s.day ? after.startTick : null
    const book = bookFor(s, snap.books, end)
    const matches = book ? snap.matches.filter((m) => m.bench && m.run === book.run) : []
    const traders = book?.traders ?? []
    const possible = book ? possibleOf(traders, book.feeBps, book.feePerCard) : { pairs: 0, surplus: 0 }
    const done = matches.filter((m) => DONE.has(m.status))
    const captured = done.reduce((sum, m) => sum + Math.max(0, m.surplus ?? 0), 0)
    const live = s.day === today && now >= s.startTick && now < end
    const result = live ? null : resultFor(snap.score, s.day, end, next)
    return {
      key: `${s.day}:${s.startTick}`,
      day: s.day,
      session: s.session,
      startTick: s.startTick,
      endTick: end,
      live,
      ours: s.ours,
      seen: book !== null,
      venue: book?.venue ?? null,
      buyers: traders.filter((t) => t.side === 'buy').length,
      sellers: traders.filter((t) => t.side === 'sell').length,
      matched: done.length,
      failed: matches.filter((m) => FAILED.has(m.status)).length,
      refused: matches.filter((m) => REFUSED.has(m.status)).length,
      expired: matches.filter((m) => EXPIRED.has(m.status)).length,
      errors: counted(matches.flatMap((m) => (m.errorCode ? [m.errorCode] : []))),
      captured,
      possible: possible.surplus,
      possiblePairs: possible.pairs,
      share: possible.surplus > 0 ? Math.min(1, captured / possible.surplus) : null,
      efficiency: result?.efficiency ?? null,
      points: result?.benchPoints ?? null,
      matches,
    }
  })
  return rows.reverse()
}

/**
 * The clock over today's starts (the database's and the stream's). The cadence comes from every day's starts, each day
 * on its own (the tick starts again daily), so the first session of a day already counts down at the game's pace;
 * `cadence` overrides it (the mock's).
 */
export function clockOf(snap: VenueSnapshot, stream: readonly BenchRun[], today: string, now: number, cadence?: number): BenchClock {
  const asStart = (s: BenchSession): BenchStart => ({ session: s.session, startTick: s.startTick, ticks: s.ticks ?? DEFAULT_TICKS })
  const starts = startsOf([snap.sessions.filter((s) => s.day === today).map(asStart), stream], now)
  const days = [...new Set(snap.sessions.map((s) => s.day))].filter((d) => d !== today)
  const gaps = [...gapsOf(starts), ...days.flatMap((d) => gapsOf(startsOf([snap.sessions.filter((s) => s.day === d).map(asStart)], Number.MAX_SAFE_INTEGER)))]
  return benchClock(starts, now, cadence ?? commonGap(gaps))
}

// ── other teams on our venue ────────────────────────────────────────────────────────────────────────────────────────

export interface Activity {
  readonly listed: number
  readonly settled: number
  readonly failed: number
  /** What the settlements moved (prices summed), and the teams that traded. */
  readonly volume: number
  readonly teams: number
  /** The newest settlements and listings, newest first. */
  readonly latest: readonly VenueTrade[]
  /** Our broker's matches of the public book (not the bench): taken, and stopped. */
  readonly brokered: number
  readonly brokerStopped: number
}

export function activityOf(snap: VenueSnapshot, today: string): Activity {
  const day = snap.trades.filter((t) => t.day === null || t.day === today)
  const settled = day.filter((t) => t.type === 'settled')
  const teams = new Set(settled.flatMap((t) => [t.buyer, t.seller]).concat(day.filter((t) => t.type === 'listed').map((t) => t.maker)).filter((x): x is string => x !== null))
  const pub = snap.matches.filter((m) => !m.bench && m.kind === 'broker_match')
  return {
    listed: day.filter((t) => t.type === 'listed').length,
    settled: settled.length,
    failed: day.filter((t) => t.type === 'failed').length,
    volume: settled.reduce((sum, t) => sum + (t.price ?? 0), 0),
    teams: teams.size,
    latest: day.filter((t) => t.type !== 'failed').slice(0, 8),
    brokered: pub.filter((m) => m.status === 'done').length,
    brokerStopped: pub.filter((m) => m.status !== 'done').length,
  }
}

// ── /me now ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface BenchScore {
  readonly efficiency: number | null
  readonly benchPoints: number | null
  readonly mmPoints: number | null
  /** Where the bench points sit: below the free stall, level with it (0.5), above, or at the top three's mean (1). */
  readonly level: 'below_stall' | 'stall' | 'above_stall' | 'top' | null
}

export function benchScoreOf(score: readonly VenueScorePoint[]): BenchScore {
  const last = score.at(-1)
  const p = last?.benchPoints ?? null
  const level = p === null ? null : p >= 0.999 ? 'top' : p > 0.505 ? 'above_stall' : p >= 0.495 ? 'stall' : 'below_stall'
  return { efficiency: last?.efficiency ?? null, benchPoints: p, mmPoints: last?.mmPoints ?? null, level }
}

/** The Madrid date of a moment: the day the views key rows by. */
export function madridDay(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
  return parts.slice(0, 10)
}
