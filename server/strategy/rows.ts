/**
 * Rows of db/strategy.sql's views → the wire type (shared/strategy.ts). Same rules as server/learn/rows.ts: every
 * field is checked, a row in an odd shape loses that field or is skipped when it lacks what makes it a row (an id,
 * a tick, a card, a price), it never breaks the snapshot.
 */
import type { CatalogCard, HeldCard, OpenAsk, StrategyDecision, StrategyMe, StrategyPage, StrategySpend } from '../../shared/strategy.ts'
import { isoOf } from '../history/rows.ts'
import { line, num } from '../learn/rows.ts'

type Row = Record<string, unknown>

const asRow = (raw: unknown): Row => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Row) : {})

const int = (raw: unknown): number | null => {
  const n = num(raw)
  return n !== null && Number.isSafeInteger(n) ? n : null
}

const word = (raw: unknown, max = 32): string | null => line(raw, max)

/** A card code as the catalog writes it (LAV-09); anything else is not a card. */
const REF = /^[A-Z]{3}-\d{1,3}$/
const ref = (raw: unknown): string | null => (typeof raw === 'string' && REF.test(raw) ? raw : null)

const list = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : [])

function pageOf(raw: unknown): StrategyPage | null {
  const r = asRow(raw)
  const set = word(r.set, 8)
  const have = int(r.have)
  const of = int(r.of)
  if (!set || have === null || of === null || of <= 0) return null
  return { set, name: word(r.name, 40), have: Math.max(0, have), of, complete: r.complete === true }
}

function heldOf(raw: unknown): HeldCard | null {
  const r = asRow(raw)
  const code = ref(r.ref)
  if (!code) return null
  return { ref: code, set: word(r.set, 8), rarity: word(r.rarity, 16), asset: int(r.asset), value: num(r.value) }
}

export function meOf(raw: unknown): StrategyMe | null {
  const r = asRow(raw)
  const team = word(r.team, 24)
  const tick = int(r.tick)
  const cash = int(r.cash)
  if (!team || tick === null || cash === null) return null
  const affinity: Record<string, number> = {}
  for (const [k, v] of Object.entries(asRow(r.affinity))) {
    const n = num(v)
    if (/^[A-Z]{3}$/.test(k) && n !== null) affinity[k] = n
  }
  return {
    team,
    tick,
    at: isoOf(r.read_at),
    cash,
    level: int(r.level),
    venue: word(r.venue, 16),
    tickSeconds: num(r.tick_seconds),
    affinity,
    pages: list(r.pages).map(pageOf).filter((p): p is StrategyPage => p !== null),
    cards: list(r.cards).map(heldOf).filter((c): c is HeldCard => c !== null),
  }
}

export function spendOf(raw: unknown): StrategySpend | null {
  const r = asRow(raw)
  const spent = int(r.spent)
  if (spent === null) return null
  return { ledgerTick: int(r.ledger_tick), tHours: num(r.t_hours), spent: Math.max(0, spent), buys: Math.max(0, int(r.buys) ?? 0) }
}

export function decisionOf(raw: unknown): StrategyDecision | null {
  const r = asRow(raw)
  const id = int(r.id)
  const tick = int(r.tick)
  const kind = word(r.kind)
  const status = word(r.status, 16)
  if (id === null || tick === null || !kind || !status || (r.agent !== 'taker' && r.agent !== 'maker')) return null
  return {
    id,
    tick,
    agent: r.agent,
    kind,
    status,
    allowed: typeof r.allowed === 'boolean' ? r.allowed : null,
    guardrail: line(r.guardrail, 300),
    card: word(r.card),
    giveCard: ref(r.give_card),
    rarity: word(r.rarity, 16),
    venue: word(r.venue, 24),
    price: int(r.price),
    fee: int(r.fee),
    total: int(r.total),
    value: num(r.our_value),
    surplus: num(r.surplus),
    jevValue: num(r.jev_value),
    jevVerdict: word(r.jev_verdict, 16),
    jevReason: word(r.jev_reason),
    reason: line(r.reason, 240),
  }
}

export function askOf(raw: unknown): OpenAsk | null {
  const r = asRow(raw)
  const offer = int(r.offer)
  const tick = int(r.tick)
  const card = ref(r.card)
  const price = int(r.price)
  if (offer === null || tick === null || !card || price === null || price <= 0) return null
  return {
    offer,
    tick,
    expiresTick: int(r.expires_tick),
    venue: word(r.venue, 24),
    maker: word(r.maker, 24),
    to: word(r.to_team, 24),
    asset: int(r.asset),
    card,
    rarity: word(r.rarity, 16),
    price,
    ours: r.ours === true,
  }
}

export function catalogOf(raw: unknown): CatalogCard | null {
  const r = asRow(raw)
  const card = ref(r.card)
  if (!card) return null
  return {
    card,
    set: word(r.set_code, 8),
    setName: word(r.set_name, 40),
    name: word(r.name, 64),
    rarity: word(r.rarity, 16),
    book: num(r.book),
    minted: int(r.minted),
    printRun: int(r.print_run),
    page: r.page === true,
    lastFill: int(r.last_fill),
    lastFillTick: int(r.last_fill_tick),
  }
}
