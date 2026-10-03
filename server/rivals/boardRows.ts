/**
 * Rows of db/rival_board.sql's view (show.rival_board, over the agents' public.rival_board) → the wire type
 * (shared/rivalBoard.ts). Same rules as server/strategy/rows.ts: every field is checked, an odd field becomes null or
 * empty, a row without its team, rank or tick is skipped, and nothing here throws. Codes are only the ones the screen
 * knows, card refs only the catalog's shape, lists at most LIST_MAX items, text one printable line, capped.
 */
import {
  GUARD_REASONS, MOVE_KINDS, STRENGTH_CODES, WEAKNESS_CODES,
  type BoardRow, type CardSignal, type CopyMatch, type SpareMatch, type TrendPoint,
} from '../../shared/rivalBoard.ts'
import { line, num } from '../learn/rows.ts'

type Row = Record<string, unknown>

/** The contract of the agents' public.rival_board, in its order: db/rival_board.sql passes exactly these through. */
export const BOARD_COLUMNS = [
  'team', 'tick', 'rank', 'score', 'negotiating', 'market', 'level', 'pages', 'deals', 'venue',
  'rank_change', 'score_change', 'trend_ticks', 'trend',
  'our_team', 'our_rank', 'our_score', 'our_negotiating', 'our_market', 'our_pages',
  'dealer_deals', 'venue_trades', 'top_set', 'set_interest', 'strengths', 'weaknesses',
  'they_want', 'they_have', 'we_have_for_them', 'they_have_for_us', 'match_count',
  'guarded', 'guard_reason',
  'move_kind', 'move_give', 'move_get', 'move_price', 'our_gain', 'their_gain', 'suggested_move',
  'why_climbed', 'why_climbed_tick',
] as const

export const LIST_MAX = 20
const MOVE_MAX = 200
const CLIMBED_MAX = 300

const asRow = (raw: unknown): Row => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Row) : {})
const list = (raw: unknown): readonly unknown[] => (Array.isArray(raw) ? raw : [])

const int = (raw: unknown): number | null => {
  const n = num(raw)
  return n !== null && Number.isSafeInteger(n) ? n : null
}

/** A whole number, zero or more: a tick, a count, a level, a price in whole P. */
const whole = (raw: unknown): number | null => {
  const n = int(raw)
  return n !== null && n >= 0 ? n : null
}

/** A leaderboard rank: 1 is first. */
const rankOf = (raw: unknown): number | null => {
  const n = int(raw)
  return n !== null && n >= 1 ? n : null
}

/** A price in P from the view's lists: finite, zero or more. */
const price = (raw: unknown): number | null => {
  const n = num(raw)
  return n !== null && n >= 0 ? n : null
}

/** One token, as the agents' rank watch keeps ids (`SAFE_ID`): a team (t05) or a venue (v19, rastro). */
const TOKEN = /^[A-Za-z0-9_.:-]{1,24}$/
const token = (raw: unknown): string | null => (typeof raw === 'string' && TOKEN.test(raw) ? raw : null)

/** A card code as the catalog writes it (LAV-09); anything else is not a card. */
const REF = /^[A-Z]{3}-\d{1,3}$/
const ref = (raw: unknown): string | null => (typeof raw === 'string' && REF.test(raw) ? raw : null)

/** A set code (LAV), as server/learn/rows.ts reads the set interest. */
const SET = /^[A-Z]{2,4}$/
const setCode = (raw: unknown): string | null => (typeof raw === 'string' && SET.test(raw) ? raw : null)

const isOneOf = <T extends string>(known: readonly T[], raw: unknown): raw is T => typeof raw === 'string' && (known as readonly string[]).includes(raw)

/** The known codes in the view's order, each once; anything else is dropped. */
function codes<T extends string>(raw: unknown, known: readonly T[]): T[] {
  const out: T[] = []
  for (const c of list(raw)) if (isOneOf(known, c) && !out.includes(c)) out.push(c)
  return out
}

/** The items that parse, in the view's order, at most LIST_MAX. */
function items<T>(raw: unknown, parse: (item: Row) => T | null): T[] {
  const out: T[] = []
  for (const item of list(raw)) {
    if (out.length >= LIST_MAX) break
    const v = parse(asRow(item))
    if (v !== null) out.push(v)
  }
  return out
}

