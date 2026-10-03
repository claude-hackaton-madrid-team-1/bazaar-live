/**
 * The Movements screen's selectors: every change of our cash, explained by the trades and events that fall
 * between two readings, plus the day's summary and the cash line. Pure, over shared/history.ts.
 *
 * A buy costs price + fee (the buyer pays the venue's fee), a sale brings the price, a venue's bond goes out,
 * a gift comes in. What a change does not account for is shown as "other" rather than hidden.
 */
import type { CashPoint, HistorySnapshot, Order, TeamEvent, Trade } from '../../../shared/history.ts'

export type LineKind = 'buy' | 'sell' | 'bond' | 'gift' | 'pack' | 'level' | 'failed' | 'closed' | 'other'

export interface MoveLine {
  readonly kind: LineKind
  /** Cash in (+) or out (−); null when the line moves no cash we know of (a pack opened, a level). */
  readonly amount: number | null
  readonly trade?: Trade
  readonly event?: TeamEvent
}

export interface Movement {
  readonly key: string
  readonly day: string
  readonly tick: number
  /** The change of cash read at this tick; null for a trade or event seen before we read cash. */
  readonly delta: number | null
  readonly cashAfter: number | null
  readonly lines: readonly MoveLine[]
}

export type MoveFilter = 'all' | 'in' | 'out'

/** A moment: the day first (the tick may start again on a new day). */
const at = (x: { day: string; tick: number }): string => `${x.day} ${String(x.tick).padStart(7, '0')}`

export const tradeAmount = (t: Trade): number => (t.side === 'sell' ? t.price : -(t.price + t.fee))

function eventLine(e: TeamEvent): MoveLine {
  switch (e.type) {
    case 'venue.opened':
      return { kind: 'bond', amount: e.bond ? -e.bond : null, event: e }
    case 'gift.given':
      return { kind: 'gift', amount: e.cash ?? null, event: e }
    case 'pack.opened':
      return { kind: 'pack', amount: null, event: e }
    case 'level.unlocked':
      return { kind: 'level', amount: null, event: e }
    case 'settlement.failed':
      return { kind: 'failed', amount: null, event: e }
    case 'venue.closed':
      return { kind: 'closed', amount: null, event: e }
    default:
      return { kind: 'other', amount: null, event: e }
  }
}

const tradeLine = (t: Trade): MoveLine => ({ kind: t.side, amount: tradeAmount(t), trade: t })

const sum = (lines: readonly MoveLine[]): number => lines.reduce((n, l) => n + (l.amount ?? 0), 0)

/**
 * Newest first. Each change of cash takes the trades and events after the previous reading up to its own
 * tick (same day); the rest of the change is an `other` line. Trades and events before the first reading
 * stand alone, with their own amount and no cash after.
 */
