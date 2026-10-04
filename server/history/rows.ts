/**
 * Rows of db/history.sql's views → the wire type (shared/history.ts). Same rules as server/learn/rows.ts:
 * every field is checked, a row in an odd shape loses that field or is skipped when it lacks what makes it
 * a row (a day, a tick, an amount), it never breaks the snapshot.
 */
import type { CashPoint, Order, OrderOffer, ScoreMark, ScorePoint, TeamEvent, TeamScore, Trade } from '../../shared/history.ts'
import { line, num } from '../learn/rows.ts'

type Row = Record<string, unknown>

const asRow = (raw: unknown): Row => (typeof raw === 'object' && raw !== null ? (raw as Row) : {})

const int = (raw: unknown): number | null => {
  const n = num(raw)
  return n !== null && Number.isSafeInteger(n) ? n : null
}

const word = (raw: unknown): string | null => line(raw, 64)

/** The Madrid date the view sends as text (`day::text`). */
export function dayOf(raw: unknown): string | null {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
}

export function pointOf(raw: unknown): CashPoint | null {
  const r = asRow(raw)
  const day = dayOf(r.day)
  const tick = int(r.tick)
  const cash = int(r.cash)
  if (!day || tick === null || cash === null) return null
  return { day, tick, cash, score: num(r.score), rank: int(r.rank) }
}

export function tradeOf(raw: unknown): Trade | null {
  const r = asRow(raw)
  const id = int(r.id)
  const day = dayOf(r.day)
  const tick = int(r.tick)
  const price = int(r.price)
  if (id === null || !day || tick === null || price === null || (r.side !== 'buy' && r.side !== 'sell')) return null
  return {
    id,
    day,
    tick,
    side: r.side,
    counterparty: word(r.counterparty) ?? '?',
    venue: word(r.venue),
    card: word(r.card),
    cardName: word(r.card_name),
    rarity: word(r.rarity),
    items: Math.max(1, int(r.items) ?? 1),
    price,
    fee: Math.max(0, int(r.fee) ?? 0),
  }
}

export function orderOf(raw: unknown): Order | null {
  const r = asRow(raw)
  const id = int(r.id)
  const day = dayOf(r.day)
  const tick = int(r.tick)
  const kind = word(r.kind)
  if (id === null || !day || tick === null || !kind) return null
  return { id, day, tick, kind, price: int(r.price), item: word(r.item), agent: word(r.agent) ?? '?', offer: orderOfferOf(r) }
}

const SIDES = ['ask', 'bid', 'swap'] as const
const STATUSES = ['open', 'settled', 'cancelled', 'expired'] as const
const oneOf = <T extends string>(list: readonly T[], raw: unknown): T | null => (list as readonly unknown[]).includes(raw) ? (raw as T) : null

/** The offer a hand listing carries (the view's offer_* columns), or null when it has none (or the view predates them). */
function orderOfferOf(r: Row): OrderOffer | null {
  const id = int(r.offer)
  const side = oneOf(SIDES, r.offer_side)
  const status = oneOf(STATUSES, r.offer_status)
  if (id === null || !side || !status) return null
  return { id, side, card: line(r.offer_card, 16), venue: line(r.offer_venue, 32), expiresTick: int(r.offer_expires), status }
}

export function teamEventOf(raw: unknown): TeamEvent | null {
  const r = asRow(raw)
  const id = int(r.id)
  const day = dayOf(r.day)
  const tick = int(r.tick)
  const type = word(r.type)
  if (id === null || !day || tick === null || !type) return null
  return {
    id,
    day,
    tick,
    type,
    venue: word(r.venue),
    name: word(r.name),
    bond: int(r.bond),
    pack: word(r.pack),
    best: word(r.best),
    cash: int(r.cash),
    level: int(r.level),
    why: line(r.why, 120),
  }
}

/** A timestamptz as pg hands it over (a Date) or as text → ISO, or null. */
export function isoOf(raw: unknown): string | null {
  const d = raw instanceof Date ? raw : typeof raw === 'string' ? new Date(raw) : null
  return d && Number.isFinite(d.getTime()) ? d.toISOString() : null
}

export function scorePointOf(raw: unknown): ScorePoint | null {
  const r = asRow(raw)
  const day = dayOf(r.day)
  const tick = int(r.tick)
  if (!day || tick === null) return null
  return { day, tick, at: isoOf(r.read_at), cash: int(r.cash), score: num(r.score), duel: num(r.duel), ladder: num(r.ladder), neg: num(r.neg), mm: num(r.mm), bench: num(r.bench) }
}

export function scoreMarkOf(raw: unknown): ScoreMark | null {
  const r = asRow(raw)
  const id = int(r.id)
  const day = dayOf(r.day)
  const tick = int(r.tick)
  if (id === null || !day || tick === null || (r.kind !== 'start' && r.kind !== 'game')) return null
  const agent = line(r.agent, 24)
  if (r.kind === 'start' && !agent) return null
  return { kind: r.kind, id, day, tick, agent, action: line(r.action, 16), note: line(r.note, 120), at: isoOf(r.at) }
}

const TEAM = /^t\d{1,3}$/

export function teamScoreOf(raw: unknown): TeamScore | null {
  const r = asRow(raw)
  const day = dayOf(r.day)
  const tick = int(r.tick)
  const team = typeof r.team === 'string' && TEAM.test(r.team) ? r.team : null
  const rank = int(r.rank)
  const score = num(r.score)
  if (!day || tick === null || !team || rank === null || rank < 1 || score === null) return null
  return {
    day,
    tick,
    team,
    rank,
    score,
    negotiating: num(r.negotiating),
    market: num(r.market),
    level: int(r.level),
    pages: int(r.pages),
    deals: int(r.deals),
    at: isoOf(r.read_at),
    venue: typeof r.venue === 'string' && /^[a-z0-9_-]{1,24}$/.test(r.venue) ? r.venue : null,
  }
}