/** Oldest first, as the view gives it: the newest LIST_MAX points are kept. */
function trendOf(raw: unknown): TrendPoint[] {
  const points: TrendPoint[] = []
  for (const item of list(raw)) {
    const p = asRow(item)
    const tick = whole(p.tick)
    const rank = rankOf(p.rank)
    if (tick !== null && rank !== null) points.push({ tick, rank, score: num(p.score) })
  }
  return points.slice(-LIST_MAX)
}

function interestOf(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  let kept = 0
  for (const [set, v] of Object.entries(asRow(raw))) {
    if (kept >= LIST_MAX) break
    const n = num(v)
    // a set code only: never a key like "__proto__" from the parsed jsonb
    if (!setCode(set) || n === null) continue
    out[set] = n
    kept += 1
  }
  return out
}

function signalOf(r: Row): CardSignal | null {
  const card = ref(r.ref)
  return card ? { ref: card, price: price(r.price), tick: whole(r.tick) } : null
}

/** One of our spares: no copy beyond the album's, no match. */
function spareOf(r: Row): SpareMatch | null {
  const card = ref(r.ref)
  const spare = whole(r.spare)
  return card && spare !== null && spare >= 1 ? { ref: card, spare, theirPrice: price(r.their_price), ourValue: num(r.our_value) } : null
}

function copyOf(r: Row): CopyMatch | null {
  const card = ref(r.ref)
  return card ? { ref: card, theirPrice: price(r.their_price), valueToUs: num(r.value_to_us) } : null
}

/** One row of show.rival_board, or null: no team, rank or tick, or our own team (the board is the OTHER teams). */
export function boardOf(raw: unknown): BoardRow | null {
  const r = asRow(raw)
  const team = token(r.team)
  const tick = whole(r.tick)
  const rank = rankOf(r.rank)
  if (!team || tick === null || rank === null || team === token(r.our_team)) return null
  const weHaveForThem = items(r.we_have_for_them, spareOf)
  const theyHaveForUs = items(r.they_have_for_us, copyOf)
  return {
    team, tick, rank,
    score: num(r.score), negotiating: num(r.negotiating), market: num(r.market),
    level: whole(r.level), pages: whole(r.pages), deals: whole(r.deals), venue: token(r.venue),
    rankChange: int(r.rank_change), scoreChange: num(r.score_change), trendTicks: whole(r.trend_ticks), trend: trendOf(r.trend),
    ourRank: rankOf(r.our_rank), ourScore: num(r.our_score), ourNegotiating: num(r.our_negotiating), ourMarket: num(r.our_market),
    ourPages: whole(r.our_pages),
    dealerDeals: whole(r.dealer_deals) ?? 0, venueTrades: whole(r.venue_trades) ?? 0,
    topSet: setCode(r.top_set), setInterest: interestOf(r.set_interest),
    strengths: codes(r.strengths, STRENGTH_CODES), weaknesses: codes(r.weaknesses, WEAKNESS_CODES),
    theyWant: items(r.they_want, signalOf), theyHave: items(r.they_have, signalOf),
    weHaveForThem, theyHaveForUs,
    // the view counts every match; the lists above may be cut at LIST_MAX
    matchCount: whole(r.match_count) ?? weHaveForThem.length + theyHaveForUs.length,
    guarded: r.guarded === true,
    guardReason: isOneOf(GUARD_REASONS, r.guard_reason) ? r.guard_reason : null,
    // a kind this server does not know yet reads as "nothing to trade"
    moveKind: isOneOf(MOVE_KINDS, r.move_kind) ? r.move_kind : 'watch',
    moveGive: ref(r.move_give), moveGet: ref(r.move_get), movePrice: whole(r.move_price),
    ourGain: num(r.our_gain), theirGain: num(r.their_gain),
    suggestedMove: line(r.suggested_move, MOVE_MAX) ?? '',
    whyClimbed: line(r.why_climbed, CLIMBED_MAX), whyClimbedTick: whole(r.why_climbed_tick),
  }
}

/** Each team once, its first row, in the given order (the view gives one row per team; a second is dropped). */
export function onePerTeam(rows: readonly BoardRow[]): BoardRow[] {
  const seen = new Set<string>()
  return rows.filter((r) => !seen.has(r.team) && seen.add(r.team) !== undefined)
}

/** The view's rows for the screen, in its order (best rank first): each team once, its first row. */
export function boardRowsOf(rows: readonly unknown[]): BoardRow[] {
  return onePerTeam(rows.map(boardOf).filter((r): r is BoardRow => r !== null))
}
