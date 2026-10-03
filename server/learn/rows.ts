/**
 * Rows of db/learn.sql's views → the wire type (shared/learn.ts). Every field is checked: a row in an odd
 * shape loses that field (or is skipped when it has no id), it never breaks the snapshot. Text is one line,
 * printable, capped; numbers are finite; pg's bigint and numeric strings are read as numbers.
 */
import type { DealerStat, Learning, RivalProfile, TraderMove } from '../../shared/learn.ts'

type Row = Record<string, unknown>

const CLAIM_MAX = 300
const WORD_MAX = 64

const asRow = (raw: unknown): Row => (typeof raw === 'object' && raw !== null ? (raw as Row) : {})

/** A finite number from a number or a numeric string (pg sends bigint and numeric as text). */
export function num(raw: unknown): number | null {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

const int = (raw: unknown): number | null => {
  const n = num(raw)
  return n !== null && Number.isSafeInteger(n) ? n : null
}

/** One printable line, capped. */
export function line(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const clean = Array.from(raw, (ch) => (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(ch) ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim()
  if (!clean) return null
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

const word = (raw: unknown): string | null => line(raw, WORD_MAX)

const plainObject = (raw: unknown): Readonly<Record<string, unknown>> | null =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null

export function learningOf(raw: unknown): Learning | null {
  const r = asRow(raw)
  const id = int(r.id)
  const claim = line(r.claim, CLAIM_MAX)
  const kind = word(r.kind)
  if (id === null || !claim || !kind) return null
  const confidence = num(r.confidence)
  return {
    id,
    subjectKind: word(r.subject_kind) ?? word(r.scope) ?? '?',
    subject: word(r.subject) ?? '?',
    kind,
    claim,
    source: word(r.source) ?? 'rules',
    confidence: confidence === null ? 0 : Math.min(1, Math.max(0, confidence)),
    support: Math.max(0, int(r.support) ?? 0),
    createdTick: int(r.created_tick),
    untilTick: int(r.until_tick),
    team: word(r.team),
    stats: plainObject(r.stats),
  }
}

export function moveOf(raw: unknown): TraderMove | null {
  const r = asRow(raw)
  const id = int(r.id)
  const trader = word(r.trader)
  const event = word(r.event)
  if (id === null || !trader || !event) return null
  return {
    id,
    trader,
    thread: int(r.thread),
    tick: int(r.tick),
    event,
    ourPrice: int(r.our_price),
    theirPrice: int(r.their_price),
    step: int(r.step),
    final: r.final === true,
    ours: r.source === 'ours',
  }
}

export function dealerOf(raw: unknown): DealerStat | null {
  const r = asRow(raw)
  const dealer = word(r.dealer)
  if (!dealer) return null
  return {
    dealer,
    threads: int(r.threads) ?? 0,
    deals: int(r.deals) ?? 0,
    ourThreads: int(r.our_threads) ?? 0,
    ourDeals: int(r.our_deals) ?? 0,
    avgOpen: num(r.avg_open),
    avgFill: num(r.avg_fill),
    fillRatio: num(r.fill_ratio),
    ourFillRatio: num(r.our_fill_ratio),
    avgSteps: num(r.avg_steps),
    avgTicks: num(r.avg_ticks),
  }
}

export function rivalOf(raw: unknown): RivalProfile | null {
  const r = asRow(raw)
  const team = word(r.team)
  if (!team) return null
  const interest: Record<string, number> = {}
  for (const [set, n] of Object.entries(plainObject(r.set_interest) ?? {})) {
    const v = num(n)
    if (v !== null && /^[A-Z]{2,4}$/.test(set)) interest[set] = v
  }
  const fills = plainObject(r.fills) ?? {}
  return {
    team,
    updatedTick: int(r.updated_tick),
    level: int(r.level),
    venue: word(r.venue),
    avgPackPrice: num(r.avg_pack_price),
    dealerDealRate: num(r.dealer_deal_rate),
    setInterest: interest,
    buys: int(fills.buys),
    sells: int(fills.sells),
    spent: int(fills.spent),
    earned: int(fills.earned),
    topSet: word(r.top_set),
  }
}

/** Parses a list of rows, dropping the ones that do not parse. */
export function parseAll<T>(rows: readonly unknown[], parse: (raw: unknown) => T | null): T[] {
  const out: T[] = []
  for (const raw of rows) {
    const v = parse(raw)
    if (v !== null) out.push(v)
  }
  return out
}
