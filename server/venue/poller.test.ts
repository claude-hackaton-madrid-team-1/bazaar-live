import { describe, expect, it } from 'vitest'
import type { Db } from '../transcript/poller.ts'
import { CAPS, SQL, VenuePoller } from './poller.ts'

const ROWS: Record<string, unknown[]> = {
  [SQL.venues]: [{ venue: 'v19', name: 'Team 1 market', mechanism: 'board', fee_bps: 0, fee_per_card: 0, status: 'open', opened_tick: 900, current: true, counted: true }],
  [SQL.sessions]: [{ id: '4', day: '2026-10-04', session: 6, start_tick: 1401, ticks: 16, venues: 19, ours: true, received_at: new Date('2026-10-04T10:03:00Z') }],
  [SQL.books]: [{ run: 'b35', day: '2026-10-04', first_tick: 1402, last_tick: 1416, ticks_seen: 15, venue: 'v19', fee_bps: 0, fee_per_card: 0, session: 6, start_tick: 1401, offers: [{ id: 'b35-1', side: 'sell', quote: 40, first: 1402, last: 1402 }] }],
  [SQL.matches]: [{ id: '2', tick: 1403, kind: 'broker_match', status: 'done', bench: true, run: 'b35', ask: 40, bid: 62, price: 51, fee: 0, surplus: '22.0' }],
  [SQL.trades]: [{ id: '7', day: '2026-10-04', tick: 1503, type: 'settled', venue: 'v19', card: 'LAV-03', price: 12, fee: 0, buyer: 't09', seller: 't07' }],
  [SQL.score]: [{ day: '2026-10-04', tick: 1420, venue: 'v19', bench_venue: 'v19', bench_efficiency: '0.9120', bench_points: '0.500', mm_points: '2.300', market: '8.400' }],
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

describe('VenuePoller', () => {
  it('reads the six views with their caps', async () => {
    const d = db()
    const poller = new VenuePoller({ db: d, log: () => undefined, now: () => new Date('2026-10-04T10:10:00Z') })
    await poller.pollOnce()
    expect(d.params).toEqual([[CAPS.venues], [CAPS.sessions], [CAPS.books], [CAPS.matches], [CAPS.trades], [CAPS.score]])
    const s = poller.current()
    expect(s).toMatchObject({ at: '2026-10-04T10:10:00.000Z', parts: { venues: true, sessions: true, books: true, matches: true, trades: true, score: true } })
    expect(s.venues[0]).toMatchObject({ venue: 'v19', mechanism: 'board', counted: true })
    expect(s.sessions[0]).toMatchObject({ session: 6, startTick: 1401, ours: true, at: '2026-10-04T10:03:00.000Z' })
    expect(s.books[0]?.traders).toHaveLength(1)
    expect(s.matches[0]).toMatchObject({ id: 2, surplus: 22, bench: true })
    expect(s.trades[0]).toMatchObject({ type: 'settled', buyer: 't09' })
    expect(s.score[0]).toMatchObject({ efficiency: 0.912, benchPoints: 0.5 })
  })

  it('a view not applied yet blanks only its part, logged once; another error keeps the last good part, redacted', async () => {
    const logs: Record<string, unknown>[] = []
    let missing = true
    const d = db((sql) => (sql === SQL.books && missing ? { code: '42P01' } : sql === SQL.venues && !missing ? Object.assign(new Error('timeout at host-secret'), { code: '57014' }) : null))
    const poller = new VenuePoller({ db: d, log: (e) => logs.push(e), secrets: ['host-secret'] })
    await poller.pollOnce()
    await poller.pollOnce()
    expect(poller.current().parts.books).toBe(false)
    expect(logs.filter((l) => l.event === 'view_missing')).toHaveLength(1)
    missing = false
    await poller.pollOnce()
    expect(poller.current().venues[0]?.venue).toBe('v19')
    expect(poller.current().parts.books).toBe(true)
    expect(logs.find((l) => l.event === 'poll_error' && l.part === 'venues')?.message).toBe('timeout at ***')
  })

  it('tells a listener when a read changed the rows, and a poke reads at once', async () => {
    const poller = new VenuePoller({ db: db(), log: () => undefined, now: () => new Date('2026-10-04T10:00:00Z'), setTimer: () => 1, clearTimer: () => undefined })
    const heard: string[] = []
    poller.onChange((at) => heard.push(at))
    await poller.pollOnce()
    await poller.pollOnce()
    expect(heard).toEqual(['2026-10-04T10:00:00.000Z'])
    expect(poller.poke()).toBe(false)
    poller.start()
    await new Promise((r) => setTimeout(r, 0))
    expect(poller.poke()).toBe(true)
    poller.stop()
  })
})
