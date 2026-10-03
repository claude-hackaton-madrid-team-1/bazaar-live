/**
 * Rows of db/history.sql's views → the wire type (shared/history.ts). Same rules as server/learn/rows.ts:
 * every field is checked, a row in an odd shape loses that field or is skipped when it lacks what makes it
 * a row (a day, a tick, an amount), it never breaks the snapshot.
 */
import type { CashPoint, Order, TeamEvent, Trade } from '../../shared/history.ts'
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
  return { id, day, tick, kind, price: int(r.price), item: word(r.item), agent: word(r.agent) ?? '?' }
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
