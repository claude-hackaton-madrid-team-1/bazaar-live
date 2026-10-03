/**
 * The Movements screen's source: GET /api/history every few seconds (with `?token=` when the page has one),
 * or a made-up day with `?mock=1`. Keeps the last good snapshot through an error, like ./learn.ts.
 */
import { useEffect, useMemo, useState } from 'react'
import { EMPTY_HISTORY, type CashPoint, type HistorySnapshot, type Order, type ScoreMark, type ScorePoint, type TeamEvent, type Trade } from '../../shared/history.ts'

export type HistoryStatus = 'loading' | 'live' | 'off' | 'locked' | 'error' | 'mock'

export interface HistoryState {
  readonly status: HistoryStatus
  readonly snapshot: HistorySnapshot
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** An answer of /api/history → the screen's state. The server already checked every row. */
export function historyStateOf(httpStatus: number, body: unknown, prev: HistorySnapshot): HistoryState {
  if (httpStatus === 401) return { status: 'locked', snapshot: EMPTY_HISTORY }
  if (httpStatus !== 200 || !isObject(body)) return { status: 'error', snapshot: prev }
  if (body.enabled !== true) return { status: 'off', snapshot: EMPTY_HISTORY }
  const parts = isObject(body.parts) ? body.parts : {}
  return {
    status: 'live',
    snapshot: {
      at: typeof body.at === 'string' ? body.at : null,
      parts: {
        points: parts.points === true,
        trades: parts.trades === true,
        orders: parts.orders === true,
        events: parts.events === true,
        scores: parts.scores === true,
        marks: parts.marks === true,
      },
      points: list(body.points),
      trades: list(body.trades),
      orders: list(body.orders),
      events: list(body.events),
      scores: list(body.scores),
      marks: list(body.marks),
    },
  }
}

export function useHistory(mock: boolean, token: string | null, tick: number, intervalMs = 5_000): HistoryState {
  const [state, setState] = useState<HistoryState>({ status: 'loading', snapshot: EMPTY_HISTORY })
  const mocked = useMemo<HistoryState | null>(() => (mock ? { status: 'mock', snapshot: mockHistory(tick) } : null), [mock, tick])
  useEffect(() => {
    if (mock) return
    let stopped = false
    let controller: AbortController | null = null
    const read = async (): Promise<void> => {
      controller?.abort()
      controller = new AbortController()
      try {
        const res = await fetch(`/api/history${token ? `?token=${encodeURIComponent(token)}` : ''}`, { signal: controller.signal, cache: 'no-store' })
        const body: unknown = await res.json().catch(() => null)
        if (!stopped) setState((s) => historyStateOf(res.status, body, s.snapshot))
      } catch (error: unknown) {
        if (!stopped && !(error instanceof DOMException && error.name === 'AbortError')) setState((s) => ({ status: 'error', snapshot: s.snapshot }))
      }
    }
    void read()
    const timer = setInterval(() => void read(), intervalMs)
    return () => {
      stopped = true
      clearInterval(timer)
      controller?.abort()
    }
  }, [mock, token, intervalMs])
  return mocked ?? state
}

const DAY = '2026-10-03'

/** A made-up day of money around `tick`, for `?mock=1`: trades, a bond, a gift, and the cash they add up to. */
export function mockHistory(tick: number): HistorySnapshot {
  const t = Math.max(40, tick)
  const at = (n: number) => Math.max(1, Math.round((t * n) / 40))
  const trade = (id: number, n: number, side: 'buy' | 'sell', counterparty: string, card: string, price: number, fee: number, venue: string | null = 'rastro'): Trade => ({
    id, day: DAY, tick: at(n), side, counterparty, venue, card, cardName: null, rarity: null, items: 1, price, fee,
  })
  const trades: Trade[] = [
    trade(1, 3, 'buy', 'abuela', 'LAV-03', 7, 0, null),
    trade(2, 6, 'buy', 'abuela', 'LAV-06', 22, 0, null),
    trade(3, 10, 'buy', 't02', 'SAL-10', 72, 5),
    trade(4, 14, 'sell', 't14', 'LAT-08', 25, 3),
    trade(5, 24, 'buy', 't04', 'MAL-06', 20, 2),
    trade(6, 31, 'sell', 't06', 'SAL-10', 76, 5),
    trade(7, 36, 'sell', 't16', 'LAT-09', 68, 5),
  ]
  const ev = (id: number, n: number, type: string, extra: Partial<TeamEvent>): TeamEvent => ({
    id, day: DAY, tick: at(n), type, venue: null, name: null, bond: null, pack: null, best: null, cash: null, level: null, why: null, ...extra,
  })
  const events: TeamEvent[] = [
    ev(101, 8, 'level.unlocked', { level: 2, why: '4 deals with abuela', name: 'Team 1' }),
    ev(102, 18, 'venue.opened', { venue: 'v19', name: 'Team 1 market', bond: 250 }),
    ev(103, 20, 'pack.opened', { pack: 'sobre_bienvenida', best: 'SAL-10' }),
    ev(104, 27, 'gift.given', { cash: 40 }),
  ]
  // cash at each moment, from 400: every trade and event in order, plus 20 the venue took on top of its bond
  const flows = [
    ...trades.map((x) => ({ tick: x.tick, amount: x.side === 'sell' ? x.price : -(x.price + x.fee) })),
    ...events.map((e) => ({ tick: e.tick, amount: e.type === 'venue.opened' ? -(e.bond ?? 0) - 20 : (e.cash ?? 0) })),
  ].sort((a, b) => a.tick - b.tick)
  const start: CashPoint = { day: DAY, tick: 0, cash: 400, score: 0, rank: 14 }
  const points: CashPoint[] = [start]
  let last = start
  for (const f of flows) {
    if (f.tick > t || f.amount === 0) continue
    const next = { day: DAY, tick: f.tick, cash: last.cash + f.amount, score: Math.round(f.tick * 6) / 10, rank: Math.max(5, 14 - points.length) }
    if (last.tick === f.tick) points[points.length - 1] = next
    else points.push(next)
    last = next
  }
  if (last.tick !== t) points.push({ ...last, tick: t })
  const orders: Order[] = Array.from({ length: 12 }, (_, i) => ({
    id: 60 + i, day: DAY, tick: at(26 + i), kind: i % 4 === 3 ? 'accept' : 'listing', price: 10 + ((i * 7) % 20), item: ['LAV-04', 'SAL-03', 'MAL-08', 'LAT-02'][i % 4] ?? null, agent: i % 4 === 3 ? 'taker' : 'maker',
  }))
  const { scores, marks } = mockScores(t, points)
  return {
    at: new Date(0).toISOString(),
    parts: { points: true, trades: true, orders: true, events: true, scores: true, marks: true },
    points,
    trades: trades.filter((x) => x.tick <= t),
    orders: orders.filter((o) => o.tick <= t),
    events: events.filter((e) => e.tick <= t),
    scores,
    marks,
  }
}

const r2 = (n: number): number => Math.round(n * 100) / 100

/**
 * The made-up day's score: negotiation climbs in steps and faster after the taker's restart (at 16/40 of the
 * day), market-making starts with the maker's (at 28/40), the Market Test (20/40) brings the bench, and the
 * score drifts down a little while nothing happens, as the real one does against the others' play.
 */
function mockScores(t: number, cash: readonly CashPoint[]): { scores: ScorePoint[]; marks: ScoreMark[] } {
  const at = (n: number) => Math.max(1, Math.round((t * n) / 40))
  const time = (tick: number) => new Date(Date.UTC(2026, 9, 3, 7, 0, 0) + tick * 30_000).toISOString()
  const negSteps: [number, number][] = [[3, 5.7], [6, 7.3], [10, 18.8], [14, 32.2], [18, 41], [20, 57.4], [23, 74.9], [26, 92.3], [30, 118], [33, 134.7], [37, 151.2]]
  const scores: ScorePoint[] = []
  for (let tick = 0; tick <= t; tick++) {
    const n = (tick * 40) / t
    const neg = negSteps.filter(([k]) => at(k) <= tick).at(-1)?.[1] ?? 0
    const duel = n < 22 ? 0 : r2((n - 22) * 0.42)
    const ladder = n < 3 ? 0 : n < 16 ? 0.009 : n < 25 ? 0.6 : 1.4
    const mm = n < 28 ? 0 : r2((n - 28) * 0.31)
    const bench = n < 20 ? null : 0.5
    const drift = (Math.floor(n * 2) % 5) * 0.03
    const score = r2(8.34 + neg * 0.075 + duel * 0.6 + ladder * 1.2 + mm * 1.5 + (bench ?? 0) * 6 - drift)
    const money = cash.filter((p) => p.tick <= tick).at(-1)?.cash ?? null
    scores.push({ day: DAY, tick, at: time(tick), cash: money, score, duel, ladder, neg, mm, bench })
  }
  const mark = (id: number, n: number, kind: 'start' | 'game', extra: Partial<ScoreMark>): ScoreMark => ({
    kind, id, day: DAY, tick: at(n), agent: null, action: null, note: null, at: kind === 'game' ? time(at(n)) : null, ...extra,
  })
  const marks = [
    mark(979, 16, 'start', { agent: 'taker' }),
    mark(22260, 20, 'game', { action: 'bench', note: 'The Market Test: every venue gets the same synthetic book' }),
    mark(1104, 28, 'start', { agent: 'maker' }),
  ].filter((m) => m.tick <= t)
  return { scores, marks }
}
