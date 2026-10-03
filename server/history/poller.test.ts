import { describe, expect, it } from 'vitest'
import type { Db } from '../transcript/poller.ts'
import { CAPS, HistoryPoller, SQL } from './poller.ts'

const ROWS: Record<string, unknown[]> = {
  [SQL.points]: [{ day: '2026-10-03', tick: 1, cash: 400 }],
  [SQL.trades]: [{ id: 1, day: '2026-10-03', tick: 1, side: 'buy', price: 7 }],
  [SQL.orders]: [{ id: 1, day: '2026-10-03', tick: 1, kind: 'listing', agent: 'maker' }],
  [SQL.events]: [{ id: 1, day: '2026-10-03', tick: 1, type: 'gift.given', cash: 40 }],
  [SQL.scores]: [{ day: '2026-10-03', tick: 1, read_at: new Date('2026-10-03T07:28:41Z'), cash: 400, score: '8.340' }],
  [SQL.marks]: [{ kind: 'start', id: 533, day: '2026-10-03', tick: 1, agent: 'taker', action: null, note: null, at: null }],
}

const db = (fail: (sql: string) => unknown = () => null): Db & { params: unknown[] } => {
  const params: unknown[] = []
  return {
    params,
    query: (sql, p) => {
      params.push(p)
      const error = fail(sql)
      return error ? Promise.reject(error) : Promise.resolve({ rows: ROWS[sql] ?? [] })
    },
  }
}

describe('HistoryPoller', () => {
  it('reads the six views with their caps', async () => {
    const d = db()
    const poller = new HistoryPoller({ db: d, log: () => undefined, now: () => new Date('2026-10-03T10:00:00Z') })
    await poller.pollOnce()
    expect(d.params).toEqual([[CAPS.points], [CAPS.trades], [CAPS.orders], [CAPS.events], [CAPS.scores], [CAPS.marks]])
    expect(poller.current()).toMatchObject({ at: '2026-10-03T10:00:00.000Z', parts: { points: true, trades: true, orders: true, events: true, scores: true, marks: true } })
    expect(poller.current().scores[0]).toMatchObject({ at: '2026-10-03T07:28:41.000Z', score: 8.34, duel: null })
    expect(poller.current().marks[0]).toMatchObject({ kind: 'start', agent: 'taker', tick: 1 })
    expect(poller.current().events[0]?.cash).toBe(40)
  })

  it('a view not applied yet blanks only its part, logged once; another error keeps the last good part', async () => {
    const logs: Record<string, unknown>[] = []
    let missing = true
    const d = db((sql) => (sql === SQL.orders && missing ? { code: '42P01' } : sql === SQL.points && !missing ? { code: '57014', message: 'timeout' } : null))
    const poller = new HistoryPoller({ db: d, log: (e) => logs.push(e) })
    await poller.pollOnce()
    await poller.pollOnce()
    expect(poller.current().parts.orders).toBe(false)
    expect(logs.filter((l) => l.event === 'view_missing')).toHaveLength(1)
    missing = false
    await poller.pollOnce()
    expect(poller.current().points).toHaveLength(1)
    expect(poller.current().parts.orders).toBe(true)
    expect(logs.some((l) => l.event === 'poll_error' && l.part === 'points')).toBe(true)
  })
})