export function movements(s: Pick<HistorySnapshot, 'points' | 'trades' | 'events'>): Movement[] {
  const points = [...s.points].sort((a, b) => at(a).localeCompare(at(b)))
  const items: { at: string; line: MoveLine; day: string; tick: number }[] = [
    ...s.trades.map((t) => ({ at: at(t), line: tradeLine(t), day: t.day, tick: t.tick })),
    ...s.events.map((e) => ({ at: at(e), line: eventLine(e), day: e.day, tick: e.tick })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  const out: Movement[] = []
  let i = 0
  let prev: CashPoint | null = null
  for (const p of points) {
    const lines: MoveLine[] = []
    for (let item = items[i]; item && item.at <= at(p); item = items[++i]) {
      if (prev === null) out.push({ key: `x${item.at}${out.length}`, day: item.day, tick: item.tick, delta: null, cashAfter: null, lines: [item.line] })
      else lines.push(item.line)
    }
    if (prev !== null && p.cash !== prev.cash) {
      const delta = p.cash - prev.cash
      const rest = delta - sum(lines)
      if (rest !== 0) lines.push({ kind: 'other', amount: rest })
      out.push({ key: `p${at(p)}`, day: p.day, tick: p.tick, delta, cashAfter: p.cash, lines })
    } else if (lines.length) {
      // trades that netted to nothing between two readings still happened
      out.push({ key: `p${at(p)}`, day: p.day, tick: p.tick, delta: 0, cashAfter: p.cash, lines })
    }
    prev = p
  }
  // after the last reading: not in the cash yet
  for (const item of items.slice(i)) out.push({ key: `y${item.at}`, day: item.day, tick: item.tick, delta: null, cashAfter: null, lines: [item.line] })
  return out.reverse()
}

export function filterMovements(rows: readonly Movement[], filter: MoveFilter): Movement[] {
  if (filter === 'all') return [...rows]
  const sign = (m: Movement): number => m.delta ?? sum(m.lines)
  return rows.filter((m) => (filter === 'in' ? sign(m) > 0 : sign(m) < 0))
}

export interface CashSummary {
  readonly now: number | null
  readonly day: string | null
  readonly tick: number | null
  /** Cash at the first reading of the latest day. */
  readonly open: number | null
  readonly low: number | null
  readonly high: number | null
  /** Money in and out from trades (and bonds and gifts) of the latest day. */
  readonly earned: number
  readonly spent: number
  readonly fees: number
  readonly buys: number
  readonly sells: number
  /** The last change: its amount and tick. */
  readonly last: { readonly delta: number; readonly tick: number } | null
}

export function cashSummary(s: Pick<HistorySnapshot, 'points' | 'trades' | 'events'>, rows: readonly Movement[] = movements(s)): CashSummary {
  const points = [...s.points].sort((a, b) => at(a).localeCompare(at(b)))
  const latest = points.at(-1) ?? null
  const day = latest?.day ?? s.trades.map((t) => t.day).sort().at(-1) ?? null
  const today = points.filter((p) => p.day === day)
  const trades = s.trades.filter((t) => t.day === day)
  const events = s.events.filter((e) => e.day === day)
  const flows = [...trades.map(tradeLine), ...events.map(eventLine)].map((l) => l.amount ?? 0)
  const last = rows.find((m) => m.delta !== null && m.delta !== 0)
  return {
    now: latest?.cash ?? null,
    day,
    tick: latest?.tick ?? null,
    open: today[0]?.cash ?? null,
    low: today.length ? Math.min(...today.map((p) => p.cash)) : null,
    high: today.length ? Math.max(...today.map((p) => p.cash)) : null,
    earned: flows.filter((n) => n > 0).reduce((a, b) => a + b, 0),
    spent: -flows.filter((n) => n < 0).reduce((a, b) => a + b, 0),
    fees: trades.filter((t) => t.side === 'buy').reduce((n, t) => n + t.fee, 0),
    buys: trades.filter((t) => t.side === 'buy').length,
    sells: trades.filter((t) => t.side === 'sell').length,
    last: last && last.delta !== null ? { delta: last.delta, tick: last.tick } : null,
  }
}

export interface CashChart {
  /** The step line of cash over the latest day's ticks. */
  readonly path: string
  readonly area: string
  readonly marks: readonly { readonly x: number; readonly y: number; readonly tone: 'in' | 'out'; readonly tick: number; readonly delta: number }[]
  readonly yTicks: readonly { readonly y: number; readonly value: number }[]
  readonly xTicks: readonly { readonly x: number; readonly tick: number }[]
  readonly end: { readonly x: number; readonly y: number } | null
}

const niceStep = (span: number, n: number): number => {
  const raw = Math.max(1, span / n)
  const mag = 10 ** Math.floor(Math.log10(raw))
  return ([1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
}

/** Cash over the latest day, as a step line in a w×h box with `pad` around it. */
export function cashChart(points: readonly CashPoint[], w: number, h: number, pad = { l: 40, r: 12, t: 10, b: 22 }): CashChart | null {
  const sorted = [...points].sort((a, b) => at(a).localeCompare(at(b)))
  const day = sorted.at(-1)?.day
  const today = sorted.filter((p) => p.day === day)
  const first = today[0]
  const lastPoint = today.at(-1)
  if (!first || !lastPoint) return null
  const t0 = first.tick
  const t1 = Math.max(lastPoint.tick, t0 + 1)
  const top = Math.max(...today.map((p) => p.cash))
  const step = niceStep(top, 4)
  const max = Math.max(step, Math.ceil(top / step) * step)
  const x = (tick: number) => pad.l + ((tick - t0) / (t1 - t0)) * (w - pad.l - pad.r)
  const y = (cash: number) => pad.t + (1 - cash / max) * (h - pad.t - pad.b)
  let d = `M${x(first.tick).toFixed(1)},${y(first.cash).toFixed(1)}`
  for (const p of today.slice(1)) d += ` H${x(p.tick).toFixed(1)} V${y(p.cash).toFixed(1)}`
  const endX = x(lastPoint.tick)
  const endY = y(lastPoint.cash)
  const area = `${d} V${y(0).toFixed(1)} H${x(t0).toFixed(1)} Z`
  const marks = today.slice(1).flatMap((p, i) => {
    const delta = p.cash - (today[i]?.cash ?? p.cash)
    return delta === 0 ? [] : [{ x: x(p.tick), y: y(p.cash), tone: delta > 0 ? ('in' as const) : ('out' as const), tick: p.tick, delta }]
  })
  const yTicks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => ({ y: y(i * step), value: i * step }))
  const tStep = niceStep(t1 - t0, 5)
  const xTicks: { x: number; tick: number }[] = []
  for (let tk = Math.ceil(t0 / tStep) * tStep; tk <= t1; tk += tStep) xTicks.push({ x: x(tk), tick: tk })
  return { path: d, area, marks, yTicks, xTicks, end: { x: endX, y: endY } }
}

/** The ledger, newest first, optionally one agent's. */
export function ordersOf(orders: readonly Order[], agent: string): Order[] {
  return [...orders].filter((o) => agent === 'all' || o.agent === agent).sort((a, b) => b.id - a.id)
}

export const agentsOf = (orders: readonly Order[]): string[] => [...new Set(orders.map((o) => o.agent))].sort()

/** The last change of cash in the page's own readings (the game's /me, live): its amount and tick. */
export function lastCashChange(history: readonly { readonly tick: number; readonly cash: number }[]): { delta: number; tick: number } | null {
  for (let i = history.length - 1; i > 0; i--) {
    const now = history[i]
    const before = history[i - 1]
    if (now && before && now.cash !== before.cash) return { delta: now.cash - before.cash, tick: now.tick }
  }
  return null
}
